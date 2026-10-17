import type { TeamRole } from "@iclabs/core";

export type IconName = "Bot" | "CalendarClock" | "ClipboardCheck" | "FileQuestion" | "History" | "Home" | "KeyRound" | "KanbanSquare" | "Layers" | "Mail" | "UserPlus" | "Users";

type Item = {
  href: string;
  label: string;
  icon: IconName;
  roles?: TeamRole[];
  badge?: "reviews" | "decisions";
};

export const NAV_GROUPS: { label: string | null; items: Item[] }[] = [
  { label: null, items: [{ href: "/team", label: "Home", icon: "Home" }] },
  {
    label: "Hire",
    items: [
      { href: "/team/candidates", label: "Candidates", icon: "UserPlus", roles: ["admin", "hiring_manager"] },
      {
        href: "/team/pipeline",
        label: "Pipeline",
        icon: "KanbanSquare",
        roles: ["admin", "hiring_manager"],
        badge: "decisions",
      },
      { href: "/team/interviews", label: "Interviews", icon: "CalendarClock" },
    ],
  },
  {
    label: "Review",
    items: [
      {
        href: "/team/reviews",
        label: "My reviews",
        icon: "ClipboardCheck",
        roles: ["admin", "hiring_manager", "reviewer"],
        badge: "reviews",
      },
    ],
  },
  {
    label: "Set up",
    items: [
      { href: "/team/roles", label: "Roles & processes", icon: "Layers", roles: ["admin", "hiring_manager"] },
      { href: "/team/questions", label: "Question bank", icon: "FileQuestion", roles: ["admin", "hiring_manager"] },
      { href: "/team/settings/emails", label: "Email templates", icon: "Mail", roles: ["admin"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { href: "/team/settings/team", label: "Team", icon: "Users", roles: ["admin"] },
      { href: "/team/settings/claude", label: "Claude access", icon: "Bot", roles: ["admin"] },
      { href: "/team/audit", label: "Audit log", icon: "History", roles: ["admin"] },
    ],
  },
  { label: null, items: [{ href: "/team/account", label: "Your account", icon: "KeyRound" }] },
];

/** Flat list used by the Ctrl+K quick jump. */
export function navEntriesFor(role: TeamRole) {
  return NAV_GROUPS.flatMap((g) => g.items)
    .filter((i) => !i.roles || i.roles.includes(role))
    .map((i) => ({ href: i.href, label: i.label }));
}

