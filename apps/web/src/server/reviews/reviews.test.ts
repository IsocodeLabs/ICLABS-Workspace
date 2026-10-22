import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  and,
  eq,
  applications,
  emailMessages,
  notifications,
  reviewAssignments,
  stageProgress,
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
import { submitForm, submitTask } from "../stages/candidate";
import { startApplication, type ProgressionDeps } from "../stages/progression";
import type { AiReviewInput, AiReviewResult, AiReviewer } from "../ai/review";
import { toSuggestion } from "../ai/review";
import { assignReviewerManually, assignReviewers } from "./assign";
import { decide, getPipeline, runRulesNow } from "./decisions";
import { getReviewView, myQueue, unassignedQueue } from "./queue";
import { requestAiSuggestion, submitReview } from "./submit";

type Team = Awaited<ReturnType<typeof teamActor>>;

let db: Db;
let close: () => Promise<void>;
let admin: Team;
let r1: Team;
let r2: Team;
const queueEmail = vi.fn(async () => "id");
const deps: ProgressionDeps = {
  queueEmail,
  appUrl: (p) => `https://w${p}`,
  onAwaitingReview: async (a, n) => {
    await assignReviewers(db, a, n);
  },
};

const rubric = {
  scale: "1-5" as const,
  criteria: [
    { id: "quality", name: "Quality", weight: 60 },
    { id: "comms", name: "Communication", weight: 40 },
  ],
};

// Take-home (reviewed) → ≥ 70% Interview · top 1 by rank → Interview · < 40% reject (needs opt-in) · else decide
function process(opts: {
  method?: "round_robin" | "manual";
  pool: string[];
  rank?: boolean;
}): WorkflowConfig {
  const task = createNode("task", { id: "task", title: "Take-home" });
  task.config.brief = "Build a todo API.";
  task.config.deliverables = [{ id: "repo", kind: "link", label: "Repo", required: true }];
  task.rubric = rubric;
  task.reviewers = {
    pool: opts.pool,
    perSubmission: 1,
    method: opts.method ?? "round_robin",
    borderline: { cutoff: 60, band: 5 },
    blind: false,
  };
  const interview = createNode("interview", { id: "int", title: "Interview" });
  interview.config.interviewerPool = ["someone"];
  return {
    ...emptyWorkflow(),
    nodes: [task, interview],
    edges: opts.rank
      ? [
          {
            id: "r",
            from: "task",
            to: "int",
            priority: 0,
            when: { rank: { by: "rubric_pct", top: 1 } },
          },
          { id: "x", from: "task", to: "NEEDS_DECISION", priority: 1, when: { always: true } },
          { id: "e", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } },
        ]
      : [
          {
            id: "1",
            from: "task",
            to: "int",
            priority: 0,
            when: { metric: "rubric_pct", op: ">=", value: 70 },
          },
          {
            id: "2",
            from: "task",
            to: "END_REJECT",
            priority: 1,
            when: { metric: "rubric_pct", op: "<", value: 40 },
          },
          { id: "3", from: "task", to: "NEEDS_DECISION", priority: 2, when: { always: true } },
          { id: "4", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } },
        ],
  };
}

async function newTrack(config: WorkflowConfig) {
  const role = await createRole(db, admin, {
    title: "SDE Intern",
    slug: `sde-${Math.random().toString(36).slice(2)}`,
  });
  const cycle = await createCycle(db, admin, { roleId: role.id, name: "C1" });
  const { tracks } = await getCycleDetail(db, admin, cycle.id);
  const data = await getBuilderData(db, admin, tracks[0]!.id);
  await saveDraft(db, admin, {
    workflowId: tracks[0]!.id,
    versionId: data.draft!.id,
    config,
    etag: data.draft!.etag,
  });
  const published = await publishDraft(db, admin, {
    workflowId: tracks[0]!.id,
    versionId: data.draft!.id,
  });
  expect(published).toMatchObject({ ok: true });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, tracks[0]!.id));
  return { roleId: role.id, wf: wf! };
}

async function submitCandidate(track: Awaited<ReturnType<typeof newTrack>>, name = "Asha Rao") {
  const c = await createCandidateAccount(db, { email: `c${Math.random()}@x.com`, name });
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId: track.roleId,
      workflowId: track.wf.id,
      workflowVersionId: track.wf.publishedVersionId,
    })
    .returning();
  await startApplication(db, deps, app!.id);
  const actor = (await loadActor(db, c.userId)) as Extract<
    Awaited<ReturnType<typeof loadActor>>,
    { kind: "candidate" }
  >;
  expect(
    await submitTask(db, deps, actor, app!.id, "task", { repo: "https://github.com/a/b" }),
  ).toMatchObject({ ok: true });
  return app!.id;
}

