import { expect, test, type Page, type Route } from '@playwright/test';

const headers = { 'X-Overtone-API-Version': '1' };
const clinic = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Клиника №1',
  userCount: 0,
  createdAt: '2026-09-10T12:00:00Z',
};
const admin = {
  id: '22222222-2222-4222-8222-222222222222',
  clinicId: clinic.id,
  clinicName: clinic.name,
  email: 'admin@example.com',
  fullName: 'Администратор',
  position: null,
  specialization: null,
  permissions: [
    'requests:use',
    'admin:access',
    'admin:clinics:manage',
    'admin:users:manage',
  ],
};

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

async function emptyRequests(page: Page) {
  await page.route('**/api/requests**', (route) =>
    json(route, 200, { items: [], nextCursor: null }),
  );
}

test('logs in with administrator-issued email and password', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    json(route, 401, { error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }),
  );
  await page.route('**/api/auth/login', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'doctor@example.com',
      password: 'issued-password',
    });
    await json(route, 201, { user: { ...admin, permissions: ['requests:use'] } });
  });
  await emptyRequests(page);

  await page.goto('/login');
  await page.getByLabel('Почта').fill('doctor@example.com');
  await page.getByLabel('Пароль').fill('issued-password');
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.getByRole('heading', { name: 'Приёмы' })).toBeVisible();
});

test('clearly marks the dedicated administrator login', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    json(route, 401, { error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } }),
  );

  await page.goto('/admin');

  await expect(page.getByRole('heading', { name: 'Вход в админку' })).toBeVisible();
  await expect(page.getByText('OVERTONE · ADMIN')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти в админку' })).toBeVisible();
});

test('shows a generated password once and only its date after returning', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const users: Array<Record<string, unknown>> = [];
  await page.route('**/api/auth/session', (route) => json(route, 200, { user: admin }));
  await page.route('**/api/admin/clinics', async (route) => {
    await json(route, 200, { items: [clinic] });
  });
  await page.route('**/api/admin/users**', async (route) => {
    const request = route.request();
    if (request.method() === 'POST' && request.url().endsWith('/users')) {
      const input = request.postDataJSON() as Record<string, unknown>;
      const user = {
        ...input,
        id: '33333333-3333-4333-8333-333333333333',
        clinicName: clinic.name,
        blocked: false,
        blockedAt: null,
        passwordCreatedAt: '2026-09-10T12:30:00Z',
        createdAt: '2026-09-10T12:30:00Z',
        updatedAt: '2026-09-10T12:30:00Z',
      };
      users.push(user);
      await json(route, 201, { user, password: 'OneTime-Password-42' });
      return;
    }
    await json(route, 200, { items: users });
  });
  await emptyRequests(page);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Организации' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Пользователи' })).toHaveCount(0);
  await page.getByRole('tab', { name: /Пользователи/ }).click();
  await expect(page).toHaveURL(/\/admin\?section=users$/);
  await expect(page.getByRole('heading', { name: 'Пользователи' })).toBeVisible();
  await page.getByLabel('Почта').fill('doctor@example.com');
  await page.getByLabel('Клиника').first().selectOption(clinic.id);
  await page.getByRole('button', { name: 'Создать пользователя' }).click();

  await expect(page.getByText('OneTime-Password-42')).toBeVisible();
  await page.getByRole('button', { name: 'Скопировать пароль' }).click();
  await expect(page.getByText('Пароль скопирован')).toBeVisible();
  await page.getByRole('link', { name: 'Профиль' }).click();
  await page.getByRole('link', { name: 'Админка' }).click();
  await expect(page.getByText('OneTime-Password-42')).toHaveCount(0);
  await page.getByRole('tab', { name: /Пользователи/ }).click();
  await expect(page.getByText('doctor@example.com')).toBeVisible();
  await expect(page.getByText('Пароль создан')).toBeVisible();
});
