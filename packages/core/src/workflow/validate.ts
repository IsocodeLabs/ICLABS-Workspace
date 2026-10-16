import { isTerminal, type Condition, type WorkflowConfig } from "./schema";
import { STAGE_TYPES, questionCount } from "./stages";

export type Issue = {
  severity: "error" | "warning";
  code:
    | "empty"
    | "duplicate_id"
    | "no_entry"
    | "multiple_entries"
    | "unreachable"
    | "cycle"
    | "unknown_source"
    | "unknown_target"
    | "no_exit"
    | "no_fallback"
    | "weights_sum"
    | "weight_unknown_node"
    | "no_questions"
    | "no_rubric"
    | "no_reviewers"
    | "no_interviewers"
    | "no_deadline"
    | "no_deliverables"
    | "auto_reject"
    | "incomplete_rule";
  message: string;
  nodeId?: string;
  edgeId?: string;
};

/**
 * Everything that must be true before a workflow can be published. Errors block Publish;
 * warnings are shown on the canvas for an admin to confirm.
 */
export function validateWorkflow(config: WorkflowConfig): Issue[] {
  const issues: Issue[] = [];
  const err = (code: Issue["code"], message: string, extra: Partial<Issue> = {}) =>
    issues.push({ severity: "error", code, message, ...extra });
  const warn = (code: Issue["code"], message: string, extra: Partial<Issue> = {}) =>
    issues.push({ severity: "warning", code, message, ...extra });

  const { nodes, edges } = config;
  if (nodes.length === 0) {
    err("empty", "Add at least one stage.");
    return issues;
  }

  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) err("duplicate_id", `Two stages share the id ${n.id}.`, { nodeId: n.id });
    ids.add(n.id);
  }

  // ─── Graph shape ───────────────────────────────────────────────────────────
  const outgoing = new Map<string, typeof edges>();
  const incoming = new Map<string, number>();
  for (const e of edges) {
    if (!ids.has(e.from))
      err("unknown_source", "A connection starts from a missing stage.", { edgeId: e.id });
    if (!isTerminal(e.to) && !ids.has(e.to)) {
      err("unknown_target", "A connection points to a missing stage.", { edgeId: e.id });
      continue;
    }
    outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]);
    if (!isTerminal(e.to)) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }

  const entries = nodes.filter((n) => !incoming.get(n.id));
  if (entries.length === 0)
    err("no_entry", "No starting stage: every stage has an incoming connection.");
  if (entries.length > 1) {
    err(
      "multiple_entries",
      `Only one stage can be the start. Connect: ${entries.map((n) => n.title).join(", ")}.`,
    );
  }

  if (
    hasCycle(
      nodes.map((n) => n.id),
      outgoing,
    )
  ) {
    err("cycle", "Connections form a loop. A candidate could repeat stages forever.");
  }

  if (entries.length === 1) {
    const reachable = reach(entries[0]!.id, outgoing);
    for (const n of nodes) {
      if (!reachable.has(n.id))
        err("unreachable", `"${n.title}" can never be reached.`, { nodeId: n.id });
    }
  }

  for (const n of nodes) {
    const outs = outgoing.get(n.id) ?? [];
    if (outs.length === 0) {
      err(
        "no_exit",
        `"${n.title}" doesn't lead anywhere. Connect it to the next stage or an end.`,
        { nodeId: n.id },
      );
    } else if (!outs.some((e) => "always" in e.when)) {
      err(
        "no_fallback",
        `"${n.title}" needs an "otherwise" path for candidates who match no rule.`,
        {
          nodeId: n.id,
        },
      );
    }
    for (const e of outs) {
      if (!("always" in e.when) && !conditionComplete(e.when)) {
        err("incomplete_rule", `A rule after "${n.title}" isn't finished. Pick what it checks.`, {
          nodeId: n.id,
          edgeId: e.id,
        });
      }
      if (e.autoReject && e.to === "END_REJECT") {
        warn(
          "auto_reject",
          `"${n.title}" rejects candidates automatically. Confirm this is intended.`,
          {
            nodeId: n.id,
            edgeId: e.id,
          },
        );
      }
    }
  }

  // ─── Scoring ───────────────────────────────────────────────────────────────
  const weights = Object.entries(config.scoring.weights).filter(([, w]) => w > 0);
  for (const [nodeId] of weights) {
    if (!ids.has(nodeId))
      err("weight_unknown_node", "A score weight refers to a missing stage.", { nodeId });
  }
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  if (weights.length > 0 && Math.abs(total - 100) > 0.01) {
    err("weights_sum", `Score weights add up to ${total}%, not 100%.`);
  }

  // ─── Per-stage setup ───────────────────────────────────────────────────────
  for (const n of nodes) {
    const at = { nodeId: n.id };
    if (
      STAGE_TYPES[n.type].candidateFacing &&
      n.type !== "interview" &&
      n.visibility === "candidate" &&
      !n.deadline
    ) {
      err("no_deadline", `"${n.title}" needs a deadline.`, at);
    }
    const reviewable = STAGE_TYPES[n.type].reviewable || (n.type === "custom" && n.config.reviewed);
    if (reviewable && n.type !== "assessment") {
      if (!n.rubric || n.rubric.criteria.length === 0)
        err("no_rubric", `"${n.title}" needs a scoring rubric.`, at);
      if (!n.reviewers || n.reviewers.pool.length === 0) {
        warn(
          "no_reviewers",
          `"${n.title}" has no reviewers yet; submissions will wait unassigned.`,
          at,
        );
      }
    }
    if (n.type === "assessment" && questionCount(n) === 0)
      err("no_questions", `"${n.title}" has no questions.`, at);
    if (n.type === "task" && n.config.deliverables.length === 0) {
      err("no_deliverables", `"${n.title}" asks for nothing to be submitted.`, at);
    }
    if (n.type === "interview" && n.config.interviewerPool.length === 0) {
      err("no_interviewers", `"${n.title}" needs at least one interviewer.`, at);
    }
  }

  return issues;
}

function reach(start: string, outgoing: Map<string, { to: string }[]>): Set<string> {
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length) {
    for (const e of outgoing.get(stack.pop()!) ?? []) {
      if (!isTerminal(e.to) && !seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return seen;
}

function hasCycle(ids: string[], outgoing: Map<string, { to: string }[]>): boolean {
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string): boolean => {
    if (state.get(id) === "visiting") return true;
    if (state.get(id) === "done") return false;
    state.set(id, "visiting");
    for (const e of outgoing.get(id) ?? []) {
      if (!isTerminal(e.to) && visit(e.to)) return true;
    }
    state.set(id, "done");
    return false;
  };
  return ids.some((id) => visit(id));
}

function conditionComplete(c: Condition): boolean {
  if ("all" in c) return c.all.every(conditionComplete);
  if ("any" in c) return c.any.every(conditionComplete);
  if ("criterion" in c) return c.criterion.length > 0;
  if ("answer" in c) return c.answer.fieldId.length > 0;
  if ("rank" in c) return (c.rank.top ?? 0) > 0 || (c.rank.topPct ?? 0) > 0;
  return true;
}
