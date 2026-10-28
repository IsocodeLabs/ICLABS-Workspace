import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  applications,
  candidates,
  cycles,
  roles,
  stageProgress,
  users,
  workflowVersions,
  workflows,
  type Db,
} from "@iclabs/db";
import { entryNodeId, workflowConfigSchema, type Actor, type WorkflowConfig } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import { extendDeadline } from "../stages/progression";

const ADMIN_ONLY = { type: "team_settings" } as const;
const CLOSED = ["closed_rejected", "closed_withdrawn"] as const;
const OPEN_STATES = ["unlocked", "in_progress", "missed"] as const;
const STEP_TYPES = new Set(["form", "custom", "task", "assessment"]);

export type ExtensionTrack = {
  workflowId: string;
  label: string;
  /** Steps a candidate works on. `auto`: reached from the start without a team decision. */
  nodes: { id: string; title: string; type: string; auto: boolean; closesBy: string | null }[];
};

/** Steps reached from the entry by "always" links only, i.e. without anyone deciding. */
export function automaticSteps(config: WorkflowConfig): Set<string> {
  const nodes = new Set(config.nodes.map((n) => n.id));
  const seen = new Set<string>();
  const queue = [entryNodeId(config)];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !nodes.has(id)) continue;
    seen.add(id);
    const out = config.edges.filter((e) => e.from === id);
    // The next step is automatic only if every way out leads there unconditionally.
    for (const e of out) if ("always" in e.when && out.length === 1) queue.push(e.to);
  }
  return seen;
}

/** Published tracks that have candidates, with the steps a final extension can cover. */
export async function extensionTracks(db: Db, actor: Actor): Promise<ExtensionTrack[]> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const rows = await db
    .select({
      workflowId: workflows.id,
      track: workflows.name,
      role: roles.title,
      cycle: cycles.name,
      config: workflowVersions.config,
      stepClosesBy: workflows.stepClosesBy,
    })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .innerJoin(roles, eq(roles.id, cycles.roleId))
    .innerJoin(workflowVersions, eq(workflowVersions.id, workflows.publishedVersionId))
    .orderBy(roles.title);
  const used = new Set(
    (
      await db
        .selectDistinct({ workflowId: applications.workflowId })
        .from(applications)
        .where(eq(applications.testMode, false))
    ).map((r) => r.workflowId),
  );
  return rows
    .filter((r) => used.has(r.workflowId))
    .flatMap((r) => {
      const parsed = workflowConfigSchema.safeParse(r.config);
      if (!parsed.success) return [];
      const auto = automaticSteps(parsed.data);
      return [
        {
          workflowId: r.workflowId,
          label: `${r.role} · ${r.cycle} · ${r.track}`,
          nodes: parsed.data.nodes
            .filter((n) => n.visibility === "candidate" && STEP_TYPES.has(n.type))
            .map((n) => ({
              id: n.id,
              title: n.title,
              type: n.type,
              auto: auto.has(n.id),
              closesBy: r.stepClosesBy[n.id] ?? null,
            })),
        },
      ];
    });
}

export type ExtensionInput = { until: Date; steps: { workflowId: string; nodeIds: string[] }[] };

export type ExtensionRow = {
  progressId: string;
  workflowId: string;
  name: string;
  email: string;
  role: string;
  step: string;
  state: (typeof OPEN_STATES)[number];
  closesNow: Date | null;
  /** extend: gets the new date; reopen: was missed, gets it and reopens; keep: already later. */
  action: "extend" | "reopen" | "keep";
};

export type ExtensionPlan = {
  rows: ExtensionRow[];
  /** People who haven't reached a chosen step yet: it will close on the new date when it opens. */
  notYetOpen: { workflowId: string; role: string; step: string; people: number }[];
};

