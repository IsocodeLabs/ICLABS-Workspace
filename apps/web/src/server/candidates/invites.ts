import Papa from "papaparse";
import { z } from "zod";
import {
  and,
  desc,
  eq,
  inArray,
  applications,
  candidates,
  cycles,
  roles,
  users,
  workflowVersions,
  workflows,
  type Db,
} from "@iclabs/db";
import { entryNodeId, workflowConfigSchema, type Actor } from "@iclabs/core";
import { createCandidateAccount, issueTempPassword } from "../auth/candidate-auth";
import { assertCan, audit } from "../audit";
import type { EnqueueInput } from "../email/outbox";

export type InviteRow = {
  name: string;
  email: string;
  phone?: string;
  role: string;
  track?: string;
  college?: string;
  gradYear?: number;
  linkedin?: string;
  github?: string;
};

export type RowStatus =
  | { kind: "new" }
  | { kind: "add_role" }
  | { kind: "duplicate"; reason: string }
  | { kind: "invalid"; reason: string };

export type PreviewRow = { line: number; row: InviteRow; status: RowStatus; target?: Target };
type Target = {
  roleId: string;
  roleTitle: string;
  workflowId: string;
  versionId: string;
  entryNodeId: string | null;
};

const rowSchema = z.object({
  name: z.string().trim().min(1, "Name is missing").max(120),
  email: z
    .email("Email looks invalid")
    .max(254)
    .transform((e) => e.trim().toLowerCase()),
  phone: z.string().trim().max(30).optional(),
  role: z.string().trim().toLowerCase().min(1, "Role is missing"),
  track: z.string().trim().max(80).optional(),
  college: z.string().trim().max(200).optional(),
  gradYear: z.coerce.number().int().min(2000).max(2040).optional(),
  linkedin: z.url().max(300).optional(),
  github: z.url().max(300).optional(),
});

const HEADER_ALIASES: Record<string, keyof InviteRow> = {
  name: "name",
  full_name: "name",
  email: "email",
  phone: "phone",
  role: "role",
  role_slug: "role",
  track: "track",
  college: "college",
  grad_year: "gradYear",
  graduation_year: "gradYear",
  linkedin: "linkedin",
  github: "github",
};

/** Parses a careers-site export. Unknown columns are ignored; blank cells become undefined. */
export function parseInviteCsv(text: string): {
  rows: { line: number; data: unknown }[];
  error?: string;
} {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) =>
      h
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_"),
  });
  if (!parsed.meta.fields?.includes("email"))
    return { rows: [], error: 'The CSV needs an "email" column.' };
  if (parsed.data.length > 1000) return { rows: [], error: "Up to 1,000 rows per upload." };
  return {
    rows: parsed.data.map((raw, i) => {
      const data: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        const field = HEADER_ALIASES[k];
        if (field && v?.trim()) data[field] = v.trim();
      }
      return { line: i + 2, data };
    }),
  };
}

/** Where a role's invites go: its newest open round, the named (or default) track, live version. */
async function resolveTarget(
  db: Db,
  roleSlug: string,
  trackName?: string,
): Promise<Target | string> {
  const [role] = await db.select().from(roles).where(eq(roles.slug, roleSlug));
  if (!role) return `Unknown role "${roleSlug}"`;
  const [cycle] = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.roleId, role.id), eq(cycles.status, "open")))
    .orderBy(desc(cycles.createdAt))
    .limit(1);
  if (!cycle) return `${role.title} has no open round`;
  const tracks = await db.select().from(workflows).where(eq(workflows.cycleId, cycle.id));
  const track = trackName
    ? tracks.find((t) => t.name.toLowerCase() === trackName.toLowerCase())
    : (tracks.find((t) => t.isDefault) ?? tracks[0]);
  if (!track) return `No track "${trackName}" in ${role.title}`;
  if (!track.publishedVersionId) return `${role.title} · ${track.name} isn't published yet`;
  const [version] = await db
    .select()
    .from(workflowVersions)
    .where(eq(workflowVersions.id, track.publishedVersionId));
  const config = workflowConfigSchema.parse(version!.config);
  return {
    roleId: role.id,
    roleTitle: role.title,
    workflowId: track.id,
    versionId: version!.id,
    entryNodeId: entryNodeId(config),
  };
}

