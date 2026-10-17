"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Search } from "lucide-react";

type Entry = { href: string; label: string };

/** Ctrl/⌘+K opens a quick jump to any page, or a candidate search. */
export function QuickJump({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = entries.filter((e) => !term || e.label.toLowerCase().includes(term));
    return term
      ? [...pages, { href: `/team/candidates?q=${encodeURIComponent(q.trim())}`, label: `Search candidates for “${q.trim()}”` }]
      : pages;
  }, [entries, q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQ("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
    if (!open && el.open) el.close();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-xl border border-border bg-surface px-3 py-1.5 text-sm text-muted transition hover:text-text sm:flex"
        aria-label="Quick jump"
      >
        <Search size={15} aria-hidden /> Jump to…
        <kbd className="rounded-md border border-border px-1.5 text-xs">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto mt-[12vh] w-[min(34rem,calc(100vw-2rem))] rounded-card border border-border bg-transparent p-0 text-text shadow-card"
      >
        <div className="overflow-hidden rounded-card">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <Search size={18} className="text-muted" aria-hidden />
            <input
              ref={input}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setIndex((i) => Math.min(results.length - 1, i + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setIndex((i) => Math.max(0, i - 1));
                } else if (e.key === "Enter" && results[index]) go(results[index]!.href);
              }}
              placeholder="Go to a page, or type a name or email"
              aria-label="Quick jump"
              className="w-full bg-transparent text-base outline-none"
            />
          </div>
          <ul className="max-h-80 overflow-y-auto p-2" role="listbox">
            {results.map((r, i) => (
              <li key={r.href + r.label} role="option" aria-selected={i === index}>
                <button
                  type="button"
                  onClick={() => go(r.href)}
                  onMouseEnter={() => setIndex(i)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left ${
                    i === index ? "bg-brand-500 text-white" : "hover:bg-neutral-bg"
                  }`}
                >
                  {r.label}
                  {i === index && <CornerDownLeft size={15} aria-hidden />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
