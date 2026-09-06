import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { ProcessingModule } from '../processing/processing.module';
import { ProcessingService } from '../processing/processing.service';
import { QUEUE_NAME, redisConnection } from '../processing/processing-queue';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ProcessingModule],
})
class WorkerModule {}
async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const service = app.get(ProcessingService);
  const logger = new Logger('ProcessingWorker');
  const worker = new Worker<{ commandId: string }>(
    QUEUE_NAME,
    async (job) => {
      await service.advance(job.data.commandId);
    },
    {
      connection: {
        ...redisConnection(app.get(ConfigService)),
        maxRetriesPerRequest: null,
      },
      concurrency: 8,
    },
  );
  worker.on('error', () =>
    logger.warn('Redis connection unavailable; reconnecting'),
  );
  worker.on('failed', (job, error) =>
    logger.error(
      `Action failed: commandId=${job?.data.commandId} ${error.message}`,
    ),
  );
  let reconciling = false;
  const reconcile = async () => {
    if (reconciling) return;
    reconciling = true;
    try {
      await service.reconcile();
    } catch {
      logger.error('Reconciliation failed; will retry in one minute');
    } finally {
      reconciling = false;
    }
  };
  const timer = setInterval(() => void reconcile(), 60000);
  void reconcile();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await worker.close();
    while (reconciling) await new Promise((resolve) => setTimeout(resolve, 50));
    await app.close();
  };
  process.once('SIGTERM', () => void stop());
  process.once('SIGINT', () => void stop());
  logger.log(
    'Worker started; poll=3s, processing deadline=5m, reconciliation=60s',
  );
}
void main().catch((error: unknown) => {
  new Logger('ProcessingWorker').error(error);
  process.exitCode = 1;
});
