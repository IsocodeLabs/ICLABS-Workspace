import type { Rubric } from "../workflow/schema";
import type { Recommendation } from "./rules";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function scaleMax(rubric: Rubric): number {
  return rubric.scale === "1-10" ? 10 : rubric.scale === "1-5" ? 5 : 1;
}

function scaleMin(rubric: Rubric): number {
  return rubric.scale === "pass-fail" ? 0 : 1;
}

/** Every criterion scored, whole numbers within the scale. Returns a message or null. */
export function validateScores(rubric: Rubric, scores: Record<string, number>): string | null {
  for (const c of rubric.criteria) {
    const s = scores[c.id];
    if (s === undefined || !Number.isInteger(s) || s < scaleMin(rubric) || s > scaleMax(rubric)) {
      return `Score "${c.name}" from ${scaleMin(rubric)} to ${scaleMax(rubric)}.`;
    }
  }
  return null;
}

/** Weighted rubric score as a percentage of the scale's maximum. */
export function rubricPct(rubric: Rubric, scores: Record<string, number>): { pct: number; failedMustPass: boolean } {
  const totalWeight = rubric.criteria.reduce((n, c) => n + c.weight, 0) || rubric.criteria.length;
  const max = scaleMax(rubric);
  let sum = 0;
  let failedMustPass = false;
  for (const c of rubric.criteria) {
    const s = scores[c.id] ?? 0;
    const w = rubric.criteria.every((x) => x.weight === 0) ? 1 : c.weight;
    sum += (s / max) * w;
    if (c.mustPassMin !== undefined && s < c.mustPassMin) failedMustPass = true;
  }
  return { pct: round2((sum / totalWeight) * 100), failedMustPass };
}

export type ReviewInput = { scores: Record<string, number>; recommendation: Recommendation | null };

/**
 * Combines human reviews: average per criterion and overall. `divergent` flags a spread of
 * more than 30% of the scale on any criterion, so the team can calibrate.
 */
export function aggregateReviews(rubric: Rubric, reviews: ReviewInput[]) {
  const criteria: Record<string, number> = {};
  let divergent = false;
  const span = scaleMax(rubric) - scaleMin(rubric) || 1;
  for (const c of rubric.criteria) {
    const values = reviews.map((r) => r.scores[c.id]).filter((v): v is number => v !== undefined);
    if (values.length === 0) continue;
    criteria[c.id] = round2(values.reduce((a, b) => a + b, 0) / values.length);
    if (Math.max(...values) - Math.min(...values) > span * 0.3) divergent = true;
  }
  const pcts = reviews.map((r) => rubricPct(rubric, r.scores));
  return {
    criteria,
    pct: pcts.length ? round2(pcts.reduce((a, b) => a + b.pct, 0) / pcts.length) : null,
    failedMustPass: pcts.some((p) => p.failedMustPass),
    recommendations: reviews.map((r) => r.recommendation).filter((r): r is Recommendation => r !== null),
    divergent,
  };
}

/** Weighted average of stage scores, re-normalised over the stages that have a score so far. */
export function compositeScore(weights: Record<string, number>, stagePct: Record<string, number>): number | null {
  let sum = 0;
  let used = 0;
  for (const [nodeId, w] of Object.entries(weights)) {
    const pct = stagePct[nodeId];
    if (pct === undefined || w <= 0) continue;
    sum += pct * w;
    used += w;
  }
  return used > 0 ? round2(sum / used) : null;
}

export function isBorderline(pct: number, borderline?: { cutoff: number; band: number }): boolean {
  return !!borderline && Math.abs(pct - borderline.cutoff) <= borderline.band;
}

/** Fair reviewer assignment. Round robin = fewest reviews on this stage; load = fewest open. */
export function pickReviewers(input: {
  pool: string[];
  count: number;
  method: "round_robin" | "load" | "manual";
  stageCounts: Record<string, number>;
  openLoad: Record<string, number>;
  exclude: string[];
}): string[] {
  if (input.method === "manual") return [];
  const metric = input.method === "load" ? input.openLoad : input.stageCounts;
  return input.pool
    .filter((id) => !input.exclude.includes(id))
    .map((id, order) => ({ id, n: metric[id] ?? 0, order }))
    .sort((a, b) => a.n - b.n || a.order - b.order)
    .slice(0, input.count)
    .map((x) => x.id);
}
