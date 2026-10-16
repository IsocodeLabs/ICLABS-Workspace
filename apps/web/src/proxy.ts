import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs before every page: a per-request CSP nonce, and a cheap cookie check that sends
 * signed-out visitors to the right login page. Real session and role checks happen in
 * `requireCandidate` / `requireTeam` on the server.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isTeamArea = pathname.startsWith("/team") && !pathname.startsWith("/team/login");
  const isCandidateArea = [
    "/dashboard",
    "/change-password",
    "/welcome",
    "/roles",
    "/profile",
    "/notifications",
  ].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if ((isTeamArea || isCandidateArea) && !getSessionCookie(request)) {
    const login = isTeamArea ? "/team/login" : "/login";
    return NextResponse.redirect(new URL(login, request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    dev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
