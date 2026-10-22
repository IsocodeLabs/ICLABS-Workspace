"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkPwnedPassword, validateNewPassword } from "@iclabs/core";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { auth, notifier } from "@/server/auth";
import { changeCandidatePassword } from "@/server/auth/candidate-auth";
import { prepareTeamPasswordSetup, startTeamSignIn, CODE_TTL_MS } from "@/server/auth/team-auth";
import { requireTeam } from "@/server/auth/session";
import { appUrl, queueEmail } from "@/server/email";
import { clientIp } from "@/server/request";

export type TeamFormState =
  { error?: string; retryMinutes?: number; attemptsLeft?: number; done?: boolean } | undefined;

/** The challenge rides in an httpOnly cookie scoped to the login pages, never in the URL. */
const CHALLENGE_COOKIE = "team_otp";

type VerifyResponse =
  | { ok: true }
  | { ok: false; reason: "invalid"; attemptsLeft: number }
  | { ok: false; reason: "expired" };

async function verifyCode(challenge: string, code: string): Promise<VerifyResponse> {
  const api = auth().api as unknown as {
    verifyTeamOtp: (input: {
      body: { challenge: string; code: string };
      headers: Headers;
    }) => Promise<VerifyResponse>;
  };
  return api.verifyTeamOtp({ body: { challenge, code }, headers: await headers() });
}

const signInSchema = z.object({ email: z.email().max(254), password: z.string().min(1).max(256) });

/** Step 1: email + password. With codes on, emails a code and moves to the code page. */
export async function teamSignInAction(
  _prev: TeamFormState,
  form: FormData,
): Promise<TeamFormState> {
  const parsed = signInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };
  const e = env();
  let issuedCode = "";
  const result = await startTeamSignIn(
    {
      db: db(),
      teamDomain: e.TEAM_EMAIL_DOMAIN,
      notifier,
      sendCode: async ({ email, userId, code }) => {
        issuedCode = code;
        if (!e.TEAM_LOGIN_OTP) return;
        await queueEmail({
          to: email,
          templateKey: "login_code",
          userId,
          vars: { first_name: email.split("@")[0]! },
          secrets: { code },
        });
      },
    },
    { ...parsed.data, ip: await clientIp() },
  );
  if (!result.ok) {
    return {
      error: result.reason,
      retryMinutes: result.retryAfterMs ? Math.ceil(result.retryAfterMs / 60_000) : undefined,
    };
  }
  if (!e.TEAM_LOGIN_OTP) {
    // Codes switched off (no email sender yet): complete the same single-use challenge here.
    const res = await verifyCode(result.challenge, issuedCode);
    if (!res.ok) return { error: "invalid" };
    redirect("/team");
  }
  (await cookies()).set(CHALLENGE_COOKIE, result.challenge, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/team/login",
    maxAge: CODE_TTL_MS / 1000,
  });
  redirect("/team/login/verify");
}

/** Step 2: the emailed code. */
export async function verifyCodeAction(
  _prev: TeamFormState,
  form: FormData,
): Promise<TeamFormState> {
  const jar = await cookies();
  const challenge = jar.get(CHALLENGE_COOKIE)?.value;
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  if (!challenge) return { error: "expired" };
  if (code.length !== 6) return { error: "invalid" };
  const res = await verifyCode(challenge, code);
  if (!res.ok) {
    if (res.reason === "expired") jar.delete({ name: CHALLENGE_COOKIE, path: "/team/login" });
    return res.reason === "invalid"
      ? { error: "invalid", attemptsLeft: res.attemptsLeft }
      : { error: "expired" };
  }
  jar.delete({ name: CHALLENGE_COOKIE, path: "/team/login" });
  redirect("/team");
}

/** "Set or reset my password": same answer whoever asks, so it can't reveal the team list. */
export async function requestSetPasswordAction(
  _prev: TeamFormState,
  form: FormData,
): Promise<TeamFormState> {
  const email = z.email().max(254).safeParse(form.get("email"));
  if (!email.success) return { error: "invalid" };
  const e = env();
  if (await prepareTeamPasswordSetup(db(), email.data, e.TEAM_EMAIL_DOMAIN)) {
    await auth().api.requestPasswordReset({
      body: { email: email.data.toLowerCase(), redirectTo: appUrl("/team/set-password/new") },
      headers: await headers(),
    });
  }
  return { done: true };
}

const newPasswordSchema = z
  .object({
    token: z.string().min(10).max(200),
    newPassword: z.string().max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "mismatch" });

/** Opened from the emailed link: choose a password (policy + breached-password check). */
export async function setNewPasswordAction(
  _prev: TeamFormState,
  form: FormData,
): Promise<TeamFormState> {
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "mismatch" };
  const issues = validateNewPassword(parsed.data.newPassword);
  if (issues.length) return { error: issues[0] };
  if ((await checkPwnedPassword(parsed.data.newPassword)).pwned) return { error: "breached" };
  try {
    await auth().api.resetPassword({
      body: { token: parsed.data.token, newPassword: parsed.data.newPassword },
      headers: await headers(),
    });
  } catch {
    return { error: "link" };
  }
  return { done: true };
}

const changeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "mismatch" });

/** Signed-in team member changes their own password (optional, any time). */
export async function changeTeamPasswordAction(
  _prev: TeamFormState,
  form: FormData,
): Promise<TeamFormState> {
  const { session } = await requireTeam();
  const parsed = changeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "mismatch" };
  const res = await changeCandidatePassword(
    { db: db(), notifier },
    {
      userId: session.user.id,
      currentSessionId: session.session.id,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
    },
  );
  return res.ok ? { done: true } : { error: res.reason };
}
