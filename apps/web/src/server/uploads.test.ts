import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, files, type Db } from "@iclabs/db";
import { createTestDb } from "@iclabs/db/testing";
import { createCandidateAccount } from "./auth/candidate-auth";
import { loadActor } from "./auth/actor";
import { checkUpload, MAX_UPLOAD_BYTES, normalizeMime, type FileStore } from "./storage";
import { checkOwnFiles, confirmUpload, requestUpload } from "./storage/files";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

/** In-memory store: records what was signed and lets a test say how many bytes "arrived". */
function memoryStore() {
  const sizes = new Map<string, number>();
  const signed: { key: string; contentType: string }[] = [];
  const store: FileStore = {
    async uploadUrl(key, contentType) {
      signed.push({ key, contentType });
      return { url: `https://storage.test/${key}`, headers: { "Content-Type": contentType } };
    },
    async downloadUrl(key) {
      return `https://storage.test/${key}`;
    },
    async size(key) {
      return sizes.get(key) ?? null;
    },
    async remove(key) {
      sizes.delete(key);
    },
  };
  return { store, sizes, signed };
}

async function candidate() {
  const c = await createCandidateAccount(db, { email: `u${Math.random()}@x.com`, name: "Riya" });
  const actor = await loadActor(db, c.userId);
  if (actor?.kind !== "candidate") throw new Error("expected candidate");
  return actor;
}

describe("normalizeMime", () => {
  it("maps what phones send for a PDF to application/pdf", () => {
    expect(normalizeMime("task.pdf", "")).toBe("application/pdf");
    expect(normalizeMime("task.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(normalizeMime("task.PDF", "application/x-pdf")).toBe("application/pdf");
    expect(normalizeMime("task.pdf", "Application/PDF; charset=binary")).toBe("application/pdf");
    expect(normalizeMime("photo.jpg", "image/jpg")).toBe("image/jpeg");
  });

  it("keeps a real declared type and leaves unknown files unknown", () => {
    expect(normalizeMime("notes.txt", "text/plain")).toBe("text/plain");
    expect(normalizeMime("tool.exe", "application/octet-stream")).toBe("application/octet-stream");
  });
});

describe("checkUpload", () => {
  it("accepts a PDF and explains each rejection", () => {
    expect(checkUpload("task.pdf", "application/pdf", 1000)).toBeNull();
    expect(checkUpload("task", "application/pdf", 1000)).toMatch(/no extension/);
    expect(checkUpload("tool.exe", "application/octet-stream", 1000)).toMatch(/isn't allowed/);
    expect(checkUpload("task.docx", "application/pdf", 1000)).toMatch(/ends in \.docx/);
    expect(checkUpload("task.pdf", "application/pdf", 0)).toMatch(/empty/);
    expect(checkUpload("task.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)).toMatch(/25 MB/);
  });
});

describe("upload flow", () => {
  it("lets a phone upload a PDF with no type, signed as application/pdf", async () => {
    const actor = await candidate();
    const { store, sizes, signed } = memoryStore();
    const req = await requestUpload(db, store, actor, {
      filename: "BD task.pdf",
      mime: "",
      size: 2048,
    });
    if (!req.ok) throw new Error(req.error);
    expect(signed.at(-1)?.contentType).toBe("application/pdf");
    expect(req.headers["Content-Type"]).toBe("application/pdf");
    const [row] = await db.select().from(files).where(eq(files.id, req.fileId));
    expect(row?.mime).toBe("application/pdf");

    sizes.set(signed.at(-1)!.key, 2048);
    expect(await confirmUpload(db, store, actor, req.fileId, "none")).toMatchObject({ ok: true });
    const checked = await checkOwnFiles(db, actor, [req.fileId]);
    expect(checked.ok.has(req.fileId)).toBe(true);
  });

  it("says why a confirm fails instead of a vague error", async () => {
    const actor = await candidate();
    const { store, sizes, signed } = memoryStore();
    const req = await requestUpload(db, store, actor, {
      filename: "a.pdf",
      mime: "application/pdf",
      size: 100,
    });
    if (!req.ok) throw new Error(req.error);
    const missing = await confirmUpload(db, store, actor, req.fileId, "none");
    expect(missing.ok ? "" : missing.error).toMatch(/didn't reach us/);
    sizes.set(signed.at(-1)!.key, 40);
    const partial = await confirmUpload(db, store, actor, req.fileId, "none");
    expect(partial.ok ? "" : partial.error).toMatch(/40 of 100 bytes/);
  });

  it("reports a file waiting for the virus scan as pending, not as a failed upload", async () => {
    const actor = await candidate();
    const { store, sizes, signed } = memoryStore();
    const req = await requestUpload(db, store, actor, {
      filename: "a.pdf",
      mime: "application/pdf",
      size: 10,
    });
    if (!req.ok) throw new Error(req.error);
    sizes.set(signed.at(-1)!.key, 10);
    await confirmUpload(db, store, actor, req.fileId, "clamav");
    const checked = await checkOwnFiles(db, actor, [req.fileId, "never-uploaded"]);
    expect(checked.ok.size).toBe(0);
    expect(checked.problems.get(req.fileId)).toBe("file_pending");
    expect(checked.problems.get("never-uploaded")).toBe("file");
  });

  it("never lets a candidate attach someone else's file", async () => {
    const owner = await candidate();
    const other = await candidate();
    const { store, sizes, signed } = memoryStore();
    const req = await requestUpload(db, store, owner, {
      filename: "a.pdf",
      mime: "application/pdf",
      size: 10,
    });
    if (!req.ok) throw new Error(req.error);
    sizes.set(signed.at(-1)!.key, 10);
    await confirmUpload(db, store, owner, req.fileId, "none");
    expect((await checkOwnFiles(db, other, [req.fileId])).ok.size).toBe(0);
    expect(await confirmUpload(db, store, other, req.fileId, "none")).toMatchObject({ ok: false });
  });
});
