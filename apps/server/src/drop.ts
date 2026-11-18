/**
 * The phone drop door (ADR-0023, amends ADR-0002): a second, plain node:http listener that exists only while an owner-issued
 * code is live, bound to the one private address the owner confirmed, serving the upload page and the upload routes of the
 * wire protocol in importContracts.ts and nothing else. It hands every file to the import queue (queue.receive) and to nothing
 * else. No framework, no router, nothing shared with the main app: no route table, cookie, token or Auth instance.
 *
 * The code IS the authentication (ADR-0002: no unauthenticated writes). Its secrets are a 128-bit token (the QR's URL fragment),
 * a 6-digit PIN (the typed fallback) and, after the one claim, a 256-bit session. They live in this module's memory only, are
 * compared as SHA-256 digests with timingSafeEqual, and never reach a log line, an event, an error body or the queue. The token
 * and PIN are kept in plain text only while the code waits for a phone (the owner's dialog shows them); once claimed only their
 * digests remain.
 *
 * Every request, in order (importContracts.ts):
 *   1. the peer is inside the bound subnet, checked when the connection is accepted (else the socket is destroyed, nothing is
 *      parsed) and again per request;
 *   2. Host is exactly `<address>:<port>` (else 404, empty body);
 *   3. Origin, when present, is exactly `http://<address>:<port>`, and Sec-Fetch-Site is not cross-site (else 403);
 *   4. the token bucket of the route's class (hello, upload, other) for the peer IP (else 429 with Retry-After);
 *   5. the exact route table DROP_ROUTES (else 404, empty body, Connection: close).
 * An early refusal is written with Connection: close and the request body is then drained for at most limits.drainMs or
 * limits.drainBytes before the socket is destroyed, so a phone browser still sending a large body reads the refusal instead of
 * a reset.
 * Connections: one device holds at most half of limits.maxConnections; after the claim the other devices share the other half
 * and lose every connection they held at the moment of the claim (admit(), cutOthers()). Before the claim nothing can keep the
 * phone out: a connection from a peer that has not claimed the code lives limits.unclaimedConnectionMs at most (a socket held
 * by pipelined requests whose answers are never read has no other clock), a connection may leave at most
 * limits.maxUnreadResponseBytes of answers unread (or one answer larger than that), and when every slot is taken a new peer's
 * connection takes the oldest one of the peer holding the most.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import os from 'node:os';
import { Transform } from 'node:stream';
import { phoneActor, type DropCloseReason, type DropCodeView, type DropPublicView, type DropState } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { DropPage } from './drop-page/index.ts';
import { candidateAddresses, parseBearer, parseContentLength, parseLastModified, plainIPv4, preferredRouteAddress, sameSubnet, TokenBucket } from './dropNet.ts';
import { decodeUploadHeader, diskReserveRefuses, DROP_WIRE_ERROR_CODES, type DropByeResponse, type DropDoor, type DropDoorDeps, type DropHelloResponse, type DropStatusResponse, type DropUploadResponse, type DropWireErrorCode } from './importContracts.ts';
import { ApiError } from './store.ts';
import type { ImportRoom } from '@pulseframe/core';

/** The timers of the door's own clocks (code lifetime, upload stall, refusal drain). Tests inject a fake clock. */
export interface DropTimers { setTimer(fn: () => void, ms: number): unknown; clearTimer(handle: unknown): void }
/** DropDoorDeps plus this module's own seam for timers (not part of the shared contract; the default is setTimeout, unref'd). */
export type DropDoorOptions = DropDoorDeps & { timers?: DropTimers };

const realTimers: DropTimers = {
  setTimer(fn, ms) { const t = setTimeout(fn, Math.max(0, Math.min(ms, 2 ** 31 - 1))); t.unref?.(); return t; },
  clearTimer(h) { if (h !== null && h !== undefined) clearTimeout(h as NodeJS.Timeout); },
};

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
/** Constant-time over two SHA-256 digests (always 32 bytes each), false when there is nothing to compare against. */
const sameDigest = (candidate: Buffer, stored: Buffer | null): boolean => stored !== null && candidate.length === stored.length && timingSafeEqual(candidate, stored);
const rid = (bytes: number) => randomBytes(bytes).toString('base64url');
const iso = (ms: number) => new Date(ms).toISOString();

/** Headers on every answer. Never Set-Cookie, never Access-Control-*. */
const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
const WIRE_CODES: ReadonlySet<string> = new Set(DROP_WIRE_ERROR_CODES);
/** More buckets than this (peers on a /8) and the table starts over; a reset can only grant a burst, never a code. */
const MAX_BUCKET_PEERS = 4096;

