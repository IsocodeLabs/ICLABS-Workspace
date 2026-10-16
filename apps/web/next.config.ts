import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  transpilePackages: ["@iclabs/core", "@iclabs/db"],
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite"],
  poweredByHeader: false,
  // What next-intl's plugin does, set directly: its plugin loads a native SWC binary that
  // fails on locked-down Windows machines and isn't needed for this alias.
  turbopack: { resolveAlias: { "next-intl/config": "./src/i18n/request.ts" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
