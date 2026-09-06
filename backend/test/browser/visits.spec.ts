import { test, expect, Page } from '@playwright/test';
const id = '7aedb5e0-347d-4414-992a-89cb8c9600da';
type RequestError = { code: string; message: string; retryAction?: string };
type Command = { commandId: string; status: string };
type RequestRow = {
  requestId: string;
  status: string;
  createdAt: string;
  audioStored: boolean;
  error: RequestError | null;
  closedAt: string | null;
  commands: Command[];
};
async function fixture(page: Page) {
  const state = {
    row: {
      requestId: id,
      status: 'created',
      createdAt: '2026-09-05T10:00:00Z',
      audioStored: false,
      error: null,
      closedAt: null as string | null,
      commands: [],
    } as RequestRow,
    uploads: [] as { type: string; body: string }[],
    retries: [] as { commandId: string }[],
    fail: false,
    rows: [] as RequestRow[],
    reads: 0,
  };
  await page.route('**/api/requests**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let status = 200;
    let body: unknown;
    if (url.pathname === '/api/requests' && req.method() === 'POST') {
      status = 201;
      body = state.row;
      state.rows = [state.row];
    } else if (url.pathname === '/api/requests')
      body = { items: state.rows, nextCursor: null };
    else if (url.pathname.endsWith('/complete')) {
      state.uploads.push({
        type: String(req.headers()['content-type']),
        body: req.postDataBuffer()?.toString() ?? '',
      });
      if (state.fail) {
        state.row.status = 'save_failed';
        state.row.error = {
          code: 'REQUEST_FINALIZATION_FAILED',
          retryAction: 'complete_without_audio',
          message: 'Retry closing',
        };
        state.row.audioStored = true;
        status = 503;
        body = { requestId: id, error: state.row.error };
      } else {
        state.row.status = 'processing';
        state.row.audioStored = true;
        state.row.closedAt = new Date().toISOString();
        state.row.error = null;
        body = state.row;
      }
    } else if (url.pathname.endsWith('/retry-processing')) {
      state.retries.push(
        JSON.parse(req.postData() ?? '{}') as { commandId: string },
      );
      state.row.status = 'processing';
      state.row.error = null;
      body = state.row;
    } else if (url.pathname.endsWith('/abandon')) {
      state.row.status = 'abandoned';
      state.row.closedAt = new Date().toISOString();
      body = state.row;
    } else if (url.pathname.endsWith('/report'))
      body = {
        requestId: id,
        format: 'markdown',
        schemaVersion: 1,
        content:
          '# Итоговый отчёт\n\n**Рекомендации:** наблюдение.\n\n<script>window.injected=true</script><img src=x onerror="window.injected=true">',
      };
    else {
      state.reads += 1;
      body = state.row;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
  return state;
}
async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Начать новый приём' }).click();
  await page
    .getByRole('button', { name: 'Разрешить доступ к микрофону' })
    .click();
  await expect(page.locator('#audioInput')).toBeEnabled();
  await expect(
    page
      .locator('#audioInput option')
      .filter({ hasText: 'Fake Default Audio Input' }),
  ).toHaveCount(1);
  const value = await page
    .locator('#audioInput option')
    .evaluateAll(
      (options) =>
        (
          options.find(
            (option) => (option as HTMLOptionElement).value,
          ) as HTMLOptionElement
        ).value,
    );
  await page.locator('#audioInput').selectOption(value);
  await page
    .getByRole('button', { name: 'Начать запись', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Стоп записи' })).toBeVisible();
  await page.waitForTimeout(1150);
}
test('stop preserves audio; finish sends both parts once and waits without a 30s deadline', async ({
  page,
}) => {
  const state = await fixture(page);
  await start(page);
  await page.getByRole('button', { name: 'Стоп записи' }).click();
  expect(state.uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Продолжить запись' }).click();
  await page.waitForTimeout(1100);
  // One initial read plus a state check before each of the two recording starts; no timer polling.
  expect(state.reads).toBe(3);
  await page
    .getByRole('button', { name: 'Завершить приём', exact: true })
    .click();
  await expect(page.locator('#waitingPanel')).toBeVisible();
  expect(state.uploads).toHaveLength(1);
  expect(state.uploads[0].type).toContain('multipart/form-data');
  expect(state.uploads[0].body).toContain('name="part_1"');
  expect(state.uploads[0].body).toContain('name="part_2"');
  expect(state.uploads[0].body).toContain('name="manifest"');
  await expect(page.locator('#recorderPanel')).toBeHidden();
  await page.reload();
  await expect(page.locator('#waitingPanel')).toBeVisible();
  // Rendered report keeps the same node between polling updates and sanitizes model-produced HTML.
  state.row.status = 'completed';
  await expect(page.locator('#reportContent h1')).toHaveText('Итоговый отчёт', {
    timeout: 6000,
  });
  await expect(
    page.locator('#reportContent script, #reportContent img'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.has(window, 'injected'))).toBe(
    false,
  );
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать .md' }).click();
  expect((await downloading).suggestedFilename()).toContain('.md');
  await page.screenshot({
    path: '/private/tmp/overtone-api-tests/report-desktop.png',
    fullPage: true,
  });
});
test('failed finalization survives reload and retries without audio after S3 confirmation', async ({
  page,
}) => {
  const state = await fixture(page);
  state.fail = true;
  await start(page);
  await page
    .getByRole('button', { name: 'Завершить приём', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Повторить сохранение' }),
  ).toBeEnabled();
  await expect(page.locator('#requestStatus')).toHaveText('Ошибка сохранения');
  await page.reload();
  await expect(page.locator('#recorderPanel')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Продолжить запись' }),
  ).toHaveCount(0);
  state.fail = false;
  await page.getByRole('button', { name: 'Повторить сохранение' }).click();
  await expect(page.locator('#waitingPanel')).toBeVisible();
  expect(state.uploads).toHaveLength(2);
  expect(state.uploads[1].type).toContain('application/json');
  expect(state.uploads[1].body).toBe('{}');
});
test('force-close is explicit, keeps metadata and returns to the history on mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await fixture(page);
  state.fail = true;
  await start(page);
  await page
    .getByRole('button', { name: 'Завершить приём', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Закрыть без сохранения' }),
  ).toBeEnabled();
  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Закрыть без сохранения' }).click();
  await expect(page.locator('#abandonedPanel')).toBeVisible();
  await page.getByRole('link', { name: '← Все приёмы' }).click();
  await expect(page.locator('.request-card')).toHaveCount(1);
  await expect(page.locator('.request-card')).toContainText(
    'Закрыт без сохранения',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: '/private/tmp/overtone-api-tests/history-mobile.png',
    fullPage: true,
  });
});
test('processing failure retries the current command and returns to waiting', async ({
  page,
}) => {
  const state = await fixture(page);
  const commandId = 'f61c2520-d47f-493d-b7ba-842bc1e87b11';
  state.row.status = 'processing_failed';
  state.row.error = { code: 'PROCESSING_FAILED', message: 'GPU failed' };
  state.row.commands = [{ commandId, status: 'failed' }];
  state.rows = [state.row];
  await page.goto(`/#/requests/${id}`);
  await expect(page.locator('#failedPanel')).toBeVisible();
  await page.getByRole('button', { name: 'Повторить обработку' }).click();
  await expect(page.locator('#waitingPanel')).toBeVisible();
  expect(state.retries).toEqual([{ commandId }]);
});
