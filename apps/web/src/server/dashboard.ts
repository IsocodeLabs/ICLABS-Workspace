import {
  and,
  eq,
  gt,
  inArray,
  lt,
  sql,
  applications,
  interviews,
  reviewAssignments,
  stageProgress,
  type Db,
} from "@iclabs/db";
import { can, type Actor } from "@iclabs/core";
import { getPipeline, listTracks } from "./reviews/decisions";

type TeamActor = Actor & { kind: "team" };

export type TrackFunnel = {
  workflowId: string;
  label: string;
  total: number;
  stages: { nodeId: string; title: string; reached: number; finished: number }[];
  byStatus: Record<string, number>;
  avgComposite: number | null;
};

/** Headline numbers for admins and hiring managers: funnel per track, backlog, what's next. */
export async function hiringDashboard(db: Db, actor: TeamActor, now = new Date()) {
  const tracks = await listTracks(db, actor);
  const funnels: TrackFunnel[] = [];
  for (const t of tracks) {
    const data = await getPipeline(db, actor, t.id);
    if (!data || data.cards.length === 0) continue;
    const ids = data.cards.map((c) => c.applicationId);
    const progress = await db
      .select({ nodeId: stageProgress.nodeId, state: stageProgress.state })
      .from(stageProgress)
      .where(inArray(stageProgress.applicationId, ids));
    const byStatus: Record<string, number> = {};
    for (const c of data.cards) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
    const scored = data.cards.map((c) => c.composite).filter((x): x is number => x !== null);
    funnels.push({
      workflowId: t.id,
      label: `${t.roleTitle} · ${t.cycleName} · ${t.name}`,
      total: data.cards.length,
      stages: data.nodes.map((n) => {
        const rows = progress.filter((p) => p.nodeId === n.id);
        return {
          nodeId: n.id,
          title: n.title,
          reached: rows.length,
          finished: rows.filter((p) => ["submitted", "reviewed", "passed", "failed"].includes(p.state)).length,
        };
      }),
      byStatus,
      avgComposite: scored.length ? Math.round((scored.reduce((a, b) => a + b, 0) / scored.length) * 10) / 10 : null,
    });
  }

  const visibleApps = async () => {
    const rows = await db
      .select({ id: applications.id, roleId: applications.roleId, workflowId: applications.workflowId })
      .from(applications);
    return rows.filter((r) => can(actor, "read", { type: "workflow", roleId: r.roleId, workflowId: r.workflowId })).map((r) => r.id);
  };
  const ids = await visibleApps();
  const none = [""];
  const [backlog] = await db
    .select({
      open: sql<number>`count(*)::int`,
      oldest: sql<Date | null>`min(${reviewAssignments.assignedAt})`,
    })
    .from(reviewAssignments)
    .where(and(eq(reviewAssignments.status, "assigned"), inArray(reviewAssignments.applicationId, ids.length ? ids : none)));
  const [nextWeek] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(interviews)
    .where(
      and(
        eq(interviews.status, "scheduled"),
        gt(interviews.startsAt, now),
        lt(interviews.startsAt, new Date(now.getTime() + 7 * 24 * 3600_000)),
        inArray(interviews.applicationId, ids.length ? ids : none),
      ),
    );
  const totals = funnels.reduce(
    (acc, f) => {
      acc.candidates += f.total;
      acc.needsDecision += f.byStatus.needs_decision ?? 0;
      acc.completed += f.byStatus.completed ?? 0;
      return acc;
    },
    { candidates: 0, needsDecision: 0, completed: 0 },
  );
  return {
    funnels,
    totals: {
      ...totals,
      openReviews: backlog?.open ?? 0,
      oldestReview: backlog?.oldest ? new Date(backlog.oldest) : null,
      interviewsThisWeek: nextWeek?.n ?? 0,
    },
  };
}
