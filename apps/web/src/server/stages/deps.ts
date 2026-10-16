import "server-only";
import path from "node:path";
import { db } from "../db";
import { env } from "../env";
import { appUrl, queueEmail } from "../email";
import { createGcsStore, createLocalStore, type FileStore } from "../storage";
import type { ProgressionDeps } from "./progression";

let reviewHook: ProgressionDeps["onAwaitingReview"];

/** M5 registers reviewer assignment here so stage code doesn't depend on review code. */
export function setAwaitingReviewHook(hook: ProgressionDeps["onAwaitingReview"]) {
  reviewHook = hook;
}

export function progressionDeps(): ProgressionDeps {
  return {
    queueEmail,
    appUrl,
    onAwaitingReview: (a, n) => reviewHook?.(a, n) ?? Promise.resolve(),
  };
}

let store: FileStore | undefined;

export function fileStore(): FileStore {
  if (!store) {
    const e = env();
    if (e.STORAGE_DRIVER === "gcs") {
      if (!e.GCS_BUCKET) throw new Error("GCS_BUCKET is required when STORAGE_DRIVER=gcs");
      store = createGcsStore(e.GCS_BUCKET);
    } else {
      if (e.NODE_ENV === "production")
        throw new Error("Local file storage is for development only");
      store = createLocalStore(localUploadDir(), e.BETTER_AUTH_SECRET, e.BETTER_AUTH_URL);
    }
  }
  return store;
}

export const localUploadDir = () => path.resolve(process.cwd(), env().LOCAL_UPLOAD_DIR);

export { db };
