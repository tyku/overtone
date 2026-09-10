import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { parseCookies, SessionGuard } from './session.guard';
import type { AuthenticatedUser } from './auth.types';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const result = await this.auth.login(
      input.email,
      input.password,
      request.ip ?? request.socket.remoteAddress ?? 'unknown',
    );
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(this.auth.cookieName, result.token, {
      httpOnly: true,
      secure: this.auth.secureCookie,
      sameSite: 'strict',
      path: '/',
      maxAge: this.auth.sessionTtlSeconds * 1000,
    });
    return { user: result.user };
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.logout(
      parseCookies(request.headers.cookie)[this.auth.cookieName],
    );
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(this.auth.cookieName, {
      httpOnly: true,
      secure: this.auth.secureCookie,
      sameSite: 'strict',
      path: '/',
    });
    return { loggedOut: true };
  }

  @Get('session')
  @UseGuards(SessionGuard)
  session(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Patch('profile')
  @UseGuards(SessionGuard)
  async profile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    return { user: await this.auth.updateProfile(user.id, body) };
  }
}
