"use client";

import { useEffect } from "react";
import { errorKind, friendlyMessage, reportError } from "@/lib/client-errors";

const TITLE = {
  stale_page: "The workspace was just updated",
  offline: "You seem to be offline",
  crash: "Something went wrong",
} as const;

/**
 * What every error boundary shows: plain words, never the raw error. Reports the error so the
 * team is emailed. Doesn't use next-intl: the root error boundary renders without its provider.
 */
export function ErrorScreen({
  error,
  reset,
  where,
}: {
  error: Error & { digest?: string };
  reset?: () => void;
  where: string;
}) {
  const kind = errorKind(error);
  const message = friendlyMessage(error);
  useEffect(() => reportError(error, where, message), [error, where, message]);
  const reload = () => window.location.reload();

  return (
    <main className="mx-auto max-w-xl px-4 py-16">
      <div role="alert" className="rounded-card border border-border bg-surface p-8 shadow-card">
        <h2 className="font-display text-xl font-bold">{TITLE[kind]}</h2>
        <p className="mt-2 text-muted">{message}</p>
        <p className="mt-2 text-muted">
          If the issue persists, reach out to{" "}
          <a href="mailto:hr@isocodelabs.com" className="font-semibold underline">
            hr@isocodelabs.com
          </a>
          .
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={kind === "stale_page" || !reset ? reload : reset}
            className="rounded-xl bg-brand-500 px-4 py-2 font-semibold text-white hover:bg-brand-600"
          >
            {kind === "stale_page" || !reset ? "Reload page" : "Try again"}
          </button>
          {kind !== "stale_page" && reset && (
            <button
              type="button"
              onClick={reload}
              className="rounded-xl border border-border px-4 py-2 font-semibold hover:bg-neutral-bg"
            >
              Reload page
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
