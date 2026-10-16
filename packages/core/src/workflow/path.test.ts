import { describe, expect, it } from "vitest";
import { candidatePath, entryNodeId } from "./path";
import { emptyWorkflow, type WorkflowConfig } from "./schema";
import { createNode } from "./stages";

const always = { always: true as const };

function flow(): WorkflowConfig {
  return {
    ...emptyWorkflow(),
    nodes: [
      createNode("form", { id: "a", title: "Details" }),
      createNode("assessment", { id: "b", title: "Quiz" }),
      createNode("review_gate", { id: "c", title: "Team review" }),
      createNode("interview", { id: "d", title: "Interview" }),
    ],
    edges: [
      { id: "1", from: "a", to: "b", priority: 0, when: always },
      {
        id: "2",
        from: "b",
        to: "c",
        priority: 0,
        when: { metric: "auto_score_pct", op: ">=", value: 60 },
      },
      { id: "3", from: "b", to: "NEEDS_DECISION", priority: 1, when: always },
      { id: "4", from: "c", to: "d", priority: 0, when: always },
      { id: "5", from: "d", to: "END_COMPLETE", priority: 0, when: always },
    ],
  };
}

describe("candidate path", () => {
  it("finds the entry stage", () => {
    expect(entryNodeId(flow())).toBe("a");
    expect(entryNodeId(emptyWorkflow())).toBeNull();
  });

  it("follows the main path and hides team-only stages", () => {
    expect(candidatePath(flow()).map((n) => n.title)).toEqual(["Details", "Quiz", "Interview"]);
  });

  it("stops safely on loops", () => {
    const f = flow();
    f.edges.push({ id: "x", from: "d", to: "b", priority: -1, when: always });
    expect(candidatePath(f).map((n) => n.id)).toEqual(["a", "b", "d"]);
  });
});
