import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  ne,
  applications,
  assessmentSessions,
  auditLog,
  cycles,
  roles,
  stageProgress,
  submissions,
  teamMembers,
  templates,
  workflows,
  type Db,
} from "@iclabs/db";
import { createNode, emptyWorkflow, type Actor, type WorkflowConfig } from "@iclabs/core";
import { audit } from "../audit";
import { startApplication, versionConfig } from "../stages/progression";
import { ROLE_PROCESSES } from "./role-processes";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
  setCycleStatus,
} from "./structure";

export const CAREERS_ROLES = [
  { slug: "software-engineering-intern", title: "Software Engineering Intern" },
  { slug: "product-manager-intern", title: "Product Management Intern" },
  { slug: "business-growth-intern", title: "Business Growth Intern (Sales)" },
];

/** Recorded once per track, so later edits in the builder are never overwritten. */
export const INSTALLED = "role_process_installed";

function starterTrack(): WorkflowConfig {
  const form = createNode("form", { id: "details", title: "Your details" });
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
}

const hasProcess = (config: unknown) =>
  !!(config as WorkflowConfig | undefined)?.nodes?.some((n) => n.id === "how_you_think");

/**
 * Makes sure each careers role exists with an open round and a published track.
 *
 * PM and SDE get their full process once per track: it replaces whatever the track had (a new
 * published version; the old one stays in history), and candidates on that track who haven't
 * submitted anything yet move to it and start again at the first stage. Anyone who has submitted
 * keeps their version. After that the track is the team's: later builder edits are left alone.
 * Other roles get the one-form starter if nothing is published. Safe to run on every deploy.
 */
export async function setupCareersRoles(
  db: Db,
  actor: Actor & { kind: "team" },
  log: (msg: string) => void = console.log,
) {
  // Interviews need a pool to publish: start with the active admins and interviewers.
  const pool = (
    await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.active, true), inArray(teamMembers.role, ["admin", "interviewer"])))
      .orderBy(asc(teamMembers.createdAt))
  ).map((m) => m.id);

  for (const want of CAREERS_ROLES) {
    const full = ROLE_PROCESSES[want.slug];
    if (full) await syncTemplate(db, actor, full.template, full.description, full.build(pool));

    const { role, duplicate } = await findRole(db, want);
    const real = role ?? (await createRole(db, actor, want));
    if (!role) log(`created role ${want.slug}`);
    const track = await openTrack(db, actor, real, want.slug, log);

    if (full) await installOnce(db, actor, want.slug, track.id, full.build(pool), log);
    else if (!track.publishedVersionId) {
      await publish(db, actor, track.id, starterTrack());
      log(`${want.slug}: starter track published`);
    } else log(`${want.slug}: track already set up; left as is`);

    if (duplicate) await retireDuplicate(db, actor, duplicate, real.id, track.id, want.slug, log);
  }
}

/**
 * The team's role for a careers role: the oldest active role with its title, else the one with its
 * slug. A newer role holding the careers slug next to an older same-titled one is a duplicate
 * (an earlier version of this setup created those) and is folded into the real one.
 */
async function findRole(db: Db, want: { slug: string; title: string }) {
  const titled = await db
    .select()
    .from(roles)
    .where(
      and(ilike(roles.title, want.title.replace(/[\\%_]/g, "\\$&")), eq(roles.status, "active")),
    )
    .orderBy(asc(roles.createdAt));
  const [bySlug] = await db.select().from(roles).where(eq(roles.slug, want.slug));
  const role = titled[0] ?? bySlug ?? null;
  const duplicate = bySlug && role && bySlug.id !== role.id ? bySlug : null;
  return { role, duplicate };
}

