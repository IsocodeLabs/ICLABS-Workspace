import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { RequestForm } from "./request-form";

export default async function TeamSetPasswordPage() {
  const t = await getTranslations("teamPassword");
  return (
    <AuthShell title={t("requestTitle")} subtitle={t("requestSubtitle")}>
      <RequestForm />
    </AuthShell>
  );
}
