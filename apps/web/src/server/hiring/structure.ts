import {
  and,
  desc,
  eq,
  inArray,
  applications,
  cycles,
  roles,
  teamMembers,
  templates,
  workflowVersions,
  workflows,
  type Db,
} from "@iclabs/db";
import {
  can,
  diffWorkflows,
  emptyWorkflow,
  validateWorkflow,
  workflowConfigSchema,
  type Actor,
  type WorkflowConfig,
} from "@iclabs/core";
import { assertCan, audit } from "../audit";

const ADMIN_ONLY = { type: "team_settings" } as const;

// ─── Roles & cycles ──────────────────────────────────────────────────────────

export async function listRolesWithCycles(db: Db, actor: Actor) {
  const rows = await db
    .select({ role: roles, cycle: cycles })
    .from(roles)
    .leftJoin(cycles, eq(cycles.roleId, roles.id))
    .orderBy(roles.title, desc(cycles.createdAt));
  const cycleIds = rows.flatMap((r) => (r.cycle ? [r.cycle.id] : []));
  const tracks = cycleIds.length
    ? await db
        .select({ id: workflows.id, name: workflows.name, cycleId: workflows.cycleId })
        .from(workflows)
        .where(inArray(workflows.cycleId, cycleIds))
        .orderBy(desc(workflows.isDefault), workflows.createdAt)
    : [];
  type CycleWithTracks = typeof cycles.$inferSelect & { tracks: { id: string; name: string }[] };
  const byRole = new Map<string, { role: typeof roles.$inferSelect; cycles: CycleWithTracks[] }>();
  for (const { role, cycle } of rows) {
    if (!can(actor, "read", { type: "workflow", roleId: role.id, workflowId: "" })) continue;
    const entry = byRole.get(role.id) ?? { role, cycles: [] };
    if (cycle)
      entry.cycles.push({
        ...cycle,
        tracks: tracks.filter((t) => t.cycleId === cycle.id).map(({ id, name }) => ({ id, name })),
      });
    byRole.set(role.id, entry);
  }
  return [...byRole.values()];
}

export type RoleInput = {
  title: string;
  slug: string;
  description?: string;
  seats?: number;
  stipend?: string;
  duration?: string;
  location?: string;
};

export async function createRole(db: Db, actor: Actor, input: RoleInput) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const [role] = await db.insert(roles).values(input).returning();
  await audit(db, {
    actorUserId: actor.userId,
    action: "role_created",
    entity: "role",
    entityId: role!.id,
    after: input,
  });
  return role!;
}

export async function updateRole(
  db: Db,
  actor: Actor,
  roleId: string,
  input: Pick<RoleInput, "title" | "slug" | "seats">,
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  const [before] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!before) return null;
  const [role] = await db
    .update(roles)
    .set({ title: input.title, slug: input.slug, seats: input.seats ?? null })
    .where(eq(roles.id, roleId))
    .returning();
  await audit(db, {
    actorUserId: actor.userId,
    action: "role_updated",
    entity: "role",
    entityId: roleId,
    before: { title: before.title, slug: before.slug, seats: before.seats },
    after: input,
  });
  return role!;
}

/**
 * Deletes a role with its rounds, tracks and process versions. Refused once anyone has applied,
 * so candidate data is never removed this way.
 */
