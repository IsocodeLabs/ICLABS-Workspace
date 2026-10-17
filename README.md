# ICLABS Workspace

Isocode Labs' hiring and assessment workspace, served at **workspace.isocodelabs.com**.

Shortlisted candidates (Business Development Intern, SDE Intern, PM Intern) log in, complete role-specific workflows (forms, timed assessments, take-home tasks), and get reviewed and scored. Shortlisted candidates are then scheduled for interviews. The admin team designs each selection process with a drag-and-drop Process Builder.

## Docs

- [Product Requirements (PRD)](docs/PRD.md): what we're building and why
- [Technical Design (TDD)](docs/TDD.md): architecture, data model, security, testing, milestones
- [Amazon SES setup](docs/amazon-ses-setup.md): step-by-step email setup

## Stack

Next.js 16 · TypeScript · Better Auth · Drizzle + Postgres (Cloud SQL) · Tailwind CSS 4 · Cloud Run · Amazon SES · Claude via Vertex AI. Hosted on Google Cloud (`asia-south1`).

| Path              | What                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `apps/web`        | The Next.js app: candidate portal, team app, API routes                 |
| `packages/core`   | Pure domain logic (policy `can()`, password rules, lockout, rate limit) |
| `packages/db`     | Drizzle schema, migrations, in-process Postgres for tests               |
| `packages/ui`     | Design tokens (placeholder until the Isocode brand kit)                 |
| `infra/terraform` | Google Cloud resources (not applied yet)                                |

## Local development

Needs Node 24 and Docker. pnpm runs through corepack (`corepack pnpm …`).

```bash
corepack pnpm install
docker compose up -d                       # Postgres, MailPit, fake Cloud Storage
cp .env.example apps/web/.env.local        # then fill in the values
corepack pnpm db:migrate
SEED_ADMIN_EMAIL=you@isocodelabs.com corepack pnpm db:seed   # prints test candidates' temp passwords
corepack pnpm dev                          # http://localhost:3000
```

No Docker? `npx pglite-server --port=5544` gives an in-memory Postgres: point `DATABASE_URL` at `postgres://postgres:postgres@127.0.0.1:5544/postgres` and set `DATABASE_POOL_MAX=1` (it runs a single session).

Checks: `corepack pnpm -r run typecheck`, `corepack pnpm -r run test`, `corepack pnpm format:check`.

## Status

- **M0 Foundations:** done, except staging deploy (needs the staging GCP project).
- **M1 Login & access:** done. Candidate email + temporary password with forced change, lockout, rate limits, team Google sign-in, role-scoped access.
- **M2 Roles, rounds & Process Builder:** done. Drag-and-drop builder with autosave, versioned publish, templates.
- **M3 Invites, email & portal:** done. CSV/single invites, Amazon SES outbox with encrypted one-time secrets, consent, candidate portal.
- **M4 Assessments & tasks:** done. Forms, timed quizzes with integrity signals, task submissions and uploads, deadlines and reminders.
- **M5 Review & selection:** done. Reviewer assignment, split-view rubric scoring, borderline second reviewer, Claude score suggestions (Vertex AI), decisions, pipeline with bulk actions and "run rules now".
- **M6 Interviews & launch:** built. Interview scheduling with Google Calendar + Meet, hiring dashboard, audit log, 12-month retention purge and deletion requests, the admin MCP server, launch Terraform.

### Before launch

- Apply Terraform (`infra/terraform`, not yet run; `terraform validate` too) and add secret values in Secret Manager.
- Calendar: a Workspace super-admin authorises the `workspace-calendar` service account's client ID for `https://www.googleapis.com/auth/calendar` (domain-wide delegation), and `hiring@isocodelabs.com` exists as the organiser mailbox.
- Deploy the ClamAV scanner and set `scan_mode = "clamav"`; add the load balancer and Cloud Armor rules (R-SEC).
- Staging project, restore test of backups, and the OWASP review / light pen test.

## Claude access (admin MCP server)

Admins can connect Claude to `https://workspace.isocodelabs.com/mcp` (claude.ai custom connector, Claude Desktop, or `claude mcp add --transport http isocode https://workspace.isocodelabs.com/mcp`). Sign-in is Google SSO through the workspace's own OAuth 2.1 server (dynamic registration, PKCE). Only admins can connect. Claude can read and draft; anything that affects a candidate comes back as a link to confirm in the workspace. Every call is in the audit log, and **Settings → Claude access** lists connected clients, revokes them, and has a workspace-wide off switch.
