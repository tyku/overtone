import { Controller, Get, Logger } from '@nestjs/common';

@Controller('api')
export class AppController {
  private readonly logger = new Logger(AppController.name);

  @Get('health')
  health() {
    this.logger.log('Health check requested');
    return { status: 'ok' };
  }
}
