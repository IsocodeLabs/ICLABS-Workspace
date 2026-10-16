import { z } from "zod";
import {
  and,
  desc,
  eq,
  isNull,
  sql,
  applications,
  candidates,
  notifications,
  roles,
  workflowVersions,
  type Db,
} from "@iclabs/db";
import { candidatePath, workflowConfigSchema, type Actor } from "@iclabs/core";
import { assertCan, audit } from "./audit";

type CandidateActor = Extract<Actor, { kind: "candidate" }>;

// ─── Consent (DPDP) ──────────────────────────────────────────────────────────

export async function hasConsented(db: Db, actor: CandidateActor): Promise<boolean> {
  const [c] = await db
    .select({ consentAt: candidates.consentAt })
    .from(candidates)
    .where(eq(candidates.id, actor.candidateId));
  return !!c?.consentAt;
}

export async function recordConsent(db: Db, actor: CandidateActor): Promise<void> {
  await db
    .update(candidates)
    .set({ consentAt: new Date() })
    .where(eq(candidates.id, actor.candidateId));
  await audit(db, {
    actorUserId: actor.userId,
    action: "privacy_consent_given",
    entity: "candidate",
    entityId: actor.candidateId,
  });
}

// ─── Dashboard & role space ──────────────────────────────────────────────────

export type RoleCard = {
  applicationId: string;
  roleTitle: string;
  status: (typeof applications.$inferSelect)["status"];
  currentStep: string | null;
};

/** The candidate's own roles only (filtered in SQL, then checked by the policy). */
export async function dashboardCards(db: Db, actor: CandidateActor): Promise<RoleCard[]> {
  const rows = await db
    .select({ app: applications, roleTitle: roles.title, config: workflowVersions.config })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .leftJoin(workflowVersions, eq(workflowVersions.id, applications.workflowVersionId))
    .where(eq(applications.candidateId, actor.candidateId))
    .orderBy(applications.invitedAt);
  return rows
    .filter(({ app }) => can(actor, app))
    .map(({ app, roleTitle, config }) => {
      const parsed = config ? workflowConfigSchema.safeParse(config) : null;
      const node = parsed?.success
        ? parsed.data.nodes.find((n) => n.id === app.currentNodeId)
        : undefined;
      return {
        applicationId: app.id,
        roleTitle,
        status: app.status,
        currentStep: node && node.visibility === "candidate" ? node.title : null,
      };
    });
}

function can(actor: CandidateActor, app: typeof applications.$inferSelect): boolean {
  try {
    assertCan(actor, "read", {
      type: "application",
      candidateId: app.candidateId,
      roleId: app.roleId,
      workflowId: app.workflowId,
      status: app.status,
      reviewerIds: [],
      interviewerIds: [],
    });
    return true;
  } catch {
    return false;
  }
}

/** Role space: returns null (→ 404) for anything that isn't this candidate's application. */
export async function roleSpace(db: Db, actor: CandidateActor, applicationId: string) {
  const [row] = await db
    .select({ app: applications, role: roles, config: workflowVersions.config })
    .from(applications)
    .innerJoin(roles, eq(roles.id, applications.roleId))
    .leftJoin(workflowVersions, eq(workflowVersions.id, applications.workflowVersionId))
    .where(
      and(eq(applications.id, applicationId), eq(applications.candidateId, actor.candidateId)),
    );
  if (!row || !can(actor, row.app)) return null;
  const config = row.config ? workflowConfigSchema.parse(row.config) : null;
  const steps = config ? candidatePath(config) : [];
  const currentIndex = steps.findIndex((s) => s.id === row.app.currentNodeId);
  return {
    applicationId: row.app.id,
    status: row.app.status,
    role: {
      title: row.role.title,
      description: row.role.description,
      duration: row.role.duration,
      location: row.role.location,
    },
    steps: steps.map((s, i) => ({
      id: s.id,
      title: s.title,
      type: s.type,
      description: s.description ?? null,
      state:
        currentIndex === -1
          ? ("upcoming" as const)
          : i < currentIndex
            ? ("done" as const)
            : i === currentIndex
              ? ("current" as const)
              : ("upcoming" as const),
    })),
  };
}

// ─── Profile ─────────────────────────────────────────────────────────────────

const optionalUrl = z.union([z.literal(""), z.url().max(300)]).transform((v) => v || null);
const optionalDate = z.union([z.literal(""), z.iso.date()]).transform((v) => v || null);

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .transform((v) => v || null),
  college: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null),
  gradYear: z
    .union([z.literal(""), z.coerce.number().int().min(2000).max(2040)])
    .transform((v) => (v === "" ? null : v)),
  linkedin: optionalUrl,
  github: optionalUrl,
  portfolio: optionalUrl,
  skills: z
    .string()
    .max(500)
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 30),
    ),
  availableFrom: optionalDate,
  availableTo: optionalDate,
  preferredStart: optionalDate,
});

export async function getProfile(db: Db, actor: CandidateActor) {
  const [c] = await db.select().from(candidates).where(eq(candidates.id, actor.candidateId));
  return c!;
}

export async function updateProfile(db: Db, actor: CandidateActor, input: unknown) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false as const,
      error: parsed.error.issues[0]?.message ?? "Check the highlighted fields",
    };
  await db.update(candidates).set(parsed.data).where(eq(candidates.id, actor.candidateId));
  return { ok: true as const };
}

// ─── Notifications (candidates and team) ─────────────────────────────────────

export async function unreadCount(db: Db, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return r?.n ?? 0;
}

export async function listNotifications(db: Db, userId: string) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(100);
}

export async function markAllRead(db: Db, userId: string) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function notify(
  db: Db,
  rows: { userId: string; kind: string; title: string; body?: string; link?: string }[],
): Promise<void> {
  if (rows.length) await db.insert(notifications).values(rows);
}
