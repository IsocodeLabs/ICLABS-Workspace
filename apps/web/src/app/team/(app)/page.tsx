import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Check, Circle } from "lucide-react";
import { Card, Page, PageHeader } from "@/components/admin";
import { requireTeam } from "@/server/auth/session";
import { db } from "@/server/db";
import { hiringDashboard } from "@/server/dashboard";
import { teamOverview } from "@/server/team-overview";
import { Dashboard } from "./dashboard";

export default async function TeamHome() {
  const { actor, session } = await requireTeam();
  const t = await getTranslations("team");
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const [overview, dashboard] = await Promise.all([
    teamOverview(db(), actor),
    manages ? hiringDashboard(db(), actor) : Promise.resolve(null),
  ]);
  const firstName = session.user.email.split("@")[0]!.split(/[._-]/)[0]!;
  const doneSteps = overview.setup.filter((s) => s.done).length;
  const nextStep = overview.setup.find((s) => !s.done);

  return (
    <Page>
      <PageHeader
        title={`Hi ${firstName.charAt(0).toUpperCase()}${firstName.slice(1)}`}
        subtitle={t("signedInAs", { email: session.user.email, role: t(`roles.${actor.role}`) })}
      />

      <section aria-labelledby="attention" className="mb-8">
        <h2 id="attention" className="mb-3 font-display text-xl font-bold">
          Needs your attention
        </h2>
        {overview.items.length === 0 ? (
          <Card>
            <p className="font-semibold">You&apos;re all caught up.</p>
            <p className="mt-1 text-muted">
              Nothing is waiting on you right now. New reviews and decisions will show up here.
            </p>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {overview.items.map((i) => (
              <Link key={i.title} href={i.href} className="group">
                <Card className="flex items-center gap-4 p-5 transition group-hover:-translate-y-0.5">
                  <span className="grid h-12 min-w-12 place-items-center rounded-2xl bg-brand-500 px-2 font-display text-xl font-bold tabular-nums text-white">
                    {i.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{i.title}</span>
                    <span className="block text-sm text-muted">{i.detail}</span>
                  </span>
                  <ArrowRight
                    size={18}
                    className="text-muted transition group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      {nextStep && (
        <section aria-labelledby="setup" className="mb-8">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="setup" className="font-display text-xl font-bold">
                Get set up
              </h2>
              <span className="text-sm font-semibold text-muted">
                {doneSteps} of {overview.setup.length} done
              </span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-bg"
              role="progressbar"
              aria-valuenow={doneSteps}
              aria-valuemin={0}
              aria-valuemax={overview.setup.length}
              aria-label="Setup progress"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(doneSteps / overview.setup.length) * 100}%`,
                  background: "var(--accent-gradient)",
                }}
              />
            </div>
            <ol className="mt-4 space-y-1">
              {overview.setup.map((s) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-neutral-bg ${
                      s === nextStep ? "bg-neutral-bg" : ""
                    }`}
                  >
                    {s.done ? (
                      <Check size={18} className="text-success-fg" aria-label="Done" />
                    ) : (
                      <Circle size={18} className="text-muted" aria-label="To do" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block font-semibold ${s.done ? "text-muted line-through" : ""}`}
                      >
                        {s.label}
                      </span>
                      {!s.done && <span className="block text-sm text-muted">{s.hint}</span>}
                    </span>
                    {s === nextStep && (
                      <span className="rounded-full bg-brand-500 px-2.5 py-0.5 text-xs font-bold text-white">
                        Next
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        </section>
      )}

      {dashboard && <Dashboard data={dashboard} />}
    </Page>
  );
}
