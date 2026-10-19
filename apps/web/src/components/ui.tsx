import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { LogoMark } from "./logo";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <LogoMark size={40} className="mb-5 text-text" />
        <section className="rounded-card border border-border bg-surface p-8 shadow-card">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </section>
      </div>
    </main>
  );
}

export function Field({
  label,
  id,
  ...input
}: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={id}
        className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        {...input}
      />
    </div>
  );
}

export function Button({
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`inline-flex w-full items-center justify-center rounded-xl bg-brand-500 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

const tones = {
  danger: "bg-danger-bg text-danger-fg",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  neutral: "bg-neutral-bg text-neutral-fg",
} as const;

export type Tone = keyof typeof tones;

export function Alert({ tone = "danger", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <p role="alert" className={`mb-4 rounded-xl px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      {children}
    </p>
  );
}

/** Soft status pill: colour is always paired with its label. */
export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