async function assignmentsOf(applicationId: string) {
  return db
    .select()
    .from(reviewAssignments)
    .where(eq(reviewAssignments.applicationId, applicationId));
}

async function appStatus(id: string) {
  const [a] = await db.select().from(applications).where(eq(applications.id, id));
  return a!;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  r1 = await teamActor(db, "reviewer");
  r2 = await teamActor(db, "reviewer");
});
afterAll(() => close());
beforeEach(() => queueEmail.mockClear());

describe("reviewer assignment", () => {
  it("takes turns across the pool and alerts the reviewer in-app", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId, r2.teamMemberId] }));
    const a = await submitCandidate(track);
    const b = await submitCandidate(track);
    const [first] = await assignmentsOf(a);
    const [second] = await assignmentsOf(b);
    expect(first!.reviewerId).toBe(r1.teamMemberId);
    expect(second!.reviewerId).toBe(r2.teamMemberId);
    const alerts = await db.select().from(notifications).where(eq(notifications.userId, r1.userId));
    expect(
      alerts.some((n) => n.kind === "review_assigned" && n.link === `/team/reviews/${first!.id}`),
    ).toBe(true);
    expect((await myQueue(db, r1)).open.map((q) => q.assignmentId)).toContain(first!.id);
  });

  it("manual pools go to the unassigned queue until someone is picked", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId], method: "manual" }));
    const a = await submitCandidate(track);
    expect(await assignmentsOf(a)).toHaveLength(0);
    const waiting = await unassignedQueue(db, admin);
    const item = waiting.find((w) => w.applicationId === a)!;
    expect(item).toBeTruthy();
    expect(await unassignedQueue(db, r1)).toEqual([]);
    const res = await assignReviewerManually(db, admin, item.progressId, r2.teamMemberId);
    expect(res.ok).toBe(true);
    expect((await unassignedQueue(db, admin)).some((w) => w.applicationId === a)).toBe(false);
  });
});

describe("submitting reviews", () => {
  it("validates scores, only the assignee can submit, and a strong review routes onward", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId] }));
    const a = await submitCandidate(track);
    const [asg] = await assignmentsOf(a);
    expect(
      await submitReview(db, deps, r2, asg!.id, {
        scores: { quality: 5, comms: 5 },
        recommendation: "yes",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await submitReview(db, deps, r1, asg!.id, {
        scores: { quality: 7, comms: 5 },
        recommendation: "yes",
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/Quality/) });

    const view = await getReviewView(db, r1, asg!.id);
    expect(view).toMatchObject({
      canSubmit: true,
      candidate: { label: "Asha Rao" },
      submission: { data: { repo: "https://github.com/a/b" } },
    });
    expect(await getReviewView(db, r2, asg!.id)).toBeNull();

    const res = await submitReview(db, deps, r1, asg!.id, {
      scores: { quality: 5, comms: 4 },
      recommendation: "strong_yes",
      notes: "Clean.",
    });
    expect(res).toMatchObject({ ok: true, outcome: "routed" });
    const [interview] = await db
      .select()
      .from(stageProgress)
      .where(and(eq(stageProgress.applicationId, a), eq(stageProgress.nodeId, "int")));
    expect(interview).toBeTruthy();
    expect(
      await submitReview(db, deps, r1, asg!.id, {
        scores: { quality: 5, comms: 4 },
        recommendation: "yes",
      }),
    ).toMatchObject({ ok: false });
  });

  it("a borderline score pulls in a second reviewer before the rules run", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId, r2.teamMemberId] }));
    const a = await submitCandidate(track);
    const [first] = await assignmentsOf(a);
    const reviewer = first!.reviewerId === r1.teamMemberId ? r1 : r2;
    const other = reviewer === r1 ? r2 : r1;
    // (3*60 + 3*40) / 500 = 60% → inside 60 ± 5
    expect(
      await submitReview(db, deps, reviewer, first!.id, {
        scores: { quality: 3, comms: 3 },
        recommendation: "no",
      }),
    ).toMatchObject({ outcome: "second_reviewer" });
    const second = (await assignmentsOf(a)).find((x) => x.reason === "borderline_second")!;
    expect(second.reviewerId).toBe(other.teamMemberId);
    // The second reviewer doesn't see the first score until they submit.
    expect((await getReviewView(db, other, second.id))!.others).toEqual([]);
    expect(
      await submitReview(db, deps, other, second.id, {
        scores: { quality: 5, comms: 5 },
        recommendation: "yes",
      }),
    ).toMatchObject({ outcome: "routed" });
    // Average 80% → interview.
    expect((await appStatus(a)).currentNodeId).toBe("int");
  });

  it("a low score that would reject waits for a person (no auto-reject opt-in)", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId] }));
    const a = await submitCandidate(track);
    const [asg] = await assignmentsOf(a);
    await submitReview(db, deps, r1, asg!.id, {
      scores: { quality: 1, comms: 1 },
      recommendation: "strong_no",
    });
    expect((await appStatus(a)).status).toBe("needs_decision");
  });
});

