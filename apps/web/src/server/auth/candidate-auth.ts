import {
  and,
  eq,
  ne,
  sql,
  accounts,
  candidates,
  rateLimits,
  sessions,
  users,
  type Db,
} from "@iclabs/db";
import {
  checkPwnedPassword,
  consumeRateLimit,
  generateTempPassword,
  isLocked,
  isTempPasswordExpired,
  registerFailure,
  registerSuccess,
  tempPasswordExpiry,
  validateNewPassword,
  type PasswordIssue,
  type RateLimitRule,
} from "@iclabs/core";
import { audit as writeAudit } from "../audit";
import { burnVerifyTime, hashPassword, verifyPassword } from "./password-hash";

/** Side effects that M3 wires to email. They never receive the password itself. */
export type AuthNotifier = {
  accountLocked(email: string): Promise<void>;
  passwordChanged(email: string): Promise<void>;
};

export const LOGIN_RATE_LIMITS: Record<"ipEmail" | "ip", RateLimitRule> = {
  ipEmail: { limit: 5, windowMs: 60_000 },
  ip: { limit: 30, windowMs: 60_000 },
};

const normalize = (email: string) => email.trim().toLowerCase();

// ─── Accounts & temporary passwords ──────────────────────────────────────────

/**
 * Creates a candidate login (email = login ID) with a fresh temporary password.
 * Returns the plaintext password for the welcome email only: it is never stored or logged.
 */
export async function createCandidateAccount(
  db: Db,
  input: { email: string; name: string },
  now = new Date(),
): Promise<{ userId: string; candidateId: string; tempPassword: string }> {
  const email = normalize(input.email);
  const [user] = await db
    .insert(users)
    .values({ email, name: input.name, kind: "candidate", emailVerified: false })
    .returning({ id: users.id });
  const [candidate] = await db
    .insert(candidates)
    .values({ userId: user!.id, name: input.name })
    .returning({ id: candidates.id });
  const tempPassword = await issueTempPassword(db, user!.id, now);
  return { userId: user!.id, candidateId: candidate!.id, tempPassword };
}

/**
 * Sets (or replaces) the temporary password: 72-hour expiry, forced change on first login,
 * lock cleared, every existing session ended. Used by invites and "Resend invite".
 */
