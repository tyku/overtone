const DATABASE = 'overtone-recordings';
const REQUESTS = 'requests';
const CHUNKS = 'requestChunks';
export const ABANDONED_RETENTION_MS = 3 * 60 * 60 * 1000;
function result(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('Ошибка хранилища'));
  });
}
function eraseChunks(tx, requestId) {
  const cursor = tx
    .objectStore(CHUNKS)
    .index('requestId')
    .openCursor(IDBKeyRange.only(requestId));
  cursor.onsuccess = () => {
    const value = cursor.result;
    if (value) {
      value.delete();
      value.continue();
    }
  };
}
export class RequestStore {
  async database() {
    if (!this.opening)
      this.opening = new Promise((resolve, reject) => {
        const opening = indexedDB.open(DATABASE, 2);
        opening.onupgradeneeded = () => {
          const db = opening.result;
          // Preserve the old recordings/chunks stores for explicit export; never erase old audio.
          if (!db.objectStoreNames.contains(REQUESTS))
            db.createObjectStore(REQUESTS, { keyPath: 'requestId' });
          if (!db.objectStoreNames.contains(CHUNKS)) {
            const chunks = db.createObjectStore(CHUNKS, { keyPath: 'key' });
            chunks.createIndex('requestId', 'requestId');
          }
        };
        opening.onsuccess = () => {
          opening.result.onversionchange = () => opening.result.close();
          resolve(opening.result);
        };
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () =>
          reject(
            new Error(
              'Закройте другие вкладки Overtone для обновления хранилища',
            ),
          );
      });
    return this.opening;
  }
  async get(id) {
    const db = await this.database();
    return result(db.transaction(REQUESTS).objectStore(REQUESTS).get(id));
  }
  async all() {
    const db = await this.database();
    return result(db.transaction(REQUESTS).objectStore(REQUESTS).getAll());
  }
  async mutate(id, change) {
    const db = await this.database();
    const tx = db.transaction([REQUESTS, CHUNKS], 'readwrite');
    const completion = done(tx);
    try {
      const store = tx.objectStore(REQUESTS);
      const row = await result(store.get(id));
      if (!row) throw new Error('Локальная запись не найдена');
      change(row, tx);
      store.put(row);
      await completion;
      return row;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* transaction already complete */
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }
  async remember(server) {
    const db = await this.database();
    const tx = db.transaction([REQUESTS, CHUNKS], 'readwrite');
    const completion = done(tx);
    const store = tx.objectStore(REQUESTS);
    const row = (await result(store.get(server.requestId))) ?? {
      requestId: server.requestId,
      createdAt: server.createdAt,
      parts: [],
      frozenAt: null,
      audioStored: false,
      abandonedAt: null,
      expiresAt: null,
      captureError: null,
    };
    row.status = server.status;
    if (server.status !== 'created') row.frozenAt ??= Date.now();
    if (server.audioStored === true) {
      row.audioStored = true;
      eraseChunks(tx, row.requestId);
    }
    if (server.status === 'abandoned') {
      row.abandonedAt ??= server.closedAt
        ? Date.parse(server.closedAt)
        : Date.now();
      row.expiresAt = row.abandonedAt + ABANDONED_RETENTION_MS;
    }
    store.put(row);
    await completion;
    return row;
  }
  async addPart(id, mimeType) {
    return this.mutate(id, (row) => {
      if (row.frozenAt || row.abandonedAt || row.audioStored)
        throw new Error('Приём уже завершён: дозапись запрещена');
      row.parts.push({
        partNo: row.parts.length + 1,
        mimeType,
        startedAt: Date.now(),
        durationMs: 0,
      });
    });
  }
  async addChunk(id, partNo, chunkNo, blob) {
    const db = await this.database();
    const tx = db.transaction(CHUNKS, 'readwrite');
    const completion = done(tx);
    tx.objectStore(CHUNKS).put({
      key: `${id}:${partNo}:${chunkNo}`,
      requestId: id,
      partNo,
      chunkNo,
      blob,
    });
    await completion;
  }
  async finishPart(id, partNo) {
    return this.mutate(id, (row) => {
      const part = row.parts.find((p) => p.partNo === partNo);
      if (part) {
        part.stoppedAt = Date.now();
        part.durationMs = part.stoppedAt - part.startedAt;
      }
    });
  }
  async freeze(id) {
    return this.mutate(id, (row) => {
      row.frozenAt ??= Date.now();
    });
  }
  async captureFailed(id, message) {
    return this.mutate(id, (row) => {
      row.captureError = message;
    });
  }
  async parts(id) {
    const row = await this.get(id);
    if (!row) throw new Error('Локальное аудио не найдено');
    const db = await this.database();
    const chunks = await result(
      db.transaction(CHUNKS).objectStore(CHUNKS).index('requestId').getAll(id),
    );
    return row.parts.map((part) => ({
      ...part,
      blob: new Blob(
        chunks
          .filter((c) => c.partNo === part.partNo)
          .sort((a, b) => a.chunkNo - b.chunkNo)
          .map((c) => c.blob),
        { type: part.mimeType },
      ),
    }));
  }
  async cleanup(now = Date.now()) {
    for (const row of await this.all()) {
      if (row.abandonedAt && row.expiresAt <= now && !row.audioExpired)
        await this.mutate(row.requestId, (current, tx) => {
          eraseChunks(tx, current.requestId);
          current.audioExpired = true;
        });
    }
  }
  async legacy() {
    const db = await this.database();
    if (!db.objectStoreNames.contains('recordings')) return [];
    return result(
      db.transaction('recordings').objectStore('recordings').getAll(),
    );
  }
  async legacyParts(id) {
    const db = await this.database();
    if (!db.objectStoreNames.contains('chunks')) return [];
    const chunks = await result(
      db
        .transaction('chunks')
        .objectStore('chunks')
        .index('recordingId')
        .getAll(id),
    );
    const numbers = [...new Set(chunks.map((chunk) => chunk.segmentNo))].sort(
      (a, b) => a - b,
    );
    return numbers.map((number) => ({
      number,
      blob: new Blob(
        chunks
          .filter((c) => c.segmentNo === number)
          .sort((a, b) => a.chunkNo - b.chunkNo)
          .map((c) => c.blob),
      ),
    }));
  }
}
