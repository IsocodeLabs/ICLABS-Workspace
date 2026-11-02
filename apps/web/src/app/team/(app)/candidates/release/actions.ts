"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { appUrl } from "@/server/email";
import { requireTeam } from "@/server/auth/session";
import { progressionDeps } from "@/server/stages/deps";
import { releaseTask, taskReleaseAudience } from "@/server/candidates/release-task";
import { listEmailTemplates } from "@/server/candidates/detail";
import { renderEmail } from "@/server/email/templates";

const input = z.object({ workflowId: z.string().min(1).max(40) });

export type ReleasePreview = {
  subject: string;
  text: string;
  people: { name: string; email: string; roleTitle: string }[];
};

/** Who would see the task and the email they'd get, exactly. Nothing changes. */
export async function previewReleaseAction(raw: unknown): Promise<ReleasePreview | null> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return null;
  const people = await taskReleaseAudience(db(), actor, parsed.data.workflowId);
  const template = (await listEmailTemplates(db(), actor)).find((t) => t.key === "task_released")!;
  const sample = people[0];
  const rendered = renderEmail(template, {
    first_name: sample?.name.trim().split(/\s+/)[0] ?? "Candidate",
    role: sample?.roleTitle ?? "the role",
    deadline: "the date seven days after you release",
    stage_url: appUrl("/dashboard"),
  });
  return {
    subject: rendered.subject,
    text: rendered.text,
    people: people.map((p) => ({ name: p.name, email: p.email, roleTitle: p.roleTitle })),
  };
}

/** Releases only if the number of people still matches what the admin reviewed. */
export async function releaseTaskAction(
  raw: unknown,
  reviewedCount: number,
): Promise<{ ok: true; released: number } | { ok: false; error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a track." };
  const now = await taskReleaseAudience(db(), actor, parsed.data.workflowId);
  if (now.length !== reviewedCount)
    return {
      ok: false,
      error: `The list changed: ${now.length} people now, you reviewed ${reviewedCount}. Preview again.`,
    };
  const res = await releaseTask(db(), progressionDeps(), actor, parsed.data);
  revalidatePath("/team/candidates");
  return { ok: true, released: res.released };
}
