import {
  and,
  eq,
  inArray,
  isNull,
  lt,
  or,
  sql,
  applications,
  candidates,
  roles,
  stageProgress,
  roleAssignments,
  teamMembers,
  users,
  workflowVersions,
  type Db,
} from "@iclabs/db";
import {
  STAGE_TYPES,
  computeDeadlines,
  entryNodeId,
  evaluateEdges,
  formatIst,
  isTerminal,
  workflowConfigSchema,
  type RuleContext,
  type WorkflowConfig,
  type WorkflowNode,
} from "@iclabs/core";
import { audit } from "../audit";
import type { EnqueueInput } from "../email/outbox";
import { notify } from "../portal";

export type ProgressionDeps = {
  queueEmail: (input: EnqueueInput) => Promise<string>;
  appUrl: (path: string) => string;
  now?: () => Date;
  /** Called when a reviewable stage is submitted (M5 assigns reviewers here). */
  onAwaitingReview?: (applicationId: string, nodeId: string) => Promise<void>;
};

export type PinnedApplication = Awaited<ReturnType<typeof loadPinned>>;

// Published versions never change (edits go to a new draft), so each is fetched and validated
// once per server instance instead of on every candidate request. Frozen so nobody mutates it.
const versionConfigs = new Map<string, WorkflowConfig>();

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export async function versionConfig(db: Db, versionId: string): Promise<WorkflowConfig> {
  const hit = versionConfigs.get(versionId);
  if (hit) return hit;
  const [v] = await db
    .select({ config: workflowVersions.config })
    .from(workflowVersions)
    .where(eq(workflowVersions.id, versionId));
  if (!v) throw new Error("application not pinned to a published process");
  const config = deepFreeze(workflowConfigSchema.parse(v.config));
  if (versionConfigs.size >= 500) versionConfigs.delete(versionConfigs.keys().next().value!);
  versionConfigs.set(versionId, config);
  return config;
}

/** An application with the exact process version it is pinned to. */
export async function loadPinned(db: Db, applicationId: string) {
  const [row] = await db
    .select({
      app: applications,
      roleTitle: roles.title,
      candidateName: candidates.name,
      email: users.email,
      userId: users.id,
    })
    .from(applications)
    .innerJoin(workflowVersions, eq(workflowVersions.id, applications.workflowVersionId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(applications.id, applicationId));
  if (!row) throw new Error("application not pinned to a published process");
  return { ...row, config: await versionConfig(db, row.app.workflowVersionId!) };
}

const firstName = (name: string) => name.split(" ")[0]!;

export function isReviewable(
  node: WorkflowNode,
  opts: { hasWrittenAnswers?: boolean } = {},
): boolean {
  if (node.type === "task" || node.type === "review_gate") return true;
  if (node.type === "custom") return node.config.reviewed;
  if (node.type === "assessment") return !!opts.hasWrittenAnswers && !!node.rubric;
  return false;
}

/**
 * Opens a stage for the candidate (idempotent) and tells them in the app. No email: candidates
 * only get the invite, a receipt for each submission, and interview emails.
 */
export async function unlockNode(
  db: Db,
  deps: ProgressionDeps,
  pinned: PinnedApplication,
  nodeId: string,
) {
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`node ${nodeId} not in pinned version`);
  const now = deps.now?.() ?? new Date();
  const { dueAt, graceUntil } = computeDeadlines(node, now);
  const [created] = await db
    .insert(stageProgress)
    .values({
      applicationId: pinned.app.id,
      nodeId,
      state: "unlocked",
      unlockedAt: now,
      dueAt,
      graceUntil,
    })
    .onConflictDoNothing()
    .returning();
  await db
    .update(applications)
    .set({ currentNodeId: nodeId, status: "active" })
    .where(eq(applications.id, pinned.app.id));
  if (!created) return;

  if (node.visibility === "candidate" && node.type !== "interview") {
    await notify(db, [
      {
        userId: pinned.userId,
        kind: "stage_unlocked",
        title: `${pinned.roleTitle}: ${node.title} is open`,
        body: dueAt ? `Due ${formatIst(dueAt)}` : undefined,
        link: `/roles/${pinned.app.id}/stages/${nodeId}`,
      },
    ]);
  }
  if (node.type === "review_gate") {
    // Nothing for the candidate to do: the team reviews what's been submitted so far.
    await db
      .update(stageProgress)
      .set({ state: "submitted", submittedAt: now })
      .where(eq(stageProgress.id, created.id));
    await deps.onAwaitingReview?.(pinned.app.id, nodeId);
  }
  if (node.type === "interview") {
    await notifyAdmins(db, pinned, {
      kind: "interview_needed",
      title: `${pinned.candidateName} is ready for "${node.title}" (${pinned.roleTitle})`,
      link: `/team/interviews`,
    });
  }
}

