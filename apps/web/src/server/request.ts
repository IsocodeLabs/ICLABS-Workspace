import "server-only";
import { headers } from "next/headers";
import { isMobileClient } from "@iclabs/core";

/** Client IP as seen by the Google load balancer (first X-Forwarded-For hop). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

export async function isMobileRequest(): Promise<boolean> {
  const h = await headers();
  return isMobileClient({
    secChUaMobile: h.get("sec-ch-ua-mobile"),
    userAgent: h.get("user-agent"),
  });
}
