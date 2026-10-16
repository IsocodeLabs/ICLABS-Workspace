import { describe, expect, it } from "vitest";
import { describeCondition, targetLabel } from "./describe";

describe("describeCondition", () => {
  it.each([
    [{ always: true as const }, "Otherwise"],
    [{ metric: "auto_score_pct" as const, op: ">=" as const, value: 70 }, "Quiz score >= 70%"],
    [{ rank: { by: "composite" as const, top: 15 } }, "Top 15 by overall score"],
    [{ consensus: "any_strong_no" as const }, "Any strong no"],
    [{ answer: { fieldId: "track", op: "eq" as const, value: "Backend" } }, 'Answer is "Backend"'],
    [
      {
        all: [
          { flag: "late" as const },
          { metric: "composite" as const, op: "<" as const, value: 40 },
        ],
      },
      "Submitted late and Overall score < 40%",
    ],
  ])("%j → %s", (when, text) => {
    expect(describeCondition(when)).toBe(text);
  });

  it("labels terminal targets and stages", () => {
    expect(targetLabel("END_REJECT", {})).toBe("Not progressing");
    expect(targetLabel("abc", { abc: "Tech quiz" })).toBe("Tech quiz");
  });
});

describe("describeCondition, remaining forms", () => {
  it.each([
    [
      { any: [{ flag: "integrity_high" as const }, { consensus: "all_yes" as const }] },
      "Integrity flags raised or All reviewers say yes",
    ],
    [{ rank: { by: "rubric_pct" as const, topPct: 20 } }, "Top 20% by review score"],
    [
      { answer: { fieldId: "f", op: "contains" as const, value: "react" } },
      'Answer contains "react"',
    ],
    [{ answer: { fieldId: "f", op: "in" as const, value: ["A", "B"] } }, 'Answer is one of "A, B"'],
    [{ criterion: "c1", op: "<" as const, value: 2 }, "Criterion < 2"],
    [{ consensus: "majority_yes" as const }, "Most reviewers say yes"],
    [{ metric: "rubric_pct" as const, op: ">" as const, value: 50 }, "Review score > 50%"],
  ])("%j → %s", (when, text) => {
    expect(describeCondition(when)).toBe(text);
  });

  it("labels the remaining terminals and missing stages", () => {
    expect(targetLabel("NEEDS_DECISION", {})).toBe("Needs decision");
    expect(targetLabel("END_COMPLETE", {})).toBe("Completed");
    expect(targetLabel("gone", {})).toBe("Missing stage");
  });
});
