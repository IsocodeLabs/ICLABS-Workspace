# Technical Design Document — Isocode Workspace

**Product:** workspace.isocodelabs.com · **Companion to:** `docs/PRD.md` (v0.7) · **Email setup:** `docs/amazon-ses-setup.md`
**Status:** Draft v1.0 · **Date:** 2026-10-16 · **Builders:** Claude (implementation) + Isocode team (review, testing, deploy approval)

---

## 0. Decision log (from the Q&A, 2026-10-16)

| Area | Decision | Effect on design |
|---|---|---|
| Who builds | Claude builds, team reviews PRs | Small PRs (≤ ~400 lines). Each has tests + a demo note. A CODEOWNERS reviewer is required. |
| Timeline | No fixed date | Build the full P0 in milestone order (§17). Open Cycle 1 when M6 passes UAT. |
| Brand | **Existing Isocode brand** | Design tokens come from the brand kit (§12.2). §6C violet palette is the placeholder only. |
| Repo | **github.com/IsocodeLabs/ICLABS-Workspace** (was empty, initialised with these docs) | Layout in §3 used as-is. |
| Shortlisting | Outside the workspace, then **CSV invite** | P0 = single + CSV invite. The careers-site sync/Applicant inbox stays P1. |
| Candidate visibility | **Status only** | No scores or reviewer notes ever reach the candidate API. |
| Candidate channels | **Email (SES) + in-portal notifications** | No WhatsApp/SMS in v1. |
| Multi-role | **Unlimited** roles per candidate | One account → N applications, each independent. |
| Temp password | **72 hours** validity | Supersedes the PRD's 7 days. |
| Devices | **Desktop only** | Candidate portal blocks phones/narrow screens with a friendly notice (§9.1). |
| Language | English only, via an i18n layer | All strings in message catalogs from day one. |
| Profile | **Rich profile** | Name, phone, college, grad year, LinkedIn, GitHub, portfolio, skills, availability window, preferred start date, resume. |
| SDE testing | Quiz + GitHub take-home | No in-browser code runner in v1. |
| Integrity | Tab-switch + paste logging, **full-screen required**, **paste blocked** | Assessment client hardening (§8.3). |
| AI review | **Yes, suggestions only** | Claude via Vertex AI drafts rubric scores. A human accepts/edits. |
| Reviewers | 1 per submission, **auto-2nd for borderline** | Borderline band configurable per stage (§8.5). |
| Blind review | **Identity visible by default** | Blind is an opt-in per stage. |
| Team | < 10 people, Google SSO only | No external reviewer accounts. |
| Interviews | **Admin assigns times only**, with auto Google Calendar + Meet | No candidate self-booking. Configurable number of interview rounds. |
| Retention | 12 months after cycle close | Daily purge job. |
| Environments | **Staging + Production** (separate GCP projects) | Staging uses the SES simulator + seed data. |
| Testing | Test-first on core logic + integration + Playwright E2E | §15. |
| Uploads | 25 MB + links | Bigger work goes via GitHub/Drive/Loom/Figma links. |
| Analytics | Built-in hiring dashboard | No third-party analytics in v1. |
| Late work | **Grace period, flagged late** | Per-stage grace window (default 2h). Late submissions are tagged. |
| Auto-reject | **Allowed per rule, admin opt-in** | Default off. The rule shows a red "Auto-reject" badge, and enabling it needs a confirm dialog. |
| Publishing | **Admins only** publish workflows | HMs edit drafts. |
| Team alerts | **In-app notifications only** | No email digest, Slack or Chat. |

---

## 1. System overview

```
                         ┌──────────────────────────── Google Cloud (asia-south1) ───────────────────────────┐
 Candidate (desktop) ──▶ │  External HTTPS LB + Cloud Armor (WAF, rate limits)                                │
 Team (Google SSO)   ──▶ │        │                                                                           │
 Claude (Admin MCP)  ──▶ │        ▼                                                                           │
                         │  Cloud Run: workspace-web (Next.js 15, Node 22)                                    │
                         │   ├─ /(candidate)  portal          ├─ /api/tasks/*  (Cloud Tasks targets, OIDC)    │
                         │   ├─ /(team)       admin app       ├─ /api/cron/*   (Cloud Scheduler, OIDC)        │
                         │   ├─ /api/*        route handlers  ├─ /api/webhooks/ses (SNS, signature-verified) │
                         │   └─ /mcp          Admin MCP server (Streamable HTTP, OAuth 2.1)                   │
                         │        │            │               │                 │                            │
                         │  Cloud SQL Postgres 16   Cloud Storage (uploads-quarantine → uploads-clean)        │
                         │  (private IP)            Cloud Run: clamav-scanner (Eventarc on object finalize)   │
                         │  Cloud Tasks queues: email · ai-review · rules · calendar                          │
                         │  Cloud Scheduler: reminders · auto-submit sweep · expiry · retention purge         │
                         │  Secret Manager · Cloud Logging/Error Reporting · Artifact Registry                │
                         │  Vertex AI: Claude (AI review suggestions, MCP-4 later)                            │
                         └───────────────────────────────────────────────────────────────────────────────────┘
        External: Amazon SES (ap-south-1) ◀─ send  │  SNS ─▶ /api/webhooks/ses     Google Workspace: Calendar API + Meet, OAuth
```

**One deployable app** (`workspace-web`) plus one small helper (`clamav-scanner`). Background work runs as HTTP handlers invoked by Cloud Tasks and Cloud Scheduler, so there are no long-running workers to operate.

---

## 2. Environments

