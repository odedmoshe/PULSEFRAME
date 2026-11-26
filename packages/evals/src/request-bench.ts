/**
 * The HTTP-level cost of one edit, end to end, as proof:keyframes measures it ("replace_clip_keyframes commit p95: 2000 keys
 * minus 1 key"), split into where the time goes.
 *
 *   pnpm bench:request [--label before|after] [--runs 20] [--samples 3] [--modes none,sse,editor-node,browser] [--profile]
 *
 * The server runs in this process, as in the proof (startServer), with the proof's project: seven keyed titles, a linked format,
 * and a 2000-frame title G whose x channel is replaced by 1 key, then by 2000 keys, over REST with the agent token
 * (`connection: close`, the request body serialised inside the timing, exactly as the proof's `txs`). Listener modes:
 *   none         nobody listens to the project's event stream
 *   sse          an owner-session SSE client reads and parses the revision events, nothing more
 *   editor-node  an owner-session SSE client that does what the editor does on a revision event (apps/web/src/editor/sync.ts:
 *                apply the event's changes, or read the whole project when it must), in Node. Its own work runs on the server's
 *                event loop here, unlike the editor's (another process), so it adds to the edit's time: read `browser` for that
 *   browser      the real editor (apps/web/dist) in headless Chromium, open on the project (needs `pnpm build`)
 * Per mode and edit size: client total (fetch → JSON answer), the client's body serialisation, and server-side timers on the
 * real instances (Governance.commitAs, Store.commit, Store.drainOutbox = event emit and the SSE writes started by it,
 * Store.getProject = the whole-document reads the listener asks for, with how many there were). `--profile` adds a CPU profile
 * (node:inspector) of the 2000-key runs of each mode: self time grouped by where it is spent (top functions and files).
 * Results: docs/evidence/request-bench.json under the label, beside other labels. One machine, one sample of it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Session } from 'node:inspector/promises';
import { chromium, type Browser } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import type { ProjectDocument } from '@pulseframe/core';
import { EditorDocSync } from '../../../apps/web/src/editor/sync.ts';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const LABEL = opt('--label', 'before');
const RUNS = Number(opt('--runs', '20'));
const SAMPLES = Number(opt('--samples', '3'));
const MODES = opt('--modes', 'none,sse,editor-node,browser').split(',') as Mode[];
const PROFILE = args.includes('--profile');
type Mode = 'none' | 'sse' | 'editor-node' | 'browser';
const root = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(root, 'docs/evidence/request-bench.json');

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!; };
const r2 = (x: number) => Math.round(x * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wrap a method of a live instance with a timer (measurement only; the method itself is called unchanged). */
const timers: Record<string, number[]> = {};
function timeMethod<O extends object>(o: O, name: keyof O & string, label: string) {
  const orig = (o as any)[name].bind(o);
  (o as any)[name] = (...a: unknown[]) => { const t0 = performance.now(); try { return orig(...a); } finally { (timers[label] ??= []).push(performance.now() - t0); } };
}
const take = (label: string) => { const v = timers[label] ?? []; timers[label] = []; return v; };

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-reqbench-'));
  const s = await startServer({ port: 0, dataDir });
  timeMethod(s.governance, 'commitAs', 'commitAs');
  timeMethod(s.store, 'commit', 'commit');
  timeMethod(s.store, 'drainOutbox', 'emit');
  timeMethod(s.store, 'getProject', 'getProject');
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  let stringify = 0;
  const call = async (p: string, body?: unknown) => {
    const t0 = performance.now();
    const text = body === undefined ? undefined : JSON.stringify(body);
    stringify = performance.now() - t0;
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: text });
    return { status: r.status, body: (await r.json()) as any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const textClip = async (pid: string, start: number, frames: number, keys: [string, number, number, string][]) => {
    const id = (await txs(pid, [{ op: 'add_text', args: { text: 'מסלול', start: f(start), duration: f(frames), transform: { x: 0, y: 0 } } }])).results[0].output.clipId as string;
    if (keys.length) await txs(pid, keys.map(([property, k, value, easing]) => ({ op: 'set_keyframe', args: { clipId: id, property, time: f(k), value, easing } })));
    return id;
  };
  // the owner's session, as the editor holds it
  const sess = await fetch(`${s.url}/api/v1/session`, { headers: { 'x-pf-owner-key': s.auth.tokens.owner } });
  const cookie = sess.headers.get('set-cookie')!.split(';')[0]!;
  const owner = { cookie };

  let browser: Browser | null = null;
  const result: Record<string, unknown> = {};
  const profiles: Record<string, unknown> = {};
  try {
    for (const mode of MODES) {
      if (mode === 'browser' && !fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) { console.log('browser: apps/web/dist is missing (run pnpm build); skipped'); result[mode] = { skipped: 'apps/web/dist missing' }; continue; }
      const samples: unknown[] = [];
      for (let sample = 0; sample < SAMPLES; sample++) {
        const pid = (await call('/projects', { name: `bench-${mode}-${sample}`, width: 640, height: 360 })).body.project.id as string;
        await textClip(pid, 0, 60, [['x', 0, -0.3, 'linear'], ['x', 30, 0.3, 'linear']]);
        await textClip(pid, 60, 60, [['y', 0, -0.2, 'linear'], ['y', 15, 0.0987654321, 'linear'], ['y', 30, -0.1, 'linear']]);
        await textClip(pid, 120, 60, [['x', 0, -0.3, 'linear'], ['x', 40, 0.3, 'linear']]);
        await textClip(pid, 180, 60, [['x', 0, -0.2, 'ease-in'], ['x', 10, 0.1, 'ease-out'], ['x', 20, 0.25, 'linear'], ['y', 10, 0.05, 'linear']]);
        await textClip(pid, 240, 60, [['x', 0, 0, 'linear']]);
        await textClip(pid, 300, 60, [['opacity', 0, 0, 'linear'], ['opacity', 30, 1, 'linear']]);
        await textClip(pid, 360, 60, [['x', 0, -0.3, 'linear'], ['x', 15, 0.1, 'linear'], ['x', 30, 0.3, 'linear']]);
        await txs(pid, [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640, fit: 'cover' } }]);
        const G = await textClip(pid, 600, 2000, []);

        // ---- the listener
        const ac = new AbortController();
        let listener: { events: number; reads: number; mismatches: number; lastRevision: number } = { events: 0, reads: 0, mismatches: 0, lastRevision: 0 };
        let page: import('playwright').Page | null = null;
        if (mode === 'sse' || mode === 'editor-node') {
          const start = (await call(`/projects/${pid}`)).body as { project: ProjectDocument; revision: number };
          const sync = new EditorDocSync(async () => { listener.reads++; const r = await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: owner }); return (await r.json()) as { project: ProjectDocument; revision: number }; });
          sync.reset(start.project, start.revision);
          const es = await fetch(`${s.url}/api/v1/projects/${pid}/events?since=${start.revision}`, { headers: owner, signal: ac.signal });
          void (async () => {
            const dec = new TextDecoder();
            let buf = '';
            try {
              for await (const chunk of es.body as unknown as AsyncIterable<Uint8Array>) {
                buf += dec.decode(chunk, { stream: true });
                let i: number;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                  const frame = buf.slice(0, i); buf = buf.slice(i + 2);
                  const ev = /^event: (.*)$/m.exec(frame)?.[1], data = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
                  if (ev !== 'revision') continue;
                  const e = JSON.parse(data);
                  listener.events++;
                  listener.lastRevision = e.revision;
                  if (mode === 'editor-node') void sync.onEvent(e);
                }
              }
            } catch { /* aborted */ }
          })();
        } else if (mode === 'browser') {
          browser ??= await chromium.launch();
          const ctx = await browser.newContext({ viewport: { width: 1500, height: 1600 }, reducedMotion: 'reduce' });
          page = await ctx.newPage();
          await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.motionPath', '1'); } catch { /* storage unavailable */ } });
          await page.goto(`${s.ownerUrl}&project=${pid}`);
          await page.getByTestId('ruler').waitFor();
          page.on('request', (rq) => { if (rq.method() === 'GET' && new URL(rq.url()).pathname === `/api/v1/projects/${pid}`) listener.reads++; });
          await sleep(1500); // the editor opens its event stream after the document is shown
        }
        await sleep(300);

        const time = async (keys: number, n: number) => {
          const out = { total: [] as number[], stringify: [] as number[] };
          for (let i = 0; i < n; i++) {
            const ks = Array.from({ length: keys }, (_, k) => ({ time: f(k), value: Number((((k * 37 + i * 11) % 200) / 1000 - 0.1).toFixed(4)), easing: k % 3 === 0 ? 'smooth' : k % 3 === 1 ? 'overshoot' : 'linear' }));
            const t0 = performance.now();
            await txs(pid, [{ op: 'replace_clip_keyframes', args: { clipId: G, property: 'x', keys: ks } }]);
            out.total.push(performance.now() - t0);
            out.stringify.push(stringify);
          }
          return out;
        };
        await time(1, 3); // warm up, as the proof does
        await sleep(200);
        for (const k of Object.keys(timers)) take(k);
        listener = { ...listener, reads: 0 };
        const one = await time(1, RUNS);
        await sleep(200);
        const oneT = Object.fromEntries(['commitAs', 'commit', 'emit', 'getProject'].map((k) => [k, take(k)]));
        const oneReads = listener.reads;
        listener.reads = 0;
        const session = PROFILE && sample === 0 ? new Session() : null;
        if (session) { session.connect(); await session.post('Profiler.enable'); await session.post('Profiler.setSamplingInterval', { interval: 100 }); await session.post('Profiler.start'); }
        const big = await time(2000, RUNS);
        await sleep(200);
        if (session) { const { profile } = await session.post('Profiler.stop'); profiles[mode] = summarise(profile as Profile); session.disconnect(); }
        const bigT = Object.fromEntries(['commitAs', 'commit', 'emit', 'getProject'].map((k) => [k, take(k)]));
        const bigReads = listener.reads;
        const docBytes = JSON.stringify((await call(`/projects/${pid}`)).body.project).length;
        take('getProject');
        type Stat = { p50: number; p95: number; n: number };
        const stat = (v: number[]): Stat => ({ p50: r2(pct(v, 50)), p95: r2(pct(v, 95)), n: v.length });
        const timed = (t: Record<string, number[]>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, stat(v)])) as Record<'commitAs' | 'commit' | 'emit' | 'getProject', Stat>;
        const row = {
          documentBytes: docBytes,
          oneKey: { total: stat(one.total), stringify: stat(one.stringify), ...timed(oneT), wholeReads: oneReads },
          keys2000: { total: stat(big.total), stringify: stat(big.stringify), ...timed(bigT), wholeReads: bigReads },
          deltaP95: r2(pct(big.total, 95) - pct(one.total, 95)),
          deltaP50: r2(pct(big.total, 50) - pct(one.total, 50)),
          ...(mode === 'sse' || mode === 'editor-node' ? { events: listener.events } : {}),
        };
        samples.push(row);
        console.log(`${mode.padEnd(12)} #${sample}  Δp95 ${row.deltaP95.toFixed(2)} ms  Δp50 ${row.deltaP50.toFixed(2)} ms | 1 key p95 ${row.oneKey.total.p95} · 2000 keys p95 ${row.keys2000.total.p95} (commit p50 ${row.keys2000.commit.p50}, emit p50 ${row.keys2000.emit.p50}, stringify p50 ${row.keys2000.stringify.p50}) | whole-document reads 1-key ${oneReads} 2000-key ${bigReads}`);
        ac.abort();
        if (page) await page.context().close();
      }
      result[mode] = samples;
    }
  } finally {
    await browser?.close();
    await s.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  let out: Record<string, unknown> = {};
  try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* first run */ }
  out.about = 'pnpm bench:request (packages/evals/src/request-bench.ts). Milliseconds per HTTP edit (replace_clip_keyframes of 1 key and of 2000 keys on the keyframes proof\'s project, agent token, connection: close, body serialised inside the timing), per listener mode, over `runs` edits after 3 warm-ups, each mode measured `samples` times on a fresh project. Server timers are the real instances wrapped: commitAs (governance + Store.commit), commit (Store.commit, including emit), emit (Store.drainOutbox: the events and the SSE writes it starts), getProject (whole-document reads). wholeReads counts GET /projects/:id made by the listener during the runs. profile: self time of the 2000-key runs in this process (server and client), by function and by file. One machine, one sample of it, under whatever else ran.';
  out[LABEL] = { ranAt: new Date().toISOString(), machine: `${os.cpus()[0]?.model} ×${os.cpus().length}, node ${process.version}, load ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`, runs: RUNS, samples: SAMPLES, modes: result, ...(PROFILE ? { profile: profiles } : {}) };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`wrote ${path.relative(root, OUT)} (${LABEL})`);
}

