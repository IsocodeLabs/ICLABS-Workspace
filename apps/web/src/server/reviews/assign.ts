import {
  and,
  eq,
  inArray,
  sql,
  reviewAssignments,
  stageProgress,
  teamMembers,
  type Db,
} from "@iclabs/db";
import { pickReviewers, type Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import { notify } from "../portal";
import { loadPinned, notifyAdmins } from "../stages/progression";

type Reason = "primary" | "borderline_second" | "manual";

/**
 * Hands a submitted stage to reviewers from the stage's pool. Round robin balances reviews
 * on this stage; "load" picks whoever has the shortest open queue. Manual pools (or empty
 * ones) alert admins to assign someone. Idempotent for primary assignment.
 */
export async function assignReviewers(
  db: Db,
  applicationId: string,
  nodeId: string,
  opts: { reason?: Reason; count?: number } = {},
): Promise<string[]> {
  const reason = opts.reason ?? "primary";
  const pinned = await loadPinned(db, applicationId);
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`node ${nodeId} not in pinned version`);
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, nodeId)));
  if (!progress) throw new Error("stage not reached");

  const existing = await db
    .select({ reviewerId: reviewAssignments.reviewerId, reason: reviewAssignments.reason })
    .from(reviewAssignments)
    .where(eq(reviewAssignments.stageProgressId, progress.id));
  if (reason === "primary" && existing.some((e) => e.reason === "primary")) return [];

  const config = node.reviewers;
  const active = config?.pool.length
    ? await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(and(inArray(teamMembers.id, config.pool), eq(teamMembers.active, true)))
    : [];
  // Keep the configured order so ties break the same way every time.
  const pool = (config?.pool ?? []).filter((id) => active.some((a) => a.id === id));

  const counts = async (where: ReturnType<typeof eq>) =>
    Object.fromEntries(
      (
        await db
          .select({ id: reviewAssignments.reviewerId, n: sql<number>`count(*)::int` })
          .from(reviewAssignments)
          .where(and(inArray(reviewAssignments.reviewerId, pool.length ? pool : [""]), where))
          .groupBy(reviewAssignments.reviewerId)
      ).map((r) => [r.id, r.n]),
    );
  const picked = pool.length
    ? pickReviewers({
        pool,
        count: opts.count ?? (reason === "primary" ? (config?.perSubmission ?? 1) : 1),
        method: config?.method ?? "manual",
        stageCounts: await counts(eq(reviewAssignments.nodeId, nodeId)),
        openLoad: await counts(eq(reviewAssignments.status, "assigned")),
        exclude: existing.map((e) => e.reviewerId),
      })
    : [];

  if (picked.length === 0) {
    await notifyAdmins(db, pinned, {
      kind: "review_unassigned",
      title: `${pinned.candidateName}'s "${node.title}" needs a reviewer (${pinned.roleTitle})`,
      body: reason === "borderline_second" ? "Borderline score: assign a second reviewer." : undefined,
      link: `/team/reviews?view=unassigned`,
    });
    return [];
  }

  const created = await db
    .insert(reviewAssignments)
    .values(
      picked.map((reviewerId) => ({
        stageProgressId: progress.id,
        applicationId,
        nodeId,
        reviewerId,
        reason,
      })),
    )
    .returning({ id: reviewAssignments.id, reviewerId: reviewAssignments.reviewerId });
  await alertReviewers(db, created, `${node.title} (${pinned.roleTitle})`);
  await audit(db, {
    actorUserId: null,
    via: "system",
    action: "reviewers_assigned",
    entity: "stage_progress",
    entityId: progress.id,
    after: { reviewerIds: picked, reason },
  });
  return created.map((c) => c.id);
}

/** An admin or the role's hiring manager puts a specific person on a review. */
export async function assignReviewerManually(
  db: Db,
  actor: Actor & { kind: "team" },
  progressId: string,
  teamMemberId: string,
) {
  const [row] = await db
    .select({ progress: stageProgress })
    .from(stageProgress)
    .where(eq(stageProgress.id, progressId));
  if (!row) return { ok: false as const, error: "Stage not found." };
  const pinned = await loadPinned(db, row.progress.applicationId);
  assertCan(actor, "write", { type: "workflow", roleId: pinned.app.roleId, workflowId: pinned.app.workflowId });
  const [member] = await db
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.id, teamMemberId), eq(teamMembers.active, true)));
  if (!member) return { ok: false as const, error: "Pick an active team member." };
  if (member.role === "interviewer")
    return { ok: false as const, error: "Interviewers can't review submissions." };
  const [dupe] = await db
    .select({ id: reviewAssignments.id })
    .from(reviewAssignments)
    .where(
      and(
        eq(reviewAssignments.stageProgressId, progressId),
        eq(reviewAssignments.reviewerId, teamMemberId),
        inArray(reviewAssignments.status, ["assigned", "submitted"]),
      ),
    );
  if (dupe) return { ok: false as const, error: "They're already on this review." };
  const node = pinned.config.nodes.find((n) => n.id === row.progress.nodeId);
  const [created] = await db
    .insert(reviewAssignments)
    .values({
      stageProgressId: progressId,
      applicationId: pinned.app.id,
      nodeId: row.progress.nodeId,
      reviewerId: teamMemberId,
      reason: "manual",
    })
    .returning({ id: reviewAssignments.id, reviewerId: reviewAssignments.reviewerId });
  await alertReviewers(db, [created!], `${node?.title ?? "Stage"} (${pinned.roleTitle})`);
  await audit(db, {
    actorUserId: actor.userId,
    action: "reviewer_assigned",
    entity: "stage_progress",
    entityId: progressId,
    after: { teamMemberId },
  });
  return { ok: true as const, assignmentId: created!.id };
}

/** Takes an open review off someone's queue (e.g. they're away). */
export async function releaseAssignment(db: Db, actor: Actor & { kind: "team" }, assignmentId: string) {
  const [a] = await db.select().from(reviewAssignments).where(eq(reviewAssignments.id, assignmentId));
  if (!a || a.status !== "assigned") return { ok: false as const, error: "That review isn't open." };
  const pinned = await loadPinned(db, a.applicationId);
  assertCan(actor, "write", { type: "workflow", roleId: pinned.app.roleId, workflowId: pinned.app.workflowId });
  await db.update(reviewAssignments).set({ status: "released" }).where(eq(reviewAssignments.id, assignmentId));
  await audit(db, {
    actorUserId: actor.userId,
    action: "review_released",
    entity: "review_assignment",
    entityId: assignmentId,
  });
  return { ok: true as const };
}

async function alertReviewers(db: Db, created: { id: string; reviewerId: string }[], what: string) {
  const members = await db
    .select({ id: teamMembers.id, userId: teamMembers.userId })
    .from(teamMembers)
    .where(inArray(teamMembers.id, created.map((c) => c.reviewerId)));
  await notify(
    db,
    created.flatMap((c) => {
      const userId = members.find((m) => m.id === c.reviewerId)?.userId;
      return userId
        ? [{ userId, kind: "review_assigned", title: `New review: ${what}`, link: `/team/reviews/${c.id}` }]
        : [];
    }),
  );
}

/** People who can be put on a review (for the assign picker). */
export async function listReviewers(db: Db) {
  return db
    .select({ id: teamMembers.id, email: teamMembers.email, role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.active, true), inArray(teamMembers.role, ["admin", "hiring_manager", "reviewer"])))
    .orderBy(teamMembers.email);
}
