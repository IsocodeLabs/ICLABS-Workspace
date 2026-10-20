import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, accounts, auditLog, rateLimits, sessions, users, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { LOCK_DURATION_MS, TEMP_PASSWORD_TTL_MS } from "@iclabs/core";
import { createAuth, type Auth } from "./create-auth";
import {
  changeCandidatePassword,
  createCandidateAccount,
  issueTempPassword,
  signInCandidate,
  type AuthNotifier,
} from "./candidate-auth";

let db: Db;
let close: () => Promise<void>;
let auth: Auth;
let clock: Date;
const notifier: AuthNotifier = {
  accountLocked: vi.fn(async () => {}),
  passwordChanged: vi.fn(async () => {}),
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth({
    db,
    secret: "test-secret-test-secret-test-secret-123",
    baseURL: "http://localhost:3000",
    teamDomain: "isocodelabs.com",
    sendResetPassword: async () => {},
  });
});
afterAll(() => close());
beforeEach(async () => {
  clock = new Date("2026-10-16T10:00:00Z");
  await db.delete(rateLimits);
  vi.clearAllMocks();
});

const deps = () => ({
  db,
  notifier,
  now: () => clock,
  createSession: async (email: string, password: string) => {
    await auth.api.signInEmail({ body: { email, password } });
  },
});
let ipCounter = 0;
const signIn = (email: string, password: string, ip = `10.0.0.${++ipCounter}`) =>
  signInCandidate(deps(), { email, password, ip });

async function newCandidate(email: string) {
  return createCandidateAccount(db, { email, name: "Test Candidate" }, clock);
}

describe("candidate accounts", () => {
  it("creates a login with a 72h temporary password and a forced change", async () => {
    const { userId, tempPassword } = await newCandidate("Riya@Example.com");
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    expect(user).toMatchObject({
      email: "riya@example.com",
      kind: "candidate",
      mustChangePassword: true,
    });
    expect(user!.tempPasswordExpiresAt!.getTime()).toBe(clock.getTime() + TEMP_PASSWORD_TTL_MS);
    expect(tempPassword).toMatch(/^[^-]{4}-[^-]{4}-[^-]{4}$/);
  });

  it("never stores or audits the temporary password in plain text", async () => {
    const { userId, tempPassword } = await newCandidate("plain@example.com");
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId));
    expect(account!.password).toMatch(/^\$argon2id\$/);
    expect(account!.password).not.toContain(tempPassword);
    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, userId));
    expect(JSON.stringify(logs)).not.toContain(tempPassword);
  });
});

