import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, CheckCircle2, Circle, CircleDot } from "lucide-react";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { roleSpace } from "@/server/portal";

export default async function RoleSpacePage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const { actor } = await requireCandidate();
  const space = await roleSpace(db(), actor, applicationId);
  // 404 (not 403) for other candidates' roles, so their existence isn't revealed.
  if (!space) notFound();
  const t = await getTranslations("roleSpace");
  const closed = space.status === "closed_rejected" || space.status === "closed_withdrawn";

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-text"
      >
        <ArrowLeft size={16} aria-hidden /> {t("back")}
      </Link>
      <section className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
        <div className="h-2" style={{ background: "var(--accent-gradient)" }} />
        <div className="p-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">{space.role.title}</h1>
          {(space.role.location || space.role.duration) && (
            <p className="mt-1 text-muted">
              {[space.role.location, space.role.duration].filter(Boolean).join(" · ")}
            </p>
          )}
          {space.role.description && (
            <p className="mt-4 whitespace-pre-line">{space.role.description}</p>
          )}
        </div>
      </section>

      <h2 className="mb-4 mt-10 font-display text-xl font-semibold">{t("timeline")}</h2>
      {closed ? (
        <p className="rounded-card border border-border bg-surface p-6 text-muted">{t("closed")}</p>
      ) : space.steps.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ol className="space-y-3">
          {space.steps.map((step, i) => {
            const Icon =
              step.state === "done" ? CheckCircle2 : step.state === "current" ? CircleDot : Circle;
            return (
              <li
                key={step.id}
                className={`flex gap-4 rounded-card border bg-surface p-5 ${
                  step.state === "current" ? "border-brand-500 shadow-card" : "border-border"
                }`}
              >
                <Icon
                  size={22}
                  aria-hidden
                  className={
                    step.state === "done"
                      ? "text-success-fg"
                      : step.state === "current"
                        ? "text-brand-500"
                        : "text-muted"
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {i + 1}. {step.title}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t(step.state)}
                    </span>
                  </div>
                  {step.description && <p className="mt-1 text-muted">{step.description}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