/** Classifies each row before anything is created, so admins can fix the file first. */
export async function previewInvites(
  db: Db,
  actor: Actor,
  rawRows: { line: number; data: unknown }[],
): Promise<PreviewRow[]> {
  const targetCache = new Map<string, Target | string>();
  const seen = new Set<string>();
  const out: PreviewRow[] = [];

  for (const { line, data } of rawRows) {
    const parsed = rowSchema.safeParse(data);
    if (!parsed.success) {
      out.push({
        line,
        row: data as InviteRow,
        status: { kind: "invalid", reason: parsed.error.issues[0]!.message },
      });
      continue;
    }
    const row = parsed.data;
    const cacheKey = `${row.role}|${row.track ?? ""}`;
    if (!targetCache.has(cacheKey))
      targetCache.set(cacheKey, await resolveTarget(db, row.role, row.track));
    const target = targetCache.get(cacheKey)!;
    if (typeof target === "string") {
      out.push({ line, row, status: { kind: "invalid", reason: target } });
      continue;
    }
    assertCan(actor, "write", {
      type: "workflow",
      roleId: target.roleId,
      workflowId: target.workflowId,
    });

    const dupKey = `${row.email}|${target.roleId}`;
    if (seen.has(dupKey)) {
      out.push({
        line,
        row,
        target,
        status: { kind: "duplicate", reason: "Listed twice in this file" },
      });
      continue;
    }
    seen.add(dupKey);

    const [existing] = await db
      .select({ candidateId: candidates.id })
      .from(users)
      .innerJoin(candidates, eq(candidates.userId, users.id))
      .where(eq(users.email, row.email));
    if (!existing) {
      out.push({ line, row, target, status: { kind: "new" } });
      continue;
    }
    const [already] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.candidateId, existing.candidateId),
          eq(applications.roleId, target.roleId),
        ),
      );
    out.push(
      already
        ? {
            line,
            row,
            target,
            status: { kind: "duplicate", reason: `Already invited to ${target.roleTitle}` },
          }
        : { line, row, target, status: { kind: "add_role" } },
    );
  }
  return out;
}

export type InviteResult = {
  created: number;
  rolesAdded: number;
  skipped: number;
  applicationIds: string[];
};

/**
 * Creates accounts and applications for the valid rows. New people get one welcome email
 * (with a temporary password) listing all their roles; existing people get a "role added" email.
 */
export async function inviteCandidates(
  db: Db,
  actor: Actor,
  preview: PreviewRow[],
  deps: {
    queueEmail: (input: EnqueueInput) => Promise<string>;
    loginUrl: string;
    sendAfter?: Date;
  },
): Promise<InviteResult> {
  const result: InviteResult = { created: 0, rolesAdded: 0, skipped: 0, applicationIds: [] };
  const byEmail = new Map<string, PreviewRow[]>();
  for (const p of preview) {
    if (p.status.kind !== "new" && p.status.kind !== "add_role") {
      result.skipped++;
      continue;
    }
    byEmail.set(p.row.email, [...(byEmail.get(p.row.email) ?? []), p]);
  }

  for (const [email, rows] of byEmail) {
    const first = rows[0]!.row;
    const [existing] = await db
      .select({ userId: users.id, candidateId: candidates.id, name: candidates.name })
      .from(users)
      .innerJoin(candidates, eq(candidates.userId, users.id))
      .where(eq(users.email, email));

    let candidateId: string;
    let userId: string;
    let tempPassword: string | null = null;
    if (existing) {
      ({ candidateId, userId } = existing);
    } else {
      const created = await createCandidateAccount(db, { email, name: first.name });
      ({ candidateId, userId, tempPassword } = created);
      const profile = Object.fromEntries(
        Object.entries({
          phone: first.phone,
          college: first.college,
          gradYear: first.gradYear,
          linkedin: first.linkedin,
          github: first.github,
        }).filter(([, v]) => v !== undefined),
      );
      if (Object.keys(profile).length) {
        await db.update(candidates).set(profile).where(eq(candidates.id, candidateId));
      }
      result.created++;
    }

    const titles: string[] = [];
    for (const { target } of rows) {
      const [app] = await db
        .insert(applications)
        .values({
          candidateId,
          roleId: target!.roleId,
          workflowId: target!.workflowId,
          workflowVersionId: target!.versionId,
          currentNodeId: target!.entryNodeId,
          invitedBy: actor.userId,
        })
        .returning({ id: applications.id });
      result.applicationIds.push(app!.id);
      titles.push(target!.roleTitle);
      if (existing) result.rolesAdded++;
      await audit(db, {
        actorUserId: actor.userId,
        action: "candidate_invited",
        entity: "application",
        entityId: app!.id,
        after: { email, role: target!.roleTitle },
      });
    }

    const firstName = (existing?.name ?? first.name).split(" ")[0]!;
    if (tempPassword) {
      await deps.queueEmail({
        to: email,
        templateKey: "welcome",
        userId,
        sendAfter: deps.sendAfter,
        vars: {
          first_name: firstName,
          roles: titles.join(" and "),
          email,
          login_url: deps.loginUrl,
        },
        secrets: { temp_password: tempPassword },
      });
    } else {
      for (const title of titles) {
        await deps.queueEmail({
          to: email,
          templateKey: "role_added",
          userId,
          sendAfter: deps.sendAfter,
          vars: { first_name: firstName, role: title, login_url: deps.loginUrl },
        });
      }
    }
  }
  return result;
}

