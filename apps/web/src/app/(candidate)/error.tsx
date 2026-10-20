"use client";

import { useTranslations } from "next-intl";
import { SupportHint } from "@/components/ui";

/** Anything unexpected on a candidate page lands here instead of a blank error. */
export default function CandidateError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations("common");
  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div role="alert" className="rounded-card border border-border bg-surface p-8 shadow-card">
        <h2 className="font-display text-xl font-bold">{t("errorTitle")}</h2>
        <p className="mt-2 text-muted">{t("errorBody")}</p>
        <SupportHint className="mt-2 text-muted" />
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-xl bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-600"
        >
          {t("retry")}
        </button>
      </div>
    </main>
  );
}
