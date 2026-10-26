# Tasks (batch 2)

Do these in order. Each task has the goal, where to look in the repo, and how to know it is done.
Repo: pnpm monorepo. App is `apps/web` (Next.js), shared code in `packages/core` and `packages/db`.
Items marked **(verify)** are my reading of the code or request and should be checked first.

---

## 1. "Login expired" button on the login page

**Goal:** a candidate whose temporary password has expired sees a button on the login page, "Login expired? Get fresh credentials here". Clicking it gives them a fresh login with a new temporary password.

- Login page: `apps/web/src/app/(auth)/login/page.tsx` and `login-form.tsx`. Server action: `signInAction` in `apps/web/src/app/(auth)/actions.ts`.
- Auth logic: `apps/web/src/server/auth/candidate-auth.ts`.
  - `issueTempPassword(db, userId)` already sets a new temporary password: 72-hour expiry, forced change on first login, lock cleared, all sessions ended. It is what "Resend invite" uses.
  - `signInCandidate` returns `reason: "temp_expired"` when the password is right but expired. That is the state the button is for.
  - rate limiting: `hitRateLimit` in the same file.
- Plan:
  - add the button to the login form, shown always or only after a `temp_expired` result **(verify which the team wants)**
  - the button asks for the candidate's email, then a new server action looks up the account and calls `issueTempPassword`
  - **send the new password by email only** (existing email outbox, `apps/web/src/server/email/`). Never show it on screen and never return it to the browser.
  - always reply with the same neutral message ("If this email has an account, we've sent fresh credentials") so nobody can find out which emails are registered
  - rate limit per email and per IP with `hitRateLimit`
  - only reissue for candidate accounts that have never changed their password (`mustChangePassword` is still true). If they already set their own password, point them to "Forgot password" instead. **(verify)**
  - never reissue for team accounts
  - write an audit entry, as `issueTempPassword` already does
  - add a template next to the existing ones in `templates.ts` and a test next to `candidate-auth.test.ts`
- **Why the email-only rule matters:** a public button that returns a password to anyone who types an email would let anybody take over any unactivated account.

**Done when:** an expired candidate clicks the button, enters their email, gets an email with a new temporary password, can sign in and is asked to change it. A made-up email gets the same message and no email. Repeated clicks get rate limited.

---

## 2. Extend the Business Growth Intern deadline to the 28th EOD and email the candidates

**Goal:** every candidate in Business Growth Intern who has not submitted their task yet gets the deadline moved to the 28th EOD, on the workspace and by email.

- Connect through the MCP (see `TASK/task.md`, task 1). Role: **Business Growth Intern (Sales)**, id `01M57NPKTMRJ2G8605QAFW92SS`, cycle "October 2026", published track `01M57NPKVW5W7HKGEM1J7N8M7P`. Ignore the "(unused duplicate)" role. **(verify this is the "Business Development Intern" role you mean)**
- Step 1, find who qualifies: `get_workflow` to find the task stage, then `get_pipeline` and `list_submissions` to list candidates at that task stage who have **no submission**. Do not include anyone who already submitted (a late submission counts as submitted).
- Step 2, extend on the workspace:
  - the deadline lives per candidate in `stage_progress` (`dueAt`, `graceUntil`, `extendedUntil`; see `packages/db/src/schema/stages.ts`)
  - the closing time is `extendedUntil ?? graceUntil ?? dueAt` (`apps/web/src/server/stages/candidate.ts`)
  - the existing function is `extendDeadline(db, actorUserId, progressId, until)` in `apps/web/src/server/stages/progression.ts`. It sets `extendedUntil`, reopens a missed stage and writes an audit entry. The pipeline board uses it through `extendDeadlineAction`.
  - set `until` to the 28th EOD: `2026-10-28T23:59:00+05:30` **(verify the month and that EOD means 23:59 IST)**
  - candidates already marked "missed" are reopened by `extendDeadline`. Decide whether they count as "not submitted". **(verify, I think yes)**
  - the MCP tools I have seen are read and draft only, and I did not see one that extends a deadline. Either use the board in the browser, or add a small MCP tool or script that calls `extendDeadline` for a list of candidates. If a tool is added, it must follow the MCP rule: it prepares the action and an admin confirms it.
- Step 3, email them:
  - every candidate who got the extension gets one email: new deadline 28th EOD (IST), a link to their task, and nothing else
  - use the existing outbox and templates (`apps/web/src/server/email/`) and the candidates message flow (`apps/web/src/app/team/(app)/candidates/message/`). Reuse a template if one fits, otherwise add one.
  - send each email once. Do not email anyone who submitted.
  - send the emails only after the deadlines are extended, so nobody is told a deadline the system does not have
- Show the admin the full list of candidates (name, email, current deadline, new deadline) and get a yes before sending. This affects real candidates.

**Done when:** every not-yet-submitted candidate shows the 28th EOD as their deadline in the workspace, each got exactly one email with the same date, and candidates who already submitted were not touched or emailed.
