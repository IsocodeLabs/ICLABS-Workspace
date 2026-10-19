import { describe, expect, it } from "vitest";
import { createNode } from "./stages";
import { validateWorkflow } from "./validate";
import { emptyWorkflow } from "./schema";
import {
  offeredProblemStatements,
  PROBLEM_KEY,
  problemStatementText,
  taskSubmissionFields,
} from "./problem-statements";

const pool = (n: number, offer = 5) => ({
  offer,
  items: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, title: `P${i}`, body: "" })),
});

describe("problem statements", () => {
  it("offers a stable random few per seed, without repeats", () => {
    const task = createNode("task");
    task.config.problemStatements = pool(15);
    const a = offeredProblemStatements(task.config, "seed-a");
    expect(a).toHaveLength(5);
    expect(new Set(a.map((p) => p.id)).size).toBe(5);
    expect(offeredProblemStatements(task.config, "seed-a")).toEqual(a);
    const seeds = ["b", "c", "d", "e"].map((s) => offeredProblemStatements(task.config, s));
    expect(seeds.some((o) => o.map((p) => p.id).join() !== a.map((p) => p.id).join())).toBe(true);
  });

  it("offers nothing without a pool and everything when the pool is small", () => {
    const task = createNode("task");
    expect(offeredProblemStatements(task.config, "s")).toEqual([]);
    task.config.problemStatements = pool(3);
    expect(offeredProblemStatements(task.config, "s")).toHaveLength(3);
  });

  it("puts the chosen statement first in submission fields", () => {
    const task = createNode("task");
    expect(taskSubmissionFields(task.config).map((f) => f.id)).not.toContain(PROBLEM_KEY);
    task.config.problemStatements = pool(2);
    expect(taskSubmissionFields(task.config)[0]).toMatchObject({ id: PROBLEM_KEY });
    expect(problemStatementText({ id: "x", title: "T", body: "B" })).toBe("T\n\nB");
  });

  it("warns when the pool is smaller than the offer and errors on blank titles", () => {
    const task = createNode("task", { id: "t" });
    task.config.problemStatements = pool(3);
    task.config.problemStatements.items[0]!.title = " ";
    const codes = validateWorkflow({ ...emptyWorkflow(), nodes: [task] }).map((i) => i.code);
    expect(codes).toContain("few_problem_statements");
    expect(codes).toContain("untitled_problem_statement");
  });
});
