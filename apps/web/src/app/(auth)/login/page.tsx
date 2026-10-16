import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/ui";
import { getSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  const t = await getTranslations("login");
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <LoginForm />
    </AuthShell>
  );
}
