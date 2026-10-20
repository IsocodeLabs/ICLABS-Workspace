"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert, Button, Field } from "@/components/ui";
import { updateProfileAction } from "../actions";

type Values = Record<
  | "name"
  | "phone"
  | "college"
  | "gradYear"
  | "linkedin"
  | "github"
  | "portfolio"
  | "skills"
  | "availableFrom"
  | "availableTo"
  | "preferredStart",
  string
>;

export function ProfileForm({ initial }: { initial: Values }) {
  const t = useTranslations("profile");
  const [state, action, pending] = useActionState(updateProfileAction, undefined);
  const field = (id: keyof Values, type = "text") => (
    <Field label={t(id)} id={id} type={type} defaultValue={initial[id]} required={id === "name"} />
  );
  return (
    <form
      action={action}
      className="mt-8 rounded-card border border-border bg-surface p-8 shadow-card"
    >
      {state?.ok === false && <Alert support>{state.error}</Alert>}
      {state?.ok && <Alert tone="success">{t("saved")}</Alert>}
      <div className="grid gap-x-6 md:grid-cols-2">
        {field("name")}
        {field("phone", "tel")}
        {field("college")}
        {field("gradYear", "number")}
        {field("linkedin", "url")}
        {field("github", "url")}
        {field("portfolio", "url")}
        {field("skills")}
        {field("availableFrom", "date")}
        {field("availableTo", "date")}
        {field("preferredStart", "date")}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending} className="!w-auto">
          {t("save")}
        </Button>
        <Link
          href="/change-password?voluntary=1"
          className="text-sm font-semibold text-brand-600 hover:underline"
        >
          {t("password")}
        </Link>
      </div>
    </form>
  );
}
