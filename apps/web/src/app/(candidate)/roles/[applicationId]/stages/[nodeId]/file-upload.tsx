"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { confirmUploadAction, requestUploadAction } from "@/app/(candidate)/stage-actions";

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
      const req = await requestUploadAction({
        filename: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
      if (!req.ok) throw new Error(req.error);
      const put = await fetch(req.url, { method: "PUT", headers: req.headers, body: file }).catch(
        () => null,
      );
      if (!put?.ok) throw new Error("Upload failed. Check your connection and try again.");
      const done = await confirmUploadAction(req.fileId);
      if (!done.ok) throw new Error(done.error);
      onChange({ id: req.fileId, name: file.name });
    } catch (e) {
      setError((e as Error).message);
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
      {error && <p className="mt-1 text-sm text-danger-fg">{error}</p>}
    </div>
  );
}
