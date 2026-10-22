import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  and,
  desc,
  eq,
  gt,
  isNull,
  oauthClients,
  oauthCodes,
  oauthGrants,
  teamMembers,
  workspaceSettings,
  type Db,
} from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { assertCan, audit } from "../audit";

/**
 * A small OAuth 2.1 authorization server for the admin MCP endpoint (PRD §6B, MCP-1):
 * dynamic client registration, authorization code + PKCE (S256 only), short-lived access
 * tokens and rotating refresh tokens. Tokens are opaque and stored as SHA-256 hashes.
 * Only active admins can hold a grant, re-checked on every request.
 */

export const MCP_SCOPE = "workspace:admin";
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const CODE_TTL_MS = 5 * 60_000;

const token = () => randomBytes(32).toString("base64url");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** https anywhere, or loopback http (Claude Desktop / Claude Code use local callbacks). */
export function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function registerClient(db: Db, input: unknown) {
  const body = (input ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  const uris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((u): u is string => typeof u === "string")
    : [];
  if (uris.length === 0 || uris.length > 10 || !uris.every(isAllowedRedirect))
    return { ok: false as const, error: "invalid_redirect_uri" };
  const name =
    typeof body.client_name === "string" && body.client_name.trim()
      ? body.client_name.trim().slice(0, 100)
      : "MCP client";
  const clientId = `mcp_${token()}`;
  await db.insert(oauthClients).values({ clientId, name, redirectUris: uris });
  return {
    ok: true as const,
    client: { client_id: clientId, client_name: name, redirect_uris: uris },
  };
}

export async function findClient(db: Db, clientId: string) {
  const [c] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  return c ?? null;
}

/** Validates an /authorize request before the consent screen is shown. */
export async function checkAuthorizeRequest(db: Db, q: Record<string, string | undefined>) {
  if (q.response_type !== "code")
    return { ok: false as const, error: "Only response_type=code is supported." };
  const client = q.client_id ? await findClient(db, q.client_id) : null;
  if (!client)
    return {
      ok: false as const,
      error: "Unknown client. Reconnect from Claude to register again.",
    };
  if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri))
    return { ok: false as const, error: "The redirect address doesn't match this client." };
  if (!q.code_challenge || q.code_challenge_method !== "S256")
    return { ok: false as const, error: "PKCE with S256 is required." };
  return {
    ok: true as const,
    client,
    redirectUri: q.redirect_uri,
    codeChallenge: q.code_challenge,
    state: q.state ?? null,
    scope: MCP_SCOPE,
  };
}

async function isActiveAdmin(db: Db, userId: string) {
  const [m] = await db
    .select({ role: teamMembers.role, active: teamMembers.active })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  return !!m && m.active && m.role === "admin";
}

export async function issueCode(
  db: Db,
  input: {
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    scope: string;
  },
  now = new Date(),
) {
  if (!(await isActiveAdmin(db, input.userId))) throw new Error("only admins can connect Claude");
  const code = token();
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
  });
  return code;
}

const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const safeEq = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
type TokenResult =
  { ok: true; body: TokenResponse } | { ok: false; error: string; description: string };

async function newGrant(
  db: Db,
  g: { clientId: string; userId: string; scope: string },
  now: Date,
): Promise<TokenResponse> {
  const access = token();
  const refresh = token();
  const client = await findClient(db, g.clientId);
  await db.insert(oauthGrants).values({
    clientId: g.clientId,
    clientName: client?.name ?? "MCP client",
    userId: g.userId,
    accessTokenHash: sha256(access),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
    refreshTokenHash: sha256(refresh),
    refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
    scope: g.scope,
  });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: g.scope,
  };
}

