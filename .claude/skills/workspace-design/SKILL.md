---
name: workspace-design
description: >-
  The Isocode Workspace (workspace.isocodelabs.com) design system: white "liquid glass" —
  black liquid drifting on a white screen behind frosted-white glass, strictly monochrome
  except soft status pills. Use when building, restyling or reviewing ANY workspace screen,
  component, dialog, empty state, loading state or email (team area, candidate area, auth,
  builder), or when someone asks for "the workspace look". For the animated background only,
  use the workspace-liquid-background skill.
---

# Isocode Workspace design

## The look in one line

> A white screen with a few slow **black liquid** shapes drifting behind it; every surface is
> **frosted white glass** over that liquid; text is **ink**; colour appears **only** to say a
> status. Calm, fast, professional.

The user rejected a multicolour/dark version as "distracting". Do not reintroduce colour
gradients, neon, purple/cyan accents or dark mode.

## Non-negotiables

1. **Monochrome.** Ink (`--text #0a0a10`) on white. Primary actions are graphite/black
   (`--brand-500 #14141c`, hover `--brand-600 #000`). The only "accent" is
   `--accent-gradient` (graphite → black) for the small logo square and progress bars.
2. **Glass is the surface.** Cards, nav, top bar, dialogs: `bg-surface`
   (`rgb(255 255 255 / .94)`) + `backdrop-filter: blur(24px)` + `--shadow-card` + 1px
   `--border` (`rgb(0 0 0 / .1)`) + `--radius` 18px. Never put content straight on the
   liquid except page titles (rule 5).
3. **Colour only for status, always with words.** Soft pill pairs, all WCAG AA:
   success `#e3f5ea/#17613a`, warning `#fbf0d3/#7c5200`, danger `#fbe5e5/#9b1f1f`,
   neutral `rgb(0 0 0/.06)/#3c3c4a`. Use `<StatusPill tone>`; never colour alone.
   Stage-type colours (`--node-*`) are for builder node chips/top borders only.
4. **Type.** Body `Inter` 16px/1.55 (`--font-sans`); headings `Plus Jakarta Sans`
   (`font-display`, bold, `tracking-tight`). Page title `text-3xl`, section `text-xl`.
   Body copy never below 1rem; helper text `text-sm text-muted` (`#4b4b5a`).
5. **Titles that sit on the liquid invert.** `h1.font-display`, the subtitle after it, and
   `main > section > h2` use `color:#fff; mix-blend-mode:difference` so they stay readable
   when a black shape drifts under them. Keep page titles as direct `h1.font-display`.
   Any other text or icon placed straight on the liquid (back links, section labels outside a
   card, the auth logo, empty-state lines) takes the `on-liquid` class, which does the same.
   Don't make glass thinner than `.94`: at `.84` a passing shape turns whole cards grey.
6. **Never laggy.** Blur is the expensive thing: only `.bg-surface` blurs; small chips use
   flat `bg-neutral-bg`. `html.lite` (set automatically on weak machines / reduced motion)
   swaps blur for solid `rgb(255 255 255/.97)` — every new glass surface must honour it.
   Every route group has a `loading.tsx` using `<PageSkeleton>`; heavy libs load on demand
   (`import()`), and `optimizePackageImports` covers lucide-react and @xyflow/react.
7. **Destructive actions confirm** in a danger-styled dialog (`Btn variant="danger"`);
   failures surface an `<Alert>` — never a silent empty state.

## Tokens (source of truth: `packages/ui/tokens.css`)

| Role | Token | Value |
|---|---|---|
| Page | `--bg` | `#ffffff` (the liquid canvas sits on it) |
| Glass | `--surface` / `--surface-solid` | `rgb(255 255 255/.94)` / `#fff` |
| Edge | `--border` | `rgb(0 0 0/.1)` |
| Text / muted | `--text` / `--text-muted` | `#0a0a10` / `#4b4b5a` |
| Primary | `--brand-500` → `--brand-600` | `#14141c` → `#000` |
| Tint | `--brand-soft` | `rgb(0 0 0/.07)` (focus rings, selected rows) |
| Radius | `--radius` | 18px cards; controls/buttons `rounded-xl` (12px); pills `rounded-full` |
| Shadow | `--shadow-card` | `0 1px 0 rgb(255 255 255/.9) inset, 0 10px 34px rgb(0 0 0/.1)` |
| Blur | `--glass-blur` | 24px (dialogs too) |

