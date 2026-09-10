import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { migrations } from './migrations';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

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