export async function deleteRole(
  db: Db,
  actor: Actor,
  roleId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(actor, "manage", ADMIN_ONLY);
  const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
  if (!role) return { ok: false, error: "That role no longer exists." };
  const [applied] = await db
    .select({ id: applications.id })
    .from(applications)
    .where(eq(applications.roleId, roleId))
    .limit(1);
  if (applied)
    return { ok: false, error: "Candidates have applied to this role, so it can't be deleted." };

  await db.transaction(async (tx) => {
    const cycleIds = (
      await tx.select({ id: cycles.id }).from(cycles).where(eq(cycles.roleId, roleId))
    ).map((c) => c.id);
    const workflowIds = cycleIds.length
      ? (
          await tx
            .select({ id: workflows.id })
            .from(workflows)
            .where(inArray(workflows.cycleId, cycleIds))
        ).map((w) => w.id)
      : [];
    if (workflowIds.length) {
      await tx.delete(workflowVersions).where(inArray(workflowVersions.workflowId, workflowIds));
      await tx.delete(workflows).where(inArray(workflows.id, workflowIds));
    }
    if (cycleIds.length) await tx.delete(cycles).where(inArray(cycles.id, cycleIds));
    await tx.delete(roles).where(eq(roles.id, roleId));
  });
  await audit(db, {
    actorUserId: actor.userId,
    action: "role_deleted",
    entity: "role",
    entityId: roleId,
    before: { title: role.title, slug: role.slug },
  });
  return { ok: true };
}

/** A new hiring round with one default track ("Main") and an empty draft process. */
export async function createCycle(
  db: Db,
  actor: Actor,
  input: { roleId: string; name: string; opensAt?: Date; closesAt?: Date },
) {
  assertCan(actor, "write", { type: "workflow", roleId: input.roleId, workflowId: "" });
  const [cycle] = await db.insert(cycles).values(input).returning();
  await createTrack(db, actor, { cycleId: cycle!.id, name: "Main", isDefault: true });
  await audit(db, {
    actorUserId: actor.userId,
    action: "cycle_created",
    entity: "cycle",
    entityId: cycle!.id,
  });
  return cycle!;
}

export async function createTrack(
  db: Db,
  actor: Actor,
  input: { cycleId: string; name: string; isDefault?: boolean; config?: WorkflowConfig },
) {
  const cycle = await getCycle(db, input.cycleId);
  assertCan(actor, "write", { type: "workflow", roleId: cycle.roleId, workflowId: "" });
  const [workflow] = await db
    .insert(workflows)
    .values({ cycleId: input.cycleId, name: input.name, isDefault: input.isDefault ?? false })
    .returning();
  await db.insert(workflowVersions).values({
    workflowId: workflow!.id,
    version: 1,
    status: "draft",
    config: input.config ?? emptyWorkflow(),
    createdBy: actor.userId,
  });
  return workflow!;
}

export async function setCycleStatus(
  db: Db,
  actor: Actor,
  input: { cycleId: string; status: (typeof cycles.$inferSelect)["status"] },
) {
  assertCan(actor, "manage", ADMIN_ONLY);
  await db.update(cycles).set({ status: input.status }).where(eq(cycles.id, input.cycleId));
  await audit(db, {
    actorUserId: actor.userId,
    action: "cycle_status_changed",
    entity: "cycle",
    entityId: input.cycleId,
    after: { status: input.status },
  });
}

/** Copies every track's latest process into a new draft cycle. Candidates are not copied. */
export async function cloneCycle(db: Db, actor: Actor, input: { cycleId: string; name: string }) {
  const source = await getCycle(db, input.cycleId);
  assertCan(actor, "write", { type: "workflow", roleId: source.roleId, workflowId: "" });
  const [copy] = await db
    .insert(cycles)
    .values({ roleId: source.roleId, name: input.name, status: "draft" })
    .returning();
  const tracks = await db.select().from(workflows).where(eq(workflows.cycleId, source.id));
  for (const track of tracks) {
    const latest = await latestVersion(db, track.id);
    await createTrack(db, actor, {
      cycleId: copy!.id,
      name: track.name,
      isDefault: track.isDefault,
      config: (latest?.config as WorkflowConfig | undefined) ?? emptyWorkflow(),
    });
  }
  await audit(db, {
    actorUserId: actor.userId,
    action: "cycle_cloned",
    entity: "cycle",
    entityId: copy!.id,
    before: { from: source.id },
  });
  return copy!;
}

export async function getCycleDetail(db: Db, actor: Actor, cycleId: string) {
  const cycle = await getCycle(db, cycleId);
  assertCan(actor, "read", { type: "workflow", roleId: cycle.roleId, workflowId: "" });
  const [role] = await db.select().from(roles).where(eq(roles.id, cycle.roleId));
  const tracks = await db
    .select()
    .from(workflows)
    .where(eq(workflows.cycleId, cycleId))
    .orderBy(workflows.createdAt);
  return { cycle, role: role!, tracks };
}

