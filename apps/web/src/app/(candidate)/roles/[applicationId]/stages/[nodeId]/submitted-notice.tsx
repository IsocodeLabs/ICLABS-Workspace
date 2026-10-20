import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

export type NextStep = { href: string; title: string } | null;

/**
 * Shown once a step is submitted. While the candidate still has a step open, it sends them
 * there; only when nothing is left for them to do does it tell them to watch their inbox.
 */
export function SubmittedNotice({
  date,
  late,
  next,
}: {
  date: string;
  late: boolean;
  next: NextStep;
}) {
  const t = useTranslations("stage");
  return (
    <div
      role="status"
      className="rounded-card border border-border bg-success-bg p-6 text-success-fg"
    >
      <p className="font-semibold">{t("submitted", { date })}</p>
      {late && <p className="mt-1 text-sm">{t("submittedLate")}</p>}
      <p className="mt-2">
        {next ? t("submittedNext", { step: next.title }) : t("submittedAllDone")}
      </p>
      {next && (
        <Link
          href={next.href}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-600"
        >
          {t("nextStepCta", { step: next.title })} <ArrowRight size={18} aria-hidden />
        </Link>
      )}
    </div>
  );
}
