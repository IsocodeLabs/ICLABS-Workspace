import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, applications, roles, stageProgress, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { loadActor } from "../auth/actor";
import { createCandidateAccount } from "../auth/candidate-auth";
import { resolveRoleSlug } from "../integrations/careers";
import { submitForm } from "../stages/candidate";
import { loadPinned, startApplication } from "../stages/progression";
import { audit } from "../audit";
import { ROLE_PROCESSES } from "./role-processes";
import { INSTALLED, setupCareersRoles } from "./setup-roles";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
  setCycleStatus,
} from "./structure";

/**
 * Production on 22 Oct 2026: the team's roles had their own slugs, so an earlier setup created
 * same-titled duplicates under the careers slugs (careers invites then matched those first).
 */
let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const deps = { queueEmail: async () => "", appUrl: (p: string) => p };
const quiet = () => {};

const starter = (): WorkflowConfig => {
  const form = createNode("form", { id: "details", title: "Your details" });
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
};
const bgiProcess = (): WorkflowConfig => {
  const form = createNode("form", { id: "details", title: "Your details" });
  form.config.fields = [{ id: "why", label: "Why sales?", kind: "long_text", required: true }];
  return {
    ...emptyWorkflow(),
    nodes: [form],
    edges: [{ id: "1", from: "details", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
};

async function roleWithTrack(title: string, slug: string, config: WorkflowConfig) {
  const role = await createRole(db, admin, { title, slug });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "Round" });
  await setCycleStatus(db, admin, { cycleId: cycle.id, status: "open" });
  const trackId = (await getCycleDetail(db, admin, cycle.id)).tracks[0]!.id;
  const data = await getBuilderData(db, admin, trackId);
  await saveDraft(db, admin, {
    workflowId: trackId,
    versionId: data.draft!.id,
    config,
    etag: data.draft!.etag,
  });
  expect(
    await publishDraft(db, admin, { workflowId: trackId, versionId: data.draft!.id }),
  ).toMatchObject({ ok: true });
  return { roleId: role.id, trackId };
}

async function invite(t: { roleId: string; trackId: string }, email = `c${Math.random()}@x.com`) {
  const c = await createCandidateAccount(db, { email, name: "Neha Shah" });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, t.trackId));
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId: t.roleId,
      workflowId: t.trackId,
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

let realSde: { roleId: string; trackId: string };
let realBgi: { roleId: string; trackId: string };
let dupSde: { roleId: string; trackId: string };
let dupBgi: { roleId: string; trackId: string };
let onRealSde: string;
let onDupBgi: string;
let onDupSdeStarted: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  // The team's roles, made in the workspace with their own slugs.
  realSde = await roleWithTrack("Software Engineering Intern", "sde-intern", starter());
  await roleWithTrack("Product Management Intern", "pm-intern", starter());
  realBgi = await roleWithTrack("Business Growth Intern (Sales)", "bgi", bgiProcess());
  // What the earlier setup left: duplicates under the careers slugs.
  dupSde = await roleWithTrack(
    "Software Engineering Intern",
    "software-engineering-intern",
    ROLE_PROCESSES["software-engineering-intern"]!.build([admin.teamMemberId]),
  );
  await audit(db, {
    actorUserId: admin.userId,
    action: INSTALLED,
    entity: "workflow",
    entityId: dupSde.trackId,
  });
  await roleWithTrack(
    "Product Management Intern",
    "product-manager-intern",
    ROLE_PROCESSES["product-manager-intern"]!.build([admin.teamMemberId]),
  );
  dupBgi = await roleWithTrack(
    "Business Growth Intern (Sales)",
    "business-growth-intern",
    starter(),
  );

  onRealSde = (await invite(realSde)).appId;
  const b = await invite(dupBgi); // a careers invite that landed on the empty duplicate
  expect(await submitForm(db, deps, b.actor, b.appId, "details", {})).toMatchObject({ ok: true });
  onDupBgi = b.appId;
  const s = await invite(dupSde);
  expect(
    await submitForm(db, deps, s.actor, s.appId, "details", { degree: "B.Tech" }),
  ).toMatchObject({ ok: false }); // required fields
  onDupSdeStarted = s.appId;
});
afterAll(() => close());

describe("folding duplicate careers roles into the team's roles", () => {
  it("installs the new process on the team's own SDE role and moves its unstarted candidate", async () => {
    await setupCareersRoles(db, admin, quiet);
    const pinned = await loadPinned(db, onRealSde);
    expect(pinned.app.roleId).toBe(realSde.roleId);
    expect(pinned.config.nodes.map((n) => n.id)).toEqual([
      "details",
      "how_you_think",
      "task",
      "interview",
    ]);
  });

  it("moves candidates off the duplicates: empty-form ones restart on the real process", async () => {
    const bgi = await loadPinned(db, onDupBgi);
    expect(bgi.app).toMatchObject({
      roleId: realBgi.roleId,
      workflowId: realBgi.trackId,
      status: "active",
    });
    const [p] = await db
      .select()
      .from(stageProgress)
      .where(eq(stageProgress.applicationId, onDupBgi));
    expect(p).toMatchObject({ nodeId: "details", state: "unlocked" });

    const sde = await loadPinned(db, onDupSdeStarted);
    expect(sde.app).toMatchObject({ roleId: realSde.roleId, workflowId: realSde.trackId });
  });

  it("retires the duplicates, so careers invites match the team's roles again", async () => {
    const [d] = await db.select().from(roles).where(eq(roles.id, dupBgi.roleId));
    expect(d).toMatchObject({
      status: "archived",
      title: "Business Growth Intern (Sales) (unused duplicate)",
    });
    expect(
      await resolveRoleSlug(db, {
        roleKey: "business-growth-intern",
        roleTitle: "Business Growth Intern (Sales)",
      }),
    ).toBe("bgi");
    expect(
      await resolveRoleSlug(db, {
        roleKey: "software-engineering-intern",
        roleTitle: "Software Engineering Intern",
      }),
    ).toBe("sde-intern");
    expect(
      await resolveRoleSlug(db, {
        roleKey: "product-manager-intern",
        roleTitle: "Product Management Intern",
      }),
    ).toBe("pm-intern");
  });

  it("changes nothing on a second run, and leaves the real BGI process alone", async () => {
    const before = await db.select().from(workflows);
    await setupCareersRoles(db, admin, quiet);
    expect(await db.select().from(workflows)).toEqual(before);
    expect((await loadPinned(db, onDupBgi)).config.nodes[0]).toMatchObject({
      config: { fields: [{ id: "why" }] },
    });
  });
});
