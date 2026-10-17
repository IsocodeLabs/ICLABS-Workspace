import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { VerifyForm } from "./verify-form";

export default async function TeamVerifyPage() {
  const t = await getTranslations("teamLogin");
  return (
    <AuthShell title={t("codeTitle")} subtitle={t("codeSubtitle")}>
      <VerifyForm />
    </AuthShell>
  );
}
