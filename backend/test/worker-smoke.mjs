// Explicit opt-in: dedicated PostgreSQL, Redis and S3 only. Starts its own API/worker.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { Queue } from 'bullmq';
import pg from 'pg';

for (const key of ['TEST_DATABASE_URL', 'TEST_REDIS_URL', 'TEST_S3_ENDPOINT', 'TEST_GRPC_ADDRESS'])
  assert(process.env[key], `${key} is required; do not use production infrastructure`);
const env = { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL, REDIS_PASSWORD: '', S3_ENDPOINT: process.env.TEST_S3_ENDPOINT,
  S3_BUCKET: 'overtone-worker-test', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: 'testaccess', S3_SECRET_ACCESS_KEY: 'testsecret123',
  INFERENCE_GRPC_ADDRESS: process.env.TEST_GRPC_ADDRESS, INFERENCE_GRPC_TLS: 'false', INFERENCE_LLM_BACKEND: 'LOCAL',
  PORT: '55442', NODE_ENV: 'test', FFMPEG_PATH: process.env.TEST_FFMPEG || 'ffmpeg',
};
const storage = new S3Client({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, forcePathStyle: true,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
await storage.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET })).catch(error => {
  if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error;
});
const root = await mkdtemp(join(tmpdir(), 'overtone-worker-smoke-')); env.RECORDINGS_DIR = root;
let logs = ''; const children = new Set();
function launch(entry) {
  const child = spawn(process.execPath, [entry], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child); child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  return child;
}
async function stop(child) { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } children.delete(child); }
async function until(check, label) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  throw new Error(`Timed out: ${label}\n${logs}`);
}
async function call(path, options) {
  const response = await fetch(`http://127.0.0.1:55442/api/requests${path}`, options);
  const value = await response.json(); assert(response.ok, JSON.stringify(value)); return value;
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
assert(new URL(env.DATABASE_URL).pathname.includes('test'), 'Use a dedicated test database');
const redis = new URL(env.REDIS_URL);
const queue = new Queue('overtone-processing', { connection: { host: redis.hostname, port: Number(redis.port), maxRetriesPerRequest: 1 } });
try {
  await pool.query('TRUNCATE request_events,processing_intents,processing_commands,requests');
  launch('dist/main.js');
  await until(async () => { try { return (await fetch('http://127.0.0.1:55442/api/health')).ok; } catch { return false; } }, 'API readiness');
  const audio = join(root, 'part.webm');
  execFileSync(env.FFMPEG_PATH, ['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libopus',audio]);
  const bytes = await readFile(audio);
  async function visit() {
    const row = await call('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const manifest = { parts: [{ partNo: 1, field: 'part_1', mimeType: 'audio/webm', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] };
    const body = new FormData(); body.append('manifest', JSON.stringify(manifest)); body.append('part_1', new Blob([bytes], { type: 'audio/webm' }), 'part.webm');
    const saved = await call(`/${row.requestId}/complete`, { method: 'POST', body });
    assert.equal(saved.status,'processing'); return row.requestId;
  }
  const first = await visit();
  // Remove just this test queue before a worker exists: durable outbox must restore it.
  await queue.obliterate({ force: true });
  let worker = launch('dist/worker/main.js');
  await until(async () => (await call(`/${first}`)).status === 'completed', 'outbox restores erased Redis jobs');
  const report = await call(`/${first}/report`);
  assert.equal(report.format, 'markdown'); assert.match(report.content, /Integration fixture report/);
  const firstView = await call(`/${first}`); assert.equal(firstView.commands.length,1);
  const stages = await pool.query('SELECT status FROM medscribe.inference_process_stages WHERE process_id=(SELECT process_id FROM medscribe.inference_processes WHERE command_id=$1)', [firstView.commands[0].commandId]);
  assert.equal(stages.rows.length,5); assert(stages.rows.every(row => row.status === 'succeeded'));
  const second = await visit();
  await until(async () => (await call(`/${second}`)).commands[0]?.status === 'polling', 'start accepted');
  await stop(worker); await queue.obliterate({ force: true });
  worker = launch('dist/worker/main.js');
  await until(async () => (await call(`/${second}`)).status === 'completed', 'worker restart restores status poll');
  const secondView = await call(`/${second}`); assert.equal(secondView.commands.length,1);
  const remoteCount = await pool.query('SELECT count(*)::int AS count FROM medscribe.inference_processes WHERE request_id=$1', [second]);
  assert.equal(remoteCount.rows[0].count,1);
  console.log('PASS: HTTP upload → FFmpeg → S3 → PostgreSQL → BullMQ → medical-scribe async gRPC → five stages → verified report');
  console.log('PASS: erased queue recovery and worker restart preserve command identity');
} finally {
  for (const child of children) await stop(child);
  await queue.close(); await pool.end(); storage.destroy(); await rm(root, { recursive: true, force: true });
}
