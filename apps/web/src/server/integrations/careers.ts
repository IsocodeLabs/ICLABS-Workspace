import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { and, asc, eq, ilike, roles, teamMembers, users, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { loadActor } from "../auth/actor";
import { inviteCandidates, previewInvites } from "../candidates/invites";
import type { EnqueueInput } from "../email/outbox";

/**
 * careers.isocodelabs.com → workspace: when founders shortlist an applicant on the careers
 * admin, the careers site posts them here and they get the normal workspace invite
 * (account + welcome email with a temporary password).
 *
 * Requests are signed: HMAC-SHA256 over `${timestamp}.${rawBody}` with the shared
 * CAREERS_WEBHOOK_SECRET, sent as `x-careers-timestamp` / `x-careers-signature` (hex).
 * Requests older than 5 minutes are refused. Repeats are safe: someone already invited to
 * the role comes back as "already".
 */

export const MAX_SKEW_MS = 5 * 60_000;

export function signCareersRequest(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyCareersRequest(
  secret: string,
  headers: { timestamp: string | null; signature: string | null },
  body: string,
  now = Date.now(),
): boolean {
  const { timestamp, signature } = headers;
  if (!timestamp || !signature || !/^\d{10,13}$/.test(timestamp)) return false;
  const ms = timestamp.length === 13 ? Number(timestamp) : Number(timestamp) * 1000;
  if (Math.abs(now - ms) > MAX_SKEW_MS) return false;
  const expected = Buffer.from(signCareersRequest(secret, timestamp, body), "hex");
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);
const optionalUrl = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && /^https?:\/\//i.test(v) ? v.slice(0, 300) : undefined));

export const shortlistSchema = z.object({
  /** The careers application id, echoed back so the careers site can match the reply. */
  applicationId: z.union([z.string(), z.number()]).transform(String),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  phone: optionalText(30),
  roleKey: z.string().trim().min(1).max(120),
  roleTitle: optionalText(200),
  college: optionalText(200),
  gradYear: z.coerce.number().int().min(2000).max(2040).optional().catch(undefined),
  linkedin: optionalUrl,
  github: optionalUrl,
  /** Email of the founder who shortlisted; used as the inviter when they're on the team. */
  shortlistedBy: z.email().optional().catch(undefined),
});
export type ShortlistInput = z.infer<typeof shortlistSchema>;

export type ShortlistResult =
  | { status: "invited" | "role_added" | "already"; role: string }
  | { status: "error"; reason: string };

/**
 * Careers role → workspace role slug. Tries, in order: CAREERS_ROLE_MAP
 * ("careersKey=workspaceSlug,…"), a workspace role with the same slug, then the same title.
 */
export async function resolveRoleSlug(
  db: Db,
  input: { roleKey: string; roleTitle?: string },
  roleMap?: string,
): Promise<string | null> {
  const mapped = parseRoleMap(roleMap).get(input.roleKey.toLowerCase());
  const key = mapped ?? input.roleKey.toLowerCase();
  // an exact slug wins over a title match (an older role can share the title)
  const [bySlug] = await db.select({ slug: roles.slug }).from(roles).where(eq(roles.slug, key));
  if (bySlug || mapped || !input.roleTitle) return bySlug?.slug ?? null;
  const [byTitle] = await db
    .select({ slug: roles.slug })
    .from(roles)
    .where(ilike(roles.title, input.roleTitle.replace(/[\\%_]/g, "\\$&")))
    .limit(1);
  return byTitle?.slug ?? null;
}

export function parseRoleMap(raw?: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? "").split(",")) {
    const [from, to] = pair.split("=").map((s) => s?.trim().toLowerCase());
    if (from && to) out.set(from, to);
  }
  return out;
}

/** The team member invites are attributed to: the shortlisting founder if they're an active admin/HM, else the first admin. */
export async function inviterActor(db: Db, shortlistedBy?: string): Promise<Actor | null> {
  const canInvite = (a: Actor | null) =>
    a?.kind === "team" && a.active && (a.role === "admin" || a.role === "hiring_manager");

  if (shortlistedBy) {
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, shortlistedBy.toLowerCase()), eq(users.kind, "team")));
    const actor = u ? await loadActor(db, u.id) : null;
    if (canInvite(actor)) return actor;
  }
  const admins = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.role, "admin"), eq(teamMembers.active, true)))
    .orderBy(asc(teamMembers.createdAt));
  for (const { userId } of admins) {
    if (!userId) continue; // invited but never signed in
    const actor = await loadActor(db, userId);
    if (canInvite(actor)) return actor;
  }
  return null;
}

export async function inviteShortlisted(
  db: Db,
  input: ShortlistInput,
  deps: {
    roleMap?: string;
    queueEmail: (input: EnqueueInput) => Promise<string>;
    loginUrl: string;
    onApplicationCreated?: (applicationId: string) => Promise<void>;
  },
): Promise<ShortlistResult> {
  const slug = await resolveRoleSlug(db, input, deps.roleMap);
  if (!slug)
    return {
      status: "error",
      reason: `No workspace role matches "${input.roleTitle ?? input.roleKey}". Add it in the workspace or set CAREERS_ROLE_MAP.`,
    };
  const actor = await inviterActor(db, input.shortlistedBy);
  if (!actor) return { status: "error", reason: "No active workspace admin to send the invite." };

  const [row] = await previewInvites(db, actor, [
    {
      line: 1,
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: slug,
        college: input.college,
        gradYear: input.gradYear,
        linkedin: input.linkedin,
        github: input.github,
      },
    },
  ]);
  const role = row!.target?.roleTitle ?? slug;
  if (row!.status.kind === "duplicate") return { status: "already", role };
  if (row!.status.kind === "invalid") return { status: "error", reason: row!.status.reason };

  await inviteCandidates(db, actor, [row!], {
    queueEmail: deps.queueEmail,
    loginUrl: deps.loginUrl,
    onApplicationCreated: deps.onApplicationCreated,
  });
  return { status: row!.status.kind === "new" ? "invited" : "role_added", role };
}
