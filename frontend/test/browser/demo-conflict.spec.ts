import { expect, test } from '@playwright/test';

test('a blocked demo start stays in history instead of opening a regular request', async ({
  page,
}) => {
  const requestId = '7aedb5e0-347d-4414-992a-89cb8c9600da';
  const headers = { 'X-Overtone-API-Version': '1' };
  const regular = {
    requestId,
    kind: 'regular',
    status: 'created',
    createdAt: '2026-09-05T10:00:00Z',
    closedAt: null,
    audioStored: false,
    error: null,
    commands: [],
  };
  let demoAttempts = 0;

  await page.route('**/api/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers,
      body: JSON.stringify({
        user: {
          id: '11111111-1111-4111-8111-111111111111',
          clinicId: '22222222-2222-4222-8222-222222222222',
          clinicName: 'Test clinic',
          email: 'doctor@example.com',
          permissions: ['requests:use', 'requests:demo'],
        },
      }),
    }),
  );
  await page.route('**/api/requests**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let status = 200;
    let body: unknown;
    if (path === '/api/requests/demo-capability')
      body = { kind: 'demo', ready: true };
    else if (path === '/api/requests' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({ kind: 'demo' });
      demoAttempts += 1;
      status = 409;
      body = {
        requestId,
        error: {
          code: 'ACTIVE_REQUEST_EXISTS',
          message: 'An unfinished request already exists',
        },
      };
    } else if (path === '/api/requests')
      body = { items: [regular], nextCursor: null };
    else body = regular;
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
  });

  await page.goto('/requests');
  await page.getByRole('button', { name: 'Начать демо-приём' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole('alert')).toContainText('Демо-приём не начат');
  await expect(page.getByRole('alert')).toContainText(
    'У вас уже есть незавершённый приём.',
  );
  await expect(page.locator('.demo-conflict')).toHaveCSS(
    'border-top-color',
    'rgb(229, 112, 124)',
  );
  await expect(page.locator('#recorderPanel')).toHaveCount(0);
  expect(demoAttempts).toBe(1);

  await page.getByRole('link', { name: 'Открыть незавершённый приём' }).click();
  await expect(page).toHaveURL(new RegExp(`/requests/${requestId}$`));
  await expect(page.locator('#recorderPanel')).toBeVisible();
});
