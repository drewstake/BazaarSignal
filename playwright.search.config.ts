import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/search-browser",
  outputDir: './test-results/search-browser',
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5198", screenshot: "only-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort",
    url: "http://127.0.0.1:5198",
    reuseExistingServer: false,
    env: {
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
      MARKET_SCHEDULER_DISABLED: "1",
      VITE_LOCAL_WORKSPACE: "false",
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_APP_ID: "",
      VITE_MARKET_API_URL: "/live-market",
      // Browser tests intercept this prefix. Never enable the real proxy here.
      LOCAL_SHARED_MARKET: "false",
      VITE_LOCAL_MARKET_PREVIEW: "false",
      VITE_MARKET_UPDATES_PAUSED: "false",
      VITE_MARKET_OPERATING_MODE: "paid-budget",
      VITE_MARKET_TRIAL_ID: "search-browser",
      VITE_MARKET_TRIAL_END: "2026-11-01T07:00:00Z",
    },
  },
});
