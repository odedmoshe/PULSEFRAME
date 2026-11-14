/**
 * Phase 1 convergence test (SPEC Appendix C3 "Concurrency"; Appendix D phase 1 gate:
 * "two clients and an MCP client converge; stale edits and unauthorized requests fail predictably").
 *
 * Real in-process server, real HTTP, real SSE (fetch + hand-written frame parser), real MCP client.
 * Clients A and B are REST clients with a local replica refreshed through SSE; M is an MCP client.
 * A deterministic seeded schedule drives stale, duplicate, strict-revision, reconnect and undo traffic.
 *
 *   PF_CONVERGENCE_SEEDS=<count>  (default 15, seeds 1..count)    PF_CONVERGENCE_STEPS=<n> (default 40)
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '@pulseframe/server';

const SEEDS = Math.max(1, Number(process.env.PF_CONVERGENCE_SEEDS ?? 15));
const STEPS = Math.max(1, Number(process.env.PF_CONVERGENCE_STEPS ?? 40));
const DOCUMENTED = new Set(['conflict', 'stale_revision', 'overlap', 'out_of_bounds', 'not_found', 'invalid_args', 'invalid_result', 'incompatible', 'track_locked', 'undo_conflict', 'nothing_to_undo', 'nothing_to_redo', 'already_undone', 'idempotency_key_reused']);

// ---------- deterministic PRNG ----------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = { f(): number; int(n: number): number; pick<T>(xs: T[]): T };
const makeRng = (seed: number): Rng => {
  const f = mulberry32(seed);
  return { f, int: (n) => Math.floor(f() * n), pick: (xs) => xs[Math.floor(f() * xs.length)]! };
};
const frame = (n: number) => ({ value: String(n), timescale: 30 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(5);
  }
  return cond();
}
const clipsOf = (doc: any): any[] => Object.values(doc.sequences as Record<string, any>).flatMap((s: any) => s.tracks.flatMap((t: any) => t.clips));
const allIds = (doc: any): string[] => Object.values(doc.sequences as Record<string, any>).flatMap((s: any) => [s.id, ...s.tracks.flatMap((t: any) => [t.id, ...t.clips.map((c: any) => c.id)])]);

// ---------- server fixture ----------
let server: RunningServer;
let base: string;
let agentToken: string;
let observerToken: string;
let mcp: Client;
const openStreams = new Set<AbortController>();
const tally = new Map<string, number>();
const bump = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
let totalSteps = 0;
let seedsRun = 0;
const t0 = Date.now();

interface Http { status: number; body: any; text: string }
async function http(p: string, init: RequestInit = {}, token: string | null = agentToken): Promise<Http> {
  const r = await fetch(`${base}${p.startsWith('/mcp') ? '' : '/api/v1'}${p}`, {
    ...init,
    headers: { connection: 'close', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = undefined; }
  return { status: r.status, body, text };
}
const serverRevision = (projectId: string) => server.store.getProject(projectId).revision;

// ---------- SSE (fetch + streaming reader + frame parser) ----------
interface Frame { event: string; id?: string; data: string }
function parseFrames(buffer: string): { frames: Frame[]; rest: string } {
  const frames: Frame[] = [];
  const norm = buffer.replace(/\r\n/g, '\n');
  let rest = norm;
  let i: number;
  while ((i = rest.indexOf('\n\n')) >= 0) {
    const raw = rest.slice(0, i);
    rest = rest.slice(i + 2);
    let event = 'message';
    let id: string | undefined;
    const data: string[] = [];
    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const c = line.indexOf(':');
      const field = c < 0 ? line : line.slice(0, c);
      const value = c < 0 ? '' : line.slice(c + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'id') id = value;
      else if (field === 'data') data.push(value);
    }
    frames.push({ event, id, data: data.join('\n') });
  }
  return { frames, rest };
}
async function openSse(projectId: string, since: number, onFrame: (f: Frame) => void, token = agentToken): Promise<AbortController> {
  const ctl = new AbortController();
  openStreams.add(ctl);
  const res = await fetch(`${base}/api/v1/projects/${projectId}/events?since=${since}`, { headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' }, signal: ctl.signal });
  if (res.status !== 200 || !res.body) throw new Error(`SSE open failed: ${res.status}`);
  let hello!: () => void;
  const gotHello = new Promise<void>((r) => (hello = r));
  void (async () => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const { frames, rest } = parseFrames(buf);
        buf = rest;
        for (const f of frames) {
          if (f.event === 'hello') hello();
          onFrame(f);
        }
      }
    } catch {
      /* aborted */
    }
  })();
  await Promise.race([gotHello, sleep(3000).then(() => { throw new Error('SSE hello timeout'); })]);
  return ctl;
}

