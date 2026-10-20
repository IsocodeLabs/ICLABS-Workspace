import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Video } from "lucide-react";
import { formatIst } from "@iclabs/core";
import { Card, Page } from "@/components/admin";
import { StatusPill, type Tone } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { getInterviewBrief } from "@/server/interviews";

const recTone: Record<string, Tone> = { strong_yes: "success", yes: "success", no: "danger", strong_no: "danger" };
const isUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\//i.test(v);

export default async function InterviewBriefPage({ params }: { params: Promise<{ interviewId: string }> }) {
  const { actor } = await requireTeam();
  const { interviewId } = await params;
  const brief = await getInterviewBrief(db(), actor, interviewId);
  if (!brief) notFound();
  const { interview: iv, candidate: c } = brief;

  return (
    <Page>
      <Link href="/team/interviews" className="on-liquid mb-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline">
        <ArrowLeft size={16} aria-hidden /> Interviews
      </Link>
      <Card className="overflow-hidden p-0">
        <div className="h-1.5" style={{ background: "var(--accent-gradient)" }} />
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">{iv.roundName} · {brief.roleTitle}</p>
            <h1 className="font-display text-3xl font-bold">{c.name}</h1>
            <p className="mt-1 text-muted">
              {formatIst(iv.startsAt)} · {Math.round((iv.endsAt.getTime() - iv.startsAt.getTime()) / 60_000)} min · Panel: {brief.panel.join(", ")}
            </p>
          </div>
          <div className="text-right">
            {brief.composite !== null && (
              <p className="font-display text-4xl font-bold tabular-nums">
                {brief.composite}
                <span className="text-lg text-muted">%</span>
              </p>
            )}
            <p className="text-xs text-muted">composite so far</p>
            {iv.meetUrl && iv.status === "scheduled" && (
              <a href={iv.meetUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white">
                <Video size={16} aria-hidden /> Join Meet
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border px-6 py-3 text-sm text-muted">
          <span>{c.email}</span>
          {c.college && <span>{c.college}{c.gradYear ? ` · ${c.gradYear}` : ""}</span>}
          {c.github && <a className="underline" href={c.github} target="_blank" rel="noopener noreferrer">GitHub</a>}
          {c.linkedin && <a className="underline" href={c.linkedin} target="_blank" rel="noopener noreferrer">LinkedIn</a>}
          {c.portfolio && <a className="underline" href={c.portfolio} target="_blank" rel="noopener noreferrer">Portfolio</a>}
          {c.skills.length > 0 && <span>Skills: {c.skills.join(", ")}</span>}
          {brief.canManage && <Link className="underline" href={`/team/candidates/${c.id}`}>Full profile</Link>}
        </div>
      </Card>

      <h2 className="on-liquid mt-8 mb-3 font-display text-xl font-bold">Their journey so far</h2>
      <div className="space-y-4">
        {brief.stages.map((s) => (
          <Card key={s.nodeId}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <div className="flex items-center gap-2">
                {s.pct !== null && <span className="font-display text-xl font-bold tabular-nums">{s.pct}%</span>}
                <StatusPill tone={s.state === "failed" || s.state === "missed" ? "danger" : s.state === "passed" || s.state === "reviewed" ? "success" : "neutral"}>
                  {s.state.replace("_", " ")}
                </StatusPill>
              </div>
            </div>
            {s.fields.length > 0 && (
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                {s.fields.map((f) => (
                  <div key={f.label} className="min-w-0">
                    <dt className="text-muted">{f.label}</dt>
                    <dd className="break-words">
                      {f.fileId ? (
                        brief.canManage ? (
                          <a href={`/api/files/${f.fileId}`} target="_blank" rel="noopener" className="text-brand-600 underline">{f.value}</a>
                        ) : (
                          f.value
                        )
                      ) : isUrl(f.value) ? (
                        <a href={f.value} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-600 underline">
                          {f.value} <ExternalLink size={12} aria-hidden />
                        </a>
                      ) : (
                        <span className="whitespace-pre-wrap">{f.value}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
            {s.reviews.length > 0 && (
              <ul className="mt-4 space-y-2">
                {s.reviews.map((r, i) => (
                  <li key={i} className="rounded-xl bg-neutral-bg px-4 py-2.5 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.reviewer}
                      {r.pct !== null && <span className="tabular-nums">{r.pct}%</span>}
                      {r.recommendation && <StatusPill tone={recTone[r.recommendation] ?? "neutral"}>{r.recommendation.replace("_", " ")}</StatusPill>}
                    </p>
                    {r.notes && <p className="mt-1 whitespace-pre-wrap">{r.notes}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </Page>
  );
}
