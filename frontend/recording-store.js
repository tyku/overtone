const DATABASE_NAME = 'overtone-recordings';
const DATABASE_VERSION = 1;
const RECORDINGS_STORE = 'recordings';
const CHUNKS_STORE = 'chunks';
const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error), { once: true });
  });
}

export class RecordingStore {
  async initialize() {
    await this.database();
    await navigator.storage?.persist?.();
    return this.cleanupExpired();
  }

  async storageEstimate() {
    return navigator.storage?.estimate?.() ?? {};
  }

  async createRecording({ mimeType, inputLabel, trackSettings }) {
    const now = Date.now();
    const recording = {
      id: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      status: 'recording',
      mimeType,
      inputLabel,
      trackSettings,
      startedAt: now,
      updatedAt: now,
      expiresAt: now + RETENTION_MS,
      segments: [{ number: 1, mimeType, startedAt: now }],
    };
    await this.putRecording(recording);
    return { recording, segmentNo: 1 };
  }

  async resumeRecording(recordingId, { mimeType, inputLabel, trackSettings }) {
    const recording = await this.requireRecording(recordingId);
    const now = Date.now();
    const segmentNo = Math.max(0, ...recording.segments.map(({ number }) => number)) + 1;
    recording.status = 'recording';
    recording.mimeType = mimeType;
    recording.inputLabel = inputLabel;
    recording.trackSettings = trackSettings;
    recording.updatedAt = now;
    recording.expiresAt = now + RETENTION_MS;
    recording.segments.push({ number: segmentNo, mimeType, startedAt: now });
    await this.putRecording(recording);
    return { recording, segmentNo };
  }

  async addChunk({ recordingId, segmentNo, chunkNo, blob }) {
    const database = await this.database();
    const transaction = database.transaction(CHUNKS_STORE, 'readwrite');
    transaction.objectStore(CHUNKS_STORE).put({
      key: `${recordingId}:${segmentNo}:${chunkNo}`,
      recordingId,
      segmentNo,
      chunkNo,
      blob,
      createdAt: Date.now(),
    });
    await transactionDone(transaction);
  }

  async finishSegment(recordingId, segmentNo) {
    const recording = await this.requireRecording(recordingId);
    const segment = recording.segments.find(({ number }) => number === segmentNo);
    if (segment) segment.stoppedAt = Date.now();
    recording.status = 'ready';
    recording.updatedAt = Date.now();
    await this.putRecording(recording);
  }

  async markStatus(recordingId, status) {
    const recording = await this.requireRecording(recordingId);
    recording.status = status;
    recording.updatedAt = Date.now();
    await this.putRecording(recording);
  }

  async getRecording(recordingId) {
    const database = await this.database();
    const transaction = database.transaction(RECORDINGS_STORE, 'readonly');
    return requestResult(transaction.objectStore(RECORDINGS_STORE).get(recordingId));
  }

  async getRecoverableRecordings() {
    const database = await this.database();
    const transaction = database.transaction(RECORDINGS_STORE, 'readonly');
    const recordings = await requestResult(transaction.objectStore(RECORDINGS_STORE).getAll());
    return recordings
      .filter(({ status }) => status !== 'uploaded')
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async getSegments(recordingId) {
    const recording = await this.requireRecording(recordingId);
    const database = await this.database();
    const transaction = database.transaction(CHUNKS_STORE, 'readonly');
    const chunks = await requestResult(
      transaction.objectStore(CHUNKS_STORE).index('recordingId').getAll(recordingId),
    );
    const bySegment = new Map();
    for (const chunk of chunks.sort((left, right) => left.chunkNo - right.chunkNo)) {
      const segmentChunks = bySegment.get(chunk.segmentNo) ?? [];
      segmentChunks.push(chunk.blob);
      bySegment.set(chunk.segmentNo, segmentChunks);
    }
    return recording.segments
      .filter(({ number }) => bySegment.has(number))
      .sort((left, right) => left.number - right.number)
      .map((segment) => ({
        ...segment,
        blob: new Blob(bySegment.get(segment.number), { type: segment.mimeType }),
      }));
  }

  async deleteRecording(recordingId) {
    const database = await this.database();
    const transaction = database.transaction([RECORDINGS_STORE, CHUNKS_STORE], 'readwrite');
    transaction.objectStore(RECORDINGS_STORE).delete(recordingId);
    const cursorRequest = transaction
      .objectStore(CHUNKS_STORE)
      .index('recordingId')
      .openCursor(IDBKeyRange.only(recordingId));
    cursorRequest.addEventListener('success', () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    });
    await transactionDone(transaction);
  }

  async cleanupExpired(now = Date.now()) {
    const recordings = await this.getRecoverableRecordings();
    const expired = recordings.filter(({ expiresAt }) => expiresAt <= now);
    for (const recording of expired) await this.deleteRecording(recording.id);
    return expired.length;
  }

  async putRecording(recording) {
    const database = await this.database();
    const transaction = database.transaction(RECORDINGS_STORE, 'readwrite');
    transaction.objectStore(RECORDINGS_STORE).put(recording);
    await transactionDone(transaction);
  }

  async requireRecording(recordingId) {
    const recording = await this.getRecording(recordingId);
    if (!recording) throw new Error('Локальная запись не найдена');
    return recording;
  }

  database() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(RECORDINGS_STORE)) {
          database.createObjectStore(RECORDINGS_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(CHUNKS_STORE)) {
          const chunks = database.createObjectStore(CHUNKS_STORE, { keyPath: 'key' });
          chunks.createIndex('recordingId', 'recordingId');
        }
      });
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
      request.addEventListener('blocked', () => reject(new Error('Хранилище записей заблокировано другой вкладкой')), { once: true });
    });
    return this.databasePromise;
  }
}
