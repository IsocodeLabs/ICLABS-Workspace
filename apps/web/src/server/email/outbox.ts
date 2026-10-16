import {
  and,
  asc,
  eq,
  inArray,
  lte,
  sql,
  candidates,
  emailMessages,
  emailTemplates,
  type Db,
} from "@iclabs/db";
import type { Mailer } from "./mailer";
import { openSecret, sealSecret } from "./secret-box";
import { DEFAULT_TEMPLATES, SECRET_VARS, renderEmail, type TemplateKey } from "./templates";

export type OutboxConfig = { secretKey: string; maxAttempts?: number };

export type EnqueueInput = {
  to: string;
  templateKey: TemplateKey;
  vars?: Record<string, string>;
  /** One-time secrets: encrypted at rest, wiped after sending, never logged. */
  secrets?: Record<string, string>;
  userId?: string | null;
  applicationId?: string | null;
  sendAfter?: Date;
  attachments?: { filename: string; content: string; contentType: string }[];
};

export async function enqueueEmail(
  db: Db,
  config: OutboxConfig,
  input: EnqueueInput,
): Promise<string> {
  for (const name of Object.keys(input.secrets ?? {})) {
    if (!SECRET_VARS[name]?.includes(input.templateKey))
      throw new Error(`${name} isn't allowed in ${input.templateKey}`);
  }
  const vars = { ...input.vars };
  if (input.attachments) vars.__attachments = JSON.stringify(input.attachments);
  const [row] = await db
    .insert(emailMessages)
    .values({
      toEmail: input.to.toLowerCase(),
      templateKey: input.templateKey,
      vars,
      secretPayload:
        input.secrets && Object.keys(input.secrets).length
          ? sealSecret(input.secrets, config.secretKey)
          : null,
      userId: input.userId ?? null,
      applicationId: input.applicationId ?? null,
      sendAfter: input.sendAfter ?? new Date(),
    })
    .returning({ id: emailMessages.id });
  return row!.id;
}

const BACKOFF_MIN = [1, 5, 15, 60, 240];

/**
 * Sends due emails. Safe to run concurrently: rows are claimed with an atomic status flip.
 * Addresses that bounced or complained are suppressed instead of sent.
 */
export async function processOutbox(
  db: Db,
  mailer: Mailer,
  config: OutboxConfig,
  opts: { now?: Date; limit?: number } = {},
): Promise<{ sent: number; failed: number; suppressed: number }> {
  const now = opts.now ?? new Date();
  const maxAttempts = config.maxAttempts ?? 5;
  const due = await db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.status, "queued"), lte(emailMessages.sendAfter, now)))
    .orderBy(asc(emailMessages.sendAfter))
    .limit(opts.limit ?? 50);

  const overrides = new Map(
    (await db.select().from(emailTemplates)).map((t) => [
      t.key,
      { subject: t.subject, body: t.body },
    ]),
  );
  const result = { sent: 0, failed: 0, suppressed: 0 };

  for (const { id } of due) {
    const [claimed] = await db
      .update(emailMessages)
      .set({ status: "sending", attempts: sql`${emailMessages.attempts} + 1` })
      .where(and(eq(emailMessages.id, id), eq(emailMessages.status, "queued")))
      .returning();
    if (!claimed) continue;

    if (claimed.userId) {
      const [c] = await db
        .select({ emailStatus: candidates.emailStatus })
        .from(candidates)
        .where(eq(candidates.userId, claimed.userId));
      if (c && c.emailStatus !== "ok") {
        await db
          .update(emailMessages)
          .set({ status: "suppressed", secretPayload: null, lastError: `address ${c.emailStatus}` })
          .where(eq(emailMessages.id, id));
        result.suppressed++;
        continue;
      }
    }

    try {
      const key = claimed.templateKey as TemplateKey;
      const template = overrides.get(key) ?? DEFAULT_TEMPLATES[key];
      const { __attachments, ...vars } = claimed.vars;
      const secrets = claimed.secretPayload
        ? openSecret(claimed.secretPayload, config.secretKey)
        : {};
      const rendered = renderEmail(template, { ...vars, ...secrets });
      const { messageId } = await mailer.send({
        to: claimed.toEmail,
        ...rendered,
        attachments: __attachments ? JSON.parse(__attachments) : undefined,
        tags: { template: key, email_id: id },
      });
      await db
        .update(emailMessages)
        .set({
          status: "sent",
          sentAt: new Date(),
          subject: rendered.subject,
          providerMessageId: normalizeMessageId(messageId),
          secretPayload: null,
          lastError: null,
        })
        .where(eq(emailMessages.id, id));
      result.sent++;
    } catch (e) {
      const attempts = claimed.attempts;
      const giveUp = attempts >= maxAttempts;
      await db
        .update(emailMessages)
        .set({
          status: giveUp ? "failed" : "queued",
          lastError: (e as Error).message.slice(0, 500),
          sendAfter: new Date(now.getTime() + (BACKOFF_MIN[attempts - 1] ?? 240) * 60_000),
          ...(giveUp ? { secretPayload: null } : {}),
        })
        .where(eq(emailMessages.id, id));
      result.failed++;
    }
  }
  return result;
}

/** SES reports bare ids; nodemailer wraps them as "<id@region.amazonses.com>". */
export function normalizeMessageId(id: string): string {
  return id.replace(/^</, "").replace(/>$/, "").split("@")[0]!;
}

export type DeliveryEvent = {
  messageId: string;
  type: "delivery" | "bounce" | "complaint" | "reject" | "delay";
  permanent?: boolean;
  at: string;
  detail?: string;
};

/** Applies an SES event (via SNS) to the email log and the candidate's address status. */
export async function applyDeliveryEvent(
  db: Db,
  event: DeliveryEvent,
): Promise<{ userId: string | null } | null> {
  const [msg] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.providerMessageId, normalizeMessageId(event.messageId)));
  if (!msg) return null;

  const status =
    event.type === "delivery"
      ? "delivered"
      : event.type === "complaint"
        ? "complained"
        : event.type === "reject"
          ? "rejected"
          : event.type === "bounce" && event.permanent
            ? "bounced"
            : msg.status;
  await db
    .update(emailMessages)
    .set({
      status,
      events: [...msg.events, { type: event.type, at: event.at, detail: event.detail }],
    })
    .where(eq(emailMessages.id, msg.id));

  if (msg.userId && ((event.type === "bounce" && event.permanent) || event.type === "complaint")) {
    await db
      .update(candidates)
      .set({ emailStatus: event.type === "complaint" ? "complained" : "bounced" })
      .where(eq(candidates.userId, msg.userId));
  }
  return { userId: msg.userId };
}

export async function emailLogFor(db: Db, userId: string) {
  return db
    .select({
      id: emailMessages.id,
      templateKey: emailMessages.templateKey,
      subject: emailMessages.subject,
      status: emailMessages.status,
      createdAt: emailMessages.createdAt,
      sentAt: emailMessages.sentAt,
      lastError: emailMessages.lastError,
    })
    .from(emailMessages)
    .where(eq(emailMessages.userId, userId))
    .orderBy(asc(emailMessages.createdAt));
}

export async function retryFailed(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(emailMessages)
    .set({ status: "queued", sendAfter: new Date() })
    .where(and(inArray(emailMessages.id, ids), eq(emailMessages.status, "failed")));
}
