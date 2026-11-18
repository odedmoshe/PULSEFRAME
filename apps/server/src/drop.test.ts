/**
 * The phone drop door (ADR-0023, W1): the second listener as an attacker on the same Wi-Fi sees it. The door is bound to
 * 127.0.0.2 through an injected interface list (admitted, since loopback is not a private range: the range rule itself is in
 * dropNet.test.ts); "the phone" connects from 127.0.0.3 and "another device" from 127.0.0.4 (fixed ports 9001-9004). A fake
 * clock drives the code's lifetime, the stall timer and the refusal drain; the import queue is a labelled FAKE that reads the
 * body as the real receive() does and records what it was asked to enqueue and which uploads were aborted.
 */
import { createHash } from 'node:crypto';
import http from 'node:http';
import net from 'node:net';
import type { NetworkInterfaceInfo } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { DropPublicView, ImportRoom } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { DropPage } from './drop-page/index.ts';
import { createDropDoor, type DropTimers } from './drop.ts';
import { DROP_DEFAULTS, type DropDoor, type DropLimits, type ReceiveRequest } from './importContracts.ts';
import { ApiError, type JobRow } from './store.ts';

const BIND = '127.0.0.2';
const PHONE = '127.0.0.3';
const OTHER = '127.0.0.4';
const ALT = '127.0.0.6';
const PORT = 9001;
const BUSY_PORT = 9002;
const PROJECT = 'prj_drop1';
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
const PAGE: DropPage = { body: Buffer.from('<!doctype html><html lang="he" dir="rtl"><title>העלאה</title><p>שלום</p></html>', 'utf8'), csp: "default-src 'none'; script-src 'sha256-AAAA'; style-src 'sha256-BBBB'; connect-src 'self'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'" };

// every secret any test saw, and every event and log line any door produced: checked by the last test of the file
const SECRETS = new Set<string>();
const ALL_EVENTS: string[] = [];
const ALL_LOGS: string[] = [];

/** A fake clock for the door's lifetime, stall and drain timers. advance() fires what falls due, in order. */
class FakeClock implements DropTimers {
  t = Date.UTC(2026, 10, 18, 10, 0, 0);
  private seq = 0;
  private due = new Map<number, { at: number; fn: () => void }>();
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => { const id = ++this.seq; this.due.set(id, { at: this.t + Math.max(0, ms), fn }); return id; };
  clearTimer = (h: unknown) => { this.due.delete(h as number); };
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.due) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      this.due.delete(next[0]);
      this.t = Math.max(this.t, next[1].at);
      next[1].fn();
    }
    this.t = end;
  }
}

/**
 * FAKE import queue (test double; the real one is W2's importQueue.ts). receive() reads the body to its end as the real one
 * does, refuses a short body with upload_incomplete, honours the abort signal, and records only what it would have enqueued.
 */
class FakeQueue {
  started: ReceiveRequest[] = [];
  enqueued: { req: ReceiveRequest; sha256: string; bytes: number }[] = [];
  aborted: string[] = [];
  roomValue: ImportRoom = { ceilingRoomBytes: null, freeDiskBytes: null, reserveBytes: 0, maxFileBytes: 2 * 1024 ** 3 };
  failWith: Error | null = null;
  /** Stop reading after this many bytes and refuse (as the real receive() does when a stream outgrows a limit). */
  failAfter: { bytes: number; error: Error } | null = null;
  hold: Promise<void> | null = null;
  room = (): ImportRoom => this.roomValue;
  receive = async (req: ReceiveRequest): Promise<JobRow> => {
    this.started.push(req);
    if (this.failWith) throw this.failWith;
    const abort = new Promise<never>((_, reject) => {
      const fire = () => { this.aborted.push(req.name); reject(new ApiError(400, 'upload_incomplete', 'aborted')); };
      if (req.signal?.aborted) fire(); else req.signal?.addEventListener('abort', fire, { once: true });
    });
    abort.catch(() => undefined);
    const hash = createHash('sha256');
    let bytes = 0;
    const read = new Promise<void>((resolve, reject) => {
      req.body.on('data', (c: Buffer) => {
        bytes += c.length;
        hash.update(c);
        if (this.failAfter && bytes >= this.failAfter.bytes) { req.body.pause(); reject(this.failAfter.error); }
      });
      req.body.on('end', resolve);
      req.body.on('error', reject);
    });
    await Promise.race([read, abort]);
    if (this.hold) await Promise.race([this.hold, abort]);
    if (req.declaredBytes !== null && bytes !== req.declaredBytes) throw new ApiError(400, 'upload_incomplete', 'short');
    this.enqueued.push({ req, sha256: hash.digest('hex'), bytes });
    return { id: `job_${this.enqueued.length}` } as JobRow;
  };
}

const nic = (address: string, netmask: string): NetworkInterfaceInfo => ({ address, netmask, family: 'IPv4', internal: false, mac: '00:00:00:00:00:00', cidr: null }) as NetworkInterfaceInfo;

const doors: DropDoor[] = [];
afterEach(async () => { for (const d of doors.splice(0)) await d.stop(); });

function setup(over: Partial<DropLimits> = {}, opts: { netmask?: string; admit?: string[]; port?: number } = {}) {
  const clock = new FakeClock();
  const queue = new FakeQueue();
  const logs: string[] = [];
  const events: DropPublicView[] = [];
  const netmask = opts.netmask ?? '255.0.0.0';
  const door = createDropDoor({
    queue, projectExists: (id) => id === PROJECT, page: () => PAGE, port: opts.port ?? PORT,
    limits: { ...DROP_DEFAULTS, ...over }, admitAddresses: opts.admit ?? [BIND, ALT],
    interfaces: () => ({ lo: [nic(BIND, netmask), nic(ALT, netmask)], eth0: [nic('192.0.2.10', '255.255.255.0')] }),
    preferredAddress: () => null, now: clock.now, timers: clock,
    log: (l) => { logs.push(l); ALL_LOGS.push(l); },
  });
  door.events.on('drop', (v: DropPublicView) => { events.push(v); ALL_EVENTS.push(JSON.stringify(v)); });
  doors.push(door);
  return { clock, queue, logs, events, door };
}
async function openCode(door: DropDoor, address = BIND) {
  const v = await door.open(OWNER, PROJECT, address);
  const token = v.url!.split('#')[1]!;
  SECRETS.add(token);
  SECRETS.add(v.pin!);
  return { view: v, token, pin: v.pin! };
}

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: string }
interface Req { method?: string; path?: string; headers?: Record<string, string>; body?: Buffer | string; from?: string; to?: string; port?: number; host?: string | null }
function send(r: Req): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const to = r.to ?? BIND;
    const port = r.port ?? PORT;
    const headers: Record<string, string> = { ...(r.host === null ? {} : { host: r.host ?? `${to}:${port}` }), ...r.headers };
    const body = r.body === undefined ? undefined : Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.body, 'utf8');
    if (body && headers['content-length'] === undefined && headers['transfer-encoding'] === undefined) headers['content-length'] = String(body.length);
    const req = http.request({ host: to, port, method: r.method ?? 'GET', path: r.path ?? '/', localAddress: r.from ?? PHONE, agent: false, setHost: false, headers }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (d: Buffer) => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}
