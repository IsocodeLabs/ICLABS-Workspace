"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { signInAction } from "../actions";

export function LoginForm() {
  const t = useTranslations("login");
  const common = useTranslations("common");
  const [state, action, pending] = useActionState(signInAction, undefined);
  const [show, setShow] = useState(false);

  return (
    <form action={action} noValidate>
      {state?.error && (
        <Alert tone={state.error === "temp_expired" ? "warning" : "danger"} support>
          {t(`errors.${state.error}` as "errors.invalid", { minutes: state.retryMinutes ?? 15 })}
        </Alert>
      )}
      <Field label={t("email")} id="email" type="email" autoComplete="username" required />
      <Field
        label={t("password")}
        id="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
      />
      <label className="-mt-2 mb-4 flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {t("showPassword")}
      </label>
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