/** New temporary password (the old one stops working) and a fresh welcome email. */
export async function resendInvite(
  db: Db,
  actor: Actor,
  candidateId: string,
  deps: { queueEmail: (input: EnqueueInput) => Promise<string>; loginUrl: string },
): Promise<void> {
  assertCan(actor, "manage", { type: "team_settings" });
  const [c] = await db
    .select({ userId: users.id, email: users.email, name: candidates.name })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .where(eq(candidates.id, candidateId));
  if (!c) throw new Error("candidate not found");
  const apps = await db
    .select({ title: roles.title })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .where(eq(applications.candidateId, candidateId));
  const tempPassword = await issueTempPassword(db, c.userId);
  await deps.queueEmail({
    to: c.email,
    templateKey: "welcome",
    userId: c.userId,
    vars: {
      first_name: c.name.split(" ")[0]!,
      roles: apps.map((a) => a.title).join(" and ") || "a role",
      email: c.email,
      login_url: deps.loginUrl,
    },
    secrets: { temp_password: tempPassword },
  });
  await audit(db, {
    actorUserId: actor.userId,
    action: "invite_resent",
    entity: "candidate",
    entityId: candidateId,
  });
}

/** Removes a role from a candidate without emailing them; other roles are untouched. */
export async function revokeApplication(
  db: Db,
  actor: Actor,
  applicationId: string,
): Promise<void> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId));
  if (!app) throw new Error("application not found");
  assertCan(actor, "write", { type: "workflow", roleId: app.roleId, workflowId: app.workflowId });
  await db
    .update(applications)
    .set({ status: "closed_rejected" })
    .where(eq(applications.id, applicationId));
  await audit(db, {
    actorUserId: actor.userId,
    action: "application_revoked",
    entity: "application",
    entityId: applicationId,
  });
}

export async function listCandidatesForTeam(db: Db, actor: Actor, search?: string) {
  const rows = await db
    .select({
      candidateId: candidates.id,
      name: candidates.name,
      email: users.email,
      emailStatus: candidates.emailStatus,
      mustChangePassword: users.mustChangePassword,
      passwordChangedAt: users.passwordChangedAt,
      tempPasswordExpiresAt: users.tempPasswordExpiresAt,
      applicationId: applications.id,
      roleId: applications.roleId,
      workflowId: applications.workflowId,
      roleTitle: roles.title,
      status: applications.status,
      invitedAt: applications.invitedAt,
    })
    .from(candidates)
    .innerJoin(users, eq(users.id, candidates.userId))
    .innerJoin(applications, eq(applications.candidateId, candidates.id))
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .orderBy(desc(applications.invitedAt));
  const q = search?.trim().toLowerCase();
  return rows.filter(
    (r) =>
      actor.kind === "team" &&
      (actor.role === "admin" ||
        actor.roleIds.includes(r.roleId) ||
        actor.workflowIds.includes(r.workflowId)) &&
      (!q || r.email.includes(q) || r.name.toLowerCase().includes(q)),
  );
}

export async function candidateIdsForEmails(db: Db, emails: string[]) {
  if (emails.length === 0) return [];
  return db
    .select({ id: candidates.id, email: users.email })
    .from(users)
    .innerJoin(candidates, eq(candidates.userId, users.id))
    .where(inArray(users.email, emails));
}
