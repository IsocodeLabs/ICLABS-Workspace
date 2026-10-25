"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatIst } from "@iclabs/core";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { setStepDeadline, stepDeadlineRows } from "@/server/candidates/deadlines";

/** `datetime-local` values, read as India time. */
const istLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00+05:30`));

const step = z.object({
  workflowId: z.string().min(1).max(40),
  nodeId: z.string().min(1).max(64),
});
const input = step.extend({ dueAt: istLocal, closesAt: istLocal });

export type DeadlinePreview = {
  rows: {
    name: string;
    email: string;
    state: string;
    due: string;
    closes: string;
    extended: boolean;
  }[];
  distinctDates: number;
};

const show = (d: Date | null) => (d ? formatIst(d) : "No deadline");

/** Everyone at the step and the dates they have now. */
export async function previewStepDeadlineAction(raw: unknown): Promise<DeadlinePreview | null> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = step.safeParse(raw);
  if (!parsed.success) return null;
  const rows = await stepDeadlineRows(db(), actor, parsed.data);
  return {
    rows: rows.map((r) => ({
      name: r.name,
      email: r.email,
      state: r.state,
      due: show(r.dueAt),
      closes: show(r.closesAt),
      extended: r.extended,
    })),
    distinctDates: new Set(rows.map((r) => `${r.dueAt?.getTime()}|${r.closesAt?.getTime()}`)).size,
  };
}

/** Applies only if the list is still the one the admin reviewed. */
export async function setStepDeadlineAction(
  raw: unknown,
  reviewedCount: number,
): Promise<{ ok: true; updated: number; reopened: number } | { ok: false; error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Pick a track, a step and both dates." };
  const current = await stepDeadlineRows(db(), actor, parsed.data);
  if (current.length !== reviewedCount)
    return {
      ok: false,
      error: `The list changed: ${current.length} people now, you reviewed ${reviewedCount}. Preview again.`,
    };
  const res = await setStepDeadline(db(), actor, parsed.data);
  revalidatePath("/team/candidates");
  return res;
}
