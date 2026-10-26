"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { SupportHint } from "@/components/ui";
import { FriendlyError, friendlyMessage, reportError } from "@/lib/client-errors";

type UploadStep =
  | { ok: true; fileId: string; url: string; headers: Record<string, string> }
  | { ok: true; scanStatus: string }
  | { ok: false; error: string };

const MAX_BYTES = 25 * 1024 * 1024;

/** Calls /api/uploads (a fixed URL, so pages opened before a deploy keep working). */
async function uploadStep(body: Record<string, unknown>): Promise<UploadStep> {
  const res = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: "No connection. Check your internet and try again." };
  const json = (await res.json().catch(() => null)) as UploadStep | null;
  if (json && "ok" in json && res.status < 500) return json;
  const error =
    json && "ok" in json && !json.ok
      ? json.error
      : "We couldn't upload your file right now. Try again in a few minutes, or share it as a link if this keeps happening.";
  // The workspace itself failed: the team is told, the candidate gets words they can act on.
  reportError(new Error(`Upload ${String(body.step)} failed: HTTP ${res.status}`), "upload", error);
  return { ok: false, error };
}

/** Why storage refused the bytes, in words the candidate can act on. */
function putFailure(status: number | null): string {
  if (status === null)
    return "The upload was cut off. Check your connection (or switch between Wi-Fi and mobile data) and try again.";
  if (status === 400 || status === 403)
    return "The upload link expired or was refused. Choose the file again.";
  if (status === 413) return "Files can be up to 25 MB. Compress it, or share it as a link.";
  return "Storage didn't accept the file. Try again in a minute.";
}

/** Uploads straight to storage with a short-lived URL, then confirms with the server. */
export function FileUpload({
  value,
  onChange,
  id,
}: {
  value: { id: string; name: string } | null;
  onChange: (file: { id: string; name: string } | null) => void;
  id: string;
}) {
  const t = useTranslations("stage");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      if (file.size > MAX_BYTES)
        throw new FriendlyError("Files can be up to 25 MB. Compress it, or share it as a link.");
      const req = await uploadStep({
        step: "request",
        filename: file.name,
        mime: file.type,
        size: file.size,
      });
      if (!req.ok) throw new FriendlyError(req.error);
      if (!("fileId" in req)) throw new FriendlyError("Choose the file again.");
      const put = await fetch(req.url, { method: "PUT", headers: req.headers, body: file }).catch(
        () => null,
      );
      if (!put?.ok) {
        const reason = putFailure(put ? put.status : null);
        if (put && put.status >= 500)
          reportError(new Error(`Storage PUT failed: HTTP ${put.status}`), "upload", reason);
        throw new FriendlyError(reason);
      }
      const done = await uploadStep({ step: "confirm", fileId: req.fileId });
      if (!done.ok) throw new FriendlyError(done.error);
      onChange({ id: req.fileId, name: file.name });
    } catch (e) {
      // Our own reasons are shown as they are; anything unexpected is reworded and reported.
      const shown = friendlyMessage(e);
      setError(shown);
      reportError(e, "upload", shown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {value && (
        <p className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Paperclip size={15} aria-hidden /> {t("uploaded", { name: value.name })}
        </p>
      )}
      <label
        htmlFor={id}
        className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border px-4 py-2.5 text-sm font-semibold hover:border-brand-500"
      >
        {busy ? t("uploading") : value ? t("replace") : t("upload")}
      </label>
      <input
        id={id}
        type="file"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-xs text-muted">{t("fileHint")}</p>
      {error && (
        <div role="alert" className="mt-1 text-sm text-danger-fg">
          <p>{error}</p>
          <SupportHint />
        </div>
      )}
    </div>
  );
}