/** First stage of a freshly invited application. The invite email already points there. */
export async function startApplication(db: Db, deps: ProgressionDeps, applicationId: string) {
  const pinned = await loadPinned(db, applicationId);
  const entry = entryNodeId(pinned.config);
  if (entry) await unlockNode(db, deps, pinned, entry);
}

/**
 * Moves a candidate out of a stage along the first matching rule path.
 * Rejections only happen where an admin opted in; otherwise the team decides.
 */
export async function advanceFrom(
  db: Db,
  deps: ProgressionDeps,
  applicationId: string,
  nodeId: string,
  ctx: RuleContext,
  via: "system" | "rule" = "rule",
) {
  const pinned = await loadPinned(db, applicationId);
  const decision = evaluateEdges(pinned.config, nodeId, ctx);
  await audit(db, {
    actorUserId: null,
    via,
    action: "stage_routed",
    entity: "application",
    entityId: applicationId,
    after: {
      from: nodeId,
      to: decision.target,
      edgeId: decision.edgeId,
      wouldReject: decision.wouldReject ?? false,
    },
  });

  if (!isTerminal(decision.target)) {
    await db
      .update(stageProgress)
      .set({ state: "passed" })
      .where(and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, nodeId)));
    await unlockNode(db, deps, pinned, decision.target);
    return decision;
  }

  if (decision.target === "END_COMPLETE") {
    await db
      .update(applications)
      .set({ status: "completed" })
      .where(eq(applications.id, applicationId));
  } else if (decision.target === "END_REJECT") {
    await rejectApplication(db, deps, pinned, nodeId, { actorUserId: null, via: "rule" });
  } else {
    await db
      .update(applications)
      .set({ status: "needs_decision" })
      .where(eq(applications.id, applicationId));
    await notifyAdmins(db, pinned, {
      kind: "needs_decision",
      title: `${pinned.candidateName} needs a decision (${pinned.roleTitle})`,
      body: decision.wouldReject ? "A rule suggests not progressing them." : undefined,
      link: `/team/pipeline`,
    });
  }
  return decision;
}

/** Closes an application and sends the (delayed) not-progressing email. */
export async function rejectApplication(
  db: Db,
  deps: ProgressionDeps,
  pinned: PinnedApplication,
  nodeId: string | null,
  by: { actorUserId: string | null; via: "ui" | "rule" | "mcp" },
) {
  await db
    .update(applications)
    .set({ status: "closed_rejected" })
    .where(eq(applications.id, pinned.app.id));
  if (nodeId) {
    await db
      .update(stageProgress)
      .set({ state: "failed" })
      .where(and(eq(stageProgress.applicationId, pinned.app.id), eq(stageProgress.nodeId, nodeId)));
  }
  const now = deps.now?.() ?? new Date();
  await deps.queueEmail({
    to: pinned.email,
    templateKey: "not_progressing",
    userId: pinned.userId,
    applicationId: pinned.app.id,
    // Sent two days later so it doesn't feel automatic.
    sendAfter: new Date(now.getTime() + 48 * 3600_000),
    vars: { first_name: firstName(pinned.candidateName), role: pinned.roleTitle },
  });
  await audit(db, {
    actorUserId: by.actorUserId,
    via: by.via,
    action: "application_rejected",
    entity: "application",
    entityId: pinned.app.id,
  });
}

/**
 * After a candidate submits: reviewable stages wait for the team; everything else routes now.
 */
export async function completeSubmission(
  db: Db,
  deps: ProgressionDeps,
  applicationId: string,
  node: WorkflowNode,
  ctx: RuleContext & { hasWrittenAnswers?: boolean },
) {
  if (isReviewable(node, { hasWrittenAnswers: ctx.hasWrittenAnswers })) {
    await deps.onAwaitingReview?.(applicationId, node.id);
    return { awaitingReview: true as const };
  }
  const decision = await advanceFrom(db, deps, applicationId, node.id, ctx);
  return { awaitingReview: false as const, decision };
}

// ─── Scheduled sweeps ────────────────────────────────────────────────────────

