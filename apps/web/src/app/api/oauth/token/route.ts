import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { exchangeToken } from "@/server/mcp/oauth";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type" };

export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const form = type.includes("application/json")
    ? new URLSearchParams((await req.json().catch(() => ({}))) as Record<string, string>)
    : new URLSearchParams(await req.text());
  const res = await exchangeToken(db(), form);
  const headers = { ...cors, "Cache-Control": "no-store" };
  if (!res.ok)
    return NextResponse.json(
      { error: res.error, error_description: res.description },
      { status: 400, headers },
    );
  return NextResponse.json(res.body, { headers });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: { ...cors, "Access-Control-Allow-Methods": "POST" },
  });
}
