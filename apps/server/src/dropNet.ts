/**
 * The pure parts of the phone drop door (ADR-0023): which addresses it may bind, who counts as inside the home network, the
 * per-peer token buckets and the parsing of the few headers it reads. drop.ts holds the listener.
 *
 * LEAD STUB (wave 5 pre-pass): the signatures are the contract; W1 writes the bodies (importContracts.ts, plan §5 with the
 * verifier's corrections). Until then every function refuses: nothing here may answer as if it had checked.
 */
import type { NetworkInterfaceInfo } from 'node:os';
import type { DropAddress } from '@pulseframe/core';

const notBuilt = (what: string): never => { throw new Error(`${what} is not built yet (phone drop, ADR-0023, W1)`); };

/** True for an RFC 1918 address: 10/8, 172.16/12, 192.168/16. False for 169.254/16, 100.64/10, loopback, public, IPv6 and anything malformed. */
export function isPrivateIPv4(address: string): boolean { return notBuilt(`isPrivateIPv4(${address.length} chars)`); }
/** The 32-bit unsigned integer of a dotted IPv4 address, or null when it is not one (no leading zeros, four parts of 0–255). */
export function ipv4ToInt(address: string): number | null { return notBuilt(`ipv4ToInt(${address.length} chars)`); }
/** (peer & mask) === (bound & mask) on 32-bit integers; false for anything that is not IPv4 (an IPv4-mapped IPv6 peer `::ffff:a.b.c.d` is read as a.b.c.d). */
export function sameSubnet(peer: string, bound: string, netmask: string): boolean { return notBuilt(`sameSubnet(${peer.length}, ${bound.length}, ${netmask.length})`); }
/**
 * The addresses the owner may choose from: non-internal IPv4 interfaces whose address is private, plus `admit` (proofs), the
 * `preferred` one first and marked. Never 0.0.0.0, never IPv6.
 */
export function candidateAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, admit: string[], preferred: string | null): DropAddress[] { return notBuilt(`candidateAddresses(${Object.keys(interfaces).length}, ${admit.length}, ${preferred === null})`); }
/** The local address of an unsent UDP socket connected to ROUTE_PROBE_ADDRESS (connect on UDP sends no packet), or null. */
export function preferredRouteAddress(): Promise<string | null> { return Promise.reject(new Error('preferredRouteAddress is not built yet (phone drop, ADR-0023, W1)')); }
/** A token bucket of `burst` tokens refilled at `perMinute` (continuous). take() spends one, or says when the next one is there. */
export class TokenBucket {
  constructor(readonly burst: number, readonly perMinute: number, readonly now: () => number) {}
  take(): { ok: true } | { ok: false; retryAfterSeconds: number } { return notBuilt(`TokenBucket(${this.burst}, ${this.perMinute}).take`); }
}
/** The session of `authorization: Bearer <session>`, or null (any other form, an empty value, more than 128 characters). */
export function parseBearer(header: string | undefined): string | null { return notBuilt(`parseBearer(${header === undefined})`); }
/** x-pf-last-modified (ms since epoch, an integer from 1990 to the receive time plus 24 h) as ISO UTC, or null. */
export function parseLastModified(header: string | undefined, receivedAtMs: number): string | null { return notBuilt(`parseLastModified(${header === undefined}, ${receivedAtMs > 0})`); }
