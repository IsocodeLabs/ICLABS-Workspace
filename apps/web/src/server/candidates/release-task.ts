import {
  and,
  eq,
  inArray,
  sql,
  applications,
  candidates,
  cycles,
  roles,
  stageProgress,
  users,
  workflows,
  type Db,
} from "@iclabs/db";
import { formatIst, type Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import {
  loadPinned,
  unlockNode,
  versionConfig,
  type ProgressionDeps,
} from "../stages/progression";

const ADMIN_ONLY = { type: "team_settings" } as const;
const TASK = "task";
const EARLIER = ["details", "how_you_think"] as const;

export type Candidate = {
  applicationId: string;
  name: string;
  email: string;
  roleTitle: string;
};

/** Tracks whose published process has the earlier steps and a task, for the picker. */
export async function listReleaseTracks(db: Db, actor: Actor) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const rows = await db
    .select({
      workflowId: workflows.id,
      track: workflows.name,
      role: roles.title,
      cycle: cycles.name,
      versionId: workflows.publishedVersionId,
    })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .innerJoin(roles, eq(roles.id, cycles.roleId))
    .orderBy(roles.title);
  const out: { workflowId: string; label: string }[] = [];
  for (const r of rows) {
    if (!r.versionId) continue;
    const ids = new Set((await versionConfig(db, r.versionId)).nodes.map((n) => n.id));
    if ([...EARLIER, TASK].every((id) => ids.has(id)))
      out.push({ workflowId: r.workflowId, label: `${r.role} · ${r.cycle} · ${r.track}` });
  }
  return out;
}

async function publishedVersion(db: Db, workflowId: string) {
  const [wf] = await db
    .select({ versionId: workflows.publishedVersionId })
    .from(workflows)
    .where(eq(workflows.id, workflowId));
  if (!wf?.versionId) throw new Error("This track has no published process.");
  const ids = new Set((await versionConfig(db, wf.versionId)).nodes.map((n) => n.id));
  for (const id of [...EARLIER, TASK])
    if (!ids.has(id)) throw new Error(`The published process has no "${id}" step.`);
  return wf.versionId;
}

/**
 * Everyone who would get the task right now: they submitted both earlier steps (their details and
 * the written questions), their application is open, they're not a test account, and the task
 * isn't open for them yet. Anyone else never sees the task.
 */
export async function taskReleaseAudience(
  db: Db,
  actor: Actor,
  workflowId: string,
): Promise<Candidate[]> {
  assertCan(actor, "manage", ADMIN_ONLY);
  await publishedVersion(db, workflowId);
  const submitted = (node: string) =>
    sql`exists (select 1 from ${stageProgress} sp where sp.application_id = ${applications.id} and sp.node_id = ${node} and sp.submitted_at is not null)`;
  const hasTask = sql`exists (select 1 from ${stageProgress} sp where sp.application_id = ${applications.id} and sp.node_id = ${TASK})`;
  return db
    .select({
      applicationId: applications.id,
      name: candidates.name,
      email: users.email,
      roleTitle: roles.title,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(users, eq(users.id, candidates.userId))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(
      and(
        eq(applications.workflowId, workflowId),
        eq(applications.testMode, false),
        inArray(applications.status, ["active", "needs_decision"]),
        submitted(EARLIER[0]),
        submitted(EARLIER[1]),
        sql`not ${hasTask}`,
      ),
    )
    .orderBy(candidates.name);
}

/**
 * Opens the task for each person in the audience, with the track's current deadline, moves them to
 * the track's latest published process (their earlier answers stay as they were), and queues one
 * email each. Safe to run twice: a person with the task open is no longer in the audience.
 */
export async function releaseTask(
  db: Db,
  deps: ProgressionDeps,
  actor: Actor,
  input: { workflowId: string },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const versionId = await publishedVersion(db, input.workflowId);
  const audience = await taskReleaseAudience(db, actor, input.workflowId);
  let released = 0;
  for (const a of audience) {
    await db
      .update(applications)
      .set({ workflowVersionId: versionId })
      .where(eq(applications.id, a.applicationId));
    const pinned = await loadPinned(db, a.applicationId);
    await unlockNode(db, deps, pinned, TASK);
    const [row] = await db
      .select({ dueAt: stageProgress.dueAt })
      .from(stageProgress)
      .where(
        and(eq(stageProgress.applicationId, a.applicationId), eq(stageProgress.nodeId, TASK)),
      );
    await deps.queueEmail({
      to: a.email,
      templateKey: "task_released",
      userId: pinned.userId,
      applicationId: a.applicationId,
      vars: {
        first_name: a.name.trim().split(/\s+/)[0] ?? a.name,
        role: a.roleTitle,
        deadline: row?.dueAt ? formatIst(row.dueAt) : "the deadline shown in your workspace",
        stage_url: deps.appUrl(`/roles/${a.applicationId}/stages/${TASK}`),
      },
    });
    released++;
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: "task_released",
    entity: "workflow",
    entityId: input.workflowId,
    after: { released, versionId },
  });
  return { released };
}
