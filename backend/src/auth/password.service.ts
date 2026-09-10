import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
const N = 2 ** 15;
const R = 8;
const P = 3;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;
const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await derive(password, salt, KEY_LENGTH, N, R, P);
    return [
      'scrypt',
      N,
      R,
      P,
      salt.toString('base64url'),
      derived.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, encoded: string): Promise<boolean> {
    const [algorithm, nValue, rValue, pValue, saltValue, hashValue] =
      encoded.split('$');
    if (
      algorithm !== 'scrypt' ||
      !nValue ||
      !rValue ||
      !pValue ||
      !saltValue ||
      !hashValue
    )
      return false;
    const n = Number(nValue);
    const r = Number(rValue);
    const p = Number(pValue);
    if (n !== N || r !== R || p !== P) return false;
    let expected: Buffer;
    let salt: Buffer;
    try {
      expected = Buffer.from(hashValue, 'base64url');
      salt = Buffer.from(saltValue, 'base64url');
    } catch {
      return false;
    }
    if (expected.length !== KEY_LENGTH || salt.length !== 16) return false;
    const actual = await derive(password, salt, expected.length, n, r, p);
    return timingSafeEqual(actual, expected);
  }

  async burn(password: string): Promise<void> {
    await this.hash(password);
  }

  generate(length = 20): string {
    if (!Number.isSafeInteger(length) || length < 16) {
      throw new Error('Generated passwords must contain at least 16 characters');
    }
    const result: string[] = [];
    const limit = 256 - (256 % PASSWORD_ALPHABET.length);
    while (result.length < length) {
      for (const value of randomBytes(length)) {
        if (value >= limit) continue;
        result.push(PASSWORD_ALPHABET[value % PASSWORD_ALPHABET.length]);
        if (result.length === length) break;
      }
    }
    return result.join('');
  }
}

function derive(
  password: string,
  salt: Buffer,
  length: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password.normalize('NFKC'),
      salt,
      length,
      { N: n, r, p, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}