/** Where the role's invites go: its newest open round's default track (a round is opened if none). */
async function openTrack(
  db: Db,
  actor: Actor,
  role: typeof roles.$inferSelect,
  slug: string,
  log: (msg: string) => void,
) {
  let [cycle] = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.roleId, role.id), eq(cycles.status, "open")))
    .orderBy(desc(cycles.createdAt))
    .limit(1);
  if (!cycle) {
    cycle = await createCycle(db, actor, { roleId: role.id, name: "October 2026" });
    await setCycleStatus(db, actor, { cycleId: cycle!.id, status: "open" });
    log(`opened round for ${slug}`);
  }
  const { tracks } = await getCycleDetail(db, actor, cycle!.id);
  const track = tracks.find((t) => t.isDefault) ?? tracks[0];
  if (!track) throw new Error(`${slug}: round has no track`);
  return track;
}

/** Publishes the full process on a track once (recorded in the audit log) and moves unstarted candidates. */
async function installOnce(
  db: Db,
  actor: Actor & { kind: "team" },
  slug: string,
  trackId: string,
  config: WorkflowConfig,
  log: (msg: string) => void,
) {
  const [done] = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(and(eq(auditLog.action, INSTALLED), eq(auditLog.entityId, trackId)))
    .limit(1);
  if (done) {
    log(`${slug}: process installed earlier on track ${trackId}; left as is`);
    return;
  }
  const data = await getBuilderData(db, actor, trackId);
  const already = hasProcess(data.published?.config);
  if (!already) await publish(db, actor, trackId, config);
  const [wf] = await db
    .select({ versionId: workflows.publishedVersionId })
    .from(workflows)
    .where(eq(workflows.id, trackId));
  const moved = await moveUnstarted(db, trackId, wf!.versionId!);
  await audit(db, {
    actorUserId: actor.userId,
    via: "system",
    action: INSTALLED,
    entity: "workflow",
    entityId: trackId,
    after: { role: slug, versionId: wf!.versionId, movedCandidates: moved },
  });
  log(
    `${slug}: ${already ? "process was already there" : "process published"} on track ${trackId}; ${moved} candidate(s) moved to it`,
  );
}

const isEmptyStarter = (c: WorkflowConfig) =>
  c.nodes.length === 1 && c.nodes[0]!.type === "form" && c.nodes[0]!.config.fields.length === 0;

/**
 * Folds a duplicate role into the real one: its candidates move to the real role's track, then
 * it loses the careers slug (so careers invites match the real role again), and, once empty, is
 * renamed, archived and its rounds closed. Candidates on an empty starter form restart on the real
 * process (they had nothing to lose); others keep their progress when the real track has the same
 * stages, and otherwise stay put.
 */
async function retireDuplicate(
  db: Db,
  actor: Actor & { kind: "team" },
  dup: typeof roles.$inferSelect,
  realRoleId: string,
  realTrackId: string,
  slug: string,
  log: (msg: string) => void,
) {
  const [target] = await db
    .select({ versionId: workflows.publishedVersionId })
    .from(workflows)
    .where(eq(workflows.id, realTrackId));
  if (!target?.versionId) throw new Error(`${slug}: the real track isn't published`);
  const realStages = new Set((await versionConfig(db, target.versionId)).nodes.map((n) => n.id));
  const deps = { queueEmail: async () => "", appUrl: (p: string) => p };
  const repin = {
    roleId: realRoleId,
    workflowId: realTrackId,
    workflowVersionId: target.versionId,
  };

  let moved = 0;
  let kept = 0;
  for (const app of await db.select().from(applications).where(eq(applications.roleId, dup.id))) {
    const config = app.workflowVersionId ? await versionConfig(db, app.workflowVersionId) : null;
    const progress = await db
      .select()
      .from(stageProgress)
      .where(eq(stageProgress.applicationId, app.id));
    const [clash] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.candidateId, app.candidateId),
          eq(applications.workflowId, realTrackId),
        ),
      );
    if (!config || isEmptyStarter(config)) {
      if (clash) await db.delete(applications).where(eq(applications.id, app.id));
      else {
        await db.delete(stageProgress).where(eq(stageProgress.applicationId, app.id));
        await db
          .update(applications)
          .set({ ...repin, currentNodeId: null, status: "active" })
          .where(eq(applications.id, app.id));
        await startApplication(db, deps, app.id);
      }
      moved++;
    } else if (!clash && progress.every((p) => realStages.has(p.nodeId))) {
      await db.update(applications).set(repin).where(eq(applications.id, app.id));
      moved++;
    } else kept++;
  }

  const empty = kept === 0;
  await db
    .update(roles)
    .set({
      slug: `${dup.slug}-unused-${dup.id.slice(-6).toLowerCase()}`,
      ...(empty ? { title: `${dup.title} (unused duplicate)`, status: "archived" as const } : {}),
    })
    .where(eq(roles.id, dup.id));
  if (empty)
    await db
      .update(cycles)
      .set({ status: "closed" })
      .where(and(eq(cycles.roleId, dup.id), eq(cycles.status, "open")));
  await audit(db, {
    actorUserId: actor.userId,
    via: "system",
    action: "role_duplicate_retired",
    entity: "role",
    entityId: dup.id,
    after: { slug, intoRole: realRoleId, movedCandidates: moved, keptCandidates: kept },
  });
  log(
    `${slug}: duplicate role ${dup.id} retired; ${moved} candidate(s) moved to the real role, ${kept} left on it`,
  );
}

