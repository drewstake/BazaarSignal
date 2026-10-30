import { defineConfig } from '@playwright/test';
import base from './playwright.search.config';
export default defineConfig({ ...base, testDir: './tests/audit-2026-10-29/public',
  outputDir: './test-results/audit-2026-10-29-public' });
