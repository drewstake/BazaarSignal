import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/rules.test.ts", "tests/**/*.rules.test.ts", "tests/backend.test.ts", "tests/collector-store.test.ts", "tests/google-cache.test.ts"],
  },
});