/** POST /token: authorization_code (with PKCE) or refresh_token (rotating). */
export async function exchangeToken(
  db: Db,
  form: URLSearchParams,
  now = new Date(),
): Promise<TokenResult> {
  const grantType = form.get("grant_type");
  const clientId = form.get("client_id") ?? "";
  if (!(await findClient(db, clientId)))
    return { ok: false, error: "invalid_client", description: "Unknown client." };

  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const [row] = await db
      .select()
      .from(oauthCodes)
      .where(
        and(
          eq(oauthCodes.codeHash, sha256(code)),
          isNull(oauthCodes.usedAt),
          gt(oauthCodes.expiresAt, now),
        ),
      );
    if (!row || row.clientId !== clientId || row.redirectUri !== form.get("redirect_uri"))
      return { ok: false, error: "invalid_grant", description: "Code is invalid or expired." };
    const verifier = form.get("code_verifier") ?? "";
    if (verifier.length < 43 || !safeEq(s256(verifier), row.codeChallenge))
      return { ok: false, error: "invalid_grant", description: "PKCE verification failed." };
    await db.update(oauthCodes).set({ usedAt: now }).where(eq(oauthCodes.id, row.id));
    if (!(await isActiveAdmin(db, row.userId)))
      return { ok: false, error: "access_denied", description: "Admins only." };
    const body = await newGrant(db, row, now);
    await audit(db, {
      actorUserId: row.userId,
      via: "mcp",
      action: "mcp_client_connected",
      entity: "oauth_client",
      entityId: clientId,
    });
    return { ok: true, body };
  }

  if (grantType === "refresh_token") {
    const [g] = await db
      .select()
      .from(oauthGrants)
      .where(
        and(
          eq(oauthGrants.refreshTokenHash, sha256(form.get("refresh_token") ?? "")),
          gt(oauthGrants.refreshExpiresAt, now),
        ),
      );
    if (!g || g.clientId !== clientId)
      return { ok: false, error: "invalid_grant", description: "Refresh token is invalid." };
    if (!(await isActiveAdmin(db, g.userId)))
      return { ok: false, error: "access_denied", description: "Admins only." };
    const access = token();
    const refresh = token();
    await db
      .update(oauthGrants)
      .set({
        accessTokenHash: sha256(access),
        accessExpiresAt: new Date(now.getTime() + ACCESS_TTL_MS),
        refreshTokenHash: sha256(refresh),
        refreshExpiresAt: new Date(now.getTime() + REFRESH_TTL_MS),
      })
      .where(eq(oauthGrants.id, g.id));
    return {
      ok: true,
      body: {
        access_token: access,
        token_type: "Bearer",
        expires_in: ACCESS_TTL_MS / 1000,
        refresh_token: refresh,
        scope: g.scope,
      },
    };
  }
  return {
    ok: false,
    error: "unsupported_grant_type",
    description: "Use authorization_code or refresh_token.",
  };
}

// ─── Kill switch and connected clients ───────────────────────────────────────

const MCP_ENABLED = "mcp_enabled";

export async function mcpEnabled(db: Db) {
  const [s] = await db
    .select()
    .from(workspaceSettings)
    .where(eq(workspaceSettings.key, MCP_ENABLED));
  return s ? s.value === true : true;
}

export async function setMcpEnabled(db: Db, actor: Actor, enabled: boolean) {
  assertCan(actor, "manage", { type: "mcp" });
  const by = actor.kind === "team" ? actor.userId : null;
  await db
    .insert(workspaceSettings)
    .values({ key: MCP_ENABLED, value: enabled, updatedBy: by })
    .onConflictDoUpdate({
      target: workspaceSettings.key,
      set: { value: enabled, updatedBy: by, updatedAt: new Date() },
    });
  await audit(db, {
    actorUserId: by,
    action: enabled ? "mcp_enabled" : "mcp_disabled",
    entity: "settings",
    entityId: MCP_ENABLED,
  });
}

/** Resolves a bearer token to the admin it belongs to, or null (401). */
export async function verifyAccessToken(db: Db, bearer: string | null, now = new Date()) {
  if (!bearer) return null;
  const [g] = await db
    .select()
    .from(oauthGrants)
    .where(
      and(eq(oauthGrants.accessTokenHash, sha256(bearer)), gt(oauthGrants.accessExpiresAt, now)),
    );
  if (!g || !(await isActiveAdmin(db, g.userId))) return null;
  // Touch at most once a minute.
  if (!g.lastUsedAt || now.getTime() - g.lastUsedAt.getTime() > 60_000)
    await db.update(oauthGrants).set({ lastUsedAt: now }).where(eq(oauthGrants.id, g.id));
  return { grantId: g.id, userId: g.userId, clientId: g.clientId, scope: g.scope };
}

export async function listGrants(db: Db, actor: Actor) {
  assertCan(actor, "manage", { type: "mcp" });
  return db.select().from(oauthGrants).orderBy(desc(oauthGrants.createdAt));
}

export async function revokeGrant(db: Db, actor: Actor, grantId: string) {
  assertCan(actor, "manage", { type: "mcp" });
  await db.delete(oauthGrants).where(eq(oauthGrants.id, grantId));
  await audit(db, {
    actorUserId: actor.kind === "team" ? actor.userId : null,
    action: "mcp_client_revoked",
    entity: "oauth_grant",
    entityId: grantId,
  });
}
