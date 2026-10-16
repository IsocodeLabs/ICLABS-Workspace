import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { requireCandidate } from "@/server/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  await requireCandidate({ passwordChangePage: true });
  const t = await getTranslations("changePassword");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ChangePasswordForm />
    </AuthShell>
  );
}
