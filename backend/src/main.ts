import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { NextFunction, Request, Response } from 'express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`Server started: http://localhost:${port}`);
  logger.log(`Static frontend directory: ${frontendDir}`);
  logger.log(`WebSocket endpoint: ws://localhost:${port}/ws/recordings`);
}
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  logger.error(
    'Server failed to start',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
