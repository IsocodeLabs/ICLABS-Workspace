import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, auditLog, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { enqueueEmail, type EnqueueInput } from "../email/outbox";
import { DEFAULT_TEMPLATES, renderEmail } from "../email/templates";
import { MAX_ALERTS_PER_HOUR, errorFingerprint, recordError, type ErrorReport } from "./alerts";
import { FRIENDLY, FriendlyError, errorKind, friendlyMessage } from "../../lib/client-errors";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

const KEY = Buffer.alloc(32, 7).toString("base64");

function deps() {
  const sent: EnqueueInput[] = [];
  return {
    sent,
    deps: {
      to: "hr@isocodelabs.com",
      queueEmail: async (input: EnqueueInput) => {
        sent.push(input);
        return enqueueEmail(db, { secretKey: KEY }, input);
      },
    },
  };
}

const stale = (id: string, path: string): ErrorReport => ({
  kind: "stale_page",
  message: `Error: Server Action "${id}" was not found on the server.`,
  shown: FRIENDLY.stale_page,
  where: "boundary:candidate",
  url: `https://workspace.isocodelabs.com${path}`,
});

describe("what people are shown", () => {
  it("never shows the raw Next.js error", () => {
    const e = new Error(
      'Server Action "4024452981e1efc120c546708b9c1a10c1e259f8ca" was not found on the server. \nRead more: https://nextjs.org/docs/messages/failed-to-find-server-action',
    );
    expect(errorKind(e)).toBe("stale_page");
    expect(friendlyMessage(e)).toBe(FRIENDLY.stale_page);
    expect(friendlyMessage(e)).not.toMatch(/Server Action|nextjs/);
  });

  it("rewords anything unexpected, and keeps our own wording", () => {
    expect(friendlyMessage(new TypeError("Cannot read properties of undefined"))).toBe(
      FRIENDLY.crash,
    );
    expect(friendlyMessage(new TypeError("Failed to fetch"))).toBe(FRIENDLY.offline);
    expect(friendlyMessage(new FriendlyError("Files can be up to 25 MB."))).toBe(
      "Files can be up to 25 MB.",
    );
  });
});

describe("error alerts", () => {
  it("emails the alert address with who, where and what, and logs it", async () => {
    const { sent, deps: d } = deps();
    const res = await recordError(
      db,
      stale("40ab12cd34ef56", "/roles/app_1/stages/n1"),
      { userId: undefined, name: "Riya Shah", email: "riya@x.com", kind: "candidate" },
      d,
    );
    expect(res.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("hr@isocodelabs.com");
    const email = renderEmail(DEFAULT_TEMPLATES.error_alert, sent[0]!.vars!);
    expect(email.subject).toContain("Riya Shah (riya@x.com, candidate)");
    expect(email.text).toContain("/roles/app_1/stages/n1");
    expect(email.text).toContain("Server Action");
    const logged = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "client_error"), eq(auditLog.entityId, res.fingerprint)));
    expect(logged).toHaveLength(1);
  });

  it("sends one email per problem in 15 minutes, but logs every occurrence", async () => {
    const { sent, deps: d } = deps();
    // Same problem on another candidate's page with another action id: one fingerprint.
    const a = stale("aaaaaaaaaaaa", "/roles/app_2/stages/n9");
    const b = stale("bbbbbbbbbbbb", "/roles/app_3/stages/n9");
    expect(errorFingerprint(a)).toBe(errorFingerprint(b));
    const first = await recordError(db, { ...a, where: "upload" }, null, d);
    const second = await recordError(db, { ...b, where: "upload" }, null, d);
    expect([first.emailed, second.emailed]).toEqual([true, false]);
    expect(sent).toHaveLength(1);
    const logged = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "client_error"), eq(auditLog.entityId, first.fingerprint)));
    expect(logged).toHaveLength(2);
  });

  it("a different problem gets its own email", async () => {
    const { sent, deps: d } = deps();
    await recordError(
      db,
      {
        kind: "crash",
        message: "TypeError: x is undefined",
        shown: FRIENDLY.crash,
        where: "boundary:team",
        url: "https://w.test/team/pipeline",
      },
      null,
      d,
    );
    expect(sent).toHaveLength(1);
    expect(renderEmail(DEFAULT_TEMPLATES.error_alert, sent[0]!.vars!).subject).toContain(
      "Someone who wasn't signed in",
    );
  });

  it("stops emailing after the hourly cap", async () => {
    const { sent, deps: d } = deps();
    for (let i = 0; i < MAX_ALERTS_PER_HOUR + 5; i++)
      await recordError(
        db,
        {
          kind: "crash",
          message: `Error: distinct problem ${"x".repeat(i + 1)}`,
          shown: FRIENDLY.crash,
          where: `cap-${"y".repeat(i)}`,
          url: "https://w.test/",
        },
        null,
        d,
      );
    expect(sent.length).toBeLessThan(MAX_ALERTS_PER_HOUR);
  });
});