const json = (r: Reply) => JSON.parse(r.body) as Record<string, unknown>;
const errCode = (r: Reply) => (json(r).error as { code: string }).code;
async function hello(body: unknown, from = PHONE): Promise<Reply> {
  return send({ method: 'POST', path: '/hello', from, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function claim(token: string, from = PHONE): Promise<string> {
  const r = await hello({ token }, from);
  expect(r.status).toBe(200);
  const session = json(r).session as string;
  SECRETS.add(session);
  return session;
}
const bearer = (s: string) => ({ authorization: `Bearer ${s}` });
async function upload(session: string, body: Buffer, name = 'clip.mp4', from = PHONE, extra: Record<string, string> = {}): Promise<Reply> {
  return send({ method: 'POST', path: '/upload', from, headers: { ...bearer(session), 'x-filename': encodeURIComponent(name), ...extra }, body });
}
/** The door's port refuses connections (no listener). */
function connectOutcome(to = BIND, port = PORT, from = PHONE): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect({ host: to, port, localAddress: from });
    s.on('connect', () => { s.destroy(); resolve('connected'); });
    s.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? 'error'));
  });
}
async function until(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const refusedSoon = () => until(async () => (await connectOutcome()) === 'ECONNREFUSED', 3000);
/** A raw HTTP exchange over one socket: what the door answers, and whether the socket was reset or closed. */
function raw(text: string | Buffer, opts: { from?: string; waitMs?: number } = {}): Promise<{ data: string; how: string }> {
  return new Promise((resolve) => {
    const s = net.connect({ host: BIND, port: PORT, localAddress: opts.from ?? PHONE });
    const parts: Buffer[] = [];
    let how = 'open';
    s.on('connect', () => s.write(text));
    s.on('data', (d: Buffer) => parts.push(d));
    s.on('error', (e: NodeJS.ErrnoException) => { how = e.code ?? 'error'; });
    s.on('close', () => { if (how === 'open') how = 'closed'; resolve({ data: Buffer.concat(parts).toString('utf8'), how }); });
    setTimeout(() => s.destroy(), opts.waitMs ?? 2000);
  });
}
/**
 * A client that keeps writing a large body in 1 MiB chunks, as a phone browser does, and reads whatever the door answers.
 * Resolves with the answer (if one arrived) and the client-side error (if any) once the exchange ends.
 */
function streamingUpload(session: string, total: number, headers: Record<string, string> = {}, stopAfter = Infinity): { req: http.ClientRequest; done: Promise<{ reply: Reply | null; error: string | null; written: number }> } {
  let req!: http.ClientRequest;
  const done = new Promise<{ reply: Reply | null; error: string | null; written: number }>((resolve) => {
    const chunk = Buffer.alloc(1024 * 1024, 0x5a);
    let written = 0;
    let reply: Reply | null = null;
    let error: string | null = null;
    let settled = false;
    const done = () => { if (!settled) { settled = true; setTimeout(() => resolve({ reply, error, written }), 50); } };
    req = http.request({ host: BIND, port: PORT, method: 'POST', path: '/upload', localAddress: PHONE, agent: false, setHost: false, headers: { host: `${BIND}:${PORT}`, ...bearer(session), 'x-filename': 'big.mp4', 'content-length': String(total), ...headers } }, (res) => {
      const parts: Buffer[] = [];
      res.on('data', (d: Buffer) => parts.push(d));
      res.on('end', () => { reply = { status: res.statusCode!, headers: res.headers, body: Buffer.concat(parts).toString('utf8') }; done(); });
      res.on('error', () => done());
    });
    req.on('error', (e: NodeJS.ErrnoException) => { error = e.code ?? 'error'; setTimeout(done, 300); });
    const pump = () => {
      while (written < total && written < stopAfter && !req.destroyed) {
        const n = Math.min(chunk.length, total - written, stopAfter - written);
        written += n;
        if (!req.write(n === chunk.length ? chunk : chunk.subarray(0, n))) { req.once('drain', pump); return; }
      }
      if (written >= total) req.end();
    };
    pump();
  });
  return { req, done };
}
/** Like a browser: keeps writing the declared body over a raw socket whatever the door answers, and reads the answer. */
function rawUpload(session: string, total: number, stopAfter = Infinity): { data: () => string; done: Promise<{ data: string; how: string; written: number }> } {
  const parts: Buffer[] = [];
  const done = new Promise<{ data: string; how: string; written: number }>((resolve) => {
    const s = net.connect({ host: BIND, port: PORT, localAddress: PHONE });
    const chunk = Buffer.alloc(1024 * 1024, 0x5a);
    let queued = 0;
    let written = 0;
    let how = 'open';
    const pump = () => {
      while (queued < total && queued < stopAfter && !s.destroyed) {
        const n = Math.min(chunk.length, total - queued, stopAfter - queued);
        queued += n;
        const ok = s.write(n === chunk.length ? chunk : chunk.subarray(0, n), (err) => { if (!err) written += n; });
        if (!ok) { s.once('drain', pump); return; }
      }
    };
    s.on('connect', () => { s.write(`POST /upload HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nAuthorization: Bearer ${session}\r\nX-Filename: big.mp4\r\nContent-Length: ${total}\r\n\r\n`); pump(); });
    s.on('data', (d: Buffer) => parts.push(d));
    s.on('error', (e: NodeJS.ErrnoException) => { how = e.code ?? 'error'; });
    s.on('close', () => { if (how === 'open') how = 'closed'; resolve({ data: Buffer.concat(parts).toString('utf8'), how, written }); });
  });
  return { data: () => Buffer.concat(parts).toString('utf8'), done };
}
const noCookieNoCors = (r: Reply) => {
  expect(r.headers['set-cookie']).toBeUndefined();
  for (const h of Object.keys(r.headers)) expect(h.startsWith('access-control-'), h).toBe(false);
};

// =====================================================================================================================
describe('opening a code (owner only, one confirmed address)', { timeout: 60_000 }, () => {
  it('nothing listens before a code exists', async () => {
    setup();
    expect(await connectOutcome()).toBe('ECONNREFUSED');
  });

  it('only the owner session opens a code; the address must be one of the listed ones; the project must exist', async () => {
    const { door } = setup();
    const code = async (fn: () => Promise<unknown>) => { try { await fn(); return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status} ${e.code}` : String(e); } };
    expect(await code(() => door.open(AGENT, PROJECT, BIND))).toBe('403 owner_required');
    expect(await code(() => door.open({ ...AGENT, mode: 'autopilot' }, PROJECT, BIND))).toBe('403 owner_required');
    expect(await code(() => door.open(OWNER, PROJECT, '0.0.0.0'))).toBe('400 invalid_address');
    expect(await code(() => door.open(OWNER, PROJECT, '8.8.8.8'))).toBe('400 invalid_address');
    expect(await code(() => door.open(OWNER, PROJECT, '192.0.2.10'))).toBe('400 invalid_address'); // an interface, but not private
    expect(await code(() => door.open(OWNER, PROJECT, '::'))).toBe('400 invalid_address');
    expect(await code(() => door.open(OWNER, 'prj_nope', BIND))).toBe('404 project_not_found');
    expect(door.current()).toBeNull();
    expect(await connectOutcome()).toBe('ECONNREFUSED');
  });

  it('without an injected preferred address the door probes the default route itself and still lists synchronously', async () => {
    const door = createDropDoor({
      queue: new FakeQueue(), projectExists: () => true, page: () => PAGE, port: PORT, limits: DROP_DEFAULTS, admitAddresses: [BIND],
      interfaces: () => ({ lo: [nic(BIND, '255.0.0.0')] }), log: () => undefined,
    });
    doors.push(door);
    const list = door.addresses();
    expect(list.map((a) => a.address)).toEqual([BIND]);
    expect(list[0]!.preferred).toBe(false); // 127.0.0.2 is never the default route
  });

  it('a machine without a private address answers no_private_network', async () => {
    const { door } = setup({}, { admit: [] });
    expect(door.addresses()).toEqual([]);
    await expect(door.open(OWNER, PROJECT, BIND)).rejects.toMatchObject({ status: 409, code: 'no_private_network' });
  });

  it('a port that cannot be opened answers drop_listen_failed and leaves no code', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(BUSY_PORT, BIND, () => r()));
    try {
      const { door } = setup({}, { port: BUSY_PORT });
      await expect(door.open(OWNER, PROJECT, BIND)).rejects.toMatchObject({ status: 503, code: 'drop_listen_failed' });
      expect(door.current()).toBeNull();
    } finally { await new Promise<void>((r) => blocker.close(() => r())); }
  });

  it('issues a 22-character token in the URL fragment and a 6-digit PIN, bound to exactly the confirmed address', async () => {
    const { door, events, clock } = setup();
    const { view, token, pin } = await openCode(door);
    expect(view).toMatchObject({ projectId: PROJECT, state: 'waiting', closeReason: null, address: BIND, port: PORT, files: 0, bytes: 0, inFlight: 0, filesLeft: 200 });
    expect(view.url).toBe(`http://${BIND}:${PORT}/#${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pin).toMatch(/^\d{6}$/);
    expect(Date.parse(view.expiresAt) - Date.parse(view.issuedAt)).toBe(600_000);
    expect(view.issuedAt).toBe(new Date(clock.t).toISOString());
    expect(events.at(-1)).toMatchObject({ dropId: view.dropId, state: 'waiting' });
    expect(door.current(PROJECT)?.dropId).toBe(view.dropId);
    expect(door.current('prj_other')).toBeNull();
    // the listener is on 127.0.0.2 only, not on every address
    expect(await connectOutcome(ALT)).toBe('ECONNREFUSED');
    expect(await connectOutcome(BIND)).toBe('connected');
  });
});

// =====================================================================================================================
describe('GET / serves the page and nothing else is served', { timeout: 60_000 }, () => {
  it('the page carries its CSP, nosniff, no-referrer, X-Frame-Options DENY and no-store, and never a cookie or CORS header', async () => {
    const { door } = setup();
    await openCode(door);
    const r = await send({ path: '/' });
    expect(r.status).toBe(200);
    expect(r.body).toBe(PAGE.body.toString('utf8'));
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(r.headers['content-security-policy']).toBe(PAGE.csp);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
    noCookieNoCors(r);
    expect(r.body).not.toContain(PROJECT);
  });

  it('at least 40 other paths and methods, with and without a session, answer 404 with an empty body, no cookie and no CORS header', async () => {
    const { door } = setup({ otherBurst: 1000 });
    const { token } = await openCode(door);
    const session = await claim(token);
    const paths = ['/hello', '/upload', '/status', '/bye', '/index.html', '/api/v1/projects', `/api/v1/projects/${PROJECT}`, '/api/v1/session', '/api/v1/openapi.json', '/mcp', '/upload/', '/UPLOAD', '//upload', '/upload?x=1', '/./upload', '/%75pload', '/../upload', '/..%2fupload', '/?token=x', '/favicon.ico', '/robots.txt', '/.env', '/tokens.json', '/data/blobs', '/hello/', '/Hello', '/%2e%2e/%2e%2e/etc/passwd', '/drop', '/render', '/assets/index.js'];
    const tried: string[] = [];
    for (const p of paths) {
      for (const auth of [{}, bearer(session)]) {
        const r = await send({ method: 'GET', path: p, headers: auth });
        tried.push(`GET ${p}`);
        expect(r.status, `GET ${p}`).toBe(404);
        expect(r.body, `GET ${p}`).toBe('');
        noCookieNoCors(r);
      }
    }
    for (const [m, p] of [['PUT', '/upload'], ['DELETE', '/'], ['PATCH', '/hello'], ['OPTIONS', '/'], ['OPTIONS', '/upload'], ['HEAD', '/'], ['POST', '/'], ['PUT', '/'], ['DELETE', '/upload'], ['POST', '/index.html'], ['POST', '/api/v1/projects'], ['POST', '/mcp'], ['TRACE', '/'], ['GET', '/bye'], ['POST', '/upload/'], ['POST', '/hello?x']] as const) {
      const r = await send({ method: m, path: p, headers: { ...bearer(session), origin: `http://${BIND}:${PORT}`, 'access-control-request-method': 'POST' } });
      tried.push(`${m} ${p}`);
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.body).toBe('');
      noCookieNoCors(r);
    }
    expect(tried.length).toBeGreaterThanOrEqual(40);
    // absolute-form and CONNECT over a raw socket
    const abs = await raw(`GET http://${BIND}:${PORT}/ HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nConnection: close\r\n\r\n`);
    expect(abs.data).toMatch(/^HTTP\/1\.1 404 /);
    expect(abs.data).not.toMatch(/set-cookie|access-control/i);
    const connect = await raw(`CONNECT ${BIND}:${PORT} HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\n\r\n`, { waitMs: 500 });
    expect(connect.data).not.toMatch(/^HTTP\/1\.1 2/);
    // a valid session reads nothing: the page has no project id
    expect(tried.length).toBeGreaterThan(40);
  });

  it('Host and Origin mismatches are refused; Sec-Fetch-Site cross-site is refused', async () => {
    const { door } = setup();
    await openCode(door);
    for (const host of [BIND, `localhost:${PORT}`, `127.0.0.1:${PORT}`, `${BIND}:${PORT}.evil.example`, `evil.example`, `${BIND}:${PORT + 1}`]) {
      const r = await send({ path: '/', host });
      expect(r.status, host).toBe(404);
      expect(r.body).toBe('');
    }
    for (const origin of ['http://evil.example', 'null', `https://${BIND}:${PORT}`, `http://${BIND}:${PORT}/`, `http://${BIND}`]) {
      const r = await send({ path: '/', headers: { origin } });
      expect(r.status, origin).toBe(403);
      expect(json(r)).toEqual({ error: { code: 'invalid_request' } });
    }
    const cross = await send({ path: '/', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    expect((await send({ path: '/', headers: { origin: `http://${BIND}:${PORT}`, 'sec-fetch-site': 'same-origin' } })).status).toBe(200);
  });

  it('a peer outside the bound subnet is cut off before anything is parsed', async () => {
    const { door, logs, queue } = setup({}, { netmask: '255.255.255.252' });
    const { token } = await openCode(door);
    const logged = logs.length;
    const outsider = await raw(`POST /hello HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nContent-Type: application/json\r\nContent-Length: ${JSON.stringify({ token }).length}\r\n\r\n${JSON.stringify({ token })}`, { from: '127.0.0.9' });
    expect(outsider.data).toBe('');
    expect(['ECONNRESET', 'closed', 'EPIPE']).toContain(outsider.how);
    await expect(send({ path: '/', from: '127.0.0.9' })).rejects.toThrow();
    expect(logs.length).toBe(logged);
    expect(queue.started.length).toBe(0);
    expect(door.current()?.state).toBe('waiting'); // the outsider did not claim it
    expect((await send({ path: '/', from: PHONE })).status).toBe(200); // 127.0.0.3 is inside 127.0.0.0/30
  });

  it('a 429 carries Retry-After = ceil((1 − tokens) / rate)', async () => {
    const { door, clock } = setup();
    await openCode(door);
    for (let i = 0; i < DROP_DEFAULTS.otherBurst; i++) expect((await send({ path: '/' })).status).toBe(200);
    const r = await send({ path: '/' });
    expect(r.status).toBe(429);
    expect(r.headers['retry-after']).toBe('1'); // 60 per minute: one token a second
    expect(json(r)).toEqual({ error: { code: 'rate_limited' } });
    // another device has its own bucket
    expect((await send({ path: '/', from: OTHER })).status).toBe(200);
    clock.advance(1000);
    expect((await send({ path: '/' })).status).toBe(200);
  });

  it('slow headers are cut by headersTimeout (slowloris)', async () => {
    const { door } = setup({ headersTimeoutMs: 600, connectionsCheckingIntervalMs: 200 });
    await openCode(door);
    const t0 = Date.now();
    const r = await raw(`POST /hello HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nX-Slow: `, { waitMs: 5000 });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(r.how).not.toBe('open');
  });

  it('oversized headers are refused (maxHeaderSize)', async () => {
    const { door } = setup();
    await openCode(door);
    const r = await raw(`GET / HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nX-Big: ${'a'.repeat(9000)}\r\n\r\n`);
    expect(r.data).toMatch(/^HTTP\/1\.1 431 /);
  });
});

// =====================================================================================================================
describe('claiming the code: once, by one phone', { timeout: 60_000 }, () => {
  it('hello with the token works once; another device, the PIN and a replay get 409; the same phone re-claims and voids its old session', async () => {
    const { door, events } = setup();
    const { token, pin } = await openCode(door);
    const r = await hello({ token });
    expect(r.status).toBe(200);
    const body = json(r);
    expect(Object.keys(body).sort()).toEqual(['expiresInSeconds', 'filesLeft', 'maxFileBytes', 'remainingBytes', 'session']);
    expect(body).toMatchObject({ expiresInSeconds: 600, filesLeft: 200, maxFileBytes: DROP_DEFAULTS.maxFileBytes, remainingBytes: DROP_DEFAULTS.maxCodeBytes });
    const s1 = body.session as string;
    SECRETS.add(s1);
    expect(s1).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.body).not.toContain(PROJECT);
    expect(events.at(-1)?.state).toBe('connected');
    const view = door.current()!;
    expect(view.url).toBeNull();
    expect(view.pin).toBeNull();

    for (const [what, b, from] of [['token from another device', { token }, OTHER], ['PIN from another device', { pin }, OTHER], ['PIN from the phone (single use)', { pin }, PHONE]] as const) {
      const x = await hello(b, from);
      expect(x.status, what).toBe(409);
      expect(json(x)).toEqual({ error: { code: 'code_already_used' } });
    }
    // the same phone after a reload: the original token gives a new session; the old one is void
    const s2 = await claim(token, PHONE);
    expect(s2).not.toBe(s1);
    expect((await send({ method: 'POST', path: '/status', headers: bearer(s1) })).status).toBe(401);
    expect((await send({ method: 'POST', path: '/status', headers: bearer(s2) })).status).toBe(200);
    // the session is pinned to the claiming IP
    const stolen = await send({ method: 'POST', path: '/status', from: OTHER, headers: bearer(s2) });
    expect(stolen.status).toBe(401);
    expect(json(stolen)).toEqual({ error: { code: 'session_invalid' } });
  });

  it('the typed PIN claims the code too', async () => {
    const { door, queue } = setup();
    const { pin } = await openCode(door);
    const r = await hello({ pin });
    expect(r.status).toBe(200);
    const session = json(r).session as string;
    SECRETS.add(session);
    expect((await upload(session, Buffer.from('hello'))).status).toBe(201);
    expect(queue.enqueued.length).toBe(1);
  });

  it('a wrong token is 401; the fifth wrong hello locks the code and closes the listener', async () => {
    const { door, events } = setup();
    const { token } = await openCode(door);
    for (let i = 1; i <= 4; i++) {
      const r = await hello(i % 2 ? { token: 'A'.repeat(22) } : { pin: '000000' === door.current()?.pin ? '000001' : '000000' });
      expect(r.status).toBe(401);
      expect(json(r)).toEqual({ error: { code: 'code_invalid' } });
      expect(door.current()?.state).toBe('waiting');
    }
    const fifth = await hello({ token: token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A') });
    expect(fifth.status).toBe(401);
    await refusedSoon();
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'locked' });
    expect(door.current()).toBeNull();
  });

  it('a 429 never counts as a wrong hello; malformed hellos are 400 and do not count either', async () => {
    const { door, clock } = setup({ helloBurst: 2, helloPerMinute: 12, maxBadHellos: 3 });
    await openCode(door);
    expect((await hello({ token: 'x' })).status).toBe(401);
    expect((await hello({ token: 'y' })).status).toBe(401);
    const limited = await hello({ token: 'z' });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('5'); // 12 per minute: one every 5 s
    clock.advance(5000);
    for (const bad of ['not json', JSON.stringify({ token: 'a', pin: '1' }), JSON.stringify(['token']), JSON.stringify({ token: 7 }), JSON.stringify({ code: 'x' }), JSON.stringify({ token: '' })]) {
      clock.advance(5000);
      const r = await send({ method: 'POST', path: '/hello', headers: { 'content-type': 'application/json' }, body: bad });
      expect(r.status, bad).toBe(400);
      expect(json(r)).toEqual({ error: { code: 'invalid_request' } });
    }
    clock.advance(5000);
    expect((await send({ method: 'POST', path: '/hello', headers: { 'content-type': 'text/plain' }, body: '{"token":"q"}' })).status).toBe(400);
    clock.advance(5000);
    const big = await send({ method: 'POST', path: '/hello', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'x'.repeat(600) }) });
    expect(big.status).toBe(400);
    expect(door.current()?.state).toBe('waiting'); // still two wrong claims, not three
    clock.advance(5000);
    expect((await hello({ token: 'w' })).status).toBe(401);
    await refusedSoon();
  });
});

