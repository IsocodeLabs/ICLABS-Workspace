import { getTranslations } from "next-intl/server";
import { Alert, AuthShell } from "@/components/ui";
import { GoogleButton } from "./google-button";
import { TeamLoginForm } from "./team-login-form";

export default async function TeamLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const t = await getTranslations("teamLogin");
  const { error, next } = await searchParams;
  // Only same-site team paths, never "//evil.com".
  const safeNext = next && next.startsWith("/team/") && !next.startsWith("//") ? next : "/team";
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      {error && <Alert>{t("notAllowed")}</Alert>}
      <TeamLoginForm />
      <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
        <span className="h-px flex-1 bg-border" />
        {t("or")}
        <span className="h-px flex-1 bg-border" />
      </div>
      <GoogleButton label={t("google")} next={safeNext} />
    </AuthShell>
  );
}
