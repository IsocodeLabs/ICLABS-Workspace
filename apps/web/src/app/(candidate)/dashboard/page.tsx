import { getTranslations } from "next-intl/server";
import { StatusPill, type Tone } from "@/components/ui";
import { TopBar } from "@/components/top-bar";
import { listApplicationsForActor, type ApplicationCard } from "@/server/applications";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";

// Candidates see a neutral status only; scores never reach this page.
const tone: Record<ApplicationCard["status"], Tone> = {
  active: "neutral",
  needs_decision: "warning",
  on_hold: "warning",
  interview_scheduled: "success",
  completed: "success",
  closed_rejected: "neutral",
  closed_withdrawn: "neutral",
};

export default async function DashboardPage() {
  const { actor, session } = await requireCandidate();
  const t = await getTranslations("dashboard");
  const apps = await listApplicationsForActor(db(), actor);

  return (
    <>
      <TopBar subtitle={session.user.email} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">{t("subtitle")}</p>
        {apps.length === 0 ? (
          <p className="mt-10 rounded-card border border-dashed border-border bg-surface p-10 text-center text-muted">
            {t("empty")}
          </p>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((app) => (
              <li
                key={app.id}
                className="rounded-card border border-border bg-surface p-6 shadow-card"
              >
                <h2 className="font-display text-xl font-semibold">{app.roleTitle}</h2>
                <div className="mt-4">
                  <StatusPill tone={tone[app.status]}>{t(`status.${app.status}`)}</StatusPill>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
