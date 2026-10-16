# PRD — Isocode Workspace (workspace.isocodelabs.com)

**Status:** Draft v0.7 · **Date:** 2026-10-16 · **Owner:** Isocode Labs
**Scope of this doc:** Platform-level spec. Role-specific assessment *content and screen designs* (Business Development Intern, SDE Intern, PM Intern) will be added per role in §11 once defined.
**Technical design:** `docs/TDD.md`. **Email setup:** `docs/amazon-ses-setup.md` (Amazon SES).

**v0.7 changes — Q&A decisions. These override any conflicting text below; full log in TDD §0:**
- **Email:** Amazon SES. **Team alerts:** in-app only. **Candidate channels:** email + in-portal notifications (no WhatsApp/SMS in v1).
- **Temp password valid 72 hours** (not 7 days). **The candidate portal is desktop-only.** English only. Candidates get a **rich profile**.
- **Shortlisting happens outside the workspace.** Candidates arrive by CSV/single invite, with no limit on roles per candidate. Candidates see **status only**.
- **Interviews:** **admins assign times** (no candidate self-booking), with an auto Google Calendar event + Meet link. Interview rounds are configurable per workflow.
- **Assessments:**
  - SDE uses a quiz + GitHub take-home (no in-browser coding in v1).
  - Integrity: full-screen required, paste blocked, tab/paste logging.
  - AI review suggestions are in v1, as suggestions only.
- **Review & selection:**
  - 1 reviewer per submission, with an automatic 2nd reviewer for borderline scores.
  - Reviewers see candidate identity by default; blind review is opt-in.
  - Late work gets a grace period and is flagged.
  - Auto-reject is allowed per rule, with admin opt-in.
  - Only admins publish workflows.
- **Platform:** retention is 12 months. Environments are staging + production. The upload limit is 25 MB plus links. Analytics are a built-in dashboard. Brand comes from the **existing Isocode brand kit**.

**v0.6 changes:**
- The **Process Builder is now a drag-and-drop visual canvas** with editable nodes (P0). It replaces the "ordered list" builder and the earlier non-goal against a visual canvas.
- Added §6C **Process Builder UX & Visual Design**: a vibrant-but-professional design system, the node anatomy, interactions, and accessibility.

**v0.5 changes:**
- **Changed entry point.** Only candidates whom Isocode has **shortlisted** from careers-site applications get a workspace account (R-INVITE replaces R-INTAKE).
- **Login:** the candidate's email is their login ID. They receive a **custom temporary password** by email and **must change it on first login** (R-AUTH).
- **Role-scoped access:** a candidate sees and attempts **only the roles they were shortlisted for** (R-ACCESS).
- Every assessment and form for every role happens in the workspace portal.
- Initial roles are fixed at three: **Business Development Intern (BDI), SDE Intern, PM Intern**.

**v0.4 changes:**
- Added an **admin-only Claude MCP server** (§6B). Admins can use Claude to assess submissions, write questions, and improve workflows across the whole workspace.
- Isocode's team writes all assessment questions. Claude helps draft them, and an admin approves each one.

**v0.3 changes:**
- The scope boundary is now fixed: the workspace starts **after** a candidate applies on careers.isocodelabs.com and ends at **interview scheduling and invite emails**. Final selection happens on calls, outside the workspace.
- Candidates now get workspace accounts with passwords, set up securely (R-AUTH).
- Added careers-site intake (R-INTAKE).
- Interview scheduling is now P0 (R-INTV).
- Added email recommendations (R-COMM), security requirements (R-SEC), and extra feature ideas (§14).

**v0.2 changes:**
- Added the hiring targets: 10 BDI, 4–5 SDE, 4–5 PM.
- Customization is now a core principle, with a new §6A Customization Engine.
- Multiple workflows per role and conditional routing moved up to P0/P1.
- Added §13 Technical Architecture (Google Cloud).
- Cycle 1 start date is still TBD.

**Design principle:** *Everything is configuration.* Workflows, stages, fields, rubrics, statuses, selection rules, emails and branding are all data the team edits in the UI. No role, process or question is hard-coded.

---

## 1. Problem Statement

Isocode Labs is hiring interns across three very different roles: **Business Development Intern (BDI)**, **SDE Intern**, and **PM Intern**. Each needs a multi-stage evaluation (application → assessment → task → review → interview). Today this is stitched together from forms, email, shared drives, and spreadsheets. Submissions end up in different places, reviewers score inconsistently, candidates get no clear status, and nothing carries over to the next hiring cycle.

If we don't fix this, every cycle costs the founders and reviewers days of manual coordination. Strong candidates also drop out because of slow or unclear communication, and we can't compare candidates or cycles with any confidence.

**What we're building:** a reusable internal **workspace** where Isocode can (a) define hiring workflows per role from reusable stage blocks, (b) collect every candidate input in one store, and (c) review and score submissions against consistent rubrics. It must keep working for future roles and cycles, not just this one.

### 1.1 Scope boundary (where the workspace starts and stops)

```
careers.isocodelabs.com        Isocode team                 workspace.isocodelabs.com                                  Outside (phone)
┌──────────────────┐   ┌─────────────────────┐   ┌────────────────────────────────────────────────────────┐   ┌──────────────────┐
│ Candidate applies │──▶│ Screens applications │──▶│ Admin invites shortlisted candidate for role(s)        │   │ Final selection   │
│ (role, resume,    │   │ → initial shortlist  │   │ → Account: login = email, temp password emailed        │   │ done on call by   │
│  basic details)   │   │   per role           │   │ → First login: must change password                    │──▶│ founders / HMs    │
└──────────────────┘   └─────────────────────┘   │ → Sees ONLY roles they're shortlisted for              │   └──────────────────┘
                                                   │ → Role workflow: forms, assessments, tasks             │
                                                   │ → Review & scoring → Interview shortlist               │
                                                   │ → Interview scheduled + invite & calendar emails       │
                                                   └────────────────────────────────────────────────────────┘
```

- **In scope:**
  - inviting **shortlisted** candidates (manually, by CSV, or later synced from the careers site),
  - candidate accounts and role-scoped access,
  - **every form and assessment for every role** (the careers site only does the first application),
  - all assessment stages,
  - review and scoring,
  - shortlisting,
  - interview scheduling,
  - every candidate email up to the interview invite.
- **Out of scope:**
  - the careers site itself and its application form,
  - the **initial screening/shortlisting** of careers-site applicants (done by the team before inviting; an in-workspace "Applicant inbox" for this is P1, see R-INVITE),
  - the interview conversation,
  - final selection,
  - offers and onboarding.
- **Thin hook (P1):** after the call, an admin can record a one-click **Final outcome** (Selected / Not selected / On hold). It closes the loop for analytics and the talent pool, and the workspace sends no offer.

---

## 2. Goals

