import { describe, expect, it } from "vitest";
import { NODE_TYPES, nodeSchema } from "./schema";
import { STAGE_TYPES, createNode, nodeSummary } from "./stages";

describe("stage catalogue", () => {
  it("describes every node type", () => {
    for (const type of NODE_TYPES) {
      expect(STAGE_TYPES[type].label.length).toBeGreaterThan(0);
    }
  });

  it.each(NODE_TYPES)("creates a schema-valid default %s node", (type) => {
    const node = createNode(type);
    expect(nodeSchema.safeParse(node).success).toBe(true);
    expect(node.id).toMatch(/^[0-9A-Z]{26}$/);
  });

  it("gives reviewable stages a default rubric and reviewer setup", () => {
    expect(createNode("task").rubric?.criteria.length).toBeGreaterThan(0);
    expect(createNode("task").reviewers?.perSubmission).toBe(1);
    expect(createNode("form").rubric).toBeUndefined();
  });

  it("summarises a node for its canvas card", () => {
    const quiz = createNode("assessment");
    quiz.config.durationMin = 30;
    quiz.config.questions.draw = [{ tags: ["sql"], count: 20 }];
    const lines = nodeSummary(quiz);
    expect(lines).toContain("30 min · 20 questions");
  });
});

describe("nodeSummary for every stage type", () => {
  it("describes forms, tasks, gates, custom steps and interviews", () => {
    const form = createNode("form");
    form.config.fields = [{ id: "f", label: "College", kind: "short_text", required: true }];
    expect(nodeSummary(form)[0]).toBe("1 field");

    const task = createNode("task");
    expect(nodeSummary(task)).toEqual(["1 deliverable", "Due 5 days after unlock", "1 reviewer"]);
    task.config.deliverables.push({ id: "x", kind: "file", label: "Deck", required: false });
    task.reviewers = { ...task.reviewers!, perSubmission: 2, blind: true };
    expect(nodeSummary(task)).toEqual([
      "2 deliverables",
      "Due 5 days after unlock",
      "2 reviewers · blind",
    ]);

    expect(nodeSummary(createNode("review_gate"))[0]).toBe("Team decision");

    const custom = createNode("custom");
    custom.config.timerMin = 15;
    expect(nodeSummary(custom)[0]).toBe("0 fields · 15 min");
    expect(nodeSummary(createNode("custom"))[0]).toBe("0 fields");

    const interview = createNode("interview");
    expect(nodeSummary(interview)[0]).toBe("30 min · Google Meet");
    interview.config.mode = "in_person";
    expect(nodeSummary(interview)[0]).toBe("30 min · in person");
  });

  it("shows fixed-date deadlines", () => {
    const form = createNode("form", {
      deadline: { mode: "absolute", at: "2026-11-01T18:30:00+05:30" },
    });
    expect(nodeSummary(form)).toContain("Due 2026-11-01");
  });
});
