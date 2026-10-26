/**
 * Errors in the browser: what kind of problem it is, what to tell the person (never the raw
 * error text), and a report to /api/client-errors so the team is emailed.
 */

export type ErrorKind = "stale_page" | "offline" | "crash";

/** Raised by our own code with wording that's already fit to show. */
export class FriendlyError extends Error {
  override name = "FriendlyError";
}

const STALE = [
  /Server Action .* was not found/i,
  /failed-to-find-server-action/i,
  /UnrecognizedActionError/,
  /Failed to find Server Action/i,
  /ChunkLoadError/,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
];
const OFFLINE = [
  /Failed to fetch/i,
  /NetworkError/i,
  /Load failed/i,
  /network connection was lost/i,
  /The Internet connection appears to be offline/i,
];

function text(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export function errorKind(e: unknown): ErrorKind {
  const t = text(e);
  if (STALE.some((r) => r.test(t))) return "stale_page";
  if (
    OFFLINE.some((r) => r.test(t)) ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  )
    return "offline";
  return "crash";
}

export const FRIENDLY: Record<ErrorKind, string> = {
  stale_page: "Isocode Workspace was just updated. Reload the page to carry on.",
  offline: "We couldn't reach the workspace. Check your internet connection, then try again.",
  crash:
    "Something went wrong on our side. Our team has been notified automatically. Try again in a minute.",
};

/** What to show for any error: our own friendly wording as is, everything else rephrased. */
export function friendlyMessage(e: unknown): string {
  return e instanceof FriendlyError ? e.message : FRIENDLY[errorKind(e)];
}

const sent = new Map<string, number>();

/**
 * Tells the team someone was shown an error. Fire and forget; the same error from the same
 * tab is sent at most once a minute. FriendlyErrors (expected, like "file too big") aren't sent.
 */
export function reportError(e: unknown, where: string, shown = friendlyMessage(e)) {
  if (typeof window === "undefined" || e instanceof FriendlyError) return;
  const kind = errorKind(e);
  const message = text(e).slice(0, 2000);
  const key = `${where}|${message}`;
  const now = Date.now();
  if (now - (sent.get(key) ?? 0) < 60_000) return;
  sent.set(key, now);
  const digest =
    e && typeof e === "object" && "digest" in e && typeof e.digest === "string"
      ? e.digest
      : undefined;
  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, message, shown, where, url: location.href, digest }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Reporting must never cause a second error.
  }
}
