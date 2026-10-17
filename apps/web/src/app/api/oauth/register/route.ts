import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { registerClient } from "@/server/mcp/oauth";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };

/** RFC 7591 dynamic client registration (public clients, PKCE). Rate-limited at Cloud Armor. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const res = await registerClient(db(), body);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400, headers: cors });
  return NextResponse.json(
    { ...res.client, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] },
    { status: 201, headers: cors },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST" } });
}
