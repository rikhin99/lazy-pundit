import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/support/temp-root.ts"],
    // Draft and publish tests take 1–3s; the default 5s fails them when the
    // machine is busy, which turns the pre-commit hook red on correct code.
    testTimeout: 30_000,
  },
});
