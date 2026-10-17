import { and, desc, eq, ilike, lt, auditLog, users, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan } from "./audit";

export type AuditFilter = { action?: string; entity?: string; via?: "ui" | "mcp" | "rule" | "system"; before?: string };

const PAGE = 50;

/** Admin-only, newest first, keyset-paged by id (ULIDs sort by time). */
export async function listAudit(db: Db, actor: Actor, f: AuditFilter) {
  assertCan(actor, "manage", { type: "team_settings" });
  const rows = await db
    .select({ e: auditLog, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(
      and(
        f.action ? ilike(auditLog.action, `%${f.action.replace(/[%_]/g, "")}%`) : undefined,
        f.entity ? eq(auditLog.entity, f.entity) : undefined,
        f.via ? eq(auditLog.actorVia, f.via) : undefined,
        f.before ? lt(auditLog.id, f.before) : undefined,
      ),
    )
    .orderBy(desc(auditLog.id))
    .limit(PAGE + 1);
  return { rows: rows.slice(0, PAGE), next: rows.length > PAGE ? rows[PAGE - 1]!.e.id : null };
}