| | Staging | Production |
|---|---|---|
| GCP project | **TBD**: a second project for staging (e.g. `iclabs-workspace-stg`) | **`project-0fbee011-38fa-4913-a64`** (project number 724401189538, billing enabled) |
| URL | `workspace-stg.isocodelabs.com` (Google-SSO-gated for everyone, incl. candidate routes) | `workspace.isocodelabs.com` |
| DB | Cloud SQL smallest shared-core tier | Cloud SQL small dedicated tier, automated backups + PITR (7 days), daily export to a second-region bucket |
| Email | SES identity `mail.isocodelabs.com`, but **all recipients rewritten to the SES mailbox simulator** unless on an allow-list (team addresses) | Real sending |
| Calendar | A dedicated test calendar | Interviewers' real calendars |
| AI | Vertex AI, low quota | Vertex AI |
| Data | Seed script + synthetic candidates | Real |
| Deploy | Auto on merge to `main` | Manual approval on a release tag |

**Local dev:** `docker compose up` brings up Postgres 16, `fake-gcs-server`, MailPit (SMTP catcher in place of SES), and the app with `pnpm dev`. `pnpm db:seed` creates 3 roles, sample workflows and 30 synthetic candidates.

---

## 3. Repository layout

*(Adapted to the existing repo once its URL and contents are shared. If it already holds other apps, this becomes `apps/workspace` + `packages/*` inside it.)*

```
/
├─ apps/
│  └─ web/                     Next.js App Router app (candidate portal, team app, API, MCP route)
│     ├─ app/(candidate)/…     portal routes
│     ├─ app/(team)/…          admin routes (builder, pipeline, review, settings)
│     ├─ app/api/…             route handlers (tasks, cron, webhooks, uploads)
│     ├─ app/mcp/route.ts      MCP server endpoint
│     └─ messages/en.json      i18n catalog (next-intl)
├─ packages/
│  ├─ core/        PURE domain logic, no I/O: workflow schema, rule engine, scoring, stage plugins, policies  ← test-first
│  ├─ db/          Drizzle schema, migrations, repositories
│  ├─ auth/        Better Auth config, password/temp-password logic, session helpers, policy guards
│  ├─ email/       React Email templates + send service (SES via Nodemailer) + restricted-variable guard
│  ├─ integrations/ calendar (Google), ai (Vertex Claude), storage (GCS signed URLs), sns verifier
│  ├─ mcp/         MCP tool definitions (thin wrappers over core + db services)
│  └─ ui/          design tokens, shadcn components, builder canvas components
├─ infra/          Terraform (GCP projects, Cloud Run, SQL, buckets, queues, scheduler, LB, Armor, secrets, IAM)
├─ e2e/            Playwright tests
└─ .github/workflows/  ci.yml, deploy-staging.yml, deploy-prod.yml
```

Tooling: **pnpm** workspaces + **Turborepo**, TypeScript strict, ESLint + Prettier, Vitest, Playwright, Drizzle Kit.

---

## 4. Data model (Postgres, Drizzle)

All IDs are **ULIDs** (non-guessable, sortable). Every table has `created_at`/`updated_at`. Soft delete is `deleted_at` where noted. `org_id` is present on top-level tables (future multi-tenant).

### 4.1 Identity & team
| Table | Key columns |
|---|---|
| `users` | id, email (unique, citext), name, kind (`team` \| `candidate`), status (`active` \| `locked` \| `disabled`), must_change_password bool, temp_password_expires_at, password_changed_at, failed_login_count, locked_until |
| `accounts` | Better Auth: provider (`google` \| `credential`), password_hash (Argon2id), … |
| `sessions` | Better Auth sessions (token hash, user_id, expires_at, ip, ua) |
| `team_members` | user_id, role (`admin` \| `hiring_manager` \| `reviewer` \| `interviewer`), active |
| `role_assignments` | team_member_id, scope (`role` \| `track`), scope_id, permission (`manage` \| `review` \| `interview`) |
| `mcp_clients` | id, admin_user_id, client_name, scopes, last_used_at, revoked_at |

### 4.2 Hiring structure & configuration
| Table | Key columns |
|---|---|
| `roles` | id, title, slug, description, seats, stipend, duration, location, status |
| `cycles` | id, role_id, name, opens_at, closes_at, status (`draft` \| `open` \| `closed` \| `archived`), retention_purge_at |
| `workflows` (tracks) | id, cycle_id, name, is_default, published_version_id, branding JSONB |
| `workflow_versions` | id, workflow_id, version int, status (`draft` \| `published` \| `superseded`), **config JSONB** (§5), created_by, published_by, published_at, change_summary |
| `templates` | id, kind (`workflow` \| `stage` \| `rubric` \| `email` \| `form`), name, config JSONB |
| `questions` | id, type, body (rich JSON), options JSONB, answer_key JSONB (encrypted at app layer), tags[], difficulty, status (`draft` \| `approved` \| `archived`), source (`human` \| `claude`), approved_by |
| `custom_field_defs` | id, key, label, type, options JSONB, scope (`candidate` \| `application`) |
| `statuses`, `tags`, `reasons` | org- or workflow-scoped lookup lists |

