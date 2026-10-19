import "server-only";
import path from "node:path";
import { db } from "../db";
import { env } from "../env";
import { appUrl, queueEmail } from "../email";
import { createGcsStore, createLocalStore, type FileStore } from "../storage";
import { assignReviewers } from "../reviews/assign";
import type { ProgressionDeps } from "./progression";

export function progressionDeps(): ProgressionDeps {
  return {
    queueEmail,
    appUrl,
    onAwaitingReview: async (applicationId, nodeId) => {
      await assignReviewers(db(), applicationId, nodeId);
    },
  };
}

let store: FileStore | undefined;

/**
 * The configured file store, set up on first real use. Work that touches no files (erasing a
 * candidate who never uploaded, the retention sweep) keeps working even if storage is misconfigured.
 */
export function fileStore(): FileStore {
  return {
    uploadUrl: async (...a) => configuredStore().uploadUrl(...a),
    downloadUrl: async (...a) => configuredStore().downloadUrl(...a),
    size: async (...a) => configuredStore().size(...a),
    remove: async (...a) => configuredStore().remove(...a),
  };
}

function configuredStore(): FileStore {
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
