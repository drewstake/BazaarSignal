import { defineConfig } from '@playwright/test';
import base from './playwright.retry.config';
export default defineConfig({ ...base, testDir: './tests/audit-2026-10-29/private',
  testMatch: '**/*.spec.ts', outputDir: './test-results/audit-2026-10-29-private' });