type RouteClass = 'hello' | 'upload' | 'other';
interface Buckets { hello: TokenBucket; upload: TokenBucket; other: TokenBucket }
interface Upload { controller: AbortController; bytes: number }
interface Code {
  dropId: string; projectId: string; issuedBy: string;
  address: string; netmask: string; port: number; host: string; origin: string;
  server: http.Server; closed: Promise<void>;
  /** Plain text only while state is 'waiting' (shown in the owner's dialog); null once claimed or closed. */
  token: string | null; pin: string | null;
  tokenDigest: Buffer; pinDigest: Buffer;
  sessionDigest: Buffer | null; claimIp: string | null;
  state: DropState; closeReason: DropCloseReason | null;
  issuedAt: number; lastActivity: number; closedAt: number | null;
  badHellos: number; files: number; bytes: number; inFlightBytes: number;
  uploads: Set<Upload>; buckets: Map<string, Buckets>; lifeTimer: unknown; page: DropPage | null;
  /** The open sockets by peer IP (connection admission, see admit()). */
  sockets: Map<string, Set<Socket>>;
  /** Per open socket: its order of arrival, its lifetime timer (peers that have not claimed), its unread answer bytes. */
  conns: Map<Socket, Conn>;
}
interface Conn { peer: string; seq: number; lifeTimer: unknown; unread: number }

