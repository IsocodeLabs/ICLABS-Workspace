import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  eq,
  and,
  applications,
  assessmentSessions,
  files,
  questions,
  stageProgress,
  submissions,
  workflows,
  type Db,
} from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import {
  createNode,
  emptyWorkflow,
  PROBLEM_ID_KEY,
  PROBLEM_KEY,
  type WorkflowConfig,
} from "@iclabs/core";
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
import { createQuestion, setQuestionStatus } from "../questions";
import {
  getAssessmentQuestions,
  getCandidateStage,
  recordIntegrity,
  integritySummary,
  saveAnswer,
  startAssessment,
  submitAssessment,
  submitForm,
  submitTask,
  sweepExpiredAssessments,
} from "./candidate";
import {
  extendDeadline,
  startApplication,
  sweepMissedDeadlines,
  sendDeadlineReminders,
  type ProgressionDeps,
} from "./progression";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
let clock: Date;
const queueEmail = vi.fn(async () => "id");
const onAwaitingReview = vi.fn(async () => {});
const deps: ProgressionDeps = {
  queueEmail,
  appUrl: (p) => `https://w${p}`,
  now: () => clock,
  onAwaitingReview,
};

// Details form → Quiz (pass ≥ 50% → Task, else Needs decision) → Task (reviewed) → Interview
function process(): WorkflowConfig {
  const form = createNode("form", { id: "form", title: "Details" });
  form.config.fields = [
    {
      id: "track",
      label: "Track",
      kind: "single_choice",
      required: true,
      options: ["Frontend", "Backend"],
    },
    { id: "cv", label: "CV", kind: "file", required: false },
  ];
  const quiz = createNode("assessment", { id: "quiz", title: "Tech quiz" });
  quiz.config.durationMin = 20;
  quiz.config.questions.draw = [{ tags: ["sql"], count: 2 }];
  quiz.config.shuffleQuestions = false;
  const task = createNode("task", { id: "task", title: "Take-home" });
  task.reviewers!.pool = ["someone"];
  task.config.deliverables = [
    { id: "repo", kind: "link", label: "Repo", required: true, allowedDomains: ["github.com"] },
  ];
  const interview = createNode("interview", { id: "int", title: "Interview" });
  interview.config.interviewerPool = ["someone"];
  return {
    ...emptyWorkflow(),
    nodes: [form, quiz, task, interview],
    edges: [
      { id: "1", from: "form", to: "quiz", priority: 0, when: { always: true } },
      {
        id: "2",
        from: "quiz",
        to: "task",
        priority: 0,
        when: { metric: "auto_score_pct", op: ">=", value: 50 },
      },
      { id: "3", from: "quiz", to: "NEEDS_DECISION", priority: 1, when: { always: true } },
      { id: "4", from: "task", to: "int", priority: 0, when: { always: true } },
      { id: "5", from: "int", to: "END_COMPLETE", priority: 0, when: { always: true } },
    ],
  };
}

const answerKey: Record<string, string> = {};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
  for (const body of ["Which joins keep unmatched rows?", "What does GROUP BY do?"]) {
    const res = await createQuestion(db, admin, {
      type: "mcq",
      body,
      options: [
        { text: "Right answer", correct: true },
        { text: "Wrong answer", correct: false },
      ],
      tags: "SQL, databases",
      difficulty: "easy",
      points: 1,
    });
    if (!res.ok) throw new Error(res.error);
    await setQuestionStatus(db, admin, res.id, "approved");
  }
});
afterAll(() => close());
beforeEach(() => {
  clock = new Date("2026-10-16T05:00:00Z");
  queueEmail.mockClear();
  onAwaitingReview.mockClear();
});