| # | Goal | Type | Measure |
|---|------|------|---------|
| G1 | Run a full hiring cycle for all 3 roles without spreadsheets or manual email chasing | Business | 100% of candidate data & decisions live in the workspace for Cycle 1 |
| G2 | Cut reviewer effort per candidate | Business | Median review time per submission ≤ 10 min (vs. today's baseline, to be measured) |
| G3 | Make evaluation consistent and defensible | Business | Every advance/reject decision backed by a rubric score; inter-reviewer score spread ≤ 1 point (5-pt scale) on ≥ 80% of double-reviewed submissions |
| G4 | Give candidates a clear, fast experience | User | Stage completion rate ≥ 70% for invited candidates; candidate CSAT ≥ 4/5 |
| G5 | Make it reusable | Business | A new role/cycle can be launched by cloning a template in < 30 min, with no code changes |

---

## 3. Non-Goals (v1)

1. **Final selection, offers, onboarding, HRIS.** Final selection happens on calls after the interview. The workspace stops at scheduling the interview (plus an optional outcome flag).
2. **The careers site, job listings and the open application.** careers.isocodelabs.com owns job posts and the first application form. The workspace is **invite-only**: there is no public sign-up, and only shortlisted candidates get in (R-INVITE).
3. **In-house proctoring (webcam, screen recording).** Too invasive and costly for intern hiring. v1 uses lightweight integrity signals instead (§6, R-INT).
4. **Fully automated rejection by AI.** AI may summarize and suggest scores. A human always makes the final decision (fairness, and legal risk under India's DPDP Act).
5. **General-purpose automation (Zapier-style triggers to external apps).** The Process Builder canvas (§6C) models hiring stages and routing only. It doesn't connect arbitrary third-party actions.
6. **Multi-tenant SaaS for other companies.** Single organization (Isocode) in v1. The schema keeps an `org_id` so it can grow later.

---

## 4. Personas

| Persona | Who | Core need |
|---|---|---|
| **Workspace Admin** | Founders / hiring lead | Create roles, build workflows, manage team, see everything |
| **Hiring Manager** | Owner of a role (e.g. Tech Lead for SDE) | Configure that role's pipeline, make advance/reject decisions |
| **Reviewer** | Team member assigned to grade | See a queue of submissions, score against a rubric quickly, leave notes |
| **Candidate** | Shortlisted applicant (student / fresher), invited to one or more roles | Log in, complete the stages for their role(s), know their status and deadlines |
| **Interviewer** *(P1)* | Team member taking interviews | See the candidate's history and fill an interview scorecard |

---

## 5. Core Concepts (Domain Model)

These are the platform's building blocks. Everything else is configuration on top of them.

```
Organization
 └─ Role (Opening)              e.g. "SDE Intern"
     └─ Cycle (Hiring Round)    e.g. "Winter 2026"  — has dates, seats, status
         └─ Workflow            ordered list of Stages (cloned from a Template)
             └─ Stage           type + config + deadline + gate rule + rubric
Candidate (person, deduped by email)
 └─ Application                 Candidate × Cycle — current stage, status
     └─ Submission              Application × Stage — responses, files, links, timestamps
         └─ Review              Reviewer × Submission — rubric scores, notes, recommendation
Decision                        Application × Stage — advance / reject / hold, by whom, why
Library: Stage Templates · Workflow Templates · Question Bank · Rubric Templates · Email Templates
```

**Stage types (v1 = P0, rest later):**

| Stage type | What it is | Priority |
|---|---|---|
| **Form** | Additional-details form inside the workspace, beyond what the careers site collected (text, choice, file, URL) | P0 |
| **Assessment (Quiz)** | Timed questions: MCQ, multi-select, short/long answer; auto-scores objective items | P0 |
| **Task Submission** | Take-home brief with deadline. Collects files, links (GitHub, Figma, Docs, Loom), and a write-up | P0 |
| **Review Gate** | No candidate action. Team reviews and decides who advances | P0 |
| **Interview Scheduling** | Final stage for shortlisted candidates: slot booking, Google Meet link, invite emails (R-INTV) | **P0** |
| **Coding Assessment** | In-browser editor with test cases, auto-graded | P1 |
| **Video Response** | Recorded answer to prompts (async) | P2 |

---

## 6. Requirements

### P0 — Must-Have (MVP for Cycle 1)

#### R-INVITE · Inviting shortlisted candidates
The workspace is **invite-only**. A candidate exists in the workspace only after the team shortlists them from careers-site applications and an Admin/HM invites them to **one or more roles**.

**Ways to invite:**
- **Single invite (P0):** enter name, email, phone, role(s), and optionally track, resume/notes from the careers site, and custom fields.
- **Bulk CSV invite (P0):** upload a CSV exported from the careers site (`name, email, phone, role, track, resume_url, …`).
  - Preview shows: new candidates, existing candidates getting an extra role, duplicates, and invalid emails.
  - Admin confirms, then invites go out (throttled).
- **Careers-site sync (P1):** applications flow from careers.isocodelabs.com into an **Applicant inbox** (signed webhook, HMAC + idempotency). The team screens there and clicks **Shortlist → Invite**. This moves the initial screening into the workspace too, without changing the candidate experience.

**What an invite does:**
1. Finds or creates the candidate by email (one person = one account, whatever the number of roles).
2. Creates an **Application** for each invited role, placed at Stage 1 of that role's workflow/track.
3. On first invite only: creates login credentials and sends the **welcome email with the temporary password** (R-AUTH).
4. For an existing account invited to a new role: sends a "You've been shortlisted for {{role}}" email with **no new password**, and the new role appears on their dashboard.

**Admin controls:**
- Resend invite, which **regenerates** the temp password and kills the old one.
- Revoke an invite or a role.
- Schedule invites to send at a set time (e.g. 10:00 AM on cycle open day).
- See invite status per candidate: Invited → Logged in → Password changed → Started → …

**AC:**
- [ ] Inviting `riya@gmail.com` to SDE and PM in one CSV creates **1 account, 2 applications, 1 welcome email**.
- [ ] Inviting an existing candidate to BDI later adds the role and sends a role-added email without a password.
- [ ] A CSV row with an invalid email or unknown role is shown as an error in the preview and is not imported.
- [ ] No one can create an account from the login page. There is no sign-up link.

#### R-AUTH · Accounts, Login & Permissions
**Candidates — login ID = email, custom temporary password, forced change on first login (as decided):**

*Temporary password (emailed):*
- Generated by the system: **random, 12+ characters**, from a readable alphabet without look-alikes (no 0/O, 1/l/I), e.g. `Kx7m-Pq4t-Wr9z`. Admins can't type a custom one, which avoids reuse of weak or shared passwords. *(If you need admin-set passwords, allow it only with the same strength rules, P1.)*
- Stored **hashed (Argon2id) only**. It is never shown again in the admin UI after sending, and admins can only regenerate it.
- **Expires in 72 hours** if unused (configurable). Login with an expired temp password shows "Your temporary password expired. Ask us to resend it", or a self-serve "Email me a new one".
- **Single use:** after the first successful login, it only works on the change-password screen.

*First login:*
- The first login with the temp password goes straight to a **mandatory "Create your password" screen**. Nothing else in the portal is accessible until it's done.
- New password rules:
  - minimum 10 characters,
  - can't equal the temp password,
  - checked against known-breached passwords (Have I Been Pwned k-anonymity API),
  - hashed with Argon2id.
- After the change, the candidate gets a "Your password was changed" confirmation email (with a "This wasn't me" link that locks the account and alerts the admin).
- They then go to the **onboarding page** (what to expect, roles they're shortlisted for, first deadlines) and accept the privacy notice and consent (DPDP).

*Ongoing:*
- **Login protections:**
  - rate limiting per IP and per account,
  - progressive delay, then a 15-min lock after 10 failed attempts,
  - a generic error message ("Email or password is incorrect"),
  - **reCAPTCHA Enterprise** only after repeated failures.
- **Forgot password:** emailed reset link, valid 30 min, single-use. All sessions end on reset. (A link is used here rather than a new emailed password, because the candidate is already active.)
- **Change password** from profile at any time.
- **Sessions:** secure, httpOnly, SameSite cookies. Idle timeout 7 days. Candidate sessions are revoked when all their applications close or the cycle is archived.

*Why this is acceptable security-wise:* emailing a password is normally discouraged. Short expiry, single use, a forced change, and a confirmation email together bring the risk close to a set-password link, while keeping the familiar "email + password" experience the team wants.

*Welcome email (template):*
- **Subject:** "You're shortlisted for {{roles}} at Isocode Labs — your workspace login"
- **Body:**
  - a congratulations line,
  - the roles they're shortlisted for,
  - **Login ID:** {{email}},
  - **Temporary password:** {{temp_password}},
  - the login URL,
  - "Valid for 72 hours; you'll be asked to set your own password on first login",
  - the first deadline,
  - a support contact.
- `{{temp_password}}` is a **restricted variable**: it's only available in the Welcome / Resend-credentials templates, it's never written to email logs (the timeline shows "••••"), and it can't be added to any other template.

**Team — Google Workspace SSO only:**
- Sign-in restricted to `@isocodelabs.com`. 2-step verification is enforced through Google Workspace. Team members have no local passwords.
- **Permissions:**
  - Admin,
  - Hiring Manager (scoped to roles/tracks),
  - Reviewer (scoped to assigned submissions),
  - Interviewer (sees only candidates assigned to their interviews).
- Offboarding: removing a member from Google Workspace or the team list revokes access immediately.

- **AC:**
  - [ ] The first login with the temp password always lands on "Create your password". Calls to any other page or API redirect or return 403 until it's changed.
  - [ ] A temp password stops working after 72 hours or after the password change. "Resend invite" invalidates the previous temp password.
  - [ ] Email logs and the candidate timeline never show the temp password in plain text.
  - [ ] A Reviewer cannot see candidates for roles they're not assigned to.
  - [ ] 11 wrong passwords in a row lock the account for 15 min, and the candidate gets a "Was this you?" email.

#### R-ACCESS · Role-scoped candidate access
- A candidate's dashboard lists **only the roles they've been invited (shortlisted) for**. Each one shows as a card with its own progress tracker, current step, and deadline.
- A candidate can **only open, start or submit stages that belong to their own applications**. Other roles' forms, assessments and briefs are invisible and inaccessible, even by guessing URLs.
- Each role's assessments and forms run fully independently. Progress, timers and deadlines on SDE don't affect PM, and vice versa.
- If a role is **revoked** or the candidate is **rejected** for one role, that role's card shows a neutral status ("Process closed"). Their other roles keep working.
- If all of a candidate's roles are closed, they can still log in to see the final status, read-only, until the retention period ends.
- **Enforced on the server:**
  - every candidate request is checked as `application.candidate_id == session.candidate_id AND application.status is active AND stage belongs to application.workflow_version`,
  - question content for a stage is sent only when that stage is unlocked for that candidate.
- **AC:**
  - [ ] A candidate invited only to BDI sees exactly one role card. Opening the SDE assessment URL directly returns 404 (not 403, so it doesn't reveal that it exists).
  - [ ] A candidate invited to SDE and PM sees two cards, and can run the SDE quiz and PM task without one affecting the other.
  - [ ] Revoking PM for a candidate removes PM access immediately, including any open assessment session. SDE is unaffected.
  - [ ] An assessment's questions are never included in page source or API responses before that candidate starts it.

#### R-ROLE · Roles & Cycles
- Create a Role with title, description, location/remote, stipend, duration, and seats.
- Create a Cycle under a Role with open/close dates and status: Draft → Open → Closed → Archived.
- **Clone a Cycle**, which copies its workflow, forms, rubrics, and emails into a new cycle.
- **AC:**
  - [ ] Given a Closed cycle, when Admin clicks "Clone as new cycle," a Draft cycle is created with an identical workflow and no candidates.
  - [ ] Applications are rejected after the cycle's close date, and the candidate sees a "Applications closed" page.

#### R-WF · Process Builder (drag-and-drop canvas)
- A **visual node canvas**. Admins drag stage types from a palette onto the canvas, connect them, and click any node to edit it in a side panel. Full UX and design spec in **§6C**.
- Per stage: name, instructions (rich text), deadline (absolute date *or* "N days after unlock"), gate rule, rubric, assigned reviewers, and email templates for unlock/reminder/result.
- **Gate rules:** manual decision (default), auto-advance on submit, or auto-advance if auto-score ≥ X.
- Save any workflow as a **Workflow Template** (e.g. "Intern – Standard: Form → Quiz → Task → Interview").
- **Locking:** once a cycle has candidates, structural edits (delete or reorder stages) need confirmation and versioning. Copy edits stay free.
- **AC:**
  - [ ] Admin can build "Form → Assessment 1 → Task Submission → Review Gate" in under 10 minutes.
  - [ ] Given a stage with auto-advance ≥ 60%, a candidate scoring 65% unlocks the next stage immediately, and one scoring 55% lands in "Needs decision."
  - [ ] Deleting a stage that has submissions is blocked unless Admin archives it. Submissions are never lost.

#### R-FORM · Form & Question Builder
- Field types: short text, long text, email, phone, single/multi choice, dropdown, number, date, URL, file upload (PDF/DOC/ZIP/images, ≤ 25 MB), rating, and section/heading.
- Required/optional, help text, and simple validation (e.g. URL must be github.com).
- **Question Bank:** reusable questions tagged by role, skill, and difficulty. Assessments can pull "N random from tag X."
- **AC:**
  - [ ] A form saves drafts automatically, so a candidate closing the tab doesn't lose answers.
  - [ ] File uploads show progress and fail clearly on oversize or unsupported type.

#### R-ASMT · Timed Assessment
- Time limit per assessment, plus an availability window (opens/closes).
- Auto-scores MCQ and multi-select. Text answers go to the review queue.
- Randomize question and option order per candidate.
- **AC:**
  - [ ] The timer survives a page refresh (server-side start time). The assessment auto-submits when time runs out.
  - [ ] A candidate cannot start after the window closes or restart once submitted.

#### R-TASK · Task Submission
- Brief (rich text + attachments), deadline, and required deliverables: files, links, and a write-up.
- Resubmission allowed until the deadline (configurable). Every version is kept and the latest is graded.
- Late submissions are flagged rather than silently accepted. Admin can enable a grace period or per-candidate extensions.
- **AC:**
  - [ ] Given a deadline has passed, the submit button is disabled and the candidate sees a "Request extension" option (if enabled).
  - [ ] A reviewer can see the submission timestamp and every previous version.

#### R-STORE · Submission Store
- Every candidate input (form answers, files, links, assessment responses) is stored against Application × Stage, with timestamps.
- Files live in object storage (S3/R2-compatible) and are served via signed, expiring URLs.
- **Candidate profile view:** one page showing all stages, submissions, scores, notes, and decisions in a timeline.
- **AC:**
  - [ ] Every file in the profile view opens or previews inline (PDF, images) or downloads (ZIP).
  - [ ] Deleting a candidate soft-deletes. Hard purge only happens via the retention job (R-PRIV).

#### R-REV · Review & Scoring
- **Rubrics:** criteria with weights and a 1–5 scale, plus anchor descriptions per level (e.g. "3 = working solution, minimal tests"). Rubric templates are reusable.
- **Review Queue:** each reviewer sees their assigned, unscored submissions, then works through them with next/prev, the submission and rubric side by side, and keyboard shortcuts.
- Assignment: manual, or round-robin across a stage's reviewer pool, with **N reviewers per submission** (default 1, configurable to 2).
- **Blind review option:** hides the candidate's name, college, and photo from reviewers on that stage.
- Recommendation per review: Strong Yes / Yes / No / Strong No, plus private notes.
- Aggregate score = weighted rubric average across reviewers. Divergent scores (spread > 1.5) get flagged.
- **AC:**
  - [ ] A reviewer cannot see other reviewers' scores until they submit their own (prevents anchoring).
  - [ ] Given 2 reviewers scored 2 and 5 on the same criterion, the submission shows a "Calibration needed" flag.

#### R-PIPE · Pipeline & Decisions
- **Kanban board** per cycle: columns = stages plus Rejected/Withdrawn/Hired. **Table view** with filters (stage, score range, status, reviewer, tags) and sort.
- Bulk actions: advance, reject, send email, tag, assign reviewer.
- Every decision is logged with who, when, and an optional reason.
- **AC:**
  - [ ] Advancing a candidate unlocks the next stage and triggers its unlock email.
  - [ ] A bulk reject of 50 candidates sends 50 rejection emails (queued) and logs 50 decisions.

#### R-COMM · Notifications & Email
- Templated transactional emails with variables ({{first_name}}, {{stage_name}}, {{deadline}}, {{link}}).
- **Default templates:**
  - welcome + login credentials (temp password),
  - role added (existing account),
  - password changed confirmation,
  - password reset,
  - stage unlocked,
  - reminder (24h before deadline),
  - submission received,
  - advanced,
  - not progressing,
  - shortlisted / pick your interview slot,
  - interview confirmed (with `.ics`),
  - interview reminder,
  - rescheduled/cancelled.

**Mailing setup — recommendation:**

| Concern | Choice | Why |
|---|---|---|
| **Sending provider** | **Amazon SES** (primary pick, cheapest), with **Zoho ZeptoMail** as the simpler low-cost alternative | SES charges about $0.10 per 1,000 emails, so a full cycle (~5–10k emails) costs **under $1**. It has bounce/complaint webhooks (via SNS) and works fine from Google Cloud. Setup is a little more work: request production access to leave sandbox mode, and verify the domain. ZeptoMail is pay-as-you-go credits (roughly $2.50 per 10k emails), has an easier setup, and is an India-based vendor. Paid tiers of Resend/Postmark aren't needed at this volume. Google Cloud has no native email-sending service. Templates are still written with **React Email**, which works with any provider. |
| **Not recommended** | Sending through Gmail/Google Workspace SMTP | Daily sending limits, poor tracking, and it risks the reputation of the team's real mailboxes |
| **Sending domain** | Separate subdomain, e.g. `mail.isocodelabs.com`, From `Isocode Hiring <hiring@mail.isocodelabs.com>`, **Reply-To `hiring@isocodelabs.com`** (a real Google Workspace group inbox) | Keeps bulk hiring email from damaging the main domain's reputation. Candidate replies still reach humans. |
| **Authentication** | **SPF + DKIM + DMARC** (start `p=none` with reports, move to `p=quarantine` after 2 weeks of clean reports) | Required by Gmail/Yahoo bulk-sender rules. Without them, emails land in spam. |
| **Deliverability hygiene** | Warm up the domain for 1–2 weeks before Cycle 1. Plain, text-light templates. Webhooks for bounces/complaints feed an automatic **suppression list**. Avoid link shorteners. | Student Gmail inboxes are strict |
| **Calendar invites** | Sent by **Google Calendar API** (from the interviewer's calendar) *plus* our own confirmation email with `.ics` | Calendar-native invites land reliably and auto-add to the candidate's calendar |
| **Queueing** | All emails go through Cloud Tasks with retries. Bulk sends are throttled (e.g. 10/sec). | A provider blip never loses an email |
| **Visibility** | Every email is logged on the candidate timeline with delivered/opened/bounced status. Admin can resend. | "Did they get it?" is answered in one click |
| **Backup channel** | In-portal notification center (P0) + WhatsApp (P1) | A candidate who never got the email still sees the task on login |
- Rejection emails can be delayed and batched (e.g. sent 48h after decision) so they don't feel automated.
- Team in-app notifications: new submissions in your queue, and a daily digest.
- **AC:**
  - [ ] Every sent email is visible in the candidate's timeline.
  - [ ] Unsubscribe from reminders is honoured. Transactional status emails are still sent.

#### R-PORTAL · Candidate Portal
- After logging in, the candidate sees each application with a stage progress tracker, current action, deadline countdown, and past submissions (read-only).
- Mobile-friendly (many candidates apply from phones), with forms that work at 375px width.
- Branded with the Isocode identity (design skill applied, per role brief).
- **AC:**
  - [ ] Candidate sees "Under review" (not the internal score) while a stage is being reviewed.
  - [ ] Withdrawing an application is a single action with a confirmation step.

#### R-INT · Integrity Signals (lightweight)
- Assessment logs tab/window focus loss, copy-paste events, and time-per-question. Shown to reviewers as **signals, not verdicts**.
- Duplicate detection: same email/phone across applications, and near-identical text submissions across candidates (similarity check).
- **AC:**
  - [ ] A reviewer sees "Left tab 7 times, longest 3m12s" on the assessment submission.

#### R-INTV · Interview Scheduling & Invites (end of the workspace journey)
**Shortlisting:**
- Admins/HMs pick candidates for interview from the pipeline. Each pick can be:
  - one candidate at a time,
  - a bulk "Shortlist" action, or
  - a rule (C4, e.g. "Top 15 by composite score").
- **Compare view:** 2–4 candidates side by side (scores per stage, key submissions, reviewer recommendations) to help finalize the shortlist.

**Interview setup** (per track, reusable as a template):
- interview type/name (e.g. "Founder Round", "Tech Interview"),
- duration (30/45/60 min),
- interviewer panel,
- mode (Google Meet / phone / in-person + address),
- buffer between interviews,
- booking window (e.g. next 7 days),
- daily time range,
- candidate instructions.

**Three scheduling modes:**
1. **Candidate self-booking (recommended):** the workspace reads interviewers' **Google Calendar free/busy** and offers open slots. The candidate picks one in their portal, and the slot is held instantly so it can't be double-booked.
2. **Admin assigns a time** directly, after checking interviewers' availability inline.
3. **Bulk scheduling:** admin selects N shortlisted candidates and the system auto-fills them into open slots. Admin reviews, then sends.

**On booking:**
- A **Google Calendar event** is created on the interviewer's calendar with an auto-generated **Google Meet link**, and the candidate is added as a guest. The candidate also gets the workspace's own invite email with an `.ics` attachment.
- The event description links to a private **Interview Brief** page for interviewers. It holds the candidate snapshot, all scores and submissions, and reviewer notes (with an AI summary, P1).

**Emails & reminders:**
- shortlist / "pick your slot" email,
- booking confirmation,
- reminder 24h and 1h before (email + WhatsApp, P1),
- reschedule/cancel notices,
- a "not shortlisted" email (delayed and batched, per C7).

**Reschedule / cancel:**
- The candidate can reschedule once, up to 12h before the slot (configurable).
- Admin can always reschedule or cancel, and the calendar event updates automatically.

**No-show handling:** admin marks a no-show and chooses whether to offer one re-book.

**Post-interview:** a status of Interview done, plus a one-click Final outcome (P1, recorded after the selection call). There's no interview scorecard in v1, since selection happens on calls. A scorecard is optional P1.

**AC:**
- [ ] Given an interviewer has a busy event 3–4 pm, no candidate can book a slot that overlaps it.
- [ ] Two candidates clicking the same slot at once: one succeeds, and the other sees "Slot just taken" with refreshed options.
- [ ] Booking creates exactly one calendar event with a Meet link. Rescheduling updates that event rather than creating a new one.
- [ ] A shortlisted candidate who hasn't picked a slot within 48h gets one reminder, and the admin sees them in a "Pending booking" list.

#### R-SEC · Security Requirements (P0)
| Area | Requirement |
|---|---|
| **Transport & headers** | HTTPS only with HSTS. Strict **Content-Security-Policy**, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy. |
| **App security** | CSRF protection on all state-changing requests. All inputs validated with Zod on the server. Candidate-authored rich text sanitized (DOMPurify) before display to reviewers (prevents stored XSS against the team). |
| **Authorization** | One central policy layer checks every request (role × workflow × ownership). IDs are non-guessable (UUID/ULID). Automated tests cover "candidate A cannot read candidate B's submission". |
| **File uploads** | Allow-list of file types, checked by real content type rather than extension. Size limits. Direct-to-bucket signed upload URLs. **Malware scan** before files are downloadable. Files served from a separate storage domain with `Content-Disposition: attachment` for non-previewable types. |
| **Credentials** | Temp passwords: random, 12+ characters, hashed, 7-day expiry, single-use, forced change. Excluded from logs, the email timeline, analytics and error reports (Sentry scrubbing). |
| **Invite-only** | No public sign-up endpoint. Account creation only through the admin invite/CSV paths (and the P1 careers sync webhook with HMAC + timestamp + idempotency). |
| **Abuse protection** | Cloud Armor (WAF + rate limits) on login, change-password, forgot-password and upload endpoints. reCAPTCHA Enterprise only when needed (adaptive). |
| **Secrets & infra** | Secret Manager. Least-privilege service accounts. Cloud SQL on private IP. No public buckets. Encryption at rest (default) and in transit. |
| **Data protection (DPDP Act 2023)** | Consent captured on the careers site **and re-confirmed on first workspace login**. Privacy notice in the portal. Retention + purge jobs. Candidate data-deletion request. No PII in logs. |
| **Monitoring** | Alerts on login-failure spikes, 5xx spikes and webhook failures. Audit log of all admin actions and data exports. |
| **Supply chain** | Dependabot/Renovate, `npm audit` in CI, container image scanning (Artifact Registry). |
| **Backups & recovery** | Daily automated backups + point-in-time recovery, with a restore test before launch. |
| **Pre-launch** | OWASP Top-10 checklist review + a lightweight penetration test (internal or freelance) of auth, file upload and authorization. |

#### R-AUDIT · Audit Log
- Immutable log of admin actions: workflow edits, decisions, score changes, data exports, and deletions.

#### R-PRIV · Privacy & Data
- Consent checkbox and privacy notice on the application form (India **DPDP Act 2023**).
- Configurable retention (e.g. purge rejected candidates' files 12 months after cycle close). Candidates can request data deletion.
- CSV export of a cycle (team only, logged).

---

### 6A. Customization Engine (P0 unless marked)

The team wants to run **multiple workflows and selection processes**, including ones not yet imagined. This section defines what is configurable and how it stays safe while candidates are mid-process.

#### C1 · Multiple workflows per role ("Tracks") — P0
- A Cycle can hold **one or more Workflows (Tracks)**, e.g. *SDE – Frontend* / *SDE – Backend*, or *BDI – Campus* / *BDI – Experienced*.
- Candidates get a track from:
  - a form answer (e.g. "Which track?"),
  - a routing rule (C4), or
  - manually, by a Hiring Manager.
- A candidate can be **moved between tracks**. Their completed submissions travel with them; new-track stages unlock from the right point.
- **AC:**
  - [ ] Given SDE Cycle has 2 tracks and the form asks "Frontend or Backend?", a candidate answering "Backend" lands in the Backend track's Stage 2.

#### C2 · Stage library & Custom Stages — P0
- Every stage type (§5) is a configurable block: name, instructions, deadline, visibility, reviewers, rubric, gate, emails.
- **Custom Step:** a generic stage built from any form fields + optional timer + optional review rubric. It covers stages we haven't predicted (e.g. "Record a 2-min pitch link", "Group task", "Reference check").
- Stages can be **internal-only**, with no candidate action (e.g. "Founder call notes", "Background check").
- Save any configured stage as a **Stage Template** to reuse across workflows.

#### C3 · Custom fields, statuses & tags — P0
- **Candidate profile fields:** global custom fields (college, grad year, city, portfolio, referral source…) defined once and reused in any form. They show in the table view as filterable columns.
- **Custom pipeline statuses** per workflow, beyond the defaults (e.g. "On hold – next cycle", "Shortlisted for founder call").
- **Custom tags** with colors, used for filtering and bulk actions.
- **Custom rejection/withdrawal reasons** (dropdown), for analytics on why candidates fall out.

#### C4 · Routing & Selection Rules — P0 (simple), P1 (advanced)
A structured **rule editor** on each stage's exit: `WHEN [condition] THEN [action]`, evaluated in order.

| Conditions | Actions |
|---|---|
| Auto-score ≥ / ≤ X | Advance to next stage |
| Aggregate rubric score ≥ / ≤ X | Jump to stage N / another track |
| Specific criterion score (e.g. "Code quality" ≥ 4) | Reject (with template, delay) |
| Form answer equals / contains | Hold / set status |
| Rank within stage (top N or top X%) | Add tag |
| Reviewer consensus (all Yes / majority / any Strong No) | Notify Hiring Manager |
| Submitted late / integrity flag present | Assign extra reviewer |

- **P0:** single-condition rules plus advance, reject, hold or tag actions, and a "Needs manual decision" fallback.
- **P1:** AND/OR condition groups, jump-to-stage/track, top-N ranking rules, and **dry-run** to preview who each rule would move before enabling it.
- **Safety:** rules never auto-reject unless the Admin explicitly enables "auto-reject" on that rule. The default is to route to "Needs decision".
- **AC:**
  - [ ] Given rule "Quiz ≥ 70% → advance; else → Needs decision", a 72% candidate advances and a 60% candidate appears in the HM's decision list. No rejection email is sent.

#### C5 · Scoring model & final scorecard — P0
- **Rubric builder:**
  - criteria with descriptions and anchors,
  - scale type (1–5, 1–10, Pass/Fail, Yes/No),
  - per-criterion weights,
  - optional "must-pass" criteria (a fail blocks advancing).
- **Composite score:** each workflow defines weights across stages, e.g. Quiz 20% + Task 50% + Interview 30%. The result shows as one sortable "Overall" score on the pipeline.
- **Reviewer rules per stage:**
  - number of reviewers,
  - assignment method (round-robin, manual, by load),
  - blind on/off,
  - consensus rule.

#### C6 · Forms & pages per role — P0
- Each Role/Track gets its own **role space inside the portal** (visible only to candidates invited to it). It has its own cover, intro copy, what-to-expect, FAQ, and accent color, which applies that role's design brief. There's no public apply page, since applying happens on careers.isocodelabs.com.
- Form logic (P1): show or hide fields based on earlier answers.

#### C7 · Communication customization — P0
- Email templates are configurable at org, workflow, and stage level (the most specific wins).
- Variables include custom fields, and each email gets a preview with a sample candidate.
- Send timing per template: immediate, delayed by X hours, or scheduled at a fixed time.

#### C8 · Templates, cloning & import/export — P0 (clone), P1 (import/export)
- Duplicate anything: workflow, stage, form, rubric, email, or a whole cycle.
- **P1:** export and import a workflow as JSON, to share setups or keep backups.

#### C9 · Versioning (safety for in-flight candidates) — P0
- Workflows are **versioned**. Each Application is pinned to the version it started on.
- Text edits apply immediately to everyone. Structural changes (stages, rules, rubrics) create a new version, and Admin chooses to "apply to new candidates only" or "migrate existing".
- **AC:**
  - [ ] Changing a task deadline after 20 candidates started shows: "Apply to all 20 in-progress candidates?" Each choice is logged.

#### C10 · Permissions per workflow — P0
- Hiring Managers and Reviewers are assigned per Role/Track. Admin can make any workflow private to specific members.

---

### 6B. Admin Claude MCP Server — P0

**What:** the workspace exposes its own **MCP server** at `workspace.isocodelabs.com/mcp`. Admins connect it to **Claude** (Claude Desktop, claude.ai as a custom connector, or Claude Code) and work with the whole workspace in plain language. Some examples:
- "Draft 15 medium-difficulty SQL MCQs for the SDE quiz."
- "Assess the 40 PM case studies against the rubric and draft scores."
- "Why is BDI drop-off high at the task stage?"
- "Suggest a better workflow for next cycle."

**Who:** **Admins only.** Hiring Managers, Reviewers, Interviewers and candidates cannot connect. Access is enforced by the server, not by convention.

#### MCP-1 · Access & security
- Remote MCP over **Streamable HTTP**, authenticated with **OAuth 2.1**. Sign-in goes through the same Google Workspace SSO (R-AUTH), and the token is issued only if the user's workspace role is **Admin**.
- Tokens are short-lived and scoped. An admin can see and **revoke connected Claude clients** in Settings.
- Every MCP call is written to the **Audit Log** as `actor = admin via Claude`, with the tool name and arguments.
- Rate limits per token. Candidate PII returned to Claude is limited to what the task needs. Blind-review stages return anonymized submissions.
- A **kill switch** in Settings disables the MCP server workspace-wide.

#### MCP-2 · Safety model: Claude drafts, admins decide
| Tier | Behaviour | Examples |
|---|---|---|
| **Read** | Runs freely | Pipelines, candidates, submissions, scores, funnel metrics, workflow configs, question bank |
| **Draft writes** | Saved as **Draft / "AI-suggested"**, invisible to candidates until an admin approves in the UI or via an approve tool | New questions, rubrics, workflow changes, email templates, AI review scores |
| **Candidate-affecting actions** | **Never executed directly.** Claude prepares a batch; the admin confirms it in the workspace UI | Advance/reject, send emails, schedule interviews, publish a workflow version |

- AI-drafted review scores are stored as a separate **"Claude suggestion"** next to human reviews. They never count toward the composite score until a human accepts or edits them.

#### MCP-3 · Tools (v1)
**Questions & assessments**
- `search_question_bank`, `create_questions` (bulk, as drafts, with tags, difficulty and answer key), `update_question`
- `check_question_quality`: flags ambiguous wording, duplicate questions, answers easily found online, and difficulty imbalance
- `build_assessment`: assembles a quiz from bank tags and difficulty mix

**Assessing submissions**
- `list_submissions` (by stage, status, unreviewed), `get_submission` (answers, files as text extracts, links, integrity signals)
- `draft_review`: scores against the stage rubric with evidence quotes per criterion and saves a Claude suggestion
- `compare_candidates`: side-by-side summary for a shortlist
- `find_similar_submissions` (plagiarism / shared-answer detection)

**Process optimization**
- `get_funnel_metrics`, `get_stage_stats` (completion, time-in-stage, score distributions, reviewer load)
- `get_workflow`, `propose_workflow_change` (draft version), `simulate_rules`: dry-run selection rules against real current candidates and show who would move
- `get_reviewer_calibration`: shows score spread between reviewers

**Setup**
- `list_roles_cycles_tracks`, `draft_email_template`, `draft_rubric`, `clone_cycle` (as Draft)

**Prepared actions** (need UI confirm)
- `prepare_bulk_decision`, `prepare_interview_invites` → returns a link to a confirmation screen

#### MCP-4 · In-app "Ask Claude" panel — P1
- A side panel inside the admin UI uses **the same tool layer** through the Claude API (Vertex AI). Admins get the same help without leaving the workspace, with context about the current page included automatically ("assess this submission", "improve this question").

- **AC:**
  - [ ] A Reviewer account attempting the MCP OAuth flow is refused, and no token is issued.
  - [ ] `create_questions` with 15 items produces 15 **Draft** questions that do not appear in any live assessment until approved.
  - [ ] `draft_review` never changes a candidate's composite score, status or stage.
  - [ ] Asking Claude to "reject everyone below 40%" returns a confirmation link. No candidate is rejected or emailed until the admin confirms in the UI.
  - [ ] Every MCP call appears in the Audit Log with the admin's identity.
  - [ ] With the kill switch on, all MCP calls return 403.

---

### 6C. Process Builder — UX & Visual Design (P0)

**Feel:** *"Figma meets Linear."* Playful color and motion on the canvas make building a process feel creative. The chrome around it (panels, forms, tables) stays calm, dense and professional. Rule of thumb: **vibrant on the nodes, quiet everywhere else** (≈10% color, 90% tinted neutrals).

#### D1 · Layout
```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ◀ SDE Intern · Winter 26 ▾ Track: Backend ▾     ● Draft v3   ⟲ ⟳   Preview ▶   Publish │  ← top bar
├──────────────┬──────────────────────────────────────────────────┬──────────────────┤
│ STAGE PALETTE│                    CANVAS                        │  NODE INSPECTOR  │
│ 🔍 Search    │                                                  │  (slides in on   │
│ ▣ Form       │   ┌─────────┐    ┌──────────┐    ┌──────────┐    │   node select)   │
│ ◆ Assessment │   │ ▣ Form  │───▶│◆ Tech    │───▶│▲ Take-   │──┐ │  Tabs:           │
│ ▲ Task       │   │ Details │    │  Quiz    │ ≥70%│  home    │  │ │  Basics · Content│
│ ◎ Review     │   └─────────┘    └──────────┘    └──────────┘  │ │  Rules · Scoring │
│ ✦ Custom     │                       │ <70%                   │ │  Emails · People │
│ ◷ Interview  │                       ▼                        ▼ │                  │
│ ──────────── │                 ┌──────────┐            ┌─────────┐│                  │
│ TEMPLATES    │                 │◎ Needs   │            │◷ Inter- ││                  │
│ Intern Std.  │                 │ decision │            │  view   ││                  │
│ BDI Fast     │                 └──────────┘            └─────────┘│                  │
│              │  [minimap]                     [− 100% +] [fit]  │                  │
└──────────────┴──────────────────────────────────────────────────┴──────────────────┘
```

#### D2 · Interactions (must feel effortless)
| Action | Behavior |
|---|---|
| **Add a stage** | Drag from palette → drop on canvas; **or** hover any connector and click the **"+"** that appears to insert in between; **or** press `/` for quick-add search |
| **Connect** | Drag from a node's right handle to another node. Smart connectors auto-route around nodes. A dropped connector on empty canvas opens quick-add for the next stage. |
| **Reorder** | Drag a node onto a connector to insert it there. Downstream nodes reflow with a 200 ms spring animation. |
| **Branch** | Drag a second connector from a node's handle → the **rule chip** on the line (e.g. "≥ 70%", "Answer = Backend") is clickable and edits the C4 rule inline |
| **Edit a node** | Single-click opens the **Inspector** panel (node stays highlighted). Double-click the title to rename inline. Changes autosave with an "Saved ✓" indicator. |
| **Multi-select** | Shift-click or drag-lasso → move, duplicate, delete, or "Save as template" |
| **Undo / redo** | `Ctrl+Z` / `Ctrl+Shift+Z`, 50 steps, covers every canvas and inspector change |
| **Auto-layout** | One click to tidy into a clean left-to-right flow (ELK.js layout) |
| **Delete** | Danger-styled confirm dialog, always. If the stage has submissions → "Archive instead" (C9) |
| **Validate** | Live checks with soft red/amber badges on nodes: unconnected node, missing rubric, missing deadline, rule with no "else" path, unreachable stage. **Publish** stays disabled until there are no red errors. |
| **Preview** | "Preview as candidate" runs the flow in a candidate-view modal using test data |
| **Publish** | Shows a diff vs. live version ("+1 stage, rule changed on Quiz"), then the C9 choice: new candidates only / migrate in-progress |

#### D3 · Node anatomy (every node is fully editable)
```
┌──────────────────────────────────────┐
│ ◆  Tech Quiz                    ⋯    │  ← type-color icon chip · editable title · menu (duplicate, template, delete)
│ Assessment · 30 min · 20 Qs          │  ← auto-generated summary of config
│ ⏰ Due 3 days after unlock           │
│ 👥 2 reviewers · Blind               │
│ ───────────────────────────────────  │
│ 84 in stage · 61 submitted  ▓▓▓▓▓░░  │  ← live counts (published workflows only)
│ [✓ Ready]                            │  ← soft status pill: Ready / Needs setup / Error
└──────────────────────────────────────┘
```
**Inspector tabs** (the same structure for every node type, so there's nothing new to learn):
- **Basics:** name, description, deadline, visibility.
- **Content:** form fields, questions or task brief. It opens the Form/Question builder in place, with drag-and-drop field reordering.
- **Rules:** the C4 rule editor (WHEN … THEN …) with dry-run.
- **Scoring:** rubric and weights.
- **Emails:** unlock, reminder and result templates.
- **People:** reviewers, assignment and blind mode.

#### D4 · Visual design system (creative × professional)
**Typography:**
- **Plus Jakarta Sans** for headings: friendly and modern, with personality.
- **Inter** for UI and body text: highly legible in dense panels.
- **JetBrains Mono** for codes and IDs.
- Body text ≥ 16px and panel text ≥ 14px (generous sizing; small copy gets flagged).

**Color — 3-tier system:**

| Tier | Token | Value | Use |
|---|---|---|---|
| **Primary** | `--brand-500` | **#6D4AFF** electric violet (10-step ramp `--brand-50…900`) | Primary buttons, selection rings, active connector, focus. Swap to the Isocode brand hue if one exists. |
| | Accent gradient | `#6D4AFF → #22D3EE` (violet → cyan) | **Used sparingly:** Publish button, selected-node glow, empty-state art, header ribbon. Never on text. |
| **Neutrals** | Cool slate tinted toward violet | `#F7F7FB` canvas bg · `#FFFFFF` panels · `#E6E6F0` borders · `#5B5B72` secondary text · `#16162A` primary text | ~90% of pixels. The canvas has a subtle dot grid (`#E1E1EC`, 24px). |
| **Supporting — node types** (categorical, used on icon chip + 3px top border only) | Form | `#0EA5E9` sky | |
| | Assessment | `#8B5CF6` violet | |
| | Task | `#F97316` orange | |
| | Review Gate | `#14B8A6` teal | |
| | Custom Step | `#EC4899` pink | |
| | Interview | `#6366F1` indigo | |
| **Supporting — status** (fixed semantics, soft pills: subtle bg + emphasis text) | Success/Ready | green | |
| | Warning/Needs setup | amber | |
| | Error | red | |
| | Draft/Skipped | grey | |

- **Type colors never carry meaning alone.** Every node also has a distinct icon and a type label.
- Status pills always include text ("Ready", "Needs setup").
- All text/background pairs meet **WCAG AA**.

**Shape & depth:**
- Nodes: 16px radius, 1px border, soft layered shadow (`0 1px 2px rgba(22,22,42,.06), 0 8px 24px rgba(22,22,42,.06)`).
- On hover, the node lifts 2px. When selected, it gets a 2px brand ring plus a faint gradient glow.

**Motion:** 150–250 ms ease-out springs for drop, reflow and the panel slide.
- A small confetti burst on **first successful Publish** only (delight, not noise).
- Respects `prefers-reduced-motion`.

**Dark mode (P0):**
- Canvas `#0F0F1C`, panels `#17172A`, borders `#2A2A44`.
- Node type colors shift one step lighter (400-level) to keep contrast.
- **Verified in both themes before sign-off.**

**Iconography:** one set only (**Lucide** or **Tabler Icons**, 24px grid, 2px stroke). No mixing.

**Empty state:** a friendly illustration plus three big starter cards:
- "Start from Intern Standard",
- "Start from scratch",
- "Duplicate an existing process".

#### D5 · Accessibility & keyboard
- Every canvas action has a keyboard path:
  - `Tab` cycles through nodes,
  - `Enter` opens the inspector,
  - arrow keys nudge,
  - `Ctrl+D` duplicates,
  - `Del` deletes (with confirm).
- Screen-reader **outline view**: a toggle shows the process as an ordered, editable list. It uses the same data, and it's also handy on small screens.
- Hit targets ≥ 32px. Visible focus rings (brand color).

#### D6 · Tech
- Canvas: **React Flow (@xyflow/react)**. Palette drag: **dnd-kit**. Auto-layout: **ELK.js**.
- Styling: Tailwind + **shadcn/ui**, themed with the tokens above via CSS variables. Motion: **Framer Motion**.
- The canvas graph serializes to `workflow_versions.config` as `{nodes[], edges[], rules[]}`. **This is the same data the rule engine and MCP tools use** (§13.2, §6B). There's one source of truth, not a separate "visual" model.

#### D7 · Acceptance criteria
- [ ] A new admin, unassisted, builds *Form → Quiz → (≥70%) Task / (<70%) Needs decision → Interview* in **under 5 minutes** (usability test with 3 team members).
- [ ] Every node type opens the inspector with the same 6 tabs, and every field is editable there.
- [ ] Drag, drop and reflow run at 60 fps with 30 nodes on a mid-range laptop.
- [ ] Publish is blocked while any node shows a red "Error" pill, and the error list links to each node.
- [ ] Undo restores the exact previous state, including inspector edits.
- [ ] Light and dark mode both pass AA contrast for all node, pill and text combinations.
- [ ] The outline view supports the same add, reorder, edit and delete actions without a mouse.

---

### P1 — Nice-to-Have (fast follow, Cycle 1–2)

| ID | Feature | Notes |
|---|---|---|
| R-AI-1 | **AI review assistant** | Uses Claude to summarize each submission against the rubric, suggest scores with cited evidence, and flag missing deliverables. Reviewers accept/edit, and the system logs whether AI suggestions were used. Never auto-decides. |
| R-AI-2 | **AI resume/form screening summary** | One-paragraph candidate snapshot plus "matches/missing" against the role's must-haves. |
| R-CODE | **Coding assessment stage** | In-browser editor (Monaco), JS/Python/Java, hidden test cases, auto-score. Alternatively, integrate with GitHub repo checks for SDE tasks. |
| R-OUTCOME | **Final outcome flag** | One-click Selected / Not selected / On hold after the selection call. It feeds analytics and the talent pool. No offer is sent from the workspace. |
| R-SCORECARD | **Interview notes/scorecard** | Optional notes form for interviewers, if the team wants structured notes from calls. |
| R-ANLY | **Analytics dashboard** | Funnel per stage (invited → started → submitted → advanced), drop-off, median time-in-stage, score distributions, reviewer load and turnaround, source tracking (UTM on apply links). |
| R-CAL | **Calibration view** | Side-by-side scores across reviewers per criterion to align the team before a cycle. |
| R-COMMENT | **Team discussion** | Threaded comments and @mentions on a candidate. |
| R-TAG | **Tags & Talent Pool** | Tag candidates ("strong – next cycle"), keep a searchable talent pool across cycles, and invite them to a new cycle in one click. |
| R-WA | **WhatsApp / SMS reminders** | High-open-rate channel for Indian student candidates. |
| R-EXT | **Extension requests** | Candidate requests an extension with a reason, and the Hiring Manager approves/denies. |

### P2 — Future Considerations (design for, don't build)

- **Non-hiring workflows:** reuse the same engine for internal assessments, intern performance reviews, training checkpoints, and client project trials. *Keep "Role/Cycle" naming generic in the DB (`program`, `run`).*
- **Status sync back to careers site** (webhook out: "Under review / Shortlisted / Closed").
- **Video response stage.**
- **Public API & webhooks** (Slack notifications, Notion/Sheets sync).
- **Multi-org / white-label** for Isocode client projects.
- **Peer/group assessment** (group discussion rounds for BDI).

---

## 7. User Stories

### Workspace Admin / Hiring Manager
1. As a hiring manager, I want to build a workflow from reusable stage blocks so that each role gets the right evaluation without engineering help.
2. As an admin, I want to clone last cycle's setup so that launching the next intake takes minutes, not days.
3. As a hiring manager, I want to set an auto-advance threshold on the quiz so that I only manually review borderline candidates.
4. As a hiring manager, I want to filter candidates by aggregate score and stage so that I can shortlist the top N quickly.
5. As a hiring manager, I want to bulk-reject with a delayed, templated email so that candidates are informed respectfully without manual work.
6. As an admin, I want an audit log of decisions so that we can explain any outcome if a candidate asks.
7. *Edge:* As a hiring manager, I want to edit a typo in a live task brief without breaking existing submissions.
8. *Edge:* As an admin, I want to be warned before deleting a stage that already has submissions.

### Reviewer
9. As a reviewer, I want a queue of only my pending submissions so that I know exactly what's left.
10. As a reviewer, I want the submission and rubric side by side so that I can score without switching tabs.
11. As a reviewer, I want blind review so that college names don't bias my scoring.
12. As a reviewer, I want AI-drafted rubric notes I can edit (P1) so that I spend my time judging, not summarizing.
13. *Edge:* As a reviewer, I want to see integrity signals (tab switches, similarity matches) so that I can investigate suspicious submissions.
14. *Empty state:* As a reviewer with nothing assigned, I want to see "Queue clear" and when the next deadline closes.

### Candidate
15. As a shortlisted candidate, I want an email with my login ID and a temporary password so that I can get into the workspace right away. Then I'll set my own password.
15a. As a candidate shortlisted for SDE and PM, I want to see only those two roles with separate progress, so that I know exactly what to complete for each.
15b. As an admin, I want to bulk-invite the shortlist from a CSV so that 100+ candidates get access in minutes.
16. As a candidate, I want a single page showing where I am and what's next so that I'm never unsure of my status.
17. As a candidate, I want deadline reminders so that I don't miss a stage.
18. As a candidate, I want my form progress saved automatically so that a dropped connection doesn't cost me my answers.
19. As a candidate, I want to resubmit my task before the deadline so that I can fix a mistake.
20. *Edge:* As a candidate whose assessment timer ran out mid-answer, I want my partial answers saved and submitted.
21. *Edge:* As a candidate, I want to request deletion of my data.

---

## 8. Key Screens (for the design phase)

**Team side:** Dashboard (open cycles, pending reviews, deadlines) · Roles & Cycles list · Workflow Builder · Form/Assessment Builder · Question Bank · Rubric Builder · Pipeline (Kanban + Table) · Candidate Profile (timeline) · Review Queue (split view) · Email Templates · Analytics (P1) · Settings (team, permissions, retention, branding) · Audit Log.

**Candidate side:** Login (email + password) · First-login "Create your password" · Onboarding & consent · Dashboard of shortlisted roles only (one card per role, progress tracker) · Role space · Form stage · Timed Assessment (with timer & instructions/consent screen) · Task Submission (brief + uploader + version history) · Status/Result pages · Closed/expired states.

---

## 9. Success Metrics

**Leading (first cycle, measured weekly)**

| Metric | Target | Stretch |
|---|---|---|
| Application form completion (started → submitted) | ≥ 65% | 80% |
| Stage completion (unlocked → submitted), per stage | ≥ 70% | 85% |
| Median reviewer time per submission | ≤ 10 min | ≤ 6 min |
| Median time from submission to decision | ≤ 5 days | ≤ 3 days |
| Submissions reviewed within SLA (5 days) | ≥ 90% | 100% |
| Platform errors blocking a candidate (support tickets) | < 2% of candidates | < 0.5% |

**Lagging (per cycle / quarter)**

| Metric | Target |
|---|---|
| Time-to-hire (cycle open → offers accepted) | ≤ 4 weeks |
| Candidate CSAT (post-cycle survey) | ≥ 4.0/5 |
| Interns rated "meets/exceeds" at 30-day check-in (assessment predictive validity) | ≥ 80% |
| Time to launch a new cycle from template | < 30 min |
| Cycles run with zero spreadsheet use | 100% |

*Measurement: product events (stage_unlocked, submission_created, review_submitted, decision_made) in Postgres, with an analytics view in R-ANLY.*

---

## 10. Open Questions

| # | Question | Owner | Blocking? |
|---|---|---|---|
| Q1 | ~~Volume?~~ **Answered:** hiring 10 BDI, 4–5 SDE, 4–5 PM. Applicant volume assumed at a few hundred per role (§11). This is well within a single small deployment. | — | Resolved |
| Q2 | Hard date for Cycle 1 opening? Still being decided. The P0 scope assumes ~6–7 weeks of build (§12). | Stakeholder | **Yes** |
| Q3 | ~~Stack?~~ **Answered:** Google Cloud. Recommended stack in §13. Needs eng sign-off. | Engineering | Resolved |
| Q3b | Does the BDI role need a **group round** (group discussion / team task)? If yes, Custom Step + Interview (P1) covers it in v1, and true group stages are P2. | Hiring Manager (BDI) | No |
| Q4 | ~~Candidate login?~~ **Decided:** login = email, emailed temp password, forced change on first login (R-AUTH). Will any **external** reviewers (non-@isocodelabs.com) need team access? | Stakeholder | No |
| Q4b | ~~Careers intake?~~ **Decided:** shortlisted candidates are invited via single/CSV invite for Cycle 1 (R-INVITE). Can careers.isocodelabs.com export applications as CSV with the role, and is a direct sync wanted later (P1 Applicant inbox)? | Engineering | No |
| Q4c-2 | Who does the initial shortlisting from careers applications, and against what criteria? This decides whether the P1 Applicant inbox needs its own scoring. | Stakeholder | No |
| Q4c | Which interviewers' Google Calendars should the workspace read and write? This needs a Workspace admin to approve domain-wide delegation for the Calendar scope. | Stakeholder / IT | Yes |
| Q5 | Are SDE coding rounds in-platform (R-CODE) or GitHub-repo take-homes for Cycle 1? | Hiring Manager (SDE) | No — Task Submission covers repos |
| Q6 | ~~Interviews in platform?~~ **Answered:** scheduling + invites in the workspace (R-INTV); selection happens on calls outside it. | — | Resolved |
| Q7 | AI review: acceptable to send candidate submissions to Claude API? Must be disclosed in the privacy notice. | Legal / Stakeholder | No (P1) |
| Q8 | Retention period for rejected candidates' data? | Legal | No |
| Q9 | Should candidates see their scores or feedback after rejection? | Stakeholder | No |
| Q10 | **Proposed:** Amazon SES (or ZeptoMail) on `mail.isocodelabs.com`, Reply-To `hiring@isocodelabs.com` (R-COMM). Needs DNS access to add SPF/DKIM/DMARC, plus 1–2 weeks of warm-up before Cycle 1. | Engineering | Yes, before launch |
| Q11 | Brand/design system for the portal: the "design skill provided" is to be applied per role brief. Confirm the base tokens. | Design | No |

---

## 11. Role-Specific Configuration (to be filled per role)

Each role is **pure configuration** on the platform: no role-specific code. Placeholders until briefs arrive:

| | SDE Intern | PM Intern | Business Development Intern (BDI) |
|---|---|---|---|
| **Seats (Cycle 1)** | 4–5 | 4–5 | 10 |
| Planning assumption | ~40–100 shortlisted & invited | ~40–100 shortlisted & invited | ~80–200 shortlisted & invited |
| Suggested workflow *(after shortlist invite + first login)* | Details Form → Tech Quiz → Take-home (repo) → Review → Interview Scheduling | Details Form → Product Sense Quiz → Case Study (PRD/teardown) → Review → Interview Scheduling | Details Form → Aptitude/Market Quiz → BD/Outreach Task → Review → Interview Scheduling |
| Key deliverables | GitHub repo, deployed link, README | Doc/Figma/Loom walkthrough | Deck/Sheet, sample outreach copy |
| Rubric themes | Correctness, code quality, problem-solving, communication | User empathy, structured thinking, prioritization, clarity | Market insight, creativity, numbers/rigor, persuasion |
| Design brief | *TBD — user to provide* | *TBD — user to provide* | *TBD — user to provide* |

---

## 12. Timeline & Phasing

| Phase | Scope | Est. |
|---|---|---|
| **0. Foundations** | GCP project, CI/CD, auth, config-driven data model (§5, §13), storage, email infra, design system tokens | 1 wk |
| **1. MVP (Cycle 1 ready)** | All P0, including shortlist invites (single + CSV), temp-password accounts with forced change, role-scoped access, **interview scheduling (Calendar + Meet)**, the email setup, security requirements (R-SEC), and the §6A Customization Engine (tracks, custom stages/fields/statuses, simple rules, composite scoring, versioning). Plus: Roles/Cycles, Workflow Builder, Form/Assessment/Task stages, Submission Store, Review Queue + Rubrics, Pipeline, Emails, Candidate Portal, Integrity signals, Audit, Privacy | 5–6 wks |
| **1.5 Role setup** | Configure 3 roles from the briefs, apply per-role design, dry-run with internal test candidates | 1 wk |
| **2. Fast follow** | AI review assistant, Analytics, Interview scheduling, Talent pool, Calibration | 3–4 wks |
| **3. Platform** | Coding stage, conditional workflows, webhooks/Slack, non-hiring workflows | Later |

**Dependencies:** DNS for workspace.isocodelabs.com and email sender domain (Q10); Google Workspace OAuth app; object storage bucket; role briefs and design inputs from the Isocode team.

**Critical path risk:** the Workflow Builder + Review Queue. If Cycle 1 dates are tight, ship the builder as an admin-only config screen first and polish the visual drag-and-drop later. Candidates never see it.

---

## 13. Technical Architecture (Google Cloud) — Recommendation

**Sizing:** a few thousand applicants per year, ~10–20 team users, and spiky traffic around deadlines. Optimize for **low ops, low idle cost, and fast iteration**, not massive scale. One app, one database, managed services everywhere.

### 13.1 Recommended stack

| Layer | Choice | Why |
|---|---|---|
| **App (UI + API)** | **Next.js (App Router, TypeScript)**, one codebase serving the team app, candidate portal and API routes | One deploy, server-side rendering for fast mobile portal pages, huge ecosystem |
| **Compute** | **Cloud Run** (container, min-instances 0–1, region `asia-south1` Mumbai) | Serverless, scales to zero, handles deadline spikes, India latency + data residency |
| **Database** | **Cloud SQL for PostgreSQL 16** (small shared-core tier → scale up if needed), private IP, automated backups + PITR | Relational core (candidates, applications, reviews) + **JSONB** for flexible configs |
| **ORM / migrations** | **Drizzle ORM** (or Prisma) | Type-safe queries, versioned migrations |
| **File storage** | **Cloud Storage** bucket (private), uploads via **signed URLs** directly from browser | No file bytes through the app server; signed URLs that expire |
| **Auth** | **Auth.js (NextAuth)**: Google OAuth restricted to `@isocodelabs.com` for team. **Email + password (Argon2id) for candidates: emailed temp password, forced change on first login (`must_change_password` flag checked in middleware).** Sessions in Postgres. | Simple, no per-user cost, full control of branded login emails |
| **Calendar & Meet** | **Google Calendar API** (domain-wide delegated service account, scoped to the interviewer calendars) for free/busy + event creation with `conferenceData` (Meet link) | Native to your Google Workspace. No Calendly subscription needed. |
| **Intake** | Admin invite + CSV import (P0). Signed webhook from careers.isocodelabs.com into an Applicant inbox (P1). | Works on day one whatever the careers site's stack is |
| **Background jobs** | **Cloud Tasks** (email queue, delayed rejections, AI scoring jobs) + **Cloud Scheduler** (deadline reminders, auto-submit sweeps, retention purge) | Managed retries, delayed execution, no worker servers to run |
| **Email** | **Amazon SES** + **React Email** templates (alt: Zoho ZeptoMail) from `hiring@mail.isocodelabs.com`, Reply-To `hiring@isocodelabs.com`, SPF/DKIM/DMARC. Full detail in R-COMM. | Great deliverability, templates in code, webhooks for bounces/opens |
| **WhatsApp (P1)** | WhatsApp Business Cloud API via Interakt/Gupshup/AiSensy | Highest reach for Indian students |
| **Admin MCP server (P0)** | Official **MCP TypeScript SDK**, Streamable HTTP transport, mounted in the same Cloud Run service at `/mcp`; OAuth 2.1 authorization layered on the existing Google SSO; tools call the same internal modules as the UI (no separate business logic) | One tool layer powers Claude Desktop/claude.ai/Claude Code and the in-app panel |
| **AI (P1)** | **Claude (Sonnet 5.5) via Vertex AI** | Billed through GCP, data stays in your cloud account, strong at rubric-based evaluation of long docs/code |
| **Secrets** | **Secret Manager** | No secrets in env files or repo |
| **CI/CD** | GitHub → **Cloud Build** (or GitHub Actions + Workload Identity) → Artifact Registry → Cloud Run; preview env per PR (optional) | Push-to-deploy, no long-lived keys |
| **Domain** | DNS `workspace.isocodelabs.com` → **Cloud Run domain mapping** (or external HTTPS Load Balancer + managed cert + **Cloud Armor** for rate limiting/WAF) | Managed TLS; Load Balancer + Cloud Armor recommended once apply links go public |
| **Observability** | Cloud Logging + Error Reporting + Uptime checks; **Sentry** for front-end errors | Know when a candidate hits an error *before* they email you |
| **Product analytics** | Events table in Postgres (feeds §9 metrics) + optional **PostHog** (funnels, session replay on apply flow) | Funnel drop-off on forms is a key metric |
| **UI kit** | Tailwind CSS + **shadcn/ui**, **dnd-kit** (builder & Kanban), **Tiptap** (rich text briefs), **TanStack Table** (pipeline table), **React Hook Form + Zod** (dynamic forms) | Fast to build, fully themeable to the Isocode design system / per-role briefs |
| **Code assessments (P1)** | Self-hosted **Judge0** on Cloud Run (sandboxed), or a GitHub-repo + CI-check approach first | Avoid building a code sandbox until needed |
| **Malware scan (P1)** | ClamAV on Cloud Run triggered by GCS upload event | Candidates upload ZIPs; reviewers download them |

### 13.2 How the "everything is configurable" design maps to the data model

Core tables are relational; **all configuration is versioned JSON validated by Zod schemas**:

```
workflows(id, cycle_id, name, …)
workflow_versions(id, workflow_id, version, config JSONB, created_by, created_at)   ← stages, rules, weights
stage_templates(id, type, config JSONB)          rubric_templates(id, config JSONB)
form_schemas(id, version, fields JSONB)          email_templates(id, scope, scope_id, config JSONB)
custom_field_defs(id, key, type, options JSONB)  statuses / tags / reasons (per org or workflow)
candidates(id, email, profile JSONB custom fields) applications(id, candidate_id, workflow_version_id, current_stage_key, status, composite_score)
submissions(id, application_id, stage_key, version, data JSONB, files[], submitted_at, late)
reviews(id, submission_id, reviewer_id, scores JSONB, recommendation, notes)
decisions(id, application_id, stage_key, action, rule_id?, actor_id?, reason)
events(id, type, entity, payload JSONB, at)       audit_log(…)
```

- **Rule engine (C4):** a small, pure TypeScript evaluator. Input: application + stage results. Output: an action list. It runs when a submission, review, or decision is saved, and again in **dry-run** mode for previews. Rules live inside `workflow_versions.config`.
- **Stage types as plugins:** each type (`form`, `quiz`, `task`, `review_gate`, `interview`, `custom`) registers its config schema, candidate UI, reviewer UI, and scoring function. Adding a new stage type later is one module and touches nothing else.
- **Pinning:** `applications.workflow_version_id` pins each candidate to a version, which is what makes C9 safe.

### 13.3 Security & privacy essentials
- Least-privilege service account for Cloud Run. Cloud SQL is reachable only over private IP. The bucket has no public access.
- Row-level authorization checks in one server-side policy layer (role × workflow assignment), not scattered through UI code.
- Rate limiting on login, change-password and reset endpoints (Cloud Armor or app-level).
- Data region: `asia-south1` for DPDP comfort. Daily backups go to a second region.

### 13.4 Rough monthly cost (Cycle 1 scale)
| Item | Est. |
|---|---|
| Cloud Run (scales to zero) | ~$0–15 |
| Cloud SQL Postgres (small tier + backups) | ~$15–40 |
| Cloud Storage + egress | ~$1–5 |
| Load Balancer + Cloud Armor (optional) | ~$20–25 |
| Amazon SES (~$0.10 per 1,000 emails) | < $1 |
| Claude via Vertex (P1, usage-based) | ~$10–50 per cycle |
| **Total** | **~$40–130 / month** |

*Estimates only. Check the GCP pricing calculator before committing.*

### 13.5 Alternatives considered
- **Firebase (Firestore + Firebase Auth):** faster to start, but weak for relational queries (pipelines, filters, analytics, joins across reviews). Rejected for the core DB. Identity Platform remains an option if auth needs grow.
- **Supabase on GCP:** good developer experience, but it's another vendor outside GCP. Cloud SQL keeps everything in one bill and one IAM.
- **GKE / Kubernetes:** overkill at this scale. Revisit only if multi-tenant SaaS (P2) happens.
- **Off-the-shelf ATS (Zoho Recruit, Lever, Ashby) + Google Forms:** quickest path, but weak on custom assessments, rubric-based task review and reuse for non-hiring workflows, and it doesn't build an Isocode-owned asset.

---

## 14. Additional Feature Ideas (beyond the brief)

Ranked by value-for-effort for Isocode's process. **Bold = recommend for MVP or Cycle 1 fast follow.**

### For candidates (better experience → better completion → better hires)
| Idea | Why it matters | Priority |
|---|---|---|
| **"What to expect" journey page** | After the first-login password change, the candidate sees every stage, the time each takes, and deadlines. This reduces drop-off and support emails. | P0 |
| **Pre-assessment check & practice question** | Timer rules, a sample question, and a browser/connection check before a timed test. Fewer "my test crashed" disputes. | P0 |
| **In-portal Help / FAQ + "Contact hiring team"** | Queries arrive as tickets on the candidate's timeline instead of scattered emails | P1 |
| Accessibility accommodations | Admin can grant extra time per candidate (disability, connectivity). Logged. | P1 |
| Stage feedback micro-survey | One question after each stage ("How clear was this task?", 1–5). Measures candidate CSAT (G4) and finds confusing tasks. | P1 |
| Light feedback for rejected candidates | Optional 1–2 line strengths/improvement note in the "not progressing" email. Builds brand among students. | P2 |

### For the team (faster, fairer decisions)
| Idea | Why it matters | Priority |
|---|---|---|
| **Founder / Hiring dashboard** | One screen per role: applicants → in progress → reviewed → shortlisted → interviews booked vs. seats (10 / 4–5 / 4–5). Shows when you have enough of a pipeline. | P0 (basic), P1 (full analytics) |
| **Candidate compare view** | 2–4 candidates side by side for shortlisting (in R-INTV) | P0 |
| **AI Interview Brief** | Claude summarizes each shortlisted candidate (strengths, concerns, questions to probe) on the Interview Brief page. Interviewers prep in 2 minutes. | P1 |
| **AI-generated content detection + plagiarism similarity** | Flags tasks that look copied between candidates or fully AI-written. Shown as a signal only. | P1 |
| **Slack / Google Chat notifications** | "12 new submissions in SDE Task", "3 interviews booked today" | P1 |
| Reviewer SLA nudges | Reminds reviewers with submissions older than X days. Escalates to the HM. | P1 |
| Saved views & smart filters | e.g. "SDE · Task submitted · score ≥ 4 · not reviewed". Shareable across the team. | P1 |
| Assessment item analytics | Which quiz questions are too easy or hard, or don't separate good from weak candidates. Improves the question bank each cycle. | P2 |

### Operational & platform
| Idea | Why it matters | Priority |
|---|---|---|
| **Staging environment + "test candidate" mode** | Admins run through a workflow as a fake candidate before going live. Test data is excluded from analytics. | P0 |
| **Bulk CSV import/export** | Fallback intake, offline analysis, backups | P0 |
| Talent pool across cycles | Strong "not this time" candidates get invited to the next cycle in one click | P1 |
| Referral & source tracking | UTM / referral code passed from the careers site. Shows which colleges/channels produce the best candidates. | P1 |
| Status sync to careers site | Candidate sees status on the careers site too | P2 |
| Reuse engine for internal assessments | Intern performance reviews, training checkpoints, client trial tasks (same workflows, different "program" type) | P2 |
