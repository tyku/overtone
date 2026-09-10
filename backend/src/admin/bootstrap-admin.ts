import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AdminService } from './admin.service';
import { BootstrapAdminModule } from './bootstrap-admin.module';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function bootstrap() {
  const email = argument('email');
  const clinic = argument('clinic');
  if (!email || !clinic) {
    throw new Error(
      'Usage: node dist/admin/bootstrap-admin.js --email admin@example.com --clinic "Clinic name"',
    );
  }
  const app = await NestFactory.createApplicationContext(BootstrapAdminModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await app.get(AdminService).bootstrapAdmin(email, clinic);
    process.stdout.write(
      [
        'Initial administrator created.',
        `Email: ${result.user.email}`,
        `Password (shown once): ${result.password}`,
        `Legacy requests assigned: ${result.claimedLegacyRequests}`,
      ].join('\n') + '\n',
    );
  } finally {
    await app.close();
  }
}

bootstrap().catch((error: unknown) => {
  new Logger('BootstrapAdmin').error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