// =====================================================================================================================
describe('uploads', { timeout: 60_000 }, () => {
  it('a Hebrew file name reaches the queue decoded, as phone:<dropId>, background, with the owner as issuer; 201 says what is left', async () => {
    const { door, queue, events, clock } = setup();
    const { token, view } = await openCode(door);
    const session = await claim(token);
    const bytes = Buffer.from(Array.from({ length: 70_000 }, (_, i) => i % 251));
    const name = 'טיול בכנרת 2025 – יום א׳.mp4';
    const lm = String(Date.UTC(2025, 7, 14, 15, 3, 22));
    const r = await upload(session, bytes, name, PHONE, { 'x-pf-last-modified': lm });
    expect(r.status).toBe(201);
    expect(json(r)).toEqual({ accepted: true, bytes: bytes.length, remainingBytes: DROP_DEFAULTS.maxCodeBytes - bytes.length, filesLeft: 199 });
    noCookieNoCors(r);
    expect(queue.enqueued.length).toBe(1);
    const got = queue.enqueued[0]!;
    expect(got.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(got.req).toMatchObject({ projectId: PROJECT, actor: `phone:${view.dropId}`, name, via: 'phone', declaredBytes: bytes.length, maxBytes: bytes.length, commitKind: 'background', dropId: view.dropId, issuedBy: 'user:local', declaredLastModified: '2025-08-14T15:03:22.000Z' });
    expect(got.req.relativePath).toBeUndefined();
    expect(events.at(-1)).toMatchObject({ files: 1, bytes: bytes.length, inFlight: 0, filesLeft: 199 });
    // a last-modified date in the future is not passed on
    clock.advance(1000);
    expect((await upload(session, Buffer.from('x'), 'b.jpg', PHONE, { 'x-pf-last-modified': String(clock.t + 3 * 86_400_000) })).status).toBe(201);
    expect(queue.enqueued[1]!.req.declaredLastModified).toBeUndefined();
  });

  it('without a session, with a wrong one, with the token, or from another IP: 401 and nothing reaches the queue', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    const body = Buffer.from('abc');
    for (const [what, headers, from] of [
      ['no session', {}, PHONE], ['wrong session', bearer('A'.repeat(43)), PHONE], ['the QR token', bearer(token), PHONE],
      ['basic auth', { authorization: `Basic ${session}` }, PHONE], ['the right session from another device', bearer(session), OTHER],
    ] as const) {
      const r = await send({ method: 'POST', path: '/upload', from, headers: { ...headers, 'x-filename': 'a.jpg' }, body });
      expect(r.status, what).toBe(401);
      expect(json(r)).toEqual({ error: { code: 'session_invalid' } });
    }
    expect(queue.started.length).toBe(0);
  });

  it('411 without Content-Length (chunked), 400 empty_upload, 400 invalid_filename for a missing or malformed name', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    const chunked = await send({ method: 'POST', path: '/upload', headers: { ...bearer(session), 'x-filename': 'a.jpg', 'transfer-encoding': 'chunked' }, body: 'abcdef' });
    expect(chunked.status).toBe(411);
    expect(json(chunked)).toEqual({ error: { code: 'length_required' } });
    expect(errCode(await send({ method: 'POST', path: '/upload', headers: { ...bearer(session), 'x-filename': 'a.jpg', 'content-length': '0' } }))).toBe('empty_upload');
    expect(errCode(await send({ method: 'POST', path: '/upload', headers: bearer(session), body: 'abc' }))).toBe('invalid_filename');
    for (const bad of ['%E0%A4%A', '%', 'a%00b.jpg', '%FF.jpg', 'x'.repeat(2049)])
      expect(errCode(await send({ method: 'POST', path: '/upload', headers: { ...bearer(session), 'x-filename': bad }, body: 'abc' })), bad).toBe('invalid_filename');
    // raw Latin-1 bytes in the header (not percent-encoded)
    const latin = await raw(Buffer.concat([Buffer.from(`POST /upload HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nAuthorization: Bearer ${session}\r\nContent-Length: 3\r\nX-Filename: `), Buffer.from([0xe9]), Buffer.from('.jpg\r\nConnection: close\r\n\r\nabc')]));
    expect(latin.data).toMatch(/^HTTP\/1\.1 400 /);
    expect(queue.started.length).toBe(0);
  });

  it('a name carrying CR LF is never reflected into a header (header injection)', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    const r = await send({ method: 'POST', path: '/upload', headers: { ...bearer(session), 'x-filename': '%0D%0ASet-Cookie%3A%20a%3Db%0D%0A.jpg' }, body: 'abc' });
    expect(r.status).toBe(201);
    noCookieNoCors(r);
    expect(queue.enqueued[0]!.req.name).toBe('\r\nSet-Cookie: a=b\r\n.jpg'); // the queue cleans names (C0 controls)
    // a raw CR LF inside a header value never reaches the door's handler
    const injected = await raw(`POST /upload HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nAuthorization: Bearer ${session}\r\nX-Filename: a\rSet-Cookie: b=c\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc`);
    expect(injected.data).toMatch(/^HTTP\/1\.1 400 /);
    expect(injected.data).not.toMatch(/set-cookie/i);
    expect(queue.started.length).toBe(1);
  });

  it('413 is answered before the body is read, and a client still writing a 64 MiB body reads the JSON, not a reset', async () => {
    const { door, queue } = setup({ maxFileBytes: 1024 * 1024 });
    const { token } = await openCode(door);
    const session = await claim(token);
    const out = await streamingUpload(session, 64 * 1024 * 1024).done;
    expect(out.reply, `client error: ${out.error}`).not.toBeNull();
    expect(out.reply!.status).toBe(413);
    expect(json(out.reply!)).toEqual({ error: { code: 'upload_too_large' } });
    expect(out.reply!.headers.connection).toBe('close');
    expect(out.written).toBeLessThan(64 * 1024 * 1024); // the door stopped draining long before the end
    expect(queue.started.length).toBe(0);
    expect(door.current()).toMatchObject({ inFlight: 0, files: 0 });
  });

  it('after an early refusal the door keeps reading the body up to drainBytes before it lets go (not an immediate reset)', async () => {
    const drainBytes = 24 * 1024 * 1024;
    const { door } = setup({ maxFileBytes: 1024, drainBytes });
    const { token } = await openCode(door);
    const session = await claim(token);
    const out = await rawUpload(session, 64 * 1024 * 1024).done;
    expect(out.data).toMatch(/^HTTP\/1\.1 413 /);
    expect(out.data.endsWith('{"error":{"code":"upload_too_large"}}')).toBe(true);
    // kernel buffers on loopback hold a few MiB at most: having written well past drainBytes means the door read them
    expect(out.written).toBeGreaterThan(drainBytes);
    expect(out.written).toBeLessThan(64 * 1024 * 1024);
  });

  it('after an early refusal a body that trickles is let go after drainMs', async () => {
    const { door, clock } = setup({ maxFileBytes: 1024 });
    const { token } = await openCode(door);
    const session = await claim(token);
    const out = rawUpload(session, 64 * 1024 * 1024, 64 * 1024);
    let closed = false;
    void out.done.then(() => { closed = true; });
    await until(() => out.data().includes('upload_too_large'));
    await new Promise((r) => setTimeout(r, 200));
    expect(closed).toBe(false); // still draining: the phone is not reset while it may still be reading
    clock.advance(DROP_DEFAULTS.drainMs);
    await until(() => closed);
  });

  it('Expect: 100-continue is answered only when the upload is accepted', async () => {
    const { door, queue } = setup({ maxFileBytes: 100 });
    const { token } = await openCode(door);
    const session = await claim(token);
    const refused = await raw(`POST /upload HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nAuthorization: Bearer ${session}\r\nX-Filename: a.jpg\r\nContent-Length: 1000\r\nExpect: 100-continue\r\n\r\n`, { waitMs: 500 });
    expect(refused.data).toMatch(/^HTTP\/1\.1 413 /);
    expect(refused.data).not.toContain('100 Continue');
    const accepted = await new Promise<string>((resolve) => {
      const s = net.connect({ host: BIND, port: PORT, localAddress: PHONE });
      let data = '';
      s.on('connect', () => s.write(`POST /upload HTTP/1.1\r\nHost: ${BIND}:${PORT}\r\nAuthorization: Bearer ${session}\r\nX-Filename: a.jpg\r\nContent-Length: 5\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n`));
      s.on('data', (d: Buffer) => { data += d.toString('utf8'); if (data.includes('100 Continue') && !data.includes('201')) s.write('hello'); });
      s.on('close', () => resolve(data));
      s.on('error', () => resolve(data));
    });
    expect(accepted).toMatch(/^HTTP\/1\.1 100 Continue/);
    expect(accepted).toContain('HTTP/1.1 201 ');
    expect(queue.enqueued.length).toBe(1);
  });

  it('the first failing limit is named: per file, then the storage ceiling, then the disk reserve, then the code budget', async () => {
    const { door, queue } = setup({ maxFileBytes: 1000, maxCodeBytes: 100, drainBytes: 64 });
    const { token } = await openCode(door);
    const session = await claim(token);
    expect(errCode(await upload(session, Buffer.alloc(1001)))).toBe('upload_too_large');
    queue.roomValue = { ...queue.roomValue, ceilingRoomBytes: 50 };
    const ceiling = await upload(session, Buffer.alloc(60));
    expect(ceiling.status).toBe(507);
    expect(errCode(ceiling)).toBe('storage_quota_exceeded');
    queue.roomValue = { ceilingRoomBytes: null, freeDiskBytes: 300 * 1024 ** 2, reserveBytes: 2 * 1024 ** 3, maxFileBytes: 2 * 1024 ** 3 };
    // a small file is never refused for the reserve while more than 256 MiB stay free; with less, it is
    expect((await upload(session, Buffer.alloc(60))).status).toBe(201);
    queue.roomValue = { ...queue.roomValue, freeDiskBytes: 200 * 1024 ** 2 };
    const disk = await upload(session, Buffer.alloc(30));
    expect(disk.status).toBe(507);
    expect(errCode(disk)).toBe('disk_full');
    queue.roomValue = { ceilingRoomBytes: null, freeDiskBytes: null, reserveBytes: 0, maxFileBytes: 2 * 1024 ** 3 };
    const budget = await upload(session, Buffer.alloc(41)); // 60 accepted of 100
    expect(budget.status).toBe(413);
    expect(errCode(budget)).toBe('code_budget');
    expect((await upload(session, Buffer.alloc(40))).status).toBe(201);
    expect(queue.started.length).toBe(2);
  });

  it('the file-count budget: the 201st file of a code is refused', async () => {
    const { door } = setup({ maxFiles: 2 });
    const { token } = await openCode(door);
    const session = await claim(token);
    expect((await upload(session, Buffer.from('1'))).status).toBe(201);
    const second = await upload(session, Buffer.from('2'));
    expect(json(second)).toMatchObject({ filesLeft: 0 });
    const third = await upload(session, Buffer.from('3'));
    expect(third.status).toBe(413);
    expect(errCode(third)).toBe('code_budget');
  });

  it('in-flight bytes are reserved at request start: two parallel uploads cannot both pass the budget; a third parallel upload waits', async () => {
    const { door, queue } = setup({ maxCodeBytes: 100, maxConcurrentUploads: 2 });
    const { token } = await openCode(door);
    const session = await claim(token);
    const first = streamingUpload(session, 60, {}, 10); // 10 of 60 bytes, then it waits
    await until(() => queue.started.length === 1);
    expect(door.current()).toMatchObject({ inFlight: 1, remainingBytes: 40, filesLeft: 199 });
    expect(errCode(await upload(session, Buffer.alloc(60)))).toBe('code_budget');
    const second = streamingUpload(session, 20, {}, 5);
    await until(() => queue.started.length === 2);
    const third = await upload(session, Buffer.alloc(5));
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBe('1');
    first.req.destroy();
    second.req.destroy();
    await until(() => door.current()?.inFlight === 0);
    expect(door.current()).toMatchObject({ remainingBytes: 100, files: 0, filesLeft: 200 });
  });

  it('a short body enqueues nothing and releases its reservation', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    const out = streamingUpload(session, 1000, {}, 500);
    await until(() => queue.started.length === 1);
    out.req.destroy();
    await until(() => queue.aborted.length === 1);
    await until(() => door.current()?.inFlight === 0);
    expect(queue.enqueued).toEqual([]);
    expect(door.current()).toMatchObject({ files: 0, bytes: 0, filesLeft: 200 });
  });

  it('a stalled upload is aborted after stallMs without body bytes', async () => {
    const { door, queue, clock, logs } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    const out = streamingUpload(session, 1000, {}, 100);
    await until(() => queue.started.length === 1);
    clock.advance(DROP_DEFAULTS.stallMs - 1);
    await new Promise((r) => setTimeout(r, 50));
    expect(queue.aborted).toEqual([]);
    clock.advance(1);
    await until(() => queue.aborted.length === 1);
    const res = await out.done;
    expect(res.reply === null || res.reply.status === 400).toBe(true);
    expect(queue.enqueued).toEqual([]);
    expect(logs.some((l) => l.includes('stalled'))).toBe(true);
    await until(() => door.current()?.inFlight === 0);
  });

  it('refusals from the queue keep their wire code; anything else is internal_error with no message', async () => {
    const { door, queue } = setup({ drainBytes: 16 });
    const { token } = await openCode(door);
    const session = await claim(token);
    queue.failWith = new ApiError(507, 'disk_full', 'secret details /home/x');
    const full = await upload(session, Buffer.alloc(10));
    expect(full.status).toBe(507);
    expect(json(full)).toEqual({ error: { code: 'disk_full' } });
    queue.failWith = new Error('boom at /home/user/data');
    const boom = await upload(session, Buffer.alloc(10));
    expect(boom.status).toBe(500);
    expect(boom.body).toBe('{"error":{"code":"internal_error"}}');
    queue.failWith = new ApiError(404, 'project_not_found', 'gone');
    expect(errCode(await upload(session, Buffer.alloc(10)))).toBe('code_closed');
    queue.failWith = null;
    expect(door.current()).toMatchObject({ files: 0, inFlight: 0 });
  });

  it('a refusal from the queue part-way through a body still reaches a phone that keeps writing', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    queue.failAfter = { bytes: 1024 * 1024, error: new ApiError(507, 'storage_quota_exceeded', 'full') };
    const out = await rawUpload(session, 6 * 1024 * 1024).done;
    expect(out.data).toMatch(/^HTTP\/1\.1 507 /);
    expect(out.data.endsWith('{"error":{"code":"storage_quota_exceeded"}}')).toBe(true);
    expect(queue.enqueued).toEqual([]);
    await until(() => door.current()?.inFlight === 0);
    expect(door.current()).toMatchObject({ files: 0, bytes: 0 });
  });

  it('/status reports what is left; it does not count as activity', async () => {
    const { door, queue } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    queue.roomValue = { ceilingRoomBytes: 5000, freeDiskBytes: null, reserveBytes: 0, maxFileBytes: 1000 };
    await upload(session, Buffer.alloc(100));
    const r = await send({ method: 'POST', path: '/status', headers: bearer(session) });
    expect(json(r)).toEqual({ state: 'connected', maxFileBytes: 1000, remainingBytes: 5000, filesLeft: 199 });
    expect(r.body).not.toContain(PROJECT);
  });
});