// ---------- clients ----------
interface Spec { op: string; args: Record<string, unknown>; baseRevision?: number; expectedRevision?: number; idempotencyKey: string; label: string }
interface Out { ok: boolean; status?: number; data?: any; code?: string; untyped?: string }

interface Participant {
  name: 'A' | 'B' | 'M';
  clipIds(): string[];
  baseRev(): number;
  send(spec: Spec): Promise<Out>;
  undo(): Promise<Out>;
  seen: Set<string>;
}

const normHttp = (r: Http): Out => {
  if (r.status === 200) return { ok: true, status: 200, data: r.body };
  const code = r.body?.error?.code;
  return typeof code === 'string' ? { ok: false, status: r.status, code, data: r.body } : { ok: false, status: r.status, untyped: r.text.slice(0, 300) };
};

class RestClient implements Participant {
  replica: { doc: any; rev: number } = { doc: null, rev: -1 };
  want = 0;
  held = false;
  fetching = false;
  gen = 0;
  ctl?: AbortController;
  seen = new Set<string>();
  eventRevs: number[] = [];
  error?: unknown;
  constructor(public name: 'A' | 'B', public projectId: string) {}
  clipIds = () => clipsOf(this.replica.doc).map((c) => c.id as string);
  baseRev = () => this.replica.rev;
  private install(doc: any, rev: number) {
    this.replica = { doc, rev };
    for (const c of clipsOf(doc)) this.seen.add(c.id);
  }
  async connect() {
    const r = await http(`/projects/${this.projectId}`);
    this.install(r.body.project, r.body.revision);
    await this.open();
  }
  async open() {
    const g = ++this.gen;
    this.ctl = await openSse(this.projectId, this.replica.rev, (f) => {
      if (g !== this.gen || f.event !== 'revision') return;
      const e = JSON.parse(f.data);
      this.eventRevs.push(e.revision);
      if (e.revision > this.want) this.want = e.revision;
      this.pump();
    });
  }
  /** Drop the stream and resume from the replica's own revision (reconnect with Last-Event-ID semantics). */
  async reconnect() {
    this.gen++;
    this.ctl?.abort();
    await this.open();
  }
  pump() {
    if (this.held || this.fetching) return;
    this.fetching = true;
    void (async () => {
      try {
        while (!this.held && this.want > this.replica.rev) {
          const r = await http(`/projects/${this.projectId}`);
          if (r.status !== 200) throw new Error(`refetch failed ${r.status}`);
          if (r.body.revision > this.replica.rev) this.install(r.body.project, r.body.revision);
          else if (r.body.revision < this.want) await sleep(2);
        }
      } catch (e) {
        this.error = e;
      } finally {
        this.fetching = false;
      }
    })();
  }
  hold() { this.held = true; }
  release() { this.held = false; this.pump(); }
  async send(s: Spec): Promise<Out> {
    return normHttp(await http(`/projects/${this.projectId}/transactions`, { method: 'POST', body: JSON.stringify({ ops: [{ op: s.op, args: s.args }], baseRevision: s.baseRevision, expectedRevision: s.expectedRevision, idempotencyKey: s.idempotencyKey, label: s.label }) }));
  }
  async undo(): Promise<Out> {
    return normHttp(await http(`/projects/${this.projectId}/undo`, { method: 'POST', body: '{}' }));
  }
  close() { this.gen++; this.ctl?.abort(); }
}

