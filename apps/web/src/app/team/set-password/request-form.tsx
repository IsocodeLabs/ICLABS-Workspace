"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { requestSetPasswordAction } from "../login/actions";

export function RequestForm() {
  const t = useTranslations("teamPassword");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(requestSetPasswordAction, undefined);
  if (state?.done) {
    return (
      <>
        <Alert tone="success">{t("sent")}</Alert>
        <Link href="/team/login" className="text-sm font-semibold text-brand-600 hover:underline">
          {t("back")}
        </Link>
      </>
    );
  }
  return (
    <form action={action} noValidate>
      {state?.error && <Alert>{t("errors.email")}</Alert>}
      <Field
        label={t("email")}
        id="email"
        type="email"
        autoComplete="username"
        placeholder="you@isocodelabs.com"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("send")}
      </Button>
      <Link href="/team/login" className="mt-4 inline-block text-sm text-muted hover:underline">
        {t("back")}
      </Link>
    </form>
  );
}
