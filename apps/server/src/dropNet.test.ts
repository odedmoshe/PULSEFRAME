/**
 * The pure parts of the phone drop door (ADR-0023, W1): the private-range and subnet predicates, the address list the owner
 * chooses from, the per-peer token bucket and the header parsers. No listener here (drop.test.ts has those).
 */
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { candidateAddresses, ipv4ToInt, isPrivateIPv4, parseBearer, parseContentLength, parseLastModified, plainIPv4, preferredRouteAddress, sameSubnet, TokenBucket } from './dropNet.ts';

const nic = (address: string, netmask: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4'): NetworkInterfaceInfo =>
  ({ address, netmask, family, internal, mac: '00:00:00:00:00:00', cidr: null, ...(family === 'IPv6' ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo;

describe('ipv4ToInt', () => {
  it('reads dotted quads as unsigned 32-bit integers', () => {
    expect(ipv4ToInt('0.0.0.0')).toBe(0);
    expect(ipv4ToInt('255.255.255.255')).toBe(0xffffffff);
    expect(ipv4ToInt('192.168.1.10')).toBe(0xc0a8010a);
    expect(ipv4ToInt('10.0.0.1')).toBe(0x0a000001);
  });
  it('refuses anything that is not a plain dotted quad', () => {
    for (const bad of ['', '1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.04', ' 1.2.3.4', '1.2.3.4 ', '1.2.3.-4', '::1', '::ffff:10.0.0.1', '0x0a.0.0.1', '1e2.0.0.1', '१.२.३.४', '10.0.0.1\n'])
      expect(ipv4ToInt(bad), bad).toBeNull();
  });
});

describe('isPrivateIPv4: RFC 1918 only', () => {
  it('accepts 10/8, 172.16/12 and 192.168/16 at their edges', () => {
    for (const a of ['10.0.0.0', '10.255.255.255', '10.1.2.3', '172.16.0.0', '172.31.255.255', '172.20.1.1', '192.168.0.0', '192.168.255.255', '192.168.1.23'])
      expect(isPrivateIPv4(a), a).toBe(true);
  });
  it('refuses link-local, carrier-grade NAT, loopback, public, documentation, IPv6 and malformed addresses', () => {
    for (const a of ['169.254.1.1', '100.64.0.1', '100.127.255.255', '127.0.0.1', '127.0.0.2', '172.15.255.255', '172.32.0.0', '192.167.255.255', '192.169.0.0', '11.0.0.0', '9.255.255.255', '8.8.8.8', '192.0.2.1', '0.0.0.0', '255.255.255.255', '224.0.0.1', 'fe80::1', '::ffff:192.168.1.2', '192.168.1', '192.168.01.1', 'localhost'])
      expect(isPrivateIPv4(a), a).toBe(false);
  });
});

describe('sameSubnet on 32-bit integers', () => {
  it('compares the masked network parts', () => {
    expect(sameSubnet('192.168.1.77', '192.168.1.10', '255.255.255.0')).toBe(true);
    expect(sameSubnet('192.168.2.77', '192.168.1.10', '255.255.255.0')).toBe(false);
    expect(sameSubnet('10.9.8.7', '10.1.2.3', '255.0.0.0')).toBe(true);
    expect(sameSubnet('172.16.5.1', '172.16.4.1', '255.255.254.0')).toBe(true);
    expect(sameSubnet('172.16.6.1', '172.16.4.1', '255.255.254.0')).toBe(false);
    // high bit set: signed arithmetic would go wrong here
    expect(sameSubnet('200.1.1.7', '200.1.1.1', '255.255.255.248')).toBe(true);
    expect(sameSubnet('200.1.1.7', '200.1.1.1', '255.255.255.252')).toBe(false);
    expect(sameSubnet('127.0.0.9', '127.0.0.2', '255.255.255.252')).toBe(false);
    expect(sameSubnet('127.0.0.3', '127.0.0.2', '255.255.255.252')).toBe(true);
  });
  it('reads an IPv4-mapped IPv6 peer as IPv4 and refuses everything else that is not IPv4', () => {
    expect(sameSubnet('::ffff:192.168.1.77', '192.168.1.10', '255.255.255.0')).toBe(true);
    expect(sameSubnet('::FFFF:192.168.1.77', '192.168.1.10', '255.255.255.0')).toBe(true);
    expect(sameSubnet('fe80::1', '192.168.1.10', '255.255.255.0')).toBe(false);
    expect(sameSubnet('', '192.168.1.10', '255.255.255.0')).toBe(false);
    expect(sameSubnet('192.168.1.77', '192.168.1.10', 'garbage')).toBe(false);
    expect(plainIPv4(undefined)).toBe('');
  });
});

describe('candidateAddresses', () => {
  const list = {
    lo: [nic('127.0.0.1', '255.0.0.0', true), nic('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', true, 'IPv6')],
    wlan0: [nic('192.168.1.23', '255.255.255.0'), nic('fe80::1', 'ffff:ffff:ffff:ffff::', false, 'IPv6')],
    eth0: [nic('10.0.0.5', '255.255.255.0')],
    tailscale0: [nic('100.100.1.2', '255.192.0.0')],
    weird: [nic('169.254.3.4', '255.255.0.0'), nic('8.8.4.4', '255.255.255.0')],
  };
  it('lists private, non-internal IPv4 interfaces only', () => {
    expect(candidateAddresses(list, [], null)).toEqual([
      { address: '192.168.1.23', netmask: '255.255.255.0', interfaceName: 'wlan0', preferred: false },
      { address: '10.0.0.5', netmask: '255.255.255.0', interfaceName: 'eth0', preferred: false },
    ]);
  });
  it('puts the preferred (default route) address first and marks it; an unknown preferred address changes nothing', () => {
    const c = candidateAddresses(list, [], '10.0.0.5');
    expect(c.map((d) => [d.address, d.preferred])).toEqual([['10.0.0.5', true], ['192.168.1.23', false]]);
    expect(candidateAddresses(list, [], '8.8.4.4').every((d) => !d.preferred)).toBe(true);
  });
  it('adds admitted addresses (proofs) with their interface netmask, never 0.0.0.0, broadcast, multicast or non-IPv4', () => {
    const c = candidateAddresses({ ...list, lo2: [nic('127.0.0.2', '255.0.0.0', true)] }, ['127.0.0.2', '0.0.0.0', '255.255.255.255', '239.1.1.1', '::1', 'nonsense', '198.51.100.7', '192.168.1.23'], null);
    expect(c.map((d) => d.address)).toEqual(['192.168.1.23', '10.0.0.5', '127.0.0.2', '198.51.100.7']);
    expect(c.find((d) => d.address === '127.0.0.2')).toMatchObject({ netmask: '255.0.0.0', interfaceName: 'lo2' });
    expect(c.find((d) => d.address === '198.51.100.7')).toMatchObject({ netmask: '255.255.255.255', interfaceName: '' });
  });
  it('is empty on a machine without a private network (the honest no_private_network state)', () => {
    expect(candidateAddresses({ lo: list.lo, eth0: [nic('192.0.2.10', '255.255.255.0')] }, [], '192.0.2.10')).toEqual([]);
  });
});

describe('preferredRouteAddress', () => {
  it('resolves to an IPv4 address or null and never rejects (no packet is sent by a UDP connect)', async () => {
    const a = await preferredRouteAddress(2000);
    expect(a === null || ipv4ToInt(a) !== null).toBe(true);
  });
});

describe('TokenBucket', () => {
  it('starts full at burst, refills continuously at perMinute and states Retry-After = ceil((1 − tokens) / rate)', () => {
    let t = 1_000_000;
    const b = new TokenBucket(3, 60, () => t); // one per second
    expect([b.take(), b.take(), b.take()].every((r) => r.ok)).toBe(true);
    expect(b.take()).toEqual({ ok: false, retryAfterSeconds: 1 });
    t += 400;
    expect(b.take()).toEqual({ ok: false, retryAfterSeconds: 1 }); // 0.4 tokens: 0.6 s to go, rounded up
    t += 600;
    expect(b.take()).toEqual({ ok: true });
    t += 60_000;
    expect([b.take(), b.take(), b.take()].every((r) => r.ok)).toBe(true); // capped at burst
    expect(b.take().ok).toBe(false);
  });
  it('a slow rate gives a long Retry-After; a refused take spends nothing', () => {
    let t = 0;
    const b = new TokenBucket(1, 12, () => t); // one per 5 s
    expect(b.take().ok).toBe(true);
    expect(b.take()).toEqual({ ok: false, retryAfterSeconds: 5 });
    t += 2_500;
    expect(b.take()).toEqual({ ok: false, retryAfterSeconds: 3 });
    t += 2_500;
    expect(b.take().ok).toBe(true);
  });
  it('a clock that goes backwards never adds tokens', () => {
    let t = 10_000;
    const b = new TokenBucket(1, 60, () => t);
    expect(b.take().ok).toBe(true);
    t -= 5_000;
    expect(b.take().ok).toBe(false);
  });
});

describe('header parsing', () => {
  it('parseBearer takes only `Bearer <base64url up to 128>`', () => {
    expect(parseBearer('Bearer abc_DEF-123')).toBe('abc_DEF-123');
    for (const bad of [undefined, '', 'Bearer ', 'bearer abc', 'Basic abc', 'Bearer  abc', 'Bearer abc def', 'Bearer abc\r\nX: y', `Bearer ${'a'.repeat(129)}`, 'Bearer abc=', 'Token abc'])
      expect(parseBearer(bad), String(bad)).toBeNull();
    expect(parseBearer(`Bearer ${'a'.repeat(128)}`)).toBe('a'.repeat(128));
  });
  it('parseLastModified keeps an integer between 1990 and the receive time plus 24 h', () => {
    const now = Date.UTC(2026, 10, 18, 10);
    expect(parseLastModified(String(Date.UTC(2025, 7, 14, 15, 3, 22)), now)).toBe('2025-08-14T15:03:22.000Z');
    expect(parseLastModified(String(now + 24 * 3_600_000), now)).not.toBeNull();
    for (const bad of [undefined, '', '-1', '1.5', '1e12', ' 1700000000000', String(Date.UTC(1989, 11, 31)), String(now + 24 * 3_600_000 + 1), '0', '9'.repeat(16), 'abc'])
      expect(parseLastModified(bad, now), String(bad)).toBeNull();
  });
  it('parseContentLength takes plain digits only', () => {
    expect(parseContentLength('0')).toBe(0);
    expect(parseContentLength('2147483648')).toBe(2147483648);
    for (const bad of [undefined, '', '-1', '1.0', '1e3', ' 12', '12,13', '99999999999999999']) expect(parseContentLength(bad), String(bad)).toBeNull();
  });
});
