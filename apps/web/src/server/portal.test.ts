import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, cycles, roles, workflowVersions, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow } from "@iclabs/core";
import { loadActor } from "./auth/actor";
import { createCandidateAccount } from "./auth/candidate-auth";
import {
  dashboardCards,
  listNotifications,
  markAllRead,
  notify,
  roleSpace,
  unreadCount,
  updateProfile,
} from "./portal";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

async function setup() {
  const [role] = await db
    .insert(roles)
    .values({ title: "SDE Intern", slug: `sde-${Math.random()}` })
    .returning();
  const [cycle] = await db.insert(cycles).values({ roleId: role!.id, name: "C1" }).returning();
  const [wf] = await db.insert(workflows).values({ cycleId: cycle!.id, name: "Main" }).returning();
  const config = {
    ...emptyWorkflow(),
    nodes: [
      createNode("form", { id: "f", title: "Details" }),
      createNode("task", { id: "t", title: "Take-home" }),
    ],
    edges: [{ id: "1", from: "f", to: "t", priority: 0, when: { always: true as const } }],
  };
  const [v] = await db
    .insert(workflowVersions)
    .values({ workflowId: wf!.id, version: 1, status: "published", config })
    .returning();
  const a = await createCandidateAccount(db, {
    email: `a${Math.random()}@x.com`,
    name: "Asha Rao",
  });
  const b = await createCandidateAccount(db, { email: `b${Math.random()}@x.com`, name: "Bo" });
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: a.candidateId,
      roleId: role!.id,
      workflowId: wf!.id,
      workflowVersionId: v!.id,
      currentNodeId: "t",
    })
    .returning();
  return {
    actorA: (await loadActor(db, a.userId))!,
    actorB: (await loadActor(db, b.userId))!,
    app: app!,
    userA: a.userId,
  };
}

describe("candidate portal", () => {
  it("shows the current step on the dashboard card", async () => {
    const { actorA } = await setup();
    const cards = await dashboardCards(db, actorA as never);
    expect(cards).toEqual([
      expect.objectContaining({
        roleTitle: "SDE Intern",
        currentStep: "Take-home",
        status: "active",
      }),
    ]);
  });

  it("builds the timeline and hides other candidates' role spaces", async () => {
    const { actorA, actorB, app } = await setup();
    const space = await roleSpace(db, actorA as never, app.id);
    expect(space?.steps.map((s) => [s.title, s.state])).toEqual([
      ["Details", "done"],
      ["Take-home", "current"],
    ]);
    expect(await roleSpace(db, actorB as never, app.id)).toBeNull();
  });

  it("validates profile updates", async () => {
    const { actorA } = await setup();
    const base = {
      name: "Asha Rao",
      phone: "",
      college: "IIT",
      gradYear: "2027",
      linkedin: "",
      github: "https://github.com/asha",
      portfolio: "",
      skills: "sql, react",
      availableFrom: "",
      availableTo: "",
      preferredStart: "2027-01-05",
    };
    expect(await updateProfile(db, actorA as never, base)).toEqual({ ok: true });
    expect((await updateProfile(db, actorA as never, { ...base, github: "not a url" })).ok).toBe(
      false,
    );
  });

  it("counts and clears notifications per user", async () => {
    const { userA } = await setup();
    await notify(db, [{ userId: userA, kind: "test", title: "Hello" }]);
    expect(await unreadCount(db, userA)).toBe(1);
    await markAllRead(db, userA);
    expect(await unreadCount(db, userA)).toBe(0);
    expect(await listNotifications(db, userA)).toHaveLength(1);
  });
});
