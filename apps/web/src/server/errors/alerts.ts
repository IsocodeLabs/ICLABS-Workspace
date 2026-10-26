import { and, eq, gte, sql, auditLog, emailMessages, type Db } from "@iclabs/db";
import { formatIst } from "@iclabs/core";
import type { EnqueueInput } from "../email/outbox";

/**
 * What went wrong, in the terms the alert is written in:
 * - stale_page: the page was opened before a deploy and called code that no longer exists
 * - offline: the browser couldn't reach the workspace
 * - crash: anything else that put an error on someone's screen
 */
export const ERROR_KINDS = ["stale_page", "offline", "crash"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export type ErrorReport = {
  kind: ErrorKind;
  /** The raw error text. Goes to the team only, never back to the person who saw it. */
  message: string;
  /** What the person was shown instead. */
  shown: string;
  /** Where in the app it was caught, e.g. "boundary:candidate" or "upload". */
  where: string;
  url: string;
  digest?: string;
  userAgent?: string;
};

/** Who saw it; null when nobody was signed in. */
export type ErrorReporter = { userId?: string; name: string; email: string; kind: string };

/** One alert per problem per window; every occurrence is still logged and counted. */
export const ALERT_WINDOW_MS = 15 * 60_000;
/** Hard cap so a broken deploy can't flood the inbox. */
export const MAX_ALERTS_PER_HOUR = 30;

const SUMMARY: Record<ErrorKind, string> = {
  stale_page:
    "A page opened before the last update tried to save or load something and was asked to reload",
  offline: "A page couldn't reach the workspace (connection dropped or the server didn't answer)",
  crash: "A page hit an unexpected error",
};

/**
 * Groups repeats of the same problem: ids, numbers and hashes are stripped from the message
 * and the path, so "action 40ab… not found on /roles/123" and "…/roles/456" are one problem.
 */
export function errorFingerprint(r: Pick<ErrorReport, "kind" | "message" | "url" | "where">) {
  const path = (() => {
    try {
      return new URL(r.url).pathname;
    } catch {
      return "";
    }
  })();
  const scrub = (s: string) =>
    s
      .replace(/[0-9a-f]{8,}/gi, "#")
      .replace(/\d+/g, "#")
      .replace(/[A-Za-z0-9_-]{20,}/g, "#")
      .slice(0, 120);
  return `${r.kind}|${r.where}|${scrub(path)}|${r.kind === "stale_page" ? "" : scrub(r.message)}`;
}

/**
 * Logs an error someone saw (audit log, action "client_error") and emails the alert address
 * unless the same problem was already emailed in the last 15 minutes.
 */
export async function recordError(
  db: Db,
  report: ErrorReport,
  who: ErrorReporter | null,
  deps: { queueEmail: (input: EnqueueInput) => Promise<string>; to: string },
  now = new Date(),
): Promise<{ emailed: boolean; fingerprint: string }> {
  const fingerprint = errorFingerprint(report);
  await db.insert(auditLog).values({
    actorUserId: who?.userId ?? null,
    actorVia: who?.userId ? "ui" : "system",
    action: "client_error",
    entity: "client",
    entityId: fingerprint.slice(0, 250),
    after: {
      kind: report.kind,
      message: report.message,
      shown: report.shown,
      where: report.where,
      url: report.url,
      digest: report.digest ?? null,
      userAgent: report.userAgent ?? null,
    },
  });

  const windowStart = new Date(now.getTime() - ALERT_WINDOW_MS);
  const hourStart = new Date(now.getTime() - 60 * 60_000);
  const [recent] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.templateKey, "error_alert"),
        gte(emailMessages.createdAt, windowStart),
        sql`${emailMessages.vars}->>'fingerprint' = ${fingerprint}`,
      ),
    );
  if (recent!.n > 0) return { emailed: false, fingerprint };
  const [hourly] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailMessages)
    .where(
      and(eq(emailMessages.templateKey, "error_alert"), gte(emailMessages.createdAt, hourStart)),
    );
  if (hourly!.n >= MAX_ALERTS_PER_HOUR) return { emailed: false, fingerprint };

  const [seen] = await db
    .select({
      n: sql<number>`count(*)::int`,
      people: sql<number>`count(distinct ${auditLog.actorUserId})::int`,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, "client_error"),
        eq(auditLog.entityId, fingerprint.slice(0, 250)),
        gte(auditLog.at, hourStart),
      ),
    );

  await deps.queueEmail({
    to: deps.to,
    templateKey: "error_alert",
    vars: {
      fingerprint,
      summary: SUMMARY[report.kind],
      who: who ? `${who.name} (${who.email}, ${who.kind})` : "Someone who wasn't signed in",
      page: report.url.slice(0, 300),
      when: formatIst(now),
      count: `${seen!.n} time${seen!.n === 1 ? "" : "s"} in the last hour, ${seen!.people} signed-in ${seen!.people === 1 ? "person" : "people"}`,
      shown: report.shown.slice(0, 300),
      detail: [
        report.message.slice(0, 600),
        report.digest && `Server log reference: ${report.digest}`,
      ]
        .filter(Boolean)
        .join(" · "),
      where: report.where,
      browser: (report.userAgent ?? "unknown").slice(0, 200),
    },
  });
  return { emailed: true, fingerprint };
}
