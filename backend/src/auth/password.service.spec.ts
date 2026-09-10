import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('stores a salted memory-hard hash and verifies the original password', async () => {
    const password = 'Correct horse battery staple 42!';
    const encoded = await service.hash(password);

    expect(encoded).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(encoded).not.toContain(password);
    await expect(service.verify(password, encoded)).resolves.toBe(true);
    await expect(service.verify('wrong password', encoded)).resolves.toBe(false);
  });

  it('generates non-empty one-time passwords with useful entropy', () => {
    const first = service.generate();
    const second = service.generate();

    expect(first).toHaveLength(20);
    expect(second).toHaveLength(20);
    expect(first).not.toBe(second);
  });
});

