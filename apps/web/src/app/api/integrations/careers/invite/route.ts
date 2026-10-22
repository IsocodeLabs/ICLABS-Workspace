import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { appUrl, queueEmail } from "@/server/email";
import { progressionDeps } from "@/server/stages/deps";
import { startApplication } from "@/server/stages/progression";
import {
  inviteShortlisted,
  shortlistSchema,
  verifyCareersRequest,
  type ShortlistResult,
} from "@/server/integrations/careers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ candidates: z.array(z.unknown()).min(1).max(100) });

/**
 * Careers admin → "Invite to workspace" for one or more shortlisted applicants.
 * Signed with CAREERS_WEBHOOK_SECRET. Each applicant gets its own result, so one bad row
 * never blocks the rest.
 */
export async function POST(req: Request) {
  const secret = env().CAREERS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 404 });

  const raw = await req.text();
  const signed = verifyCareersRequest(
    secret,
    {
      timestamp: req.headers.get("x-careers-timestamp"),
      signature: req.headers.get("x-careers-signature"),
    },
    raw,
  );
  if (!signed) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }

  const results: (ShortlistResult & { applicationId: string | null })[] = [];
  for (const item of body.candidates) {
    const parsed = shortlistSchema.safeParse(item);
    const applicationId =
      item && typeof item === "object" && "applicationId" in item
        ? String((item as { applicationId: unknown }).applicationId)
        : null;
    if (!parsed.success) {
      results.push({ applicationId, status: "error", reason: "Missing name, email or role." });
      continue;
    }
    try {
      const result = await inviteShortlisted(db(), parsed.data, {
        roleMap: env().CAREERS_ROLE_MAP,
        queueEmail,
        loginUrl: appUrl("/login"),
        onApplicationCreated: (id) => startApplication(db(), progressionDeps(), id),
      });
      results.push({ applicationId: parsed.data.applicationId, ...result });
    } catch (err) {
      console.error("careers_invite_failed", err);
      results.push({
        applicationId: parsed.data.applicationId,
        status: "error",
        reason: "Workspace error. Try again.",
      });
    }
  }
  return NextResponse.json({ results });
}
