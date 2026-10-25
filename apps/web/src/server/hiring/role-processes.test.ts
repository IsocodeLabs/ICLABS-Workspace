import { describe, expect, it } from "vitest";
import { candidatePath, evaluateEdges, validateWorkflow, workflowConfigSchema } from "@iclabs/core";
import { ROLE_PROCESSES } from "./role-processes";

describe.each(Object.entries(ROLE_PROCESSES))("%s process", (_slug, p) => {
  const config = p.build(["member-1"]);

  it("is valid and publishes without errors", () => {
    expect(workflowConfigSchema.safeParse(config).success).toBe(true);
    expect(validateWorkflow(config).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("shows candidates every stage by name, and nothing about the shortlist-only ones", () => {
    const path = candidatePath(config);
    expect(path.map((n) => n.title)).toEqual([
      "Your details",
      "How you think",
      "Take-home task",
      "Interview",
    ]);
    for (const n of path.slice(2)) expect(n.description ?? "").toBe("");
  });

  it("waits for the team to shortlist after How you think", () => {
    const ctx = {
      answers: {},
      rubricPct: 95,
      recommendations: ["strong_yes" as const],
      flags: { late: false, integrityHigh: false },
    };
    expect(evaluateEdges(config, "how_you_think", ctx).target).toBe("NEEDS_DECISION");
  });

  it("asks for long, specific answers in How you think and grades them", () => {
    const thinking = config.nodes.find((n) => n.id === "how_you_think")!;
    expect(thinking.type).toBe("custom");
    if (thinking.type !== "custom") return;
    expect(thinking.config.reviewed).toBe(true);
    expect(thinking.rubric!.criteria.reduce((s, c) => s + c.weight, 0)).toBe(100);
    const text = thinking.config.fields.filter((f) => f.kind === "long_text");
    expect(text.length).toBeGreaterThanOrEqual(12);
    expect(text.every((f) => f.maxWords)).toBe(true);
    expect(text.map((f) => f.label).join(" ")).toMatch(/AI/);
  });

  it("collects the CV in Your details as typed answers, projects first, with no upload", () => {
    const details = config.nodes.find((n) => n.id === "details")!;
    if (details.type !== "form") throw new Error("details should be a form");
    const ids = details.config.fields.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "project1_name",
        "project1_detail",
        "project2_name",
        "experience",
        "skills",
      ]),
    );
    expect(ids).not.toContain("cv");
    expect(ids).not.toContain("cv_other");
    expect(details.config.fields.some((f) => f.kind === "file")).toBe(false);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