class McpClient implements Participant {
  name = 'M' as const;
  rev = 0;
  ids: string[] = [];
  seen = new Set<string>();
  constructor(public projectId: string) {}
  clipIds = () => this.ids;
  baseRev = () => this.rev;
  private async call(name: string, args: Record<string, unknown>) {
    const r = await mcp.callTool({ name, arguments: args });
    const text = (r.content as any[]).find((c) => c.type === 'text')?.text as string | undefined;
    let data: any;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = undefined; }
    return { isError: !!r.isError, data, text };
  }
  async refresh() {
    const r = await this.call('get_timeline', { projectId: this.projectId });
    expect(r.isError, 'M get_timeline failed').toBe(false);
    this.rev = r.data.revision;
    this.ids = r.data.tracks.flatMap((t: any) => t.clips.map((c: any) => c.id as string));
    for (const i of this.ids) this.seen.add(i);
  }
  private norm(r: { isError: boolean; data: any; text?: string }): Out {
    if (!r.isError) return { ok: true, data: r.data };
    const code = r.data?.error?.code;
    return typeof code === 'string' ? { ok: false, code, data: r.data } : { ok: false, untyped: String(r.text).slice(0, 300) };
  }
  async send(s: Spec): Promise<Out> {
    return this.norm(await this.call(s.op, { projectId: this.projectId, ...s.args, baseRevision: s.baseRevision, expectedRevision: s.expectedRevision, idempotencyKey: s.idempotencyKey, label: s.label }));
  }
  async undo(): Promise<Out> {
    return this.norm(await this.call('undo', { projectId: this.projectId }));
  }
}

// ---------- one seeded schedule ----------
interface Accepted { revision: number; affectedIds: string[]; baseRevision?: number; serverBefore: number; who: string; step: number }

