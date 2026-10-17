import { NextResponse } from "next/server";
import { authorizationServerMetadata } from "@/server/mcp/metadata";

export function GET() {
  return NextResponse.json(authorizationServerMetadata(), { headers: { "Access-Control-Allow-Origin": "*" } });
}
