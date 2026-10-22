"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { teamSignInAction } from "./actions";

export function TeamLoginForm() {
  const t = useTranslations("teamLogin");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(teamSignInAction, undefined);
  return (
    <form action={action} noValidate>
      {state?.error && (
        <Alert>
          {t(`errors.${state.error}` as "errors.invalid", { minutes: state.retryMinutes ?? 15 })}
        </Alert>
      )}
      <Field
        label={t("email")}
        id="email"
        type="email"
        autoComplete="username"
        placeholder="you@isocodelabs.com"
        required
      />
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
      <Link
        href="/team/set-password"
        className="mt-4 inline-block text-sm font-semibold text-brand-600 hover:underline"
      >
        {t("setPassword")}
      </Link>
    </form>
  );
}
