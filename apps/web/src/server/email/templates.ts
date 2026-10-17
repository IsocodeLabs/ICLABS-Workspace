/**
 * Candidate and team emails. Wording is plain text with {{variables}}; admins can override
 * subject and body per key (email_templates table). Blank lines separate paragraphs, and a
 * line `[[button:Label|{{url_var}}]]` renders a call-to-action button.
 */

export const TEMPLATE_KEYS = [
  "welcome",
  "role_added",
  "password_changed",
  "account_locked",
  "password_reset",
  "login_code",
  "stage_unlocked",
  "deadline_reminder",
  "submission_received",
  "not_progressing",
  "interview_scheduled",
  "interview_reminder",
  "interview_updated",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

/** Variables that carry secrets: only these templates may use them, and they're never stored. */
export const SECRET_VARS: Record<string, readonly TemplateKey[]> = {
  temp_password: ["welcome"],
  reset_url: ["password_reset"],
  code: ["login_code"],
};

export type Template = { subject: string; body: string; description: string };

export const DEFAULT_TEMPLATES: Record<TemplateKey, Template> = {
  welcome: {
    description: "First invite: login ID and temporary password",
    subject: "You're shortlisted for {{roles}} at Isocode Labs: your workspace login",
    body: `Hi {{first_name}},

Congratulations! You've been shortlisted for {{roles}} at Isocode Labs. Your next steps happen in the Isocode Workspace.

Login ID: {{email}}
Temporary password: {{temp_password}}

The temporary password works for 72 hours. You'll choose your own password when you first sign in. The workspace works on a laptop or desktop.

[[button:Sign in to the workspace|{{login_url}}]]

Questions? Just reply to this email.

The Isocode Labs hiring team`,
  },
  role_added: {
    description: "An existing candidate is shortlisted for another role",
    subject: "You're also shortlisted for {{role}} at Isocode Labs",
    body: `Hi {{first_name}},

Good news: you've also been shortlisted for {{role}}. It's now on your workspace dashboard, next to your other roles. Sign in with your existing password.

[[button:Open your dashboard|{{login_url}}]]

The Isocode Labs hiring team`,
  },
  password_changed: {
    description: "Confirmation after a password change",
    subject: "Your Isocode Workspace password was changed",
    body: `Hi {{first_name}},

Your workspace password was just changed. If this was you, there's nothing to do.

If it wasn't you, reply to this email straight away and we'll lock your account.

The Isocode Labs hiring team`,
  },
  account_locked: {
    description: "Too many wrong passwords",
    subject: "Your Isocode Workspace sign-in is paused for 15 minutes",
    body: `Hi {{first_name}},

There were too many wrong password attempts on your account, so sign-in is paused for 15 minutes.

If this wasn't you, reply to this email and we'll help secure your account.

The Isocode Labs hiring team`,
  },
  password_reset: {
    description: "Forgot-password link",
    subject: "Reset your Isocode Workspace password",
    body: `Hi {{first_name}},

Use the button below to choose a new password. The link works once and expires in 30 minutes.

[[button:Choose a new password|{{reset_url}}]]

If you didn't ask for this, you can ignore this email.

The Isocode Labs hiring team`,
  },
  login_code: {
    description: "Team sign-in code (sent after the password)",
    subject: "Your Isocode Workspace sign-in code",
    body: `Hi {{first_name}},

Your sign-in code is {{code}}

It works once and expires in 10 minutes. If you didn't just sign in, change your password, since someone else knows it.

The Isocode Labs hiring team`,
  },
  stage_unlocked: {
    description: "A new stage is open for the candidate",
    subject: "{{role}}: your next step, {{stage}}, is open",
    body: `Hi {{first_name}},

Your next step for {{role}} is ready: {{stage}}.

Please complete it by {{deadline}}.

[[button:Start {{stage}}|{{stage_url}}]]

The Isocode Labs hiring team`,
  },
  deadline_reminder: {
    description: "24 hours before a stage closes",
    subject: "Reminder: {{stage}} for {{role}} closes {{deadline}}",
    body: `Hi {{first_name}},

A quick reminder that {{stage}} for {{role}} closes on {{deadline}}.

[[button:Continue|{{stage_url}}]]

The Isocode Labs hiring team`,
  },
  submission_received: {
    description: "After the candidate submits a stage",
    subject: "We've received your {{stage}} for {{role}}",
    body: `Hi {{first_name}},

Thanks, we've received your {{stage}} for {{role}}. The team will review it and you'll hear from us about the next step.

The Isocode Labs hiring team`,
  },
  not_progressing: {
    description: "The candidate won't move forward for a role",
    subject: "Your application for {{role}} at Isocode Labs",
    body: `Hi {{first_name}},

Thank you for the time and effort you put into the {{role}} process. After careful review, we won't be moving forward with your application this time.

We were glad to see your work and hope you'll apply again in a future cycle.

The Isocode Labs hiring team`,
  },
  interview_scheduled: {
    description: "Interview invite with time and link",
    subject: "Interview for {{role}}: {{when}}",
    body: `Hi {{first_name}},

You're invited to the {{round}} for {{role}}.

When: {{when}}
Where: {{where}}

A calendar invite is attached. {{instructions}}

The Isocode Labs hiring team`,
  },
  interview_reminder: {
    description: "Before the interview",
    subject: "Reminder: your {{role}} interview is {{when}}",
    body: `Hi {{first_name}},

A reminder that your {{round}} for {{role}} is at {{when}}.

Where: {{where}}

The Isocode Labs hiring team`,
  },
  interview_updated: {
    description: "Interview moved or cancelled",
    subject: "Update to your {{role}} interview",
    body: `Hi {{first_name}},

{{update}}

The Isocode Labs hiring team`,
  },
};

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Variables used in a template body or subject, e.g. ["first_name", "login_url"]. */
export function templateVariables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]!))];
}

