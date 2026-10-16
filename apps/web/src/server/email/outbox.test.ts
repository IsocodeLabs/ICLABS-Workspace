import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, candidates, emailMessages, emailTemplates, users, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import type { Mailer, OutgoingEmail } from "./mailer";
import { applyDeliveryEvent, enqueueEmail, processOutbox } from "./outbox";
import { redirectRecipient } from "./mailer";

let db: Db;
let close: () => Promise<void>;
const config = { secretKey: randomBytes(32).toString("base64") };
let sent: OutgoingEmail[];
let failNext = false;
const mailer: Mailer = {
  async send(email) {
    if (failNext) {
      failNext = false;
      throw new Error("SES throttled");
    }
    sent.push(email);
    return { messageId: `<0102018f-${sent.length}@ap-south-1.amazonses.com>` };
  },
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(async () => {
  sent = [];
  failNext = false;
  await db.delete(emailMessages);
});

async function candidateUser(email: string) {
  const [u] = await db.insert(users).values({ email, name: "Riya" }).returning();
  await db.insert(candidates).values({ userId: u!.id, name: "Riya" });
  return u!.id;
}

describe("email outbox", () => {
  it("sends the welcome email with the temporary password, then wipes the secret", async () => {
    const userId = await candidateUser("riya@example.com");
    const id = await enqueueEmail(db, config, {
      to: "Riya@Example.com",
      templateKey: "welcome",
      userId,
      vars: {
        first_name: "Riya",
        roles: "SDE Intern",
        email: "riya@example.com",
        login_url: "https://w/login",
      },
      secrets: { temp_password: "Kx7m-Pq4t-Wr9z" },
    });

    const [queued] = await db.select().from(emailMessages).where(eq(emailMessages.id, id));
    expect(queued!.secretPayload).not.toContain("Kx7m");
    expect(JSON.stringify(queued!.vars)).not.toContain("Kx7m");

    expect(await processOutbox(db, mailer, config)).toEqual({ sent: 1, failed: 0, suppressed: 0 });
    expect(sent[0]!.to).toBe("riya@example.com");
    expect(sent[0]!.text).toContain("Temporary password: Kx7m-Pq4t-Wr9z");

    const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, id));
    expect(row).toMatchObject({
      status: "sent",
      secretPayload: null,
      providerMessageId: "0102018f-1",
    });
    expect(row!.subject).toContain("SDE Intern");
  });

  it("refuses secrets in templates that aren't allowed to carry them", async () => {
    await expect(
      enqueueEmail(db, config, {
        to: "a@b.c",
        templateKey: "role_added",
        secrets: { temp_password: "x" },
      }),
    ).rejects.toThrow(/isn't allowed/);
  });

  it("waits until sendAfter", async () => {
    await enqueueEmail(db, config, {
      to: "a@b.c",
      templateKey: "not_progressing",
      sendAfter: new Date(Date.now() + 3600_000),
    });
    expect((await processOutbox(db, mailer, config)).sent).toBe(0);
  });

  it("retries with backoff and eventually gives up, wiping secrets", async () => {
    const id = await enqueueEmail(db, config, {
      to: "a@b.c",
      templateKey: "welcome",
      secrets: { temp_password: "zzzz" },
    });
    failNext = true;
    expect((await processOutbox(db, mailer, config)).failed).toBe(1);
    let [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, id));
    expect(row).toMatchObject({ status: "queued", attempts: 1, lastError: "SES throttled" });
    expect(row!.sendAfter.getTime()).toBeGreaterThan(Date.now());

    // Exhaust the remaining attempts.
    for (let i = 0; i < 4; i++) {
      failNext = true;
      await processOutbox(db, mailer, config, {
        now: new Date(Date.now() + (i + 1) * 10 * 3600_000),
      });
    }
    [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, id));
    expect(row).toMatchObject({ status: "failed", secretPayload: null });
  });

  it("uses admin-edited wording when present", async () => {
    await db.insert(emailTemplates).values({
      key: "not_progressing",
      subject: "About {{role}}",
      body: "Thanks {{first_name}}.",
    });
    await enqueueEmail(db, config, {
      to: "a@b.c",
      templateKey: "not_progressing",
      vars: { role: "PM Intern", first_name: "Sam" },
    });
    await processOutbox(db, mailer, config);
    expect(sent[0]).toMatchObject({ subject: "About PM Intern", text: "Thanks Sam." });
    await db.delete(emailTemplates);
  });

  it("marks hard bounces, suppresses future email to that address", async () => {
    const userId = await candidateUser("bounce@example.com");
    await enqueueEmail(db, config, {
      to: "bounce@example.com",
      templateKey: "stage_unlocked",
      userId,
    });
    await processOutbox(db, mailer, config);
    const [row] = await db.select().from(emailMessages).where(eq(emailMessages.userId, userId));
    await applyDeliveryEvent(db, {
      messageId: row!.providerMessageId!,
      type: "bounce",
      permanent: true,
      at: new Date().toISOString(),
    });

    const [c] = await db.select().from(candidates).where(eq(candidates.userId, userId));
    expect(c!.emailStatus).toBe("bounced");
    await enqueueEmail(db, config, {
      to: "bounce@example.com",
      templateKey: "deadline_reminder",
      userId,
    });
    expect(await processOutbox(db, mailer, config)).toEqual({ sent: 0, failed: 0, suppressed: 1 });
  });

  it("redirects non-allowlisted recipients outside production", () => {
    expect(redirectRecipient("someone@gmail.com", ["@isocodelabs.com"])).toBe(
      "success@simulator.amazonses.com",
    );
    expect(redirectRecipient("dev@isocodelabs.com", ["@isocodelabs.com"])).toBe(
      "dev@isocodelabs.com",
    );
    expect(redirectRecipient("anyone@gmail.com", undefined)).toBe("anyone@gmail.com");
  });
});
