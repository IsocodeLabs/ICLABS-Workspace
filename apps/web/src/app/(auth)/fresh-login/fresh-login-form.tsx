"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { freshCredentialsAction } from "../actions";

export function FreshLoginForm() {
  const t = useTranslations("fresh");
  const login = useTranslations("login");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(freshCredentialsAction, undefined);

  return (
    <>
      {state?.sent ? (
        <Alert tone="success" support>
          {t("sent")}
        </Alert>
      ) : (
        <form action={action} noValidate>
          {state?.error && (
            <Alert support>
              {t(`errors.${state.error}`, { minutes: state.retryMinutes ?? 60 })}
            </Alert>
          )}
          <Field label={login("email")} id="email" type="email" autoComplete="username" required />
          <Button type="submit" disabled={pending}>
            {pending ? common("loading") : t("submit")}
          </Button>
        </form>
      )}
      <div className="mt-5 flex flex-col gap-2 text-sm">
        <Link href="/login" className="font-semibold text-brand-600 hover:underline">
          {t("back")}
        </Link>
        <Link href="/forgot-password" className="text-muted hover:underline">
          {t("ownPassword")}
        </Link>
      </div>
    </>
  );
}
