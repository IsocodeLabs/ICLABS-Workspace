import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { NewPasswordForm } from "./new-password-form";

export default async function TeamNewPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const t = await getTranslations("teamPassword");
  const { token, error } = await searchParams;
  return (
    <AuthShell title={t("newTitle")} subtitle={t("newSubtitle")}>
      <NewPasswordForm token={!error && token ? token : null} />
    </AuthShell>
  );
}
