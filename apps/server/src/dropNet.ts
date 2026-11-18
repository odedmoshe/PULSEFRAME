/**
 * The pure parts of the phone drop door (ADR-0023): which addresses it may bind, who counts as inside the home network, the
 * per-peer token buckets and the parsing of the few headers it reads. drop.ts holds the listener.
 *
 * Nothing here does I/O except preferredRouteAddress (an unsent UDP connect) and nothing here ever sees a secret.
 */
import dgram from 'node:dgram';
import type { NetworkInterfaceInfo } from 'node:os';
import type { DropAddress } from '@pulseframe/core';
import { ROUTE_PROBE_ADDRESS } from './importContracts.ts';

const QUAD = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;
const MAPPED = /^::ffff:/i;

/** The 32-bit unsigned integer of a dotted IPv4 address, or null when it is not one (no leading zeros, four parts of 0–255). */
export function ipv4ToInt(address: string): number | null {
  if (typeof address !== 'string') return null;
  const m = QUAD.exec(address);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i]);
    if (part > 255) return null;
    n = n * 256 + part;
  }
  return n >>> 0;
}

/** An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`) read as a.b.c.d; anything else as written. */
export function plainIPv4(address: string | undefined): string {
  if (typeof address !== 'string') return '';
  return MAPPED.test(address) ? address.slice(7) : address;
}

const inRange = (n: number, base: number, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((base & mask) >>> 0);
};
const ip = (s: string): number => ipv4ToInt(s)!;

/** True for an RFC 1918 address: 10/8, 172.16/12, 192.168/16. False for 169.254/16, 100.64/10, loopback, public, IPv6 and anything malformed. */
export function isPrivateIPv4(address: string): boolean {
  const n = ipv4ToInt(address);
  if (n === null) return false;
  return inRange(n, ip('10.0.0.0'), 8) || inRange(n, ip('172.16.0.0'), 12) || inRange(n, ip('192.168.0.0'), 16);
}

/** (peer & mask) === (bound & mask) on 32-bit integers; false for anything that is not IPv4 (an IPv4-mapped IPv6 peer `::ffff:a.b.c.d` is read as a.b.c.d). */
export function sameSubnet(peer: string, bound: string, netmask: string): boolean {
  const p = ipv4ToInt(plainIPv4(peer));
  const b = ipv4ToInt(plainIPv4(bound));
  const m = ipv4ToInt(netmask);
  if (p === null || b === null || m === null) return false;
  return ((p & m) >>> 0) === ((b & m) >>> 0);
}

/** An address the door may never bind, even when admitted: the unspecified address, broadcast and multicast. */
function neverBindable(n: number): boolean {
  return n === 0 || n === 0xffffffff || inRange(n, ip('224.0.0.0'), 4);
}
const isIPv4Info = (info: NetworkInterfaceInfo): boolean => (info.family as unknown) === 'IPv4' || (info.family as unknown) === 4;

/**
 * The addresses the owner may choose from: non-internal IPv4 interfaces whose address is private, plus `admit` (proofs), the
 * `preferred` one first and marked. Never 0.0.0.0, never IPv6. An admitted address takes the netmask of the interface that
 * carries it, or 255.255.255.255 (only itself) when no interface does.
 */
export function candidateAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, admit: string[], preferred: string | null): DropAddress[] {
  const out: DropAddress[] = [];
  const seen = new Set<string>();
  const all: { name: string; info: NetworkInterfaceInfo }[] = [];
  for (const [name, infos] of Object.entries(interfaces)) for (const info of infos ?? []) if (isIPv4Info(info)) all.push({ name, info });
  for (const { name, info } of all) {
    if (info.internal || !isPrivateIPv4(info.address) || seen.has(info.address)) continue;
    if (ipv4ToInt(info.netmask) === null) continue;
    seen.add(info.address);
    out.push({ address: info.address, netmask: info.netmask, interfaceName: name, preferred: false });
  }
  for (const a of admit) {
    const n = ipv4ToInt(a);
    if (n === null || neverBindable(n) || seen.has(a)) continue;
    const carrier = all.find((x) => x.info.address === a && ipv4ToInt(x.info.netmask) !== null);
    seen.add(a);
    out.push({ address: a, netmask: carrier?.info.netmask ?? '255.255.255.255', interfaceName: carrier?.name ?? '', preferred: false });
  }
  const i = preferred === null ? -1 : out.findIndex((d) => d.address === preferred);
  if (i >= 0) {
    const [p] = out.splice(i, 1);
    out.unshift({ ...p!, preferred: true });
  }
  return out;
}

/** The local address of an unsent UDP socket connected to ROUTE_PROBE_ADDRESS (connect on UDP sends no packet), or null. */
export function preferredRouteAddress(timeoutMs = 1000): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    let socket: dgram.Socket | null = null;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket?.close(); } catch { /* already closed */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    timer.unref?.();
    try {
      socket = dgram.createSocket('udp4');
      socket.on('error', () => finish(null));
      socket.connect(9, ROUTE_PROBE_ADDRESS, () => {
        try {
          const local = socket!.address().address;
          finish(ipv4ToInt(local) !== null && local !== '0.0.0.0' ? local : null);
        } catch { finish(null); }
      });
      socket.unref();
    } catch { finish(null); }
  });
}

/** A token bucket of `burst` tokens refilled at `perMinute` (continuous). take() spends one, or says when the next one is there. */
export class TokenBucket {
  private tokens: number;
  private at: number;
  constructor(readonly burst: number, readonly perMinute: number, readonly now: () => number) {
    this.tokens = Math.max(1, burst);
    this.at = now();
  }
  take(): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const capacity = Math.max(1, this.burst);
    const perMs = Math.max(0, this.perMinute) / 60_000;
    const t = this.now();
    this.tokens = Math.min(capacity, this.tokens + Math.max(0, t - this.at) * perMs);
    this.at = t;
    if (this.tokens < 1) {
      // the same arithmetic as auth.ts: Retry-After = ceil((1 − tokens) / rate), at least one second
      const retryAfterSeconds = perMs > 0 ? Math.max(1, Math.ceil((1 - this.tokens) / perMs / 1000)) : 3600;
      return { ok: false, retryAfterSeconds };
    }
    this.tokens -= 1;
    return { ok: true };
  }
}

const SESSION = /^[A-Za-z0-9_-]{1,128}$/;
/** The session of `authorization: Bearer <session>`, or null (any other form, an empty value, more than 128 characters). */
export function parseBearer(header: string | undefined): string | null {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const value = header.slice(7);
  return SESSION.test(value) ? value : null;
}

const NINETEEN_NINETY = Date.UTC(1990, 0, 1);
/** x-pf-last-modified (ms since epoch, an integer from 1990 to the receive time plus 24 h) as ISO UTC, or null. */
export function parseLastModified(header: string | undefined, receivedAtMs: number): string | null {
  if (typeof header !== 'string' || !/^\d{1,15}$/.test(header)) return null;
  const ms = Number(header);
  if (!Number.isSafeInteger(ms) || ms < NINETEEN_NINETY || ms > receivedAtMs + 24 * 3_600_000) return null;
  return new Date(ms).toISOString();
}

/** Content-Length as a non-negative safe integer, or null when it is absent or not plain digits. */
export function parseContentLength(header: string | undefined): number | null {
  if (typeof header !== 'string' || !/^\d{1,16}$/.test(header)) return null;
  const n = Number(header);
  return Number.isSafeInteger(n) ? n : null;
}
