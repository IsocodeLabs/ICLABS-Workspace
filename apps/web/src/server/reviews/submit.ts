import {
  and,
  desc,
  eq,
  inArray,
  assessmentSessions,
  files,
  questions,
  reviewAssignments,
  reviews,
  stageProgress,
  submissions,
  teamMembers,
  type Db,
} from "@iclabs/db";
import { isBorderline, rubricPct, validateScores, type Actor, type Recommendation } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import type { AiReviewInput, AiReviewer } from "../ai/review";
import { advanceFrom, loadPinned, notifyAdmins, type ProgressionDeps } from "../stages/progression";
import { assignReviewers } from "./assign";
import { buildRuleContext, stageReviewAggregate } from "./context";

type TeamActor = Actor & { kind: "team" };

export type ReviewInput = {
  scores: Record<string, number>;
  recommendation: Recommendation;
  notes?: string;
  acceptedFromAi?: boolean;
};

const CLOSED = new Set(["closed_rejected", "closed_withdrawn", "completed"]);

/** The assignment, checked to belong to this reviewer. */
async function loadOwnAssignment(db: Db, actor: TeamActor, assignmentId: string) {
  const [row] = await db
    .select({ a: reviewAssignments, memberUserId: teamMembers.userId })
    .from(reviewAssignments)
    .innerJoin(teamMembers, eq(teamMembers.id, reviewAssignments.reviewerId))
    .where(eq(reviewAssignments.id, assignmentId));
  if (!row || row.memberUserId !== actor.userId) return null;
  const pinned = await loadPinned(db, row.a.applicationId);
  assertCan(actor, "review", {
    type: "submission",
    candidateId: pinned.app.candidateId,
    roleId: pinned.app.roleId,
    workflowId: pinned.app.workflowId,
    assignedReviewerIds: [row.memberUserId],
  });
  const node = pinned.config.nodes.find((n) => n.id === row.a.nodeId);
  if (!node) return null;
  return { assignment: row.a, pinned, node };
}

export async function submitReview(
  db: Db,
  deps: ProgressionDeps,
  actor: TeamActor,
  assignmentId: string,
  input: ReviewInput,
) {
  const loaded = await loadOwnAssignment(db, actor, assignmentId);
  if (!loaded) return { ok: false as const, error: "This review isn't assigned to you." };
  const { assignment, pinned, node } = loaded;
  if (assignment.status !== "assigned") return { ok: false as const, error: "You've already submitted this review." };
  if (CLOSED.has(pinned.app.status)) return { ok: false as const, error: "This application is closed." };

  let totalPct: number | null = null;
  if (node.rubric) {
    const problem = validateScores(node.rubric, input.scores);
    if (problem) return { ok: false as const, error: problem };
    totalPct = rubricPct(node.rubric, input.scores).pct;
  }
  const notes = input.notes?.trim().slice(0, 10_000) || null;

  await db.insert(reviews).values({
    stageProgressId: assignment.stageProgressId,
    assignmentId,
    reviewerId: assignment.reviewerId,
    kind: "human",
    scores: node.rubric ? input.scores : {},
    totalPct,
    recommendation: input.recommendation,
    notes,
    acceptedFromAi: !!input.acceptedFromAi,
  });
  await db.update(reviewAssignments).set({ status: "submitted" }).where(eq(reviewAssignments.id, assignmentId));
  await audit(db, {
    actorUserId: actor.userId,
    action: "review_submitted",
    entity: "stage_progress",
    entityId: assignment.stageProgressId,
    after: { totalPct, recommendation: input.recommendation, acceptedFromAi: !!input.acceptedFromAi },
  });
  const outcome = await concludeIfReady(db, deps, assignment.stageProgressId);
  return { ok: true as const, outcome };
}

/**
 * Once every assigned reviewer has scored: a borderline single review pulls in a second
 * reviewer; otherwise the stage is marked reviewed and its exit rules run.
 */
