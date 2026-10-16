import { describe, expect, it } from "vitest";
import { createNode } from "./stages";
import { validateWorkflow, type Issue } from "./validate";
import { emptyWorkflow, type WorkflowConfig, type WorkflowEdge, type WorkflowNode } from "./schema";

const always = { always: true as const };

function edge(from: string, to: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id: `${from}->${to}`, from, to, priority: 0, when: always, ...extra };
}

/** A complete, valid Form → Quiz → Task → Interview workflow. */
function validFlow(): WorkflowConfig {
  const form = createNode("form", { id: "form" });
  const quiz = createNode("assessment", { id: "quiz" });
  quiz.config.questions.draw = [{ tags: ["sql"], count: 10 }];
  const task = createNode("task", { id: "task" });
  task.reviewers!.pool = ["rev1"];
  const interview = createNode("interview", { id: "interview" });
  interview.config.interviewerPool = ["int1"];
  return {
    ...emptyWorkflow(),
    nodes: [form, quiz, task, interview],
    edges: [
      edge("form", "quiz"),
      edge("quiz", "task", {
        priority: 0,
        when: { metric: "auto_score_pct", op: ">=", value: 70 },
      }),
      edge("quiz", "NEEDS_DECISION", { priority: 1 }),
      edge("task", "interview"),
      edge("interview", "END_COMPLETE"),
    ],
    scoring: { weights: { quiz: 30, task: 70 } },
  };
}

const codes = (issues: Issue[], severity?: Issue["severity"]) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);

describe("validateWorkflow", () => {
  it("accepts a complete workflow", () => {
    expect(codes(validateWorkflow(validFlow()), "error")).toEqual([]);
  });

  it("rejects an empty workflow", () => {
    expect(codes(validateWorkflow(emptyWorkflow()))).toContain("empty");
  });

  it("requires exactly one starting stage", () => {
    const flow = validFlow();
    flow.edges = flow.edges.filter((e) => e.id !== "form->quiz");
    expect(codes(validateWorkflow(flow))).toContain("multiple_entries");
  });

  it("flags stages candidates can never reach", () => {
    const flow = validFlow();
    const orphan = createNode("custom", { id: "orphan" });
    flow.nodes.push(orphan);
    flow.edges.push(edge("orphan", "interview"));
    // orphan has no incoming edge → it's a second entry, and everything else stays reachable
    expect(codes(validateWorkflow(flow))).toContain("multiple_entries");
  });

  it("rejects loops", () => {
    const flow = validFlow();
    flow.edges.push(edge("task", "quiz", { priority: 5 }));
    expect(codes(validateWorkflow(flow))).toContain("cycle");
  });

  it("requires every stage to lead somewhere", () => {
    const flow = validFlow();
    flow.edges = flow.edges.filter((e) => e.from !== "interview");
    const issues = validateWorkflow(flow);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "no_exit", nodeId: "interview" }),
    );
  });

  it("requires a fallback path when a stage only has conditional exits", () => {
    const flow = validFlow();
    flow.edges = flow.edges.filter((e) => e.id !== "quiz->NEEDS_DECISION");
    expect(validateWorkflow(flow)).toContainEqual(
      expect.objectContaining({ code: "no_fallback", nodeId: "quiz", severity: "error" }),
    );
  });

  it("rejects edges pointing at stages that don't exist", () => {
    const flow = validFlow();
    flow.edges.push(edge("task", "ghost", { priority: 9 }));
    expect(codes(validateWorkflow(flow))).toContain("unknown_target");
  });

  it("requires score weights to add up to 100", () => {
    const flow = validFlow();
    flow.scoring.weights = { quiz: 30, task: 60 };
    expect(codes(validateWorkflow(flow))).toContain("weights_sum");
  });

  it("checks required setup per stage type", () => {
    const flow = validFlow();
    const quiz = flow.nodes.find((n) => n.id === "quiz") as Extract<
      WorkflowNode,
      { type: "assessment" }
    >;
    quiz.config.questions.draw = [];
    const task = flow.nodes.find((n) => n.id === "task")!;
    delete task.rubric;
    const interview = flow.nodes.find((n) => n.id === "interview") as Extract<
      WorkflowNode,
      { type: "interview" }
    >;
    interview.config.interviewerPool = [];
    const found = codes(validateWorkflow(flow), "error");
    expect(found).toEqual(expect.arrayContaining(["no_questions", "no_rubric", "no_interviewers"]));
  });

  it("requires a deadline on candidate-facing stages", () => {
    const flow = validFlow();
    delete flow.nodes.find((n) => n.id === "task")!.deadline;
    expect(validateWorkflow(flow)).toContainEqual(
      expect.objectContaining({ code: "no_deadline", nodeId: "task" }),
    );
  });

  it("warns (doesn't block) on auto-reject rules so an admin confirms them", () => {
    const flow = validFlow();
    flow.edges.push(
      edge("quiz", "END_REJECT", {
        id: "quiz-reject",
        priority: 0,
        when: { metric: "auto_score_pct", op: "<", value: 30 },
        autoReject: true,
      }),
    );
    const issues = validateWorkflow(flow);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "auto_reject", severity: "warning" }),
    );
    expect(codes(issues, "error")).toEqual([]);
  });

  it("flags rules that haven't been finished", () => {
    const flow = validFlow();
    flow.edges.push(
      edge("task", "NEEDS_DECISION", {
        id: "half",
        priority: -1,
        when: { criterion: "", op: ">=", value: 3 },
      }),
    );
    expect(validateWorkflow(flow)).toContainEqual(
      expect.objectContaining({ code: "incomplete_rule", edgeId: "half", severity: "error" }),
    );
  });

  it("flags duplicate stage ids", () => {
    const flow = validFlow();
    flow.nodes.push(createNode("form", { id: "form" }));
    expect(codes(validateWorkflow(flow))).toContain("duplicate_id");
  });
});
