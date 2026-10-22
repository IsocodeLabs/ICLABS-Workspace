"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { changeTeamPasswordAction } from "../../login/actions";

export function ChangePasswordForm() {
  const t = useTranslations("teamPassword");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(changeTeamPasswordAction, undefined);
  return (
    <form action={action} noValidate>
      {state?.done && <Alert tone="success">{t("changed")}</Alert>}
      {state?.error && <Alert>{t(`errors.${state.error}` as "errors.mismatch")}</Alert>}
      <Field
        label={t("current")}
        id="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label={t("new")}
        id="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <Field
        label={t("confirm")}
        id="confirmPassword"
        type="password"
        autoComplete="new-password"
        minLength={10}
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("change")}
      </Button>
    </form>
  );
}
