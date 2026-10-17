"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { verifyCodeAction } from "../actions";

export function VerifyForm() {
  const t = useTranslations("teamLogin");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(verifyCodeAction, undefined);
  return (
    <form action={action} noValidate>
      {state?.error === "invalid" && (
        <Alert>
          {state.attemptsLeft
            ? t("codeErrors.invalidLeft", { left: state.attemptsLeft })
            : t("codeErrors.invalid")}
        </Alert>
      )}
      {state?.error === "expired" && <Alert>{t("codeErrors.expired")}</Alert>}
      <Field
        label={t("code")}
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        autoFocus
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("verify")}
      </Button>
      <Link href="/team/login" className="mt-4 inline-block text-sm text-muted hover:underline">
        {t("startOver")}
      </Link>
    </form>
  );
}
