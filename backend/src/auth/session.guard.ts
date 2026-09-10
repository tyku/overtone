import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = parseCookies(request.headers.cookie)[this.auth.cookieName];
    const user = await this.auth.session(token);
    if (!user) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      });
    }
    (request as unknown as AuthenticatedRequest).auth = user;
    return true;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').flatMap((part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return [];
      const key = part.slice(0, separator).trim();
      try {
        return [[key, decodeURIComponent(part.slice(separator + 1).trim())]];
      } catch {
        return [];
      }
    }),
  );
}