### 4.3 Candidates & progress
| Table | Key columns |
|---|---|
| `candidates` | id, user_id, name, phone, college, grad_year, linkedin, github, portfolio, skills[], available_from, available_to, preferred_start, resume_file_id, custom JSONB, email_status (`ok` \| `bounced` \| `complained`) |
| `applications` | id, candidate_id, workflow_id, **workflow_version_id (pinned)**, current_node_id, status (`active` \| `needs_decision` \| `on_hold` \| `closed_rejected` \| `closed_withdrawn` \| `interview_scheduled` \| `completed`), composite_score numeric, invited_by, invited_at, test_mode bool |
| `stage_progress` | id, application_id, node_id, state (`locked` \| `unlocked` \| `in_progress` \| `submitted` \| `reviewed` \| `passed` \| `failed` \| `skipped`), unlocked_at, due_at, grace_until, extended_due_at |
| `assessment_sessions` | id, stage_progress_id, started_at, ends_at (server-authoritative), question_ids[] (randomized), submitted_at, auto_submitted bool |
| `submissions` | id, stage_progress_id, version int, data JSONB (answers/links/write-up), file_ids[], submitted_at, is_late bool, late_by interval |
| `files` | id, owner_candidate_id, bucket, object_key, mime, size, sha256, scan_status (`pending` \| `clean` \| `infected` \| `error`) |
| `integrity_events` | id, assessment_session_id, type (`blur` \| `focus` \| `fullscreen_exit` \| `paste_attempt` \| `copy_attempt` \| `visibility_hidden`), at, duration_ms, meta JSONB |
| `reviews` | id, submission_id, reviewer_id (nullable for AI), kind (`human` \| `ai_suggestion`), scores JSONB, total numeric, recommendation, notes, status (`assigned` \| `submitted` \| `accepted_from_ai`), submitted_at |
| `review_assignments` | id, submission_id, reviewer_id, reason (`primary` \| `borderline_second` \| `manual`), due_at |
| `decisions` | id, application_id, node_id, action (`advance` \| `reject` \| `hold` \| `route` \| `tag`), by_user_id (nullable), by_rule_id (nullable), reason_id, note, at |
| `interviews` | id, application_id, node_id, round_name, starts_at, ends_at, interviewer_ids[], calendar_event_id, meet_url, status (`scheduled` \| `rescheduled` \| `cancelled` \| `completed` \| `no_show`), final_outcome (P1) |

### 4.4 Communication, audit, analytics
| Table | Key columns |
|---|---|
| `email_messages` | id, application_id?, user_id, template_key, to_email, ses_message_id, status (`queued` \| `sent` \| `delivered` \| `bounced` \| `complained` \| `rejected` \| `failed`), sent_at, events JSONB. **No body is stored.** |
| `notifications` | id, user_id, kind, title, body, link, read_at (candidates and team) |
| `audit_log` | id, actor_user_id, actor_via (`ui` \| `mcp` \| `rule` \| `system`), action, entity, entity_id, before JSONB, after JSONB, ip, at. Append-only (DB role has INSERT only). |
| `events` | id, type, application_id?, node_id?, payload JSONB, at. Feeds the dashboard. |

**Indexes (initial):**
- `applications(workflow_id, status)`
- `applications(candidate_id)`
- `stage_progress(application_id, node_id)` unique
- `stage_progress(state, due_at)` for reminder/sweep jobs
- `submissions(stage_progress_id, version)` unique
- `reviews(submission_id)`
- `review_assignments(reviewer_id) where status='assigned'`
- `email_messages(ses_message_id)`
- `events(type, at)`
- GIN on `candidates.custom` for filtering

---

## 5. Workflow config schema (the heart of "everything is configurable")

Stored in `workflow_versions.config` and validated by Zod in `packages/core`. The **canvas, rule engine and MCP tools all read and write this one structure.**

```ts
type WorkflowConfig = {
  schemaVersion: 1;
  nodes: Node[];                    // canvas nodes = stages
  edges: Edge[];                    // connections; carry routing rules
  scoring: { weights: Record<NodeId, number> };  // composite weights, sum = 100
  layout: Record<NodeId, { x: number; y: number }>;  // canvas positions (UI only)
};

type Node = {
  id: NodeId;                       // stable ULID, never reused
  type: 'form' | 'assessment' | 'task' | 'review_gate' | 'custom' | 'interview';
  title: string;
  description?: RichText;
  visibility: 'candidate' | 'internal';
  deadline?: { mode: 'absolute'; at: string } | { mode: 'relative'; daysAfterUnlock: number; atTime?: string };
  graceHours?: number;              // late window (default 2); late submissions flagged
  reviewers?: { pool: TeamMemberId[]; perSubmission: 1 | 2; method: 'round_robin' | 'load' | 'manual';
                borderline?: { cutoff: number; band: number } ; blind: boolean };   // blind default false
  rubricId?: string;
  emails?: Partial<Record<'unlock' | 'reminder' | 'submitted' | 'advance' | 'reject', TemplateRef>>;
  config: FormConfig | AssessmentConfig | TaskConfig | ReviewGateConfig | CustomConfig | InterviewConfig;  // per type
};

type Edge = {
  id: string; from: NodeId; to: NodeId | 'END_REJECT' | 'NEEDS_DECISION' | 'END_COMPLETE';
  priority: number;                 // evaluated in ascending order; first match wins
  when: Condition | { always: true };
  autoReject?: boolean;             // only meaningful when to === 'END_REJECT'; admin opt-in
};

type Condition =
  | { all: Condition[] } | { any: Condition[] }
  | { metric: 'auto_score_pct' | 'rubric_total' | 'composite'; op: '>=' | '<=' | '>' | '<' | '=='; value: number }
  | { criterion: string; op: Op; value: number }
  | { answer: { fieldId: string; op: 'eq' | 'contains' | 'in'; value: unknown } }
  | { rank: { by: 'rubric_total' | 'composite'; top: number } | { by: '...'; topPct: number } }
  | { consensus: 'all_yes' | 'majority_yes' | 'any_strong_no' }
  | { flag: 'late' | 'integrity_high' };

type AssessmentConfig = { durationMin: number; window?: { opens: string; closes: string };
  questions: { fixed?: QuestionId[]; draw?: { tags: string[]; difficulty?: string; count: number }[] };
  shuffleQuestions: boolean; shuffleOptions: boolean; requireFullscreen: true; blockPaste: true; passMark?: number };
type TaskConfig = { brief: RichText; attachments: FileId[]; deliverables: { kind: 'file' | 'link' | 'text'; label: string; required: boolean; linkDomains?: string[] }[];
  allowResubmit: boolean; maxFileMb: 25 };
type InterviewConfig = { roundName: string; durationMin: 30 | 45 | 60; interviewerPool: TeamMemberId[];
  mode: 'meet' | 'phone' | 'in_person'; address?: string; instructions?: RichText };
```

