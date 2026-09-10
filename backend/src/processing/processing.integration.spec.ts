import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  Server,
  ServerCredentials,
  loadPackageDefinition,
  status,
} from '@grpc/grpc-js';
import type {
  ServiceDefinition,
  ServerUnaryCall,
  sendUnaryData,
} from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { DatabaseService } from '../database/database.service';
import { ProcessingService } from './processing.service';
import { ProcessingQueue } from './processing-queue';
import { InferenceClient } from './inference-client';
import type { CommandRow, ProcessSnapshot } from './processing.types';
import type { DurableObjectStorage } from '../object-storage/object-storage.types';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;
describeDb('Processing: real PostgreSQL and gRPC', () => {
  let db: DatabaseService;
  let grpc: Server;
  let inference: InferenceClient;
  let service: ProcessingService;
  const remote = new Map<string, ProcessSnapshot>();
  const files = new Map<string, string>();
  const queue = {
    publish: jest.fn<Promise<void>, [CommandRow]>(() => Promise.resolve()),
  };
  let lostStart = false;
  let offline = false;
  let starts: string[] = [];
  const storage = {
    readText: jest.fn((key: string) => {
      if (!files.has(key)) throw new Error('S3 unavailable');
      return Promise.resolve(files.get(key)!);
    }),
  };
  beforeAll(async () => {
    grpc = new Server();
    const pkg = loadPackageDefinition(
      loadSync(join(__dirname, 'inference.proto'), {
        enums: String,
        defaults: true,
      }),
    ) as unknown as {
      medscribe: {
        inference: { v1: { InferenceService: { service: ServiceDefinition } } };
      };
    };
    grpc.addService(pkg.medscribe.inference.v1.InferenceService.service, {
      startFullPipeline: (
        call: ServerUnaryCall<
          { command: { commandId: string; requestId: string } },
          unknown
        >,
        cb: sendUnaryData<unknown>,
      ) => {
        const { commandId, requestId } = call.request.command;
        starts.push(commandId);
        if (!remote.has(commandId))
          remote.set(commandId, {
            commandId,
            requestId,
            status: 'PROCESS_RUNNING',
            currentStage: 'speech_core',
            resultKey: '',
            stages: [],
          });
        if (lostStart) {
          lostStart = false;
          cb({
            code: status.UNAVAILABLE,
            message: 'Lost acknowledgement after commit',
          });
        } else cb(null, { commandId });
      },
      getProcess: (
        call: ServerUnaryCall<{ commandId: string }, unknown>,
        cb: sendUnaryData<unknown>,
      ) => {
        if (offline)
          cb({ code: status.UNAVAILABLE, message: 'Network unavailable' });
        else if (!remote.has(call.request.commandId))
          cb({ code: status.NOT_FOUND, message: 'Unknown command' });
        else cb(null, remote.get(call.request.commandId));
      },
    });
    const port = await new Promise<number>((resolve, reject) =>
      grpc.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, value) => (err ? reject(err) : resolve(value)),
      ),
    );
    const config = new ConfigService({
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      INFERENCE_GRPC_ADDRESS: `127.0.0.1:${port}`,
    });
    db = new DatabaseService(config);
    await db.onModuleInit();
    inference = new InferenceClient(config);
    service = new ProcessingService(
      db,
      config,
      inference,
      queue as unknown as ProcessingQueue,
      storage as unknown as DurableObjectStorage,
    );
  });
  beforeEach(async () => {
    await db.pool.query(
      'TRUNCATE request_events,processing_intents,processing_commands,requests',
    );
    remote.clear();
    files.clear();
    starts = [];
    lostStart = false;
    offline = false;
    jest.clearAllMocks();
  });
  afterAll(async () => {
    inference.onModuleDestroy();
    grpc.forceShutdown();
    await db.onModuleDestroy();
  });
  async function create() {
    const requestId = randomUUID();
    const key = `requests/${requestId}/input/audio.m4a`;
    const client = await db.pool.connect();
    try {
      return await db.transaction(client, async () => {
        await client.query(
          "INSERT INTO requests(id,owner_id,status,closed_at,audio_stored,audio_key) VALUES($1,'00000000-0000-4000-8000-000000000001','processing',now(),true,$2)",
          [requestId, key],
        );
        await client.query(
          'INSERT INTO processing_intents(request_id,source_audio_key) VALUES($1,$2)',
          [requestId, key],
        );
        return service.create(client, requestId, key);
      });
    } finally {
      client.release();
    }
  }
  async function command(id: string) {
    return (
      await db.pool.query<CommandRow>(
        'SELECT * FROM processing_commands WHERE command_id=$1',
        [id],
      )
    ).rows[0];
  }
  async function advance(id: string) {
    await db.pool.query(
      "UPDATE processing_commands SET next_action_at=now()-interval '1 second' WHERE command_id=$1",
      [id],
    );
    await service.advance(id);
    return command(id);
  }
  function succeeded(c: CommandRow, content = '# Clinical report') {
    const prefix = `requests/${c.request_id}/full-pipeline/${c.command_id}/`;
    files.set(`${prefix}clinical_document.md`, content);
    files.set(
      `${prefix}stage-result.json`,
      JSON.stringify({
        schemaVersion: 'stage-result-v1',
        artifacts: [
          {
            name: 'clinical_document.md',
            key: `${prefix}clinical_document.md`,
            sha256: createHash('sha256').update(content).digest('hex'),
          },
        ],
      }),
    );
    remote.set(c.command_id, {
      ...remote.get(c.command_id)!,
      status: 'PROCESS_SUCCEEDED',
      currentStage: '',
      resultKey: `${prefix}stage-result.json`,
    });
  }
  it('repeats a lost Start response with the same ID, persists deadline, and completes with verified S3 output', async () => {
    const c = await create();
    lostStart = true;
    const first = await advance(c.command_id);
    expect(first.status).toBe('pending');
    expect(
      first.deadline_at!.getTime() - first.first_sent_at!.getTime(),
    ).toBeCloseTo(300000, -1);
    const second = await advance(c.command_id);
    expect(starts).toEqual([c.command_id, c.command_id]);
    expect(remote.size).toBe(1);
    expect(second.status).toBe('polling');
    expect(second.deadline_at).toEqual(first.deadline_at);
    expect(second.next_action_at!.getTime() - Date.now()).toBeGreaterThan(2500);
    succeeded(c);
    expect((await advance(c.command_id)).status).toBe('succeeded');
    const visit = (
      await db.pool.query<{ status: string; report_key: string }>(
        'SELECT * FROM requests WHERE id=$1',
        [c.request_id],
      )
    ).rows[0];
    expect(visit.status).toBe('completed');
    expect(visit.report_key).toContain(c.command_id);
  });
  it('serializes duplicate actions and recovers unpublished work via reconciliation', async () => {
    const c = await create();
    await service.reconcile();
    expect(queue.publish).toHaveBeenCalledWith(
      expect.objectContaining({ command_id: c.command_id }),
    );
    await Promise.all([
      service.advance(c.command_id),
      service.advance(c.command_id),
    ]);
    expect(starts).toHaveLength(1);
    await service.reconcile();
    expect(queue.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 1, status: 'polling' }),
    );
  });
  it('keeps transient status failures retryable without creating another GPU command', async () => {
    const c = await create();
    await advance(c.command_id);
    offline = true;
    const failedRead = await advance(c.command_id);
    expect(failedRead.status).toBe('polling');
    expect(failedRead.error?.code).toBe('PROCESSING_STATE_UNKNOWN');
    expect(starts).toHaveLength(1);
  });
  it('times out locally, blocks a concurrent GPU retry, and retrieves a late successful result', async () => {
    const c = await create();
    await advance(c.command_id);
    await db.pool.query(
      "UPDATE processing_commands SET deadline_at=now()-interval '1 second' WHERE command_id=$1",
      [c.command_id],
    );
    const timedOut = await advance(c.command_id);
    expect(timedOut.status).toBe('timed_out');
    expect(timedOut.remote_status).toBeNull();
    await expect(
      service.retry(c.request_id, c.command_id),
    ).rejects.toMatchObject({
      response: { error: { code: 'PROCESS_STILL_RUNNING' } },
    });
    expect(starts).toHaveLength(1);
    succeeded(c);
    await service.retry(c.request_id, c.command_id);
    expect((await command(c.command_id)).status).toBe('succeeded');
    expect(await service.history(c.request_id)).toHaveLength(1);
  });
  it('creates one new command after confirmed failure; duplicate manual retry remains idempotent', async () => {
    const c = await create();
    await advance(c.command_id);
    remote.get(c.command_id)!.status = 'PROCESS_FAILED';
    expect((await advance(c.command_id)).status).toBe('failed');
    await Promise.all([
      service.retry(c.request_id, c.command_id),
      service.retry(c.request_id, c.command_id),
    ]);
    await service.retry(c.request_id, c.command_id);
    const history = await service.history(c.request_id);
    expect(history).toHaveLength(2);
    expect(history[0].commandId).not.toBe(c.command_id);
    expect(history[1].status).toBe('failed');
  });
  it('does not mistake a lost heartbeat or unavailable status for permission to restart', async () => {
    const c = await create();
    await advance(c.command_id);
    remote.get(c.command_id)!.status = 'PROCESS_LOST';
    await advance(c.command_id);
    await expect(
      service.retry(c.request_id, c.command_id),
    ).rejects.toMatchObject({
      response: { error: { code: 'PROCESS_LOST_UNCONFIRMED' } },
    });
    offline = true;
    await expect(
      service.retry(c.request_id, c.command_id),
    ).rejects.toMatchObject({
      response: { error: { code: 'PROCESSING_STATE_UNKNOWN' } },
    });
    expect(await service.history(c.request_id)).toHaveLength(1);
  });
  it('retries S3 availability and rejects corrupted report bytes', async () => {
    const c = await create();
    await advance(c.command_id);
    succeeded(c);
    const key = remote.get(c.command_id)!.resultKey;
    const manifest = files.get(key)!;
    files.delete(key);
    expect((await advance(c.command_id)).status).toBe('polling');
    files.set(key, manifest);
    files.set(
      key.replace('stage-result.json', 'clinical_document.md'),
      'corrupted',
    );
    const result = await advance(c.command_id);
    expect(result.status).toBe('failed');
    expect(result.error?.code).toBe('REPORT_INTEGRITY_FAILED');
  });
});
