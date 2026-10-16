import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CalendarClock } from "lucide-react";
import { formatIst } from "@iclabs/core";
import { DesktopOnly } from "@/components/desktop-only";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { getCandidateStage } from "@/server/stages/candidate";
import { AssessmentStage } from "./assessment-stage";
import { FormStage } from "./form-stage";
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
  const submitted =
    stage.state !== "unlocked" && stage.state !== "in_progress" && stage.lastSubmission;

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
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text"
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
            <p className="rounded-card border border-border bg-success-bg p-6 text-success-fg">
              {t("submitted", { date: formatIst(stage.lastSubmission!.submittedAt) })}
              {stage.lastSubmission!.isLate && (
                <span className="mt-1 block text-sm">{t("submittedLate")}</span>
              )}
            </p>
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
              allowResubmit={node.allowResubmit}
              draft={stage.draft as Record<string, string>}
              last={
                stage.lastSubmission
                  ? {
                      version: stage.lastSubmission.version,
                      data: stage.lastSubmission.data as Record<string, string>,
                      submittedAt: stage.lastSubmission.submittedAt.toISOString(),
                      isLate: stage.lastSubmission.isLate,
                    }
                  : null
              }
              closed={stage.closed}
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
          {node.type === "interview" && (
            <p className="rounded-card border border-border bg-surface p-6">{t("interview")}</p>
          )}
        </div>
      </main>
    </DesktopOnly>
  );
}
