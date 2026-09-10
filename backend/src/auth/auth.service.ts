import {
  Injectable,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from './password.service';
import type {
  AuthenticatedUser,
  Permission,
  UserRow,
} from './auth.types';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

@Injectable()
export class AuthService {
  readonly cookieName: string;
  readonly sessionTtlSeconds: number;
  readonly secureCookie: boolean;

  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
    config: ConfigService,
  ) {
    this.secureCookie = config.get<string>('NODE_ENV') === 'production';
    this.cookieName = this.secureCookie
      ? '__Host-overtone_session'
      : 'overtone_session';
    const ttlHours = Number(config.get<string>('SESSION_TTL_HOURS', '12'));
    if (!Number.isFinite(ttlHours) || ttlHours < 1 || ttlHours > 168) {
      throw new Error('SESSION_TTL_HOURS must be between 1 and 168');
    }
    this.sessionTtlSeconds = Math.floor(ttlHours * 60 * 60);
  }

  async login(emailValue: unknown, passwordValue: unknown, ip: string) {
    const email = normalizeEmail(emailValue);
    const password = validatePasswordInput(passwordValue);
    const bucket = this.loginBucket(email, ip);
    await this.assertLoginAllowed(bucket);
    const result = await this.db.pool.query<UserRow>(
      `SELECT u.*, c.name AS clinic_name,
        COALESCE(array_agg(p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
       FROM users u
       JOIN clinics c ON c.id=u.clinic_id
       LEFT JOIN user_permissions p ON p.user_id=u.id
       WHERE u.email=$1 AND NOT u.is_system
       GROUP BY u.id,c.name`,
      [email],
    );
    const row = result.rows[0];
    const valid = row?.password_hash
      ? await this.passwords.verify(password, row.password_hash)
      : (await this.passwords.burn(password), false);
    if (!valid || !row || row.blocked_at) {
      await this.recordLoginFailure(bucket);
      throw invalidCredentials();
    }
    await this.db.pool.query('DELETE FROM auth_login_buckets WHERE key_hash=$1', [
      bucket,
    ]);
    const token = randomBytes(32).toString('base64url');
    await this.db.pool.query(
      `INSERT INTO user_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,now()+($3 * interval '1 second'))`,
      [hashToken(token), row.id, this.sessionTtlSeconds],
    );
    return { token, user: this.view(row) };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.db.pool.query('DELETE FROM user_sessions WHERE token_hash=$1', [
      hashToken(token),
    ]);
  }

  async session(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token || token.length < 40 || token.length > 100) return null;
    const result = await this.db.pool.query<UserRow>(
      `SELECT u.*, c.name AS clinic_name,
        COALESCE(array_agg(p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions
       FROM user_sessions s
       JOIN users u ON u.id=s.user_id
       JOIN clinics c ON c.id=u.clinic_id
       LEFT JOIN user_permissions p ON p.user_id=u.id
       WHERE s.token_hash=$1 AND s.expires_at>now() AND u.blocked_at IS NULL
       GROUP BY u.id,c.name`,
      [hashToken(token)],
    );
    const row = result.rows[0];
    if (!row) {
      await this.logout(token);
      return null;
    }
    await this.db.pool.query(
      `UPDATE user_sessions SET last_seen_at=now()
       WHERE token_hash=$1 AND last_seen_at<now()-interval '5 minutes'`,
      [hashToken(token)],
    );
    return this.view(row);
  }

  async updateProfile(userId: string, body: unknown): Promise<AuthenticatedUser> {
    const input = profileInput(body);
    const result = await this.db.pool.query<UserRow>(
      `UPDATE users SET full_name=$2,position=$3,specialization=$4,updated_at=now()
       WHERE id=$1
       RETURNING *, (SELECT name FROM clinics WHERE id=clinic_id) AS clinic_name,
         ARRAY(SELECT permission FROM user_permissions WHERE user_id=$1 ORDER BY permission) AS permissions`,
      [userId, input.fullName, input.position, input.specialization],
    );
    if (!result.rows[0]) throw invalidCredentials();
    return this.view(result.rows[0]);
  }

  private view(row: UserRow): AuthenticatedUser {
    return {
      id: row.id,
      clinicId: row.clinic_id,
      clinicName: row.clinic_name,
      email: row.email,
      fullName: row.full_name,
      position: row.position,
      specialization: row.specialization,
      permissions: row.permissions as Permission[],
    };
  }

  private loginBucket(email: string, ip: string) {
    return createHash('sha256').update(`${email}\0${ip}`).digest('hex');
  }

  private async assertLoginAllowed(key: string) {
    const found = await this.db.pool.query<{ blocked_until: Date | null }>(
      'SELECT blocked_until FROM auth_login_buckets WHERE key_hash=$1',
      [key],
    );
    if (found.rows[0]?.blocked_until && found.rows[0].blocked_until > new Date()) {
      throw new HttpException({
        error: {
          code: 'LOGIN_RATE_LIMITED',
          message: 'Too many login attempts. Try again later.',
        },
      }, 429);
    }
  }

  private async recordLoginFailure(key: string) {
    await this.db.pool.query(
      `INSERT INTO auth_login_buckets(key_hash,failures,first_failed_at)
       VALUES($1,1,now())
       ON CONFLICT(key_hash) DO UPDATE SET
         failures=CASE WHEN auth_login_buckets.first_failed_at<now()-($2 * interval '1 millisecond') THEN 1 ELSE auth_login_buckets.failures+1 END,
         first_failed_at=CASE WHEN auth_login_buckets.first_failed_at<now()-($2 * interval '1 millisecond') THEN now() ELSE auth_login_buckets.first_failed_at END,
         blocked_until=CASE
           WHEN (CASE WHEN auth_login_buckets.first_failed_at<now()-($2 * interval '1 millisecond') THEN 1 ELSE auth_login_buckets.failures+1 END)>=$3
           THEN now()+($4 * interval '1 millisecond') ELSE auth_login_buckets.blocked_until END`,
      [key, LOGIN_WINDOW_MS, MAX_LOGIN_FAILURES, LOGIN_BLOCK_MS],
    );
  }
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalidCredentials();
  const email = value.trim().toLowerCase();
  if (
    email.length < 3 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
    throw invalidCredentials();
  return email;
}

function validatePasswordInput(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 1024) {
    throw invalidCredentials();
  }
  return value;
}

function profileInput(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new UnauthorizedException('Invalid profile');
  }
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).some(
      (key) => !['fullName', 'position', 'specialization'].includes(key),
    )
  )
    throw new UnauthorizedException('Invalid profile');
  return {
    fullName: optionalText(value.fullName, 300),
    position: optionalText(value.position, 200),
    specialization: optionalText(value.specialization, 200),
  };
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new UnauthorizedException('Invalid profile');
  const normalized = value.trim();
  if (!normalized || normalized.length > max)
    throw new UnauthorizedException('Invalid profile');
  return normalized;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function invalidCredentials() {
  return new UnauthorizedException({
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    },
  });
}