**Validation** (`validateWorkflow(config) → Issue[]`, severity `error` \| `warning`). It runs live in the builder and blocks Publish on errors:
- exactly one entry node,
- no orphans or unreachable nodes,
- no cycles,
- every decision node has a fallback edge (`always`) or routes to `NEEDS_DECISION`,
- weights sum to 100,
- required config is present (rubric for reviewable nodes, deadline for candidate nodes, interviewer pool for interview nodes),
- auto-reject edges are listed for confirmation.

---

## 6. Core engines (`packages/core`, pure and test-first)

### 6.1 Progression engine
`advance(application, versionConfig, event) → Command[]`
- **Events:**
  - `INVITED`, `SUBMITTED`, `REVIEW_COMPLETED`, `DEADLINE_PASSED`, `GRACE_EXPIRED`,
  - `MANUAL_DECISION`, `INTERVIEW_SCHEDULED`, `INTERVIEW_COMPLETED`.
- **Commands** (executed by the app layer inside one DB transaction, and idempotent):
  - `UNLOCK_NODE`, `SET_STATUS`, `ENQUEUE_EMAIL`, `ASSIGN_REVIEWERS`, `ENQUEUE_AI_REVIEW`,
  - `RECORD_DECISION`, `NOTIFY_TEAM`, `NOTIFY_CANDIDATE`.
- The engine only reads the **pinned** version. Migrating in-flight applications to a new version is an explicit admin command, `MIGRATE_APPLICATIONS(fromVersion, toVersion, nodeMapping)`.

### 6.2 Rule engine
`evaluateEdges(nodeId, ctx) → { target, matchedEdgeId } | { target: 'NEEDS_DECISION' }`
- `ctx` = auto-score, rubric totals per criterion, composite, answers, consensus, flags. **Rank conditions** need a cohort snapshot, so they are evaluated only in batch mode, triggered by "Run rule now" or when the stage's deadline closes. They are never evaluated per submission.
- `simulate(rules, cohort) → { applicationId, from, to }[]` powers the builder's dry-run and the MCP `simulate_rules` tool.
- An auto-reject edge without `autoReject: true` resolves to `NEEDS_DECISION`.

### 6.3 Scoring
- Auto-score: MCQ = all-or-nothing, multi-select = partial credit (configurable). Result as % of max.
- Rubric total = Σ(criterion score / scale max × weight). Must-pass criteria short-circuit to "fail".
- Human aggregate = mean of submitted human reviews. AI suggestions are **excluded** until accepted (accepted becomes a human review with `accepted_from_ai`).
- Composite = Σ(stage score × workflow weight) over scored stages. It's recomputed on every review or decision and stored on `applications.composite_score`.
- Divergence flag when reviewers differ by > 1.5 on any criterion (5-point scale, scaled for other scales).

### 6.4 Borderline second reviewer
- If the first human total is within `cutoff ± band` (e.g. 60 ± 8), the system assigns a second reviewer from the pool (excluding the first). The decision waits for both.

### 6.5 Policy layer (authorization)
`can(actor, action, resource) → boolean` is the single entry point, used by every route handler, server action and MCP tool.
- **Candidate:** may read or write only resources where `application.candidate_id = actor.candidateId`, the application is not closed (read-only if closed), and the node is unlocked. **Never** scores, reviews, notes, internal nodes or other candidates.
- **Team:** Admin has everything. HM gets `manage` on assigned roles/tracks (no publish). Reviewer sees only assigned submissions plus their candidate context. Interviewer sees only candidates with interviews assigned to them.
- **MCP:** Admin only, plus a tier check (read / draft / prepared action).

---

## 7. Authentication

**Library: Better Auth** (Drizzle adapter). It handles both Google OAuth (team) and email/password (candidates) with one session model, has built-in rate limiting, and an OIDC/OAuth provider plugin usable for MCP OAuth 2.1. *This replaces the PRD's Auth.js mention, which handles credentials less cleanly.*

### 7.1 Team
- Google provider with `hd=isocodelabs.com`, plus a server-side check that the email domain matches and a `team_members` row exists and is active.
- No credential login for team users.

### 7.2 Candidates
1. **Invite** → generate the temp password: 14 characters, unambiguous alphabet, CSPRNG. Hash it with **Argon2id** (m=19 MiB, t=2, p=1). Set `must_change_password = true` and `temp_password_expires_at = now + 72h`.
2. The welcome email renders `{{temp_password}}` from an **in-memory value passed to the send task only**.
   - The Cloud Tasks payload carries an encrypted, single-use blob (AES-GCM with a key from Secret Manager), which is deleted after send.
   - It's never stored in the DB or logs.
