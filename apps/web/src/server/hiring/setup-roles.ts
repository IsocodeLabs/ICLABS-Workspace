import {
  and,
  asc,
  desc,
  eq,
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
import { startApplication } from "../stages/progression";
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

    let [role] = await db.select().from(roles).where(eq(roles.slug, want.slug));
    if (!role) {
      role = await createRole(db, actor, want);
      log(`created role ${want.slug}`);
    }
    let [cycle] = await db
      .select()
      .from(cycles)
      .where(and(eq(cycles.roleId, role!.id), eq(cycles.status, "open")))
      .orderBy(desc(cycles.createdAt))
      .limit(1);
    if (!cycle) {
      cycle = await createCycle(db, actor, { roleId: role!.id, name: "October 2026" });
      await setCycleStatus(db, actor, { cycleId: cycle!.id, status: "open" });
      log(`opened round for ${want.slug}`);
    }
    const { tracks } = await getCycleDetail(db, actor, cycle!.id);
    const track = tracks.find((t) => t.isDefault) ?? tracks[0];
    if (!track) throw new Error(`${want.slug}: round has no track`);

    if (!full) {
      if (track.publishedVersionId) {
        log(`${want.slug}: track already set up; left as is`);
        continue;
      }
      await publish(db, actor, track.id, starterTrack());
      log(`${want.slug}: starter track published`);
      continue;
    }

    const [done] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, INSTALLED), eq(auditLog.entityId, track.id)))
      .limit(1);
    if (done) {
      log(`${want.slug}: process installed earlier; left as is`);
      continue;
    }
    const data = await getBuilderData(db, actor, track.id);
    if (!hasProcess(data.published?.config)) await publish(db, actor, track.id, full.build(pool));
    const [wf] = await db
      .select({ versionId: workflows.publishedVersionId })
      .from(workflows)
      .where(eq(workflows.id, track.id));
    const moved = await moveUnstarted(db, track.id, wf!.versionId!);
    await audit(db, {
      actorUserId: actor.userId,
      via: "system",
      action: INSTALLED,
      entity: "workflow",
      entityId: track.id,
      after: { role: want.slug, versionId: wf!.versionId, movedCandidates: moved },
    });
    log(`${want.slug}: process published; ${moved} candidate(s) moved to it`);
  }
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
