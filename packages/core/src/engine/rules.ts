import type { ComparisonOp, Condition, Terminal, WorkflowConfig } from "../workflow/schema";

export type Recommendation = "strong_yes" | "yes" | "no" | "strong_no";

/** What's known about a candidate at a stage when its exit rules run. Missing data never matches. */
export type RuleContext = {
  autoScorePct?: number | null;
  rubricPct?: number | null;
  composite?: number | null;
  /** Average human score per rubric criterion id. */
  criteria?: Record<string, number>;
  answers: Record<string, string | string[] | undefined>;
  recommendations?: Recommendation[];
  flags: { late: boolean; integrityHigh: boolean };
  /** Only set in batch mode (deadline close / "Run rules now"). 1 = best. */
  rank?: { position: number; cohortSize: number };
};

export type EdgeDecision = {
  target: string | Terminal;
  edgeId: string | null;
  /** The matched rule would reject, but auto-reject wasn't opted in, so a person decides. */
  wouldReject?: boolean;
};

const compare = (a: number, op: ComparisonOp, b: number) =>
  op === ">=" ? a >= b : op === "<=" ? a <= b : op === ">" ? a > b : op === "<" ? a < b : a === b;

function matches(c: Condition, ctx: RuleContext): boolean {
  if ("all" in c) return c.all.every((x) => matches(x, ctx));
  if ("any" in c) return c.any.some((x) => matches(x, ctx));
  if ("metric" in c) {
    const value = {
      auto_score_pct: ctx.autoScorePct,
      rubric_pct: ctx.rubricPct,
      composite: ctx.composite,
    }[c.metric];
    return value !== null && value !== undefined && compare(value, c.op, c.value);
  }
  if ("criterion" in c) {
    const v = ctx.criteria?.[c.criterion];
    return v !== undefined && compare(v, c.op, c.value);
  }
  if ("answer" in c) {
    const given = ctx.answers[c.answer.fieldId];
    if (given === undefined) return false;
    const values = (Array.isArray(given) ? given : [given]).map((v) => v.trim().toLowerCase());
    const wanted = (Array.isArray(c.answer.value) ? c.answer.value : [c.answer.value]).map((v) =>
      v.trim().toLowerCase(),
    );
    if (c.answer.op === "contains") return values.some((v) => wanted.some((w) => v.includes(w)));
    return values.some((v) => wanted.includes(v));
  }
  if ("rank" in c) {
    if (!ctx.rank) return false;
    if (c.rank.top) return ctx.rank.position <= c.rank.top;
    if (c.rank.topPct)
      return ctx.rank.position <= Math.ceil((ctx.rank.cohortSize * c.rank.topPct) / 100);
    return false;
  }
  if ("consensus" in c) {
    const recs = ctx.recommendations ?? [];
    if (recs.length === 0) return false;
    const yes = recs.filter((r) => r === "yes" || r === "strong_yes").length;
    if (c.consensus === "all_yes") return yes === recs.length;
    if (c.consensus === "majority_yes") return yes > recs.length / 2;
    return recs.includes("strong_no");
  }
  return c.flag === "late" ? ctx.flags.late : ctx.flags.integrityHigh;
}

/**
 * Picks the path a candidate takes out of a stage: the first matching rule by priority.
 * Rejections only happen automatically where an admin opted in; otherwise a person decides.
 */
export function evaluateEdges(
  config: WorkflowConfig,
  nodeId: string,
  ctx: RuleContext,
): EdgeDecision {
  const outs = config.edges
    .filter((e) => e.from === nodeId)
    .sort((a, b) => a.priority - b.priority);
  for (const e of outs) {
    if ("always" in e.when || matches(e.when, ctx)) {
      if (e.to === "END_REJECT" && !e.autoReject)
        return { target: "NEEDS_DECISION", edgeId: e.id, wouldReject: true };
      return { target: e.to, edgeId: e.id };
    }
  }
  return { target: "NEEDS_DECISION", edgeId: null };
}
