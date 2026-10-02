import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/companion-browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5173", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1512, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: "npm run dev",
    env: { MARKET_SCHEDULER_DISABLED: "1", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" },
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
