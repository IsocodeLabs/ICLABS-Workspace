import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/server/auth";

/**
 * Only the Better Auth endpoints the browser needs are reachable over HTTP. Candidate
 * password sign-in and password changes go through server actions instead, which add
 * lockout, rate limits and the breached-password check.
 */
const ALLOWED = [
  /^\/sign-in\/social$/,
  /^\/callback\/google$/,
  /^\/get-session$/,
  /^\/sign-out$/,
  /^\/request-password-reset$/,
  /^\/reset-password(\/[^/]+)?$/,
  /^\/error$/,
  /^\/ok$/,
];

function guard(handler: (req: NextRequest) => Promise<Response>) {
  return (req: NextRequest) => {
    const path = new URL(req.url).pathname.replace(/^\/api\/auth/, "");
    if (!ALLOWED.some((re) => re.test(path))) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return handler(req);
  };
}

export const GET = guard((req) => toNextJsHandler(auth()).GET(req));
export const POST = guard((req) => toNextJsHandler(auth()).POST(req));
