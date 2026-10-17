import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { db } from "@/server/db";
import { loadActor } from "@/server/auth/actor";
import { buildMcpServer } from "@/server/mcp/tools";
import { mcpEnabled, verifyAccessToken } from "@/server/mcp/oauth";
import { resourceMetadataUrl } from "@/server/mcp/metadata";
import { progressionDeps } from "@/server/stages/deps";
import { rateLimitHit } from "@/server/mcp/limit";

const unauthorized = () =>
  new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl()}"`,
    },
  });

/**
 * The admin MCP endpoint (Streamable HTTP, stateless: one server per request).
 * Admins only, re-checked on every call; the kill switch in Settings turns it off.
 */
async function handle(req: Request) {
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1] ?? null;
  const grant = await verifyAccessToken(db(), bearer);
  if (!grant) return unauthorized();
  if (!(await mcpEnabled(db())))
    return new Response(JSON.stringify({ error: "The workspace MCP server is turned off." }), { status: 503 });
  if (rateLimitHit(grant.grantId)) return new Response(JSON.stringify({ error: "rate_limited" }), { status: 429, headers: { "Retry-After": "60" } });
  const actor = await loadActor(db(), grant.userId);
  if (actor?.kind !== "team" || actor.role !== "admin" || !actor.active) return unauthorized();

  const server = buildMcpServer(db(), actor, progressionDeps());
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req, {
      authInfo: { token: bearer!, clientId: grant.clientId, scopes: [grant.scope] },
    });
  } finally {
    // Stateless: nothing to keep once the response is produced.
    void transport.close().catch(() => {});
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
