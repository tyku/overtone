import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/stack',
  outputDir: './test-results/stack',
  timeout: 20_000,
  workers: 1,
  use: {
    baseURL: process.env.STACK_BASE_URL ?? 'http://127.0.0.1:18080',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
