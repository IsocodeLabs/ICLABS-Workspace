import Link from "next/link";
import type { hiringDashboard } from "@/server/dashboard";
import { Card } from "@/components/admin";

type Data = Awaited<ReturnType<typeof hiringDashboard>>;

function Stat({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
}) {
  const body = (
    <Card className="h-full transition hover:-translate-y-0.5">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="mt-1 font-display text-4xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const daysAgo = (d: Date | null) =>
  d
    ? `Oldest waiting ${Math.max(0, Math.round((Date.now() - d.getTime()) / 86_400_000))}d`
    : undefined;

/** Funnel and backlog at a glance. Bars are proportional to the track's total. */
export function Dashboard({ data }: { data: Data }) {
  const { totals, funnels } = data;
  return (
    <section className="mt-10">
      <h2 className="mb-4 font-display text-2xl font-bold">Hiring at a glance</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Candidates" value={totals.candidates} href="/team/candidates" />
        <Stat label="Need a decision" value={totals.needsDecision} href="/team/pipeline" />
        <Stat
          label="Open reviews"
          value={totals.openReviews}
          href="/team/reviews"
          hint={daysAgo(totals.oldestReview)}
        />
        <Stat
          label="Interviews this week"
          value={totals.interviewsThisWeek}
          href="/team/interviews"
        />
        <Stat label="Completed" value={totals.completed} />
      </div>

      {funnels.length === 0 ? (
        <p className="mt-6 text-muted">
          Funnels appear once candidates are invited to a published process.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 xl:grid-cols-2">
          {funnels.map((f) => (
            <Card key={f.workflowId}>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <Link
                  href={`/team/pipeline?track=${f.workflowId}`}
                  className="font-display text-lg font-semibold hover:underline"
                >
                  {f.label}
                </Link>
                <span className="text-sm text-muted">
                  {f.total} · avg {f.avgComposite ?? "—"}
                </span>
              </div>
              <ol className="space-y-2.5">
                {f.stages.map((s) => (
                  <li key={s.nodeId}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span className="font-medium">{s.title}</span>
                      <span className="tabular-nums text-muted">
                        {s.finished}/{s.reached} done
                      </span>
                    </div>
                    <div
                      className="relative h-2.5 overflow-hidden rounded-full bg-neutral-bg"
                      role="img"
                      aria-label={`${s.reached} of ${f.total} reached, ${s.finished} finished`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-brand-500/30"
                        style={{ width: `${(s.reached / f.total) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${(s.finished / f.total) * 100}%`,
                          background: "var(--accent-gradient)",
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