async function runSeed(seed: number) {
  const rng = makeRng(seed);
  const created = await http('/projects', { method: 'POST', body: JSON.stringify({ name: `convergence-${seed}` }) });
  expect(created.status).toBe(201);
  const projectId: string = created.body.project.id;
  const initialIds = new Set(allIds(created.body.project));

  const A = new RestClient('A', projectId);
  const B = new RestClient('B', projectId);
  const M = new McpClient(projectId);
  await A.connect();
  await B.connect();
  await M.refresh();
  const all: Participant[] = [A, B, M];
  const rest = [A, B];
  const accepted: Accepted[] = [];
  const trace: string[] = [];
  let step = 0;
  const holds = new Map<RestClient, number>();
  const last = new Map<string, { spec: Spec; revision: number }>();

  /** Run one request and enforce assertions 1 and 3 plus commit bookkeeping. */
  const exec = async (who: Participant, label: string, fn: () => Promise<Out>, meta: { baseRevision?: number; expectedRevision?: number; undo?: boolean; reuse?: boolean }): Promise<{ out: Out; before: number }> => {
    const before = serverRevision(projectId);
    const out = await fn();
    const after = serverRevision(projectId);
    const tag = `seed ${seed} step ${step} ${who.name} ${label} base=${meta.baseRevision} exp=${meta.expectedRevision} serverBefore=${before}`;
    trace.push(`${tag} -> ${out.ok ? JSON.stringify({ c: out.data?.committed, r: out.data?.revision, rep: out.data?.replayed }) : (out.code ?? `UNTYPED ${out.untyped}`)}`);
    // 1. typed outcome only
    if (!out.ok) {
      expect(out.untyped, `untyped error body (${tag})`).toBeUndefined();
      if (out.status !== undefined) expect(out.status, `5xx (${tag})`).toBeLessThan(500);
      expect(DOCUMENTED.has(out.code!), `undocumented error code ${out.code} (${tag}): ${JSON.stringify(out.data)}`).toBe(true);
      // 3. rejected request changes nothing
      expect(after, `rejected request moved revision (${tag})`).toBe(before);
      bump(`err:${out.code}`);
      if (meta.expectedRevision !== undefined && meta.expectedRevision !== before && !meta.undo && !meta.reuse) expect(out.code, `strict stale edit must be stale_revision (${tag})`).toBe('stale_revision');
      return { out, before };
    }
    const d = out.data;
    expect(typeof d.revision, `ok body without revision (${tag})`).toBe('number');
    if (d.replayed) {
      expect(d.committed).toBe(true);
      expect(after, `replay moved revision (${tag})`).toBe(before);
      expect(d.revision).toBeLessThanOrEqual(before);
      bump('ok:replayed');
    } else if (d.committed) {
      expect(d.revision, `commit revision not previous+1 (${tag})`).toBe(before + 1);
      expect(after).toBe(d.revision);
      accepted.push({ revision: d.revision, affectedIds: d.affectedIds, baseRevision: meta.undo ? undefined : meta.baseRevision, serverBefore: before, who: who.name, step });
      bump(meta.undo ? 'ok:undo' : 'ok:committed');
    } else {
      expect(d.warnings, `committed:false without no_change (${tag})`).toContain('no_change');
      expect(after, `no_change moved revision (${tag})`).toBe(before);
      bump('ok:no_change');
    }
    return { out, before };
  };

  const stats = { dup: 0, reuse: 0, strict: 0, reconnect: 0, undo: 0, stale: 0 };
  try {
    for (step = 1; step <= STEPS; step++) {
      totalSteps++;
      for (const [c, left] of holds) {
        if (left <= 1) { holds.delete(c); c.release(); } else holds.set(c, left - 1);
      }
      const who = rng.pick(all);
      const dice = rng.f();

      if (dice < 0.05) { // reconnect A or B with since=<own revision>
        const c = rng.pick(rest);
        await c.reconnect();
        stats.reconnect++;
        trace.push(`seed ${seed} step ${step} reconnect ${c.name} since=${c.replica.rev}`);
        continue;
      }
      // stale intent: freeze a REST replica (SSE events pile up, replica is not refreshed) or skip M's refresh
      if (who instanceof RestClient) {
        if (rng.f() < 0.3 && !who.held) { who.hold(); holds.set(who, 1 + rng.int(4)); }
        if (!who.held && rng.f() < 0.6) await waitFor(() => who.replica.rev >= serverRevision(projectId), 300);
      } else if (rng.f() < 0.5) await M.refresh();
      const staleNow = who.baseRev() < serverRevision(projectId);
      if (staleNow) stats.stale++;
      const key = (suffix = '') => `s${seed}-${who.name}-${step}${suffix}`;
      const prev = last.get(who.name);

      if (dice < 0.12 && prev) { // duplicate delivery of an already-accepted request
        const { out } = await exec(who, `dup(${prev.spec.op})`, () => who.send(prev.spec), { baseRevision: prev.spec.baseRevision, expectedRevision: prev.spec.expectedRevision });
        expect(out.ok && out.data.replayed === true, `duplicate must replay (seed ${seed} step ${step})`).toBe(true);
        expect(out.data.revision, 'duplicate must return the original revision').toBe(prev.revision);
        stats.dup++;
        continue;
      }
      if (dice < 0.16 && prev) { // same key, different operations
        const spec: Spec = { ...prev.spec, op: 'set_clip_transform', args: { clipId: 'clp_whatever', transform: { x: 0.123456 } } };
        const { out } = await exec(who, 'key-reuse', () => who.send(spec), { baseRevision: spec.baseRevision, expectedRevision: spec.expectedRevision, reuse: true });
        expect(!out.ok && out.code === 'idempotency_key_reused', `key reuse with different ops must be idempotency_key_reused (seed ${seed} step ${step})`).toBe(true);
        stats.reuse++;
        continue;
      }
      if (dice < 0.24) { // undo for this actor (all three clients share actor agent:local)
        await exec(who, 'undo', () => who.undo(), { undo: true });
        stats.undo++;
        continue;
      }

      const ids = who.clipIds();
      const kind = ids.length === 0 ? 'add' : rng.pick(['add', 'add', 'update', 'update', 'transform', 'transform', 'move', 'move', 'delete']);
      const clipId = ids.length ? rng.pick(ids) : '';
      let op: string;
      let args: Record<string, unknown>;
      switch (kind) {
        case 'update': op = 'update_text'; args = { clipId, text: `u${seed}.${step}.${who.name}` }; break;
        case 'transform': op = 'set_clip_transform'; args = { clipId, transform: { x: +(rng.f() - 0.5).toFixed(3), y: +(rng.f() - 0.5).toFixed(3) } }; break;
        case 'move': op = 'move_clip'; args = { clipId, start: frame(rng.int(240)) }; break;
        case 'delete': op = 'delete_clip'; args = { clipId }; break;
        default: op = 'add_text'; args = { text: `t${seed}.${step}.${who.name}`, start: frame(rng.int(240)), duration: frame(1 + rng.int(45)) };
      }
      const strict = rng.f() < 0.15;
      const spec: Spec = { op, args, idempotencyKey: key(), label: `${who.name} ${op}`, ...(strict ? { expectedRevision: who.baseRev() } : { baseRevision: who.baseRev() }) };
      if (strict) stats.strict++;
      const { out } = await exec(who, op, () => who.send(spec), { baseRevision: spec.baseRevision, expectedRevision: spec.expectedRevision });
      if (out.ok && out.data.committed && !out.data.replayed) last.set(who.name, { spec, revision: out.data.revision });
    }

    // ---------- convergence ----------
    for (const c of rest) c.release();
    holds.clear();
    const finalRev = serverRevision(projectId);
    const converged = await waitFor(() => A.replica.rev === finalRev && B.replica.rev === finalRev, 5000);
    expect(A.error ?? B.error, 'replica refetch error').toBeUndefined();
    expect(converged, `A/B did not reach revision ${finalRev} via SSE within 5s (A=${A.replica.rev}, B=${B.replica.rev})`).toBe(true);
    const live = await http(`/projects/${projectId}`);
    expect(live.body.revision).toBe(finalRev);
    const liveJson = JSON.stringify(live.body.project);
    expect(JSON.stringify(A.replica.doc), 'A replica differs from server document').toBe(liveJson);
    expect(JSON.stringify(B.replica.doc), 'B replica differs from server document').toBe(liveJson);
    await M.refresh();
    expect(M.rev, 'M timeline revision').toBe(finalRev);
    expect([...M.ids].sort(), 'M clip ids differ from server').toEqual(clipsOf(live.body.project).map((c) => c.id as string).sort());

    // ---------- replay ----------
    const replay = await http(`/projects/${projectId}?revision=${finalRev}`);
    expect(replay.status).toBe(200);
    expect(replay.body.project, 'op-log replay differs from live document').toEqual(live.body.project);

    // ---------- history: no lost / phantom commits ----------
    const hist = await http(`/projects/${projectId}/history?since=0`);
    const events: { revision: number; affectedIds: string[] }[] = hist.body.events;
    expect(events.map((e) => e.revision), 'history is not exactly 1..R').toEqual(Array.from({ length: finalRev }, (_, i) => i + 1));
    const histRevs = new Set(events.map((e) => e.revision));
    for (const a of accepted) expect(histRevs.has(a.revision), `accepted revision ${a.revision} missing from history`).toBe(true);
    expect(new Set(accepted.map((a) => a.revision)).size, 'accepted commits (distinct revisions) must equal history length').toBe(finalRev);
    const byRev = new Map(events.map((e) => [e.revision, e.affectedIds]));

    // ---------- semantic-rebase safety ----------
    for (const a of accepted) {
      if (a.baseRevision === undefined || a.baseRevision >= a.serverBefore) continue;
      const mine = new Set(a.affectedIds);
      for (let r = a.baseRevision + 1; r <= a.serverBefore; r++)
        for (const id of byRev.get(r) ?? []) expect(mine.has(id), `rebase safety: rev ${a.revision} (step ${a.step}, ${a.who}, base ${a.baseRevision}) accepted over rev ${r} touching ${id}`).toBe(false);
    }

    // ---------- pending vs committed ----------
    const everCommitted = new Set<string>(initialIds);
    for (const e of events) for (const i of e.affectedIds) everCommitted.add(i);
    for (const p of [A, B, M]) for (const i of p.seen) expect(everCommitted.has(i), `replica ${p.name} contains clip ${i} never committed by the server`).toBe(true);

    seedsRun++;
    for (const [k, v] of Object.entries(stats)) tally.set(`_stats:${k}`, (tally.get(`_stats:${k}`) ?? 0) + v);
  } catch (e) {
    console.error(`convergence seed ${seed} FAILED at step ${step}: ${(e as Error).message}\n  last steps:\n  ${trace.slice(-8).join('\n  ')}`);
    throw e;
  } finally {
    A.close();
    B.close();
  }
}

