import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, applications, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { teamActor } from "../../test/fixtures";
import { loadActor } from "../auth/actor";
import { createCandidateAccount } from "../auth/candidate-auth";
import { roleSpace } from "../portal";
import { decide } from "../reviews/decisions";
import { startApplication, type ProgressionDeps } from "../stages/progression";
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

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
let track: { roleId: string; trackId: string };
const queueEmail = vi.fn(async (_input: Parameters<ProgressionDeps["queueEmail"]>[0]) => "id");
const deps: ProgressionDeps = { queueEmail, appUrl: (p) => `https://w${p}` };

async function invite() {
  const c = await createCandidateAccount(db, {
    email: `c${Math.random()}@x.com`,
    name: "Ishaan Rao",
  });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, track.trackId));
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId: track.roleId,
      workflowId: track.trackId,
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

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, {
    title: "Software Engineering Intern",
    slug: "software-engineering-intern",
  });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "October 2026" });
  await setCycleStatus(db, admin, { cycleId: cycle.id, status: "open" });
  const trackId = (await getCycleDetail(db, admin, cycle.id)).tracks[0]!.id;
  const data = await getBuilderData(db, admin, trackId);
  const config = ROLE_PROCESSES["software-engineering-intern"]!.build([admin.teamMemberId]);
  await saveDraft(db, admin, {
    workflowId: trackId,
    versionId: data.draft!.id,
    config,
    etag: data.draft!.etag,
  });
  expect(
    await publishDraft(db, admin, { workflowId: trackId, versionId: data.draft!.id }),
  ).toMatchObject({ ok: true });
  track = { roleId: role.id, trackId };
});
afterAll(() => close());

describe("what candidates see of the SDE process", () => {
  it("shows only the getting-to-know steps, and says everyone hears back by email", async () => {
    const { appId, actor } = await invite();
    const space = (await roleSpace(db, actor, appId))!;
    expect(space.steps.map((s) => s.title)).toEqual(["Your details", "How you think"]);
    expect(space.moreAfterReview).toBe(true);
  });

  it("reveals the task once the team shortlists, and emails the candidate", async () => {
    const { appId, actor } = await invite();
    queueEmail.mockClear();
    expect(
      await decide(db, deps, admin, appId, { action: "advance", targetNodeId: "task" }),
    ).toMatchObject({ ok: true });

    const space = (await roleSpace(db, actor, appId))!;
    expect(space.steps.map((s) => [s.title, s.state])).toEqual([
      ["Your details", "done"],
      ["How you think", "done"],
      ["Take-home task", "current"],
      ["Interview", "upcoming"],
    ]);
    expect(space.moreAfterReview).toBe(false);
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "stage_unlocked",
        vars: expect.objectContaining({ stage: "Take-home task" }),
      }),
    );
  });

  it("emails candidates who aren't shortlisted when the team rejects them", async () => {
    const { appId } = await invite();
    queueEmail.mockClear();
    expect(await decide(db, deps, admin, appId, { action: "reject" })).toMatchObject({ ok: true });
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateKey: "not_progressing" }),
    );
  });
});
