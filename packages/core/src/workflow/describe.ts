import type { Condition, WorkflowEdge } from "./schema";

const TARGET_LABELS = {
  NEEDS_DECISION: "Needs decision",
  END_REJECT: "Not progressing",
  END_COMPLETE: "Completed",
} as const;

export function targetLabel(to: string, titles: Record<string, string>): string {
  return TARGET_LABELS[to as keyof typeof TARGET_LABELS] ?? titles[to] ?? "Missing stage";
}

/** Short plain-English label for a rule, shown on canvas connections. */
export function describeCondition(when: WorkflowEdge["when"]): string {
  if ("always" in when) return "Otherwise";
  return describe(when);
}

function describe(c: Condition): string {
  if ("all" in c) return c.all.map(describe).join(" and ");
  if ("any" in c) return c.any.map(describe).join(" or ");
  if ("metric" in c) {
    const label = {
      auto_score_pct: "Quiz score",
      rubric_pct: "Review score",
      composite: "Overall score",
    }[c.metric];
    return `${label} ${c.op} ${c.value}%`;
  }
  if ("criterion" in c) return `Criterion ${c.op} ${c.value}`;
  if ("answer" in c) {
    const value = Array.isArray(c.answer.value) ? c.answer.value.join(", ") : c.answer.value;
    return `Answer ${c.answer.op === "contains" ? "contains" : c.answer.op === "in" ? "is one of" : "is"} "${value}"`;
  }
  if ("rank" in c) {
    const by = c.rank.by === "composite" ? "overall" : "review";
    return c.rank.top ? `Top ${c.rank.top} by ${by} score` : `Top ${c.rank.topPct}% by ${by} score`;
  }
  if ("consensus" in c) {
    return {
      all_yes: "All reviewers say yes",
      majority_yes: "Most reviewers say yes",
      any_strong_no: "Any strong no",
    }[c.consensus];
  }
  return c.flag === "late" ? "Submitted late" : "Integrity flags raised";
}
