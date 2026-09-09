import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ABANDONED_RETENTION_MS, RequestStore } from '../src/request-store';

const databaseName = 'overtone-recordings';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('RequestStore', () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it('keeps frozen audio across reopen and expires only force-closed audio', async () => {
    const store = new RequestStore();
    const requestId = crypto.randomUUID();
    await store.remember({
      requestId,
      status: 'created',
      createdAt: new Date().toISOString(),
      audioStored: false,
    });
    await store.addPart(requestId, 'audio/webm');
    await store.addChunk(requestId, 1, 1, new Blob(['first']));
    await store.freeze(requestId);
    await store.addChunk(requestId, 1, 2, new Blob(['last']));

    const reopened = new RequestStore();
    await expect(reopened.addPart(requestId, 'audio/webm')).rejects.toThrow(/завершён/);
    await reopened.remember({
      requestId,
      status: 'created',
      createdAt: new Date().toISOString(),
      audioStored: false,
    });
    expect((await reopened.get(requestId))?.frozenAt).toBeTruthy();
    expect(await (await reopened.parts(requestId))[0].blob.text()).toBe('firstlast');

    const closedAt = new Date().toISOString();
    await reopened.remember({
      requestId,
      status: 'abandoned',
      createdAt: new Date().toISOString(),
      closedAt,
      audioStored: false,
    });
    await reopened.cleanup(Date.parse(closedAt) + ABANDONED_RETENTION_MS - 1);
    expect((await reopened.parts(requestId))[0].blob.size).toBe(9);
    await reopened.cleanup(Date.parse(closedAt) + ABANDONED_RETENTION_MS);
    expect((await reopened.parts(requestId))[0].blob.size).toBe(0);
    expect((await reopened.get(requestId))?.status).toBe('abandoned');
  });

  it('removes confirmed S3 audio while retaining identity and never expires active audio', async () => {
    const store = new RequestStore();
    const requestId = crypto.randomUUID();
    await store.remember({
      requestId,
      status: 'created',
      createdAt: new Date(0).toISOString(),
      audioStored: false,
    });
    await store.addPart(requestId, 'audio/webm');
    await store.addChunk(requestId, 1, 1, new Blob(['audio']));
    await store.cleanup(Date.now() + 365 * 86_400_000);
    expect((await store.parts(requestId))[0].blob.size).toBe(5);

    await store.remember({
      requestId,
      status: 'save_failed',
      createdAt: new Date(0).toISOString(),
      audioStored: true,
    });
    expect((await store.parts(requestId))[0].blob.size).toBe(0);
    expect((await store.get(requestId))?.requestId).toBe(requestId);
    await store.remember({
      requestId,
      status: 'processing',
      createdAt: new Date(0).toISOString(),
      audioStored: true,
    });
    expect((await store.get(requestId))?.status).toBe('processing');
  });
});
