"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { wordCount, type FormField } from "@iclabs/core/workflow";
import { Alert, Button } from "@/components/ui";
import { saveDraftAction, submitFormAction } from "@/app/(candidate)/stage-actions";
import { reportError } from "@/lib/client-errors";
import { FileUpload } from "./file-upload";

type Answers = Record<string, string | string[] | { id: string; name: string } | null>;

/**
 * A copy of the answers in this browser, so nothing typed is lost if a save fails (no
 * connection, or the workspace was redeployed while the page was open).
 */
const backupKey = (applicationId: string, nodeId: string) =>
  `stage-answers:${applicationId}:${nodeId}`;
function readBackup(key: string): Answers | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Answers) : null;
  } catch {
    return null;
  }
}
function writeBackup(key: string, answers: Answers | null) {
  try {
    if (answers) localStorage.setItem(key, JSON.stringify(answers));
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the server draft is the only copy.
  }
}

const input =
  "w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-base outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-soft";

export function FormStage({
  applicationId,
  nodeId,
  fields,
  draft,
  canSubmit,
  editing,
  onDone,
}: {
  applicationId: string;
  nodeId: string;
  fields: FormField[];
  draft: Record<string, unknown>;
  canSubmit: boolean;
  closesAt: string | null;
  /** Changing answers already handed in: no server drafts, and a Cancel button. */
  editing?: boolean;
  onDone?: () => void;
}) {
  const t = useTranslations("stage");
  const router = useRouter();
  const [answers, setAnswers] = useState<Answers>(draft as Answers);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [busy, setBusy] = useState(false);
  const [pasteBlocked, setPasteBlocked] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const lastSaved = useRef(JSON.stringify(draft));
  const key = backupKey(applicationId, nodeId);

  // Answers kept in this browser win over the server draft: they are at least as new, and
  // they hold anything a failed save never stored. The autosave below then stores them.
  useEffect(() => {
    const local = readBackup(key);
    if (local && JSON.stringify(local) !== lastSaved.current)
      setAnswers({ ...draft, ...local } as Answers);
    // Runs once on load; the server draft is the starting point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Autosave so a dropped connection or closed tab doesn't lose work (only real changes).
  useEffect(() => {
    const snapshot = JSON.stringify(answers);
    if (snapshot === lastSaved.current) return;
    writeBackup(key, answers);
    // The handed-in version stays as it is until they save the change.
    if (editing) return;
    setSaving("saving");
    const timer = setTimeout(async () => {
      try {
        const res = await saveDraftAction({ applicationId, nodeId, draft: answers });
        if (!res.ok) throw new Error("not saved");
        lastSaved.current = snapshot;
        setSaving("saved");
      } catch {
        // Not stored on the server; the browser copy keeps it and the next change retries.
        setSaving("failed");
      }
      // 2.5s after typing stops: thousands of candidates writing at once stay a light load.
    }, 2500);
    return () => clearTimeout(timer);
  }, [answers, applicationId, nodeId, key, editing]);

  const set = (id: string, v: Answers[string]) => setAnswers((a) => ({ ...a, [id]: v }));

  // Fields marked "type it yourself" refuse pasted or dropped text.
  const typeOnly = (f: FormField) =>
    f.noPaste
      ? {
          onPaste: (e: React.ClipboardEvent) => {
            e.preventDefault();
            setPasteBlocked(f.id);
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            setPasteBlocked(f.id);
          },
        }
      : {};

  async function submit() {
    setBusy(true);
    setMessage(null);
    const payload = Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [
        k,
        v && typeof v === "object" && !Array.isArray(v) ? v.id : v,
      ]),
    );
    try {
      const res = await submitFormAction({ applicationId, nodeId, answers: payload });
      if (res.ok) {
        writeBackup(key, null);
        router.refresh();
        onDone?.();
      } else {
        setErrors(res.fieldErrors ?? {});
        setMessage(res.error);
      }
    } catch (e) {
      // Usually the workspace was updated while this page was open. Answers stay in the browser.
      writeBackup(key, answers);
      setStale(true);
      reportError(e, "form-submit", t("staleSubmit"));
    } finally {
      setBusy(false);
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
      {message && <Alert support>{message}</Alert>}
      {stale && (
        <Alert support>
          {t("staleSubmit")}{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => location.reload()}
          >
            {t("reload")}
          </button>
        </Alert>
      )}
      {fields.map((f) => {
        if (f.kind === "section") {
          return (
            <div key={f.id} className="mb-3 mt-6 first:mt-0">
              <h2 className="font-display text-lg font-semibold">{f.label}</h2>
              {f.help && <p className="mt-1 whitespace-pre-line text-sm text-muted">{f.help}</p>}
            </div>
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
            {f.noPaste && <p className="mb-1.5 text-sm text-muted">{t("typeOnly")}</p>}
            {f.kind === "long_text" ? (
              <textarea
                id={id}
                className={`${input} min-h-32`}
                value={(v as string) ?? ""}
                onChange={(e) => set(f.id, e.target.value)}
                {...typeOnly(f)}
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
                {...(f.kind === "short_text" ? typeOnly(f) : {})}
              />
            )}
            {f.maxWords && (f.kind === "long_text" || f.kind === "short_text") && (
              <p
                className={`mt-1 text-right text-sm ${wordCount(String(v ?? "")) > f.maxWords ? "text-danger-fg" : "text-muted"}`}
                aria-live="polite"
              >
                {t("words", { count: wordCount(String(v ?? "")), max: f.maxWords })}
              </p>
            )}
            {pasteBlocked === f.id && (
              <p className="mt-1 text-sm text-warning-fg">{t("pasteOff")}</p>
            )}
            {err && (
              <p className="mt-1 text-sm text-danger-fg">
                {t(`errors.${err}` as "errors.required", { max: f.maxWords ?? 0 })}
              </p>
            )}
          </div>
        );
      })}
      <div className="mt-6 flex items-center gap-4">
        <Button type="submit" disabled={!canSubmit || busy} className="!w-auto px-8">
          {editing ? t("saveChanges") : t("submit")}
        </Button>
        {editing && (
          <button
            type="button"
            onClick={() => {
              writeBackup(key, null);
              onDone?.();
            }}
            className="text-sm font-semibold text-muted hover:underline"
          >
            {t("cancelEdit")}
          </button>
        )}
        <span className="text-sm text-muted" aria-live="polite">
          {saving === "saving"
            ? t("saving")
            : saving === "saved"
              ? t("saved")
              : saving === "failed"
                ? t("saveFailed")
                : ""}
        </span>
      </div>
    </form>
  );
}
