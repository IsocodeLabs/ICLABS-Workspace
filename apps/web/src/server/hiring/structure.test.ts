import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, auditLog, workflowVersions, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { ForbiddenError } from "../audit";
import {
  cloneCycle,
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  listRolesWithCycles,
  publishDraft,
  saveDraft,
} from "./structure";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

function publishable(): WorkflowConfig {
  const form = createNode("form", { id: "form", title: "Details" });
  const interview = createNode("interview", { id: "int", title: "Founder call" });
  interview.config.interviewerPool = ["someone"];
  return {
    ...emptyWorkflow(),
    nodes: [form, interview],
    edges: [
      { id: "e1", from: "form", to: "int", priority: 0, when: { always: true } },
      { id: "e2", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } },
    ],
  };
}

async function setup() {
  const admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, {
    title: "SDE Intern",
    slug: `sde-${Date.now()}-${Math.random()}`,
  });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "Cycle 1" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  return { admin, role, cycle, track: tracks[0]! };
}

describe("roles and cycles", () => {
  it("creates a cycle with a default Main track and an empty draft", async () => {
    const { admin, track } = await setup();
    expect(track).toMatchObject({ name: "Main", isDefault: true });
    const data = await getBuilderData(db, admin, track.id);
    expect(data.draft?.config.nodes).toEqual([]);
    expect(data.canPublish).toBe(true);
  });

  it("only lets admins create roles", async () => {
    const hm = await teamActor(db, "hiring_manager");
    await expect(createRole(db, hm, { title: "X", slug: "x" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("scopes the role list for hiring managers", async () => {
    const { role } = await setup();
    const other = await setup();
    const hm = await teamActor(db, "hiring_manager", { roleIds: [role.id] });
    const visible = (await listRolesWithCycles(db, hm)).map((r) => r.role.id);
    expect(visible).toContain(role.id);
    expect(visible).not.toContain(other.role.id);
  });
});

describe("drafts and publishing", () => {
  it("saves drafts with optimistic concurrency", async () => {
    const { admin, track } = await setup();
    const { draft } = await getBuilderData(db, admin, track.id);
    const first = await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: draft!.id,
      config: publishable(),
      etag: draft!.etag,
    });
    expect(first.ok).toBe(true);
    // A second tab still holding the old etag loses the race instead of overwriting.
    const stale = await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: draft!.id,
      config: emptyWorkflow(),
      etag: draft!.etag,
    });
    expect(stale).toEqual({ ok: false, reason: "conflict" });
  });

  it("refuses configs that don't match the schema", async () => {
    const { admin, track } = await setup();
    const { draft } = await getBuilderData(db, admin, track.id);
    const result = await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: draft!.id,
      config: { nodes: "nope" },
      etag: draft!.etag,
    });
    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  it("blocks publishing while the process has errors", async () => {
    const { admin, track } = await setup();
    const { draft } = await getBuilderData(db, admin, track.id);
    const result = await publishDraft(db, admin, { workflowId: track.id, versionId: draft!.id });
    expect(result).toMatchObject({ ok: false, reason: "has_errors" });
  });

  it("lets hiring managers edit drafts but never publish", async () => {
    const { role, track } = await setup();
    const hm = await teamActor(db, "hiring_manager", { roleIds: [role.id] });
    const { draft, canEdit, canPublish } = await getBuilderData(db, hm, track.id);
    expect(canEdit).toBe(true);
    expect(canPublish).toBe(false);
    expect(
      (
        await saveDraft(db, hm, {
          workflowId: track.id,
          versionId: draft!.id,
          config: publishable(),
          etag: draft!.etag,
        })
      ).ok,
    ).toBe(true);
    await expect(
      publishDraft(db, hm, { workflowId: track.id, versionId: draft!.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("publishes, supersedes the previous version, and opens a fresh draft next time", async () => {
    const { admin, track } = await setup();
    let data = await getBuilderData(db, admin, track.id);
    await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: data.draft!.id,
      config: publishable(),
      etag: data.draft!.etag,
    });
    const v1 = await publishDraft(db, admin, { workflowId: track.id, versionId: data.draft!.id });
    expect(v1).toEqual({ ok: true, version: 1, changes: ["New process with 2 stages"] });

    data = await getBuilderData(db, admin, track.id);
    expect(data.draft?.version).toBe(2);
    expect(data.published?.version).toBe(1);
    const renamed = structuredClone(data.draft!.config);
    renamed.nodes[0]!.title = "Your details";
    await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: data.draft!.id,
      config: renamed,
      etag: data.draft!.etag,
    });
    const v2 = await publishDraft(db, admin, { workflowId: track.id, versionId: data.draft!.id });
    expect(v2).toEqual({ ok: true, version: 2, changes: ['Renamed "Details" to "Your details"'] });

    const versions = await db
      .select()
      .from(workflowVersions)
      .where(eq(workflowVersions.workflowId, track.id));
    expect(versions.map((v) => [v.version, v.status]).sort()).toEqual([
      [1, "superseded"],
      [2, "published"],
    ]);
    const logged = await db.select().from(auditLog).where(eq(auditLog.entityId, track.id));
    expect(logged.filter((l) => l.action === "workflow_published")).toHaveLength(2);
  });

  it("clones a cycle with its processes as drafts", async () => {
    const { admin, cycle, track } = await setup();
    const data = await getBuilderData(db, admin, track.id);
    await saveDraft(db, admin, {
      workflowId: track.id,
      versionId: data.draft!.id,
      config: publishable(),
      etag: data.draft!.etag,
    });
    const copy = await cloneCycle(db, admin, { cycleId: cycle.id, name: "Cycle 2" });
    const [copiedTrack] = await db.select().from(workflows).where(eq(workflows.cycleId, copy.id));
    const copied = await getBuilderData(db, admin, copiedTrack!.id);
    expect(copy.status).toBe("draft");
    expect(copied.draft?.config.nodes.map((n) => n.title)).toEqual(["Details", "Founder call"]);
    expect(copied.published).toBeNull();
  });
});
