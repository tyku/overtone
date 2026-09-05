import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 30000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:55441', permissions: ['microphone'],
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'node test/static-server.mjs', url: 'http://127.0.0.1:55441', reuseExistingServer: false },
});