3. **Login:**
   - Rate limits: 5/min per IP+email, 30/min per IP.
   - Lockout: 15 min after 10 failures.
   - reCAPTCHA Enterprise after 3 failures.
   - Generic error message.
4. **Middleware gate:** if `must_change_password`, every route except `/auth/change-password` and `/auth/logout` redirects there (APIs return 403 `PASSWORD_CHANGE_REQUIRED`).
5. **Change password:**
   - min 10 characters,
   - not equal to the temp password,
   - HIBP k-anonymity check (fail-open with a log if the API is down),
   - re-hash, clear the flag, revoke other sessions,
   - send the "password changed" email with a "This wasn't me" link (signed token → lock account + notify admins).
6. **Expired temp password** → login shows the "expired" state with a self-serve "Email me a new one". The candidate gets a fresh temp password at most 3 times per 24h. Admins can always resend.
7. **Forgot password** → reset link (30 min, single-use, hashed token).
8. **Sessions:** httpOnly, Secure, SameSite=Lax cookies. 7-day idle and 30-day absolute expiry. All sessions are revoked when every application of the candidate is closed + 30 days.

### 7.3 Desktop-only gate
- Server: a UA hint (`Sec-CH-UA-Mobile: ?1` or a mobile UA) on candidate routes renders a "Please switch to a laptop or desktop" page with a "Email me the link" button.
- Client: viewport < 1024px shows the same notice. Login itself is allowed on mobile so candidates can read their status, but assessment and task pages are blocked.

---

## 8. Candidate-facing features

### 8.1 Invites (CSV)
- CSV columns: `name,email,phone,role_slug,track (optional),college,grad_year,linkedin,github,resume_url,…custom_*`.
- **Flow:**
  1. Upload.
  2. Server parses and validates with Zod row schemas.
  3. Preview shows new / existing (+role) / duplicate / invalid rows.
  4. Admin confirms.
  5. The import job creates users, candidates and applications in one transaction per row.
  6. Invite emails are enqueued (throttled, optionally scheduled).
- `resume_url` is fetched once server-side (allow-listed hosts, 10 MB cap) into storage and scanned.

### 8.2 Portal
- **Dashboard:** one card per active or closed application, showing role, current step, due date, and a neutral status label.
- **Role space:** branding from `workflows.branding` (existing Isocode brand), what-to-expect timeline, FAQ.
- **Notifications:** a `notifications` table, read on page load plus a 60-second poll (no websockets needed at this scale).

### 8.3 Timed assessments
- **Start:**
  1. Instructions + consent ("full-screen required, paste disabled, activity logged").
  2. Enter full-screen (Fullscreen API).
  3. Server creates an `assessment_session` with `ends_at` and the randomized `question_ids`.
- **Delivery:** questions are fetched **one page at a time**, only for an active session. Answer keys never leave the server.
- **Autosave:** each answer is PATCHed (debounced 800 ms) to `submissions.data` (draft version). The server rejects writes after `ends_at + 5s`.
- **Timer:** the client counts down from the server's `ends_at`. The Cloud Scheduler sweep (every minute) auto-submits expired sessions.
- **Integrity:**
  - `visibilitychange`, `blur`/`focus`, `fullscreenchange` and `paste`/`copy`/`contextmenu` are captured. Paste is `preventDefault`-ed in answer fields.
  - Events are batched to `/api/integrity` every 10 seconds and at submit.
  - Leaving full-screen shows a blocking overlay ("Return to full-screen to continue"). The timer keeps running.
- Signals only. Reviewers see a summary, e.g. "Left full-screen 3× (total 1m40s), 5 paste attempts".

### 8.4 Task submissions & uploads
- **Upload flow:**
  1. Client requests `POST /api/uploads` → server checks policy, size ≤ 25 MB and declared type, then returns a **V4 signed PUT URL** to `uploads-quarantine/{candidateId}/{ulid}`.
  2. On object finalize, Eventarc triggers `clamav-scanner`. It scans the file, verifies the magic-byte type, then moves it to `uploads-clean` or marks it `infected`.
  3. The submission can only be finalized when all its files are `clean`.
- **Downloads** use short-lived (5 min) signed GET URLs with `Content-Disposition: attachment`, except for PDFs and images, which preview inline in a sandboxed viewer.
- **Deadline and grace:** submit is allowed until `extended_due_at ?? due_at + grace`. After `due_at` the submission is marked `is_late` with `late_by`. After the grace window, submit is closed.
- **Versions:** each submit creates a new `submissions.version`, and the latest is reviewed.

### 8.5 Review & AI suggestions
- **Assignment** on `SUBMITTED`: round-robin or least-load from the node's pool. Borderline triggers a 2nd assignment (§6.4).
- **Review UI:** split view with the submission on the left and the rubric on the right. Keyboard shortcuts: `1–5` score, `J/K` next/previous, `⌘↵` submit.
- **AI suggestion:**
  1. `ENQUEUE_AI_REVIEW` → the `ai-review` Cloud Tasks queue.
  2. The handler builds a prompt from the rubric, task brief and submission text. File text is extracted server-side (PDF/DOCX/MD); GitHub links are summarized from the README plus the file tree via the public API.
  3. It calls **Claude via Vertex AI** with structured JSON output: per criterion score, evidence quotes, and missing deliverables.
  4. The result is stored as `reviews.kind='ai_suggestion'`.
