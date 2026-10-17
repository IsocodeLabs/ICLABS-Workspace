import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/top-bar";
import { TeamNav } from "@/components/team-nav";
import { navEntriesFor } from "@/components/team-nav-data";
import { QuickJump } from "@/components/quick-jump";
import { db } from "@/server/db";
import { requireTeam } from "@/server/auth/session";
import { unreadCount } from "@/server/portal";
import { navCounts } from "@/server/team-overview";

export default async function TeamLayout({ children }: { children: ReactNode }) {
  const { actor, session } = await requireTeam();
  const t = await getTranslations("team");
  const counts = await navCounts(db(), actor);
  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        subtitle={t(`roles.${actor.role}`)}
        notificationsHref="/team/notifications"
        unread={await unreadCount(db(), session.user.id)}
        extra={<QuickJump entries={navEntriesFor(actor.role)} />}
      />
      <div className="flex flex-1">
        <TeamNav role={actor.role} counts={counts} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
