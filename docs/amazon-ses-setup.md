# Amazon SES Setup — workspace.isocodelabs.com

**Goal:** send transactional hiring emails from `Isocode Hiring <hiring@mail.isocodelabs.com>`. Replies go to `hiring@isocodelabs.com` (a Google Workspace group). The app runs on Google Cloud Run.

**Region:** `ap-south-1` (Mumbai). Use the same region everywhere below.
**Time needed:** ~1 hour of work, plus up to 24–48h waiting for DNS and production approval. **Start at least 2 weeks before Cycle 1** so there's time to warm up.

> Console labels and quotas change occasionally. If a menu name differs slightly, search the SES console for the step's keyword.

---

## Step 0 — AWS account hygiene (10 min)
1. Create or sign in to the AWS account. Use a shared company email (e.g. `aws@isocodelabs.com`), not a personal one.
2. **Enable MFA on the root user.** Then stop using root.
3. Create an admin login for daily use: IAM Identity Center user, or an IAM user with MFA.
4. Billing → **Budgets** → create a $10/month budget with an email alert. (SES itself will cost under $1/month. The budget is a tripwire for misuse.)

## Step 1 — Verify the sending domain (15 min + DNS wait)
SES console (region **ap-south-1**) → **Configuration → Identities → Create identity**
- Identity type: **Domain** → `mail.isocodelabs.com`
- ✅ **Use a custom MAIL FROM domain** → `bounce.mail.isocodelabs.com`
  - Behavior on MX failure: *Use default MAIL FROM domain*
- **Verifying your domain:** **Easy DKIM**, **RSA_2048_BIT**. ✅ Publish DNS records to Route 53: *untick*, since you'll add them at your own DNS provider.
- Create identity. SES now shows the DNS records to add.

## Step 2 — Add DNS records at your DNS provider
Add these where `isocodelabs.com` DNS is managed (GoDaddy, Cloudflare, Google Domains/Squarespace, etc.). Copy the exact values from the SES console. The values below show the shape.

| # | Type | Host / Name | Value | Purpose |
|---|---|---|---|---|
| 1–3 | CNAME | `<token1>._domainkey.mail.isocodelabs.com` (×3 tokens) | `<token1>.dkim.amazonses.com` | **DKIM** signing |
| 4 | MX | `bounce.mail.isocodelabs.com` | `10 feedback-smtp.ap-south-1.amazonses.com` | Custom MAIL FROM (bounces) |
| 5 | TXT | `bounce.mail.isocodelabs.com` | `v=spf1 include:amazonses.com ~all` | **SPF** for MAIL FROM |
| 6 | TXT | `_dmarc.mail.isocodelabs.com` | `v=DMARC1; p=none; rua=mailto:dmarc-reports@isocodelabs.com; adkim=s; aspf=r; pct=100` | **DMARC** (start in monitor mode) |

**Notes:**
- On Cloudflare, set the CNAMEs to **DNS only** (grey cloud), not proxied.
- Some providers auto-append the root domain. In that case enter the host as `<token1>._domainkey.mail`, not the full name.
- **Don't touch** the existing root `isocodelabs.com` SPF/MX records (Google Workspace mail keeps working as is).
- Create the `dmarc-reports@isocodelabs.com` group/inbox, or use a free DMARC report service.
- Back in SES, wait until the identity shows **DKIM: Successful** and **MAIL FROM: Successful**. Usually this takes minutes, sometimes up to 72h.

**After 2 weeks of clean DMARC reports**, tighten record 6 to `p=quarantine`.

## Step 3 — Reply-To inbox (5 min, Google Workspace admin)
- Create a Google Group `hiring@isocodelabs.com` (collaborative inbox) with the hiring team as members. Allow external senders to post.
- The app sets `Reply-To: hiring@isocodelabs.com` on every email, so candidate replies land with humans.

## Step 4 — Configuration set + event tracking (15 min)
**4a. SNS topic**
- SNS console (ap-south-1) → **Topics → Create topic** → Standard → name `ses-workspace-events`.

**4b. Configuration set**
- SES → **Configuration sets → Create set** → name `workspace-transactional`.
  - Reputation metrics: ✅ enabled.
  - Suppression list: use account-level (Step 5).
- Open the set → **Event destinations → Add destination**.
  - Event types: ✅ Send, ✅ Delivery, ✅ Bounce, ✅ Complaint, ✅ Reject, ✅ Rendering failure, ✅ Delivery delay. Open/Click are optional and skipped in v1, since they need a tracking domain and hurt deliverability slightly.
  - Destination: **Amazon SNS** → `ses-workspace-events`.