- The reviewer sees "Claude suggests 4 — evidence…" with **Accept** / **Edit**. Suggestions are never used in scores until accepted.
- Privacy: disclosed in the privacy notice. Only submission content and rubric are sent (no phone or email). Vertex AI in a GCP region with data governance terms.

### 8.6 Interviews (admin-assigned)
- **Shortlist view:** select candidates → "Schedule interviews". For each candidate:
  1. Admin picks the interviewer(s), date and time.
  2. The UI shows the interviewers' **free/busy** for the chosen day, from the Google Calendar `freeBusy` API, as a day timeline.
- **Create event:** the Calendar API `events.insert` runs on the primary interviewer's calendar, with `conferenceData.createRequest` (Meet), the candidate and other interviewers as attendees, and `sendUpdates='all'`. This uses a **service account with domain-wide delegation**, scoped to `calendar.events` + `calendar.freebusy`, impersonating the interviewer.
- The workspace also sends its own confirmation email with an `.ics` file (METHOD:REQUEST, same UID as the event).
- **Reminders:** 24h and 1h before, by email + in-portal notification.
- **Reschedule/cancel** (admin only) patches the same event, so attendees get updates. Candidates see a "Need to reschedule? Reply to this email" note.
- **Multiple rounds:** each `interview` node is a round. Completing one (admin marks Done) can route to the next per its edges.
- **Final outcome** (P1): a one-click outcome after the selection call.

---

## 9. Team-facing features

### 9.1 Process Builder (canvas)
- **React Flow** (@xyflow/react) for the canvas, **dnd-kit** for the palette, **ELK.js** for auto-layout, and **Zustand** for editor state with a **zundo** undo/redo history (50 steps).
- Each node type is a **plugin** in `packages/core/stages/<type>` that exports:
  - a config Zod schema,
  - default config,
  - a summary function (card text),
  - a validation function,
  - a candidate renderer,
  - a reviewer renderer,
  - a scoring function.
- The inspector is generated from the 6 standard tabs. The type-specific Content tab comes from the plugin.
- **Autosave:** debounced PATCH of the draft `workflow_versions.config` with optimistic concurrency via a `version_etag`. On a conflict, a toast offers "Reload / Overwrite".
- **Publish:**
  1. Validate.
  2. Show the diff vs. the published version.
  3. Choose new applicants only or migrate (§6.1).
  4. Admin only.
  5. Write to the audit log.
- Visual spec: PRD §6C, re-skinned with Isocode brand tokens.

### 9.2 Pipeline
- Kanban (columns = nodes + terminal states) and table (TanStack Table, server-side filtering/sorting/pagination). Bulk actions are confirmed in a dialog.
- The `test_mode` filter is on by default for staging and off for prod.

### 9.3 Dashboard (built-in analytics)
- SQL views over `events`, `applications`, `stage_progress`, `reviews` and `interviews`:
  - funnel per role/track,
  - stage completion %,
  - median time-in-stage,
  - review turnaround,
  - seats vs. interviews scheduled,
  - late-submission rate,
  - integrity-flag rate.
- Charts are built with Recharts.

### 9.4 Team notifications (in-app only)
- New assignment, borderline second review, submission awaiting decision, interview tomorrow, email bounce.
- Shown as a bell with unread count, plus "My queue" counters in the sidebar.

---

## 10. Admin MCP server

- **Endpoint:** `POST/GET /mcp` (Streamable HTTP) using `@modelcontextprotocol/sdk`, hosted inside `workspace-web`.
- **Auth:** OAuth 2.1 authorization code + PKCE through the Better Auth OIDC/MCP provider plugin.
  - Discovery: `/.well-known/oauth-authorization-server` + protected-resource metadata. Dynamic client registration is allowed.
  - A token is issued only if the user is an active **Admin**. Access tokens last 1h, refresh tokens 7 days, and both can be revoked in Settings.
- **Tools:** as listed in PRD §6B MCP-3. Each tool:
  1. validates input (Zod),
  2. calls `can()`,
  3. calls a domain service (the same services the UI uses),
  4. writes `audit_log` with `actor_via='mcp'`.
- **Write tiers:** draft writes set `status='draft'` / `source='claude'`. Candidate-affecting tools return a `/confirm/<batchId>` URL and execute only after confirmation in the UI.
- The kill switch (setting) makes `/mcp` return 403.

---

## 11. Background jobs

| Mechanism | Name | Trigger | Does |
|---|---|---|---|
| Cloud Tasks | `email` | Enqueued by commands | Render the template → SES send (throttled to ≤ 5/s; raised after the SES quota is known). Retries with backoff ×5. |
| Cloud Tasks | `ai-review` | On submission | Vertex Claude call. Concurrency 3. Retries ×3. |
| Cloud Tasks | `rules` | Deadline close / "Run now" | Batch rule evaluation incl. rank conditions |
| Cloud Tasks | `calendar` | Interview create/update | Google Calendar API calls with retry |
| Scheduler | `sweep-assessments` | Every 1 min | Auto-submit expired assessment sessions |
| Scheduler | `deadlines` | Every 5 min | Fire `DEADLINE_PASSED` / `GRACE_EXPIRED` |
| Scheduler | `reminders` | Hourly | 24h-before reminders (stages and interviews). 1h interview reminders run every 15 min. |
| Scheduler | `temp-password-expiry` | Hourly | Mark expired invites. Notify admins of candidates who never logged in. |
| Scheduler | `retention-purge` | Daily 02:00 IST | Delete files and anonymize candidates past `retention_purge_at` (12 months after cycle close). The purge is logged. |

