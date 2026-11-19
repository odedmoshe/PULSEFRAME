/**
 * Local-profile access control (SPEC §4, §26). Loopback-only does not mean unauthenticated:
 *  - Host header must be a loopback name (DNS-rebinding defence).
 *  - Browsers: an HttpOnly SameSite=Strict session cookie, issued only to allow-listed origins.
 *  - Agents/scripts: bearer tokens stored 0600 in the data dir. Scopes are enforced here, server-side.
 * Actor identity always comes from the credential, never from request bodies.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';
import { ApiError } from './store.ts';

export type Scope = 'observe' | 'edit';
export type { Principal } from './governance.ts';
import type { Principal } from './governance.ts';
/** `owner` is the launch secret that lets a browser become the owner; `agent`/`observer` are the built-in bearer credentials. */
export interface Tokens { agent: string; observer: string; owner: string }

const COOKIE = 'pf_session';
export class Auth {
  readonly tokens: Tokens;
  private sessions = new Map<string, Principal>();
  /** Named agent grants (governance.ts). Checked before the bootstrap tokens. */
  resolveGrant: ((token: string) => Principal | null) | null = null;
  /** Clock for the rate limiter (replaceable in tests). */
  now: () => number = Date.now;
  private buckets = new Map<string, { tokens: number; at: number }>();
  private allowedHosts: Set<string>;
  private allowedOrigins: Set<string>;

  constructor(private cfg: Config) {
    const file = path.join(cfg.dataDir, 'tokens.json');
    const stored: Partial<Tokens> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    this.tokens = { agent: stored.agent ?? `pfa_${randomBytes(24).toString('base64url')}`, observer: stored.observer ?? `pfo_${randomBytes(24).toString('base64url')}`, owner: stored.owner ?? `pfk_${randomBytes(24).toString('base64url')}` };
    if (!stored.agent || !stored.observer || !stored.owner) fs.writeFileSync(file, JSON.stringify(this.tokens, null, 2), { mode: 0o600 });
    const hosts = ['127.0.0.1', 'localhost', '[::1]'].map((h) => `${h}:${cfg.port}`);
    this.allowedHosts = new Set([...hosts, ...cfg.extraOrigins.map((o) => new URL(o).host)]);
    this.allowedOrigins = new Set([...hosts.map((h) => `http://${h}`), ...cfg.extraOrigins]);
  }

  private same(a: string, b: string) {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }
  checkHost(req: Request) {
    const host = req.headers.get('host') ?? '';
    if (!this.allowedHosts.has(host)) throw new ApiError(403, 'forbidden_host', 'Host header is not an allowed loopback name');
  }
  originAllowed(req: Request): boolean {
    const origin = req.headers.get('origin');
    return origin === null ? req.headers.get('sec-fetch-site') !== 'cross-site' : this.allowedOrigins.has(origin);
  }
  /** The owner session already carried by this request, if any. */
  sessionOf(req: Request): Principal | null {
    const sid = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('cookie') ?? '')?.[1];
    return (sid && this.originAllowed(req) && this.sessions.get(sid)) || null;
  }
  /**
   * Issue the owner's browser session. An allowed origin is NOT proof of being the owner's browser (any local program can send
   * that header), so the caller must also present the launch secret from the link the server prints at start-up.
   * Agents are given bearer tokens or grants, never this secret, so they cannot promote themselves to owner over HTTP.
   */
  issueSession(req: Request): string {
    if (!this.originAllowed(req)) throw new ApiError(403, 'forbidden_origin', 'origin not allowed');
    const key = req.headers.get('x-pf-owner-key') ?? '';
    if (!key || !this.same(key, this.tokens.owner)) throw new ApiError(401, 'owner_key_required', 'opening the editor as the owner needs the link the server printed when it started', {}, 'Open the "Editor (owner)" link from the server start-up output; it carries a one-machine secret key.');
    const sid = randomBytes(24).toString('base64url');
    this.sessions.set(sid, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] });
    return `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/${this.cfg.secureCookie ? '; Secure' : ''}`;
  }
  /**
   * Per-credential request budget for agents: a token bucket holding ten seconds' worth of requests, refilled continuously.
   * It stops a runaway agent loop from starving the editor; it is not an abuse defence for a public service.
   */
  private throttle(p: Principal): Principal {
    // a grant's own budget, when the owner set one, replaces the server-wide setting for that credential
    const perMinute = p.grant?.requestsPerMinute ?? this.cfg.agentRequestsPerMinute;
    if (!perMinute || p.kind !== 'agent') return p;
    const key = p.grant?.id ?? p.actor;
    const capacity = Math.max(1, perMinute / 6), perMs = perMinute / 60_000, now = this.now();
    const b = this.buckets.get(key) ?? { tokens: capacity, at: now };
    b.tokens = Math.min(capacity, b.tokens + (now - b.at) * perMs);
    b.at = now;
    this.buckets.set(key, b);
    if (b.tokens < 1) {
      const retryAfterSeconds = Math.ceil((1 - b.tokens) / perMs / 1000);
      throw new ApiError(429, 'rate_limited', `this credential is limited to ${perMinute} requests per minute`, { limitPerMinute: perMinute, retryAfterSeconds }, `Wait ${retryAfterSeconds} s and continue; batch edits into one transaction where possible.`);
    }
    b.tokens -= 1;
    return p;
  }
  authenticate(req: Request): Principal {
    const header = req.headers.get('authorization');
    if (header?.startsWith('Bearer ')) {
      const token = header.slice(7);
      const granted = this.resolveGrant?.(token);
      if (granted) return this.throttle(granted);
      if (this.same(token, this.tokens.agent)) return this.throttle({ actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] });
      if (this.same(token, this.tokens.observer)) return this.throttle({ actor: 'agent:observer', kind: 'agent', scopes: ['observe'] });
      throw new ApiError(401, 'invalid_token', 'bearer token not recognised');
    }
    const sid = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.get('cookie') ?? '')?.[1];
    const session = sid && this.sessions.get(sid);
    if (session) {
      // Cookie credentials are ambient, so they are only honoured for allow-listed origins (CSRF defence).
      if (!this.originAllowed(req)) throw new ApiError(403, 'forbidden_origin', 'origin not allowed');
      return session;
    }
    throw new ApiError(401, 'unauthenticated', 'authentication required', {}, 'Send Authorization: Bearer <token> (see tokens.json in the data directory).');
  }
  require(p: Principal, scope: Scope) {
    if (!p.scopes.includes(scope)) throw new ApiError(403, 'insufficient_scope', `this credential lacks the "${scope}" scope`, { required: scope, granted: p.scopes });
  }
}
