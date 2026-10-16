import { getTranslations } from "next-intl/server";
import { Alert, AuthShell } from "@/components/ui";
import { GoogleButton } from "./google-button";

export default async function TeamLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("teamLogin");
  const { error } = await searchParams;
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      {error && <Alert>{t("notAllowed")}</Alert>}
      <GoogleButton label={t("google")} />
    </AuthShell>
  );
}
