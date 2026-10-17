import { getTranslations } from "next-intl/server";
import { Alert, AuthShell } from "@/components/ui";
import { GoogleButton } from "./google-button";

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
      <GoogleButton label={t("google")} next={safeNext} />
    </AuthShell>
  );
}