// ─── Builder: drafts & publishing ────────────────────────────────────────────

export type BuilderData = Awaited<ReturnType<typeof getBuilderData>>;

/** Everything the canvas needs. Opening a published process starts a fresh draft from it. */
export async function getBuilderData(db: Db, actor: Actor, workflowId: string) {
  const { workflow, cycle, role } = await getWorkflowContext(db, workflowId);
  assertCan(actor, "read", { type: "workflow", roleId: role.id, workflowId });

  let draft = await latestVersion(db, workflowId, "draft");
  const published = workflow.publishedVersionId
    ? (
        await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, workflow.publishedVersionId))
      )[0]
    : undefined;
  if (!draft && can(actor, "write", { type: "workflow", roleId: role.id, workflowId })) {
    const latest = await latestVersion(db, workflowId);
    [draft] = await db
      .insert(workflowVersions)
      .values({
        workflowId,
        version: (latest?.version ?? 0) + 1,
        status: "draft",
        config: (published?.config ?? emptyWorkflow()) as Record<string, unknown>,
        createdBy: actor.userId,
      })
      .returning();
  }
  const team = await db
    .select({ id: teamMembers.id, email: teamMembers.email, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.active, true))
    .orderBy(teamMembers.email);

  return {
    workflow: { id: workflow.id, name: workflow.name },
    cycle: { id: cycle.id, name: cycle.name },
    role: { id: role.id, title: role.title },
    draft: draft
      ? {
          id: draft.id,
          version: draft.version,
          config: draft.config as WorkflowConfig,
          etag: draft.updatedAt.toISOString(),
        }
      : null,
    published: published
      ? { version: published.version, config: published.config as WorkflowConfig }
      : null,
    team,
    canEdit: can(actor, "write", { type: "workflow", roleId: role.id, workflowId }),
    canPublish: can(actor, "publish", { type: "workflow", roleId: role.id, workflowId }),
  };
}

export type SaveResult =
  { ok: true; etag: string } | { ok: false; reason: "conflict" | "invalid" | "not_draft" };

/** Autosave with optimistic concurrency: a stale etag means someone else saved first. */
export async function saveDraft(
  db: Db,
  actor: Actor,
  input: { workflowId: string; versionId: string; config: unknown; etag: string },
): Promise<SaveResult> {
  const { role } = await getWorkflowContext(db, input.workflowId);
  assertCan(actor, "write", { type: "workflow", roleId: role.id, workflowId: input.workflowId });
  const parsed = workflowConfigSchema.safeParse(input.config);
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(
      and(
        eq(workflowVersions.id, input.versionId),
        eq(workflowVersions.workflowId, input.workflowId),
      ),
    );
  if (!version || version.status !== "draft") return { ok: false, reason: "not_draft" };
  if (version.updatedAt.toISOString() !== input.etag) return { ok: false, reason: "conflict" };

  const [saved] = await db
    .update(workflowVersions)
    .set({ config: parsed.data, updatedAt: new Date() })
    .where(eq(workflowVersions.id, version.id))
    .returning({ updatedAt: workflowVersions.updatedAt });
  return { ok: true, etag: saved!.updatedAt.toISOString() };
}

export type PublishResult =
  | { ok: true; version: number; changes: string[] }
  | { ok: false; reason: "has_errors" | "not_draft"; errors?: string[] };

/**
 * Admin-only. Candidates already in the process stay pinned to the version they started on;
 * new candidates get this one.
 */