async function publish(db: Db, actor: Actor, workflowId: string, config: WorkflowConfig) {
  const data = await getBuilderData(db, actor, workflowId);
  const saved = await saveDraft(db, actor, {
    workflowId,
    versionId: data.draft!.id,
    config,
    etag: data.draft!.etag,
  });
  if (!saved.ok) throw new Error(`${workflowId}: save failed (${saved.reason})`);
  const result = await publishDraft(db, actor, { workflowId, versionId: data.draft!.id });
  if (!result.ok)
    throw new Error(
      `${workflowId}: publish failed (${result.errors?.join("; ") ?? result.reason})`,
    );
}

async function syncTemplate(
  db: Db,
  actor: Actor & { kind: "team" },
  name: string,
  description: string,
  config: WorkflowConfig,
) {
  const value = config as unknown as Record<string, unknown>;
  const [existing] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.kind, "workflow"), eq(templates.name, name)));
  if (existing)
    await db
      .update(templates)
      .set({ config: value, description })
      .where(eq(templates.id, existing.id));
  else
    await db
      .insert(templates)
      .values({ kind: "workflow", name, description, config: value, createdBy: actor.userId });
}

/**
 * Re-pins active candidates who haven't submitted anything to `versionId` and opens its first
 * stage with a fresh deadline. Their unsent drafts on the old stages are dropped.
 */
async function moveUnstarted(db: Db, workflowId: string, versionId: string) {
  const apps = await db
    .select({ id: applications.id })
    .from(applications)
    .where(
      and(
        eq(applications.workflowId, workflowId),
        eq(applications.status, "active"),
        ne(applications.workflowVersionId, versionId),
      ),
    );
  // Nothing is emailed: unlocking the first stage only notifies in the app.
  const deps = { queueEmail: async () => "", appUrl: (p: string) => p };
  let moved = 0;
  for (const { id } of apps) {
    const progress = await db
      .select()
      .from(stageProgress)
      .where(eq(stageProgress.applicationId, id));
    if (progress.some((p) => p.state !== "unlocked" && p.state !== "in_progress")) continue;
    const ids = progress.map((p) => p.id);
    if (ids.length) {
      const [sub] = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(inArray(submissions.stageProgressId, ids))
        .limit(1);
      const [session] = await db
        .select({ id: assessmentSessions.id })
        .from(assessmentSessions)
        .where(inArray(assessmentSessions.stageProgressId, ids))
        .limit(1);
      if (sub || session) continue;
    }
    await db.transaction(async (tx) => {
      await tx.delete(stageProgress).where(eq(stageProgress.applicationId, id));
      await tx
        .update(applications)
        .set({ workflowVersionId: versionId, currentNodeId: null })
        .where(eq(applications.id, id));
      await startApplication(tx as unknown as Db, deps, id);
    });
    moved++;
  }
  return moved;
}
