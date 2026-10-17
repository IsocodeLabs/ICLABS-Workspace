/** Placeholder shown instantly while a page's data loads, so navigation never feels stuck. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-8 space-y-3">
        <div className="h-8 w-64 animate-pulse rounded-xl bg-neutral-bg" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-lg bg-neutral-bg" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-card border border-border bg-surface" />
        ))}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-card border border-border bg-surface" />
    </main>
  );
}
