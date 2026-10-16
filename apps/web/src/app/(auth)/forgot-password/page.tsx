"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const t = useTranslations("forgot");
  const login = useTranslations("login");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const email = String(new FormData(e.currentTarget).get("email"));
    // Same message whether or not the account exists.
    await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setSent(true);
    setPending(false);
  }

  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      {sent ? (
        <Alert tone="success">{t("sent")}</Alert>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label={login("email")} id="email" type="email" autoComplete="username" required />
          <Button type="submit" disabled={pending}>
            {t("submit")}
          </Button>
        </form>
      )}
      <Link
        href="/login"
        className="mt-5 inline-block text-sm font-semibold text-brand-600 hover:underline"
      >
        {t("back")}
      </Link>
    </AuthShell>
  );
}
