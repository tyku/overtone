import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

// Versioned, transactionally applied migrations; no destructive automatic sync.
const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE requests (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('created','saving','save_failed','processing','completed','processing_failed','abandoned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  manifest jsonb,
  fingerprint text,
  audio_key text,
  audio_stored boolean NOT NULL DEFAULT false,
  error jsonb,
  abandon_reason text,
  report_key text,
  report_sha256 text,
  CHECK ((closed_at IS NULL) = (status IN ('created','saving','save_failed'))),
  CHECK (status NOT IN ('processing','completed','processing_failed') OR audio_stored),
  CHECK (status <> 'completed' OR (report_key IS NOT NULL AND report_sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX requests_one_open_owner ON requests(owner_id) WHERE closed_at IS NULL;
CREATE INDEX requests_history ON requests(owner_id, created_at DESC, id DESC);
CREATE TABLE request_events (
  id bigserial PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX request_events_request ON request_events(request_id, id);
CREATE TABLE processing_intents (
  request_id uuid PRIMARY KEY REFERENCES requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  source_audio_key text NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE processing_commands (
  command_id uuid PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id),
  source_audio_key text NOT NULL,
  parameters jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','polling','succeeded','failed','timed_out')),
  first_sent_at timestamptz,
  deadline_at timestamptz,
  next_action_at timestamptz,
  revision integer NOT NULL DEFAULT 0,
  remote_status text,
  snapshot jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE UNIQUE INDEX processing_commands_one_active ON processing_commands(request_id)
  WHERE status IN ('pending','polling');
CREATE INDEX processing_commands_due ON processing_commands(next_action_at) WHERE next_action_at IS NOT NULL;
CREATE INDEX processing_commands_history ON processing_commands(request_id,created_at);
ALTER TABLE processing_intents ADD COLUMN command_id uuid REFERENCES processing_commands(command_id);
`,
  },
];

@Injectable()
export class RequestDatabase implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  private readonly logger = new Logger(RequestDatabase.name);
  constructor(config: ConfigService) {
    const connectionString = config.get<string>('DATABASE_URL');
    if (!connectionString) throw new Error('DATABASE_URL is required');
    this.pool = new Pool({
      connectionString,
      max: 12,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', () =>
      this.logger.error('Idle PostgreSQL connection failed'),
    );
  }
  async onModuleInit() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('overtone:migrations', 0))",
      );
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      for (const migration of migrations) {
        const found = await client.query(
          'SELECT 1 FROM schema_migrations WHERE version=$1',
          [migration.version],
        );
        if (found.rowCount) continue;
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations(version) VALUES($1)',
          [migration.version],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  async transaction<T>(client: PoolClient, work: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      const result = await work();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
