import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import type { CommandRow } from './processing.types';

export const QUEUE_NAME = 'overtone-processing';
export function redisConnection(config: ConfigService) {
  const url = new URL(
    config.get<string>('REDIS_URL', 'redis://localhost:6379'),
  );
  if (!['redis:', 'rediss:'].includes(url.protocol))
    throw new Error('Invalid REDIS_URL protocol');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password
      ? decodeURIComponent(url.password)
      : config.get<string>('REDIS_PASSWORD'),
    db: Number(url.pathname.slice(1) || 0),
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
    connectTimeout: 3000,
  };
}
@Injectable()
export class ProcessingQueue implements OnModuleDestroy {
  private readonly logger = new Logger(ProcessingQueue.name);
  private queue?: Queue;
  constructor(private readonly config: ConfigService) {}
  async publish(command: CommandRow) {
    if (!command.next_action_at) return;
    if (!this.queue) {
      this.queue = new Queue(QUEUE_NAME, {
        connection: {
          ...redisConnection(this.config),
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
        },
      });
      this.queue.on('error', () =>
        this.logger.warn(
          'Redis unavailable; PostgreSQL retains pending actions',
        ),
      );
    }
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.queue.add(
          'advance',
          { commandId: command.command_id },
          {
            jobId: `${command.command_id}-${command.revision}`,
            delay: Math.max(0, command.next_action_at.getTime() - Date.now()),
            removeOnComplete: true,
            removeOnFail: true,
            attempts: 3,
            backoff: { type: 'fixed', delay: 3000 },
          },
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Redis publish timeout')),
            1500,
          );
        }),
      ]);
    } catch {
      this.logger.warn(
        `Queue delivery deferred: commandId=${command.command_id}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
  async onModuleDestroy() {
    await this.queue?.close();
  }
}
