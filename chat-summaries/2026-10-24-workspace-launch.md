# Workspace build and launch — conversation summary

Covers Oct 2026 (through 24 Oct). Product: **workspace.isocodelabs.com**, the Isocode Labs hiring workspace. Repo: IsocodeLabs/ICLABS-Workspace (careers site: IsocodeLabs/ICLabs-Main).

## Where things run

- **Google Cloud, Mumbai (asia-south1)**: Cloud Run `iclabs-workspace` (min 1 instance) behind a global load balancer (IP 136.68.44.149, Google-managed certificate). Cloud SQL Postgres `iclabs-workspace-mum`. Secrets in Secret Manager.
- Push to `main` → Cloud Build → migrate job (`workspace-migrate`) → deploy (~5 min).
- Old US copy retired: US service, migrate job, workspace DB and DB user deleted (backup in the `-sql-transfer` bucket). `isocode-sql` (US) kept: it runs the main website.
- Cloud Scheduler (Mumbai): `workspace-email-outbox` and `workspace-stages` every minute, `workspace-retention` daily at 3 AM IST.
- DNS on Cloudflare (Aryan's account). `workspace` = A record → LB, DNS only.

## Email

- **Amazon SES** (ap-south-1), domain `mail.isocodelabs.com` verified with DKIM; production access approved (50,000/day). Bounce/complaint webhook via SNS → `/api/webhooks/ses`.
- Sending keys from IAM user `workspace-ses-sender` (send-only policy), stored in Secret Manager. `EMAIL_TRANSPORT=ses`, `TEAM_LOGIN_OTP=true` (team sign-in emails a code).
- Emails use the workspace look: black-liquid header image (`/email/liquid-header.png`), white card, login details in a grey box, black button.
- Cloudflare Email Routing:
  - `hr@isocodelabs.com` and `hiring@isocodelabs.com` → worker `hr-forward` → both dex.mishra@gmail.com and Aryan's Gmail.
  - `hiring@mail.isocodelabs.com` → dex.mishra@gmail.com (Google Account made for the profile photo).
  - Catch-all → Aryan.

## Features added in this chat

- Admin-only "Ask Claude" and MCP.
- Team sign-in: email + password + emailed code; initial admins devansh@ and aryan@.
- Design: white "liquid glass" theme, WebGL black-liquid background (adaptive, never laggy), simpler navigation, Home page with "needs your attention".
- IL logo (traced vector) in the top bar, sign-in card and browser tab; profile picture `isocode-hiring-avatar.png`.
- Careers → workspace: on the careers Screening page, select Shortlisted applicants → **Invite to workspace** (signed HMAC request, shared secret `careers-workspace-secret`). Already-invited people can be sent their login again.
- Skills: `.claude/skills/workspace-design` and `.claude/skills/workspace-liquid-background` (also packaged as `.skill` files in the repo root).
- MCP connector `isocode` added to Claude Code (needs a one-time Google sign-in via `/mcp`).

## Issues fixed from candidate emails

- **Temporary password "incorrect"**: sign-in now forgives pasted spaces/line breaks, look-alike dashes, missing dashes, and a phone-capitalised first letter (temp passwords only). Login page has "Show password". 27 stuck candidates got fresh logins.
- **Last step shows "Now" after submitting**: a submitted step now shows Done.
- **Pipeline**: archived "(unused duplicate)" roles hidden; switching tracks always loads the picked board.
- Cron failing because Google Calendar isn't set up: interview reminders are skipped instead of breaking deadlines.

## Still open

- "Can't click/type in Step 1" (Bhavana, Priyanshu — Product Management): data looks fine; not reproduced yet.
- Krish Arora asked for a deadline extension to 28–29 Oct (team decision).
- Himanshu asked whether Isocode Labs is legitimate (add the team on LinkedIn).
- Google Calendar not connected (needed for interview invites).
- Cloud Armor needs a paid billing account (free trial blocks it).
- Old secret `workspace-database-url` still exists (unused; delete by hand).
- Reply to candidates who emailed that new logins were sent.

## Working notes

- Another contributor (greengingerguava) also pushes to main; pull before changing code.
- One-off production queries/fixes run through the `workspace-migrate` Cloud Run job.
- Never put passwords, keys or codes in chat or commits.