All task and cron endpoints require a **Google-signed OIDC token** from the dedicated invoker service account. They're idempotent (dedupe key per task).

---

## 12. Frontend

### 12.1 Stack
- Next.js 15 App Router with React Server Components and server actions for mutations.
- next-intl for i18n (English only).
- Tailwind CSS v4 + shadcn/ui (Radix).
- Rich text: Tiptap. Forms: React Hook Form + Zod. Tables: TanStack Table. Motion: Framer Motion.
- Icons: one set only, chosen to match the Isocode brand (Lucide by default).

### 12.2 Design tokens from the Isocode brand
- `packages/ui/tokens.css` defines CSS variables, with a light theme and a dark theme (team app):
  - `--brand-50…900`,
  - `--neutral-50…950` (tinted toward the brand hue),
  - semantic `--success`, `--warning`, `--danger`, `--info` (soft pill pairs),
  - node-type categorical colors.
- **Inputs needed:** brand hex(es), fonts, logo SVG and favicon. Until they arrive, the §6C placeholder tokens are used. Swapping is a one-file change.
- Status colors follow the fixed semantics (green / amber / red / grey) as soft pills with text. Every token pair must pass WCAG AA in both themes, checked by an automated contrast test in CI (§15).

---

## 13. Security implementation checklist (maps to PRD R-SEC)

- **Edge:**
  - Cloud Armor OWASP CRS rules in preview → enforce after a week.
  - Per-path rate limits (`/auth/*`, `/api/uploads`, `/mcp`).
- **Headers (Next.js middleware):**
  - strict CSP with nonces,
  - HSTS (preload after go-live),
  - `X-Frame-Options: DENY`,
  - `Referrer-Policy: strict-origin-when-cross-origin`,
  - Permissions-Policy (camera/mic/geolocation off).
- **CSRF:** SameSite cookies + Origin checks on server actions (built-in) and route handlers.
- **Input and rendering:**
  - Zod on every input.
  - Candidate rich text is stored as Tiptap JSON and rendered through an allow-list renderer. No `dangerouslySetInnerHTML` without DOMPurify.
- **Secrets:**
  - Secret Manager, mounted as env vars.
  - Answer keys encrypted at the app layer (AES-GCM, key in Secret Manager).
- **IAM:**
  - Separate service accounts for web, scanner, task invoker and deployer.
  - Least privilege. No user-managed keys (Workload Identity Federation for GitHub → GCP and GCP → AWS SES).
- **Data:**
  - Cloud SQL on private IP + IAM DB auth, SSL required.
  - Buckets with uniform access, public access prevention, and CMEK optional.
- **Logging:**
  - pino structured logs with a redaction list: `password`, `temp_password`, `token`, `answer_key`, `authorization`, `cookie`.
  - The Sentry `beforeSend` scrubber applies the same list.
- **Supply chain:**
  - Renovate, `pnpm audit` in CI, Artifact Registry vulnerability scanning,
  - pinned GitHub Actions SHAs, CodeQL.
- **Pre-launch:**
  - OWASP ASVS L1 self-review,
  - a pen test of auth, uploads, access isolation and MCP OAuth,
  - a restore drill from backup.

---

## 14. Observability

- Cloud Logging (JSON logs with `requestId`, `userId` hashed, `applicationId`) and Error Reporting.
- Sentry for browser errors (DSN in env, PII scrubbing on).
- **Uptime checks:** `/api/health` (DB + storage reachability) with alerting to the admins' email.
- **Alerts:**
  - 5xx rate > 2% for 5 min,
  - email queue backlog > 200,
  - SES bounce > 2% / complaint > 0.05% (CloudWatch → email),
  - login-failure spike,
  - task-queue failures,
  - scanner errors.

---

## 15. Testing strategy (test-first on core logic)

| Layer | Tool | What | Approach |
|---|---|---|---|
| **Unit — core** | Vitest | Workflow validation, rule engine (incl. rank, consensus, auto-reject opt-in), scoring and composite, borderline assignment, progression commands, deadline/grace calculations, policy `can()` matrix, temp-password generator and expiry | **Red-green-refactor.** Each behavior starts as a failing test. Property-based tests (fast-check) for the rule engine and scoring. |
| **Integration** | Vitest + **Testcontainers** Postgres | Repositories, transactions, CSV import, idempotent task handlers, SNS webhook (signed fixtures), Calendar client (mocked HTTP), Vertex client (recorded fixtures) | Real DB, migrations run per test suite |
| **Security tests** | Vitest + Playwright | **Access isolation matrix:** candidate A ↔ B, revoked role, closed application, reviewer scope, HM cannot publish, MCP non-admin refused. Must-change-password gate. Temp-password never in logs (log capture assertion). | Mandatory in CI. A failure blocks merge. |
| **E2E** | Playwright | ① Admin builds a workflow on the canvas and publishes ② CSV invite → email (MailPit) → first login → change password → dashboard shows only invited roles ③ Timed quiz with full-screen, paste blocked, auto-submit on timeout ④ Task upload with grace/late flag ⑤ Review with AI suggestion accept ⑥ Borderline second review ⑦ Admin schedules interview (Calendar mocked) ⑧ Rule auto-reject opt-in flow | Run on PRs against an ephemeral local stack, and nightly against staging |
| **Accessibility/visual** | axe-core in Playwright, token contrast unit test | WCAG AA on candidate pages and builder, light + dark | CI |
| **Load (once, pre-launch)** | k6 | 300 concurrent quiz takers autosaving, 50 concurrent uploads | Against staging |

