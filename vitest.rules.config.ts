import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/rules.test.ts", "tests/backend.test.ts", "tests/collector-store.test.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
