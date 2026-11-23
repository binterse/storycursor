import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/system',
  timeout: 35000,
  projects: [{ name:'debug' }, { name:'release' }],
});
