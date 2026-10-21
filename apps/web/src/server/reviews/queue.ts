import {
  and,
  desc,
  eq,
  inArray,
  notInArray,
  applications,
  assessmentSessions,
  candidates,
  files,
  questions,
  reviewAssignments,
  reviews,
  stageProgress,
  submissions,
  teamMembers,
  users,
  type Db,
} from "@iclabs/db";
import { can, candidatePath, type Actor, type WorkflowNode } from "@iclabs/core";
import { integritySummary } from "../stages/candidate";
import { isReviewable, loadPinned, type PinnedApplication } from "../stages/progression";
import { isIntegrityHigh } from "./context";

type TeamActor = Actor & { kind: "team" };

/** Team user ids with an active or finished review on an application (for `can()`). */
export async function reviewerUserIds(db: Db, applicationId: string, stageProgressId?: string) {
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(reviewAssignments)
    .innerJoin(teamMembers, eq(teamMembers.id, reviewAssignments.reviewerId))
    .where(
      and(
        eq(reviewAssignments.applicationId, applicationId),
        inArray(reviewAssignments.status, ["assigned", "submitted"]),
        stageProgressId ? eq(reviewAssignments.stageProgressId, stageProgressId) : undefined,
      ),
    );
  return rows.flatMap((r) => (r.userId ? [r.userId] : []));
}

const blindLabel = (applicationId: string) => `Candidate ${applicationId.slice(-5).toUpperCase()}`;

export type QueueItem = {
  assignmentId: string;
  status: "assigned" | "submitted" | "released";
  reason: string;
  candidateLabel: string;
  roleTitle: string;
  stageTitle: string;
  submittedAt: Date | null;
  assignedAt: Date;
  late: boolean;
};

/** The signed-in reviewer's open reviews (oldest first), then their recent finished ones. */
export async function myQueue(db: Db, actor: TeamActor): Promise<{ open: QueueItem[]; done: QueueItem[] }> {
  const [me] = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.userId, actor.userId));
  if (!me) return { open: [], done: [] };
  const rows = await db
    .select({ a: reviewAssignments, p: stageProgress, name: candidates.name })
    .from(reviewAssignments)
    .innerJoin(stageProgress, eq(stageProgress.id, reviewAssignments.stageProgressId))
    .innerJoin(applications, eq(applications.id, reviewAssignments.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(and(eq(reviewAssignments.reviewerId, me.id), inArray(reviewAssignments.status, ["assigned", "submitted"])))
    .orderBy(desc(reviewAssignments.assignedAt))
    .limit(200);
  const items: QueueItem[] = [];
  for (const r of rows) {
    const pinned = await loadPinned(db, r.a.applicationId);
    const node = pinned.config.nodes.find((n) => n.id === r.a.nodeId);
    const [latest] = await db
      .select({ isLate: submissions.isLate })
      .from(submissions)
      .where(eq(submissions.stageProgressId, r.p.id))
      .orderBy(desc(submissions.version))
      .limit(1);
    items.push({
      assignmentId: r.a.id,
      status: r.a.status,
      reason: r.a.reason,
      candidateLabel: node?.reviewers?.blind ? blindLabel(r.a.applicationId) : r.name,
      roleTitle: pinned.roleTitle,
      stageTitle: node?.title ?? "Stage",
      submittedAt: r.p.submittedAt,
      assignedAt: r.a.assignedAt,
      late: !!latest?.isLate,
    });
  }
  const open = items.filter((i) => i.status === "assigned").reverse();
  const done = items.filter((i) => i.status === "submitted").slice(0, 20);
  return { open, done };
}

export type UnassignedItem = {
  progressId: string;
  applicationId: string;
  candidateName: string;
  roleTitle: string;
  stageTitle: string;
  submittedAt: Date | null;
};

/** Submitted stages that need a reviewer (manual pools, empty pools, released reviews). */
export async function unassignedQueue(db: Db, actor: TeamActor): Promise<UnassignedItem[]> {
  if (actor.role !== "admin" && actor.role !== "hiring_manager") return [];
  const covered = db
    .select({ id: reviewAssignments.stageProgressId })
    .from(reviewAssignments)
    .where(eq(reviewAssignments.status, "assigned"));
  const rows = await db
    .select({ p: stageProgress, app: applications, name: candidates.name })
    .from(stageProgress)
    .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .where(
      and(
        eq(stageProgress.state, "submitted"),
        inArray(applications.status, ["active", "needs_decision"]),
        notInArray(stageProgress.id, covered),
      ),
    )
    .limit(200);
  const out: UnassignedItem[] = [];
  for (const r of rows) {
    if (!can(actor, "write", { type: "workflow", roleId: r.app.roleId, workflowId: r.app.workflowId })) continue;
    const pinned = await loadPinned(db, r.app.id);
    const node = pinned.config.nodes.find((n) => n.id === r.p.nodeId);
    if (!node || !isReviewable(node, { hasWrittenAnswers: true })) continue;
    // Stages with a finished human review are past this queue (waiting on rules or a decision).
    const [done] = await db
      .select({ id: reviews.id })
      .from(reviews)
      .where(and(eq(reviews.stageProgressId, r.p.id), eq(reviews.kind, "human")))
      .limit(1);
    if (done) continue;
    out.push({
      progressId: r.p.id,
      applicationId: r.app.id,
      candidateName: r.name,
      roleTitle: pinned.roleTitle,
      stageTitle: node.title,
      submittedAt: r.p.submittedAt,
    });
  }
  return out;
}

/** Everything the split-view review page shows. Other reviewers' scores stay hidden until you submit. */
export async function getReviewView(db: Db, actor: TeamActor, assignmentId: string) {
  const [row] = await db
    .select({ a: reviewAssignments, memberUserId: teamMembers.userId })
    .from(reviewAssignments)
    .innerJoin(teamMembers, eq(teamMembers.id, reviewAssignments.reviewerId))
    .where(eq(reviewAssignments.id, assignmentId));
  if (!row) return null;
  const pinned = await loadPinned(db, row.a.applicationId);
  const isMine = row.memberUserId === actor.userId;
  const allowed =
    isMine ||
    can(actor, "write", { type: "workflow", roleId: pinned.app.roleId, workflowId: pinned.app.workflowId });
  if (!allowed) return null;
  const node = pinned.config.nodes.find((n) => n.id === row.a.nodeId);
  if (!node) return null;
  const [progress] = await db.select().from(stageProgress).where(eq(stageProgress.id, row.a.stageProgressId));

  const { submission, versions, assessment } = await stageAnswers(db, row.a.stageProgressId);

  const allReviews = await db
    .select({ r: reviews, reviewerEmail: teamMembers.email })
    .from(reviews)
    .leftJoin(teamMembers, eq(teamMembers.id, reviews.reviewerId))
    .where(eq(reviews.stageProgressId, row.a.stageProgressId))
    .orderBy(desc(reviews.submittedAt));
  const mine = allReviews.find((r) => r.r.assignmentId === assignmentId)?.r ?? null;
  const ai = allReviews.find((r) => r.r.kind === "ai_suggestion")?.r ?? null;
  const showOthers = !!mine || !isMine;
  const others = showOthers
    ? allReviews
        .filter((r) => r.r.kind === "human" && r.r.assignmentId !== assignmentId)
        .map((r) => ({ ...r.r, reviewerEmail: r.reviewerEmail }))
    : [];

  const blind = !!node.reviewers?.blind;
  // What the candidate submitted before this stage, so it's graded in context. Hidden in blind
  // reviews: a details form would give away who the candidate is.
  const earlier = blind ? [] : await earlierStages(db, pinned, node.id);
  const [cand] = await db
    .select({
      name: candidates.name,
      email: users.email,
      college: candidates.college,
      gradYear: candidates.gradYear,
      github: candidates.github,
      linkedin: candidates.linkedin,
      portfolio: candidates.portfolio,
      skills: candidates.skills,
    })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(candidates.id, pinned.app.candidateId));

  return {
    assignment: row.a,
    isMine,
    canSubmit: isMine && row.a.status === "assigned",
    node,
    rubric: node.rubric ?? null,
    roleTitle: pinned.roleTitle,
    candidate: blind
      ? { label: blindLabel(pinned.app.id), profile: null, candidateId: null }
      : { label: cand?.name ?? "", profile: cand ?? null, candidateId: pinned.app.candidateId },
    progress,
    submission,
    versions,
    assessment,
    earlier,
    integrityHigh: assessment ? isIntegrityHigh(assessment.integrity) : false,
    mine,
    ai,
    others,
  };
}

