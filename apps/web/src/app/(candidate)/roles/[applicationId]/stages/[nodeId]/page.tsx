import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock, Video } from "lucide-react";
import { formatIst } from "@iclabs/core";
import { DesktopOnly } from "@/components/desktop-only";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { getCandidateStage } from "@/server/stages/candidate";
import { candidateInterview } from "@/server/interviews";
import { roleSpace } from "@/server/portal";
import { AssessmentStage } from "./assessment-stage";
import { EditAnswers } from "./edit-answers";
import { FormStage } from "./form-stage";
import { SubmittedNotice, type NextStep } from "./submitted-notice";
import { TaskStage } from "./task-stage";

export default async function StagePage({
  params,
}: {
  params: Promise<{ applicationId: string; nodeId: string }>;
}) {
  const { applicationId, nodeId } = await params;
  const { actor } = await requireCandidate();
  const stage = await getCandidateStage(db(), actor, applicationId, nodeId);
  if (!stage) notFound();
  const t = await getTranslations("stage");
  const node = stage.node;
  const interview =
    node.type === "interview" ? await candidateInterview(db(), applicationId, nodeId) : null;
  const submitted =
    stage.state !== "unlocked" && stage.state !== "in_progress" && stage.lastSubmission;
  // The step the candidate can work on now, if any. Interviews are scheduled by us, by email.
  const space = await roleSpace(db(), actor, applicationId);
  const open =
    space?.status === "active"
      ? space.steps.find((s) => s.state === "current" && s.id !== nodeId && s.type !== "interview")
      : undefined;
  const nextStep: NextStep = open
    ? { href: `/roles/${applicationId}/stages/${open.id}`, title: open.title }
    : null;

  const common = {
    applicationId,
    nodeId,
    canSubmit: stage.canSubmit,
    closesAt: stage.closesAt?.toISOString() ?? null,
  };

  return (
    <DesktopOnly>
      <main className="mx-auto max-w-4xl px-4 py-10">
        <Link
          href={`/roles/${applicationId}`}
          className="on-liquid mb-6 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
        >
          <ArrowLeft size={16} aria-hidden /> {t("back", { role: stage.roleTitle })}
        </Link>
        <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
          <div className="h-1.5" style={{ background: "var(--accent-gradient)" }} />
          <div className="p-8">
            <h1 className="font-display text-3xl font-bold tracking-tight">{node.title}</h1>
            <p className="mt-2 flex items-center gap-2 text-muted">
              <CalendarClock size={16} aria-hidden />
              {stage.dueAt ? t("due", { date: formatIst(stage.dueAt) }) : t("noDeadline")}
            </p>
            {node.description && <p className="mt-4 whitespace-pre-line">{node.description}</p>}
          </div>
        </section>

        <div className="mt-6">
          {stage.closed && !submitted && (
            <p className="rounded-card border border-border bg-surface p-6 text-muted">
              {t("closed", { date: formatIst(stage.closesAt!) })}
            </p>
          )}
          {submitted && node.type !== "task" && (
            <SubmittedNotice
              date={formatIst(stage.lastSubmission!.submittedAt)}
              late={stage.lastSubmission!.isLate}
              next={nextStep}
            />
          )}
          {submitted && stage.canEdit && "fields" in node && (
            <EditAnswers
              applicationId={applicationId}
              nodeId={nodeId}
              fields={node.fields}
              closesAt={formatIst(stage.closesAt!)}
              answers={stage.lastSubmission!.data as Record<string, unknown>}
              files={stage.lastSubmission!.files}
            />
          )}
          {!stage.closed &&
            !submitted &&
            (node.type === "form" || node.type === "custom") &&
            "fields" in node && <FormStage {...common} fields={node.fields} draft={stage.draft} />}
          {node.type === "task" && "deliverables" in node && (
            <TaskStage
              {...common}
              brief={node.brief}
              deliverables={node.deliverables}
              problemStatements={node.problemStatements}
              allowResubmit={node.allowResubmit}
              draft={stage.draft as Record<string, string>}
              last={
                stage.lastSubmission
                  ? {
                      version: stage.lastSubmission.version,
                      data: stage.lastSubmission.data as Record<string, string>,
                      submittedAt: stage.lastSubmission.submittedAt.toISOString(),
                      isLate: stage.lastSubmission.isLate,
                      files: stage.lastSubmission.files,
                    }
                  : null
              }
              closed={stage.closed}
              canEdit={stage.canEdit}
              nextStep={nextStep}
            />
          )}
          {node.type === "assessment" && "questionCount" in node && !submitted && !stage.closed && (
            <AssessmentStage
              {...common}
              durationMin={node.durationMin}
              questionCount={node.questionCount}
              started={!!stage.session}
            />
          )}
          {node.type === "interview" && !interview && (
            <p className="rounded-card border border-border bg-surface p-6">{t("interview")}</p>
          )}
          {interview?.status === "done" && (
            <p className="rounded-card border border-border bg-success-bg p-6 text-success-fg">
              {t("interviewDone")}
            </p>
          )}
          {interview?.status === "scheduled" && (
            <section className="rounded-card border border-border bg-surface p-6 shadow-card">
              <h2 className="font-display text-xl font-bold">
                {t("interviewBooked", { round: interview.roundName })}
              </h2>
              <p className="mt-2 text-lg">
                {t("interviewWhen", {
                  when: formatIst(interview.startsAt),
                  minutes: Math.round(
                    (interview.endsAt.getTime() - interview.startsAt.getTime()) / 60_000,
                  ),
                })}
              </p>
              {interview.mode === "meet" && interview.meetUrl && (
                <a
                  href={interview.meetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-600"
                >
                  <Video size={18} aria-hidden /> {t("interviewJoin")}
                </a>
              )}
              {interview.mode === "phone" && (
                <p className="mt-3 text-muted">{t("interviewPhone")}</p>
              )}
              {interview.mode === "in_person" && (
                <p className="mt-3 text-muted">
                  {t("interviewAt", { place: interview.location ?? "Isocode Labs" })}
                </p>
              )}
              <p className="mt-4 text-sm text-muted">{t("interviewChange")}</p>
            </section>
          )}
        </div>
      </main>
    </DesktopOnly>
  );
}
