const MOBILE_UA = /iPhone|iPod|Android.+Mobile|Windows Phone|Mobi/i;

/**
 * Server-side phone detection for the desktop-only candidate portal. The client hint wins
 * when present; the user agent is the fallback. A client-side viewport check backs this up.
 */
export function isMobileClient(req: {
  secChUaMobile?: string | null;
  userAgent?: string | null;
}): boolean {
  if (req.secChUaMobile === "?1") return true;
  if (req.secChUaMobile === "?0") return false;
  return req.userAgent ? MOBILE_UA.test(req.userAgent) : false;
}
