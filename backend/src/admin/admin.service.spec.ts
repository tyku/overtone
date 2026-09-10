import { AdminService } from './admin.service';

describe('AdminService one-time passwords', () => {
  const clinicId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const now = new Date('2026-09-10T12:00:00Z');
  const row = {
    id: userId,
    clinic_id: clinicId,
    clinic_name: 'Clinic',
    email: 'doctor@example.com',
    full_name: null,
    position: null,
    specialization: null,
    blocked_at: null,
    password_created_at: now,
    created_at: now,
    updated_at: now,
    permissions: ['requests:use'],
  };

  it('returns plaintext only from creation and writes only its hash', async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: jest.fn((sql: string, values?: unknown[]) => {
        queries.push({ sql, values });
        return Promise.resolve({ rows: sql.startsWith('SELECT u.*') ? [row] : [] });
      }),
      release: jest.fn(),
    };
    const database = {
      pool: { connect: jest.fn(() => Promise.resolve(client)) },
      transaction: jest.fn((_client: unknown, work: () => unknown) => work()),
    };
    const passwords = {
      generate: jest.fn(() => 'OneTime-Password-42'),
      hash: jest.fn(() => Promise.resolve('scrypt$stored-hash')),
    };
    const service = new AdminService(database as never, passwords as never);

    const result = await service.createUser({
      email: row.email,
      clinicId,
      permissions: ['requests:use'],
    });

    expect(result.password).toBe('OneTime-Password-42');
    const insert = queries.find((query) => query.sql.includes('INSERT INTO users'))!;
    expect(insert.values).toContain('scrypt$stored-hash');
    expect(insert.values).not.toContain('OneTime-Password-42');
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user.passwordCreatedAt).toEqual(now);
  });

  it('lists only the password creation date, never a password or hash', async () => {
    const database = {
      pool: { query: jest.fn(() => Promise.resolve({ rows: [row] })) },
    };
    const service = new AdminService(database as never, {} as never);

    const result = await service.listUsers();

    expect(result.items[0].passwordCreatedAt).toEqual(now);
    expect(result.items[0]).not.toHaveProperty('password');
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });
});

