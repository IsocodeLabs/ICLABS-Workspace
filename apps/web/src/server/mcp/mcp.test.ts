import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { eq, auditLog, questions, teamMembers, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { teamActor } from "../../test/fixtures";
import {
  checkAuthorizeRequest,
  exchangeToken,
  isAllowedRedirect,
  issueCode,
  mcpEnabled,
  registerClient,
  revokeGrant,
  setMcpEnabled,
  verifyAccessToken,
} from "./oauth";
import { buildMcpServer, jaccard } from "./tools";

let db: Db;
let close: () => Promise<void>;
let admin: Awaited<ReturnType<typeof teamActor>>;
const redirect = "http://localhost:33418/callback";

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  admin = await teamActor(db, "admin");
});
afterAll(() => close());

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

async function connect(userId = admin.userId) {
  const reg = await registerClient(db, { client_name: "Claude Desktop", redirect_uris: [redirect] });
  if (!reg.ok) throw new Error(reg.error);
  const { verifier, challenge } = pkce();
  const code = await issueCode(db, { clientId: reg.client.client_id, userId, redirectUri: redirect, codeChallenge: challenge, scope: "workspace:admin" });
  return { clientId: reg.client.client_id, code, verifier };
}

const form = (o: Record<string, string>) => new URLSearchParams(o);

describe("OAuth for the MCP server", () => {
  it("only accepts https or loopback redirects", async () => {
    expect(isAllowedRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirect("http://127.0.0.1:5000/cb")).toBe(true);
    expect(isAllowedRedirect("http://evil.com/cb")).toBe(false);
    expect(await registerClient(db, { redirect_uris: ["javascript:alert(1)"] })).toMatchObject({ ok: false });
  });

  it("validates authorize requests (PKCE S256 and exact redirect)", async () => {
    const { clientId } = await connect();
    const base = { response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: "x", code_challenge_method: "S256" };
    expect(await checkAuthorizeRequest(db, base)).toMatchObject({ ok: true });
    expect(await checkAuthorizeRequest(db, { ...base, code_challenge_method: "plain" })).toMatchObject({ ok: false });
    expect(await checkAuthorizeRequest(db, { ...base, redirect_uri: "http://localhost:1/other" })).toMatchObject({ ok: false });
  });

  it("exchanges a code once with the right verifier, then rotates refresh tokens", async () => {
    const { clientId, code, verifier } = await connect();
    const bad = await exchangeToken(db, form({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: "x".repeat(43) }));
    expect(bad).toMatchObject({ ok: false, error: "invalid_grant" });
    const ok = await exchangeToken(db, form({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier }));
    if (!ok.ok) throw new Error(ok.description);
    // Spent: a second exchange fails.
    expect(await exchangeToken(db, form({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier }))).toMatchObject({ ok: false });
    expect(await verifyAccessToken(db, ok.body.access_token)).toMatchObject({ userId: admin.userId });

    const refreshed = await exchangeToken(db, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: ok.body.refresh_token }));
    if (!refreshed.ok) throw new Error(refreshed.description);
    expect(await verifyAccessToken(db, ok.body.access_token)).toBeNull();
    expect(await exchangeToken(db, form({ grant_type: "refresh_token", client_id: clientId, refresh_token: ok.body.refresh_token }))).toMatchObject({ ok: false });
    expect(await verifyAccessToken(db, refreshed.body.access_token)).not.toBeNull();
  });

  it("is admins only, and stops working when someone stops being an admin or is revoked", async () => {
    const hm = await teamActor(db, "hiring_manager");
    await expect(connect(hm.userId)).rejects.toThrow(/admins/);

    const other = await teamActor(db, "admin");
    const { clientId, code, verifier } = await connect(other.userId);
    const res = await exchangeToken(db, form({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: verifier }));
    if (!res.ok) throw new Error(res.description);
    const grant = await verifyAccessToken(db, res.body.access_token);
    expect(grant).not.toBeNull();
    await db.update(teamMembers).set({ role: "reviewer" }).where(eq(teamMembers.id, other.teamMemberId));
    expect(await verifyAccessToken(db, res.body.access_token)).toBeNull();
    await db.update(teamMembers).set({ role: "admin" }).where(eq(teamMembers.id, other.teamMemberId));
    await revokeGrant(db, admin, grant!.grantId);
    expect(await verifyAccessToken(db, res.body.access_token)).toBeNull();
  });

  it("has a kill switch", async () => {
    expect(await mcpEnabled(db)).toBe(true);
    await setMcpEnabled(db, admin, false);
    expect(await mcpEnabled(db)).toBe(false);
    await setMcpEnabled(db, admin, true);
    expect(await mcpEnabled(db)).toBe(true);
  });
});

describe("MCP tools", () => {
  async function rpc(method: string, params: unknown) {
    const server = buildMcpServer(db, admin, { queueEmail: vi.fn(async () => "id"), appUrl: (p) => `https://w${p}` });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(
      new Request("https://w/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    return (await res.json()) as { result?: { tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[]; content?: { text: string }[]; isError?: boolean }; error?: unknown };
  }

  it("lists tools with read-only hints", async () => {
    const res = await rpc("tools/list", {});
    const names = res.result!.tools!.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_pipeline", "draft_review", "create_questions", "simulate_rules", "prepare_bulk_decision"]));
    expect(res.result!.tools!.find((t) => t.name === "get_funnel_metrics")!.annotations!.readOnlyHint).toBe(true);
    expect(res.result!.tools!.find((t) => t.name === "create_questions")!.annotations!.readOnlyHint).toBe(false);
  });

  it("creates questions as AI-suggested drafts and audits the call as via Claude", async () => {
    const res = await rpc("tools/call", {
      name: "create_questions",
      arguments: {
        questions: [
          { type: "mcq", body: "Which SQL clause filters grouped rows?", options: [{ text: "HAVING", correct: true }, { text: "WHERE", correct: false }], tags: ["sql"], difficulty: "medium" },
        ],
      },
    });
    expect(res.result!.isError).toBeFalsy();
    const rows = await db.select().from(questions).where(eq(questions.body, "Which SQL clause filters grouped rows?"));
    expect(rows[0]).toMatchObject({ status: "draft", source: "claude" });
    const trail = await db.select().from(auditLog).where(eq(auditLog.action, "mcp_create_questions"));
    expect(trail[0]).toMatchObject({ actorVia: "mcp", actorUserId: admin.userId });
  });

  it("prepared actions return a confirmation link and change nothing", async () => {
    const res = await rpc("tools/call", { name: "prepare_bulk_decision", arguments: { workflowId: "wf1", applicationIds: ["a", "b"], action: "hold" } });
    const body = JSON.parse(res.result!.content![0]!.text);
    expect(body).toMatchObject({ status: "prepared, not executed", count: 2 });
    expect(body.confirm).toContain("/team/pipeline?track=wf1&select=a%2Cb&action=hold");
  });

  it("similarity helper", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1);
    expect(jaccard(new Set(["a"]), new Set(["b"]))).toBe(0);
  });
});