interface Profile { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[]; samples: number[]; timeDeltas: number[]; startTime: number; endTime: number }
/** Self time per function and per file group, in ms, from a V8 CPU profile. */
function summarise(p: Profile) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const self = new Map<number, number>();
  p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
  const fn = new Map<string, number>(), file = new Map<string, number>();
  const group = (url: string, name: string) => {
    if (!url) return name.startsWith('(') ? name : `(native) ${name || 'anonymous'}`;
    const m = /node_modules\/(?:\.pnpm\/)?(@[^/]+\/[^/@]+|[^/@]+)/.exec(url);
    if (m) return `dep:${m[1]}`;
    if (url.startsWith('node:')) return url;
    return url.replace(/^file:\/\//, '').replace(`${root}/`, '');
  };
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const caller = new Map<string, number>();
  for (const [id, ms] of self) {
    const n = byId.get(id)!;
    const g = group(n.callFrame.url, n.callFrame.functionName);
    file.set(g, (file.get(g) ?? 0) + ms);
    const k = `${n.callFrame.functionName || '(anonymous)'} ${g}:${n.callFrame.lineNumber + 1}`;
    fn.set(k, (fn.get(k) ?? 0) + ms);
    // native code (JSON.parse/stringify, SQLite, the network) is charged to the nearest script frame that called it
    if (!n.callFrame.url) {
      let up = parent.get(id), chain: string[] = [];
      while (up !== undefined && chain.length < 3) { const u = byId.get(up)!; if (u.callFrame.url) chain.push(`${u.callFrame.functionName || '(anonymous)'} ${group(u.callFrame.url, '')}`); up = parent.get(up); }
      const ck = `${n.callFrame.functionName || '(native)'} ← ${chain.join(' ← ') || '(root)'}`;
      caller.set(ck, (caller.get(ck) ?? 0) + ms);
    }
  }
  const top = (m: Map<string, number>, k: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, ms]) => ({ name, ms: r2(ms) }));
  return { wallMs: r2((p.endTime - p.startTime) / 1000), byFile: top(file, 25), byFunction: top(fn, 30), nativeByCaller: top(caller, 20) };
}

main().catch((e) => { console.error(e); process.exit(1); });
