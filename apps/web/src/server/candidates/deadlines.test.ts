import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, applications, stageProgress, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { loadActor } from "../auth/actor";
import { createCandidateAccount } from "../auth/candidate-auth";
import {
  createCycle,
  createRole,
  getBuilderData,
  getCycleDetail,
  publishDraft,
  saveDraft,
} from "../hiring/structure";
import { submitTask } from "../stages/candidate";
import {
  extendDeadline,
  startApplication,
  sweepMissedDeadlines,
  type ProgressionDeps,
} from "../stages/progression";
import { setStepDeadline, stepDeadlineRows } from "./deadlines";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
let workflowId: string;
let roleId: string;
let clock: Date;
const deps: ProgressionDeps = {
  queueEmail: vi.fn(async () => "id"),
  appUrl: (p) => `https://w${p}`,
  now: () => clock,
};

// 26th EOD IST is on time; the 27th EOD IST is the hard close.
const DUE = new Date("2026-10-26T23:59:00+05:30");
const CLOSE = new Date("2026-10-27T23:59:00+05:30");

function bdProcess(): WorkflowConfig {
  const task = createNode("task", {
    id: "task",
    title: "Industry research",
    deadline: { mode: "relative", daysAfterUnlock: 3, atTime: "23:59" },
  });
  task.config.deliverables = [{ id: "work", kind: "text", label: "Your work", required: true }];
  return {
    ...emptyWorkflow(),
    nodes: [task],
    edges: [{ id: "1", from: "task", to: "NEEDS_DECISION", priority: 0, when: { always: true } }],
  };
}

async function invite(unlockedAt: Date) {
  clock = unlockedAt;
  const c = await createCandidateAccount(db, { email: `c${Math.random()}@x.com`, name: "Meera" });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, workflowId));
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId,
      workflowId,
      workflowVersionId: wf!.publishedVersionId,
    })
    .returning();
  await startApplication(db, deps, app!.id);
  const actor = (await loadActor(db, c.userId)) as Extract<
    Awaited<ReturnType<typeof loadActor>>,
    { kind: "candidate" }
  >;
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, app!.id), eq(stageProgress.nodeId, "task")));
  return { appId: app!.id, actor, progressId: progress!.id };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  const role = await createRole(db, admin, { title: "Business Growth Intern", slug: "bgi" });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "October 2026" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  const data = await getBuilderData(db, admin, tracks[0]!.id);
  await saveDraft(db, admin, {
    workflowId: tracks[0]!.id,
    versionId: data.draft!.id,
    config: bdProcess(),
    etag: data.draft!.etag,
  });
  await publishDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id });
  workflowId = tracks[0]!.id;
  roleId = role.id;
});
afterAll(() => close());

describe("same deadline for everyone at a step", () => {
  it("gives everyone the same dates, clears extensions, and reopens missed ones", async () => {
    // Different unlock days → different relative deadlines; one has an extension, one missed.
    const early = await invite(new Date("2026-10-18T06:00:00Z"));
    const late = await invite(new Date("2026-10-23T06:00:00Z"));
    const extended = await invite(new Date("2026-10-20T06:00:00Z"));
    await extendDeadline(db, admin.userId, extended.progressId, new Date("2026-10-30T18:00:00Z"));
    clock = new Date("2026-10-25T06:00:00Z");
    expect(await sweepMissedDeadlines(db, deps)).toBe(1); // `early` was due on the 21st

    const before = await stepDeadlineRows(db, admin, { workflowId, nodeId: "task" });
    expect(new Set(before.map((r) => r.closesAt?.getTime())).size).toBe(3);

    const res = await setStepDeadline(
      db,
      admin,
      { workflowId, nodeId: "task", dueAt: DUE, closesAt: CLOSE },
      clock,
    );
    expect(res).toEqual({ ok: true, updated: 3, reopened: 1 });

    const after = await stepDeadlineRows(db, admin, { workflowId, nodeId: "task" });
    for (const r of after) {
      expect(r.dueAt).toEqual(DUE);
      expect(r.closesAt).toEqual(CLOSE);
      expect(r.extended).toBe(false);
      expect(r.state).toBe("unlocked");
    }
    const [app] = await db.select().from(applications).where(eq(applications.id, early.appId));
    expect(app!.status).toBe("active");

    // On time before the 26th EOD, late but accepted until the 27th EOD, then closed.
    clock = new Date("2026-10-26T23:00:00+05:30");
    expect(await submitTask(db, deps, early.actor, early.appId, "task", { work: "Done" })).toEqual({
      ok: true,
      late: false,
    });
    clock = new Date("2026-10-27T12:00:00+05:30");
    expect(await submitTask(db, deps, late.actor, late.appId, "task", { work: "Done" })).toEqual({
      ok: true,
      late: true,
    });
    clock = new Date("2026-10-28T00:01:00+05:30");
    expect(
      await submitTask(db, deps, extended.actor, extended.appId, "task", { work: "Done" }),
    ).toEqual({ ok: false, error: "The deadline has passed." });
  });

  it("refuses a final close before the on-time deadline", async () => {
    expect(
      await setStepDeadline(db, admin, { workflowId, nodeId: "task", dueAt: CLOSE, closesAt: DUE }),
    ).toMatchObject({ ok: false });
  });
});
