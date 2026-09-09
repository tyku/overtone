import { Logger, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

function logLevelsForEnvironment(nodeEnv: string): LogLevel[] {
  return nodeEnv === 'development'
    ? ['log', 'error', 'warn', 'debug', 'verbose']
    : ['log', 'error', 'warn'];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const logLevels = logLevelsForEnvironment(nodeEnv);
  Logger.overrideLogger(logLevels);
  app.useLogger(logLevels);
  const logger = new Logger('Bootstrap');
  logger.log(
    `Logger configuration: environment=${nodeEnv} levels=${logLevels.join(',')}`,
  );
  app.use((request: Request, response: Response, next: NextFunction) => {
    const startedAt = performance.now();
    logger.log(
      `HTTP request started: ${request.method} ${request.originalUrl} from ${request.ip}`,
    );
    response.on('finish', () => {
      logger.log(
        `HTTP request completed: ${request.method} ${request.originalUrl} status=${response.statusCode} durationMs=${Math.round(performance.now() - startedAt)}`,
      );
    });
    response.on('error', (error) => {
      logger.error(
        `HTTP response error: ${request.method} ${request.originalUrl}`,
        error.stack,
      );
    });
    next();
  });
  const port = Number(config.get<string>('PORT', '3000'));
  // Technical upload timeout; deliberately unrelated to the report's 30s SLO.
  const uploadTimeoutMs = Number(config.get('HTTP_UPLOAD_TIMEOUT_MS', 2100000));
  if (!Number.isSafeInteger(uploadTimeoutMs) || uploadTimeoutMs < 1)
    throw new Error('Invalid HTTP_UPLOAD_TIMEOUT_MS');
  app.getHttpServer().requestTimeout = uploadTimeoutMs;
  await app.listen(port);
  logger.log(`Server started: http://localhost:${port}`);
  logger.log(`Requests API: http://localhost:${port}/api/requests`);
}
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Server failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
