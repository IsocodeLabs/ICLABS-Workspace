"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { appUrl, queueEmail } from "@/server/email";
import { requireTeam } from "@/server/auth/session";
import {
  ANNOUNCEMENTS,
  announcementRecipients,
  sendAnnouncement,
  type AnnouncementKey,
} from "@/server/candidates/announce";
import { listEmailTemplates } from "@/server/candidates/detail";
import { renderEmail } from "@/server/email/templates";

const input = z.object({
  workflowId: z.string().min(1).max(40),
  nodeId: z.string().min(1).max(64),
  key: z.enum(Object.keys(ANNOUNCEMENTS) as [AnnouncementKey, ...AnnouncementKey[]]),
});

export type AnnouncementPreview = {
  subject: string;
  text: string;
  recipients: { name: string; email: string; roleTitle: string; alreadySent: boolean }[];
  toSend: number;
  skipped: number;
};

/** What would go out, exactly: the email as the first person would read it, and the full list. */
export async function previewAnnouncementAction(raw: unknown): Promise<AnnouncementPreview | null> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const recipients = await announcementRecipients(db(), actor, parsed.data);
  const template = (await listEmailTemplates(db(), actor)).find((t) => t.key === parsed.data.key)!;
  const sample = recipients[0];
  const rendered = renderEmail(template, {
    first_name: sample?.name.trim().split(/\s+/)[0] ?? "Candidate",
    role: sample?.roleTitle ?? "the role",
    stage: sample?.stageTitle ?? "the step",
    stage_url: appUrl("/dashboard"),
  });
  return {
    subject: rendered.subject,
    text: rendered.text,
    recipients: recipients.map((r) => ({
      name: r.name,
      email: r.email,
      roleTitle: r.roleTitle,
      alreadySent: r.alreadySent,
    })),
    toSend: recipients.filter((r) => !r.alreadySent).length,
    skipped: recipients.filter((r) => r.alreadySent).length,
  };
}

/**
 * Sends only if the number of people still matches what the admin reviewed, so the list can't
 * quietly change between "looks good" and "send".
 */
export async function sendAnnouncementAction(
  raw: unknown,
  reviewedCount: number,
): Promise<{ ok: true; sent: number; skipped: number } | { ok: false; error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a track, step and email." };
  const now = (await announcementRecipients(db(), actor, parsed.data)).filter(
    (r) => !r.alreadySent,
  );
  if (now.length !== reviewedCount)
    return {
      ok: false,
      error: `The list changed: ${now.length} people now, you reviewed ${reviewedCount}. Preview again.`,
    };
  const res = await sendAnnouncement(db(), { queueEmail, appUrl }, actor, parsed.data);
  revalidatePath("/team/candidates");
  return { ok: true, ...res };
}
