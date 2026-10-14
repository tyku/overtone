import { expect, test } from '@playwright/test';

function shortWav(): Buffer {
  const sampleBytes = 8_000 * 2;
  const wav = Buffer.alloc(44 + sampleBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8_000, 24);
  wav.writeUInt32LE(sampleBytes, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(sampleBytes, 40);
  return wav;
}

test('demo audio streams in the player and completes without multipart upload', async ({
  page,
}) => {
  const requestId = '7aedb5e0-347d-4414-992a-89cb8c9600da';
  const headers = { 'X-Overtone-API-Version': '1' };
  const row = {
    requestId,
    kind: 'demo',
    status: 'created',
    createdAt: '2026-10-15T00:00:00Z',
    closedAt: null,
    audioStored: false,
    error: null,
    commands: [],
  };
  const completions: Array<{ contentType: string; body: string | null }> = [];

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
    if (path.endsWith('/demo-audio'))
      return route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        headers,
        body: shortWav(),
      });
    let status = 200;
    let body: unknown;
    if (path === '/api/requests/demo-capability')
      body = { kind: 'demo', ready: true };
    else if (path === '/api/requests' && request.method() === 'POST') {
      status = 201;
      body = row;
    } else if (path === '/api/requests') body = { items: [], nextCursor: null };
    else if (path.endsWith('/complete')) {
      completions.push({
        contentType: request.headers()['content-type'],
        body: request.postData(),
      });
      row.status = 'processing';
      row.audioStored = true;
      body = row;
    } else body = row;
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
  });

  await page.goto('/requests');
  await page.getByRole('button', { name: 'Начать демо-приём' }).click();

  const audio = page.getByLabel('Аудио демо-приёма');
  await expect(audio).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Завершить приём' }),
  ).toBeEnabled();
  await expect(audio).toHaveAttribute(
    'src',
    `/api/requests/${requestId}/demo-audio`,
  );

  await page.getByRole('button', { name: 'Завершить приём' }).click();
  await expect(page.locator('#waitingPanel')).toBeVisible();
  expect(completions).toEqual([
    { contentType: 'application/json', body: '{}' },
  ]);
});
