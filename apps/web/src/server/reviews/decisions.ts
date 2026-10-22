import {
  and,
  desc,
  eq,
  inArray,
  applications,
  candidates,
  cycles,
  decisions,
  emailMessages,
  reviewAssignments,
  roles,
  stageProgress,
  users,
  workflowVersions,
  workflows,
  isNotNull,
  type Db,
} from "@iclabs/db";
import {
  can,
  evaluateEdges,
  workflowConfigSchema,
  type Actor,
  type RuleContext,
} from "@iclabs/core";
import { assertCan, audit } from "../audit";
import {
  advanceFrom,
  loadPinned,
  rejectApplication,
  unlockNode,
  type PinnedApplication,
  type ProgressionDeps,
} from "../stages/progression";
import { buildRuleContext, compositeFor, progressFor, stageScores } from "./context";

type TeamActor = Actor & { kind: "team" };

export type DecisionInput =
  | { action: "advance"; targetNodeId: string; note?: string }
  | { action: "complete"; note?: string }
  | { action: "reject"; note?: string }
  | { action: "hold"; note?: string }
  | { action: "reopen"; note?: string };

const scopeOf = (p: PinnedApplication) => ({
  type: "workflow" as const,
  roleId: p.app.roleId,
  workflowId: p.app.workflowId,
});

/** A person moves an application: advance to any stage, complete, reject, hold or reopen. */
export async function decide(
  db: Db,
  deps: ProgressionDeps,
  actor: TeamActor,
  applicationId: string,
  input: DecisionInput,
  via: "ui" | "mcp" = "ui",
) {
  const pinned = await loadPinned(db, applicationId);
  assertCan(actor, "write", scopeOf(pinned));
  const status = pinned.app.status;
  const from = pinned.app.currentNodeId;
  const closed =
    status === "closed_rejected" || status === "closed_withdrawn" || status === "completed";
  const note = input.note?.trim().slice(0, 2000) || null;

  if (input.action === "reopen") {
    if (status === "active") return { ok: false as const, error: "Already active." };
    if (status === "closed_withdrawn")
      return { ok: false as const, error: "The candidate withdrew." };
    // A not-progressing email that hasn't gone out yet is cancelled.
    if (status === "closed_rejected") {
      await db
        .delete(emailMessages)
        .where(
          and(
            eq(emailMessages.applicationId, applicationId),
            eq(emailMessages.templateKey, "not_progressing"),
            eq(emailMessages.status, "queued"),
          ),
        );
      if (from)
        await db
          .update(stageProgress)
          .set({ state: "reviewed" })
          .where(
            and(
              eq(stageProgress.applicationId, applicationId),
              eq(stageProgress.nodeId, from),
              eq(stageProgress.state, "failed"),
            ),
          );
    }
    // Back where they were if their stage is still open; otherwise the team decides next.
    const [current] = from
      ? await db
          .select({ state: stageProgress.state })
          .from(stageProgress)
          .where(
            and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, from)),
          )
      : [];
    const stillOpen = !!current && ["unlocked", "in_progress", "submitted"].includes(current.state);
    await db
      .update(applications)
      .set({ status: stillOpen ? "active" : "needs_decision" })
      .where(eq(applications.id, applicationId));
  } else if (closed) {
    return { ok: false as const, error: "This application is closed. Reopen it first." };
  } else if (input.action === "hold") {
    await db
      .update(applications)
      .set({ status: "on_hold" })
      .where(eq(applications.id, applicationId));
  } else if (input.action === "reject") {
    await rejectApplication(db, deps, pinned, from, { actorUserId: actor.userId, via });
  } else if (input.action === "complete") {
    if (from) await markPassed(db, applicationId, from);
    await db
      .update(applications)
      .set({ status: "completed" })
      .where(eq(applications.id, applicationId));
  } else {
    const target = pinned.config.nodes.find((n) => n.id === input.targetNodeId);
    if (!target) return { ok: false as const, error: "Pick a stage in this process." };
    if (from && from !== target.id) await markPassed(db, applicationId, from);
    // Moving back to a stage they've done re-opens it.
    await db
      .update(stageProgress)
      .set({ state: "unlocked", submittedAt: null })
      .where(
        and(eq(stageProgress.applicationId, applicationId), eq(stageProgress.nodeId, target.id)),
      );
    await db
      .update(applications)
      .set({ status: "active" })
      .where(eq(applications.id, applicationId));
    await unlockNode(db, deps, { ...pinned, app: { ...pinned.app, status: "active" } }, target.id);
    await db
      .update(applications)
      .set({ currentNodeId: target.id })
      .where(eq(applications.id, applicationId));
  }

  await db.insert(decisions).values({
    applicationId,
    fromNodeId: from,
    action: input.action,
    targetNodeId: input.action === "advance" ? input.targetNodeId : null,
    byUserId: actor.userId,
    via,
    note,
  });
  await audit(db, {
    actorUserId: actor.userId,
    via,
    action: `application_${input.action}`,
    entity: "application",
    entityId: applicationId,
    before: { status, nodeId: from },
    after: { targetNodeId: input.action === "advance" ? input.targetNodeId : undefined },
  });
  return { ok: true as const };
}

