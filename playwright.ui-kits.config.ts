import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui-kits',
  fullyParallel: true,
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:5176', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run preview -- --port 5176 --strictPort',
    url: 'http://127.0.0.1:5176/ui-kits.html',
    reuseExistingServer: true,
  },
});
