"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { appUrl, queueEmail } from "@/server/email";
import { requireTeam } from "@/server/auth/session";
import {
  inviteCandidates,
  parseInviteCsv,
  previewInvites,
  resendInvite,
  revokeApplication,
  type PreviewRow,
} from "@/server/candidates/invites";
import { resetEmailTemplate, saveEmailTemplate } from "@/server/candidates/detail";
import { progressionDeps } from "@/server/stages/deps";
import { startApplication } from "@/server/stages/progression";
import { fileStore } from "@/server/stages/deps";
import { eraseCandidateOnRequest } from "@/server/retention";
import { redirect } from "next/navigation";
import { reportServerError } from "@/server/errors/report";
import type { TemplateKey } from "@/server/email/templates";

export type PreviewLine = {
  line: number;
  name: string;
  email: string;
  role: string;
  kind: PreviewRow["status"]["kind"];
  reason?: string;
};

const toLines = (rows: PreviewRow[]): PreviewLine[] =>
  rows.map((p) => ({
    line: p.line,
    name: String(p.row?.name ?? ""),
    email: String(p.row?.email ?? ""),
    role: p.target?.roleTitle ?? String(p.row?.role ?? ""),
    kind: p.status.kind,
    reason: "reason" in p.status ? p.status.reason : undefined,
  }));

export async function previewCsvAction(
  csv: string,
): Promise<{ lines: PreviewLine[]; error?: string }> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = parseInviteCsv(csv);
  if (parsed.error) return { lines: [], error: parsed.error };
  try {
    return { lines: toLines(await previewInvites(db(), actor, parsed.rows)) };
  } catch {
    return { lines: [], error: "You can only invite to roles you manage." };
  }
}

/** Re-runs the preview on the server (never trusts the client's copy), then invites. */
export async function inviteCsvAction(csv: string, sendAt?: string) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = parseInviteCsv(csv);
  if (parsed.error) return { ok: false as const, error: parsed.error };
  const preview = await previewInvites(db(), actor, parsed.rows);
  const sendAfter = sendAt ? new Date(sendAt) : undefined;
  const result = await inviteCandidates(db(), actor, preview, {
    queueEmail,
    loginUrl: appUrl("/login"),
    sendAfter: sendAfter && sendAfter > new Date() ? sendAfter : undefined,
    onApplicationCreated: (id) => startApplication(db(), progressionDeps(), id),
  });
  revalidatePath("/team/candidates");
  return { ok: true as const, ...result };
}

const single = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
  role: z.string().min(1),
  track: z.string().optional(),
});

export async function singleInviteAction(_: unknown, form: FormData) {
  const parsed = single.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false as const, error: "Enter a name, email and role." };
  const csv = Papa_row(
    ["name", "email", "role", "track"],
    [parsed.data.name, parsed.data.email, parsed.data.role, parsed.data.track ?? ""],
  );
  const preview = await previewCsvAction(csv);
  const line = preview.lines[0];
  if (preview.error || !line)
    return { ok: false as const, error: preview.error ?? "Couldn't read that." };
  if (line.kind === "invalid" || line.kind === "duplicate")
    return { ok: false as const, error: line.reason ?? "Can't invite." };
  const result = await inviteCsvAction(csv);
  return result.ok
    ? {
        ok: true as const,
        message:
          line.kind === "new"
            ? "Invited. They'll get a welcome email with their login."
            : "Role added. They'll get an email.",
      }
    : result;
}

function Papa_row(headers: string[], values: string[]): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return `${headers.join(",")}\n${values.map(esc).join(",")}`;
}

export async function resendInviteAction(candidateId: string) {
  const { actor } = await requireTeam(["admin"]);
  await resendInvite(db(), actor, candidateId, { queueEmail, loginUrl: appUrl("/login") });
  revalidatePath(`/team/candidates/${candidateId}`);
}

export async function revokeApplicationAction(applicationId: string, candidateId: string) {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  await revokeApplication(db(), actor, applicationId);
  revalidatePath(`/team/candidates/${candidateId}`);
}

export async function saveEmailTemplateAction(key: TemplateKey, subject: string, body: string) {
  const { actor } = await requireTeam(["admin"]);
  const result = await saveEmailTemplate(db(), actor, { key, subject, body });
  revalidatePath("/team/settings/emails");
  return result;
}

export async function resetEmailTemplateAction(key: TemplateKey) {
  const { actor } = await requireTeam(["admin"]);
  await resetEmailTemplate(db(), actor, key);
  revalidatePath("/team/settings/emails");
}

/** Data-deletion request: erases the candidate and everything about them. Admins only. */
export async function eraseCandidateAction(
  candidateId: string,
): Promise<{ ok: false; error: string } | undefined> {
  const { actor } = await requireTeam(["admin"]);
  try {
    await eraseCandidateOnRequest(db(), fileStore(), actor, candidateId);
  } catch (err) {
    const shown =
      "Couldn't delete this candidate just now. Try again in a minute. We've been notified.";
    await reportServerError("erase", err, shown, `/team/candidates/${candidateId}`);
    return { ok: false, error: shown };
  }
  revalidatePath("/team/candidates");
  redirect("/team/candidates");
}
