"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarClock,
  ClipboardCheck,
  FileQuestion,
  History,
  Home,
  KeyRound,
  KanbanSquare,
  Layers,
  Mail,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { TeamRole } from "@iclabs/core";

type Item = { href: string; label: string; icon: LucideIcon; roles?: TeamRole[] };

const ITEMS: Item[] = [
  { href: "/team", label: "Home", icon: Home },
  {
    href: "/team/roles",
    label: "Roles & processes",
    icon: Layers,
    roles: ["admin", "hiring_manager"],
  },
  {
    href: "/team/candidates",
    label: "Candidates",
    icon: UserPlus,
    roles: ["admin", "hiring_manager"],
  },
  {
    href: "/team/pipeline",
    label: "Pipeline",
    icon: KanbanSquare,
    roles: ["admin", "hiring_manager"],
  },
  {
    href: "/team/reviews",
    label: "My reviews",
    icon: ClipboardCheck,
    roles: ["admin", "hiring_manager", "reviewer"],
  },
  { href: "/team/interviews", label: "Interviews", icon: CalendarClock },
  {
    href: "/team/questions",
    label: "Question bank",
    icon: FileQuestion,
    roles: ["admin", "hiring_manager"],
  },
  { href: "/team/settings/team", label: "Team", icon: Users, roles: ["admin"] },
  { href: "/team/settings/emails", label: "Email templates", icon: Mail, roles: ["admin"] },
  { href: "/team/settings/claude", label: "Claude access", icon: Bot, roles: ["admin"] },
  { href: "/team/audit", label: "Audit log", icon: History, roles: ["admin"] },
  { href: "/team/account", label: "Your account", icon: KeyRound },
];

export function TeamNav({ role }: { role: TeamRole }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Team" className="w-60 shrink-0 border-r border-border bg-surface px-3 py-4">
      <ul className="space-y-1">
        {ITEMS.filter((i) => !i.roles || i.roles.includes(role)).map(
          ({ href, label, icon: Icon }) => {
            const active = href === "/team" ? pathname === href : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium transition ${
                    active
                      ? "bg-brand-soft text-brand-soft-fg"
                      : "text-muted hover:bg-neutral-bg hover:text-text"
                  }`}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden />
                  {label}
                </Link>
              </li>
            );
          },
        )}
      </ul>
    </nav>
  );
}