// =====================================================================================================================
describe('the code ends, and the listener with it', { timeout: 60_000 }, () => {
  it('unclaimed: closes 10 minutes after issue (expired)', async () => {
    const { door, clock, events } = setup();
    await openCode(door);
    clock.advance(599_999);
    expect(await connectOutcome()).toBe('connected');
    clock.advance(1);
    await refusedSoon();
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'expired' });
  });

  it('claimed: closes after 10 idle minutes, and every received upload slides the idle window', async () => {
    const { door, clock, events } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    clock.advance(9 * 60_000);
    expect((await upload(session, Buffer.from('slide'))).status).toBe(201);
    clock.advance(9 * 60_000);
    expect((await send({ method: 'POST', path: '/status', headers: bearer(session) })).status).toBe(200);
    expect(Date.parse(door.current()!.expiresAt) - clock.t).toBe(60_000);
    clock.advance(59_999);
    expect(await connectOutcome()).toBe('connected');
    clock.advance(1);
    await refusedSoon();
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'idle' });
  });

  it('busy or not, a code lives 60 minutes at most (max-life)', async () => {
    const { door, clock, events } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    for (let m = 9; m < 60; m += 9) {
      clock.advance(9 * 60_000);
      expect((await upload(session, Buffer.from(`m${m}`))).status, `minute ${m}`).toBe(201);
    }
    expect(Date.parse(door.current()!.expiresAt)).toBe(Date.parse(door.current()!.issuedAt) + 3_600_000);
    clock.advance(60 * 60_000 - (clock.t - Date.parse(door.current()!.issuedAt)));
    await refusedSoon();
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'max-life' });
  });

  it('the owner closes it, and an upload in flight is aborted (the queue sees the abort)', async () => {
    const { door, queue, events } = setup();
    const { token, view } = await openCode(door);
    const session = await claim(token);
    const out = streamingUpload(session, 10_000, {}, 1000);
    await until(() => queue.started.length === 1);
    const closed = door.close(view.dropId, 'owner');
    expect(closed).toMatchObject({ state: 'closed', closeReason: 'owner', url: null, pin: null });
    await until(() => queue.aborted.length === 1);
    expect(queue.enqueued).toEqual([]);
    await refusedSoon();
    await out.done;
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'owner' });
    expect(() => door.close(view.dropId, 'owner')).toThrow(/no live drop code/);
    expect(door.current()).toBeNull();
  });

  it('the phone closes it with «סיימתי» (/bye)', async () => {
    const { door, events } = setup();
    const { token } = await openCode(door);
    const session = await claim(token);
    expect((await send({ method: 'POST', path: '/bye', headers: bearer(session), from: OTHER })).status).toBe(401);
    const r = await send({ method: 'POST', path: '/bye', headers: bearer(session) });
    expect(r.status).toBe(200);
    expect(json(r)).toEqual({ closed: true });
    await refusedSoon();
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'phone' });
  });

  it('a new code replaces the old one: the old listener and its session are gone', async () => {
    const { door, events } = setup();
    const first = await openCode(door);
    const session = await claim(first.token);
    const second = await openCode(door, ALT);
    expect(events.find((e) => e.dropId === first.view.dropId && e.state === 'closed')).toMatchObject({ closeReason: 'replaced' });
    await refusedSoon();
    expect(await connectOutcome(ALT)).toBe('connected');
    // replaced on the same address: the earlier session is worth nothing on the new code
    const third = await openCode(door, BIND);
    expect(door.current()?.dropId).toBe(third.view.dropId);
    expect((await send({ method: 'POST', path: '/status', headers: bearer(session) })).status).toBe(401);
    expect(await connectOutcome(ALT)).toBe('ECONNREFUSED');
    expect(second.token).not.toBe(third.token);
  });

  it('shutdown closes it', async () => {
    const { door, events } = setup();
    await openCode(door);
    await door.stop();
    expect(await connectOutcome()).toBe('ECONNREFUSED');
    expect(events.at(-1)).toMatchObject({ state: 'closed', closeReason: 'shutdown' });
  });
});

