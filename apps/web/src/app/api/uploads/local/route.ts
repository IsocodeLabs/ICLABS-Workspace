import { NextResponse, type NextRequest } from "next/server";
import { MAX_UPLOAD_BYTES, readLocal, verifyLocalToken, writeLocal } from "@/server/storage";
import { env } from "@/server/env";
import { localUploadDir } from "@/server/stages/deps";

/** DEVELOPMENT ONLY stand-in for signed Cloud Storage URLs. 404 in production. */
function guard(req: NextRequest, action: "put" | "get") {
  const e = env();
  if (e.NODE_ENV === "production" || e.STORAGE_DRIVER !== "local") return null;
  const p = req.nextUrl.searchParams;
  const key = p.get("key") ?? "";
  if (!verifyLocalToken(e.BETTER_AUTH_SECRET, key, p.get("exp") ?? "", p.get("sig") ?? "", action))
    return null;
  return key;
}

export async function PUT(req: NextRequest) {
  const key = guard(req, "put");
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = Buffer.from(await req.arrayBuffer());
  if (data.length > MAX_UPLOAD_BYTES)
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  await writeLocal(localUploadDir(), key, data);
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest) {
  const key = guard(req, "get");
  if (!key) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const name = (req.nextUrl.searchParams.get("name") ?? "file").replace(/[^\w.\- ]+/g, "_");
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(await readLocal(localUploadDir(), key)), {
    headers: {
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
