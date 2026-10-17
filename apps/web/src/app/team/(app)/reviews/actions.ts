"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { aiReviewer } from "@/server/ai";
import { progressionDeps } from "@/server/stages/deps";
import { extendDeadline } from "@/server/stages/progression";
import { assignReviewerManually, releaseAssignment } from "@/server/reviews/assign";
import { decide, runRulesNow, type BatchRow } from "@/server/reviews/decisions";
import { requestAiSuggestion, submitReview } from "@/server/reviews/submit";
import { ForbiddenError } from "@/server/audit";

export type ActionResult = { ok: true } | { ok: false; error: string };

const reviewSchema = z.object({
  scores: z.record(z.string(), z.number().int().min(0).max(10)),
  recommendation: z.enum(["strong_yes", "yes", "no", "strong_no"]),
  notes: z.string().max(10_000).optional(),
  acceptedFromAi: z.boolean().optional(),
});

async function guarded<T>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: "You don't have access to that." };
    throw err;
  }
}

export async function submitReviewAction(
  assignmentId: string,
  input: z.input<typeof reviewSchema>,
): Promise<ActionResult & { outcome?: string }> {
  const { actor } = await requireTeam(["admin", "hiring_manager", "reviewer"]);
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Score every criterion and pick a recommendation." };
  const res = await guarded(() => submitReview(db(), progressionDeps(), actor, assignmentId, parsed.data));
  revalidatePath("/team/reviews");
  revalidatePath(`/team/reviews/${assignmentId}`);
  return res.ok ? { ok: true, outcome: "outcome" in res ? res.outcome : undefined } : res;
}

export async function requestAiAction(assignmentId: string): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const res = await guarded(() => requestAiSuggestion(db(), actor, assignmentId, aiReviewer()));
  revalidatePath(`/team/reviews/${assignmentId}`);
  return res.ok ? { ok: true } : res;
}

export async function assignReviewerAction(progressId: string, teamMemberId: string): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const res = await guarded(() => assignReviewerManually(db(), actor, progressId, teamMemberId));
  revalidatePath("/team/reviews");
  return res.ok ? { ok: true } : res;
}

export async function releaseAssignmentAction(assignmentId: string): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const res = await guarded(() => releaseAssignment(db(), actor, assignmentId));
  revalidatePath("/team/reviews");
  return res.ok ? { ok: true } : res;
}

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("advance"), targetNodeId: z.string().min(1), note: z.string().max(2000).optional() }),
  z.object({ action: z.enum(["complete", "reject", "hold", "reopen"]), note: z.string().max(2000).optional() }),
]);

export async function decideAction(applicationId: string, input: z.input<typeof decisionSchema>): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin", "hiring_manager"]);
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pick what should happen next." };
  const res = await guarded(() => decide(db(), progressionDeps(), actor, applicationId, parsed.data));
  revalidatePath("/team/pipeline");
  return res;
}

export async function bulkDecideAction(
  applicationIds: string[],
  input: z.input<typeof decisionSchema>,
): Promise<{ done: number; failed: number }> {
  let done = 0;
  for (const id of applicationIds.slice(0, 200)) {
    const res = await decideAction(id, input);
    if (res.ok) done++;
  }
  return { done, failed: Math.min(applicationIds.length, 200) - done };
}

export async function runRulesAction(
  workflowId: string,
  nodeId: string,
  dryRun: boolean,
): Promise<{ ok: true; rows: BatchRow[] } | { ok: false; error: string }> {
  const { actor } = await requireTeam(["admin"]);
  const res = await runRulesNow(db(), progressionDeps(), actor, workflowId, nodeId, { dryRun });
  if (!dryRun) revalidatePath("/team/pipeline");
  return res;
}

export async function extendDeadlineAction(progressId: string, untilIso: string): Promise<ActionResult> {
  const { actor } = await requireTeam(["admin"]);
  const until = new Date(untilIso);
  if (Number.isNaN(until.getTime()) || until.getTime() < Date.now())
    return { ok: false, error: "Pick a time in the future." };
  await extendDeadline(db(), actor.userId, progressId, until);
  revalidatePath("/team/pipeline");
  return { ok: true };
}
