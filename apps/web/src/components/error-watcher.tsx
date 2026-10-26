"use client";

import { useEffect, useState } from "react";
import { errorKind, friendlyMessage, reportError } from "@/lib/client-errors";

/** Errors from this site's own code; browser extensions and injected scripts are ignored. */
function ours(e: unknown, filename?: string): boolean {
  if (filename) return filename.startsWith(window.location.origin);
  const stack = e instanceof Error ? (e.stack ?? "") : "";
  return stack.includes(window.location.origin) || stack.includes("/_next/") || !stack;
}

const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /AbortError/];

/**
 * Catches errors no boundary sees (a failed save fired from a click, a timer…): shows a short
 * notice in plain words instead of failing silently, and reports it so the team is emailed.
 */
export function ErrorWatcher() {
  const [notice, setNotice] = useState<{ stale: boolean; text: string } | null>(null);

  useEffect(() => {
    const handle = (e: unknown, filename?: string) => {
      const raw = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (IGNORE.some((r) => r.test(raw)) || !ours(e, filename)) return;
      const text = friendlyMessage(e);
      reportError(e, "unhandled", text);
      setNotice({ stale: errorKind(e) === "stale_page", text });
    };
    const onError = (ev: ErrorEvent) => handle(ev.error ?? ev.message, ev.filename);
    const onRejection = (ev: PromiseRejectionEvent) => handle(ev.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!notice) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-card"
    >
      <p className="min-w-0 flex-1 text-sm">{notice.text}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-xl bg-brand-500 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
      >
        Reload page
      </button>
      {!notice.stale && (
        <button
          type="button"
          onClick={() => setNotice(null)}
          className="rounded-xl px-3 py-1.5 text-sm font-semibold text-muted hover:bg-neutral-bg"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
