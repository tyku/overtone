import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  outputDir: './test-results/browser',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:55441',
    permissions: ['microphone'],
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 55441',
    url: 'http://127.0.0.1:55441',
    reuseExistingServer: false,
  },
});
