import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { RequestsController } from './requests.controller';
import { DatabaseService } from '../database/database.service';
import { RequestsService } from './requests.service';
import { AudioUploadService } from './audio-upload.service';
import { RecordingAudioEncoderService } from '../recording-audio-encoder.service';
import { OBJECT_STORAGE } from '../object-storage/object-storage.types';
import { ProcessingService } from '../processing/processing.service';
import { ProcessingQueue } from '../processing/processing-queue';
import { InferenceClient } from '../processing/inference-client';
import type {
  ObjectStorageUpload,
  ObjectInfo,
} from '../object-storage/object-storage.types';
import { SessionGuard } from '../auth/session.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';

const TEST_USER_ID = '00000000-0000-4000-8000-000000000001';

type TestBody = {
  requestId: string;
  audioStored: boolean | null;
  error: { code: string; retryAction: string };
  content: string;
  nextCursor: string | null;
  items: { requestId: string }[];
};
const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
describeDb('Requests HTTP + PostgreSQL integration', () => {
  let app: INestApplication;
  let server: Server;
  let db: DatabaseService;
  let root: string;
  const objects = new Map<string, ObjectInfo & { content: Buffer }>();
  let storageFailure = false;
  let blockEncoding: (() => Promise<void>) | undefined;
  const encoder = {
    encodeToM4a: jest.fn(async (paths: string[], output: string) => {
      if (blockEncoding) await blockEncoding();
      await writeFile(
        output,
        Buffer.concat(await Promise.all(paths.map((path) => readFile(path)))),
      );
    }),
  };
  const storage = {
    headObject: jest.fn((key: string) => {
      if (storageFailure) throw new Error('S3 unavailable');
      return Promise.resolve(objects.get(key));
    }),
    uploadImmutable: jest.fn(async (input: ObjectStorageUpload) => {
      if (storageFailure) throw new Error('S3 unavailable');
      if (!objects.has(input.objectKey)) {
        const content = await readFile(input.sourcePath);
        objects.set(input.objectKey, {
          bucket: 'test',
          objectKey: input.objectKey,
          metadata: input.metadata ?? {},
          bytes: content.length,
          content,
        });
      }
    }),
    readText: jest.fn((key: string) =>
      Promise.resolve(objects.get(key)!.content.toString()),
    ),
  };
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'overtone-http-'));
    const module = await Test.createTestingModule({
      controllers: [RequestsController],
      providers: [
        DatabaseService,
        RequestsService,
        ProcessingService,
        { provide: ProcessingQueue, useValue: { publish: jest.fn() } },
        { provide: InferenceClient, useValue: {} },
        AudioUploadService,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            DATABASE_URL: process.env.TEST_DATABASE_URL,
            RECORDINGS_DIR: root,
          }),
        },
        { provide: OBJECT_STORAGE, useValue: storage },
        { provide: RecordingAudioEncoderService, useValue: encoder },
      ],
    })
      .overrideGuard(SessionGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp(): { getRequest(): AuthenticatedRequest };
        }) => {
          context.switchToHttp().getRequest().auth = {
            id: TEST_USER_ID,
            clinicId: TEST_USER_ID,
            clinicName: 'Test',
            email: 'test@example.com',
            fullName: null,
            position: null,
            specialization: null,
            permissions: ['requests:use'],
          };
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE request_events,processing_intents,processing_commands,requests',
    );
    objects.clear();
    storageFailure = false;
    blockEncoding = undefined;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  async function create() {
    return (
      (await request(server).post('/api/requests').send({}).expect(201))
        .body as { requestId: string }
    ).requestId;
  }
  function complete(id: string, bytes = Buffer.from('audio')) {
    return request(server)
      .post(`/api/requests/${id}/complete`)
      .field(
        'manifest',
        JSON.stringify({
          parts: [
            {
              partNo: 1,
              field: 'part_1',
              mimeType: 'audio/webm',
              bytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            },
          ],
        }),
      )
      .attach('part_1', bytes, {
        filename: 'part.webm',
        contentType: 'audio/webm',
      });
  }
  it('allows only one open request even under concurrent creation', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(server).post('/api/requests').send({}),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const id = (
      results.find((r) => r.status === 201)!.body as { requestId: string }
    ).requestId;
    for (const conflict of results.filter((r) => r.status !== 201)) {
      expect(conflict.status).toBe(409);
      expect(conflict.body).toMatchObject({
        requestId: id,
        error: { code: 'ACTIVE_REQUEST_EXISTS' },
      });
    }
  });
  it('freezes audio, commits one intent and replays completion without overwriting S3', async () => {
    const id = await create();
    await complete(id)
      .expect(200)
      .expect(({ body }) =>
        expect(body).toMatchObject({ status: 'processing', audioStored: true }),
      );
    await complete(id).expect(200);
    await request(server)
      .post(`/api/requests/${id}/complete`)
      .send({})
      .expect(200);
    await complete(id, Buffer.from('changed'))
      .expect(409)
      .expect(({ body }) =>
        expect((body as TestBody).error.code).toBe('AUDIO_CONTENT_CONFLICT'),
      );
    expect(encoder.encodeToM4a).toHaveBeenCalledTimes(1);
    expect(storage.uploadImmutable).toHaveBeenCalledTimes(1);
    expect(
      (await db.pool.query('SELECT * FROM processing_intents')).rowCount,
    ).toBe(1);
    await create();
  });
  it('resumes after S3 success / PostgreSQL transaction failure without audio', async () => {
    const id = await create();
    // A trigger aborts the transaction after S3 upload, also proving intent/status atomicity.
    await db.pool.query(
      "CREATE OR REPLACE FUNCTION reject_test_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='closed' THEN RAISE EXCEPTION 'injected close failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_close BEFORE INSERT ON request_events FOR EACH ROW EXECUTE FUNCTION reject_test_close()",
    );
    try {
      await complete(id)
        .expect(503)
        .expect(({ body }) =>
          expect((body as TestBody).error).toMatchObject({
            code: 'REQUEST_FINALIZATION_FAILED',
            retryAction: 'complete_without_audio',
          }),
        );
      expect(
        (await db.pool.query('SELECT * FROM processing_intents')).rowCount,
      ).toBe(0);
      await request(server)
        .get(`/api/requests/${id}`)
        .expect(200)
        .expect(({ body }) =>
          expect(body).toMatchObject({
            status: 'save_failed',
            audioStored: true,
          }),
        );
    } finally {
      await db.pool.query('DROP TRIGGER reject_close ON request_events');
    }
    await request(server)
      .post(`/api/requests/${id}/complete`)
      .send({})
      .expect(200);
    expect(storage.uploadImmutable).toHaveBeenCalledTimes(1);
  });
  it('distinguishes missing input from unknown S3 state', async () => {
    const id = await create();
    await request(server)
      .post(`/api/requests/${id}/complete`)
      .send({})
      .expect(409)
      .expect(({ body }) =>
        expect((body as TestBody).error.code).toBe('AUDIO_UPLOAD_REQUIRED'),
      );
    storageFailure = true;
    await complete(id)
      .expect(503)
      .expect(({ body }) =>
        expect((body as TestBody).error.code).toBe('REQUEST_STATE_UNKNOWN'),
      );
    await request(server)
      .get(`/api/requests/${id}`)
      .expect(200)
      .expect(({ body }) => expect((body as TestBody).audioStored).toBeNull());
    storageFailure = false;
    await complete(id).expect(200);
  });
  it('serializes complete/complete/abandon and does not close before encoding finishes', async () => {
    const id = await create();
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    blockEncoding = () => {
      entered();
      return wait;
    };
    const first = complete(id).then((r) => r);
    await started;
    await complete(id).expect(202);
    await request(server)
      .post(`/api/requests/${id}/abandon`)
      .send({})
      .expect(202);
    expect(
      (await db.pool.query('SELECT * FROM processing_intents')).rowCount,
    ).toBe(0);
    release();
    expect((await first).status).toBe(200);
    await request(server)
      .post(`/api/requests/${id}/abandon`)
      .send({})
      .expect(409);
  });
  it('force-closes idempotently and rejects late upload', async () => {
    const id = await create();
    await request(server)
      .post(`/api/requests/${id}/abandon`)
      .send({ reason: 'network failures' })
      .expect(200);
    await request(server)
      .post(`/api/requests/${id}/abandon`)
      .send({})
      .expect(200);
    await complete(id).expect(409);
    expect(
      (await db.pool.query('SELECT * FROM processing_intents')).rowCount,
    ).toBe(0);
    await create();
  });
  it('validates file integrity before freezing or writing to S3', async () => {
    const id = await create();
    await request(server)
      .post(`/api/requests/${id}/complete`)
      .field(
        'manifest',
        JSON.stringify({
          parts: [
            {
              partNo: 1,
              field: 'part_1',
              mimeType: 'audio/webm',
              bytes: 5,
              sha256: '0'.repeat(64),
            },
          ],
        }),
      )
      .attach('part_1', Buffer.from('audio'), 'x.webm')
      .expect(422);
    expect(storage.uploadImmutable).not.toHaveBeenCalled();
    expect(
      (
        await db.pool.query<{ fingerprint: string | null }>(
          'SELECT fingerprint FROM requests WHERE id=$1',
          [id],
        )
      ).rows[0].fingerprint,
    ).toBeNull();
  });
  it('paginates all outcomes without losing timestamp precision and serves verified reports', async () => {
    const id = await create();
    await complete(id).expect(200);
    const second = await create();
    await request(server)
      .post(`/api/requests/${second}/abandon`)
      .send({})
      .expect(200);
    await create();
    const first = await request(server)
      .get('/api/requests?limit=2')
      .expect(200);
    const page = await request(server)
      .get('/api/requests')
      .query({ limit: 2, cursor: (first.body as TestBody).nextCursor })
      .expect(200);
    expect(
      [...(first.body as TestBody).items, ...(page.body as TestBody).items].map(
        (item: { requestId: string }) => item.requestId,
      ),
    ).toHaveLength(3);
    await request(server).get(`/api/requests/${id}/report`).expect(409);
    const content = Buffer.from('# Report\n');
    const key = `requests/${id}/full-pipeline/test/clinical_document.md`;
    objects.set(key, {
      bucket: 'test',
      objectKey: key,
      bytes: content.length,
      metadata: {},
      content,
    });
    await db.pool.query(
      "UPDATE requests SET status='completed',report_key=$2,report_sha256=$3 WHERE id=$1",
      [id, key, createHash('sha256').update(content).digest('hex')],
    );
    await request(server)
      .get(`/api/requests/${id}/report`)
      .expect(200)
      .expect(({ body }) =>
        expect((body as TestBody).content).toBe(content.toString()),
      );
    objects.get(key)!.content = Buffer.from('tampered');
    await request(server).get(`/api/requests/${id}/report`).expect(502);
  });
});
