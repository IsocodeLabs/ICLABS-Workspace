# Tasks (batch 2)

Do these in order. Each task has the goal, where to look in the repo, and how to know it is done.
Repo: pnpm monorepo. App is `apps/web` (Next.js), shared code in `packages/core` and `packages/db`.
Items marked **(verify)** are my reading of the code or request and should be checked first.

---

## 1. "Login expired" button on the login page (unchanged)

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
- **Must ship before task 2's emails are sent.** Both emails tell candidates to use this option on workspace.isocodelabs.com.

**Done when:** an expired candidate clicks the button, enters their email, gets an email with a new temporary password, can sign in and is asked to change it. A made-up email gets the same message and no email. Repeated clicks get rate limited.

---

## 2. Final deadline extension to 31 Oct EOD, plus two emails

**Goal:** everyone still in the pipeline gets the last deadline moved to **31 October 2026, EOD (23:59 IST)**, on the workspace and by email. Two groups, two emails.

### 2a. Extend the deadlines (do this before any email)

- Roles: Business Growth Intern (BGI), Software Engineering Intern (SDE), Product Management Intern (PM). Cycle "October 2026". Use the published track of each. Ignore "(unused duplicate)" roles. **(verify the role ids with `list_roles_cycles_tracks`)**
- Who: every candidate **still in the pipeline** in these three roles: status not `closed_rejected` / `closed_withdrawn`, and not test accounts (`testMode`).
- What to extend, per role **(verify with the team)**:
  - **BGI:** the open step each person is on, up to and including the task, to 31 Oct 23:59 IST. People who already submitted the task are not extended.
  - **SDE and PM:** the details steps ("Your details" and the second form) to 31 Oct 23:59 IST. The task step is not opened yet (see 2c).
- The deadline lives per candidate in `stage_progress` (`dueAt`, `graceUntil`, `extendedUntil`; `packages/db/src/schema/stages.ts`). Closing time is `extendedUntil ?? graceUntil ?? dueAt` (`apps/web/src/server/stages/candidate.ts`).
- Existing function: `extendDeadline(db, actorUserId, progressId, until)` in `apps/web/src/server/stages/progression.ts`. It sets `extendedUntil`, reopens a missed step and audits. `until` = `2026-10-31T23:59:00+05:30`.
- Do not change anyone's earlier `extendedUntil` to something earlier than 31 Oct. Candidates marked "missed" are reopened (same as the 26 Oct reopen).
- The MCP is read and draft only. Use an admin script or a small admin action that calls `extendDeadline` for the list, or the pipeline board. Show the list (name, email, step, old deadline, new deadline) and get a yes before writing.

### 2b. Email 1: Business Growth Intern

- Audience: all BGI candidates in the pipeline (all steps, including those who already submitted the task). Each email names the person's current step.
- Template key: new, e.g. `final_extension_bgi`. Add it in `apps/web/src/server/email/templates.ts` and register it in `ANNOUNCEMENTS` in `apps/web/src/server/candidates/announce.ts`. The review-then-send page at `/team/candidates/message` already previews the email and the full list and refuses to send if the count changed.
- Content (candidate-facing, plain and short):
  - Because of the many queries we received, we are extending the deadline to **31 October, EOD (IST)**. This is the final extension.
  - If you have not submitted yet, complete your current step and the task by then.
  - Shortlisted candidates from those who have submitted their task will have an **interview scheduled next week**.
  - Your temporary password expired? You can now generate a fresh one with the new option on the login page at workspace.isocodelabs.com.
  - Any doubt or enquiry: hr@isocodelabs.com.
- Because the audience mixes "submitted" and "not submitted", the "waiting_on" / "submitted" groups in `announce.ts` do not fit as they are. Add a third group, "everyone in the pipeline" (open applications only), or add a line that reads correctly for both. **(verify)**

### 2c. Email 2: SDE and PM

- Audience: all SDE and PM candidates in the pipeline.
- Template key: new, e.g. `final_extension_details`. Same registration as above.
- Content:
  - Because of the many queries we received, we are extending the deadline for the details forms to **31 October, EOD (IST)**. This is the final extension.
  - The task will be shared on **Monday of the coming week (2 November)**, only to candidates who completed the previous two detail forms by the deadline. Further information about the task and its deadline will come alongside the task.
  - Your temporary password expired? You can now generate a fresh one with the new option on the login page at workspace.isocodelabs.com.
  - Any doubt or enquiry: hr@isocodelabs.com.
- Do not promise the task to people who have not filled the forms; the wording is "only for those who completed both forms".

### 2d. Sending rules

- Send only after 2a is done and task 1 is live, so nobody is told a deadline the system does not have or pointed to a button that does not exist.
- One email per person per template (the outbox already dedupes by template and application). Test accounts and closed applications are excluded.
- Show the admin the exact email text and the full recipient list with counts per role, get a yes, then send. This reaches real candidates and cannot be recalled.
- Emails go through the outbox and Amazon SES (about 50 per minute), from the hiring address. Both carry the hr@isocodelabs.com line.
- Add tests next to `announce.test.ts`: audience per role, closed and test accounts excluded, dedupe on a second run.

**Done when:** every in-pipeline candidate in the three roles has 31 Oct 23:59 IST as the closing time of their open step, each got exactly one email for their role with the same date, no closed or test accounts were touched, and the lists shown before sending matched the numbers sent.