/** Deadline + grace passed with nothing submitted: the team decides what happens. */
export async function sweepMissedDeadlines(db: Db, deps: ProgressionDeps) {
  const now = deps.now?.() ?? new Date();
  const missed = await db
    .select({
      id: stageProgress.id,
      applicationId: stageProgress.applicationId,
      nodeId: stageProgress.nodeId,
    })
    .from(stageProgress)
    .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
    .where(
      and(
        inArray(stageProgress.state, ["unlocked", "in_progress"]),
        eq(applications.status, "active"),
        lt(
          sql`coalesce(${stageProgress.extendedUntil}, ${stageProgress.graceUntil}, ${stageProgress.dueAt})`,
          now.toISOString(),
        ),
      ),
    );
  for (const m of missed) {
    await db.update(stageProgress).set({ state: "missed" }).where(eq(stageProgress.id, m.id));
    await db
      .update(applications)
      .set({ status: "needs_decision" })
      .where(eq(applications.id, m.applicationId));
    const pinned = await loadPinned(db, m.applicationId);
    const node = pinned.config.nodes.find((n) => n.id === m.nodeId);
    await notifyAdmins(db, pinned, {
      kind: "deadline_missed",
      title: `${pinned.candidateName} missed "${node?.title ?? "a stage"}" (${pinned.roleTitle})`,
      body: "Grant an extension or decide from the pipeline.",
      link: `/team/pipeline`,
    });
  }
  return missed.length;
}

/** 24 hours before a deadline, one in-app reminder per stage (no email). */
export async function sendDeadlineReminders(db: Db, deps: ProgressionDeps) {
  const now = deps.now?.() ?? new Date();
  const soon = new Date(now.getTime() + 24 * 3600_000);
  const due = await db
    .select({
      id: stageProgress.id,
      applicationId: stageProgress.applicationId,
      nodeId: stageProgress.nodeId,
      dueAt: stageProgress.dueAt,
    })
    .from(stageProgress)
    .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
    .where(
      and(
        inArray(stageProgress.state, ["unlocked", "in_progress"]),
        eq(applications.status, "active"),
        isNull(stageProgress.reminderSentAt),
        sql`${stageProgress.dueAt} > ${now.toISOString()} and ${stageProgress.dueAt} <= ${soon.toISOString()}`,
      ),
    );
  for (const r of due) {
    const pinned = await loadPinned(db, r.applicationId);
    const node = pinned.config.nodes.find((n) => n.id === r.nodeId);
    if (!node || node.visibility !== "candidate") continue;
    await notify(db, [
      {
        userId: pinned.userId,
        kind: "deadline_reminder",
        title: `${pinned.roleTitle}: ${node.title} is due soon`,
        body: `Due ${formatIst(r.dueAt!)}`,
        link: `/roles/${r.applicationId}/stages/${r.nodeId}`,
      },
    ]);
    await db.update(stageProgress).set({ reminderSentAt: now }).where(eq(stageProgress.id, r.id));
  }
  return due.length;
}

/** Admin grants more time on a stage (also re-opens a missed one). */
export async function extendDeadline(db: Db, actorUserId: string, progressId: string, until: Date) {
  const [p] = await db.select().from(stageProgress).where(eq(stageProgress.id, progressId));
  if (!p) throw new Error("stage not found");
  await db
    .update(stageProgress)
    .set({
      extendedUntil: until,
      state: p.state === "missed" ? "unlocked" : p.state,
      reminderSentAt: null,
    })
    .where(eq(stageProgress.id, progressId));
  if (p.state === "missed")
    await db
      .update(applications)
      .set({ status: "active" })
      .where(eq(applications.id, p.applicationId));
  await audit(db, {
    actorUserId,
    action: "deadline_extended",
    entity: "stage_progress",
    entityId: progressId,
    after: { until: until.toISOString() },
  });
}

/** Admins, plus hiring managers who manage this role or track. Nobody else sees the name. */
export async function notifyAdmins(
  db: Db,
  pinned: Pick<PinnedApplication, "app">,
  n: { kind: string; title: string; body?: string; link?: string },
) {
  const members = await db
    .select({ id: teamMembers.id, userId: teamMembers.userId, role: teamMembers.role })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.active, true),
        or(eq(teamMembers.role, "admin"), eq(teamMembers.role, "hiring_manager")),
      ),
    );
  const scopes = await db
    .select({ teamMemberId: roleAssignments.teamMemberId, scopeId: roleAssignments.scopeId })
    .from(roleAssignments)
    .where(inArray(roleAssignments.scopeId, [pinned.app.roleId, pinned.app.workflowId]));
  const scoped = new Set(scopes.map((s) => s.teamMemberId));
  await notify(
    db,
    members
      .filter((m) => m.userId && (m.role === "admin" || scoped.has(m.id)))
      .map((m) => ({ userId: m.userId!, ...n })),
  );
}

export function stageTypeLabel(node: WorkflowNode) {
  return STAGE_TYPES[node.type].label;
}

export type { WorkflowConfig };
