import {
  desc,
  eq,
  applications,
  candidates,
  emailTemplates,
  roles,
  users,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";
import { emailLogFor } from "../email/outbox";
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_KEYS,
  checkTemplateEdit,
  type TemplateKey,
} from "../email/templates";

/** Everything the team sees about one candidate. Hiring managers see only their roles. */
export async function getCandidateDetail(db: Db, actor: Actor, candidateId: string) {
  const [row] = await db
    .select({
      candidate: candidates,
      email: users.email,
      mustChangePassword: users.mustChangePassword,
      tempPasswordExpiresAt: users.tempPasswordExpiresAt,
      passwordChangedAt: users.passwordChangedAt,
      userId: users.id,
    })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(candidates.id, candidateId));
  if (!row) return null;
  const apps = await db
    .select({ app: applications, roleTitle: roles.title })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(eq(applications.candidateId, candidateId))
    .orderBy(desc(applications.invitedAt));
  const visible = apps.filter(({ app }) => {
    try {
      assertCan(actor, "read", {
        type: "workflow",
        roleId: app.roleId,
        workflowId: app.workflowId,
      });
      return true;
    } catch {
      return false;
    }
  });
  if (visible.length === 0) return null;
  return {
    ...row,
    applications: visible.map(({ app, roleTitle }) => ({
      id: app.id,
      roleTitle,
      status: app.status,
      invitedAt: app.invitedAt,
    })),
    emails: await emailLogFor(db, row.userId),
  };
}

export async function listEmailTemplates(db: Db, actor: Actor) {
  assertCan(actor, "manage", { type: "team_settings" });
  const custom = new Map((await db.select().from(emailTemplates)).map((t) => [t.key, t]));
  return TEMPLATE_KEYS.map((key) => {
    const c = custom.get(key);
    return {
      key,
      description: DEFAULT_TEMPLATES[key].description,
      subject: c?.subject ?? DEFAULT_TEMPLATES[key].subject,
      body: c?.body ?? DEFAULT_TEMPLATES[key].body,
      customised: !!c,
    };
  });
}

export async function saveEmailTemplate(
  db: Db,
  actor: Actor,
  input: { key: TemplateKey; subject: string; body: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  assertCan(actor, "manage", { type: "team_settings" });
  if (!TEMPLATE_KEYS.includes(input.key)) return { ok: false, error: "Unknown template" };
  if (!input.subject.trim() || !input.body.trim())
    return { ok: false, error: "Subject and body can't be empty." };
  if (input.subject.length > 200 || input.body.length > 10_000)
    return { ok: false, error: "Too long." };
  const problem = checkTemplateEdit(input.key, input.subject, input.body);
  if (problem) return { ok: false, error: problem };
  await db
    .insert(emailTemplates)
    .values({ key: input.key, subject: input.subject, body: input.body, updatedBy: actor.userId })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: { subject: input.subject, body: input.body, updatedBy: actor.userId },
    });
  await audit(db, {
    actorUserId: actor.userId,
    action: "email_template_saved",
    entity: "email_template",
    entityId: input.key,
  });
  return { ok: true };
}

export async function resetEmailTemplate(db: Db, actor: Actor, key: TemplateKey) {
  assertCan(actor, "manage", { type: "team_settings" });
  await db.delete(emailTemplates).where(eq(emailTemplates.key, key));
  await audit(db, {
    actorUserId: actor.userId,
    action: "email_template_reset",
    entity: "email_template",
    entityId: key,
  });
}
