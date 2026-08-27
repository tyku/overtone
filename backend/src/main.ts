import { Logger, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';

function logLevelsForEnvironment(nodeEnv: string): LogLevel[] {
  return nodeEnv === 'development'
    ? ['log', 'error', 'warn', 'debug', 'verbose']
    : ['log', 'error', 'warn'];
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const logLevels = logLevelsForEnvironment(nodeEnv);
  Logger.overrideLogger(logLevels);
  app.useLogger(logLevels);
  const logger = new Logger('Bootstrap');
  logger.log(
    `Logger configuration: environment=${nodeEnv} levels=${logLevels.join(',')}`,
  );
  const frontendDir = join(process.cwd(), '..', 'frontend');
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
  app.useStaticAssets(frontendDir);
  const port = Number(config.get<string>('PORT', '3000'));
  await app.listen(port);
  logger.log(`Server started: http://localhost:${port}`);
  logger.log(`Static frontend directory: ${frontendDir}`);
  logger.log(
    `Recording upload endpoint: http://localhost:${port}/api/recordings`,
  );
}
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Server failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
