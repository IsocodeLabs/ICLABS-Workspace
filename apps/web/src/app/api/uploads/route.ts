import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { getSession } from "@/server/auth/session";
import { loadActor } from "@/server/auth/actor";
import { fileStore } from "@/server/stages/deps";
import { confirmUpload, requestUpload } from "@/server/storage/files";

/**
 * Candidate uploads: step 1 ("request") hands back a short-lived storage URL, step 2
 * ("confirm") checks the bytes arrived. A plain route, not a server action, on purpose:
 * action IDs change on every deploy, so a page opened before a deploy failed every upload
 * with "Server Action was not found". This URL stays the same across deploys.
 */
const body = z.discriminatedUnion("step", [
  z.object({
    step: z.literal("request"),
    filename: z.string().min(1).max(200),
    mime: z.string().max(120),
    size: z.number().int(),
  }),
  z.object({ step: z.literal("confirm"), fileId: z.string().min(1).max(40) }),
]);

// Storage errors are logged, not shown: the candidate gets a reason they can act on.
const UPLOAD_UNAVAILABLE =
  "We couldn't upload your file right now. Try again in a few minutes, or share it as a link if this keeps happening.";

const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  // Cookies ride along on cross-site requests; only accept calls from our own pages.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(env().BETTER_AUTH_URL).origin && origin !== req.nextUrl.origin)
    return fail("Upload from the workspace page itself.", 403);

  const session = await getSession();
  if (!session || session.user.kind !== "candidate")
    return fail("You've been signed out. Sign in again, then upload the file.", 401);
  if (session.user.mustChangePassword)
    return fail("Set your new password first, then upload the file.", 403);
  const actor = await loadActor(db(), session.user.id);
  if (actor?.kind !== "candidate" || !actor.active)
    return fail("You've been signed out. Sign in again, then upload the file.", 401);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Choose the file again.", 400);
  const input = parsed.data;
  try {
    const result =
      input.step === "request"
        ? await requestUpload(db(), fileStore(), actor, input)
        : await confirmUpload(db(), fileStore(), actor, input.fileId, env().SCAN_MODE);
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (e) {
    console.error(`upload ${input.step} failed`, e);
    return fail(UPLOAD_UNAVAILABLE, 503);
  }
}