describe("AI suggestions", () => {
  it("stores one validated suggestion per stage and reports refusals", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId] }));
    const a = await submitCandidate(track);
    const [asg] = await assignmentsOf(a);
    const fake: AiReviewer = {
      suggest: vi.fn(async (input: AiReviewInput): Promise<AiReviewResult> => {
        expect(input.answers).toEqual([{ label: "Repo", value: "https://github.com/a/b" }]);
        expect(JSON.stringify(input)).not.toContain("Asha");
        return {
          ok: true,
          model: "claude-opus-5-5",
          suggestion: {
            scores: { quality: 4, comms: 3 },
            evidence: { quality: "README" },
            summary: "Solid.",
            missing: [],
          },
        };
      }),
    };
    // Admins only: the assigned reviewer can't ask Claude.
    expect(await requestAiSuggestion(db, r1, asg!.id, fake)).toEqual({
      ok: false,
      error: "Only admins can ask Claude.",
    });
    expect(await requestAiSuggestion(db, admin, asg!.id, fake)).toMatchObject({ ok: true });
    expect(await requestAiSuggestion(db, admin, asg!.id, fake)).toMatchObject({ ok: true });
    expect(fake.suggest).toHaveBeenCalledTimes(1);
    expect((await getReviewView(db, r1, asg!.id))!.ai).toMatchObject({
      kind: "ai_suggestion",
      totalPct: 72,
    });

    const b = await submitCandidate(track);
    const [asgB] = await assignmentsOf(b);
    const refusing: AiReviewer = {
      suggest: async () => ({ ok: false, reason: "refused", message: "declined" }),
    };
    expect(await requestAiSuggestion(db, admin, asgB!.id, refusing)).toEqual({
      ok: false,
      error: "declined",
    });
  });

  it("rejects model output that doesn't fit the rubric", () => {
    expect(
      toSuggestion(rubric, {
        criteria: [
          { criterionId: "quality", score: 9, evidence: "" },
          { criterionId: "comms", score: 3, evidence: "" },
        ],
        summary: "",
        missing: [],
      }),
    ).toMatch(/Quality/);
    expect(
      toSuggestion(rubric, {
        criteria: [{ criterionId: "comms", score: 3, evidence: "" }],
        summary: "",
        missing: [],
      }),
    ).toMatch(/Quality/);
  });
});