export async function concludeIfReady(db: Db, deps: ProgressionDeps, progressId: string) {
  const [progress] = await db.select().from(stageProgress).where(eq(stageProgress.id, progressId));
  if (!progress || progress.state !== "submitted") return "not_waiting" as const;
  const assignments = await db
    .select()
    .from(reviewAssignments)
    .where(eq(reviewAssignments.stageProgressId, progressId));
  if (assignments.some((a) => a.status === "assigned")) return "waiting" as const;

  const pinned = await loadPinned(db, progress.applicationId);
  if (CLOSED.has(pinned.app.status)) return "not_waiting" as const;
  const node = pinned.config.nodes.find((n) => n.id === progress.nodeId);
  const agg = await stageReviewAggregate(db, pinned, progressId, progress.nodeId);
  if (!node || !agg) return "waiting" as const;

  const borderline = node.reviewers?.borderline;
  if (
    agg.count === 1 &&
    agg.pct !== null &&
    isBorderline(agg.pct, borderline) &&
    !assignments.some((a) => a.reason === "borderline_second")
  ) {
    await assignReviewers(db, pinned.app.id, node.id, { reason: "borderline_second" });
    return "second_reviewer" as const;
  }

  await db.update(stageProgress).set({ state: "reviewed" }).where(eq(stageProgress.id, progressId));
  const ctx = await buildRuleContext(db, pinned, node.id);
  if (ctx.divergent) {
    await notifyAdmins(db, pinned, {
      kind: "reviews_diverge",
      title: `Reviewers disagree on ${pinned.candidateName}'s "${node.title}" (${pinned.roleTitle})`,
      body: "Worth a quick calibration chat.",
      link: `/team/pipeline?application=${pinned.app.id}`,
    });
  }
  await advanceFrom(db, deps, pinned.app.id, node.id, ctx);
  return "routed" as const;
}

// ─── AI suggestions ─────────────────────────────────────────────────────────

/** The submission as labelled text for Claude. Files are named, not read. */
export async function submissionForAi(db: Db, progressId: string, nodeId: string, applicationId: string) {
  const pinned = await loadPinned(db, applicationId);
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  if (!node?.rubric) return null;
  const answers: AiReviewInput["answers"] = [];
  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, progressId));
  if (session) {
    const qs = await db.select().from(questions).where(inArray(questions.id, session.questionIds));
    for (const q of qs) {
      if (q.type !== "short" && q.type !== "long") continue;
      const a = session.answers[q.id];
      answers.push({ label: q.body, value: Array.isArray(a) ? a.join(", ") : (a ?? "") });
    }
  } else {
    const [latest] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.stageProgressId, progressId))
      .orderBy(desc(submissions.version))
      .limit(1);
    const data = (latest?.data ?? {}) as Record<string, unknown>;
    const fileRows = latest?.fileIds.length
      ? await db.select({ id: files.id, filename: files.filename }).from(files).where(inArray(files.id, latest.fileIds))
      : [];
    const labelled =
      node.type === "task"
        ? node.config.deliverables.map((d) => ({ id: d.id, label: d.label, file: d.kind === "file" }))
        : node.type === "form" || node.type === "custom"
          ? node.config.fields
              .filter((f) => f.kind !== "section")
              .map((f) => ({ id: f.id, label: f.label, file: f.kind === "file" }))
          : [];
    for (const f of labelled) {
      const v = data[f.id];
      const text = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
      answers.push({
        label: f.label,
        value: f.file && text ? `[File uploaded: ${fileRows.find((r) => r.id === text)?.filename ?? "file"} — not shown here]` : text,
      });
    }
  }
  const instructions =
    node.type === "task" ? node.config.brief : node.type === "review_gate" ? (node.config.instructions ?? "") : (node.description ?? "");
  return {
    stageTitle: node.title,
    stageType: node.type,
    instructions,
    rubric: node.rubric,
    answers,
  } satisfies AiReviewInput;
}

/** Asks Claude for suggested scores. Stored once per stage; reviewers see it beside the rubric. */
export async function requestAiSuggestion(db: Db, actor: TeamActor, assignmentId: string, ai: AiReviewer) {
  const loaded = await loadOwnAssignment(db, actor, assignmentId);
  if (!loaded) return { ok: false as const, error: "This review isn't assigned to you." };
  const { assignment } = loaded;
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.stageProgressId, assignment.stageProgressId), eq(reviews.kind, "ai_suggestion")));
  if (existing) return { ok: true as const, suggestionId: existing.id };

  const input = await submissionForAi(db, assignment.stageProgressId, assignment.nodeId, assignment.applicationId);
  if (!input) return { ok: false as const, error: "This stage has no rubric to score against." };
  const result = await ai.suggest(input);
  if (!result.ok) return { ok: false as const, error: result.message };
  const [row] = await db
    .insert(reviews)
    .values({
      stageProgressId: assignment.stageProgressId,
      kind: "ai_suggestion",
      scores: result.suggestion.scores,
      totalPct: rubricPct(input.rubric, result.suggestion.scores).pct,
      notes: [result.suggestion.summary, ...result.suggestion.missing.map((m) => `Missing: ${m}`)].join("\n"),
      evidence: result.suggestion.evidence,
    })
    .returning({ id: reviews.id });
  await audit(db, {
    actorUserId: actor.userId,
    action: "ai_suggestion_requested",
    entity: "stage_progress",
    entityId: assignment.stageProgressId,
    after: { model: result.model },
  });
  return { ok: true as const, suggestionId: row!.id };
}