**4c. Webhook subscription** (do this once the app's endpoint is deployed)
- SNS topic → **Create subscription** → Protocol **HTTPS** → `https://workspace.isocodelabs.com/api/webhooks/ses`.
- The app must:
  1. **verify the SNS message signature** (e.g. the `sns-validator` npm package),
  2. auto-confirm the `SubscriptionConfirmation` message by fetching `SubscribeURL`,
  3. update the email log (delivered / bounced / complained) and the candidate timeline.
- **Hard bounce or complaint** → mark the candidate's email as `undeliverable` and alert the admin in the workspace ("Email to riya@… bounced — check address").

## Step 5 — Suppression list (2 min)
- SES → **Configuration → Suppression list** (account-level) → ensure **Bounces** and **Complaints** are both enabled.
- When an admin corrects a mistyped address, the app sends to the new address. Only remove an address from suppression after it has been verified.

## Step 6 — Request production access (10 min + ~24h)
New SES accounts start in the **sandbox**: they can only send to verified addresses, with a low daily cap.
- SES → **Account dashboard → Request production access**
  - Mail type: **Transactional**
  - Website URL: `https://isocodelabs.com` (or the careers page)
  - Use case description (paste and adapt):
    > Isocode Labs uses SES to send transactional emails from our internal hiring workspace (workspace.isocodelabs.com) to candidates who applied on careers.isocodelabs.com and were shortlisted by our team. Emails include login credentials, assessment deadlines, submission receipts, interview scheduling and status updates. Recipients have explicitly applied and consented. Volume: ~2,000–10,000 emails/month, peaking during hiring cycles. We use a custom MAIL FROM domain with DKIM, SPF and DMARC. Bounces and complaints are consumed via SNS, and failed addresses are suppressed automatically and flagged to our team. No marketing or purchased lists.
  - Additional contacts: the tech lead's email. Preferred language: English.
- Once approved, note your **sending quota** (emails/24h) and **max send rate** (emails/sec) on the dashboard. The app's Cloud Tasks queue is throttled below that rate (start at 5/sec).

## Step 7 — Sending credentials for Cloud Run (20 min)
**Recommended — no long-lived keys (Workload Identity Federation, GCP → AWS):**
1. AWS IAM → **Roles → Create role** → *Web identity* → Identity provider **accounts.google.com**. Audience = the **unique ID** (numeric) of the Cloud Run service account `workspace-app@<gcp-project>.iam.gserviceaccount.com`.
2. Attach this inline policy (sending only, only from our domain):
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ses:SendEmail", "ses:SendRawEmail"],
    "Resource": [
      "arn:aws:ses:ap-south-1:<ACCOUNT_ID>:identity/mail.isocodelabs.com",
      "arn:aws:ses:ap-south-1:<ACCOUNT_ID>:configuration-set/workspace-transactional"
    ],
    "Condition": { "StringLike": { "ses:FromAddress": "*@mail.isocodelabs.com" } }
  }]
}
```
3. The app gets a Google ID token from the Cloud Run metadata server, with audience = the SA unique ID. It then calls `AssumeRoleWithWebIdentity` (the AWS SDK's `fromWebToken` credential provider) and caches the temporary credentials until expiry.

**Simpler fallback:** an IAM user `workspace-ses-sender` with the same policy and an access key.
- Store `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in **GCP Secret Manager**, mounted into Cloud Run. Never put them in the repo or `.env` files.
- Rotate the key every 90 days.

## Step 8 — App integration (developer notes)
- Libraries: **Nodemailer** with its SES transport (`@aws-sdk/client-sesv2`). It handles MIME, so `.ics` interview invites can be attached easily. Templates use **React Email**, rendered to HTML + plain text (always send both).
- Every send includes:
  - `From: Isocode Hiring <hiring@mail.isocodelabs.com>`
  - `Reply-To: hiring@isocodelabs.com`
  - `ConfigurationSetName: workspace-transactional`
  - Email tags: `template=welcome`, `env=prod`, `application_id=…`. These come back in SNS events so they can be matched to the timeline.
- All sends go through **Cloud Tasks** (retries with backoff, throttled to ≤ the SES max rate).
- Welcome emails contain the temp password. **Never log the rendered body**. Log the template name + recipient + message ID only.
- **Staging/dev:** use a separate identity or the SES **mailbox simulator** (`success@simulator.amazonses.com`, `bounce@simulator.amazonses.com`, `complaint@simulator.amazonses.com`) so tests never email real candidates. Add an env guard: outside prod, any recipient not on an allow-list is rewritten to the simulator.

## Step 9 — Test before go-live (30 min)
1. Send a test to the 3 simulator addresses and confirm the bounce/complaint events reach the webhook and show in the app.
2. Send each template to team Gmail, Outlook and a college-domain address. Check it lands in the **inbox**, not Promotions or Spam.
3. Use **mail-tester.com** and aim for **≥ 9/10**. Check that the headers show `dkim=pass`, `spf=pass` and `dmarc=pass`.
4. Check that the `.ics` invite opens correctly in Gmail and Outlook.

## Step 10 — Warm-up & monitoring
- **Warm-up (2 weeks before Cycle 1):** send real but low-risk mail (internal tests, team notifications) at ~20 → 50 → 100/day.
- **Bulk invites:** send in batches of 50–100 spread over an hour, not 500 at once.
- **CloudWatch alarms** (on SES reputation metrics), emailed to the tech lead:
  - Bounce rate > **2%** (AWS reviews accounts at 5%, and may pause sending at 10%)
  - Complaint rate > **0.05%** (AWS reviews at 0.1%)
- Keep templates plain and personal: no link shorteners, few images, the candidate's name in the first line, one clear call to action.

---

### Checklist
- [ ] Root MFA, admin user, $10 budget alert
- [ ] Identity `mail.isocodelabs.com` verified (DKIM + custom MAIL FROM)
- [ ] DNS: 3 DKIM CNAMEs, MAIL FROM MX + SPF TXT, DMARC TXT
- [ ] `hiring@isocodelabs.com` group created
- [ ] SNS topic + configuration set + event destination
- [ ] Account-level suppression for bounces & complaints
- [ ] Production access approved; quota noted
- [ ] IAM role (WIF) or IAM user key in Secret Manager
- [ ] Webhook subscribed and verified; simulator tests pass
- [ ] mail-tester ≥ 9/10; inbox placement checked
- [ ] Warm-up done; CloudWatch alarms live; DMARC → quarantine after 2 clean weeks
