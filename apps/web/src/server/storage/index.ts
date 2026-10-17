import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage as GcsClient } from "@google-cloud/storage";

/**
 * Where candidate files live. Production: a private Cloud Storage bucket with short-lived
 * signed URLs (bytes never pass through the app). Development: a local folder.
 */
export interface FileStore {
  uploadUrl(
    key: string,
    contentType: string,
    size: number,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  downloadUrl(key: string, filename: string, inline: boolean): Promise<string>;
  size(key: string): Promise<number | null>;
  /** Deletes the object; missing objects are fine. */
  remove(key: string): Promise<void>;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allow-list by declared type; the extension must match too. */
export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": ["pdf"],
  "image/png": ["png"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/webp": ["webp"],
  "application/zip": ["zip"],
  "application/x-zip-compressed": ["zip"],
  "text/plain": ["txt"],
  "text/markdown": ["md"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ["pptx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
};

export const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export function checkUpload(filename: string, mime: string, size: number): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_TYPES[mime]?.includes(ext))
    return "This file type isn't allowed. Use PDF, images, ZIP, Office files or text.";
  if (size <= 0 || size > MAX_UPLOAD_BYTES)
    return "Files can be up to 25 MB. Share bigger work as a link.";
  if (filename.length > 200) return "File name is too long.";
  return null;
}

const safeName = (f: string) => f.replace(/[^\w.\- ]+/g, "_").slice(0, 150);

export function createGcsStore(bucketName: string): FileStore {
  const bucket = new GcsClient().bucket(bucketName);
  return {
    async uploadUrl(key, contentType, size) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: "write",
        expires: Date.now() + 10 * 60_000,
        contentType,
        extensionHeaders: { "x-goog-content-length-range": `0,${size}` },
      });
      return {
        url,
        headers: { "Content-Type": contentType, "x-goog-content-length-range": `0,${size}` },
      };
    },
    async downloadUrl(key, filename, inline) {
      const [url] = await bucket.file(key).getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + 5 * 60_000,
        responseDisposition: `${inline ? "inline" : "attachment"}; filename="${safeName(filename)}"`,
      });
      return url;
    },
    async size(key) {
      const [exists] = await bucket.file(key).exists();
      if (!exists) return null;
      const [meta] = await bucket.file(key).getMetadata();
      return Number(meta.size ?? 0);
    },
    async remove(key) {
      await bucket.file(key).delete({ ignoreNotFound: true });
    },
  };
}

/** Development only. Uploads go to /api/uploads/local with an HMAC-signed, expiring token. */
export function createLocalStore(dir: string, secret: string, baseUrl: string): FileStore {
  const sign = (key: string, exp: number, action: string) =>
    createHmac("sha256", secret).update(`${action}:${key}:${exp}`).digest("hex");
  const fileFor = (key: string) => {
    const full = path.resolve(dir, key);
    if (!full.startsWith(path.resolve(dir))) throw new Error("bad key");
    return full;
  };
  return {
    async uploadUrl(key, contentType) {
      const exp = Date.now() + 10 * 60_000;
      const q = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp, "put") });
      return { url: `${baseUrl}/api/uploads/local?${q}`, headers: { "Content-Type": contentType } };
    },
    async downloadUrl(key, filename, inline) {
      const exp = Date.now() + 5 * 60_000;
      const q = new URLSearchParams({
        key,
        exp: String(exp),
        sig: sign(key, exp, "get"),
        name: filename,
        inline: inline ? "1" : "0",
      });
      return `${baseUrl}/api/uploads/local?${q}`;
    },
    async size(key) {
      try {
        return (await stat(fileFor(key))).size;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(fileFor(key), { force: true });
    },
  };
}

export function verifyLocalToken(
  secret: string,
  key: string,
  exp: string,
  sig: string,
  action: "put" | "get",
): boolean {
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = createHmac("sha256", secret).update(`${action}:${key}:${exp}`).digest("hex");
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export async function writeLocal(dir: string, key: string, data: Buffer) {
  const full = path.resolve(dir, key);
  if (!full.startsWith(path.resolve(dir))) throw new Error("bad key");
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

export async function readLocal(dir: string, key: string) {
  const full = path.resolve(dir, key);
  if (!full.startsWith(path.resolve(dir))) throw new Error("bad key");
  return readFile(full);
}