async function newApplication(config: WorkflowConfig = process()) {
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
  await publishDraft(db, admin, { workflowId: tracks[0]!.id, versionId: data.draft!.id });
  const c = await createCandidateAccount(db, {
    email: `c${Math.random()}@x.com`,
    name: "Asha Rao",
  });
  const [wf] = await db.select().from(workflows).where(eq(workflows.id, tracks[0]!.id));
  const [app] = await db
    .insert(applications)
    .values({
      candidateId: c.candidateId,
      roleId: role.id,
      workflowId: wf!.id,
      workflowVersionId: wf!.publishedVersionId,
    })
    .returning();
  await startApplication(db, deps, app!.id);
  const actor = (await loadActor(db, c.userId)) as Extract<
    Awaited<ReturnType<typeof loadActor>>,
    { kind: "candidate" }
  >;
  return { app: app!, actor, candidateId: c.candidateId };
}

describe("candidate flow through stages", () => {
  it("unlocks the first stage with a deadline and an email on start", async () => {
    const { app, actor } = await newApplication();
    const view = await getCandidateStage(db, actor, app.id, "form", clock);
    expect(view).toMatchObject({ state: "unlocked", canSubmit: true, node: { title: "Details" } });
    expect(view!.dueAt).toBeInstanceOf(Date);
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "stage_unlocked",
        vars: expect.objectContaining({ stage: "Details" }),
      }),
    );
  });

  it("hides stages that aren't unlocked and other candidates' stages", async () => {
    const { app, actor } = await newApplication();
    const other = await newApplication();
    expect(await getCandidateStage(db, actor, app.id, "quiz", clock)).toBeNull();
    expect(await getCandidateStage(db, other.actor, app.id, "form", clock)).toBeNull();
  });

  it("validates form answers and moves on to the quiz", async () => {
    const { app, actor } = await newApplication();
    const bad = await submitForm(db, deps, actor, app.id, "form", { track: "Data" });
    expect(bad).toMatchObject({ ok: false, fieldErrors: { track: "option" } });
    // A file that isn't theirs is refused.
    const [stranger] = await db
      .insert(files)
      .values({
        objectKey: `x/${Math.random()}`,
        filename: "a.pdf",
        mime: "application/pdf",
        size: 1,
      })
      .returning();
    expect(
      await submitForm(db, deps, actor, app.id, "form", { track: "Backend", cv: stranger!.id }),
    ).toMatchObject({ ok: false, fieldErrors: { cv: "file" } });

    expect(await submitForm(db, deps, actor, app.id, "form", { track: "Backend" })).toEqual({
      ok: true,
      late: false,
    });
    expect(queueEmail).toHaveBeenCalledWith(
      expect.objectContaining({ templateKey: "submission_received" }),
    );
    expect(await getCandidateStage(db, actor, app.id, "quiz", clock)).toMatchObject({
      state: "unlocked",
    });
  });

  it("runs a timed quiz: no answer keys sent, server clock enforced, auto-scored, routed", async () => {
    const { app, actor } = await newApplication();
    await submitForm(db, deps, actor, app.id, "form", { track: "Backend" });
    const started = await startAssessment(db, actor, app.id, "quiz", clock);
    expect(started).toMatchObject({ ok: true });
    // Restarting resumes the same attempt with the same end time.
    expect(
      await startAssessment(db, actor, app.id, "quiz", new Date(clock.getTime() + 60_000)),
    ).toMatchObject({ endsAt: (started as { endsAt: Date }).endsAt });

    const view = await getAssessmentQuestions(db, actor, app.id, "quiz");
    expect(view!.questions).toHaveLength(2);
    expect(JSON.stringify(view)).not.toContain("correct");

    // Answer one right, one wrong → 50% → passes the ≥ 50% rule to the task.
    for (const q of view!.questions) {
      const [row] = await db.select().from(questions).where(eq(questions.id, q.id));
      answerKey[q.id] = row!.correct[0]!;
    }
    const [q1, q2] = view!.questions;
    await saveAnswer(db, actor, app.id, "quiz", q1!.id, answerKey[q1!.id]!, clock);
    await saveAnswer(
      db,
      actor,
      app.id,
      "quiz",
      q2!.id,
      q2!.options.find((o) => o.id !== answerKey[q2!.id])!.id,
      clock,
    );
    expect(
      await saveAnswer(
        db,
        actor,
        app.id,
        "quiz",
        q1!.id,
        "x",
        new Date(clock.getTime() + 21 * 60_000),
      ),
    ).toEqual({ ok: false, error: "time_up" });

    await recordIntegrity(db, actor, app.id, "quiz", [
      { type: "fullscreen_exit", at: clock.toISOString(), durationMs: 4000 },
      { type: "paste_attempt", at: clock.toISOString() },
      { type: "not_a_type", at: clock.toISOString() },
    ]);
    expect(await integritySummary(db, view!.sessionId)).toMatchObject({
      fullscreenExits: 1,
      pasteAttempts: 1,
      awayMs: 4000,
    });

    await submitAssessment(db, deps, view!.sessionId, { actor });
    const [progress] = await db
      .select()
      .from(stageProgress)
      .where(and(eq(stageProgress.applicationId, app.id), eq(stageProgress.nodeId, "quiz")));
    expect(progress).toMatchObject({ state: "passed", autoScorePct: 50 });
    expect(await getCandidateStage(db, actor, app.id, "task", clock)).toMatchObject({
      state: "unlocked",
    });
  });

  it("auto-submits attempts when time runs out", async () => {
    const { app, actor } = await newApplication();
    await submitForm(db, deps, actor, app.id, "form", { track: "Backend" });
    const started = await startAssessment(db, actor, app.id, "quiz", clock);
    clock = new Date(clock.getTime() + 25 * 60_000);
    expect(await sweepExpiredAssessments(db, deps)).toBeGreaterThanOrEqual(1);
    const [s] = await db
      .select()
      .from(assessmentSessions)
      .where(eq(assessmentSessions.id, (started as { sessionId: string }).sessionId));
    expect(s).toMatchObject({ autoSubmitted: true });
    // 0% → falls through to Needs decision rather than being rejected.
    const [a] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(a!.status).toBe("needs_decision");
  });

  it("task: link domain checked, waits for review, resubmission keeps versions, late is flagged", async () => {
    const { app, actor } = await newApplication();
    await submitForm(db, deps, actor, app.id, "form", { track: "Backend" });
    const s = await startAssessment(db, actor, app.id, "quiz", clock);
    const qs = await getAssessmentQuestions(db, actor, app.id, "quiz");
    for (const q of qs!.questions)
      await saveAnswer(db, actor, app.id, "quiz", q.id, answerKey[q.id]!, clock);
    await submitAssessment(db, deps, (s as { sessionId: string }).sessionId, { actor });

    expect(
      await submitTask(db, deps, actor, app.id, "task", { repo: "https://gitlab.com/me/x" }),
    ).toMatchObject({ ok: false, fieldErrors: { repo: "domain" } });
    expect(
      await submitTask(db, deps, actor, app.id, "task", { repo: "https://github.com/me/x" }),
    ).toEqual({ ok: true, late: false });
    expect(onAwaitingReview).toHaveBeenCalledWith(app.id, "task");

    const [progress] = await db
      .select()
      .from(stageProgress)
      .where(and(eq(stageProgress.applicationId, app.id), eq(stageProgress.nodeId, "task")));
    clock = new Date(progress!.dueAt!.getTime() + 30 * 60_000); // inside the 2h grace window
    expect(
      await submitTask(db, deps, actor, app.id, "task", { repo: "https://github.com/me/x2" }),
    ).toEqual({ ok: true, late: true });
    const versions = await db
      .select()
      .from(submissions)
      .where(eq(submissions.stageProgressId, progress!.id));
    expect(versions.map((v) => [v.version, v.isLate])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(onAwaitingReview).toHaveBeenCalledTimes(1);

    clock = new Date(progress!.graceUntil!.getTime() + 1000);
    expect(
      await submitTask(db, deps, actor, app.id, "task", { repo: "https://github.com/me/x3" }),
    ).toMatchObject({ ok: false, error: "The deadline has passed." });
  });

  it("task: each candidate sees a stable random few problem statements and must pick one of them", async () => {
    const config = process();
    const task = config.nodes.find((n) => n.id === "task")!;
    if (task.type !== "task") throw new Error("task");
    task.config.problemStatements = {
      offer: 5,
      items: Array.from({ length: 15 }, (_, i) => ({
        id: `ps${i + 1}`,
        title: `Problem ${i + 1}`,
        body: `Details ${i + 1}`,
      })),
    };
    const reachTask = async () => {
      const a = await newApplication(config);
      await submitForm(db, deps, a.actor, a.app.id, "form", { track: "Backend" });
      const s = await startAssessment(db, a.actor, a.app.id, "quiz", clock);
      const qs = await getAssessmentQuestions(db, a.actor, a.app.id, "quiz");
      for (const q of qs!.questions)
        await saveAnswer(db, a.actor, a.app.id, "quiz", q.id, answerKey[q.id]!, clock);
      await submitAssessment(db, deps, (s as { sessionId: string }).sessionId, { actor: a.actor });
      return a;
    };
    const offered = async (a: Awaited<ReturnType<typeof reachTask>>) => {
      const view = await getCandidateStage(db, a.actor, a.app.id, "task", clock);
      return (view!.node as { problemStatements: { id: string }[] }).problemStatements.map(
        (p) => p.id,
      );
    };

    const { app, actor } = await reachTask();
    const mine = await offered({ app, actor } as Awaited<ReturnType<typeof reachTask>>);
    expect(mine).toHaveLength(5);
    expect(new Set(mine).size).toBe(5);
    expect(await offered({ app, actor } as Awaited<ReturnType<typeof reachTask>>)).toEqual(mine);
    const others = await Promise.all([1, 2, 3].map(async () => offered(await reachTask())));
    expect(others.some((o) => o.join() !== mine.join())).toBe(true);

    const repo = "https://github.com/me/x";
    expect(await submitTask(db, deps, actor, app.id, "task", { repo })).toMatchObject({
      ok: false,
      fieldErrors: { [PROBLEM_ID_KEY]: "required" },
    });
    const notOffered = Array.from({ length: 15 }, (_, i) => `ps${i + 1}`).find(
      (id) => !mine.includes(id),
    )!;
    expect(
      await submitTask(db, deps, actor, app.id, "task", { repo, [PROBLEM_ID_KEY]: notOffered }),
    ).toMatchObject({ ok: false, fieldErrors: { [PROBLEM_ID_KEY]: "required" } });

    const picked = mine[2]!;
    const n = picked.slice(2);
    expect(
      await submitTask(db, deps, actor, app.id, "task", {
        repo,
        [PROBLEM_ID_KEY]: picked,
        [PROBLEM_KEY]: "spoofed text",
      }),
    ).toEqual({ ok: true, late: false });
    const [progress] = await db
      .select()
      .from(stageProgress)
      .where(and(eq(stageProgress.applicationId, app.id), eq(stageProgress.nodeId, "task")));
    const [saved] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.stageProgressId, progress!.id));
    expect(saved!.data).toEqual({
      repo,
      [PROBLEM_ID_KEY]: picked,
      [PROBLEM_KEY]: `Problem ${n}

Details ${n}`,
    });
  });

  it("sends one reminder 24h before, marks missed stages, and an extension reopens them", async () => {
    const { app, actor } = await newApplication();
    const [p] = await db
      .select()
      .from(stageProgress)
      .where(eq(stageProgress.applicationId, app.id));
    clock = new Date(p!.dueAt!.getTime() - 3 * 3600_000);
    expect(await sendDeadlineReminders(db, deps)).toBeGreaterThanOrEqual(1);
    expect(await sendDeadlineReminders(db, deps)).toBe(0);

    clock = new Date(p!.graceUntil!.getTime() + 60_000);
    expect(await sweepMissedDeadlines(db, deps)).toBeGreaterThanOrEqual(1);
    expect(
      (await db.select().from(applications).where(eq(applications.id, app.id)))[0]!.status,
    ).toBe("needs_decision");

    await extendDeadline(db, admin.userId, p!.id, new Date(clock.getTime() + 24 * 3600_000));
    expect(await getCandidateStage(db, actor, app.id, "form", clock)).toMatchObject({
      state: "unlocked",
      canSubmit: true,
    });
  });
});
