import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, FileText, ShieldAlert } from "lucide-react";
import { formatIst, taskSubmissionFields } from "@iclabs/core";
import { Card } from "@/components/admin";
import { StatusPill } from "@/components/ui";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { aiReviewEnabled } from "@/server/ai";
import { getReviewView, type ReviewView, type StageAnswers } from "@/server/reviews/queue";
import { ReviewForm } from "./review-form";

const isUrl = (v: string) => /^https?:\/\//i.test(v);

function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "")
    return <span className="text-muted">—</span>;
  const text = Array.isArray(value) ? value.join(", ") : String(value);
  if (isUrl(text))
    return (
      <a
        href={text}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 break-all font-medium text-brand-600 underline"
      >
        {text} <ExternalLink size={14} aria-hidden />
      </a>
    );
  return <p className="whitespace-pre-wrap break-words">{text}</p>;
}

function FileLink({
  id,
  files,
}: {
  id: string;
  files: NonNullable<ReviewView["submission"]>["files"];
}) {
  const f = files.find((x) => x.id === id);
  if (!f) return <span className="text-muted">File unavailable</span>;
  if (f.scanStatus !== "clean")
    return (
      <StatusPill tone="warning">
        {f.filename}: {f.scanStatus}
      </StatusPill>
    );
  return (
    <a
      href={`/api/files/${f.id}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 font-medium text-brand-600 underline"
    >
      <FileText size={16} aria-hidden /> {f.filename}{" "}
      <span className="text-sm text-muted">({Math.ceil(f.size / 1024)} KB)</span>
    </a>
  );
}

function Submission({
  node,
  submission,
  assessment,
}: { node: ReviewView["node"] } & Omit<StageAnswers, "versions">) {
  if (assessment) {
    return (
      <ol className="space-y-5">
        {assessment.questions.map((q, i) => {
          const picked = new Set(Array.isArray(q.answer) ? q.answer : q.answer ? [q.answer] : []);
          const objective = q.type === "mcq" || q.type === "multi";
          return (
            <li key={q.id}>
              <p className="font-semibold">
                {i + 1}. {q.body}{" "}
                <span className="text-sm font-normal text-muted">({q.points} pt)</span>
              </p>
              {objective ? (
                <ul className="mt-2 space-y-1">
                  {q.options.map((o) => {
                    const right = q.correct.includes(o.id);
                    const chose = picked.has(o.id);
                    return (
                      <li
                        key={o.id}
                        className={`rounded-lg px-3 py-1.5 text-sm ${right ? "bg-success-bg text-success-fg" : chose ? "bg-danger-bg text-danger-fg" : "bg-neutral-bg"}`}
                      >
                        {chose ? "● " : "○ "}
                        {o.text}
                        {right && " ✓"}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-2 rounded-lg bg-neutral-bg px-3 py-2">
                  <Value value={q.answer} />
                </div>
              )}
              {q.explanation && !objective && (
                <p className="mt-1 text-sm text-muted">Guidance: {q.explanation}</p>
              )}
            </li>
          );
        })}
      </ol>
    );
  }
  if (!submission) return <p className="text-muted">Nothing submitted for this stage.</p>;
  const data = submission.data as Record<string, unknown>;
  const items =
    node.type === "task"
      ? taskSubmissionFields(node.config)
      : node.type === "form" || node.type === "custom"
        ? node.config.fields
            .filter((f) => f.kind !== "section")
            .map((f) => ({ id: f.id, label: f.label, file: f.kind === "file" }))
        : Object.keys(data).map((k) => ({ id: k, label: k, file: false }));
  return (
    <dl className="space-y-4">
      {items.map((it) => (
        <div key={it.id}>
          <dt className="text-sm font-semibold text-muted">{it.label}</dt>
          <dd className="mt-1">
            {it.file && data[it.id] ? (
              <FileLink id={String(data[it.id])} files={submission.files} />
            ) : (
              <Value value={data[it.id]} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { actor } = await requireTeam(["admin", "hiring_manager", "reviewer"]);
  const { assignmentId } = await params;
  const view = await getReviewView(db(), actor, assignmentId);
  if (!view) notFound();
  const { node, candidate, submission, assessment } = view;
  const brief =
    node.type === "task"
      ? node.config.brief
      : node.type === "review_gate"
        ? node.config.instructions
        : node.description;

  return (
    <main className="mx-auto max-w-none px-6 py-6">
      <Link
        href="/team/reviews"
        className="on-liquid mb-4 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
      >
        <ArrowLeft size={16} aria-hidden /> All reviews
      </Link>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-5">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-brand-600">
                  {view.roleTitle}
                </p>
                <h1 className="font-display text-2xl font-bold">{candidate.label}</h1>
                <p className="text-muted">{node.title}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {submission?.isLate && (
                  <StatusPill tone="warning">Late by {submission.lateByMinutes} min</StatusPill>
                )}
                {view.versions > 1 && (
                  <StatusPill tone="neutral">
                    Version {submission?.version} of {view.versions}
                  </StatusPill>
                )}
                {node.reviewers?.blind && <StatusPill tone="neutral">Blind review</StatusPill>}
                {view.assignment.reason === "borderline_second" && (
                  <StatusPill tone="warning">Second opinion</StatusPill>
                )}
              </div>
            </div>
            {candidate.profile && (
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                {candidate.profile.college && (
                  <span>
                    {candidate.profile.college}
                    {candidate.profile.gradYear
                      ? ` ’${String(candidate.profile.gradYear).slice(-2)}`
                      : ""}
                  </span>
                )}
                {candidate.profile.github && (
                  <a
                    className="underline"
                    href={candidate.profile.github}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                )}
                {candidate.profile.linkedin && (
                  <a
                    className="underline"
                    href={candidate.profile.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    LinkedIn
                  </a>
                )}
                {candidate.profile.portfolio && (
                  <a
                    className="underline"
                    href={candidate.profile.portfolio}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Portfolio
                  </a>
                )}
                {candidate.candidateId && actor.role !== "reviewer" && (
                  <Link className="underline" href={`/team/candidates/${candidate.candidateId}`}>
                    Full profile
                  </Link>
                )}
              </p>
            )}
            {(submission?.submittedAt || assessment?.submittedAt) && (
              <p className="mt-2 text-sm text-muted">
                Submitted {formatIst((submission?.submittedAt ?? assessment?.submittedAt)!)}
              </p>
            )}
          </Card>

          {brief && (
            <details className="rounded-card border border-border bg-surface px-6 py-4">
              <summary className="cursor-pointer font-semibold">
                What the candidate was asked
              </summary>
              <div className="mt-3 text-muted">
                <Markdown>{brief}</Markdown>
              </div>
            </details>
          )}

          {assessment && (
            <Card className={view.integrityHigh ? "border-warning-fg" : ""}>
              <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold">
                <ShieldAlert size={18} aria-hidden /> Integrity
                {view.integrityHigh && <StatusPill tone="warning">Worth a look</StatusPill>}
              </h2>
              <p className="text-sm text-muted">
                {assessment.integrity.tabSwitches} tab switches ·{" "}
                {assessment.integrity.fullscreenExits} full-screen exits ·{" "}
                {assessment.integrity.pasteAttempts} paste attempts ·{" "}
                {Math.round(assessment.integrity.awayMs / 1000)}s away
                {assessment.autoSubmitted && " · auto-submitted at time-up"}
              </p>
              <p className="mt-1 text-xs text-muted">
                Signals only — they can have innocent explanations. Discuss before acting on them.
              </p>
            </Card>
          )}

          <Card>
            <h2 className="mb-4 font-display text-lg font-bold">Submission</h2>
            <Submission node={node} submission={submission} assessment={assessment} />
          </Card>

          {view.earlier.length > 0 && (
            <Card>
              <h2 className="mb-1 font-display text-lg font-bold">Earlier steps</h2>
              <p className="mb-4 text-sm text-muted">
                What {candidate.label.split(" ")[0]} submitted before this stage, for context.
              </p>
              <div className="space-y-3">
                {view.earlier.map((s) => (
                  <details
                    key={s.node.id}
                    className="rounded-xl border border-border px-4 py-3"
                    open={view.earlier.length <= 3}
                  >
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 font-semibold">
                      {s.node.title}
                      {s.autoScorePct !== null && (
                        <StatusPill tone="neutral">
                          Auto-score {Math.round(s.autoScorePct)}%
                        </StatusPill>
                      )}
                      {s.submission?.isLate && <StatusPill tone="warning">Late</StatusPill>}
                      <span className="text-sm font-normal text-muted">
                        {formatIst((s.submission?.submittedAt ?? s.assessment?.submittedAt)!)}
                      </span>
                    </summary>
                    <div className="mt-4">
                      <Submission
                        node={s.node}
                        submission={s.submission}
                        assessment={s.assessment}
                      />
                    </div>
                  </details>
                ))}
              </div>
            </Card>
          )}

          {view.others.length > 0 && (
            <Card>
              <h2 className="mb-3 font-display text-lg font-bold">Other reviews</h2>
              <ul className="space-y-3">
                {view.others.map((o) => (
                  <li key={o.id} className="rounded-xl bg-neutral-bg px-4 py-3">
                    <p className="text-sm font-semibold">
                      {o.reviewerEmail} · {o.totalPct !== null ? `${o.totalPct}%` : "no rubric"} ·{" "}
                      {o.recommendation?.replace("_", " ")}
                    </p>
                    {o.notes && <p className="mt-1 whitespace-pre-wrap text-sm">{o.notes}</p>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <ReviewForm
            assignmentId={view.assignment.id}
            rubric={view.rubric}
            canSubmit={view.canSubmit}
            mine={
              view.mine
                ? {
                    scores: view.mine.scores,
                    recommendation: view.mine.recommendation,
                    notes: view.mine.notes,
                    totalPct: view.mine.totalPct,
                  }
                : null
            }
            ai={
              view.ai
                ? {
                    scores: view.ai.scores,
                    evidence: view.ai.evidence ?? {},
                    notes: view.ai.notes,
                    totalPct: view.ai.totalPct,
                  }
                : null
            }
            aiEnabled={aiReviewEnabled() && !!view.rubric && actor.role === "admin"}
          />
        </div>
      </div>
    </main>
  );
}
