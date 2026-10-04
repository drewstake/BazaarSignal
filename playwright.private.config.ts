import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/private-browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5199", screenshot: "only-on-failure" },
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
    command: "npm run dev:ui -- --port 5199 --strictPort",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: false,
    env: {
      VITE_USE_EMULATORS: "true",
      VITE_FIREBASE_PROJECT_ID: "demo-bazaar-watch",
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-bazaar-watch.firebaseapp.com",
      VITE_FIREBASE_APP_ID: "demo-app",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
      MARKET_SCHEDULER_DISABLED: '1',
      VITE_MARKET_UPDATES_PAUSED: 'true',
      VITE_MARKET_API_URL: 'http://127.0.0.1:5199',
      VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/portfolio-emulator/exec',
    },
  },
});
