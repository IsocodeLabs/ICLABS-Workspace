"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { FormField } from "@iclabs/core/workflow";
import { Alert, Button } from "@/components/ui";
import { saveDraftAction, submitFormAction } from "@/app/(candidate)/stage-actions";
import { FileUpload } from "./file-upload";

type Answers = Record<string, string | string[] | { id: string; name: string } | null>;

const input =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-soft";

export function FormStage({
  applicationId,
  nodeId,
  fields,
  draft,
  canSubmit,
}: {
  applicationId: string;
  nodeId: string;
  fields: FormField[];
  draft: Record<string, unknown>;
  canSubmit: boolean;
  closesAt: string | null;
}) {
  const t = useTranslations("stage");
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(draft as Answers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [busy, setBusy] = useState(false);
  const lastSaved = useRef(JSON.stringify(draft));

  // Autosave so a dropped connection or closed tab doesn't lose work (only real changes).
  useEffect(() => {
    const snapshot = JSON.stringify(answers);
    if (snapshot === lastSaved.current) return;
    setSaving("saving");
    const timer = setTimeout(async () => {
      await saveDraftAction({ applicationId, nodeId, draft: answers });
      lastSaved.current = snapshot;
      setSaving("saved");
    }, 1000);
    return () => clearTimeout(timer);
  }, [answers, applicationId, nodeId]);

  const set = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }));

  async function submit() {
    setBusy(true);
    const payload = Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [
        k,
        v && typeof v === "object" && !Array.isArray(v) ? v.id : v,
      ]),
    );
    const res = await submitFormAction({ applicationId, nodeId, answers: payload });
    setBusy(false);
    if (res.ok) router.refresh();
    else {
      setErrors(res.fieldErrors ?? {});
      setMessage(res.error);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="rounded-card border border-border bg-surface p-8 shadow-card"
      noValidate
    >
      {message && <Alert>{message}</Alert>}
      {fields.map((f) => {
        if (f.kind === "section") {
          return (
            <h2 key={f.id} className="mb-3 mt-6 font-display text-lg font-semibold first:mt-0">
              {f.label}
            </h2>
          );
        }
        const id = `f-${f.id}`;
        const v = answers[f.id];
        const err = errors[f.id];
        return (
          <div key={f.id} className="mb-5">
            <label htmlFor={id} className="mb-1.5 block font-semibold">
              {f.label}
              {f.required && (
                <span className="ml-1 text-sm font-normal text-muted">({t("required")})</span>
              )}
            </label>
            {f.help && <p className="mb-1.5 text-sm text-muted">{f.help}</p>}
            {f.kind === "long_text" ? (
              <textarea
                id={id}
                className={`${input} min-h-32`}
                value={(v as string) ?? ""}
                onChange={(e) => set(f.id, e.target.value)}
              />
            ) : f.kind === "single_choice" ? (
              <div className="space-y-1.5" role="radiogroup" aria-labelledby={id}>
                {(f.options ?? []).map((o) => (
                  <label key={o} className="flex items-center gap-2">
                    <input type="radio" name={id} checked={v === o} onChange={() => set(f.id, o)} />{" "}
                    {o}
                  </label>
                ))}
              </div>
            ) : f.kind === "multi_choice" ? (
              <div className="space-y-1.5">
                {(f.options ?? []).map((o) => {
                  const list = Array.isArray(v) ? v : [];
                  return (
                    <label key={o} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={list.includes(o)}
                        onChange={(e) =>
                          set(f.id, e.target.checked ? [...list, o] : list.filter((x) => x !== o))
                        }
                      />
                      {o}
                    </label>
                  );
                })}
              </div>
            ) : f.kind === "file" ? (
              <FileUpload
                id={id}
                value={(v as { id: string; name: string }) ?? null}
                onChange={(file) => set(f.id, file)}
              />
            ) : f.kind === "rating" ? (
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    type="button"
                    key={n}
                    onClick={() => set(f.id, String(n))}
                    aria-pressed={v === String(n)}
                    className={`h-10 w-10 rounded-xl border font-semibold ${v === String(n) ? "border-brand-500 bg-brand-soft text-brand-soft-fg" : "border-border"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : (
              <input
                id={id}
                className={input}
                type={
                  { email: "email", phone: "tel", number: "number", date: "date", url: "url" }[
                    f.kind as string
                  ] ?? "text"
                }
                value={(v as string) ?? ""}
                onChange={(e) => set(f.id, e.target.value)}
              />
            )}
            {err && (
              <p className="mt-1 text-sm text-danger-fg">
                {t(`errors.${err}` as "errors.required")}
              </p>
            )}
          </div>
        );
      })}
      <div className="mt-6 flex items-center gap-4">
        <Button type="submit" disabled={!canSubmit || busy} className="!w-auto px-8">
          {t("submit")}
        </Button>
        <span className="text-sm text-muted" aria-live="polite">
          {saving === "saving" ? t("saving") : saving === "saved" ? t("saved") : ""}
        </span>
      </div>
    </form>
  );
}
