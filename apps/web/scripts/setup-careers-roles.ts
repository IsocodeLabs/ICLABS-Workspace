/**
 * Idempotent: makes sure each role on careers.isocodelabs.com exists in the workspace with the
 * same slug, an open round and a published track, so "Invite to workspace" on the careers
 * screening desk has somewhere to land.
 *
 * - PM and SDE get their full process (src/server/hiring/role-processes.ts). It is published over
 *   a track only while that track is still the untouched one-form starter; a track anyone has
 *   edited in the Process Builder is left exactly as it is.
 * - Both processes are also saved as Process Builder templates, kept in sync by name.
 * - Other roles get the one-form starter if they have nothing published yet.
 *
 * Runs after migrations in the migrate job; by hand: `pnpm --filter @iclabs/web setup-roles`
 */
import { and, asc, desc, eq, inArray, createDb, cycles, roles, teamMembers, templates } from "@iclabs/db";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { inviterActor } from "../src/server/integrations/careers";
import { ROLE_PROCESSES } from "../src/server/hiring/role-processes";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
  setCycleStatus,
} from "../src/server/hiring/structure";

const CAREERS_ROLES = [
  { slug: "software-engineering-intern", title: "Software Engineering Intern" },
  { slug: "product-manager-intern", title: "Product Management Intern" },
  { slug: "business-growth-intern", title: "Business Growth Intern (Sales)" },
];

function starterTrack(): WorkflowConfig {
  const form = createNode("form", { id: "details", title: "Your details" });
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
}

/** Nothing anyone would miss: no stages, or the one empty "Your details" form. */
function isUntouchedStarter(config: unknown): boolean {
  const c = config as Partial<WorkflowConfig> | undefined;
  if (!c?.nodes || c.nodes.length === 0) return true;
  const [only] = c.nodes;
  return c.nodes.length === 1 && only!.id === "details" && only!.type === "form" && only!.config.fields.length === 0;
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url, { max: 1 });
const actor = await inviterActor(db);
if (!actor || actor.kind !== "team") throw new Error("No active admin to act as");

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

  if (full) {
    const config = full.build(pool) as unknown as Record<string, unknown>;
    const [existing] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(and(eq(templates.kind, "workflow"), eq(templates.name, full.template)));
    if (existing) await db.update(templates).set({ config, description: full.description }).where(eq(templates.id, existing.id));
    else await db.insert(templates).values({ kind: "workflow", name: full.template, description: full.description, config, createdBy: actor.userId });
  }

  let [role] = await db.select().from(roles).where(eq(roles.slug, want.slug));
  if (!role) {
    role = await createRole(db, actor, want);
    console.log(`created role ${want.slug}`);
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
    console.log(`opened round for ${want.slug}`);
  }

  const { tracks } = await getCycleDetail(db, actor, cycle!.id);
  const track = tracks.find((t) => t.isDefault) ?? tracks[0];
  if (!track) throw new Error(`${want.slug}: round has no track`);
  const data = await getBuilderData(db, actor, track.id);
  const published = data.published?.config;
  const untouched = isUntouchedStarter(published) && isUntouchedStarter(data.draft?.config);
  if (!untouched || (track.publishedVersionId && !full)) {
    console.log(`${want.slug}: track already set up; left as is`);
    continue;
  }
  const saved = await saveDraft(db, actor, {
    workflowId: track.id,
    versionId: data.draft!.id,
    config: full ? full.build(pool) : starterTrack(),
    etag: data.draft!.etag,
  });
  if (!saved.ok) throw new Error(`${want.slug}: save failed (${saved.reason})`);
  const result = await publishDraft(db, actor, { workflowId: track.id, versionId: data.draft!.id });
  if (!result.ok) throw new Error(`${want.slug}: publish failed (${result.errors?.join("; ") ?? result.reason})`);
  console.log(`${want.slug}: ${full ? "full process" : "starter track"} published`);
}
console.log("Careers roles ready");
process.exit(0);
