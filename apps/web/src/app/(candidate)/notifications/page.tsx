import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { listNotifications } from "@/server/portal";
import { markNotificationsReadAction } from "../actions";

export default async function NotificationsPage() {
  const { session } = await requireCandidate();
  const t = await getTranslations("notifications");
  const items = await listNotifications(db(), session.user.id);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t("title")}</h1>
        {items.some((n) => !n.readAt) && (
          <form action={markNotificationsReadAction}>
            <button className="on-liquid text-sm font-semibold hover:underline">
              {t("markRead")}
            </button>
          </form>
        )}
      </div>
      {items.length === 0 ? (
        <p className="on-liquid mt-8">{t("empty")}</p>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`rounded-card border bg-surface p-4 ${n.readAt ? "border-border" : "border-brand-500"}`}
            >
              {n.link ? (
                <Link href={n.link} className="font-semibold hover:underline">
                  {n.title}
                </Link>
              ) : (
                <span className="font-semibold">{n.title}</span>
              )}
              {n.body && <p className="mt-1 text-sm text-muted">{n.body}</p>}
              <time className="mt-1 block text-xs text-muted" dateTime={n.createdAt.toISOString()}>
                {n.createdAt.toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
