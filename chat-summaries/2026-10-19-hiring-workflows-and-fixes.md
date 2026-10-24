# Conversation summary — hiring workflows and live fixes

**Dates:** 19–20 Oct 2026 · **Repo:** ICLABS-Workspace · **Live site:** workspace.isocodelabs.com
**Cloud project:** My First Project (`project-0fbee011-38fa-4913-a64`), Cloud Run service `iclabs-workspace` (asia-south1)

## Hiring workflows (drafts saved through the Isocode connector)

All three roles now run: **form(s) → task → reviewer's yes → interview → Final decision → Completed (selected) / Not progressing (admin confirms)**. No score cut-offs.

| Role | Steps | Status |
|---|---|---|
| Business Growth Intern | Your details (no resume) → In your own words (9 questions, word limits, no pasting) → "Most performing and deliverable industry research" (₹5–10 lakh, task-first brief, POCs are an optional bonus) → Interview → Final decision | v3 published; **v4 draft (new brief) not published** |
| Product Management Intern | CV-style profile form → PRD + design mockup (problem statements placeholder) → Interview → Final decision | Draft, not published; needs interviewers + reviewers + problem statements |
| Software Engineering Intern | CV-style profile form → TDD + build (product briefs placeholder) → Interview → Final decision | Draft, not published; needs interviewers + reviewers + briefs |

- Candidates stay on the version they were invited under; test with a fresh invite after publishing.
- Duplicate SDE role (5 seats, /sde) can be deleted from Roles now.

## Code shipped to main (all deployed)

- Problem-statement pool on tasks: each candidate sees a stable random N (e.g. 5 of 15) and picks one.
- Builder: trash bin (drag stage to delete, hide unused endings, Undo); edit/delete roles; "Edit process" pencil per round.
- Forms: word limits + "block pasting" per field.
- Task briefs render as Markdown for candidates and reviewers.
- Emails: only invite, task-submission receipt, interview emails, account security.
- Delete candidate: shows the reason; works without file storage.
- Uploads: CSP now allows `storage.googleapis.com`.
- Login: first-login password page no longer asks for the temporary password again.
- Forms: answers kept in the browser; failed autosave shows "Not saved"; failed Submit no longer freezes (handles 409s after a deploy).

## Infra done

- Created private bucket `project-0fbee011-38fa-4913-a64-workspace-uploads-prod` (Mumbai), CORS for the site, app SA given objectAdmin + token creator, IAM Credentials API on, `STORAGE_DRIVER=gcs` + `GCS_BUCKET` set on Cloud Run. Uploads confirmed working.

## Candidate issues (from Gmail, 20 Oct)

1. **Vismaya** — "incorrect temporary password" → fixed (first-login change). Resend invite if expired.
2. **Aditya Suryawanshi** — answers lost after Submit froze (version skew during deploy) → fixed. DB shows only Q1 (full) and Q2 (partial) saved; Q3–9 lost. Consider extending his deadline.
3. **Sneha** — PM applicant with no update → PM process not published yet.

## Still open

- Publish BG v4; finish and publish PM and SDE.
- Google Calendar not configured on the server (`CALENDAR_DRIVER` missing) → interview booking/reminders will fail.
- GitHub CI fails on every push (likely lint/format).
- Pre-existing failing test: `interviews.test.ts` reminder test.
- Close the Secret Manager tab in Chrome.