export async function issueTempPassword(db: Db, userId: string, now = new Date()): Promise<string> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));
  if (existing) {
    await db.update(accounts).set({ password: passwordHash }).where(eq(accounts.id, existing.id));
  } else {
    await db
      .insert(accounts)
      .values({ userId, accountId: userId, providerId: "credential", password: passwordHash });
  }
  await db
    .update(users)
    .set({
      mustChangePassword: true,
      tempPasswordExpiresAt: tempPasswordExpiry(now),
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await audit(db, { actorUserId: null, action: "temp_password_issued", entityId: userId });
  return tempPassword;
}

// ─── Sign-in ─────────────────────────────────────────────────────────────────

export type SignInResult =
  | { ok: true; mustChangePassword: boolean }
  | {
      ok: false;
      reason: "invalid" | "locked" | "temp_expired" | "rate_limited";
      retryAfterMs?: number;
    };

export type SignInDeps = {
  db: Db;
  /** Creates the session (Better Auth `signInEmail`). Throws on bad credentials. */
  createSession: (email: string, password: string) => Promise<void>;
  notifier: AuthNotifier;
  now?: () => Date;
};

/**
 * What to try for a temporary password typed or pasted from the invite email, most likely
 * first: as typed; cleaned (spaces, line breaks and zero-width characters removed, look-alike
 * dashes turned into "-", dashes added back to a bare 12 characters); then with the first
 * letter's case flipped (phones capitalise it). At most three distinct tries.
 */
export function tempPasswordAttempts(raw: string): string[] {
  let cleaned = raw
    .normalize("NFKC")
    .replace(/[\s​-‍⁠﻿]/g, "")
    .replace(/[‐-―−﹘﹣－]/g, "-");
  if (/^[A-Za-z0-9]{12}$/.test(cleaned)) cleaned = cleaned.match(/.{4}/g)!.join("-");
  const first = cleaned.charAt(0);
  const flipped =
    first.toUpperCase() !== first.toLowerCase()
      ? (first === first.toUpperCase() ? first.toLowerCase() : first.toUpperCase()) +
        cleaned.slice(1)
      : cleaned;
  return [...new Set([raw, cleaned, flipped])].filter(Boolean);
}

/**
 * Candidate sign-in. Order matters: rate limit → account checks → password. Every failure
 * returns a generic reason except lock and expiry, which the candidate needs to act on.
 */
export async function signInCandidate(
  deps: SignInDeps,
  input: { email: string; password: string; ip: string },
): Promise<SignInResult> {
  const { db, notifier } = deps;
  const now = deps.now?.() ?? new Date();
  const email = normalize(input.email);

  for (const [key, rule] of [
    [`login:ip-email:${input.ip}:${email}`, LOGIN_RATE_LIMITS.ipEmail],
    [`login:ip:${input.ip}`, LOGIN_RATE_LIMITS.ip],
  ] as const) {
    const limit = await hitRateLimit(db, key, rule, now);
    if (!limit.allowed)
      return { ok: false, reason: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const [user] = await db
    .select({
      id: users.id,
      kind: users.kind,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      tempPasswordExpiresAt: users.tempPasswordExpiresAt,
      failedLoginCount: users.failedLoginCount,
      lockedUntil: users.lockedUntil,
      passwordHash: accounts.password,
    })
    .from(users)
    .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.providerId, "credential")))
    .where(eq(users.email, email));

  if (!user || user.kind !== "candidate" || user.status !== "active" || !user.passwordHash) {
    await burnVerifyTime(input.password);
    return { ok: false, reason: "invalid" };
  }

  const loginState = { failedCount: user.failedLoginCount, lockedUntil: user.lockedUntil };
  if (isLocked(loginState, now)) {
    return {
      ok: false,
      reason: "locked",
      retryAfterMs: loginState.lockedUntil!.getTime() - now.getTime(),
    };
  }

  // A temporary password is copied out of an email, so forgive the usual copy/typing slips
  // (spaces, line breaks, look-alike dashes, missing dashes, a phone capitalising the first
  // letter). A password the candidate chose themselves must match exactly.
  let matched: string | null = null;
  for (const attempt of user.mustChangePassword
    ? tempPasswordAttempts(input.password)
    : [input.password]) {
    if (await verifyPassword(user.passwordHash, attempt)) {
      matched = attempt;
      break;
    }
  }
  if (matched === null) {
    const { state, justLocked } = registerFailure(loginState, now);
    await db
      .update(users)
      .set({ failedLoginCount: state.failedCount, lockedUntil: state.lockedUntil })
      .where(eq(users.id, user.id));
    if (justLocked) {
      await audit(db, { actorUserId: null, action: "account_locked", entityId: user.id });
      await notifier.accountLocked(email);
      return {
        ok: false,
        reason: "locked",
        retryAfterMs: state.lockedUntil!.getTime() - now.getTime(),
      };
    }
    return { ok: false, reason: "invalid" };
  }

  // Correct password, but the temporary one has run out: the candidate needs a new invite.
  if (user.mustChangePassword && isTempPasswordExpired(user.tempPasswordExpiresAt, now)) {
    return { ok: false, reason: "temp_expired" };
  }

  await deps.createSession(email, matched);
  const reset = registerSuccess();
  await db
    .update(users)
    .set({ failedLoginCount: reset.failedCount, lockedUntil: reset.lockedUntil })
    .where(eq(users.id, user.id));
  return { ok: true, mustChangePassword: user.mustChangePassword };
}

// ─── "Login expired?" ────────────────────────────────────────────────────────

/** Per address and per network: enough for a candidate who clicks twice, not for a script. */
export const FRESH_LOGIN_RATE_LIMITS: Record<"email" | "ip", RateLimitRule> = {
  email: { limit: 3, windowMs: 60 * 60_000 },
  ip: { limit: 20, windowMs: 60 * 60_000 },
};

export type FreshCredentialsResult =
  { ok: true } | { ok: false; reason: "rate_limited"; retryAfterMs: number };

/**
 * The login page's "Login expired? Get fresh credentials here". A new temporary password goes
 * to the account's own inbox (never to the screen), and only for a candidate who hasn't set
 * their own password yet; team accounts and everyone else get nothing. The answer is the same
 * either way, so the button can't be used to find out which emails have accounts.
 */