/** Rejects edits that would leak a secret into the wrong email. */
export function checkTemplateEdit(key: TemplateKey, subject: string, body: string): string | null {
  for (const v of templateVariables(`${subject}\n${body}`)) {
    const allowed = SECRET_VARS[v];
    if (allowed && !allowed.includes(key)) return `{{${v}}} can't be used in this email.`;
  }
  if (templateVariables(subject).some((v) => SECRET_VARS[v]))
    return "Secrets can't go in the subject line.";
  return null;
}

const fill = (text: string, vars: Record<string, string>, transform: (s: string) => string) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => transform(vars[name] ?? ""));

const isSafeUrl = (u: string) => /^https?:\/\//.test(u);

export type RenderedEmail = { subject: string; text: string; html: string };

/** Renders plain-text and HTML versions. Every value is escaped; only http(s) links render. */
export function renderEmail(
  template: Pick<Template, "subject" | "body">,
  vars: Record<string, string>,
): RenderedEmail {
  const subject = fill(template.subject, vars, (s) => s.replace(/[\r\n]+/g, " ")).trim();
  const paragraphs = template.body.trim().split(/\n\s*\n/);

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  for (const p of paragraphs) {
    const button = p.trim().match(/^\[\[button:([^|\]]+)\|([^\]]+)\]\]$/);
    if (button) {
      const label = fill(button[1]!, vars, (s) => s);
      const url = fill(button[2]!, vars, (s) => s).trim();
      textParts.push(`${label}: ${url}`);
      if (isSafeUrl(url)) {
        htmlParts.push(
          `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#6d4aff;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:12px">${escapeHtml(label)}</a></p>`,
        );
      }
      continue;
    }
    textParts.push(fill(p, vars, (s) => s));
    htmlParts.push(
      `<p style="margin:0 0 16px">${fill(escapeHtml(p), vars, (s) => escapeHtml(s)).replaceAll("\n", "<br>")}</p>`,
    );
  }

  const html = `<!doctype html><html><body style="margin:0;background:#f7f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#16162a">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
<div style="height:6px;width:64px;border-radius:6px;background:linear-gradient(135deg,#6d4aff,#22d3ee);margin-bottom:20px"></div>
<div style="background:#ffffff;border:1px solid #e6e6f0;border-radius:16px;padding:28px;font-size:16px;line-height:1.55">${htmlParts.join("\n")}</div>
<p style="color:#5b5b72;font-size:13px;margin-top:16px">Isocode Labs · workspace.isocodelabs.com</p>
</div></body></html>`;
  return { subject, text: textParts.join("\n\n"), html };
}
