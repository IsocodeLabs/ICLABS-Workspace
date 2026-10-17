import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, accounts, teamMembers, users, verifications, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { MAX_FAILED_ATTEMPTS } from "@iclabs/core";
import { hashPassword } from "./password-hash";
import { MAX_CODE_ATTEMPTS, prepareTeamPasswordSetup, startTeamSignIn, verifyTeamCode, type TeamSignInDeps } from "./team-auth";

let db: Db;
let close: () => Promise<void>;
let clock: Date;
const PASSWORD = "Correct horse battery";
const sent: { email: string; code: string }[] = [];
const notifier = { accountLocked: vi.fn(async () => {}), passwordChanged: vi.fn(async () => {}) };
const deps = (): TeamSignInDeps => ({
  db,
  teamDomain: "isocodelabs.com",
  notifier,
  sendCode: async ({ email, code }) => void sent.push({ email, code }),
  now: () => clock,
});
let ipCounter = 0;
const signIn = (email: string, password = PASSWORD) =>
  startTeamSignIn(deps(), { email, password, ip: `10.0.0.${++ipCounter}` });

async function teamUser(email: string, opts: { member?: boolean; active?: boolean; password?: boolean } = {}) {
  const [u] = await db.insert(users).values({ email, name: "T", kind: "team", emailVerified: true }).returning();
  if (opts.password !== false)
    await db.insert(accounts).values({ userId: u!.id, accountId: u!.id, providerId: "credential", password: await hashPassword(PASSWORD) });
  if (opts.member !== false) await db.insert(teamMembers).values({ email, role: "admin", active: opts.active ?? true });
  return u!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());
beforeEach(() => {
  clock = new Date("2026-10-17T10:00:00Z");
  sent.length = 0;
});

describe("team sign-in: password then emailed code", () => {
  it("emails a 6-digit code after the right password and only a correct code passes, once", async () => {
    const u = await teamUser("devansh@isocodelabs.com");
    const res = await signIn("Devansh@IsocodeLabs.com");
    if (!res.ok) throw new Error(res.reason);
    expect(sent).toEqual([{ email: "devansh@isocodelabs.com", code: expect.stringMatching(/^\d{6}$/) }]);
    // The code itself is never stored.
    const rows = await db.select().from(verifications);
    expect(JSON.stringify(rows)).not.toContain(sent[0]!.code);

    const wrong = sent[0]!.code === "000000" ? "111111" : "000000";
    expect(await verifyTeamCode(db, { challenge: res.challenge, code: wrong }, clock)).toEqual({
      ok: false,
      reason: "invalid",
      attemptsLeft: MAX_CODE_ATTEMPTS - 1,
    });
    expect(await verifyTeamCode(db, { challenge: res.challenge, code: sent[0]!.code }, clock)).toEqual({ ok: true, userId: u.id });
    expect(await verifyTeamCode(db, { challenge: res.challenge, code: sent[0]!.code }, clock)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses wrong passwords, non-members, deactivated members and other domains the same way", async () => {
    await teamUser("aryan@isocodelabs.com");
    await teamUser("former@isocodelabs.com", { active: false });
    await teamUser("notlisted@isocodelabs.com", { member: false });
    await teamUser("someone@gmail.com");
    for (const [email, password] of [
      ["aryan@isocodelabs.com", "nope nope nope"],
      ["former@isocodelabs.com", PASSWORD],
      ["notlisted@isocodelabs.com", PASSWORD],
      ["someone@gmail.com", PASSWORD],
      ["ghost@isocodelabs.com", PASSWORD],
    ] as const) {
      expect(await signIn(email, password)).toEqual({ ok: false, reason: "invalid" });
    }
    expect(sent).toEqual([]);
  });

  it("locks the account after repeated wrong passwords", async () => {
    await teamUser("lock@isocodelabs.com");
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) last = await signIn("lock@isocodelabs.com", "wrong password!");
    expect(last).toMatchObject({ ok: false, reason: "locked" });
    expect(notifier.accountLocked).toHaveBeenCalledWith("lock@isocodelabs.com");
    expect(await signIn("lock@isocodelabs.com")).toMatchObject({ ok: false, reason: "locked" });
  });

  it("ends the challenge after too many wrong codes or 10 minutes", async () => {
    await teamUser("tries@isocodelabs.com");
    const a = await signIn("tries@isocodelabs.com");
    if (!a.ok) throw new Error(a.reason);
    const code = sent.at(-1)!.code;
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await verifyTeamCode(db, { challenge: a.challenge, code: wrong }, clock);
    expect(await verifyTeamCode(db, { challenge: a.challenge, code: wrong }, clock)).toEqual({ ok: false, reason: "expired" });
    expect(await verifyTeamCode(db, { challenge: a.challenge, code }, clock)).toEqual({ ok: false, reason: "expired" });

    const b = await signIn("tries@isocodelabs.com");
    if (!b.ok) throw new Error(b.reason);
    const later = new Date(clock.getTime() + 11 * 60_000);
    expect(await verifyTeamCode(db, { challenge: b.challenge, code: sent.at(-1)!.code }, later)).toEqual({ ok: false, reason: "expired" });
  });
});

describe("password setup", () => {
  it("prepares a team user only for active members on the team domain", async () => {
    await db.insert(teamMembers).values({ email: "new@isocodelabs.com", role: "reviewer" });
    expect(await prepareTeamPasswordSetup(db, "New@isocodelabs.com", "isocodelabs.com")).toBe(true);
    const [u] = await db.select().from(users).where(eq(users.email, "new@isocodelabs.com"));
    expect(u).toMatchObject({ kind: "team" });
    expect(await prepareTeamPasswordSetup(db, "stranger@isocodelabs.com", "isocodelabs.com")).toBe(false);
    expect(await prepareTeamPasswordSetup(db, "new@gmail.com", "isocodelabs.com")).toBe(false);
  });
});
