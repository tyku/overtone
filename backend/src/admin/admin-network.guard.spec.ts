import { cidrContains, parseCidr } from './admin-network.guard';

describe('admin CIDR matching', () => {
  it('matches IPv4 addresses and IPv4-mapped addresses', () => {
    const range = parseCidr('10.42.0.0/16');
    expect(cidrContains(range, '10.42.9.7')).toBe(true);
    expect(cidrContains(range, '::ffff:10.42.9.7')).toBe(true);
    expect(cidrContains(range, '10.43.0.1')).toBe(false);
  });

  it('matches IPv6 VPN ranges', () => {
    const range = parseCidr('fd12:3456::/32');
    expect(cidrContains(range, 'fd12:3456::99')).toBe(true);
    expect(cidrContains(range, 'fd12:3457::99')).toBe(false);
  });

  it('rejects invalid ranges at startup', () => {
    expect(() => parseCidr('10.0.0.0/99')).toThrow('Invalid CIDR prefix');
  });
});
