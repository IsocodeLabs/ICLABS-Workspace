export type QuestionType = "mcq" | "multi" | "short" | "long";

export type GradableQuestion = {
  id: string;
  type: QuestionType;
  points: number;
  correct: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Auto-grades the objective part of an assessment. Single choice is all-or-nothing;
 * multi-select gives partial credit, and each wrong pick cancels a right one.
 * Written answers are left for reviewers (`needsReview`).
 */
export function autoScore(
  questions: GradableQuestion[],
  answers: Record<string, string[] | string | undefined>,
): { earned: number; possible: number; pct: number | null; needsReview: boolean } {
  let earned = 0;
  let possible = 0;
  let needsReview = false;
  for (const q of questions) {
    if (q.type === "short" || q.type === "long") {
      needsReview = true;
      continue;
    }
    possible += q.points;
    const given = answers[q.id];
    const picked = new Set(Array.isArray(given) ? given : given ? [given] : []);
    if (q.type === "mcq") {
      if (picked.size === 1 && picked.has(q.correct[0]!)) earned += q.points;
      continue;
    }
    const correct = new Set(q.correct);
    const right = [...picked].filter((p) => correct.has(p)).length;
    const wrong = picked.size - right;
    earned += (Math.max(0, right - wrong) / Math.max(1, correct.size)) * q.points;
  }
  return {
    earned: round2(earned),
    possible,
    pct: possible > 0 ? round2((earned / possible) * 100) : null,
    needsReview,
  };
}
