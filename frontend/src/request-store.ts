import type {
  AudioPart,
  LegacyPart,
  LegacyRecording,
  LocalRequest,
  RequestRow,
} from './types';

const DATABASE = 'overtone-recordings';
const REQUESTS = 'requests';
const CHUNKS = 'requestChunks';
export const ABANDONED_RETENTION_MS = 3 * 60 * 60 * 1000;

interface RequestChunk {
  key: string;
  requestId: string;
  partNo: number;
  chunkNo: number;
  blob: Blob;
}

interface LegacyChunk {
  recordingId: string;
  segmentNo: number;
  chunkNo: number;
  blob: Blob;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('Ошибка хранилища'));
  });
}

function eraseChunks(transaction: IDBTransaction, requestId: string): void {
  const cursorRequest = transaction
    .objectStore(CHUNKS)
    .index('requestId')
    .openCursor(IDBKeyRange.only(requestId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
}

export class RequestStore {
  private opening?: Promise<IDBDatabase>;

  database(): Promise<IDBDatabase> {
    if (!this.opening) {
      this.opening = new Promise((resolve, reject) => {
        const opening = indexedDB.open(DATABASE, 2);
        opening.onupgradeneeded = () => {
          const database = opening.result;
          // Keep the previous stores: they contain audio users may still need to export.
          if (!database.objectStoreNames.contains(REQUESTS)) {
            database.createObjectStore(REQUESTS, { keyPath: 'requestId' });
          }
          if (!database.objectStoreNames.contains(CHUNKS)) {
            const chunks = database.createObjectStore(CHUNKS, { keyPath: 'key' });
            chunks.createIndex('requestId', 'requestId');
          }
        };
        opening.onsuccess = () => {
          opening.result.onversionchange = () => opening.result.close();
          resolve(opening.result);
        };
        opening.onerror = () => reject(opening.error);
        opening.onblocked = () =>
          reject(new Error('Закройте другие вкладки Overtone для обновления хранилища'));
      });
    }
    return this.opening;
  }

  async get(id: string): Promise<LocalRequest | undefined> {
    const database = await this.database();
    return result<LocalRequest | undefined>(
      database.transaction(REQUESTS).objectStore(REQUESTS).get(id),
    );
  }

  async all(): Promise<LocalRequest[]> {
    const database = await this.database();
    return result<LocalRequest[]>(
      database.transaction(REQUESTS).objectStore(REQUESTS).getAll(),
    );
  }

  private async mutate(
    id: string,
    change: (row: LocalRequest, transaction: IDBTransaction) => void,
  ): Promise<LocalRequest> {
    const database = await this.database();
    const transaction = database.transaction([REQUESTS, CHUNKS], 'readwrite');
    const completion = done(transaction);
    try {
      const requestStore = transaction.objectStore(REQUESTS);
      const row = await result<LocalRequest | undefined>(requestStore.get(id));
      if (!row) throw new Error('Локальная запись не найдена');
      change(row, transaction);
      requestStore.put(row);
      await completion;
      return row;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have completed.
      }
      await completion.catch(() => undefined);
      throw error;
    }
  }

  async remember(server: RequestRow): Promise<LocalRequest> {
    const database = await this.database();
    const transaction = database.transaction([REQUESTS, CHUNKS], 'readwrite');
    const completion = done(transaction);
    const requestStore = transaction.objectStore(REQUESTS);
    const row =
      (await result<LocalRequest | undefined>(requestStore.get(server.requestId))) ??
      ({
        requestId: server.requestId,
        createdAt: server.createdAt,
        status: server.status,
        parts: [],
        frozenAt: null,
        audioStored: false,
        abandonedAt: null,
        expiresAt: null,
        captureError: null,
      } satisfies LocalRequest);

    row.status = server.status;
    if (server.status !== 'created') row.frozenAt ??= Date.now();
    if (server.audioStored === true) {
      row.audioStored = true;
      eraseChunks(transaction, row.requestId);
    }
    if (server.status === 'abandoned') {
      row.abandonedAt ??= server.closedAt ? Date.parse(server.closedAt) : Date.now();
      row.expiresAt = row.abandonedAt + ABANDONED_RETENTION_MS;
    }
    requestStore.put(row);
    await completion;
    return row;
  }

  addPart(id: string, mimeType: string): Promise<LocalRequest> {
    return this.mutate(id, (row) => {
      if (row.frozenAt || row.abandonedAt || row.audioStored) {
        throw new Error('Приём уже завершён: дозапись запрещена');
      }
      row.parts.push({
        partNo: row.parts.length + 1,
        mimeType,
        startedAt: Date.now(),
        durationMs: 0,
      });
    });
  }

  async addChunk(id: string, partNo: number, chunkNo: number, blob: Blob): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CHUNKS, 'readwrite');
    const completion = done(transaction);
    transaction.objectStore(CHUNKS).put({
      key: `${id}:${partNo}:${chunkNo}`,
      requestId: id,
      partNo,
      chunkNo,
      blob,
    } satisfies RequestChunk);
    await completion;
  }

  finishPart(id: string, partNo: number): Promise<LocalRequest> {
    return this.mutate(id, (row) => {
      const part = row.parts.find((candidate) => candidate.partNo === partNo);
      if (part) {
        part.stoppedAt = Date.now();
        part.durationMs = part.stoppedAt - part.startedAt;
      }
    });
  }

  freeze(id: string): Promise<LocalRequest> {
    return this.mutate(id, (row) => {
      row.frozenAt ??= Date.now();
    });
  }

  captureFailed(id: string, message: string): Promise<LocalRequest> {
    return this.mutate(id, (row) => {
      row.captureError = message;
    });
  }

  async parts(id: string): Promise<AudioPart[]> {
    const row = await this.get(id);
    if (!row) throw new Error('Локальное аудио не найдено');
    const database = await this.database();
    const chunks = await result<RequestChunk[]>(
      database.transaction(CHUNKS).objectStore(CHUNKS).index('requestId').getAll(id),
    );
    return row.parts.map((part) => ({
      ...part,
      blob: new Blob(
        chunks
          .filter((chunk) => chunk.partNo === part.partNo)
          .sort((left, right) => left.chunkNo - right.chunkNo)
          .map((chunk) => chunk.blob),
        { type: part.mimeType },
      ),
    }));
  }

  async cleanup(now = Date.now()): Promise<void> {
    for (const row of await this.all()) {
      if (
        row.abandonedAt &&
        row.expiresAt !== null &&
        row.expiresAt <= now &&
        !row.audioExpired
      ) {
        await this.mutate(row.requestId, (current, transaction) => {
          eraseChunks(transaction, current.requestId);
          current.audioExpired = true;
        });
      }
    }
  }

  async legacy(): Promise<LegacyRecording[]> {
    const database = await this.database();
    if (!database.objectStoreNames.contains('recordings')) return [];
    return result<LegacyRecording[]>(
      database.transaction('recordings').objectStore('recordings').getAll(),
    );
  }

  async legacyParts(id: string): Promise<LegacyPart[]> {
    const database = await this.database();
    if (!database.objectStoreNames.contains('chunks')) return [];
    const chunks = await result<LegacyChunk[]>(
      database
        .transaction('chunks')
        .objectStore('chunks')
        .index('recordingId')
        .getAll(id),
    );
    const partNumbers = [...new Set(chunks.map((chunk) => chunk.segmentNo))].sort(
      (left, right) => left - right,
    );
    return partNumbers.map((number) => ({
      number,
      blob: new Blob(
        chunks
          .filter((chunk) => chunk.segmentNo === number)
          .sort((left, right) => left.chunkNo - right.chunkNo)
          .map((chunk) => chunk.blob),
      ),
    }));
  }
}
