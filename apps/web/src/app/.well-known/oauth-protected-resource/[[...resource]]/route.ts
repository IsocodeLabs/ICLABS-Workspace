import { NextResponse } from "next/server";
import { protectedResourceMetadata } from "@/server/mcp/metadata";

export function GET() {
  return NextResponse.json(protectedResourceMetadata(), {
    headers: { "Access-Control-Allow-Origin": "*" },
  });
}
