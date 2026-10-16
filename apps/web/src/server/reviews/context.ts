import {
  and,
  desc,
  eq,
  inArray,
  assessmentSessions,
  reviews,
  stageProgress,
  submissions,
  type Db,
} from "@iclabs/db";
import { aggregateReviews, compositeScore, type RuleContext } from "@iclabs/core";
import { integritySummary } from "../stages/candidate";
import type { PinnedApplication } from "../stages/progression";

/** Tab switches + full-screen exits, or paste attempts, at or above these flag a session. */
export const INTEGRITY_HIGH = { awayEvents: 5, pastes: 3 };

export type Integrity = Awaited<ReturnType<typeof integritySummary>>;

export const isIntegrityHigh = (i: Integrity | null) =>
  !!i && (i.tabSwitches + i.fullscreenExits >= INTEGRITY_HIGH.awayEvents || i.pasteAttempts >= INTEGRITY_HIGH.pastes);

const asAnswers = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v.map(String) : String(v)]),
  ) as Record<string, string | string[]>;

/** Human-review aggregate for one stage, or null when it has no rubric or no reviews yet. */
export async function stageReviewAggregate(db: Db, pinned: PinnedApplication, progressId: string, nodeId: string) {
  const node = pinned.config.nodes.find((n) => n.id === nodeId);
  const rows = await db
    .select({ scores: reviews.scores, recommendation: reviews.recommendation })
    .from(reviews)
    .where(and(eq(reviews.stageProgressId, progressId), eq(reviews.kind, "human")));
  if (rows.length === 0) return null;
  if (!node?.rubric) {
    return {
      criteria: {},
      pct: null,
      failedMustPass: false,
      recommendations: rows.map((r) => r.recommendation).filter((r) => r !== null),
      divergent: false,
      count: rows.length,
    };
  }
  return { ...aggregateReviews(node.rubric, rows), count: rows.length };
}

/** Stage weights from the process; with none set, every scored stage counts equally. */
export function compositeFor(config: PinnedApplication["config"], scores: Record<string, number>) {
  const weights = Object.keys(config.scoring.weights).length
    ? config.scoring.weights
    : Object.fromEntries(config.nodes.map((n) => [n.id, 1]));
  return compositeScore(weights, scores);
}

/** Best score per stage so far: human rubric score where reviewed, otherwise the auto score. */
export async function stageScores(db: Db, pinned: PinnedApplication): Promise<Record<string, number>> {
  const rows = await db.select().from(stageProgress).where(eq(stageProgress.applicationId, pinned.app.id));
  const out: Record<string, number> = {};
  for (const p of rows) {
    const agg = await stageReviewAggregate(db, pinned, p.id, p.nodeId);
    const pct = agg?.pct ?? p.autoScorePct;
    if (pct !== null && pct !== undefined) out[p.nodeId] = pct;
  }
  return out;
}

/** Everything the exit rules of a stage can look at for one application. */
export async function buildRuleContext(
  db: Db,
  pinned: PinnedApplication,
  nodeId: string,
): Promise<RuleContext & { divergent: boolean; integrity: Integrity | null }> {
  const [progress] = await db
    .select()
    .from(stageProgress)
    .where(and(eq(stageProgress.applicationId, pinned.app.id), eq(stageProgress.nodeId, nodeId)));
  if (!progress) throw new Error("stage not reached");
  const [latest] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.stageProgressId, progress.id))
    .orderBy(desc(submissions.version))
    .limit(1);
  const [session] = await db
    .select({ id: assessmentSessions.id })
    .from(assessmentSessions)
    .where(eq(assessmentSessions.stageProgressId, progress.id));
  const integrity = session ? await integritySummary(db, session.id) : null;
  const agg = await stageReviewAggregate(db, pinned, progress.id, nodeId);
  const scores = await stageScores(db, pinned);
  const formData = latest && !session ? (latest.data as Record<string, unknown>) : {};
  return {
    autoScorePct: progress.autoScorePct,
    rubricPct: agg?.pct ?? null,
    composite: compositeFor(pinned.config, scores),
    criteria: agg?.criteria,
    recommendations: agg?.recommendations,
    answers: asAnswers(formData),
    flags: { late: !!latest?.isLate, integrityHigh: isIntegrityHigh(integrity) },
    divergent: agg?.divergent ?? false,
    integrity,
  };
}

/** Stage progress rows for many applications at once (pipeline). */
export async function progressFor(db: Db, applicationIds: string[]) {
  if (applicationIds.length === 0) return [];
  return db.select().from(stageProgress).where(inArray(stageProgress.applicationId, applicationIds));
}
