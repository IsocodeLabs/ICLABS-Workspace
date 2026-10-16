"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { signInAction } from "../actions";

export function LoginForm() {
  const t = useTranslations("login");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(signInAction, undefined);

  return (
    <form action={action} noValidate>
      {state?.error && (
        <Alert tone={state.error === "temp_expired" ? "warning" : "danger"}>
          {t(`errors.${state.error}` as "errors.invalid", { minutes: state.retryMinutes ?? 15 })}
        </Alert>
      )}
      <Field label={t("email")} id="email" type="email" autoComplete="username" required />
      <Field
        label={t("password")}
        id="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? common("loading") : t("submit")}
      </Button>
      <div className="mt-5 flex flex-col gap-2 text-sm">
        <Link href="/forgot-password" className="font-semibold text-brand-600 hover:underline">
          {t("forgot")}
        </Link>
        <Link href="/team/login" className="text-muted hover:underline">
          {t("teamLink")}
        </Link>
      </div>
    </form>
  );
}
