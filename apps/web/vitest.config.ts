import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Each file boots its own in-process Postgres and runs migrations; argon2 hashing is slow
    // on purpose. Give setup room and cap parallelism so CI machines don't starve.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    maxWorkers: 4,
  },
});