export function createDropDoor(deps: DropDoorOptions): DropDoor {
  const events = new EventEmitter();
  const limits = deps.limits;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;
  const log = deps.log ?? ((line: string) => console.log(line));
  const interfaces = deps.interfaces ?? (() => os.networkInterfaces());
  let live: Code | null = null;
  let chain: Promise<unknown> = Promise.resolve();

  // The default route's address comes from an unsent UDP connect, which resolves asynchronously; the contract's
  // preferredAddress() is synchronous, so the probe runs at creation and again on each listing, and the last answer is used.
  let probed: string | null = null;
  let probing = false;
  const probe = () => {
    if (probing) return;
    probing = true;
    void preferredRouteAddress().then((a) => { probed = a; }, () => { /* no route: nothing preferred */ }).finally(() => { probing = false; });
  };
  const preferred = deps.preferredAddress ?? (() => { probe(); return probed; });
  if (!deps.preferredAddress) probe();

  // ---------- views (never a secret except url and pin, owner only, while waiting) ----------
  const deadline = (c: Code): { at: number; reason: DropCloseReason } => {
    const maxAt = c.issuedAt + limits.maxLifeMs;
    if (c.state === 'waiting') {
      const ttlAt = c.issuedAt + limits.ttlMs;
      return ttlAt <= maxAt ? { at: ttlAt, reason: 'expired' } : { at: maxAt, reason: 'max-life' };
    }
    const idleAt = c.lastActivity + limits.idleMs;
    return maxAt <= idleAt ? { at: maxAt, reason: 'max-life' } : { at: idleAt, reason: 'idle' };
  };
  const publicView = (c: Code): DropPublicView => ({
    dropId: c.dropId, projectId: c.projectId, state: c.state, closeReason: c.closeReason,
    issuedAt: iso(c.issuedAt), expiresAt: iso(c.closedAt ?? deadline(c).at),
    files: c.files, bytes: c.bytes, inFlight: c.uploads.size,
    remainingBytes: Math.max(0, limits.maxCodeBytes - c.bytes - c.inFlightBytes),
    filesLeft: Math.max(0, limits.maxFiles - c.files - c.uploads.size),
  });
  const codeView = (c: Code): DropCodeView => {
    const waiting = c.state === 'waiting';
    return { ...publicView(c), address: c.address, port: c.port, url: waiting && c.token ? `http://${c.host}/#${c.token}` : null, pin: waiting ? c.pin : null };
  };
  const emit = (c: Code) => { events.emit('drop', publicView(c)); };
  const room = (): ImportRoom | null => { try { return deps.queue.room(); } catch { return null; } };
  const budget = (c: Code) => {
    const r = room();
    const maxFileBytes = Math.max(0, Math.min(limits.maxFileBytes, r?.maxFileBytes ?? Infinity));
    let remainingBytes = limits.maxCodeBytes - c.bytes - c.inFlightBytes;
    if (r && r.ceilingRoomBytes !== null) remainingBytes = Math.min(remainingBytes, r.ceilingRoomBytes - c.inFlightBytes);
    return { maxFileBytes, remainingBytes: Math.max(0, remainingBytes), filesLeft: Math.max(0, limits.maxFiles - c.files - c.uploads.size) };
  };

  // ---------- lifetime ----------
  const armLife = (c: Code) => {
    timers.clearTimer(c.lifeTimer);
    // Lazy: activity only moves the deadline later, so the timer re-arms itself when it fires early.
    const check = () => {
      if (c.state === 'closed') return;
      const d = deadline(c);
      if (now() >= d.at) shut(c, d.reason);
      else c.lifeTimer = timers.setTimer(check, d.at - now());
    };
    c.lifeTimer = timers.setTimer(check, Math.max(0, deadline(c).at - now()));
  };
  /**
   * Closes a code: revokes it at once (state, secrets, uploads aborted, no new connections), then destroys its connections, after
   * `answer` (the /bye or locking reply) has been handed to the network when given.
   */
  const shut = (c: Code, reason: DropCloseReason, answer?: ServerResponse) => {
    if (c.state === 'closed') return;
    c.state = 'closed';
    c.closeReason = reason;
    c.closedAt = now();
    c.token = null; c.pin = null; c.sessionDigest = null;
    timers.clearTimer(c.lifeTimer);
    for (const conn of c.conns.values()) timers.clearTimer(conn.lifeTimer);
    for (const u of c.uploads) u.controller.abort(new ApiError(410, 'code_closed', `the drop code closed (${reason})`));
    c.server.close();
    if (live === c) live = null;
    c.buckets.clear();
    log(`[drop] code ${c.dropId} closed (${reason}); ${c.files} file(s), ${c.bytes} bytes received`);
    emit(c);
    const destroyAll = () => { c.server.closeAllConnections(); };
    if (answer && !answer.writableFinished && !answer.destroyed) {
      answer.once('finish', destroyAll);
      answer.once('close', destroyAll);
      realTimers.setTimer(destroyAll, 2_000);
    } else destroyAll();
  };

  // ---------- answering ----------
  const head = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}, close = false): string => {
    const text = body === null ? '' : JSON.stringify(body);
    const headers: Record<string, string | number> = { ...BASE_HEADERS, 'Content-Length': Buffer.byteLength(text), ...extra };
    if (body !== null) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (close) headers.Connection = 'close';
    res.writeHead(status, headers);
    return text;
  };
  const answer = (res: ServerResponse, status: number, body: unknown) => {
    if (res.headersSent || res.destroyed) return;
    res.end(head(res, status, body));
  };
  /** An early refusal: answered with Connection: close at once, then the body drained (bounded) before the socket goes. */
  const refuse = (req: IncomingMessage, res: ServerResponse, status: number, code: DropWireErrorCode | null, extra: Record<string, string> = {}) => {
    if (res.headersSent || res.destroyed) { req.socket.destroy(); return; }
    const text = head(res, status, code === null ? null : { error: { code } }, extra, true);
    if (req.complete) { res.end(text); return; }
    res.flushHeaders();
    if (text) res.write(text);
    let drained = 0;
    let done = false;
    const finish = (destroy: boolean) => {
      if (done) return;
      done = true;
      timers.clearTimer(timer);
      res.end();
      if (destroy) res.once('finish', () => req.socket.destroy());
      if (destroy && res.writableFinished) req.socket.destroy();
    };
    const timer = timers.setTimer(() => finish(true), limits.drainMs);
    req.on('data', (chunk: Buffer) => { drained += chunk.length; if (drained > limits.drainBytes) finish(true); });
    req.on('end', () => finish(false));
    req.on('error', () => finish(true));
    req.socket.once('close', () => finish(false));
    req.resume();
  };

  /**
   * A small request body (hello, status, bye): at most `max` bytes, read within drainMs (a phone sends a few hundred bytes in
   * one packet; headersTimeoutMs would let a trickled body hold a connection five times as long); null when it is not.
   */
  const readSmall = (req: IncomingMessage, max: number): Promise<Buffer | null> => new Promise((resolve) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && (parseContentLength(declared) ?? Infinity) > max) { resolve(null); return; }
    const parts: Buffer[] = [];
    let size = 0;
    let settled = false;
    const settle = (v: Buffer | null) => {
      if (settled) return;
      settled = true;
      timers.clearTimer(timer);
      req.removeListener('data', onData);
      if (v === null) req.pause();
      resolve(v);
    };
    const onData = (chunk: Buffer) => { size += chunk.length; if (size > max) settle(null); else parts.push(chunk); };
    const timer = timers.setTimer(() => settle(null), limits.drainMs);
    req.on('data', onData);
    req.once('end', () => settle(Buffer.concat(parts)));
    req.once('error', () => settle(null));
  });

  const sessionOk = (c: Code, peer: string, req: IncomingMessage): boolean => {
    const auth = req.headers.authorization;
    const session = parseBearer(typeof auth === 'string' ? auth : undefined);
    if (session === null) return false;
    const match = sameDigest(digest(session), c.sessionDigest);
    return match && c.state === 'connected' && peer === c.claimIp;
  };
  const header = (req: IncomingMessage, name: string): string | undefined => {
    const v = req.headers[name];
    return typeof v === 'string' ? v : undefined;
  };
  const bucketFor = (c: Code, peer: string, cls: RouteClass): TokenBucket => {
    let b = c.buckets.get(peer);
    if (!b) {
      if (c.buckets.size >= MAX_BUCKET_PEERS) c.buckets.clear();
      b = {
        hello: new TokenBucket(limits.helloBurst, limits.helloPerMinute, now),
        upload: new TokenBucket(limits.uploadBurst, limits.uploadsPerMinute, now),
        other: new TokenBucket(limits.otherBurst, limits.otherPerMinute, now),
      };
      c.buckets.set(peer, b);
    }
    return b[cls];
  };

  // ---------- connections ----------
  /**
   * Connection admission, on top of server.maxConnections (Node drops anything past it before this runs). One device holds at
   * most half the slots; once a phone has claimed the code, the other devices together hold at most the other half and every
   * connection they had is cut at the claim, so nothing on the network can lock a connected phone out of the door mid-batch,
   * however long it keeps its own connections open.
   */
  const perPeer = Math.max(1, Math.floor(limits.maxConnections / 2));
  let connSeq = 0;
  /**
   * The door is full and `peer` (holding `holds` connections) asks for one more: the oldest connection of the peer holding the
   * most goes, when that peer holds at least as many as `peer` would (never the claimed phone's). False when nothing may go.
   */
  const evictFor = (c: Code, peer: string, holds: number): boolean => {
    let victim: Socket | null = null, victimCount = 0, victimSeq = Infinity;
    for (const [ip, set] of c.sockets) {
      if (ip === peer || (c.state === 'connected' && ip === c.claimIp)) continue;
      for (const s of set) {
        const seq = c.conns.get(s)?.seq ?? 0;
        if (set.size > victimCount || (set.size === victimCount && seq < victimSeq)) { victim = s; victimCount = set.size; victimSeq = seq; }
      }
    }
    if (!victim || victimCount < holds + 1) return false;
    forget(c, victim);
    victim.destroy();
    return true;
  };
  /** Takes a socket out of the door's books at once (its 'close' may come later). */
  const forget = (c: Code, socket: Socket) => {
    const conn = c.conns.get(socket);
    if (!conn) return;
    timers.clearTimer(conn.lifeTimer);
    c.conns.delete(socket);
    const set = c.sockets.get(conn.peer);
    if (set) { set.delete(socket); if (set.size === 0) c.sockets.delete(conn.peer); }
  };
  const admit = (c: Code, socket: Socket) => {
    const peer = plainIPv4(socket.remoteAddress);
    if (!sameSubnet(peer, c.address, c.netmask)) { socket.destroy(); return; }
    const held = c.sockets.get(peer)?.size ?? 0;
    if (held >= perPeer) { socket.destroy(); return; }
    if (c.state === 'connected' && peer !== c.claimIp) {
      let others = 0;
      for (const [ip, s] of c.sockets) if (ip !== c.claimIp) others += s.size;
      if (others >= limits.maxConnections - perPeer) { socket.destroy(); return; }
    }
    // server.maxConnections leaves one slot over so a newcomer reaches this point when the door is full
    if (c.conns.size >= limits.maxConnections && !evictFor(c, peer, held)) { socket.destroy(); return; }
    let set = c.sockets.get(peer);
    if (!set) c.sockets.set(peer, set = new Set());
    set.add(socket);
    const conn: Conn = { peer, seq: ++connSeq, lifeTimer: null, unread: 0 };
    if (!(c.state === 'connected' && peer === c.claimIp)) conn.lifeTimer = timers.setTimer(() => { forget(c, socket); socket.destroy(); }, limits.unclaimedConnectionMs);
    c.conns.set(socket, conn);
    socket.once('close', () => forget(c, socket));
  };
  /** At the claim: every connection of every other device goes, so the phone's half of the slots is free whatever they held. */
  const cutOthers = (c: Code, phone: string) => {
    for (const [ip, set] of [...c.sockets]) {
      if (ip === phone) { for (const s of set) { const conn = c.conns.get(s); if (conn) { timers.clearTimer(conn.lifeTimer); conn.lifeTimer = null; } } continue; }
      for (const s of [...set]) { forget(c, s); s.destroy(); }
    }
  };
  /**
   * Counts an answer of `bytes` against its connection's unread bytes until it has been handed to the network; false (and the
   * socket destroyed) when the connection already leaves answers unread and this one would pass maxUnreadResponseBytes.
   */
  const reserveUnread = (c: Code, req: IncomingMessage, res: ServerResponse, bytes: number): boolean => {
    // req.socket: a pipelined answer waiting behind another has no res.socket yet
    const socket = req.socket;
    const conn = socket ? c.conns.get(socket) : undefined;
    if (!socket || !conn) return true;
    if (conn.unread > 0 && conn.unread + bytes > limits.maxUnreadResponseBytes) {
      log(`[drop] code ${c.dropId}: a connection left ${conn.unread} bytes of answers unread and was closed`);
      forget(c, socket);
      socket.destroy();
      return false;
    }
    conn.unread += bytes;
    let done = false;
    const release = () => { if (!done) { done = true; conn.unread -= bytes; } };
    res.once('finish', release);
    res.once('close', release);
    return true;
  };

  // ---------- routes ----------
  const servePage = (c: Code, req: IncomingMessage, res: ServerResponse) => {
    // requestTimeout is 0 and only upload() has a stall timer, so a GET / with a body would otherwise keep its socket for as
    // long as the body trickles: refuse any body, with the bounded drain of every early refusal.
    const length = req.headers['content-length'];
    if (req.headers['transfer-encoding'] !== undefined || (length !== undefined && parseContentLength(length) !== 0)) return refuse(req, res, 400, 'invalid_request');
    const page = c.page ?? (c.page = deps.page());
    if (!reserveUnread(c, req, res, page.body.length)) return;
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': page.body.length, 'Content-Security-Policy': page.csp });
    res.end(page.body);
  };

  const hello = async (c: Code, peer: string, req: IncomingMessage, res: ServerResponse) => {
    const type = (header(req, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== 'application/json') return refuse(req, res, 400, 'invalid_request');
    const raw = await readSmall(req, limits.maxHelloBytes);
    if (raw === null) return refuse(req, res, 400, 'invalid_request');
    let kind: 'token' | 'pin';
    let value: string;
    try {
      const body: unknown = JSON.parse(raw.toString('utf8'));
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('not an object');
      const keys = Object.keys(body);
      if (keys.length !== 1 || (keys[0] !== 'token' && keys[0] !== 'pin')) throw new Error('one of token or pin');
      kind = keys[0];
      const v = (body as Record<string, unknown>)[kind];
      if (typeof v !== 'string' || v.length === 0 || v.length > 128) throw new Error('a short string');
      value = v;
    } catch { return refuse(req, res, 400, 'invalid_request'); }
    if (c.state === 'closed') return refuse(req, res, 410, 'code_expired');

    // Both digests are always computed and compared, whatever was sent.
    const candidate = digest(value);
    const tokenMatch = sameDigest(candidate, c.tokenDigest) && kind === 'token';
    const pinMatch = sameDigest(candidate, c.pinDigest) && kind === 'pin';

    if (c.state === 'connected') {
      // One phone: the original token from the claiming IP re-claims (a reloaded page) and voids the old session; anything
      // else is answered 'already used' without counting toward the lock (there is nothing left to guess).
      if (tokenMatch && peer === c.claimIp) {
        const session = rid(32);
        c.sessionDigest = digest(session);
        c.lastActivity = now();
        log(`[drop] code ${c.dropId} re-claimed by the same phone; the earlier session is void`);
        return answer(res, 200, helloBody(c, session));
      }
      return refuse(req, res, 409, 'code_already_used');
    }

    if (!tokenMatch && !pinMatch) {
      c.badHellos += 1;
      log(`[drop] code ${c.dropId}: wrong claim ${c.badHellos} of ${limits.maxBadHellos}`);
      if (c.badHellos >= limits.maxBadHellos) {
        refuse(req, res, 401, 'code_invalid');
        shut(c, 'locked', res);
        return;
      }
      return refuse(req, res, 401, 'code_invalid');
    }
    const session = rid(32);
    c.state = 'connected';
    c.sessionDigest = digest(session);
    c.claimIp = peer;
    c.token = null; c.pin = null;
    c.lastActivity = now();
    armLife(c);
    cutOthers(c, peer);
    log(`[drop] code ${c.dropId} claimed by a phone (${kind === 'token' ? 'QR' : 'typed code'})`);
    emit(c);
    answer(res, 200, helloBody(c, session));
  };
  const helloBody = (c: Code, session: string): DropHelloResponse => {
    const b = budget(c);
    return { session, expiresInSeconds: Math.max(0, Math.ceil((deadline(c).at - now()) / 1000)), maxFileBytes: b.maxFileBytes, remainingBytes: b.remainingBytes, filesLeft: b.filesLeft };
  };

  const status = async (c: Code, peer: string, req: IncomingMessage, res: ServerResponse) => {
    if (!sessionOk(c, peer, req)) return refuse(req, res, 401, 'session_invalid');
    if ((await readSmall(req, limits.maxHelloBytes)) === null) return refuse(req, res, 400, 'invalid_request');
    const b = budget(c);
    const body: DropStatusResponse = { state: c.state, maxFileBytes: b.maxFileBytes, remainingBytes: b.remainingBytes, filesLeft: b.filesLeft };
    answer(res, 200, body);
  };

  const bye = async (c: Code, peer: string, req: IncomingMessage, res: ServerResponse) => {
    if (!sessionOk(c, peer, req)) return refuse(req, res, 401, 'session_invalid');
    if ((await readSmall(req, limits.maxHelloBytes)) === null) return refuse(req, res, 400, 'invalid_request');
    if (c.state === 'closed') return refuse(req, res, 410, 'code_closed');
    const body: DropByeResponse = { closed: true };
    res.end(head(res, 200, body, {}, true));
    shut(c, 'phone', res);
  };

  /** The first limit a declared length fails, in the order of the wire protocol, or null. */
  const firstLimit = (c: Code, r: ImportRoom, length: number): { status: number; code: DropWireErrorCode } | null => {
    if (length > Math.min(limits.maxFileBytes, r.maxFileBytes)) return { status: 413, code: 'upload_too_large' };
    if (r.ceilingRoomBytes !== null && length > r.ceilingRoomBytes - c.inFlightBytes) return { status: 507, code: 'storage_quota_exceeded' };
    if (diskReserveRefuses(r.freeDiskBytes === null ? null : r.freeDiskBytes - c.inFlightBytes, r.reserveBytes, length)) return { status: 507, code: 'disk_full' };
    if (length > limits.maxCodeBytes - c.bytes - c.inFlightBytes) return { status: 413, code: 'code_budget' };
    return null;
  };

  const upload = async (c: Code, peer: string, req: IncomingMessage, res: ServerResponse, expectsContinue: boolean) => {
    if (!sessionOk(c, peer, req)) return refuse(req, res, 401, 'session_invalid');
    if (req.headers['transfer-encoding'] !== undefined) return refuse(req, res, 411, 'length_required');
    const length = parseContentLength(header(req, 'content-length'));
    if (length === null) return refuse(req, res, 411, 'length_required');
    if (length === 0) return refuse(req, res, 400, 'empty_upload');
    let name: string | null;
    try { name = decodeUploadHeader(header(req, 'x-filename'), 'file name', limits.maxFilenameHeaderBytes); } catch { return refuse(req, res, 400, 'invalid_filename'); }
    if (name === null) return refuse(req, res, 400, 'invalid_filename');
    const declaredLastModified = parseLastModified(header(req, 'x-pf-last-modified'), now()) ?? undefined;
    if (c.uploads.size >= limits.maxConcurrentUploads) return refuse(req, res, 429, 'rate_limited', { 'Retry-After': '1' });
    if (c.files + c.uploads.size >= limits.maxFiles) return refuse(req, res, 413, 'code_budget');
    const r = room();
    if (r === null) return refuse(req, res, 500, 'internal_error');
    const limit = firstLimit(c, r, length);
    if (limit) return refuse(req, res, limit.status, limit.code);

    // Reserved at request start, so two parallel uploads cannot both pass the budget.
    const up: Upload = { controller: new AbortController(), bytes: length };
    c.uploads.add(up);
    c.inFlightBytes += length;
    emit(c);

    let received = 0;
    let lastByte = now();
    let stalled = false;
    let finished = false;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        lastByte = now();
        c.lastActivity = lastByte;
        cb(null, chunk);
      },
    });
    const cut = (why: string) => {
      if (finished) return;
      if (!up.controller.signal.aborted) up.controller.abort(new ApiError(400, 'upload_incomplete', why));
      meter.destroy(new ApiError(400, 'upload_incomplete', why));
    };
    const stallCheck = () => {
      if (finished) return;
      const quiet = now() - lastByte;
      if (quiet < limits.stallMs) { stallTimer = timers.setTimer(stallCheck, limits.stallMs - quiet); return; }
      stalled = true;
      log(`[drop] code ${c.dropId}: an upload stalled for ${Math.round(quiet / 1000)} s and was stopped`);
      cut('no bytes arrived for too long');
      if (!res.headersSent && !res.destroyed) res.end(head(res, 400, { error: { code: 'upload_incomplete' } }, {}, true));
      req.socket.destroy();
    };
    let stallTimer = timers.setTimer(stallCheck, limits.stallMs);
    req.on('error', () => cut('the connection failed'));
    req.on('close', () => { if (!req.complete) cut('the phone stopped sending'); });
    if (expectsContinue) res.writeContinue();
    req.pipe(meter);

    let outcome: { ok: true } | { ok: false; status: number; code: DropWireErrorCode };
    try {
      await deps.queue.receive({
        projectId: c.projectId, actor: phoneActor(c.dropId), body: meter, name, via: 'phone',
        declaredBytes: length, maxBytes: length, commitKind: 'background', dropId: c.dropId, issuedBy: c.issuedBy,
        ...(declaredLastModified ? { declaredLastModified } : {}), signal: up.controller.signal,
      });
      outcome = received === length ? { ok: true } : { ok: false, status: 400, code: 'upload_incomplete' };
      if (!outcome.ok) log(`[drop] code ${c.dropId}: the queue accepted ${received} of ${length} declared bytes`);
    } catch (e) {
      if (e instanceof ApiError && WIRE_CODES.has(e.code)) outcome = { ok: false, status: e.status, code: e.code as DropWireErrorCode };
      else if (e instanceof ApiError && e.code === 'project_not_found') outcome = { ok: false, status: 410, code: 'code_closed' };
      else outcome = { ok: false, status: 500, code: 'internal_error' };
      log(`[drop] code ${c.dropId}: an upload was refused (${outcome.code})`);
    } finally {
      finished = true;
      timers.clearTimer(stallTimer);
      c.uploads.delete(up);
      c.inFlightBytes -= length;
    }
    if (outcome.ok) {
      c.files += 1;
      c.bytes += length;
      c.lastActivity = now();
    }
    emit(c);
    if (stalled || res.headersSent || res.destroyed) return;
    if (!outcome.ok) {
      // the queue may have stopped reading part-way: take the body back from the meter before draining it
      req.unpipe(meter);
      meter.destroy();
      return refuse(req, res, outcome.status, outcome.code);
    }
    const b = budget(c);
    const body: DropUploadResponse = { accepted: true, bytes: length, remainingBytes: b.remainingBytes, filesLeft: b.filesLeft };
    answer(res, 201, body);
  };

  const onRequest = (c: Code, req: IncomingMessage, res: ServerResponse, expectsContinue: boolean) => {
    const peer = plainIPv4(req.socket.remoteAddress);
    if (!sameSubnet(peer, c.address, c.netmask)) { req.socket.destroy(); return; }
    if (req.headers.host !== c.host) return refuse(req, res, 404, null);
    const origin = req.headers.origin;
    if ((origin !== undefined && origin !== c.origin) || req.headers['sec-fetch-site'] === 'cross-site') return refuse(req, res, 403, 'invalid_request');
    const route = `${req.method} ${req.url}`;
    const cls: RouteClass = route === 'POST /hello' ? 'hello' : route === 'POST /upload' ? 'upload' : 'other';
    const taken = bucketFor(c, peer, cls).take();
    if (!taken.ok) return refuse(req, res, 429, 'rate_limited', { 'Retry-After': String(taken.retryAfterSeconds) });
    if (c.state === 'closed') return refuse(req, res, 410, cls === 'hello' ? 'code_expired' : 'code_closed');
    const run = (p: Promise<void> | void) => {
      void Promise.resolve(p).catch((e: unknown) => {
        log(`[drop] code ${c.dropId}: internal error on a ${cls} request (${e instanceof Error ? e.name : 'unknown'})`);
        refuse(req, res, 500, 'internal_error');
      });
    };
    try {
      switch (route) {
        case 'GET /': return servePage(c, req, res);
        case 'POST /hello': return run(hello(c, peer, req, res));
        case 'POST /upload': return run(upload(c, peer, req, res, expectsContinue));
        case 'POST /status': return run(status(c, peer, req, res));
        case 'POST /bye': return run(bye(c, peer, req, res));
        default: return refuse(req, res, 404, null);
      }
    } catch (e) {
      log(`[drop] code ${c.dropId}: internal error (${e instanceof Error ? e.name : 'unknown'})`);
      refuse(req, res, 500, 'internal_error');
    }
  };

  const createServer = (c: Code): http.Server => {
    const server = http.createServer({
      maxHeaderSize: limits.maxHeaderBytes,
      headersTimeout: limits.headersTimeoutMs,
      requestTimeout: 0, // a slow phone may take long over a 2 GB file: the stall timer guards an upload body, and every other
      // body is bounded by drainMs (GET / refuses one, hello/status/bye read within drainMs, refusals drain within drainMs)
      keepAliveTimeout: limits.keepAliveTimeoutMs,
      connectionsCheckingInterval: limits.connectionsCheckingIntervalMs,
      requireHostHeader: true,
      joinDuplicateHeaders: false,
    }, (req, res) => onRequest(c, req, res, false));
    // one over the door's own limit: admit() sees the newcomer at a full door and makes room for it (evictFor) or drops it
    server.maxConnections = limits.maxConnections + 1;
    // Expect: 100-continue is answered only when the upload is accepted, so a refused body is never invited.
    server.on('checkContinue', (req, res) => onRequest(c, req, res, true));
    server.on('connection', (socket: Socket) => admit(c, socket));
    server.on('clientError', (err: NodeJS.ErrnoException, socket: Socket) => {
      if (!socket.writable || err.code === 'ECONNRESET') { socket.destroy(); return; }
      const st = err.code === 'HPE_HEADER_OVERFLOW' ? 431 : err.code === 'ERR_HTTP_REQUEST_TIMEOUT' ? 408 : 400;
      socket.end(`HTTP/1.1 ${st} ${http.STATUS_CODES[st]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    });
    return server;
  };

  const issue = async (by: Principal, projectId: string, address: string): Promise<DropCodeView> => {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the owner can open uploading from a phone', {}, 'Open the phone drop from the editor on this computer.');
    if (!deps.projectExists(projectId)) throw new ApiError(404, 'project_not_found', `project ${projectId} not found`, { projectId });
    const list = door.addresses();
    if (list.length === 0) throw new ApiError(409, 'no_private_network', 'this computer has no home-network address a phone could reach', {}, 'Connect this computer to the home Wi-Fi (not only a VPN or a mobile hotspot) and try again.');
    const chosen = list.find((a) => a.address === address);
    if (!chosen) throw new ApiError(400, 'invalid_address', 'that address is not one of this computer\'s home-network addresses', { addresses: list.map((a) => a.address) }, 'Choose one of the listed addresses.');
    if (live) {
      const old = live;
      shut(old, 'replaced');
      await old.closed;
    }
    const at = now();
    const token = rid(16);
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    let resolveClosed: () => void = () => {};
    const closed = new Promise<void>((r) => { resolveClosed = r; });
    const c: Code = {
      dropId: `drop_${rid(9).replace(/[-_]/g, 'x')}`, projectId, issuedBy: by.actor,
      address: chosen.address, netmask: chosen.netmask, port: deps.port, host: '', origin: '',
      server: null as unknown as http.Server, closed,
      token, pin, tokenDigest: digest(token), pinDigest: digest(pin), sessionDigest: null, claimIp: null,
      state: 'waiting', closeReason: null, issuedAt: at, lastActivity: at, closedAt: null,
      badHellos: 0, files: 0, bytes: 0, inFlightBytes: 0, uploads: new Set(), buckets: new Map(), lifeTimer: null, page: null, sockets: new Map(), conns: new Map(),
    };
    c.server = createServer(c);
    c.server.once('close', () => resolveClosed());
    try {
      await new Promise<void>((resolve, reject) => {
        c.server.once('error', reject);
        c.server.listen({ port: deps.port, host: c.address, exclusive: true }, () => { c.server.removeListener('error', reject); resolve(); });
      });
    } catch (e) {
      resolveClosed();
      const why = (e as NodeJS.ErrnoException).code ?? 'error';
      log(`[drop] could not listen on ${c.address}:${deps.port} (${why})`);
      throw new ApiError(503, 'drop_listen_failed', `the phone drop could not open port ${deps.port} on ${c.address}`, { port: deps.port, reason: why }, 'Another program may be using that port; close it or set PF_DROP_PORT, then try again.');
    }
    c.server.on('error', (e: NodeJS.ErrnoException) => log(`[drop] code ${c.dropId}: listener error (${e.code ?? e.name})`));
    const bound = c.server.address();
    c.port = typeof bound === 'object' && bound ? bound.port : deps.port;
    c.host = `${c.address}:${c.port}`;
    c.origin = `http://${c.host}`;
    live = c;
    armLife(c);
    log(`[drop] code ${c.dropId} open on ${c.host} for project ${projectId} (issued by ${by.actor})`);
    emit(c);
    return codeView(c);
  };

  const door: DropDoor = {
    events,
    addresses() { return candidateAddresses(interfaces(), deps.admitAddresses, preferred()); },
    open(by, projectId, address) {
      // one open at a time: a second request waits for the first, then replaces it
      const next = chain.then(() => issue(by, projectId, address));
      chain = next.catch(() => undefined);
      return next;
    },
    current(projectId) {
      if (!live || live.state === 'closed') return null;
      if (projectId !== undefined && live.projectId !== projectId) return null;
      return codeView(live);
    },
    close(dropId, reason) {
      const c = live;
      if (!c || c.dropId !== dropId) throw new ApiError(404, 'drop_not_found', 'there is no live drop code', { dropId });
      shut(c, reason);
      return codeView(c);
    },
    async stop() {
      await chain;
      const c = live;
      if (c) { shut(c, 'shutdown'); await c.closed; }
    },
  };
  return door;
}
