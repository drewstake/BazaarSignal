import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/local-workspace.rules.test.ts"],
    testTimeout: 30000,
  },
});
