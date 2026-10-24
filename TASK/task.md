# Tasks

Do these in order. Each task has the goal, where to look in the repo, and how to know it is done.
Repo: pnpm monorepo. App is `apps/web` (Next.js), shared code in `packages/core` and `packages/db`.
Items marked **(verify)** are my reading of the code or request and should be checked first.

---

## 1. Connect to IC Labs Workspace via MCP

**Goal:** Claude Code can read and draft against the live workspace through its MCP server.

- The MCP server is part of this app: `apps/web/src/app/mcp/route.ts`, tools in `apps/web/src/server/mcp/tools.ts`, OAuth in `apps/web/src/server/mcp/oauth.ts`, consent page at `/team/oauth/authorize`.
- Add it (adjust the URL if the host differs):
  ```bash
  claude mcp add --transport http isocode https://workspace.isocodelabs.com/mcp
  ```
  Then run `/mcp` in Claude Code and sign in with an allow-listed team Google account.
- Available tools: `list_roles_cycles_tracks`, `get_workflow`, `get_pipeline`, `get_funnel_metrics`, `get_stage_stats`, `list_submissions`, `get_submission`, `compare_candidates`, `simulate_rules`, `propose_workflow_change`, `clone_cycle`, `draft_review`, `prepare_bulk_decision`, `prepare_interview_invites`, and others.
- **Rule:** reads are free. Writes are drafts only. Anything that affects a candidate returns a review link that an admin must confirm in the browser.

**Done when:** `list_roles_cycles_tracks` returns the roles, cycles and tracks.

---

## 2. Business Development Intern: hard deadline on the 27th EOD

**Goal:** the current task in the Business Development Intern track closes for good at the end of the 27th. Submissions after the 26th EOD are still accepted but marked late.

- Roles/cycles/tracks: `list_roles_cycles_tracks`, then `get_workflow` for the Business Development Intern track.
- Deadline model (`packages/core/src/workflow/schema.ts`): a stage node has `deadline` (`mode: "absolute"` with `at`, or relative `daysAfterUnlock`) and `graceHours` (0 to 72).
- Runtime logic in `apps/web/src/server/stages/candidate.ts`:
  - the closing time is `extendedUntil ?? graceUntil ?? dueAt`
  - after `dueAt` a submission is flagged `isLate` with `lateByMinutes`
  - after the closing time it is rejected with "The deadline has passed."
- Plan:
  - set the stage `deadline` to absolute `2026-10-26T23:59:00+05:30` (26th EOD, IST) **(verify the month and year, and that "EOD" means 23:59 IST)**
  - set `graceHours` to `24` so the hard close is the 27th EOD
  - submissions between those two times are accepted and marked late
- "For everyone, make the deadline of the task equal" **(verify, the request was cut off)**: probably means every candidate already in this stage gets the same deadline, not one relative to when they started. Candidate deadlines live in `stage_progress` (`due_at`, `extended_until`, schema in `packages/db/src/schema/stages.ts`). Existing rows may need updating, not just the workflow.
- Use `propose_workflow_change` to draft the workflow edit, then an admin confirms at `/team/builder/<workflowId>`.
- Remove any lingering per-candidate extension that would make deadlines unequal.

**Done when:** a test submission before the 26th EOD is on time, one between the 26th and 27th EOD is accepted and late, one after the 27th EOD is rejected, and every candidate in the stage shows the same dates.

---

## 3. Automatic email after Step 2 in SDE and PM

**Goal:** when a candidate submits Step 2 in the SDE and PM tracks, they automatically get an email. The draft already exists.

- Find the existing draft first: team Messages (`apps/web/src/app/team/(app)/candidates/message/`) and the templates in `apps/web/src/server/email/templates.ts`. Reuse it, do not write a new one.
- What happens on submit: `afterSubmit` in `apps/web/src/server/stages/candidate.ts` already sends `submission_received`. Sending is queued through `apps/web/src/server/email/outbox.ts`.
- Plan:
  - identify which node is Step 2 in the SDE and PM workflows (`get_workflow`)
  - attach the draft as that stage's post-submit email, via the workflow config or a template key. Check the node config in `packages/core/src/workflow/schema.ts` for an email or automation option first.
  - keep it active until we update the task **(verify)**: the automation stays on and is not removed until we decide otherwise
- Do not send to existing candidates retroactively unless asked **(verify)**.

**Done when:** a test candidate in each of SDE and PM gets the email within a minute of submitting Step 2, once only, and it shows in the outbox.

---

## 4. Set up Calendar for interviews

