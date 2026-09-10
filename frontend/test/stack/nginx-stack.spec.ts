import { expect, test } from '@playwright/test';

const requestId = '7aedb5e0-347d-4414-992a-89cb8c9600da';

test('Nginx serves the SPA and proxies API polling through to a completed report', async ({
  page,
  request,
}) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBe(true);
  expect(health.headers()['x-overtone-api-version']).toBe('1');
  expect(health.headers()['x-overtone-supported-api-versions']).toBe('1');
  await expect(health.json()).resolves.toEqual({
    status: 'ok',
    version: 'smoke',
  });

  const nestedRoute = await page.goto('/some/nested/route');
  expect(nestedRoute?.ok()).toBe(true);
  await expect(page.getByRole('link', { name: 'Overtone' })).toBeVisible();

  await page.goto(`/#/requests/${requestId}`);
  await expect(page.locator('#waitingPanel')).toBeVisible();
  await expect(page.locator('#reportContent h1')).toHaveText('Smoke report', {
    timeout: 10_000,
  });
});

test('Nginx applies cache policy and the API port does not serve frontend', async ({ request }) => {
  const version = await request.get('/version.json');
  expect(version.ok()).toBe(true);
  expect(version.headers()['cache-control']).toContain('no-cache');
  await expect(version.json()).resolves.toEqual({
    version: 'smoke',
  });

  const index = await request.get('/index.html');
  expect(index.ok()).toBe(true);
  expect(index.headers()['cache-control']).toContain('no-cache');
  const html = await index.text();
  const assetPath = html.match(/src="([^\"]*\/assets\/[^\"]+\.js)"/)?.[1];
  expect(assetPath).toBeTruthy();

  const asset = await request.get(assetPath!);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()['cache-control']).toContain('immutable');

  const apiBaseUrl = process.env.STACK_API_URL ?? 'http://127.0.0.1:18081';
  const backendRoot = await request.get(`${apiBaseUrl}/`);
  expect(backendRoot.status()).toBe(404);
  expect(await backendRoot.text()).not.toContain('<div id="root"></div>');
});
