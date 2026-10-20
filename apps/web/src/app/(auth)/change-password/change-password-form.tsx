"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { changePasswordAction } from "../actions";

/** `currentLabel` null: the first-login change, where the temporary password isn't asked again. */
export function ChangePasswordForm({ currentLabel }: { currentLabel: string | null }) {
  const t = useTranslations("changePassword");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(changePasswordAction, undefined);

  return (
    <form action={action}>
      {state?.error && <Alert support>{t(`errors.${state.error}` as "errors.mismatch")}</Alert>}
      {currentLabel && (
        <Field
          label={currentLabel}
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      )}
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
        {pending ? common("loading") : t("submit")}
      </Button>
    </form>
  );
}
