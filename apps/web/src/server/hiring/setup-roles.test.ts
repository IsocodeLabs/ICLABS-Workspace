import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, applications, stageProgress, templates, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { loadActor } from "../auth/actor";
import { createCandidateAccount } from "../auth/candidate-auth";
import { submitForm } from "../stages/candidate";
import { loadPinned, startApplication } from "../stages/progression";
import { setupCareersRoles } from "./setup-roles";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
  setCycleStatus,
} from "./structure";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const deps = { queueEmail: async () => "", appUrl: (p: string) => p };
const quiet = () => {};

// What production had: PM's track edited in the builder (a one-question details form).
function editedTrack(): WorkflowConfig {
  const form = createNode("form", { id: "details", title: "Your details" });
  form.config.fields = [{ id: "why", label: "Why PM?", kind: "long_text", required: true }];
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
}

async function invite(trackId: string, roleId: string) {
  const c = await createCandidateAccount(db, {
    email: `c${Math.random()}@x.com`,
    name: "Kavya Iyer",
  });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, trackId));
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId,
      workflowId: trackId,
      workflowVersionId: wf!.publishedVersionId,
    })
    .returning();
  await startApplication(db, deps, app!.id);
  const actor = (await loadActor(db, c.userId)) as Extract<
    Awaited<ReturnType<typeof loadActor>>,
    { kind: "candidate" }
  >;
  return { appId: app!.id, actor };
}

let pmTrack: string;
let notStarted: string;
let submitted: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, {
    title: "Product Management Intern",
    slug: "product-manager-intern",
  });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "October 2026" });
  await setCycleStatus(db, admin, { cycleId: cycle.id, status: "open" });
  pmTrack = (await getCycleDetail(db, admin, cycle.id)).tracks[0]!.id;
  const data = await getBuilderData(db, admin, pmTrack);
  await saveDraft(db, admin, {
    workflowId: pmTrack,
    versionId: data.draft!.id,
    config: editedTrack(),
    etag: data.draft!.etag,
  });
  expect(
    await publishDraft(db, admin, { workflowId: pmTrack, versionId: data.draft!.id }),
  ).toMatchObject({ ok: true });

  notStarted = (await invite(pmTrack, role.id)).appId;
  const done = await invite(pmTrack, role.id);
  expect(
    await submitForm(db, deps, done.actor, done.appId, "details", { why: "I like users." }),
  ).toMatchObject({ ok: true });
  submitted = done.appId;
});
afterAll(() => close());

describe("setting up the careers roles", () => {
  it("replaces an edited PM track once and moves candidates who haven't submitted", async () => {
    await setupCareersRoles(db, admin, quiet);

    const pinnedNew = await loadPinned(db, notStarted);
    expect(pinnedNew.config.nodes.map((n) => n.id)).toEqual([
      "details",
      "how_you_think",
      "task",
      "interview",
    ]);
    const [progress] = await db
      .select()
      .from(stageProgress)
      .where(eq(stageProgress.applicationId, notStarted));
    expect(progress).toMatchObject({ nodeId: "details", state: "unlocked" });

    // Someone who already submitted keeps the version they answered.
    const pinnedOld = await loadPinned(db, submitted);
    expect(pinnedOld.config.nodes.map((n) => n.id)).toEqual(["details"]);
    const [kept] = await db
      .select()
      .from(stageProgress)
      .where(and(eq(stageProgress.applicationId, submitted), eq(stageProgress.nodeId, "details")));
    expect(kept!.state).not.toBe("unlocked");

    // SDE and BGI are created too, and the templates exist.
    const names = (await db.select({ name: templates.name }).from(templates)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["PM intern process", "SDE intern process"]));
  });

  it("leaves the track alone on later runs, even after builder edits", async () => {
    const data = await getBuilderData(db, admin, pmTrack);
    await saveDraft(db, admin, {
      workflowId: pmTrack,
      versionId: data.draft!.id,
      config: editedTrack(),
      etag: data.draft!.etag,
    });
    expect(
      await publishDraft(db, admin, { workflowId: pmTrack, versionId: data.draft!.id }),
    ).toMatchObject({ ok: true });
    const [before] = await db
      .select({ v: workflows.publishedVersionId })
      .from(workflows)
      .where(eq(workflows.id, pmTrack));

    await setupCareersRoles(db, admin, quiet);

    const [after] = await db
      .select({ v: workflows.publishedVersionId })
      .from(workflows)
      .where(eq(workflows.id, pmTrack));
    expect(after!.v).toBe(before!.v);
  });
});
