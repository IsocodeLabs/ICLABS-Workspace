"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, assessmentSessions, stageProgress, and } from "@iclabs/db";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import {
  getAssessmentQuestions,
  recordIntegrity,
  saveAnswer,
  saveStageDraft,
  startAssessment,
  submitAssessment,
  submitForm,
  submitTask,
} from "@/server/stages/candidate";
import { progressionDeps } from "@/server/stages/deps";

const ids = z.object({
  applicationId: z.string().min(1).max(40),
  nodeId: z.string().min(1).max(64),
});
const refresh = (applicationId: string) => revalidatePath(`/roles/${applicationId}`, "layout");

export async function saveDraftAction(input: {
  applicationId: string;
  nodeId: string;
  draft: Record<string, unknown>;
}) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  return saveStageDraft(db(), actor, applicationId, nodeId, input.draft);
}

export async function submitFormAction(input: {
  applicationId: string;
  nodeId: string;
  answers: Record<string, unknown>;
}) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  const result = await submitForm(
    db(),
    progressionDeps(),
    actor,
    applicationId,
    nodeId,
    input.answers,
  );
  if (result.ok) refresh(applicationId);
  return result;
}

export async function submitTaskAction(input: {
  applicationId: string;
  nodeId: string;
  deliverables: Record<string, string>;
}) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  const deliverables = z
    .record(z.string().max(64), z.string().max(20_000))
    .parse(input.deliverables);
  const result = await submitTask(
    db(),
    progressionDeps(),
    actor,
    applicationId,
    nodeId,
    deliverables,
  );
  if (result.ok) refresh(applicationId);
  return result;
}

export async function startAssessmentAction(input: { applicationId: string; nodeId: string }) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  const res = await startAssessment(db(), actor, applicationId, nodeId);
  return res.ok ? { ok: true as const, endsAt: res.endsAt.toISOString() } : res;
}

export async function getQuestionsAction(input: { applicationId: string; nodeId: string }) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  const view = await getAssessmentQuestions(db(), actor, applicationId, nodeId);
  if (!view) return null;
  return { ...view, endsAt: view.endsAt.toISOString(), now: new Date().toISOString() };
}

export async function saveAnswerAction(input: {
  applicationId: string;
  nodeId: string;
  questionId: string;
  value: string | string[];
}) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  return saveAnswer(
    db(),
    actor,
    applicationId,
    nodeId,
    z.string().max(40).parse(input.questionId),
    input.value,
  );
}

export async function submitAssessmentAction(input: { applicationId: string; nodeId: string }) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  const [row] = await db()
    .select({ sessionId: assessmentSessions.id })
    .from(assessmentSessions)
    .innerJoin(stageProgress, eq(stageProgress.id, assessmentSessions.stageProgressId))
    .where(and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, nodeId)));
  if (!row) return { ok: false as const, error: "not_found" };
  const result = await submitAssessment(db(), progressionDeps(), row.sessionId, { actor });
  refresh(applicationId);
  return result;
}

export async function integrityAction(input: {
  applicationId: string;
  nodeId: string;
  events: { type: string; at: string; durationMs?: number }[];
}) {
  const { actor } = await requireCandidate();
  const { applicationId, nodeId } = ids.parse(input);
  await recordIntegrity(db(), actor, applicationId, nodeId, input.events.slice(0, 200));
}