/** Who a final extension would change, and how. Changes nothing. */
export async function finalExtensionPlan(
  db: Db,
  actor: Actor,
  input: ExtensionInput,
): Promise<ExtensionPlan> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const rows: ExtensionRow[] = [];
  const notYetOpen: ExtensionPlan["notYetOpen"] = [];
  for (const { workflowId, nodeIds } of input.steps) {
    if (nodeIds.length === 0) continue;
    const titles = await stepTitles(db, workflowId);
    const found = await db
      .select({
        progress: stageProgress,
        name: candidates.name,
        email: users.email,
        role: roles.title,
      })
      .from(stageProgress)
      .innerJoin(applications, eq(applications.id, stageProgress.applicationId))
      .innerJoin(candidates, eq(candidates.id, applications.candidateId))
      .innerJoin(users, eq(users.id, candidates.userId))
      .innerJoin(roles, eq(roles.id, applications.roleId))
      .where(
        and(
          eq(applications.workflowId, workflowId),
          eq(applications.testMode, false),
          notInArray(applications.status, [...CLOSED]),
          inArray(stageProgress.nodeId, nodeIds),
          inArray(stageProgress.state, [...OPEN_STATES]),
          isNull(stageProgress.submittedAt),
        ),
      )
      .orderBy(roles.title, candidates.name);
    for (const f of found) {
      const p = f.progress;
      const closesNow = p.extendedUntil ?? p.graceUntil ?? p.dueAt;
      rows.push({
        progressId: p.id,
        workflowId,
        name: f.name,
        email: f.email,
        role: f.role,
        step: titles.get(p.nodeId) ?? p.nodeId,
        state: p.state as ExtensionRow["state"],
        closesNow,
        action:
          closesNow && closesNow >= input.until
            ? "keep"
            : p.state === "missed"
              ? "reopen"
              : "extend",
      });
    }

    const open = await db
      .select({ id: applications.id, role: roles.title })
      .from(applications)
      .innerJoin(roles, eq(roles.id, applications.roleId))
      .where(
        and(
          eq(applications.workflowId, workflowId),
          eq(applications.testMode, false),
          notInArray(applications.status, [...CLOSED]),
        ),
      );
    const reached = open.length
      ? await db
          .select({ applicationId: stageProgress.applicationId, nodeId: stageProgress.nodeId })
          .from(stageProgress)
          .where(
            and(
              inArray(
                stageProgress.applicationId,
                open.map((o) => o.id),
              ),
              inArray(stageProgress.nodeId, nodeIds),
            ),
          )
      : [];
    for (const nodeId of nodeIds) {
      const has = new Set(reached.filter((r) => r.nodeId === nodeId).map((r) => r.applicationId));
      const people = open.filter((o) => !has.has(o.id)).length;
      if (people > 0)
        notYetOpen.push({
          workflowId,
          role: open[0]!.role,
          step: titles.get(nodeId) ?? nodeId,
          people,
        });
    }
  }
  return { rows, notYetOpen };
}

/**
 * Applies the reviewed plan: each open step gets the new close (missed ones reopen; nobody's
 * date moves earlier), and the chosen steps close on that date for anyone who reaches them
 * later. Refuses if the list changed since the admin looked. Sends no email.
 */
export async function applyFinalExtension(
  db: Db,
  actor: Actor,
  input: ExtensionInput,
  reviewed: { changes: number },
): Promise<{ ok: true; extended: number; reopened: number } | { ok: false; error: string }> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const plan = await finalExtensionPlan(db, actor, input);
  const todo = plan.rows.filter((r) => r.action !== "keep");
  if (todo.length !== reviewed.changes)
    return {
      ok: false,
      error: `The list changed: ${todo.length} steps to update now, you reviewed ${reviewed.changes}. Preview again.`,
    };
  for (const r of todo) await extendDeadline(db, actor.userId, r.progressId, input.until);
  for (const { workflowId, nodeIds } of input.steps) {
    if (nodeIds.length === 0) continue;
    const [track] = await db
      .select({ stepClosesBy: workflows.stepClosesBy })
      .from(workflows)
      .where(eq(workflows.id, workflowId));
    const closesBy = { ...track?.stepClosesBy };
    for (const id of nodeIds) closesBy[id] = input.until.toISOString();
    await db.update(workflows).set({ stepClosesBy: closesBy }).where(eq(workflows.id, workflowId));
    await audit(db, {
      actorUserId: actor.userId,
      action: "final_extension_applied",
      entity: "workflow",
      entityId: workflowId,
      after: {
        until: input.until.toISOString(),
        nodeIds,
        extended: todo.filter((r) => r.workflowId === workflowId).length,
        kept: plan.rows.filter((r) => r.workflowId === workflowId && r.action === "keep").length,
      },
    });
  }
  return {
    ok: true,
    extended: todo.length,
    reopened: todo.filter((r) => r.action === "reopen").length,
  };
}

/** Step titles across every version of the track (applications are pinned to their own). */
async function stepTitles(db: Db, workflowId: string) {
  const versions = await db
    .select({ config: workflowVersions.config })
    .from(workflowVersions)
    .where(eq(workflowVersions.workflowId, workflowId));
  const titles = new Map<string, string>();
  for (const v of versions) {
    const parsed = workflowConfigSchema.safeParse(v.config);
    if (parsed.success) for (const n of parsed.data.nodes) titles.set(n.id, n.title);
  }
  return titles;
}