**Gates:** CI blocks merge unless typecheck, lint, unit, integration, security and E2E smoke tests all pass. Coverage targets: `packages/core` ≥ 90% lines; overall ≥ 70%.

---

## 16. CI/CD & infrastructure

- **GitHub Actions:**
  - `ci.yml` on PR: install, typecheck, lint, test, build, e2e-smoke.
  - `deploy-staging.yml` on merge to `main`:
    1. Build the container.
    2. Push to Artifact Registry.
    3. Run `drizzle-kit migrate` as a Cloud Run Job.
    4. Deploy Cloud Run (staging).
  - `deploy-prod.yml` on a `v*` tag: the same steps for prod, behind a **GitHub Environment approval** (an Isocode reviewer).
- Auth to GCP via **Workload Identity Federation** (no JSON keys).
- **Terraform** (`infra/`): projects/APIs, VPC + Serverless VPC connector, Cloud SQL, buckets, Eventarc, Cloud Run services and jobs, Tasks queues, Scheduler jobs, LB + certs + Cloud Armor, Secret Manager, IAM, budgets. State lives in a GCS bucket.
- **Migrations:** expand → migrate → contract for breaking changes. Never drop a column in the same release that stops using it.
- **Rollback:** Cloud Run revision rollback (instant). DB changes stay backward-compatible for one release.

---

## 17. Build milestones (each = a series of small reviewed PRs)

| # | Milestone | Contents | Exit criteria |
|---|---|---|---|
| **M0** | Foundations | Repo scaffold, Terraform (staging), CI, Docker dev stack, DB schema v1, design tokens (placeholder → brand), i18n setup | `pnpm dev` works locally. Staging deploys from `main`. |
| **M1** | Auth & access | Better Auth (Google team + candidate credentials), temp-password flow (72h), forced change, lockout, desktop gate, policy layer + isolation tests | Security test matrix green |
| **M2** | Structure & builder | Roles/Cycles/Tracks, workflow schema + validation, **canvas builder** (drag-drop, inspector, undo, validate, publish, versions), templates/clone | An admin builds and publishes the 3 role workflows on staging |
| **M3** | Invites & portal | Single + CSV invites, SES email service + templates + SNS webhook, candidate dashboard (role-scoped), rich profile, in-portal notifications | CSV → email → login → only invited roles visible |
| **M4** | Assessments & tasks | Question bank, timed assessment engine (full-screen, paste block, logging, auto-submit), forms, tasks + uploads + scanner + grace/late | E2E ②③④ green |
| **M5** | Review & selection | Review queue, rubrics, borderline 2nd reviewer, AI suggestions (Vertex), rule engine + dry-run + auto-reject opt-in, pipeline kanban/table, decisions, composite score | E2E ⑤⑥⑧ green |
| **M6** | Interviews & launch prep | Calendar free/busy + event + Meet, multi-round, reminders, dashboard, Admin MCP server, audit log UI, retention purge, prod Terraform, pen test, load test, SES production + warm-up | UAT with the team on staging. Prod go-live checklist done. |
| M7 (P1) | Fast follow | Careers-site Applicant inbox sync, final outcome, in-app Ask Claude panel, talent pool | — |

---

## 18. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Emailed temp passwords intercepted | 72h expiry, single use, forced change, change notification + "This wasn't me", never logged |
| Candidates hit by bugs on the live system | Staging + E2E nightly, `test_mode` candidates in prod for smoke checks, instant Cloud Run rollback |
| Students' emails land in spam | Custom MAIL FROM + DKIM/SPF/DMARC, warm-up, plain templates, inbox-placement tests (see SES guide) |
| Full-screen/paste controls bypassed (devtools) | Treated as **signals**, not proof. Server-side timing is authoritative. Answers are reviewed by humans. |
| AI suggestion bias or errors | Suggestions only, evidence quotes required, calibration view, audit of acceptance rates |
| Auto-reject misconfiguration | Admin opt-in per rule, red badge, confirm dialog, dry-run preview, decisions reversible by an admin within the cycle |
| Domain-wide delegation scope creep | Scope limited to `calendar.events` + `calendar.freebusy`, impersonating only listed interviewers |
| Brand kit delayed | Token layer means design can proceed on placeholders |

---

## 19. Inputs still needed from Isocode (blocking where marked)

1. ~~GitHub repo~~ **Done:** IsocodeLabs/ICLABS-Workspace.
2. **Brand kit:** logo (SVG), primary/secondary colors (hex), fonts, any existing UI references. (Blocks the final visual polish, not the build start.)
3. **GCP:** production project = `project-0fbee011-38fa-4913-a64` (billing enabled). Still needed: create a staging project or approve one, confirm who holds Owner, and consider renaming the display name from "My First Project" to "ICLABS Workspace". **(Staging blocks M0.)**
4. **DNS provider** for isocodelabs.com and who can add records (SES, `workspace`, `workspace-stg`). (Blocking M3.)
5. **Google Workspace super-admin** to approve domain-wide delegation (Calendar) and create `hiring@` / `dmarc-reports@` groups. (Blocking M6.)
6. **AWS account** owner for SES (follow `docs/amazon-ses-setup.md`). Start early because of production access and warm-up. (Blocking M3.)
7. **Careers-site CSV export:** a sample file (with fake data) showing its actual columns. (Blocking M3.)
8. **Role content:** each role's quiz topics, task brief, rubric and interview rounds. (Blocking M5 UAT, not the build.)
9. **Privacy notice text** reviewed by whoever handles legal/DPDP (template provided in M3).