describe("signInCandidate", () => {
  it("signs in with the temporary password and reports the forced change", async () => {
    const { tempPassword } = await newCandidate("first@example.com");
    expect(await signIn("FIRST@example.com", tempPassword)).toEqual({
      ok: true,
      mustChangePassword: true,
    });
  });

  it("gives the same generic error for a wrong password and an unknown email", async () => {
    await newCandidate("generic@example.com");
    expect(await signIn("generic@example.com", "wrong-password")).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await signIn("nobody@example.com", "wrong-password")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("locks the account for 15 minutes after 10 wrong passwords, even for the right one", async () => {
    const { tempPassword } = await newCandidate("lock@example.com");
    for (let i = 0; i < 9; i++) {
      expect((await signIn("lock@example.com", "nope-nope-nope")).ok).toBe(false);
    }
    const tenth = await signIn("lock@example.com", "nope-nope-nope");
    expect(tenth).toMatchObject({ ok: false, reason: "locked", retryAfterMs: LOCK_DURATION_MS });
    expect(notifier.accountLocked).toHaveBeenCalledWith("lock@example.com");
    expect(await signIn("lock@example.com", tempPassword)).toMatchObject({
      ok: false,
      reason: "locked",
    });

    clock = new Date(clock.getTime() + LOCK_DURATION_MS);
    expect((await signIn("lock@example.com", tempPassword)).ok).toBe(true);
  });

  it("refuses an expired temporary password even when it is correct", async () => {
    const { tempPassword } = await newCandidate("expired@example.com");
    clock = new Date(clock.getTime() + TEMP_PASSWORD_TTL_MS);
    expect(await signIn("expired@example.com", tempPassword)).toEqual({
      ok: false,
      reason: "temp_expired",
    });
  });

  it("invalidates the old temporary password when a new one is issued", async () => {
    const { userId, tempPassword } = await newCandidate("resend@example.com");
    const fresh = await issueTempPassword(db, userId, clock);
    expect((await signIn("resend@example.com", tempPassword)).ok).toBe(false);
    expect((await signIn("resend@example.com", fresh)).ok).toBe(true);
  });

  it("rate-limits repeated attempts from one IP for one email", async () => {
    await newCandidate("rl@example.com");
    for (let i = 0; i < 5; i++) await signIn("rl@example.com", "wrong-password", "1.2.3.4");
    expect(await signIn("rl@example.com", "wrong-password", "1.2.3.4")).toMatchObject({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("does not let team accounts sign in with a password", async () => {
    await db.insert(users).values({ email: "dev@isocodelabs.com", name: "Dev", kind: "team" });
    expect(await signIn("dev@isocodelabs.com", "anything-at-all")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("changeCandidatePassword", () => {
  const noBreach = vi.fn(async () => new Response("", { status: 200 }));

  async function signedInCandidate(email: string) {
    const created = await newCandidate(email);
    await signIn(email, created.tempPassword);
    await signIn(email, created.tempPassword); // a second device
    const userSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, created.userId));
    return { ...created, sessionId: userSessions[0]!.id };
  }

  const change = (input: Parameters<typeof changeCandidatePassword>[1]) =>
    changeCandidatePassword({ db, notifier, fetchFn: noBreach, now: () => clock }, input);

  it("rejects reusing the temporary password and too-short passwords", async () => {
    const c = await signedInCandidate("weak@example.com");
    const base = {
      userId: c.userId,
      currentSessionId: c.sessionId,
      currentPassword: c.tempPassword,
    };
    expect(await change({ ...base, newPassword: c.tempPassword })).toEqual({
      ok: false,
      reason: "same_as_previous",
    });
    expect(await change({ ...base, newPassword: "short" })).toEqual({
      ok: false,
      reason: "too_short",
    });
  });

  it("doesn't ask for the temporary password again on the first-login change", async () => {
    const c = await signedInCandidate("firstlogin@example.com");
    expect(
      await change({
        userId: c.userId,
        currentSessionId: c.sessionId,
        newPassword: "a brand new passphrase",
      }),
    ).toEqual({ ok: true });
    // A mistyped temporary password doesn't block it either.
    const d = await signedInCandidate("firstlogin2@example.com");
    expect(
      await change({
        userId: d.userId,
        currentSessionId: d.sessionId,
        currentPassword: "typo",
        newPassword: "a brand new passphrase",
      }),
    ).toEqual({ ok: true });
    // Still can't keep the temporary password, even without typing it.
    const e = await signedInCandidate("firstlogin3@example.com");
    expect(
      await change({
        userId: e.userId,
        currentSessionId: e.sessionId,
        newPassword: e.tempPassword,
      }),
    ).toEqual({ ok: false, reason: "same_as_previous" });
  });

  it("rejects a wrong current password on a later change", async () => {
    const c = await signedInCandidate("wrongcur@example.com");
    await db.update(users).set({ mustChangePassword: false }).where(eq(users.id, c.userId));
    expect(
      await change({
        userId: c.userId,
        currentSessionId: c.sessionId,
        currentPassword: "not-it-at-all",
        newPassword: "a brand new passphrase",
      }),
    ).toEqual({ ok: false, reason: "wrong_current" });
  });

  it("rejects a breached password", async () => {
    const c = await signedInCandidate("breach@example.com");
    const { createHash } = await import("node:crypto");
    const newPassword = "password1234567";
    const suffix = createHash("sha1").update(newPassword).digest("hex").toUpperCase().slice(5);
    const breached = vi.fn(async () => new Response(`${suffix}:999`, { status: 200 }));
    const result = await changeCandidatePassword(
      { db, notifier, fetchFn: breached, now: () => clock },
      {
        userId: c.userId,
        currentSessionId: c.sessionId,
        currentPassword: c.tempPassword,
        newPassword,
      },
    );
    expect(result).toEqual({ ok: false, reason: "breached" });
  });

  it("sets the new password, lifts the gate, ends other sessions and notifies", async () => {
    const c = await signedInCandidate("good@example.com");
    const newPassword = "my own strong passphrase";
    expect(
      await change({
        userId: c.userId,
        currentSessionId: c.sessionId,
        currentPassword: c.tempPassword,
        newPassword,
      }),
    ).toEqual({ ok: true });

    const [user] = await db.select().from(users).where(eq(users.id, c.userId));
    expect(user).toMatchObject({ mustChangePassword: false, tempPasswordExpiresAt: null });
    const remaining = await db.select().from(sessions).where(eq(sessions.userId, c.userId));
    expect(remaining.map((s) => s.id)).toEqual([c.sessionId]);
    expect(notifier.passwordChanged).toHaveBeenCalledWith("good@example.com");

    expect((await signIn("good@example.com", c.tempPassword)).ok).toBe(false);
    expect(await signIn("good@example.com", newPassword)).toEqual({
      ok: true,
      mustChangePassword: false,
    });
  });
});
