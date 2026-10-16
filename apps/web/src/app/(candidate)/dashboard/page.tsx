import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { StatusPill, type Tone } from "@/components/ui";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { dashboardCards, type RoleCard } from "@/server/portal";

// Candidates see a neutral status only; scores never reach this page.
const tone: Record<RoleCard["status"], Tone> = {
  active: "neutral",
  needs_decision: "warning",
  on_hold: "warning",
  interview_scheduled: "success",
  completed: "success",
  closed_rejected: "neutral",
  closed_withdrawn: "neutral",
};

export default async function DashboardPage() {
  const { actor } = await requireCandidate();
  const t = await getTranslations("dashboard");
  const cards = await dashboardCards(db(), actor);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-muted">{t("subtitle")}</p>
      {cards.length === 0 ? (
        <p className="mt-10 rounded-card border border-dashed border-border bg-surface p-10 text-center text-muted">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <li key={card.applicationId}>
              <Link
                href={`/roles/${card.applicationId}`}
                className="group block h-full rounded-card border border-border bg-surface p-6 shadow-card transition hover:-translate-y-0.5 hover:border-brand-500"
              >
                <div
                  className="mb-4 h-1 w-12 rounded-full"
                  style={{ background: "var(--accent-gradient)" }}
                />
                <h2 className="font-display text-xl font-semibold">{card.roleTitle}</h2>
                {card.currentStep && (
                  <p className="mt-1 text-muted">{t("currentStep", { step: card.currentStep })}</p>
                )}
                <div className="mt-4 flex items-center justify-between">
                  <StatusPill tone={tone[card.status]}>{t(`status.${card.status}`)}</StatusPill>
                  <span className="flex items-center gap-1 text-sm font-semibold text-brand-600 group-hover:gap-2">
                    {t("open")} <ArrowRight size={16} aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
