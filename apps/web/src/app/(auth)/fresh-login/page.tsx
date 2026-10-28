import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { FreshLoginForm } from "./fresh-login-form";

export default async function FreshLoginPage() {
  const t = await getTranslations("fresh");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <FreshLoginForm />
    </AuthShell>
  );
}
