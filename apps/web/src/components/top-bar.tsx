import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Bell } from "lucide-react";
import { signOutAction } from "@/app/(auth)/actions";

export async function TopBar({
  subtitle,
  links = [],
  notificationsHref,
  unread = 0,
}: {
  subtitle?: string;
  links?: { href: string; label: string }[];
  notificationsHref?: string;
  unread?: number;
}) {
  const t = await getTranslations("common");
  return (
    <header className="border-b border-border bg-surface">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="h-6 w-6 shrink-0 rounded-lg"
            style={{ background: "var(--accent-gradient)" }}
            aria-hidden
          />
          <span className="font-display font-bold">{t("appName")}</span>
          {subtitle && <span className="truncate text-sm text-muted">{subtitle}</span>}
          {links.length > 0 && (
            <nav className="ml-4 flex gap-1" aria-label="Main">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-neutral-bg hover:text-text"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-1">
          {notificationsHref && (
            <Link
              href={notificationsHref}
              className="relative rounded-lg p-2 text-muted hover:bg-neutral-bg hover:text-text"
              aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
            >
              <Bell size={18} aria-hidden />
              {unread > 0 && (
                <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-danger-fg px-1 text-[0.65rem] font-bold text-white">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          )}
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm font-semibold text-muted hover:bg-neutral-bg"
            >
              {t("signOut")}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
