import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, Page, PageHeader } from "@/components/admin";
import { requireTeam } from "@/server/auth/session";
import { db } from "@/server/db";
import { hiringDashboard } from "@/server/dashboard";
import { Dashboard } from "./dashboard";

export default async function TeamHome() {
  const { actor, session } = await requireTeam();
  const t = await getTranslations("team");
  const manages = actor.role === "admin" || actor.role === "hiring_manager";
  const dashboard = manages ? await hiringDashboard(db(), actor) : null;
  const links =
    actor.role === "admin" || actor.role === "hiring_manager"
      ? [
          {
            href: "/team/roles",
            title: "Roles & processes",
            body: "Design each role's selection process.",
          },
          { href: "/team/candidates", title: "Candidates", body: "Invite shortlisted candidates." },
          { href: "/team/pipeline", title: "Pipeline", body: "See where everyone stands." },
        ]
      : [
          {
            href: "/team/reviews",
            title: "My reviews",
            body: "Submissions waiting for your score.",
          },
        ];
  return (
    <Page>
      <PageHeader
        title={t("title")}
        subtitle={t("signedInAs", { email: session.user.email, role: t(`roles.${actor.role}`) })}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="group">
            <Card className="h-full transition group-hover:-translate-y-0.5">
              <h2 className="font-display text-lg font-semibold">{l.title}</h2>
              <p className="mt-1 text-muted">{l.body}</p>
            </Card>
          </Link>
        ))}
      </div>
      {dashboard && <Dashboard data={dashboard} />}
    </Page>
  );
}
