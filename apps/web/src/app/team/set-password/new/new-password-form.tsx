"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { setNewPasswordAction } from "../../login/actions";

export function NewPasswordForm({ token }: { token: string | null }) {
  const t = useTranslations("teamPassword");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(setNewPasswordAction, undefined);
  if (!token || state?.error === "link") {
    return (
      <>
        <Alert>{t("errors.link")}</Alert>
        <Link href="/team/set-password" className="text-sm font-semibold text-brand-600 hover:underline">
          {t("again")}
        </Link>
      </>
    );
  }
  if (state?.done) {
    return (
      <>
        <Alert tone="success">{t("saved")}</Alert>
        <Link href="/team/login" className="text-sm font-semibold text-brand-600 hover:underline">
          {t("signIn")}
        </Link>
      </>
    );
  }
  return (
    <form action={action} noValidate>
      {state?.error && <Alert>{t(`errors.${state.error}` as "errors.mismatch")}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label={t("new")} id="newPassword" type="password" autoComplete="new-password" minLength={10} required />
      <Field
        label={t("confirm")}
        id="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("save")}
      </Button>
    </form>
  );
}
