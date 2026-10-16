import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Page, PageHeader, EmptyState } from "@/components/admin";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { listNotifications, markAllRead } from "@/server/portal";

async function markRead() {
  "use server";
  const { session } = await requireTeam();
  await markAllRead(db(), session.user.id);
  revalidatePath("/team", "layout");
}

export default async function TeamNotificationsPage() {
  const { session } = await requireTeam();
  const items = await listNotifications(db(), session.user.id);
  return (
    <Page>
      <PageHeader
        title="Notifications"
        actions={
          items.some((n) => !n.readAt) ? (
            <form action={markRead}>
              <button className="text-sm font-semibold text-brand-600 hover:underline">
                Mark all as read
              </button>
            </form>
          ) : undefined
        }
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing new"
          body="Assignments, decisions waiting on you and email problems show up here."
        />
      ) : (
        <ul className="space-y-2">
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
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
