"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState, type FormEvent } from "react";
import { Alert, AuthShell, Button, Field } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const t = useTranslations("reset");
  const cp = useTranslations("changePassword");
  const forgot = useTranslations("forgot");
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error" | "mismatch">(
    token ? "idle" : "error",
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = String(form.get("newPassword"));
    if (newPassword !== String(form.get("confirmPassword"))) return setStatus("mismatch");
    setStatus("pending");
    const { error } = await authClient.resetPassword({ newPassword, token: token! });
    setStatus(error ? "error" : "done");
  }

  if (status === "done") {
    return (
      <>
        <Alert tone="success">{t("done")}</Alert>
        <Link href="/login" className="text-sm font-semibold text-brand-600 hover:underline">
          {forgot("back")}
        </Link>
      </>
    );
  }
  return (
    <form onSubmit={onSubmit}>
      {status === "error" && <Alert>{t("invalid")}</Alert>}
      {status === "mismatch" && <Alert>{cp("errors.mismatch")}</Alert>}
      <Field
        label={cp("new")}
        id="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <Field
        label={cp("confirm")}
        id="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <Button type="submit" disabled={status === "pending" || !token}>
        {t("submit")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("reset");
  return (
    <AuthShell title={t("title")}>
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthShell>
  );
}
