import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { RequestStore, ABANDONED_RETENTION_MS } from '../../frontend/request-store.js';

test('frozen audio survives reload; final chunk is kept; force-close expires only audio', async () => {
  const store = new RequestStore();
  const id = crypto.randomUUID();
  await store.remember({ requestId: id, status: 'created', createdAt: new Date().toISOString() });
  await store.addPart(id, 'audio/webm');
  await store.addChunk(id, 1, 1, new Blob(['first']));
  await store.freeze(id);
  await store.addChunk(id, 1, 2, new Blob(['last']));
  const reopened = new RequestStore();
  await assert.rejects(() => reopened.addPart(id, 'audio/webm'), /завершён/);
  // Stale server state cannot unfreeze locally finalized audio.
  await reopened.remember({ requestId: id, status: 'created', createdAt: new Date().toISOString(), audioStored: false });
  assert.ok((await reopened.get(id)).frozenAt);
  assert.equal(await (await reopened.parts(id))[0].blob.text(), 'firstlast');
  const closedAt = new Date().toISOString();
  await reopened.remember({ requestId: id, status: 'abandoned', closedAt, audioStored: false });
  await reopened.cleanup(Date.parse(closedAt) + ABANDONED_RETENTION_MS - 1);
  assert.equal((await reopened.parts(id))[0].blob.size, 9);
  await reopened.cleanup(Date.parse(closedAt) + ABANDONED_RETENTION_MS);
  assert.equal((await reopened.parts(id))[0].blob.size, 0);
  assert.equal((await reopened.get(id)).status, 'abandoned');
});
test('S3 confirmation removes audio without losing report identity; active recordings never expire', async () => {
  const store = new RequestStore(); const id = crypto.randomUUID();
  await store.remember({ requestId: id, status: 'created', createdAt: new Date(0).toISOString() });
  await store.addPart(id, 'audio/webm'); await store.addChunk(id, 1, 1, new Blob(['audio']));
  await store.cleanup(Date.now() + 365 * 86400000);
  assert.equal((await store.parts(id))[0].blob.size, 5);
  await store.remember({ requestId: id, status: 'save_failed', audioStored: true });
  assert.equal((await store.parts(id))[0].blob.size, 0);
  assert.equal((await store.get(id)).requestId, id);
  await store.remember({ requestId: id, status: 'processing', audioStored: true });
  assert.equal((await store.get(id)).status, 'processing');
});
