import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, applications, interviews, stageProgress, teamMembers, workflows, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createNode, emptyWorkflow, type WorkflowConfig } from "@iclabs/core";
import { teamActor } from "../../test/fixtures";
import { createCandidateAccount } from "../auth/candidate-auth";
import { createFakeCalendar } from "../calendar";
import { buildIcs } from "../calendar/ics";
import { createCycle, createRole, getBuilderData, getCycleDetail, publishDraft, saveDraft } from "../hiring/structure";
import { startApplication } from "../stages/progression";
import {
  cancelInterview,
  getInterviewBrief,
  interviewBoard,
  recordInterviewOutcome,
  rescheduleInterview,
  scheduleInterview,
  sendInterviewReminders,
  type InterviewDeps,
} from ".";

type Team = Awaited<ReturnType<typeof teamActor>>;
let db: Db;
let close: () => Promise<void>;
let admin: Team;
let alice: Team;
let bob: Team;
let outsider: Team;
let clock: Date;
let calendar: ReturnType<typeof createFakeCalendar>;
const queueEmail = vi.fn(async (_input: Parameters<InterviewDeps["queueEmail"]>[0]) => "id");
const deps = (): InterviewDeps => ({
  queueEmail,
  appUrl: (p) => `https://w${p}`,
  now: () => clock,
  calendar,
  organizerEmail: "hiring@isocodelabs.com",
});

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 20, h - 5, m - 30)); // IST wall clock on 20 Oct

function process(pool: string[]): WorkflowConfig {
  const iv = createNode("interview", { id: "int", title: "Founder call" });
  iv.config = { roundName: "Founder round", durationMin: 30, interviewerPool: pool, mode: "meet", instructions: "Bring questions." };
  return {
    ...emptyWorkflow(),
    nodes: [iv],
    edges: [{ id: "e", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } }],
  };
}

let track: { roleId: string; wf: typeof workflows.$inferSelect };

async function newCandidate(name = "Asha Rao") {
  const c = await createCandidateAccount(db, { email: `c${Math.random()}@x.com`, name });
  const [app] = await db
    .insert(applications)
    .values({ candidateId: c.candidateId, roleId: track.roleId, workflowId: track.wf.id, workflowVersionId: track.wf.publishedVersionId })
    .returning();
  await startApplication(db, deps(), app!.id, { skipEmail: true });
  return app!.id;
}

const appOf = async (id: string) => (await db.select().from(applications).where(eq(applications.id, id)))[0]!;
const ivOf = async (id: string) => (await db.select().from(interviews).where(eq(interviews.id, id)))[0]!;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  alice = await teamActor(db, "interviewer");
  bob = await teamActor(db, "interviewer");
  outsider = await teamActor(db, "reviewer");
  const role = await createRole(db, admin, { title: "PM Intern", slug: "pm" });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "C1" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  const data = await getBuilderData(db, admin, tracks[0]!.id);
  await saveDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id, config: process([alice.teamMemberId, bob.teamMemberId]), etag: data.draft!.etag });
  expect(await publishDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id })).toMatchObject({ ok: true });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, tracks[0]!.id));
  track = { roleId: role.id, wf: wf! };
});
afterAll(() => close());
beforeEach(() => {
  clock = at(9);
  calendar = createFakeCalendar();
  queueEmail.mockClear();
});

describe("scheduling", () => {
  it("refuses a slot that overlaps a panel member's busy time, unless forced", async () => {
    const app = await newCandidate();
    const aEmail = (await db.select().from(teamMembers).where(eq(teamMembers.id, alice.teamMemberId)))[0]!.email;
    calendar.busy.set(aEmail, [{ start: at(15), end: at(16) }]);

    const blocked = await scheduleInterview(db, deps(), admin, app, { startsAt: at(15, 30), interviewerIds: [alice.teamMemberId] });
    expect(blocked).toMatchObject({ ok: false, conflicts: [aEmail] });

    const ok = await scheduleInterview(db, deps(), admin, app, { startsAt: at(16), interviewerIds: [alice.teamMemberId] });
    if (!ok.ok) throw new Error(ok.error);
    const iv = await ivOf(ok.interviewId);
    expect(iv).toMatchObject({ status: "scheduled", meetUrl: expect.stringContaining("meet.google.com"), endsAt: at(16, 30) });
    expect(calendar.events.size).toBe(1);
    expect((await appOf(app)).status).toBe("interview_scheduled");
    const mail = queueEmail.mock.calls.at(-1)![0];
    expect(mail).toMatchObject({ templateKey: "interview_scheduled", vars: expect.objectContaining({ round: "Founder round" }) });
    expect(mail.attachments![0]!.content).toContain("METHOD:REQUEST");

    // Can't book the same stage twice.
    expect(await scheduleInterview(db, deps(), admin, app, { startsAt: at(18), interviewerIds: [alice.teamMemberId] })).toMatchObject({ ok: false });
  });

  it("catches double-booking inside the workspace too", async () => {
    const a = await newCandidate();
    const b = await newCandidate();
    expect(await scheduleInterview(db, deps(), admin, a, { startsAt: at(11), interviewerIds: [bob.teamMemberId] })).toMatchObject({ ok: true });
    // New fake calendar has no events: the conflict comes from our own table.
    calendar = createFakeCalendar();
    expect(await scheduleInterview(db, deps(), admin, b, { startsAt: at(11, 15), interviewerIds: [bob.teamMemberId] })).toMatchObject({ ok: false });
    expect(await scheduleInterview(db, deps(), admin, b, { startsAt: at(11, 15), interviewerIds: [bob.teamMemberId], force: true })).toMatchObject({ ok: true });
  });

  it("only admins and the role's managers schedule", async () => {
    const app = await newCandidate();
    await expect(scheduleInterview(db, deps(), alice, app, { startsAt: at(17), interviewerIds: [alice.teamMemberId] })).rejects.toThrow(/forbidden|write/);
  });
});

