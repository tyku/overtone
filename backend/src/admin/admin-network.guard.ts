import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { isIP } from 'node:net';

type NetworkMode = 'unrestricted' | 'allowlist' | 'deny';

@Injectable()
export class AdminNetworkGuard implements CanActivate {
  private readonly mode: NetworkMode;
  private readonly ranges: CidrRange[];

  constructor(config: ConfigService) {
    const nodeEnv = config.get<string>('NODE_ENV', 'development');
    const configured = config.get<string>('ADMIN_NETWORK_MODE');
    this.mode = parseMode(
      configured ?? (nodeEnv === 'development' ? 'unrestricted' : 'deny'),
    );
    this.ranges = (config.get<string>('ADMIN_ALLOWED_CIDRS', '') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(parseCidr);
  }

  canActivate(context: ExecutionContext): boolean {
    if (this.mode === 'unrestricted') return true;
    const request = context.switchToHttp().getRequest<Request>();
    const allowed =
      this.mode === 'allowlist' &&
      this.ranges.some((range) => cidrContains(range, request.ip ?? ''));
    if (allowed) return true;
    throw new ForbiddenException({
      error: {
        code: 'ADMIN_NETWORK_DENIED',
        message: 'Administration is unavailable from this network',
      },
    });
  }
}

type CidrRange = {
  version: 4 | 6;
  network: bigint;
  prefix: number;
};

function parseMode(value: string): NetworkMode {
  if (value === 'unrestricted' || value === 'allowlist' || value === 'deny') {
    return value;
  }
  throw new Error('ADMIN_NETWORK_MODE must be unrestricted, allowlist or deny');
}

export function parseCidr(value: string): CidrRange {
  const [addressValue, prefixValue] = value.split('/');
  const version = isIP(addressValue);
  if (version !== 4 && version !== 6) throw new Error(`Invalid CIDR: ${value}`);
  const bits = version === 4 ? 32 : 128;
  const prefix = prefixValue === undefined ? bits : Number(prefixValue);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
    throw new Error(`Invalid CIDR prefix: ${value}`);
  }
  const address = addressToBigInt(normalizeIp(addressValue), version);
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { version, network: address & mask, prefix };
}

export function cidrContains(range: CidrRange, ipValue: string): boolean {
  const ip = normalizeIp(ipValue);
  const version = isIP(ip);
  if (version !== range.version) return false;
  const bits = version === 4 ? 32 : 128;
  const mask =
    range.prefix === 0
      ? 0n
      : ((1n << BigInt(range.prefix)) - 1n) << BigInt(bits - range.prefix);
  return (addressToBigInt(ip, version) & mask) === range.network;
}

function normalizeIp(value: string): string {
  return value.startsWith('::ffff:') ? value.slice(7) : value;
}

function addressToBigInt(value: string, version: 4 | 6): bigint {
  if (version === 4) {
    return value
      .split('.')
      .reduce((result, part) => (result << 8n) + BigInt(part), 0n);
  }
  const [headValue, tailValue] = value.split('::');
  const head = headValue ? headValue.split(':') : [];
  const tail = tailValue ? tailValue.split(':') : [];
  const expanded = [
    ...head,
    ...Array.from({ length: 8 - head.length - tail.length }, () => '0'),
    ...tail,
  ];
  return expanded.reduce(
    (result, part) => (result << 16n) + BigInt(`0x${part || '0'}`),
    0n,
  );
}

