import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each file gets its own in-process Postgres; argon2 hashing makes these a little slower.
    testTimeout: 30_000,
  },
});