async function markPassed(db: Db, applicationId: string, nodeId: string) {
  await db
    .update(stageProgress)
    .set({ state: "passed" })
    .where(
      and(
        eq(stageProgress.applicationId, applicationId),
        eq(stageProgress.nodeId, nodeId),
        inArray(stageProgress.state, [
          "submitted",
          "reviewed",
          "unlocked",
          "in_progress",
          "missed",
        ]),
      ),
    );
}

// ─── Batch: run a stage's rules across everyone waiting there ────────────────

export type BatchRow = {
  applicationId: string;
  candidateName: string;
  score: number | null;
  rank: number;
  target: string;
  wouldReject: boolean;
};

/**
 * For ranking rules ("top 10", "top 20%"): ranks everyone decided-but-waiting at a stage by
 * composite (or rubric) score and evaluates the exit rules. Dry run shows the outcome first.
 */
export async function runRulesNow(
  db: Db,
  deps: ProgressionDeps,
  actor: TeamActor,
  workflowId: string,
  nodeId: string,
  opts: { dryRun: boolean },
): Promise<{ ok: true; rows: BatchRow[] } | { ok: false; error: string }> {
  if (actor.role !== "admin") return { ok: false, error: "Only admins can run rules in bulk." };
  const waiting = await db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(stageProgress, eq(stageProgress.applicationId, applications.id))
    .where(
      and(
        eq(applications.workflowId, workflowId),
        eq(applications.currentNodeId, nodeId),
        eq(applications.status, "needs_decision"),
        eq(stageProgress.nodeId, nodeId),
        inArray(stageProgress.state, ["reviewed", "submitted"]),
      ),
    );
  const entries: { pinned: PinnedApplication; ctx: RuleContext; score: number | null }[] = [];
  for (const w of waiting) {
    const pinned = await loadPinned(db, w.id);
    const ctx = await buildRuleContext(db, pinned, nodeId);
    const by = rankMetric(pinned, nodeId);
    const score = by === "rubric_pct" ? (ctx.rubricPct ?? null) : (ctx.composite ?? null);
    entries.push({ pinned, ctx, score });
  }
  // Highest first; unscored at the bottom; ties keep invite order.
  entries.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const rows: BatchRow[] = [];
  for (const [i, e] of entries.entries()) {
    const ctx: RuleContext = { ...e.ctx, rank: { position: i + 1, cohortSize: entries.length } };
    const decision = evaluateEdges(e.pinned.config, nodeId, ctx);
    rows.push({
      applicationId: e.pinned.app.id,
      candidateName: e.pinned.candidateName,
      score: e.score,
      rank: i + 1,
      target: decision.target,
      wouldReject: !!decision.wouldReject,
    });
    if (!opts.dryRun && decision.target !== "NEEDS_DECISION") {
      await advanceFrom(db, deps, e.pinned.app.id, nodeId, ctx, "rule");
    }
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: opts.dryRun ? "rules_dry_run" : "rules_run",
    entity: "workflow",
    entityId: workflowId,
    after: { nodeId, count: rows.length },
  });
  return { ok: true, rows };
}

