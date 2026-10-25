import { and, eq, files, type Db } from "@iclabs/db";
import type { Actor } from "@iclabs/core";
import { checkUpload, INLINE_TYPES, normalizeMime, type FileStore } from "./index";

type CandidateActor = Extract<Actor, { kind: "candidate" }>;

/**
 * Step 1 of an upload: validate, create the file row, hand back a short-lived upload URL.
 * The browser sends the bytes straight to storage.
 */
export async function requestUpload(
  db: Db,
  store: FileStore,
  actor: CandidateActor,
  input: { filename: string; mime: string; size: number },
) {
  const mime = normalizeMime(input.filename, input.mime);
  const problem = checkUpload(input.filename, mime, input.size);
  if (problem) return { ok: false as const, error: problem };
  const [row] = await db
    .insert(files)
    .values({
      ownerCandidateId: actor.candidateId,
      objectKey: "",
      filename: input.filename,
      mime,
      size: input.size,
    })
    .returning();
  const objectKey = `uploads/${actor.candidateId}/${row!.id}`;
  await db.update(files).set({ objectKey }).where(eq(files.id, row!.id));
  const upload = await store.uploadUrl(objectKey, mime, input.size);
  return { ok: true as const, fileId: row!.id, ...upload };
}

/**
 * Step 2: confirm the bytes arrived with the declared size. With no scanner configured
 * (local/dev) files are marked clean; in production the ClamAV service reports back.
 */
export async function confirmUpload(
  db: Db,
  store: FileStore,
  actor: CandidateActor,
  fileId: string,
  scanMode: "none" | "clamav",
) {
  const [f] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.ownerCandidateId, actor.candidateId)));
  if (!f)
    return { ok: false as const, error: "We lost track of this upload. Choose the file again." };
  const actual = await store.size(f.objectKey);
  if (actual === null)
    return {
      ok: false as const,
      error: "The file didn't reach us. Check your connection and choose the file again.",
    };
  if (actual !== f.size)
    return {
      ok: false as const,
      error: `Only part of the file arrived (${actual} of ${f.size} bytes). Check your connection and choose the file again.`,
    };
  await db
    .update(files)
    .set({ uploadedAt: new Date(), scanStatus: scanMode === "none" ? "clean" : "pending" })
    .where(eq(files.id, fileId));
  return { ok: true as const, scanStatus: scanMode === "none" ? "clean" : "pending" };
}

/** Why an attached file can't be used, as a field error code (see stage.errors in messages). */
export type FileProblem = "file" | "file_pending" | "file_blocked";

/** Files a candidate may attach, plus the reason for each one that can't be. */
export async function checkOwnFiles(db: Db, actor: CandidateActor, ids: string[]) {
  const ok = new Set<string>();
  const problems = new Map<string, FileProblem>();
  if (ids.length === 0) return { ok, problems };
  const rows = await db.select().from(files).where(eq(files.ownerCandidateId, actor.candidateId));
  for (const id of ids) {
    const r = rows.find((row) => row.id === id);
    if (r?.uploadedAt && r.scanStatus === "clean") ok.add(id);
    else if (r?.uploadedAt && r.scanStatus === "pending") problems.set(id, "file_pending");
    else if (r?.uploadedAt) problems.set(id, "file_blocked");
    else problems.set(id, "file");
  }
  return { ok, problems };
}

/** Files a candidate may attach: their own, uploaded, and clean. */
export async function ownCleanFiles(db: Db, actor: CandidateActor, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await db.select().from(files).where(eq(files.ownerCandidateId, actor.candidateId));
  return rows.filter((r) => ids.includes(r.id) && r.uploadedAt && r.scanStatus === "clean");
}

export async function fileForDownload(db: Db, store: FileStore, fileId: string) {
  const [f] = await db.select().from(files).where(eq(files.id, fileId));
  if (!f || !f.uploadedAt || f.scanStatus !== "clean") return null;
  return {
    file: f,
    url: await store.downloadUrl(f.objectKey, f.filename, INLINE_TYPES.has(f.mime)),
  };
}