export async function publishDraft(
  db: Db,
  actor: Actor,
  input: { workflowId: string; versionId: string },
): Promise<PublishResult> {
  const { workflow, role } = await getWorkflowContext(db, input.workflowId);
  assertCan(actor, "publish", { type: "workflow", roleId: role.id, workflowId: workflow.id });

  const [draft] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, input.versionId));
  if (!draft || draft.workflowId !== workflow.id || draft.status !== "draft")
    return { ok: false, reason: "not_draft" };
  const config = workflowConfigSchema.parse(draft.config);
  const errors = validateWorkflow(config).filter((i) => i.severity === "error");
  if (errors.length > 0)
    return { ok: false, reason: "has_errors", errors: errors.map((e) => e.message) };

  const live = workflow.publishedVersionId
    ? (
        await db
          .select()
          .from(workflowVersions)
          .where(eq(workflowVersions.id, workflow.publishedVersionId))
      )[0]
    : undefined;
  const changes = diffWorkflows(live ? workflowConfigSchema.parse(live.config) : null, config);

  if (live)
    await db
      .update(workflowVersions)
      .set({ status: "superseded" })
      .where(eq(workflowVersions.id, live.id));
  await db
    .update(workflowVersions)
    .set({
      status: "published",
      publishedBy: actor.userId,
      publishedAt: new Date(),
      changeSummary: changes.join("; "),
    })
    .where(eq(workflowVersions.id, draft.id));
  await db
    .update(workflows)
    .set({ publishedVersionId: draft.id })
    .where(eq(workflows.id, workflow.id));
  await audit(db, {
    actorUserId: actor.userId,
    action: "workflow_published",
    entity: "workflow",
    entityId: workflow.id,
    after: { version: draft.version, changes },
  });
  return { ok: true, version: draft.version, changes };
}

// ─── Templates ───────────────────────────────────────────────────────────────

export async function saveWorkflowTemplate(
  db: Db,
  actor: Actor,
  input: { workflowId: string; name: string; description?: string },
) {
  const { role } = await getWorkflowContext(db, input.workflowId);
  assertCan(actor, "write", { type: "workflow", roleId: role.id, workflowId: input.workflowId });
  const latest = await latestVersion(db, input.workflowId);
  const [template] = await db
    .insert(templates)
    .values({
      kind: "workflow",
      name: input.name,
      description: input.description,
      config: latest?.config ?? emptyWorkflow(),
      createdBy: actor.userId,
    })
    .returning();
  return template!;
}

export async function listTemplates(db: Db, kind: (typeof templates.$inferSelect)["kind"]) {
  return db.select().from(templates).where(eq(templates.kind, kind)).orderBy(templates.name);
}

export async function applyTemplateToDraft(
  db: Db,
  actor: Actor,
  input: { workflowId: string; templateId: string },
): Promise<SaveResult> {
  const [template] = await db.select().from(templates).where(eq(templates.id, input.templateId));
  const draft = await latestVersion(db, input.workflowId, "draft");
  if (!template || !draft) return { ok: false, reason: "not_draft" };
  return saveDraft(db, actor, {
    workflowId: input.workflowId,
    versionId: draft.id,
    config: template.config,
    etag: draft.updatedAt.toISOString(),
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCycle(db: Db, cycleId: string) {
  const [cycle] = await db.select().from(cycles).where(eq(cycles.id, cycleId));
  if (!cycle) throw new Error("cycle not found");
  return cycle;
}

export async function getWorkflowContext(db: Db, workflowId: string) {
  const [row] = await db
    .select({ workflow: workflows, cycle: cycles, role: roles })
    .from(workflows)
    .innerJoin(cycles, eq(cycles.id, workflows.cycleId))
    .innerJoin(roles, eq(roles.id, cycles.roleId))
    .where(eq(workflows.id, workflowId));
  if (!row) throw new Error("workflow not found");
  return row;
}

async function latestVersion(db: Db, workflowId: string, status?: "draft" | "published") {
  const [row] = await db
    .select()
    .from(workflowVersions)
    .where(
      status
        ? and(eq(workflowVersions.workflowId, workflowId), eq(workflowVersions.status, status))
        : eq(workflowVersions.workflowId, workflowId),
    )
    .orderBy(desc(workflowVersions.version))
    .limit(1);
  return row;
}
