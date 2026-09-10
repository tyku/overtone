import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { PasswordService } from '../auth/password.service';
import { PERMISSIONS } from '../auth/auth.types';
import type { Permission } from '../auth/auth.types';
import type { AdminUserRow, ClinicRow } from './admin.types';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly passwords: PasswordService,
  ) {}

  async listClinics() {
    const result = await this.db.pool.query<ClinicRow>(
      `SELECT c.*, count(u.id)::integer AS user_count
       FROM clinics c LEFT JOIN users u ON u.clinic_id=c.id AND NOT u.is_system
       WHERE c.id<>'00000000-0000-4000-8000-000000000001'
       GROUP BY c.id ORDER BY c.name,id`,
    );
    return {
      items: result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        userCount: Number((row as ClinicRow & { user_count: number }).user_count),
        createdAt: row.created_at,
      })),
    };
  }

  async createClinic(body: unknown) {
    const name = requiredText(objectBody(body).name, 'name', 300);
    const result = await this.db.pool.query<ClinicRow>(
      'INSERT INTO clinics(id,name) VALUES($1,$2) RETURNING *',
      [randomUUID(), name],
    );
    const row = result.rows[0];
    return { id: row.id, name: row.name, userCount: 0, createdAt: row.created_at };
  }

  async listUsers() {
    const result = await this.db.pool.query<AdminUserRow>(userSelect());
    return { items: result.rows.map(viewUser) };
  }

  async createUser(body: unknown) {
    const input = createUserInput(body);
    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);
    const userId = randomUUID();
    const client = await this.db.pool.connect();
    try {
      const user = await this.db.transaction(client, async () => {
        try {
          await client.query(
            `INSERT INTO users(
              id,clinic_id,email,password_hash,password_created_at,full_name,position,specialization
            ) VALUES($1,$2,$3,$4,now(),$5,$6,$7)`,
            [
              userId,
              input.clinicId,
              input.email,
              passwordHash,
              input.fullName,
              input.position,
              input.specialization,
            ],
          );
        } catch (error) {
          translateConstraint(error);
        }
        await replacePermissions(client, userId, input.permissions);
        return this.getUser(userId, client);
      });
      return { user: viewUser(user), password };
    } finally {
      client.release();
    }
  }

  async updateUser(actorId: string, userId: string, body: unknown) {
    validateId(userId, 'userId');
    const value = objectBody(body);
    const allowed = [
      'clinicId',
      'fullName',
      'position',
      'specialization',
      'permissions',
      'blocked',
    ];
    if (!Object.keys(value).length || Object.keys(value).some((key) => !allowed.includes(key))) {
      throw invalid('Invalid user update');
    }
    const client = await this.db.pool.connect();
    try {
      return await this.db.transaction(client, async () => {
        const current = await this.getUser(userId, client, true);
        const permissions = has(value, 'permissions')
          ? permissionList(value.permissions)
          : current.permissions;
        const blocked = has(value, 'blocked')
          ? booleanValue(value.blocked, 'blocked')
          : current.blocked_at !== null;
        if (
          actorId === userId &&
          (blocked || !permissions.includes('admin:access'))
        ) {
          throw new ForbiddenException({
            error: {
              code: 'ADMIN_SELF_LOCKOUT',
              message: 'You cannot block yourself or remove your own admin access',
            },
          });
        }
        const clinicId = has(value, 'clinicId')
          ? idValue(value.clinicId, 'clinicId')
          : current.clinic_id;
        let result;
        try {
          result = await client.query<AdminUserRow>(
            `UPDATE users SET clinic_id=$2,full_name=$3,position=$4,specialization=$5,
               blocked_at=CASE WHEN $6 THEN COALESCE(blocked_at,now()) ELSE NULL END,
               updated_at=now()
             WHERE id=$1 AND NOT is_system RETURNING *`,
            [
              userId,
              clinicId,
              has(value, 'fullName')
                ? optionalText(value.fullName, 'fullName', 300)
                : current.full_name,
              has(value, 'position')
                ? optionalText(value.position, 'position', 200)
                : current.position,
              has(value, 'specialization')
                ? optionalText(value.specialization, 'specialization', 200)
                : current.specialization,
              blocked,
            ],
          );
        } catch (error) {
          translateConstraint(error);
        }
        if (!result.rows[0]) throw userNotFound();
        if (has(value, 'permissions')) {
          await replacePermissions(client, userId, permissions);
        }
        if (blocked) {
          await client.query('DELETE FROM user_sessions WHERE user_id=$1', [userId]);
        }
        return { user: viewUser(await this.getUser(userId, client)) };
      });
    } finally {
      client.release();
    }
  }

  async regeneratePassword(userId: string) {
    validateId(userId, 'userId');
    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);
    const client = await this.db.pool.connect();
    try {
      const user = await this.db.transaction(client, async () => {
        const result = await client.query(
          `UPDATE users SET password_hash=$2,password_created_at=now(),updated_at=now()
           WHERE id=$1 AND NOT is_system RETURNING id`,
          [userId, passwordHash],
        );
        if (!result.rows[0]) throw userNotFound();
        await client.query('DELETE FROM user_sessions WHERE user_id=$1', [userId]);
        return this.getUser(userId, client);
      });
      return { user: viewUser(user), password };
    } finally {
      client.release();
    }
  }

  async bootstrapAdmin(emailValue: unknown, clinicNameValue: unknown) {
    const email = adminEmail(emailValue);
    const clinicName = requiredText(clinicNameValue, 'clinicName', 300);
    const password = this.passwords.generate();
    const passwordHash = await this.passwords.hash(password);
    const client = await this.db.pool.connect();
    try {
      const user = await this.db.transaction(client, async () => {
        const existing = await client.query(
          `SELECT 1 FROM user_permissions WHERE permission='admin:access' LIMIT 1`,
        );
        if (existing.rowCount) {
          throw new ConflictException('An administrator already exists');
        }
        const clinicId = randomUUID();
        const userId = randomUUID();
        await client.query('INSERT INTO clinics(id,name) VALUES($1,$2)', [
          clinicId,
          clinicName,
        ]);
        await client.query(
          `INSERT INTO users(id,clinic_id,email,password_hash,password_created_at)
           VALUES($1,$2,$3,$4,now())`,
          [userId, clinicId, email, passwordHash],
        );
        await replacePermissions(client, userId, [...PERMISSIONS]);
        const claimed = await client.query(
          `UPDATE requests SET owner_id=$1
           WHERE owner_id='00000000-0000-4000-8000-000000000001'`,
          [userId],
        );
        return {
          user: await this.getUser(userId, client),
          claimedLegacyRequests: claimed.rowCount ?? 0,
        };
      });
      return {
        user: viewUser(user.user),
        password,
        claimedLegacyRequests: user.claimedLegacyRequests,
      };
    } finally {
      client.release();
    }
  }

  private async getUser(
    userId: string,
    client: PoolClient | Pool = this.db.pool,
    lock = false,
  ): Promise<AdminUserRow> {
    if (lock) {
      const locked = await client.query(
        'SELECT id FROM users WHERE id=$1 AND NOT is_system FOR UPDATE',
        [userId],
      );
      if (!locked.rows[0]) throw userNotFound();
    }
    const result = await client.query<AdminUserRow>(
      userSelect('AND u.id=$1'),
      [userId],
    );
    if (!result.rows[0]) throw userNotFound();
    return result.rows[0];
  }
}

