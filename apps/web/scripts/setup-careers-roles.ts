/**
 * One-off, idempotent: makes sure each role on careers.isocodelabs.com exists in the workspace
 * with the same slug, an open round and a published starter track, so "Invite to workspace"
 * on the careers screening desk has somewhere to land. Existing roles, rounds and published
 * tracks are left exactly as they are. The starter track is one "Your details" form; edit it
 * in the builder afterwards.
 *
 * Run as the migrate job: `pnpm --filter @iclabs/web exec tsx scripts/setup-careers-roles.ts`
 */
import { and, desc, eq, createDb, cycles, roles } from "@iclabs/db";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { inviterActor } from "../src/server/integrations/careers";
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

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const db = createDb(url, { max: 1 });
const actor = await inviterActor(db);
if (!actor) throw new Error("No active admin to act as");

for (const want of CAREERS_ROLES) {
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
  if (track.publishedVersionId) {
    console.log(`${want.slug}: track already published`);
    continue;
  }
  const data = await getBuilderData(db, actor, track.id);
  const saved = await saveDraft(db, actor, {
    workflowId: track.id,
    versionId: data.draft!.id,
    config: starterTrack(),
    etag: data.draft!.etag,
  });
  if (!saved.ok) throw new Error(`${want.slug}: save failed (${saved.reason})`);
  const published = await publishDraft(db, actor, { workflowId: track.id, versionId: data.draft!.id });
  if (!published.ok) throw new Error(`${want.slug}: publish failed (${published.errors?.join("; ") ?? published.reason})`);
  console.log(`${want.slug}: starter track published`);
}
console.log("Careers roles ready");
process.exit(0);
