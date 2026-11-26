/**
 * Memory only (wave 8 `sources`): the services' answers (Pixabay 24 hours as its terms ask, the others 1 hour; keyed by the
 * SHA-256 of the service and the parameters, so no query is a key in plain text) and the local request counts behind the
 * «נשארו N חיפושים» number (C9). Nothing here is ever written to disk or logged; a restart forgets all of it.
 */
import { createHash } from 'node:crypto';
import type { SourceLimitRow } from '@pulseframe/providers';

/** The most answers kept (the oldest go first). */
export const CACHE_ENTRIES = 256;

export class AnswerCache<V> {
  private map = new Map<string, { value: V; expires: number; provider: string }>();
  constructor(private now: () => number = Date.now) {}
  static key(provider: string, params: unknown): string { return createHash('sha256').update(`${provider}\u0000${JSON.stringify(params)}`).digest('hex'); }
  get(key: string): V | null {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.expires <= this.now()) { this.map.delete(key); return null; }
    return e.value;
  }
  set(key: string, provider: string, value: V, ttlMs: number): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + ttlMs, provider });
    while (this.map.size > CACHE_ENTRIES) this.map.delete(this.map.keys().next().value!);
  }
  /** A service's answers go when its key or client changes. */
  dropProvider(provider: string): void { for (const [k, e] of this.map) if (e.provider === provider) this.map.delete(k); }
  get size(): number { return this.map.size; }
}

/**
 * Requests this editor sent to a service, counted against the service's own limit rows for who is asking (anonymous, client,
 * key…). `remaining` is the smallest room left over those rows; a full window answers how many seconds until a request falls out.
 */
export class RequestCounter {
  private sent = new Map<string, number[]>();
  constructor(private now: () => number = Date.now) {}
  private list(provider: string, who: string): number[] {
    const k = `${provider}:${who}`;
    let l = this.sent.get(k);
    if (!l) { l = []; this.sent.set(k, l); }
    return l;
  }
  record(provider: string, who: string): void { this.list(provider, who).push(this.now()); }
  /** Room left (count of the tightest row) and when the next request is allowed (0 = now), or null when no row applies. */
  room(provider: string, who: string, rows: readonly SourceLimitRow[]): { count: number; perSeconds: number; retryAfterSeconds: number } | null {
    const mine = rows.filter((r) => r.who === who);
    if (!mine.length) return null;
    const t = this.now();
    const l = this.list(provider, who);
    const longest = Math.max(...mine.map((r) => r.perSeconds)) * 1000;
    while (l.length && l[0]! <= t - longest) l.shift();
    let best: { count: number; perSeconds: number; retryAfterSeconds: number } | null = null;
    for (const r of mine) {
      const inWindow = l.filter((x) => x > t - r.perSeconds * 1000);
      const count = Math.max(0, r.requests - inWindow.length);
      const retryAfterSeconds = count > 0 ? 0 : Math.max(1, Math.ceil((inWindow[inWindow.length - r.requests]! + r.perSeconds * 1000 - t) / 1000));
      if (!best || count < best.count || (count === best.count && retryAfterSeconds > best.retryAfterSeconds)) best = { count, perSeconds: r.perSeconds, retryAfterSeconds };
    }
    return best;
  }
}