function userSelect(extraWhere = '') {
  return `SELECT u.*,c.name AS clinic_name,
    COALESCE(array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL),'{}') AS permissions
    FROM users u JOIN clinics c ON c.id=u.clinic_id
    LEFT JOIN user_permissions p ON p.user_id=u.id
    WHERE NOT u.is_system ${extraWhere}
    GROUP BY u.id,c.name`;
}

function viewUser(row: AdminUserRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    clinicName: row.clinic_name,
    email: row.email,
    fullName: row.full_name,
    position: row.position,
    specialization: row.specialization,
    permissions: row.permissions,
    blocked: row.blocked_at !== null,
    blockedAt: row.blocked_at,
    passwordCreatedAt: row.password_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createUserInput(body: unknown) {
  const value = objectBody(body);
  const allowed = [
    'email',
    'clinicId',
    'permissions',
    'fullName',
    'position',
    'specialization',
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw invalid('Invalid user');
  }
  return {
    email: adminEmail(value.email),
    clinicId: idValue(value.clinicId, 'clinicId'),
    permissions:
      value.permissions === undefined
        ? (['requests:use'] as Permission[])
        : permissionList(value.permissions),
    fullName: optionalText(value.fullName, 'fullName', 300),
    position: optionalText(value.position, 'position', 200),
    specialization: optionalText(value.specialization, 'specialization', 200),
  };
}

async function replacePermissions(
  client: PoolClient,
  userId: string,
  permissions: Permission[],
) {
  await client.query('DELETE FROM user_permissions WHERE user_id=$1', [userId]);
  for (const permission of permissions) {
    await client.query(
      'INSERT INTO user_permissions(user_id,permission) VALUES($1,$2)',
      [userId, permission],
    );
  }
}

function permissionList(value: unknown): Permission[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalid('permissions must be an array');
  }
  const unique = [...new Set(value)];
  if (unique.some((item) => !PERMISSIONS.includes(item as Permission))) {
    throw invalid('Unknown permission');
  }
  return unique as Permission[];
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Expected an object');
  }
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, max: number): string {
  const result = optionalText(value, field, max);
  if (!result) throw invalid(`${field} is required`);
  return result;
}

function adminEmail(value: unknown): string {
  if (typeof value !== 'string') throw invalid('email is required');
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalid('Invalid email');
  }
  return email;
}

function optionalText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw invalid(`${field} must be a string`);
  const result = value.trim();
  if (!result || result.length > max) throw invalid(`Invalid ${field}`);
  return result;
}

function idValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw invalid(`${field} is required`);
  validateId(value, field);
  return value;
}

function validateId(value: string, field: string) {
  if (!uuid.test(value)) throw invalid(`Invalid ${field}`);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw invalid(`${field} must be boolean`);
  return value;
}

function has(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function translateConstraint(error: unknown): never {
  const code = (error as { code?: string }).code;
  if (code === '23505') throw new ConflictException('Email already exists');
  if (code === '23503') throw new BadRequestException('Clinic does not exist');
  throw error;
}

function invalid(message: string) {
  return new BadRequestException({
    error: { code: 'INVALID_ADMIN_REQUEST', message },
  });
}

function userNotFound() {
  return new NotFoundException({
    error: { code: 'USER_NOT_FOUND', message: 'User not found' },
  });
}