// =====================================================================================================================
describe('secrets', { timeout: 60_000 }, () => {
  it('a whole session (open, wrong claims, claim, re-claim, uploads, status, bye) puts no token, PIN or session into an event, a log line or an error body', async () => {
    const { door, events, logs } = setup();
    const { token, pin } = await openCode(door);
    const bodies: string[] = [];
    bodies.push((await hello({ token: 'nope' })).body, (await hello({ pin: '12' })).body);
    const s1 = await claim(token);
    const s2 = await claim(token);
    bodies.push((await hello({ pin })).body, (await hello({ token }, OTHER)).body);
    bodies.push((await upload(s2, Buffer.from('data'))).body, (await upload(s1, Buffer.from('data'))).body);
    bodies.push((await send({ method: 'POST', path: '/status', headers: bearer(s2) })).body, (await send({ path: '/nope' })).body);
    bodies.push((await send({ method: 'POST', path: '/bye', headers: bearer(s2) })).body);
    await refusedSoon();
    const seen = [...events.map((e) => JSON.stringify(e)), ...logs, ...bodies];
    for (const secret of [token, s1, s2]) for (const line of seen) expect(line.includes(secret), line).toBe(false);
    const pinRe = new RegExp(`(?<!\\d)${pin}(?!\\d)`);
    for (const line of seen) expect(pinRe.test(line), line).toBe(false);
    expect(logs.length).toBeGreaterThan(3);
  });

  it('no event or log line of this whole file held a token, PIN or session', () => {
    expect(SECRETS.size).toBeGreaterThan(20);
    for (const s of SECRETS) {
      const re = /^\d{6}$/.test(s) ? new RegExp(`(?<!\\d)${s}(?!\\d)`) : null;
      for (const line of [...ALL_EVENTS, ...ALL_LOGS]) expect(re ? re.test(line) : line.includes(s), line).toBe(false);
    }
  });
});
