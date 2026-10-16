import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { TopBar } from "@/components/top-bar";
import { db } from "@/server/db";
import { requireCandidate } from "@/server/auth/session";
import { unreadCount } from "@/server/portal";

export default async function CandidateLayout({ children }: { children: ReactNode }) {
  const { session } = await requireCandidate();
  const t = await getTranslations("nav");
  return (
    <div className="min-h-dvh">
      <TopBar
        subtitle={session.user.email}
        links={[
          { href: "/dashboard", label: t("dashboard") },
          { href: "/profile", label: t("profile") },
        ]}
        notificationsHref="/notifications"
        unread={await unreadCount(db(), session.user.id)}
      />
      {children}
    </div>
  );
}