**Goal:** scheduling an interview creates a Google Calendar event with a Meet link and checks the panel's free/busy.

- Code: `apps/web/src/server/calendar/index.ts` (client interface, free/busy, create/update/cancel) and `ics.ts`. UI at `apps/web/src/app/team/(app)/interviews/`. Design notes: `docs/TDD.md`, section "Interviews".
- Env (`apps/web/src/server/env.ts`): `CALENDAR_DRIVER` (default `fake`, set to `google`), `CALENDAR_ORGANIZER` (default `hiring@isocodelabs.com`), `CALENDAR_SA_EMAIL`, `CALENDAR_SA_KEY`.
- Steps:
  - create a service account in the GCP project and enable the Google Calendar API
  - grant it domain-wide delegation for the calendar scope in Google Workspace admin
  - the service account acts as the organizer mailbox (`hiring@isocodelabs.com`) and organises every event
  - store the key in Secret Manager and expose it to the Cloud Run service (the migrate job in `cloudbuild.yaml` already shows how secrets are wired)
  - set `CALENDAR_DRIVER=google` on the service
- The code sends the invite as our own email with an `.ics`; Google itself sends nothing.

**Done when:** scheduling an interview from `/team/interviews` creates an event with a Meet link, busy panelists are flagged, rescheduling patches the same event, and cancelling removes it.

---

## 5. Fix the GitHub CI that fails on every push

**Goal:** the `CI` workflow is green on `main` and on pull requests.

- Workflow: `.github/workflows/ci.yml`. Steps in order: `pnpm install --frozen-lockfile`, migrations match schema (`pnpm db:generate` then `git diff --exit-code packages/db/drizzle`), `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm audit --prod --audit-level high`.
- Find the real failure first, do not guess:
  ```bash
  gh run list --workflow CI --limit 5
  gh run view <run-id> --log-failed
  ```
- Then reproduce locally by running the same steps in the same order. Likely suspects **(verify)**:
  - the generated migration or snapshot in `packages/db/drizzle` differs from the schema
  - `pnpm format:check` (run `pnpm format`)
  - lockfile out of sync with `package.json`, or the pnpm/node version differs from `packageManager` and `.nvmrc`
  - `pnpm audit` flags a high severity dependency
- Fix the cause. Do not remove steps or add `|| true`.

**Done when:** a push to `main` shows all CI steps passing.

---

## 6. Fix CV and PDF upload problems reported to hr@isocodelabs.com

**Goal:** stop candidates failing on CV and PDF upload.

- Read the mail first. Search all mail to `hr@isocodelabs.com` (Gmail connector, `search_threads`) and list the distinct problems with counts. Do not assume the causes below.
- **Remove the CV upload option from the SDE and PM role tracks.** We already collected the CV in the payload.
  - the CV upload is a file field on a form stage in each workflow: use `get_workflow` for both, then `propose_workflow_change`
  - an admin confirms at `/team/builder/<workflowId>`
  - make sure nothing else requires the CV (validation, required fields, review screens, the `submission_received` email)
  - check the candidate-facing form code (`apps/web/src/app/(candidate)/roles/[applicationId]/stages/[nodeId]/form-stage.tsx`)
- **Fix the PDF upload for tasks.** Upload flow: `file-upload.tsx` asks for a signed URL (`requestUploadAction`), sends the bytes straight to storage, then confirms (`confirmUploadAction`).
  - server: `apps/web/src/server/storage/files.ts` and `index.ts`
  - Things to check against the mails **(verify)**:
    - `checkUpload` requires the declared MIME type to match the extension. Phones and some browsers send an empty type or `application/octet-stream`, or `application/x-pdf`, so valid PDFs get "This file type isn't allowed".
    - the 25 MB limit (`MAX_UPLOAD_BYTES`)
    - the bucket needs CORS for `PUT` from `https://workspace.isocodelabs.com`, including the `Content-Type` and `x-goog-content-length-range` headers
    - the signed URL expires after 10 minutes (slow connections)
    - `confirmUpload` fails if the stored size differs from the declared size
    - files stay `scanStatus = pending` if the ClamAV scan never reports back, and `ownCleanFiles` only accepts `clean` files, so the submission fails
    - the candidate sees a vague error ("Upload failed. Check your connection...") that hides the real cause
  - Fix what the mails actually show. Make error messages specific and add tests next to the existing ones (`apps/web/src/server/*.test.ts`).
- Reply to affected candidates only if asked **(verify)**.

**Done when:** an SDE and a PM candidate can submit without a CV step, a PDF from a phone and a desktop uploads and submits, and a failed upload shows a clear reason.
