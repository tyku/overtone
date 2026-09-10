import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest, Permission } from './auth.types';

const PERMISSIONS_KEY = 'overtone:permissions';

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    if (required.every((permission) => request.auth.permissions.includes(permission))) {
      return true;
    }
    throw new ForbiddenException({
      error: { code: 'PERMISSION_DENIED', message: 'Permission denied' },
    });
  }
}

