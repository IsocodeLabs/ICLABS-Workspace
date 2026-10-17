import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, lt, accounts, teamMembers, users, verifications, type Db } from "@iclabs/db";
import { isLocked, registerFailure, registerSuccess } from "@iclabs/core";
import { audit } from "../audit";
import { LOGIN_RATE_LIMITS, hitRateLimit, type AuthNotifier } from "./candidate-auth";
import { burnVerifyTime, verifyPassword } from "./password-hash";

/**
 * Team sign-in with email + password, then a 6-digit code emailed to that address.
 * The password step never creates a session: it opens a short-lived challenge, and only a
 * correct code (see the team-otp Better Auth plugin) does. Google sign-in stays as an option.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_CODE_ATTEMPTS = 5;

const normalize = (email: string) => email.trim().toLowerCase();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const identifierFor = (challenge: string) => `team-otp:${sha256(challenge)}`;
const codeHash = (challenge: string, code: string) => sha256(`${challenge}:${code}`);

type Challenge = { userId: string; codeHash: string; attempts: number };

/** Active team member on the allow-list, with an address on the team domain. */
async function activeMember(db: Db, email: string, teamDomain: string) {
  if (!email.endsWith(`@${teamDomain.toLowerCase()}`)) return null;
  const [m] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.email, email), eq(teamMembers.active, true)));
  return m ?? null;
}

export type TeamSignInResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: "invalid" | "locked" | "rate_limited"; retryAfterMs?: number };

export type TeamSignInDeps = {
  db: Db;
  teamDomain: string;
  notifier: AuthNotifier;
  /** Emails the code. The code never goes anywhere else (not logs, not the database). */
  sendCode: (input: { email: string; userId: string; code: string }) => Promise<void>;
  now?: () => Date;
};

/** Step 1: rate limit → allow-list → lockout → password. Generic errors except lockout. */
export async function startTeamSignIn(
  deps: TeamSignInDeps,
  input: { email: string; password: string; ip: string },
): Promise<TeamSignInResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const email = normalize(input.email);

  for (const [key, rule] of [
    [`team-login:ip-email:${input.ip}:${email}`, LOGIN_RATE_LIMITS.ipEmail],
    [`team-login:ip:${input.ip}`, LOGIN_RATE_LIMITS.ip],
  ] as const) {
    const limit = await hitRateLimit(db, key, rule, now);
    if (!limit.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const [user] = await db
    .select({
      id: users.id,
      kind: users.kind,
      status: users.status,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      passwordHash: accounts.password,
    })
    .from(users)
    .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.providerId, "credential")))
    .where(eq(users.email, email));
  const member = await activeMember(db, email, deps.teamDomain);
  if (!user || !member || user.kind !== "team" || user.status !== "active" || !user.passwordHash) {
    await burnVerifyTime(input.password);
    return { ok: false, reason: "invalid" };
  }

  const state = { failedCount: user.failedLoginCount, lockedUntil: user.lockedUntil };
  if (isLocked(state, now))
    return { ok: false, reason: "locked", retryAfterMs: state.lockedUntil!.getTime() - now.getTime() };

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const { state: next, justLocked } = registerFailure(state, now);
    await db
      .update(users)
      .set({ failedLoginCount: next.failedCount, lockedUntil: next.lockedUntil })
      .where(eq(users.id, user.id));
    if (justLocked) {
      await audit(db, { actorUserId: null, action: "account_locked", entity: "user", entityId: user.id });
      await deps.notifier.accountLocked(email);
      return { ok: false, reason: "locked", retryAfterMs: next.lockedUntil!.getTime() - now.getTime() };
    }
    return { ok: false, reason: "invalid" };
  }

  const reset = registerSuccess();
  await db
    .update(users)
    .set({ failedLoginCount: reset.failedCount, lockedUntil: reset.lockedUntil })
    .where(eq(users.id, user.id));

  const challenge = randomBytes(32).toString("base64url");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Old, expired challenges are cleared as new ones are made.
  await db.delete(verifications).where(lt(verifications.expiresAt, now));
  await db.insert(verifications).values({
    identifier: identifierFor(challenge),
    value: JSON.stringify({ userId: user.id, codeHash: codeHash(challenge, code), attempts: 0 } satisfies Challenge),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  await deps.sendCode({ email, userId: user.id, code });
  return { ok: true, challenge };
}

export type VerifyCodeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid"; attemptsLeft: number }
  | { ok: false; reason: "expired" };

/** Step 2: check the code. Five wrong tries (or 10 minutes) end the challenge. */
export async function verifyTeamCode(
  db: Db,
  input: { challenge: string; code: string },
  now = new Date(),
): Promise<VerifyCodeResult> {
  const identifier = identifierFor(input.challenge);
  const [row] = await db.select().from(verifications).where(eq(verifications.identifier, identifier));
  if (!row || row.expiresAt < now) {
    if (row) await db.delete(verifications).where(eq(verifications.id, row.id));
    return { ok: false, reason: "expired" };
  }
  const data = JSON.parse(row.value) as Challenge;
  const given = codeHash(input.challenge, input.code.replace(/\s+/g, ""));
  const match = given.length === data.codeHash.length && timingSafeEqual(Buffer.from(given), Buffer.from(data.codeHash));
  if (!match) {
    const attempts = data.attempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) {
      await db.delete(verifications).where(eq(verifications.id, row.id));
      return { ok: false, reason: "expired" };
    }
    await db
      .update(verifications)
      .set({ value: JSON.stringify({ ...data, attempts }) })
      .where(eq(verifications.id, row.id));
    return { ok: false, reason: "invalid", attemptsLeft: MAX_CODE_ATTEMPTS - attempts };
  }
  // Single use.
  await db.delete(verifications).where(eq(verifications.id, row.id));
  return { ok: true, userId: data.userId };
}

/**
 * "Set or reset my password": for an active team member, make sure a team user exists so the
 * emailed reset link can create their password. Returns false for anyone else (the page shows
 * the same message either way, so it can't be used to discover who's on the team).
 */
export async function prepareTeamPasswordSetup(db: Db, rawEmail: string, teamDomain: string) {
  const email = normalize(rawEmail);
  if (!(await activeMember(db, email, teamDomain))) return false;
  const [existing] = await db.select({ id: users.id, kind: users.kind }).from(users).where(eq(users.email, email));
  if (existing) return existing.kind === "team";
  await db
    .insert(users)
    .values({ email, name: email.split("@")[0]!, kind: "team", emailVerified: true })
    .onConflictDoNothing();
  return true;
}
