import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { isCronRequest } from "@/server/cron";
import { purgeExpired } from "@/server/retention";
import { fileStore } from "@/server/stages/deps";

/** Daily (Cloud Scheduler): erase candidates past the retention period. */
export async function POST(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const erased = await purgeExpired(db(), fileStore());
  return NextResponse.json({ erased });
}
