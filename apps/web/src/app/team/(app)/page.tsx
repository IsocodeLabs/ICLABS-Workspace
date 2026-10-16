import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/top-bar";
import { requireTeam } from "@/server/auth/session";

export default async function TeamHome() {
  const { actor, session } = await requireTeam();
  const t = await getTranslations("team");
  return (
    <>
      <TopBar subtitle={t(`roles.${actor.role}`)} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-muted">
          {t("signedInAs", { email: session.user.email, role: t(`roles.${actor.role}`) })}
        </p>
        <p className="mt-8 rounded-card border border-dashed border-border bg-surface p-10 text-center text-muted">
          {t("comingNext")}
        </p>
      </main>
    </>
  );
}
