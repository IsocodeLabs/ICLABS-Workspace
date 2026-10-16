"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { markAllRead, recordConsent, updateProfile } from "@/server/portal";

export async function acceptConsentAction(form: FormData): Promise<void> {
  const { actor } = await requireCandidate({ consentPage: true });
  if (form.get("consent") !== "on") redirect("/welcome?error=consent");
  await recordConsent(db(), actor);
  redirect("/dashboard");
}

export async function updateProfileAction(
  _: { ok: boolean; error?: string } | undefined,
  form: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const { actor } = await requireCandidate();
  const result = await updateProfile(db(), actor, Object.fromEntries(form));
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function markNotificationsReadAction(): Promise<void> {
  const { session } = await requireCandidate();
  await markAllRead(db(), session.user.id);
  revalidatePath("/", "layout");
}
