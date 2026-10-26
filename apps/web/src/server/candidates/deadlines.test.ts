import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  eq,
  applications,
  emailMessages,
  stageProgress,
  users,
  workflows,
  type Db,
} from "@iclabs/db";
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
import { restartTrackFromLoginEmails, setStepDeadline, stepDeadlineRows } from "./deadlines";
import { loginCheck } from "./logins";

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

/** A fresh track running the BD process; points `workflowId` and `roleId` at it. */
async function newTrack(slug: string) {
  const role = await createRole(db, admin, { title: "Business Growth Intern", slug });
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
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  await newTrack("bgi");
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

describe("deadlines start from the login email", () => {
  beforeAll(() => newTrack("bgi-login"));
  const loginEmail = (userId: string, sentAt: Date | null, status = "sent") =>
    db.insert(emailMessages).values({
      userId,
      toEmail: "x@x.com",
      templateKey: "welcome",
      status: status as "sent",
      sentAt,
    });
  const row = async (progressId: string) =>
    (await db.select().from(stageProgress).where(eq(stageProgress.id, progressId)))[0]!;

  it("re-times an unstarted step from a later login email and reopens it if missed", async () => {
    // Invited 18 Oct (due 21 Oct), but the login email only went out on 23 Oct.
    const late = await invite(new Date("2026-10-18T06:00:00Z"));
    clock = new Date("2026-10-23T08:00:00Z");
    await sweepMissedDeadlines(db, deps);
    expect((await row(late.progressId)).state).toBe("missed");
    await loginEmail(late.actor.userId, new Date("2026-10-23T05:00:00Z"));

    const now = new Date("2026-10-23T09:00:00Z");
    const preview = await restartTrackFromLoginEmails(db, admin, { workflowId, dryRun: true }, now);
    expect(preview).toHaveLength(1);
    expect(preview[0]).toMatchObject({
      reopened: true,
      dueAt: new Date("2026-10-26T23:59:00+05:30"),
    });
    expect((await row(late.progressId)).state).toBe("missed");

    const queueEmail = vi.fn(async () => "id");
    await restartTrackFromLoginEmails(db, admin, { workflowId, dryRun: false }, now, {
      queueEmail,
      appUrl: (p) => `https://w${p}`,
    });
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "deadline_updated",
        vars: expect.objectContaining({
          stage: "Industry research",
          deadline: "26 Oct 2026, 11:59 pm IST",
        }),
      }),
    );
    const after = await row(late.progressId);
    expect(after.dueAt).toEqual(new Date("2026-10-26T23:59:00+05:30"));
    expect(after.state).toBe("unlocked");
    const [app] = await db.select().from(applications).where(eq(applications.id, late.appId));
    expect(app!.status).toBe("active");

    // Running it again changes nothing.
    expect(
      await restartTrackFromLoginEmails(db, admin, { workflowId, dryRun: true }, now),
    ).toHaveLength(0);
  });

  it("never shortens a deadline and leaves admin extensions alone", async () => {
    const early = await invite(new Date("2026-10-20T06:00:00Z"));
    await loginEmail(early.actor.userId, new Date("2026-10-20T06:05:00Z"));
    const extended = await invite(new Date("2026-10-18T06:00:00Z"));
    await extendDeadline(db, admin.userId, extended.progressId, new Date("2026-10-22T18:00:00Z"));
    await loginEmail(extended.actor.userId, new Date("2026-10-23T05:00:00Z"));
    const before = [await row(early.progressId), await row(extended.progressId)];
    await restartTrackFromLoginEmails(
      db,
      admin,
      { workflowId, dryRun: false },
      new Date("2026-10-23T09:00:00Z"),
    );
    expect((await row(early.progressId)).dueAt).toEqual(before[0]!.dueAt);
    expect((await row(extended.progressId)).dueAt).toEqual(before[1]!.dueAt);
  });

  it("leaves a step alone once the team set one date for everyone there", async () => {
    const late = await invite(new Date("2026-10-18T06:00:00Z"));
    await setStepDeadline(db, admin, {
      workflowId,
      nodeId: "task",
      dueAt: new Date("2026-10-26T23:59:00+05:30"),
      closesAt: new Date("2026-10-27T23:59:00+05:30"),
    });
    await loginEmail(late.actor.userId, new Date("2026-10-25T05:00:00Z"));
    expect(
      await restartTrackFromLoginEmails(
        db,
        admin,
        { workflowId, dryRun: true },
        new Date("2026-10-25T09:00:00Z"),
      ),
    ).toHaveLength(0);
  });

  it("lists who can't sign in: expired, failed, never sent", async () => {
    const expired = await invite(new Date("2026-10-18T06:00:00Z"));
    await loginEmail(expired.actor.userId, new Date("2026-10-18T06:01:00Z"));
    const failed = await invite(new Date("2026-10-18T06:00:00Z"));
    await loginEmail(failed.actor.userId, null, "failed");
    const neverSent = await invite(new Date("2026-10-18T06:00:00Z"));
    const signedIn = await invite(new Date("2026-10-18T06:00:00Z"));
    await db
      .update(users)
      .set({ mustChangePassword: false })
      .where(eq(users.id, signedIn.actor.userId));

    const res = await loginCheck(db, admin, workflowId, new Date("2030-01-01T00:00:00Z"));
    const problemOf = (userId: string) =>
      res.problems.find((p) => p.candidateId === (userId as string))?.problem;
    expect(problemOf(expired.actor.candidateId)).toBe("expired");
    expect(problemOf(failed.actor.candidateId)).toBe("failed");
    expect(problemOf(neverSent.actor.candidateId)).toBe("never_sent");
    expect(problemOf(signedIn.actor.candidateId)).toBeUndefined();
    expect(res.signedIn).toBeGreaterThanOrEqual(1);
  });
});
