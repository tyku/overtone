import { expect, test } from '@playwright/test';

const expectedVersion = process.env.STACK_EXPECTED_VERSION ?? 'production-image-test';
const spaRoutes = ['/', '/login', '/requests', '/profile', '/admin'];

test('static origin serves health and every public SPA entry route', async ({ request }) => {
  const health = await request.get('/frontend-health');
  expect(health.status()).toBe(200);
  expect(await health.text()).toBe('ok\n');
  expect(health.headers()['cache-control']).toContain('no-store');

  for (const route of spaRoutes) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    expect(await response.text(), route).toContain('<div id="root"></div>');
    expect(response.headers()['cache-control'], route).toContain('no-store');
  }
});

test('static origin supports HEAD', async ({ request }) => {
  for (const route of ['/frontend-health', ...spaRoutes, '/version.json']) {
    const response = await request.head(route);
    expect(response.status(), route).toBe(200);
    expect((await response.body()).byteLength, route).toBe(0);
  }
});

test('version and entry document are never cached', async ({ request }) => {
  const version = await request.get('/version.json');
  expect(version.ok()).toBe(true);
  expect(version.headers()['cache-control']).toContain('no-store');
  await expect(version.json()).resolves.toEqual({
    version: expectedVersion,
  });

  const index = await request.get('/index.html');
  expect(index.ok()).toBe(true);
  expect(index.headers()['cache-control']).toContain('no-store');
});

test('fingerprinted Vite assets have a long immutable cache lifetime', async ({ request }) => {
  const index = await request.get('/index.html');
  const html = await index.text();
  const assetPath = html.match(/(?:src|href)="([^\"]*\/assets\/[^\"]+-[^\"]+\.(?:js|css))"/)?.[1];
  expect(assetPath).toBeTruthy();

  const asset = await request.get(assetPath!);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

  const assetHead = await request.head(assetPath!);
  expect(assetHead.status()).toBe(200);
  expect((await assetHead.body()).byteLength).toBe(0);
});

test('missing files and API paths are not rewritten to the SPA', async ({ request }) => {
  for (const path of ['/missing.js', '/nested/missing.css', '/api', '/api/health']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect(await response.text(), path).not.toContain('<div id="root"></div>');
  }
});

test('static responses carry baseline security headers', async ({ request }) => {
  for (const path of ['/', '/version.json', '/assets/missing.js']) {
    const response = await request.get(path);
    expect(response.headers()['x-content-type-options'], path).toBe('nosniff');
    expect(response.headers()['x-frame-options'], path).toBe('DENY');
    expect(response.headers()['referrer-policy'], path).toBe(
      'strict-origin-when-cross-origin',
    );
  }
});