Tailwind 4 maps these in `apps/web/src/app/globals.css` (`@theme inline`): use
`bg-surface`, `border-border`, `text-muted`, `bg-brand-500`, `rounded-card`,
`shadow-card`, `bg-success-bg text-success-fg`, etc. Never hard-code hex in components.

## Components (use these, don't restyle one-offs)

- Layout: `Page` (max-w-6xl, `px-6 py-8`; `wide` for boards), `PageHeader`
  (title, subtitle, actions on the right), `Card`, `EmptyState` (dashed glass, one action).
- Controls (`components/admin.tsx`): `Btn` variants `primary | secondary | danger | ghost |
  gradient`, sizes `sm | md`; `Input`, `TextArea`, `Select`, `Label`, `Field` — all
  `rounded-xl border-border bg-surface`, focus `border-brand-500 ring-brand-soft`.
- Auth (`components/ui.tsx`): `AuthShell` (centred glass card, gradient hairline above),
  `Field`, full-width `Button`, `Alert`, `StatusPill`.
- Chrome: `TopBar` (glass, logo square + app name + role, notifications bell with red
  count), `TeamNav` (sticky glass sidebar w-60, grouped: Home · Hire · Review · Set up ·
  Admin · Your account; active item = black pill with white text; counts as black
  badges), `QuickJump` (Ctrl+K palette). Nav data lives in `team-nav-data.ts`.
- Feedback: `PageSkeleton`, `Dialog` (`components/dialog.tsx`), `Alert`.
- Icons: lucide-react, 18px, stroke 2, `aria-hidden` when next to a label.

## Patterns

- **Home first:** "Needs your attention" cards (big black count chip + title + one-line
  detail + arrow), then "Get set up" checklist with a progress bar
  (`--accent-gradient`) and a black "Next" pill on the next step.
- **Lists/tables:** glass card, `text-sm`, header `text-muted font-semibold`, hover row
  `bg-neutral-bg`, statuses as `StatusPill`, row actions as `Btn size="sm" variant="ghost"`.
- **Empty states** say what will appear and offer the one next action.
- **Forms:** one column, label above, hint `text-sm text-muted` below, errors as `Alert`.
- **Copy:** short, plain, second person ("You're all caught up."). Sentence case. No jargon.
- **Desktop-first** (candidates are told it works on a laptop or desktop); still no
  horizontal scroll at 375px, 16px gutters.

## Emails (`apps/web/src/server/email/templates.ts`)

White card on `#f4f4f6`, 18px radius, 1px `rgba(0,0,0,.1)` edge, header image
`/email/liquid-header.png` (black liquid + "ISOCODE LABS / Workspace", rendered from the
background shader — see workspace-liquid-background), ink text 16px/1.6, a block of
`Label: value` lines becomes a soft grey details card (passwords/codes in monospace),
`[[button:…]]` becomes a black 12px-radius button with "→". Inline styles only; light
colour-scheme meta; no web fonts, no SVG, no background images.

## Before calling a screen done

- [ ] Only tokens/Tailwind theme classes; no new hex, no colour gradients.
- [ ] Every surface is glass (`bg-surface`) and still looks right with `html.lite`.
- [ ] Status shown as soft pill + text; destructive action confirms; errors visible.
- [ ] Title is `h1.font-display` via `PageHeader`; readable when liquid passes behind it.
- [ ] Has a `loading.tsx`/skeleton; no new heavy import on the initial bundle.
- [ ] Checked at 1440px and 375px; keyboard focus visible (`2px` brand outline).
