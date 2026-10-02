import { defineConfig, devices } from "@playwright/test";

// Run with the Auth emulator; all market and alert API responses are intercepted.
// No real accounts, notifications, or Firestore writes are used.
export default defineConfig({
  testDir: "./tests/alerts-browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:5201", screenshot: "only-on-failure" },
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
    command: "npm run dev -- --port 5201 --strictPort",
    url: "http://127.0.0.1:5201",
    env: {
      MARKET_SCHEDULER_DISABLED: "1",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
      VITE_APP_MODE: "cloud",
      VITE_USE_EMULATORS: "true",
      VITE_BACKEND_READY: "true",
      VITE_FIREBASE_PROJECT_ID: "demo-bazaar-watch",
      VITE_FIREBASE_API_KEY: "demo-key",
      VITE_FIREBASE_AUTH_DOMAIN: "demo-bazaar-watch.firebaseapp.com",
      VITE_FIREBASE_APP_ID: "demo-app",
      VITE_APPS_SCRIPT_URL:
        "https://script.google.com/macros/s/test-alerts/exec",
    },
  },
});
