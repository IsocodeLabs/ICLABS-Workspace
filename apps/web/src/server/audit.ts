import { auditLog, type Db } from "@iclabs/db";
import { can, type Action, type Actor, type Resource } from "@iclabs/core";

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws unless the policy layer allows it. Every server-side mutation starts here. */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  if (!can(actor, action, resource)) throw new ForbiddenError(`${action} on ${resource.type}`);
}

export type AuditEntry = {
  actorUserId: string | null;
  via?: "ui" | "mcp" | "rule" | "system";
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Appends to the audit log. Never pass secrets (passwords, tokens) in before/after. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    actorVia: entry.via ?? (entry.actorUserId ? "ui" : "system"),
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