export async function requestFreshCredentials(
  deps: {
    db: Db;
    /** Emails the new temporary password to the account; the only place it goes. */
    sendCredentials: (
      user: { userId: string; email: string },
      tempPassword: string,
    ) => Promise<void>;
    now?: () => Date;
  },
  input: { email: string; ip: string },
): Promise<FreshCredentialsResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const email = normalize(input.email);

  for (const [key, rule] of [
    [`fresh-login:email:${email}`, FRESH_LOGIN_RATE_LIMITS.email],
    [`fresh-login:ip:${input.ip}`, FRESH_LOGIN_RATE_LIMITS.ip],
  ] as const) {
    const limit = await hitRateLimit(db, key, rule, now);
    if (!limit.allowed)
      return { ok: false, reason: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  const [user] = await db
    .select({
      id: users.id,
      kind: users.kind,
      status: users.status,
      mustChangePassword: users.mustChangePassword,
      candidateId: candidates.id,
    })
    .from(users)
    .leftJoin(candidates, eq(candidates.userId, users.id))
    .where(eq(users.email, email));

  if (
    !user ||
    user.kind !== "candidate" ||
    user.status !== "active" ||
    !user.candidateId ||
    !user.mustChangePassword
  ) {
    // Takes about as long as issuing one, so timing doesn't tell either.
    await burnVerifyTime(email);
    return { ok: true };
  }

  const tempPassword = await issueTempPassword(db, user.id, now);
  await deps.sendCredentials({ userId: user.id, email }, tempPassword);
  await audit(db, { actorUserId: null, action: "fresh_credentials_sent", entityId: user.id });
  return { ok: true };
}

// ─── Password change ─────────────────────────────────────────────────────────

export type ChangePasswordResult =
  { ok: true } | { ok: false; reason: "wrong_current" | "breached" | PasswordIssue };

/**
 * Changes a candidate's password (the forced first-login change, or later from the profile).
 * On the forced first-login change the temporary password isn't asked for again: they just
 * signed in with it, and re-typing it was where people got stuck. Later changes still need the
 * current password. Ends every other session and lifts the first-login gate.
 */
export async function changeCandidatePassword(
  deps: { db: Db; notifier: AuthNotifier; fetchFn?: typeof fetch; now?: () => Date },
  input: {
    userId: string;
    currentSessionId: string;
    currentPassword?: string;
    newPassword: string;
  },
): Promise<ChangePasswordResult> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();

  const [row] = await db
    .select({
      email: users.email,
      accountId: accounts.id,
      passwordHash: accounts.password,
      firstLogin: users.mustChangePassword,
    })
    .from(users)
    .innerJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.providerId, "credential")))
    .where(eq(users.id, input.userId));
  if (!row?.passwordHash) return { ok: false, reason: "wrong_current" };
  if (!row.firstLogin) {
    if (!input.currentPassword || !(await verifyPassword(row.passwordHash, input.currentPassword)))
      return { ok: false, reason: "wrong_current" };
  }

  const issues = validateNewPassword(input.newPassword, { previous: input.currentPassword });
  if (issues.length > 0) return { ok: false, reason: issues[0]! };
  if (row.firstLogin && (await verifyPassword(row.passwordHash, input.newPassword)))
    return { ok: false, reason: "same_as_previous" };

  const pwned = await checkPwnedPassword(input.newPassword, deps.fetchFn);
  if (pwned.pwned) return { ok: false, reason: "breached" };

  await db
    .update(accounts)
    .set({ password: await hashPassword(input.newPassword) })
    .where(eq(accounts.id, row.accountId));
  await db
    .update(users)
    .set({ mustChangePassword: false, tempPasswordExpiresAt: null, passwordChangedAt: now })
    .where(eq(users.id, input.userId));
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, input.userId), ne(sessions.id, input.currentSessionId)));
  await audit(db, {
    actorUserId: input.userId,
    action: "password_changed",
    entityId: input.userId,
  });
  await deps.notifier.passwordChanged(row.email);
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function hitRateLimit(db: Db, key: string, rule: RateLimitRule, now: Date) {
  const [current] = await db.select().from(rateLimits).where(eq(rateLimits.key, key));
  const result = consumeRateLimit(current ?? null, now, rule);
  await db
    .insert(rateLimits)
    .values({ key, ...result.bucket })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: { count: sql`excluded.count`, windowStart: sql`excluded.window_start` },
    });
  return result;
}

function audit(db: Db, entry: { actorUserId: string | null; action: string; entityId: string }) {
  return writeAudit(db, { ...entry, entity: "user" });
}