function rankMetric(pinned: PinnedApplication, nodeId: string): "rubric_pct" | "composite" {
  for (const e of pinned.config.edges) {
    if (e.from !== nodeId || "always" in e.when) continue;
    const found = JSON.stringify(e.when).match(/"by":"(rubric_pct|composite)"/);
    if (found) return found[1] as "rubric_pct" | "composite";
  }
  return "composite";
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export type PipelineCard = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  email: string;
  status: (typeof applications.$inferSelect)["status"];
  currentNodeId: string | null;
  progressId: string | null;
  stageState: string | null;
  dueAt: Date | null;
  composite: number | null;
  openReviews: number;
  invitedAt: Date;
};

/** Tracks with a published process that the actor may see, for the pipeline picker. */
export async function listTracks(db: Db, actor: TeamActor) {
  const rows = await db
    .select({
      id: workflows.id,
      name: workflows.name,
      cycleName: cycles.name,
      roleId: roles.id,
      roleTitle: roles.title,
    })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .innerJoin(roles, eq(roles.id, cycles.roleId))
    .where(isNotNull(workflows.publishedVersionId))
    .orderBy(roles.title, desc(cycles.createdAt), workflows.name);
  return rows.filter((r) =>
    can(actor, "read", { type: "workflow", roleId: r.roleId, workflowId: r.id }),
  );
}

/** Everyone in one track, with their current stage and composite score. */
export async function getPipeline(db: Db, actor: TeamActor, workflowId: string) {
  const [track] = await db
    .select({ wf: workflows, roleId: cycles.roleId, config: workflowVersions.config })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .leftJoin(workflowVersions, eq(workflowVersions.id, workflows.publishedVersionId))
    .where(eq(workflows.id, workflowId));
  if (!track) return null;
  assertCan(actor, "read", { type: "workflow", roleId: track.roleId, workflowId });
  const config = track.config ? workflowConfigSchema.parse(track.config) : null;
  const nodes = (config?.nodes ?? []).map((n) => ({ id: n.id, title: n.title, type: n.type }));
  const rows = await db
    .select({
      app: applications,
      name: candidates.name,
      email: users.email,
      roleTitle: roles.title,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(eq(applications.workflowId, workflowId))
    .orderBy(desc(applications.invitedAt));
  if (rows.length === 0) return { cards: [] as PipelineCard[], nodes, track: track.wf };

  const progress = await progressFor(
    db,
    rows.map((r) => r.app.id),
  );
  const open = await db
    .select({ applicationId: reviewAssignments.applicationId })
    .from(reviewAssignments)
    .where(
      and(
        inArray(
          reviewAssignments.applicationId,
          rows.map((r) => r.app.id),
        ),
        eq(reviewAssignments.status, "assigned"),
      ),
    );
  const cards: PipelineCard[] = [];
  for (const r of rows) {
    const pinned = r.app.workflowVersionId
      ? await loadPinned(db, r.app.id).catch(() => null)
      : null;
    const composite = pinned ? compositeFor(pinned.config, await stageScores(db, pinned)) : null;
    const current = progress.find(
      (p) => p.applicationId === r.app.id && p.nodeId === r.app.currentNodeId,
    );
    cards.push({
      applicationId: r.app.id,
      candidateId: r.app.candidateId,
      candidateName: r.name,
      email: r.email,
      status: r.app.status,
      currentNodeId: r.app.currentNodeId,
      progressId: current?.id ?? null,
      stageState: current?.state ?? null,
      dueAt: current?.extendedUntil ?? current?.dueAt ?? null,
      composite,
      openReviews: open.filter((o) => o.applicationId === r.app.id).length,
      invitedAt: r.app.invitedAt,
    });
  }
  return { cards, nodes, track: track.wf };
}

/** Decisions and reviewer names for one application's history panel. */
export async function decisionHistory(db: Db, applicationId: string) {
  return db
    .select({ d: decisions, by: users.email })
    .from(decisions)
    .leftJoin(users, eq(users.id, decisions.byUserId))
    .where(eq(decisions.applicationId, applicationId))
    .orderBy(desc(decisions.at));
}
