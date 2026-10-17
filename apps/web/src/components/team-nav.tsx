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
} from "lucide-react";
import type { TeamRole } from "@iclabs/core";
import { NAV_GROUPS, type IconName } from "./team-nav-data";

const ICONS = { Bot, CalendarClock, ClipboardCheck, FileQuestion, History, Home, KeyRound, KanbanSquare, Layers, Mail, UserPlus, Users } satisfies Record<IconName, unknown>;

export function TeamNav({
  role,
  counts,
}: {
  role: TeamRole;
  counts: { reviews: number; decisions: number };
}) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Team"
      className="sticky top-0 hidden h-dvh w-60 shrink-0 self-start overflow-y-auto border-r border-border bg-surface px-3 py-4 md:block"
    >
      {NAV_GROUPS.map((group, gi) => {
        const items = group.items.filter((i) => !i.roles || i.roles.includes(role));
        if (items.length === 0) return null;
        return (
          <div key={gi} className={gi === 0 ? "" : group.label ? "mt-5" : "mt-5 border-t border-border pt-4"}>
            {group.label && (
              <p className="mb-1.5 px-3 text-xs font-bold uppercase tracking-wider text-muted">{group.label}</p>
            )}
            <ul className="space-y-0.5">
              {items.map(({ href, label, icon, badge }) => {
                const Icon = ICONS[icon];
                const active = href === "/team" ? pathname === href : pathname.startsWith(href);
                const n = badge ? counts[badge] : 0;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[0.95rem] font-medium transition ${
                        active ? "bg-brand-500 text-white shadow-card" : "text-text hover:bg-neutral-bg"
                      }`}
                    >
                      <Icon size={18} strokeWidth={2} aria-hidden />
                      <span className="flex-1">{label}</span>
                      {n > 0 && (
                        <span
                          className={`grid min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums ${
                            active ? "bg-white text-black" : "bg-brand-500 text-white"
                          }`}
                          aria-label={`${n} waiting`}
                        >
                          {n > 99 ? "99+" : n}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
