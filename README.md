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
- Next: **M2 Roles, rounds & the Process Builder** (see TDD §17).