export type ReviewView = NonNullable<Awaited<ReturnType<typeof getReviewView>>>;
export type StageAnswers = Awaited<ReturnType<typeof stageAnswers>>;

/** A stage's latest submission (with its files) or, for a timed test, the questions and answers. */
async function stageAnswers(db: Db, stageProgressId: string) {
  const subs = await db
    .select()
    .from(submissions)
    .where(eq(submissions.stageProgressId, stageProgressId))
    .orderBy(desc(submissions.version));
  const latest = subs[0] ?? null;
  const fileRows = latest?.fileIds.length
    ? await db
        .select({ id: files.id, filename: files.filename, size: files.size, scanStatus: files.scanStatus })
        .from(files)
        .where(inArray(files.id, latest.fileIds))
    : [];

  const [session] = await db
    .select()
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, stageProgressId));
  const assessment = session
    ? {
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
        autoSubmitted: session.autoSubmitted,
        integrity: await integritySummary(db, session.id),
        questions: (await db.select().from(questions).where(inArray(questions.id, session.questionIds)))
          .sort((a, b) => session.questionIds.indexOf(a.id) - session.questionIds.indexOf(b.id))
          .map((q) => ({
            id: q.id,
            type: q.type,
            body: q.body,
            options: q.options,
            correct: q.correct,
            explanation: q.explanation,
            points: q.points,
            answer: session.answers[q.id] ?? null,
          })),
      }
    : null;

  return {
    submission: latest
      ? { version: latest.version, data: latest.data, submittedAt: latest.submittedAt, isLate: latest.isLate, lateByMinutes: latest.lateByMinutes, files: fileRows }
      : null,
    versions: subs.length,
    assessment,
  };
}

/** Every candidate-facing stage before `nodeId` that the candidate submitted, in the order they did them. */
async function earlierStages(db: Db, pinned: PinnedApplication, nodeId: string) {
  const path = candidatePath(pinned.config);
  const upTo = path.findIndex((n) => n.id === nodeId);
  const before = (upTo === -1 ? path : path.slice(0, upTo)).filter((n) => n.type !== "interview");
  if (before.length === 0) return [];
  const rows = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, pinned.app.id), inArray(stageProgress.nodeId, before.map((n) => n.id))));
  const out: ({ node: WorkflowNode; autoScorePct: number | null } & StageAnswers)[] = [];
  for (const node of before) {
    const progress = rows.find((r) => r.nodeId === node.id);
    if (!progress) continue;
    const answers = await stageAnswers(db, progress.id);
    if (!answers.submission && !answers.assessment?.submittedAt) continue;
    out.push({ node, autoScorePct: progress.autoScorePct, ...answers });
  }
  return out;
}
