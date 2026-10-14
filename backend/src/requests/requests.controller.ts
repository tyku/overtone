import {
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  ArgumentsHost,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestsService } from './requests.service';
import { AudioUploadService } from './audio-upload.service';
import { RequestError } from './request.types';
import { SessionGuard } from '../auth/session.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { join } from 'node:path';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';

@Catch()
export class RequestExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(RequestExceptionFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent || response.destroyed) return;
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
    } else {
      this.logger.error(
        'Request operation failed',
        error instanceof Error ? error.stack : undefined,
      );
      const request = host.switchToHttp().getRequest<Request>();
      response.status(503).json({
        requestId: request.params.id,
        error: {
          code: 'REQUEST_STATE_UNKNOWN',
          message: 'Service unavailable; check request state',
          retryAction: 'check_status',
        },
      });
    }
  }
}
@Controller('api/requests')
@UseFilters(RequestExceptionFilter)
@UseGuards(SessionGuard, PermissionsGuard)
@RequirePermissions('requests:use')
export class RequestsController {
  constructor(
    private readonly service: RequestsService,
    private readonly uploads: AudioUploadService,
  ) {}
  @Post() create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const value = body as Record<string, unknown> | null;
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'kind') ||
      (value.kind !== undefined &&
        value.kind !== 'regular' &&
        value.kind !== 'demo')
    ) {
      throw new RequestError(400, 'INVALID_REQUEST', 'Invalid request kind');
    }
    const kind = value.kind === 'demo' ? 'demo' : 'regular';
    if (kind === 'demo' && !user.permissions.includes('requests:demo')) {
      throw new RequestError(403, 'PERMISSION_DENIED', 'Permission denied');
    }
    return this.service.create(user.id, kind);
  }
  @Get(':id/demo-audio') async demoAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Res() response: Response,
  ) {
    if (!user.permissions.includes('requests:demo')) {
      throw new RequestError(403, 'PERMISSION_DENIED', 'Permission denied');
    }
    const row = await this.service.get(user.id, id);
    if (row.kind !== 'demo') {
      throw new RequestError(404, 'REQUEST_NOT_FOUND', 'Demo audio not found');
    }
    response
      .type('audio/mp4')
      .sendFile(join(process.cwd(), 'assets', 'demo.m4a'));
  }
  @Get() list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.list(user.id, limit, cursor);
  }
  @Get(':id') get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.get(user.id, id);
  }
  @Post(':id/complete') async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    this.service.validateId(id);
    // Avoid receiving large bodies for unknown requests, without holding a DB transaction.
    const row = await this.service.get(user.id, id);
    if (row.kind === 'demo' && !user.permissions.includes('requests:demo')) {
      throw new RequestError(403, 'PERMISSION_DENIED', 'Permission denied');
    }
    const audio = await this.uploads.receive(request);
    const result = await this.service.complete(user.id, id, audio);
    response.status(result.httpStatus).json(result.body);
  }
  @Post(':id/abandon') async abandon(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: Response,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'reason')
    )
      throw new RequestError(
        400,
        'INVALID_REQUEST',
        'Expected an optional reason',
      );
    const result = await this.service.abandon(
      user.id,
      id,
      (body as { reason?: string }).reason,
    );
    response.status(result.httpStatus).json(result.body);
  }
  @Get(':id/report') report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.report(user.id, id);
  }
  @Post(':id/retry-processing') async retryProcessing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res() response: Response,
  ) {
    response
      .status(200)
      .json(await this.service.retryProcessing(user.id, id, body));
  }
}
