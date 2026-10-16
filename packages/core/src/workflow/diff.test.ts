import { describe, expect, it } from "vitest";
import { diffWorkflows } from "./diff";
import { emptyWorkflow, type WorkflowConfig } from "./schema";
import { createNode } from "./stages";

function base(): WorkflowConfig {
  return {
    ...emptyWorkflow(),
    nodes: [
      createNode("form", { id: "a", title: "Details" }),
      createNode("task", { id: "b", title: "Task" }),
    ],
    edges: [{ id: "e1", from: "a", to: "b", priority: 0, when: { always: true } }],
  };
}

describe("diffWorkflows", () => {
  it("describes a first publish", () => {
    expect(diffWorkflows(null, base())).toEqual(["New process with 2 stages"]);
  });

  it("reports no changes for identical versions", () => {
    const live = base();
    expect(diffWorkflows(live, structuredClone(live))).toEqual([]);
  });

  it("reports added, removed, renamed and changed stages, and rule changes", () => {
    const live = base();
    const draft = structuredClone(live);
    draft.nodes[0]!.title = "Your details";
    draft.nodes = draft.nodes.filter((n) => n.id !== "b");
    draft.nodes.push(createNode("interview", { id: "c", title: "Founder call" }));
    draft.edges = [{ id: "e2", from: "a", to: "c", priority: 0, when: { always: true } }];
    expect(diffWorkflows(live, draft)).toEqual([
      'Renamed "Details" to "Your details"',
      'Added stage "Founder call"',
      'Removed stage "Task"',
      "Changed connections or rules",
    ]);
  });

  it("notices config changes inside a stage", () => {
    const live = base();
    const draft = structuredClone(live);
    if (draft.nodes[1]!.type === "task") draft.nodes[1]!.config.brief = "Build an API";
    expect(diffWorkflows(live, draft)).toEqual(['Changed stage "Task"']);
  });
});
