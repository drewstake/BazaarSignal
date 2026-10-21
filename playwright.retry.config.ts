import { defineConfig } from '@playwright/test';
import base from './playwright.private.config';

// Real signed-in portfolios, isolated emulators and intercepted market replies.
const webServer = base.webServer as Exclude<typeof base.webServer, unknown[] | undefined>;
export default defineConfig({
  ...base,
  testMatch: 'portfolio-retry.spec.ts',
  testIgnore: [],
  webServer: {
    ...webServer,
    env: {
      ...webServer.env,
      VITE_MARKET_UPDATES_PAUSED: 'false',
      VITE_MARKET_OPERATING_MODE: 'paid-budget',
      VITE_MARKET_TRIAL_ID: 'paid-202610',
      VITE_MARKET_TRIAL_END: '2026-11-01T07:00:00Z',
    },
  },
});
