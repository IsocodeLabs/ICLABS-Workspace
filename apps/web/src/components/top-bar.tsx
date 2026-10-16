import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/app/(auth)/actions";

export async function TopBar({ subtitle }: { subtitle?: string }) {
  const t = await getTranslations("common");
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <span
            className="h-6 w-6 rounded-lg"
            style={{ background: "var(--accent-gradient)" }}
            aria-hidden
          />
          <span className="font-display font-bold">{t("appName")}</span>
          {subtitle && <span className="text-sm text-muted">{subtitle}</span>}
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-neutral-bg"
          >
            {t("signOut")}
          </button>
        </form>
      </div>
    </header>
  );
}
