import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.live.ts',
  timeout: 35000,
  workers: 1,
  outputDir: 'test-results/live',
});
