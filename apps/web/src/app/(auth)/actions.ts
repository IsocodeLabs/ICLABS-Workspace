"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { auth, notifier } from "@/server/auth";
import {
  changeCandidatePassword,
  requestFreshCredentials,
  signInCandidate,
} from "@/server/auth/candidate-auth";
import { sendFreshCredentials } from "@/server/candidates/invites";
import { appUrl, queueEmail } from "@/server/email";
import { requireCandidate } from "@/server/auth/session";
import { clientIp } from "@/server/request";
import { redirectIfMaintenance } from "@/server/maintenance";

export type FormState = { error?: string; retryMinutes?: number } | undefined;

const signInSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
});

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  await redirectIfMaintenance();
  const parsed = signInSchema.safeParse({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (!parsed.success) return { error: "invalid" };

  const requestHeaders = await headers();
  const result = await signInCandidate(
    {
      db: db(),
      notifier,
      createSession: async (email, password) => {
        await auth().api.signInEmail({ body: { email, password }, headers: requestHeaders });
      },
    },
    { ...parsed.data, ip: await clientIp() },
  );

  if (!result.ok) {
    const retryMinutes = result.retryAfterMs ? Math.ceil(result.retryAfterMs / 60_000) : undefined;
    return { error: result.reason, retryMinutes };
  }
  redirect(result.mustChangePassword ? "/change-password" : "/");
}

export type FreshState = {
  sent?: boolean;
  error?: "invalid" | "rate_limited";
  retryMinutes?: number;
};

/** "Login expired? Get fresh credentials here": the new password goes by email only. */
export async function freshCredentialsAction(
  _prev: FreshState | undefined,
  form: FormData,
): Promise<FreshState> {
  await redirectIfMaintenance();
  const parsed = z
    .email()
    .max(254)
    .safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { error: "invalid" };
  const result = await requestFreshCredentials(
    {
      db: db(),
      sendCredentials: (user, tempPassword) =>
        sendFreshCredentials(db(), user, tempPassword, { queueEmail, loginUrl: appUrl("/login") }),
    },
    { email: parsed.data, ip: await clientIp() },
  );
  if (!result.ok)
    return { error: "rate_limited", retryMinutes: Math.ceil(result.retryAfterMs / 60_000) };
  return { sent: true };
}

const changeSchema = z
  .object({
    currentPassword: z.string().max(256).optional(),
    newPassword: z.string().max(256),
    confirmPassword: z.string().max(256),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "mismatch" });

export async function changePasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { session } = await requireCandidate({ passwordChangePage: true });
  const parsed = changeSchema.safeParse({
    currentPassword: form.get("currentPassword") ?? undefined,
    newPassword: form.get("newPassword"),
    confirmPassword: form.get("confirmPassword"),
  });
  if (!parsed.success) return { error: "mismatch" };

  const result = await changeCandidatePassword(
    { db: db(), notifier },
    {
      userId: session.user.id,
      currentSessionId: session.session.id,
      currentPassword: parsed.data.currentPassword || undefined,
      newPassword: parsed.data.newPassword,
    },
  );
  if (!result.ok) return { error: result.reason };
  redirect("/welcome");
}

export async function signOutAction(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  redirect("/login");
}
