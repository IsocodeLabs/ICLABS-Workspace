import { getTranslations } from "next-intl/server";
import { Alert, AuthShell, Button } from "@/components/ui";
import { requireCandidate } from "@/server/auth/session";
import { acceptConsentAction } from "@/app/(candidate)/actions";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireCandidate({ consentPage: true });
  const t = await getTranslations("welcome");
  const points = t.raw("points") as string[];
  const { error } = await searchParams;
  return (
    <AuthShell title={t("title")} subtitle={t("subtitle")}>
      <ul className="mb-6 list-disc space-y-2 pl-5 text-[0.95rem]">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <form action={acceptConsentAction}>
        {error && <Alert support>{t("consent")}</Alert>}
        <label className="mb-5 flex items-start gap-3 text-[0.95rem]">
          <input
            type="checkbox"
            name="consent"
            required
            className="mt-1 h-4 w-4 accent-[var(--brand-500)]"
          />
          <span>{t("consent")}</span>
        </label>
        <Button type="submit">{t("submit")}</Button>
      </form>
    </AuthShell>
  );
}
