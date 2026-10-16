import { describe, expect, it } from "vitest";
import { emptyWorkflow, type WorkflowConfig, type WorkflowEdge } from "../workflow/schema";
import { createNode } from "../workflow/stages";
import { evaluateEdges, type RuleContext } from "./rules";
import { autoScore, type GradableQuestion } from "./scoring";
import { computeDeadlines } from "./deadlines";
import { validateFormAnswers } from "./forms";
import { seededShuffle } from "./shuffle";

const always = { always: true as const };
const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  flags: { late: false, integrityHigh: false },
  answers: {},
  ...over,
});

function flow(edges: Omit<WorkflowEdge, "id">[]): WorkflowConfig {
  return {
    ...emptyWorkflow(),
    nodes: [createNode("assessment", { id: "quiz" }), createNode("task", { id: "task" })],
    edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
  };
}

describe("evaluateEdges", () => {
  const f = flow([
    {
      from: "quiz",
      to: "END_REJECT",
      priority: 0,
      when: { metric: "auto_score_pct", op: "<", value: 30 },
    },
    {
      from: "quiz",
      to: "task",
      priority: 1,
      when: { metric: "auto_score_pct", op: ">=", value: 60 },
    },
    { from: "quiz", to: "NEEDS_DECISION", priority: 2, when: always },
  ]);

  it("takes the first matching path by priority", () => {
    expect(evaluateEdges(f, "quiz", ctx({ autoScorePct: 75 }))).toMatchObject({ target: "task" });
    expect(evaluateEdges(f, "quiz", ctx({ autoScorePct: 45 }))).toMatchObject({
      target: "NEEDS_DECISION",
    });
  });

  it("turns a rejection into a human decision unless auto-reject was opted in", () => {
    expect(evaluateEdges(f, "quiz", ctx({ autoScorePct: 10 }))).toMatchObject({
      target: "NEEDS_DECISION",
      wouldReject: true,
    });
    const opted = structuredClone(f);
    opted.edges[0]!.autoReject = true;
    expect(evaluateEdges(opted, "quiz", ctx({ autoScorePct: 10 }))).toMatchObject({
      target: "END_REJECT",
    });
  });

  it("never matches a rule whose data isn't available yet", () => {
    const g = flow([
      {
        from: "quiz",
        to: "task",
        priority: 0,
        when: { metric: "rubric_pct", op: ">=", value: 50 },
      },
      { from: "quiz", to: "NEEDS_DECISION", priority: 1, when: always },
    ]);
    expect(evaluateEdges(g, "quiz", ctx())).toMatchObject({ target: "NEEDS_DECISION" });
    expect(evaluateEdges(g, "quiz", ctx({ rubricPct: 80 }))).toMatchObject({ target: "task" });
  });

  it("supports answers, criteria, consensus, flags and all/any groups", () => {
    const g = flow([
      {
        from: "quiz",
        to: "task",
        priority: 0,
        when: {
          all: [{ answer: { fieldId: "track", op: "eq", value: "Backend" } }, { flag: "late" }],
        },
      },
      {
        from: "quiz",
        to: "END_COMPLETE",
        priority: 1,
        when: { any: [{ criterion: "c1", op: ">=", value: 4 }, { consensus: "all_yes" }] },
      },
      { from: "quiz", to: "NEEDS_DECISION", priority: 2, when: always },
    ]);
    expect(
      evaluateEdges(
        g,
        "quiz",
        ctx({ answers: { track: "Backend" }, flags: { late: true, integrityHigh: false } }),
      ).target,
    ).toBe("task");
    expect(evaluateEdges(g, "quiz", ctx({ criteria: { c1: 4 } })).target).toBe("END_COMPLETE");
    expect(evaluateEdges(g, "quiz", ctx({ recommendations: ["yes", "strong_yes"] })).target).toBe(
      "END_COMPLETE",
    );
    expect(evaluateEdges(g, "quiz", ctx({ recommendations: ["yes", "no"] })).target).toBe(
      "NEEDS_DECISION",
    );
  });

  it("evaluates rank rules only when a cohort rank is supplied", () => {
    const g = flow([
      { from: "quiz", to: "task", priority: 0, when: { rank: { by: "composite", top: 2 } } },
      { from: "quiz", to: "NEEDS_DECISION", priority: 1, when: always },
    ]);
    expect(evaluateEdges(g, "quiz", ctx()).target).toBe("NEEDS_DECISION");
    expect(evaluateEdges(g, "quiz", ctx({ rank: { position: 2, cohortSize: 10 } })).target).toBe(
      "task",
    );
    expect(evaluateEdges(g, "quiz", ctx({ rank: { position: 3, cohortSize: 10 } })).target).toBe(
      "NEEDS_DECISION",
    );
  });

  it("falls back to NEEDS_DECISION when a stage has no paths", () => {
    expect(evaluateEdges(flow([]), "quiz", ctx())).toMatchObject({
      target: "NEEDS_DECISION",
      edgeId: null,
    });
  });
});