describe("after booking", () => {
  it("reschedules the same event, cancels, and books again", async () => {
    const app = await newCandidate();
    const res = await scheduleInterview(db, deps(), admin, app, { startsAt: at(13), interviewerIds: [alice.teamMemberId, bob.teamMemberId] });
    if (!res.ok) throw new Error(res.error);
    const before = await ivOf(res.interviewId);

    expect(await rescheduleInterview(db, deps(), admin, res.interviewId, { startsAt: at(14, 30) })).toEqual({ ok: true });
    const moved = await ivOf(res.interviewId);
    expect(moved).toMatchObject({ calendarEventId: before.calendarEventId, rescheduleCount: 1, startsAt: at(14, 30), meetUrl: before.meetUrl });
    expect(calendar.events.size).toBe(1);
    const mail = queueEmail.mock.calls.at(-1)![0];
    expect(mail.templateKey).toBe("interview_updated");
    expect(mail.attachments![0]!.content).toContain("SEQUENCE:1");

    expect(await cancelInterview(db, deps(), admin, res.interviewId)).toEqual({ ok: true });
    expect(calendar.events.size).toBe(0);
    expect(queueEmail.mock.calls.at(-1)![0].attachments![0]!.content).toContain("METHOD:CANCEL");
    expect((await appOf(app)).status).toBe("active");
    expect(await scheduleInterview(db, deps(), admin, app, { startsAt: at(17), interviewerIds: [alice.teamMemberId] })).toMatchObject({ ok: true });
  });

  it("records the outcome: done completes along the rules, no-show asks for a decision", async () => {
    const a = await newCandidate();
    const b = await newCandidate();
    const ra = await scheduleInterview(db, deps(), admin, a, { startsAt: at(10), interviewerIds: [alice.teamMemberId] });
    const rb = await scheduleInterview(db, deps(), admin, b, { startsAt: at(10, 30), interviewerIds: [bob.teamMemberId] });
    if (!ra.ok || !rb.ok) throw new Error("schedule failed");
    expect(await recordInterviewOutcome(db, deps(), admin, ra.interviewId, "done")).toMatchObject({ ok: false });
    clock = at(11);
    expect(await recordInterviewOutcome(db, deps(), admin, ra.interviewId, "done")).toEqual({ ok: true });
    expect((await appOf(a)).status).toBe("completed");
    expect(await recordInterviewOutcome(db, deps(), admin, rb.interviewId, "no_show")).toEqual({ ok: true });
    expect((await appOf(b)).status).toBe("needs_decision");
    const [p] = await db.select().from(stageProgress).where(eq(stageProgress.applicationId, b));
    expect(p!.state).toBe("missed");
  });

  it("sends the day-before and hour-before reminders once each", async () => {
    clock = new Date(at(9).getTime() - 3 * 24 * 3600_000);
    const app = await newCandidate();
    const res = await scheduleInterview(db, deps(), admin, app, { startsAt: at(12), interviewerIds: [alice.teamMemberId] });
    if (!res.ok) throw new Error(res.error);
    queueEmail.mockClear();
    clock = new Date(at(12).getTime() - 23 * 3600_000);
    expect(await sendInterviewReminders(db, deps())).toBeGreaterThanOrEqual(1);
    const reminders = () => queueEmail.mock.calls.filter((c) => c[0].templateKey === "interview_reminder" && c[0].applicationId === app);
    expect(reminders()).toHaveLength(1);
    await sendInterviewReminders(db, deps());
    expect(reminders()).toHaveLength(1);
    clock = new Date(at(12).getTime() - 50 * 60_000);
    await sendInterviewReminders(db, deps());
    expect(reminders()).toHaveLength(2);
  });

  it("the brief is visible to the panel and managers, nobody else", async () => {
    const app = await newCandidate("Ravi Kumar");
    const res = await scheduleInterview(db, deps(), admin, app, { startsAt: at(19), interviewerIds: [bob.teamMemberId] });
    if (!res.ok) throw new Error(res.error);
    expect(await getInterviewBrief(db, bob, res.interviewId)).toMatchObject({ candidate: { name: "Ravi Kumar" }, canManage: false });
    expect(await getInterviewBrief(db, alice, res.interviewId)).toBeNull();
    expect(await getInterviewBrief(db, outsider, res.interviewId)).toBeNull();
    const board = await interviewBoard(db, bob);
    expect(board.upcoming.map((i) => i.id)).toContain(res.interviewId);
    expect(board.ready).toEqual([]);
  });
});

describe("ics", () => {
  it("escapes text and folds long lines", () => {
    const ics = buildIcs({
      uid: "u1",
      sequence: 2,
      method: "REQUEST",
      start: at(10),
      end: at(10, 30),
      summary: "Round; one, two",
      description: "x".repeat(200),
      location: "Meet",
      organizerEmail: "h@x.com",
      attendeeEmail: "c@x.com",
      now: at(9),
    });
    expect(ics).toContain("SUMMARY:Round\\; one\\, two");
    expect(ics).toContain("DTSTART:20261020T043000Z");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
});