describe('phase 1 convergence (two REST clients over SSE + one MCP client, one project)', () => {
  beforeAll(async () => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    server = await startServer({ port, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'pf-convergence-')) });
    base = server.url;
    agentToken = server.auth.tokens.agent;
    observerToken = server.auth.tokens.observer;
    mcp = new Client({ name: 'convergence-agent', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
  }, 60_000);

  afterAll(async () => {
    for (const c of openStreams) c.abort();
    await mcp?.close().catch(() => {});
    await server?.close();
    const t = Object.fromEntries([...tally].sort(([a], [b]) => a.localeCompare(b)));
    console.log(`convergence: ${seedsRun}/${SEEDS} seeds x ${STEPS} steps (${totalSteps} steps) in ${((Date.now() - t0) / 1000).toFixed(1)}s; tally ${JSON.stringify(t)}`);
  }, 30_000);

  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}: replicas, MCP client and op log converge`, () => runSeed(seed), 120_000);

  it('authorization: observer is read-only (REST and MCP), anonymous is 401, and nothing changes the revision', async () => {
    const created = await http('/projects', { method: 'POST', body: JSON.stringify({ name: 'authz' }) });
    const projectId: string = created.body.project.id;
    const before = serverRevision(projectId);
    const tx = JSON.stringify({ ops: [{ op: 'add_text', args: { text: 'nope', start: frame(0), duration: frame(30) } }] });

    const obs = await http(`/projects/${projectId}/transactions`, { method: 'POST', body: tx }, observerToken);
    expect(obs.status).toBe(403);
    expect(obs.body?.error?.code).toBe('insufficient_scope');
    const obsUndo = await http(`/projects/${projectId}/undo`, { method: 'POST', body: '{}' }, observerToken);
    expect(obsUndo.status).toBe(403);
    expect(obsUndo.body?.error?.code).toBe('insufficient_scope');
    expect((await http(`/projects/${projectId}`, {}, observerToken)).status, 'observer can read').toBe(200);

    const observerMcp = new Client({ name: 'convergence-observer', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await observerMcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${observerToken}` } } }));
    try {
      const r = await observerMcp.callTool({ name: 'add_text', arguments: { projectId, text: 'nope', start: frame(0), duration: frame(30) } });
      expect(r.isError).toBe(true);
      const text = (r.content as any[]).find((c) => c.type === 'text')?.text as string;
      expect(JSON.parse(text).error.code).toBe('insufficient_scope');
      const read = await observerMcp.callTool({ name: 'get_timeline', arguments: { projectId } });
      expect(read.isError ?? false).toBe(false);
    } finally {
      await observerMcp.close();
    }

    expect((await http(`/projects/${projectId}/transactions`, { method: 'POST', body: tx }, null)).status).toBe(401);
    expect((await http(`/projects/${projectId}/transactions`, { method: 'POST', body: tx }, 'pfa_wrong')).status).toBe(401);
    expect((await fetch(`${base}/api/v1/projects/${projectId}/events?since=0`, { headers: { connection: 'close' } })).status, 'SSE without token').toBe(401);
    const anonMcp = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close' }, body: '{}' });
    expect(anonMcp.status).toBe(401);

    expect(serverRevision(projectId), 'unauthorized requests must not change the revision').toBe(before);
    expect((await http(`/projects/${projectId}/history?since=0`)).body.events).toEqual([]);
  }, 60_000);
});
