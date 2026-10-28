"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatIst } from "@iclabs/core";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { applyFinalExtension, finalExtensionPlan } from "@/server/candidates/final-extension";

/** `datetime-local` values, read as India time. */
const istLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  .transform((v) => new Date(`${v}:00+05:30`));

const input = z.object({
  until: istLocal,
  steps: z
    .array(
      z.object({
        workflowId: z.string().min(1).max(40),
        nodeIds: z.array(z.string().min(1).max(64)).max(30),
      }),
    )
    .max(20),
});

export type ExtensionPreview = {
  until: string;
  rows: {
    name: string;
    email: string;
    role: string;
    step: string;
    closesNow: string;
    action: "extend" | "reopen" | "keep";
  }[];
  notYetOpen: { role: string; step: string; people: number }[];
  changes: number;
};

/** The full list: who gets the new date, who reopens, who already has later. Changes nothing. */
export async function previewFinalExtensionAction(
  raw: unknown,
): Promise<ExtensionPreview | { error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { error: "Pick a date and at least one step." };
  const plan = await finalExtensionPlan(db(), actor, parsed.data);
  return {
    until: formatIst(parsed.data.until),
    rows: plan.rows.map((r) => ({
      name: r.name,
      email: r.email,
      role: r.role,
      step: r.step,
      closesNow: r.closesNow ? formatIst(r.closesNow) : "No deadline",
      action: r.action,
    })),
    notYetOpen: plan.notYetOpen.map(({ role, step, people }) => ({ role, step, people })),
    changes: plan.rows.filter((r) => r.action !== "keep").length,
  };
}

/** Applies only if the list is still the one the admin reviewed. Sends no email. */
export async function applyFinalExtensionAction(raw: unknown, reviewedChanges: number) {
  const { actor } = await requireTeam(["admin"]);
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: "Pick a date and at least one step." };
  const res = await applyFinalExtension(db(), actor, parsed.data, { changes: reviewedChanges });
  revalidatePath("/team/candidates");
  return res;
}
