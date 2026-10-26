import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/server/env";
import { ERROR_KINDS } from "@/server/errors/alerts";
import { reportToTeam } from "@/server/errors/report";

/**
 * The browser reports every error a person is shown (see lib/client-errors.ts). Logged, and
 * emailed to ERROR_ALERT_EMAIL at most once per problem every 15 minutes. A plain route so it
 * keeps working on pages opened before a deploy.
 */
const body = z.object({
  kind: z.enum(ERROR_KINDS),
  message: z.string().max(2000),
  shown: z.string().max(500),
  where: z.string().max(60),
  url: z.string().max(1000),
  digest: z.string().max(100).optional(),
});

// Per instance: one browser stuck in a loop can't fill the audit log.
const recent = new Map<string, number[]>();
const PER_MINUTE = 10;
function tooMany(key: string, now: number) {
  const hits = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  hits.push(now);
  recent.set(key, hits);
  if (recent.size > 5000) recent.clear();
  return hits.length > PER_MINUTE;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(env().BETTER_AUTH_URL).origin && origin !== req.nextUrl.origin)
    return new NextResponse(null, { status: 403 });
  const raw = await req.text();
  if (raw.length > 6000) return new NextResponse(null, { status: 413 });
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (tooMany(ip, Date.now())) return new NextResponse(null, { status: 429 });

  await reportToTeam({ ...parsed, userAgent: req.headers.get("user-agent") ?? undefined });
  return new NextResponse(null, { status: 204 });
}
