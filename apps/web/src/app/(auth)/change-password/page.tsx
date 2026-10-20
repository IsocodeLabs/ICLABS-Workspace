import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { requireCandidate } from "@/server/auth/session";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const { session } = await requireCandidate({ passwordChangePage: true });
  const t = await getTranslations("changePassword");
  const firstTime = session.user.mustChangePassword;
  return (
    <AuthShell
      title={firstTime ? t("title") : t("titleVoluntary")}
      subtitle={firstTime ? t("subtitle") : t("subtitleVoluntary")}
    >
      <ChangePasswordForm currentLabel={firstTime ? null : t("currentVoluntary")} />
    </AuthShell>
  );
}