describe("decisions", () => {
  it("hold, reject (email delayed), reopen cancels the queued email, advance unlocks a stage", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId] }));
    const a = await submitCandidate(track);
    expect(await decide(db, deps, r1, a, { action: "hold" }).catch((e) => e.name)).toBe(
      "ForbiddenError",
    );
    expect(await decide(db, deps, admin, a, { action: "hold" })).toEqual({ ok: true });
    expect((await appStatus(a)).status).toBe("on_hold");

    // Real outbox so the reopen can cancel it.
    const { enqueueEmail } = await import("../email/outbox");
    const config = { secretKey: Buffer.alloc(32, 7).toString("base64") };
    const realDeps = {
      ...deps,
      queueEmail: (i: Parameters<typeof enqueueEmail>[2]) => enqueueEmail(db, config, i),
    };
    await decide(db, realDeps, admin, a, { action: "reject", note: "Not a fit now" });
    expect((await appStatus(a)).status).toBe("closed_rejected");
    const queued = () =>
      db
        .select()
        .from(emailMessages)
        .where(
          and(eq(emailMessages.applicationId, a), eq(emailMessages.templateKey, "not_progressing")),
        );
    expect(await queued()).toHaveLength(1);
    expect(await decide(db, deps, admin, a, { action: "hold" })).toMatchObject({ ok: false });
    await decide(db, deps, admin, a, { action: "reopen" });
    expect(await queued()).toHaveLength(0);
    expect((await appStatus(a)).status).toBe("needs_decision");

    expect(await decide(db, deps, admin, a, { action: "advance", targetNodeId: "int" })).toEqual({
      ok: true,
    });
    expect(await appStatus(a)).toMatchObject({ status: "active", currentNodeId: "int" });
    const { cards } = (await getPipeline(db, admin, track.wf.id))!;
    expect(cards.find((c) => c.applicationId === a)).toMatchObject({
      currentNodeId: "int",
      stageState: "unlocked",
    });
  });

  it("run rules now ranks the cohort; dry run changes nothing", async () => {
    const track = await newTrack(process({ pool: [r1.teamMemberId], rank: true }));
    const apps: string[] = [];
    // 40%, 100%, 72% (all outside the 60 ± 5 borderline band)
    for (const [q, c] of [
      [2, 2],
      [5, 5],
      [4, 3],
    ] as const) {
      const id = await submitCandidate(track);
      const [asg] = await assignmentsOf(id);
      await submitReview(db, deps, r1, asg!.id, {
        scores: { quality: q, comms: c },
        recommendation: "yes",
      });
      apps.push(id);
    }
    expect(await runRulesNow(db, deps, r1, track.wf.id, "task", { dryRun: true })).toMatchObject({
      ok: false,
    });
    const dry = await runRulesNow(db, deps, admin, track.wf.id, "task", { dryRun: true });
    if (!dry.ok) throw new Error(dry.error);
    expect(dry.rows.map((r) => [r.applicationId, r.rank, r.target])).toEqual([
      [apps[1], 1, "int"],
      [apps[2], 2, "NEEDS_DECISION"],
      [apps[0], 3, "NEEDS_DECISION"],
    ]);
    expect((await appStatus(apps[1]!)).currentNodeId).toBe("task");
    await runRulesNow(db, deps, admin, track.wf.id, "task", { dryRun: false });
    expect((await appStatus(apps[1]!)).currentNodeId).toBe("int");
    expect((await appStatus(apps[2]!)).currentNodeId).toBe("task");
  });
});

describe("review context", () => {
  // Details form → Take-home (reviewed) → Interview
  async function formThenTask(blind: boolean) {
    const base = process({ pool: [r1.teamMemberId] });
    const form = createNode("form", { id: "form", title: "Details" });
    form.config.fields = [
      {
        id: "track",
        label: "Track",
        kind: "single_choice",
        required: true,
        options: ["Frontend", "Backend"],
      },
    ];
    const task = base.nodes.find((n) => n.id === "task")!;
    if (task.type === "task") task.reviewers!.blind = blind;
    const track = await newTrack({
      ...base,
      nodes: [form, ...base.nodes],
      edges: [
        { id: "f", from: "form", to: "task", priority: 0, when: { always: true } },
        ...base.edges,
      ],
    });
    const c = await createCandidateAccount(db, {
      email: `c${Math.random()}@x.com`,
      name: "Meera Das",
    });
    const [app] = await db
      .insert(applications)
      .values({
        candidateId: c.candidateId,
        roleId: track.roleId,
        workflowId: track.wf.id,
        workflowVersionId: track.wf.publishedVersionId,
      })
      .returning();
    await startApplication(db, deps, app!.id);
    const actor = (await loadActor(db, c.userId)) as Extract<
      Awaited<ReturnType<typeof loadActor>>,
      { kind: "candidate" }
    >;
    expect(await submitForm(db, deps, actor, app!.id, "form", { track: "Backend" })).toMatchObject({
      ok: true,
    });
    expect(
      await submitTask(db, deps, actor, app!.id, "task", { repo: "https://github.com/a/b" }),
    ).toMatchObject({ ok: true });
    const [asg] = await assignmentsOf(app!.id);
    return (await getReviewView(db, r1, asg!.id))!;
  }

  it("shows the reviewer what the candidate submitted before the reviewed stage", async () => {
    const view = await formThenTask(false);
    expect(view.submission).toMatchObject({ data: { repo: "https://github.com/a/b" } });
    expect(view.earlier).toHaveLength(1);
    expect(view.earlier[0]).toMatchObject({
      node: { id: "form", title: "Details" },
      submission: { data: { track: "Backend" } },
    });
  });

  it("hides earlier steps in a blind review, since a details form identifies the candidate", async () => {
    expect((await formThenTask(true)).earlier).toEqual([]);
  });
});