describe("autoScore", () => {
  const qs: GradableQuestion[] = [
    { id: "q1", type: "mcq", points: 1, correct: ["a"] },
    { id: "q2", type: "multi", points: 2, correct: ["a", "b"] },
    { id: "q3", type: "short", points: 3, correct: [] },
  ];

  it("grades single choice all-or-nothing and multi-select with partial credit", () => {
    expect(autoScore(qs, { q1: ["a"], q2: ["a", "b"] })).toMatchObject({
      earned: 3,
      possible: 3,
      pct: 100,
      needsReview: true,
    });
    expect(autoScore(qs, { q1: ["b"], q2: ["a"] })).toMatchObject({ earned: 1, pct: 33.33 });
    expect(autoScore(qs, { q2: ["a", "c"] })).toMatchObject({ earned: 0 }); // wrong picks cancel right ones
  });

  it("ignores written questions in the auto-graded percentage", () => {
    expect(autoScore([{ id: "w", type: "long", points: 5, correct: [] }], {})).toEqual({
      earned: 0,
      possible: 0,
      pct: null,
      needsReview: true,
    });
  });
});

describe("computeDeadlines", () => {
  it("relative deadlines land on the given IST time, N days after unlock", () => {
    const unlocked = new Date("2026-10-16T14:00:00Z"); // 19:30 IST
    const node = createNode("task", {
      deadline: { mode: "relative", daysAfterUnlock: 3, atTime: "23:59" },
      graceHours: 2,
    });
    const d = computeDeadlines(node, unlocked);
    expect(d.dueAt?.toISOString()).toBe("2026-10-19T18:29:00.000Z"); // 23:59 IST
    expect(d.graceUntil?.toISOString()).toBe("2026-10-19T20:29:00.000Z");
  });

  it("handles unlocks after midnight IST correctly", () => {
    const unlocked = new Date("2026-10-16T20:00:00Z"); // 01:30 IST on the 17th
    const node = createNode("form", {
      deadline: { mode: "relative", daysAfterUnlock: 1, atTime: "18:00" },
    });
    expect(computeDeadlines(node, unlocked).dueAt?.toISOString()).toBe("2026-10-18T12:30:00.000Z");
  });

  it("absolute deadlines and no deadline", () => {
    const node = createNode("form", {
      deadline: { mode: "absolute", at: "2026-11-01T18:30:00+05:30" },
    });
    expect(computeDeadlines(node, new Date()).dueAt?.toISOString()).toBe(
      "2026-11-01T13:00:00.000Z",
    );
    expect(computeDeadlines(createNode("interview"), new Date())).toEqual({
      dueAt: null,
      graceUntil: null,
    });
  });
});

describe("validateFormAnswers", () => {
  const fields = [
    { id: "why", label: "Why?", kind: "long_text" as const, required: true },
    {
      id: "gh",
      label: "GitHub",
      kind: "url" as const,
      required: true,
      allowedDomains: ["github.com"],
    },
    {
      id: "pick",
      label: "Track",
      kind: "single_choice" as const,
      required: false,
      options: ["Frontend", "Backend"],
    },
    { id: "head", label: "Section", kind: "section" as const, required: false },
  ];

  it("accepts valid answers", () => {
    expect(
      validateFormAnswers(fields, {
        why: "Because",
        gh: "https://github.com/me/repo",
        pick: "Backend",
      }),
    ).toEqual({});
  });

  it("flags missing, wrong-domain and out-of-list answers", () => {
    expect(
      validateFormAnswers(fields, { why: " ", gh: "https://gitlab.com/x", pick: "Data" }),
    ).toEqual({
      why: "required",
      gh: "domain",
      pick: "option",
    });
    expect(validateFormAnswers(fields, { why: "x", gh: "javascript:alert(1)" })).toEqual({
      gh: "url",
    });
  });
});

describe("seededShuffle", () => {
  it("is deterministic per seed and keeps every item", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(items, "cand-1")).toEqual(seededShuffle(items, "cand-1"));
    expect(seededShuffle(items, "cand-1").sort()).toEqual(items);
    expect(seededShuffle(items, "cand-1")).not.toEqual(seededShuffle(items, "cand-2"));
  });
});
