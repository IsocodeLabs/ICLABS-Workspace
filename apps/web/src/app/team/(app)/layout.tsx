import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/top-bar";
import { TeamNav } from "@/components/team-nav";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { unreadCount } from "@/server/portal";

export default async function TeamLayout({ children }: { children: ReactNode }) {
  const { actor, session } = await requireTeam();
  const t = await getTranslations("team");
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        subtitle={t(`roles.${actor.role}`)}
        notificationsHref="/team/notifications"
        unread={await unreadCount(db(), session.user.id)}
      />
      <div className="flex flex-1">
        <TeamNav role={actor.role} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
