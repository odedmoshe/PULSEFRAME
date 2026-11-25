/**
 * The worker protocol (search/workers.ts) against the LABELLED fake script testdata/fake_pf_search.py (stdlib, no model: it proves the
 * protocol, never quality), the reviewed script apps/server/tools/pf_search.py where it can run without torch (probe, verify,
 * check-offline, its pins), and the honest setup states of the runtime (search/runtime.ts).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOOTAGE_EMBEDDERS } from '@pulseframe/core';
import { loadConfig } from '../config.ts';
import { FifoComputeLane } from '../lane.ts';
import { ApiError, Store } from '../store.ts';
import { validateVectors } from './answer.ts';
import { SEARCH_PICTURE } from './contract.ts';
import { createSearchRuntime, SEARCH_WORKER } from './runtime.ts';
import { KeptWorker, OFFLINE_ENV, probeSearchPython, SearchWorkers } from './workers.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, 'testdata', 'fake_pf_search.py');
const PY = 'python3';
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
let dir: string, tmpDir: string;
const spec = (keepSeconds = 30) => ({ python: PY, script: FAKE, tmpDir, modelDir: path.join(dir, 'model'), keepSeconds });
const withMode = async <R>(mode: string, fn: () => Promise<R>): Promise<R> => {
  const was = process.env.PF_FAKE_SEARCH_MODE;
  process.env.PF_FAKE_SEARCH_MODE = mode;
  try { return await fn(); } finally { if (was === undefined) delete process.env.PF_FAKE_SEARCH_MODE; else process.env.PF_FAKE_SEARCH_MODE = was; }
};
const frames = (rgb: [number, number, number][]) => {
  const out = new Uint8Array(rgb.length * 256 * 256 * 3);
  rgb.forEach(([r, g, b], k) => { for (let p = 0; p < 256 * 256; p++) { const o = (k * 256 * 256 + p) * 3; out[o] = r; out[o + 1] = g; out[o + 2] = b; } });
  return out;
};
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const code = async (p: Promise<unknown>) => { try { await p; return 'resolved'; } catch (e) { return e instanceof ApiError ? e.code : String(e); } };

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-searchB-w-'));
  tmpDir = path.join(dir, 'tmp');
  fs.mkdirSync(tmpDir);
});
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('the two workers speak the decided protocol (labelled fake script)', () => {
  it('scan and query are two processes, started with python -I, the offline variables and the tmp folder as working directory', async () => {
    const pidfile = path.join(dir, 'pids'), envfile = path.join(dir, 'env.json');
    process.env.PF_FAKE_SEARCH_PIDFILE = pidfile; process.env.PF_FAKE_SEARCH_ENVFILE = envfile;
    const w = new SearchWorkers(spec(), 'cpu');
    try {
      expect(w.id).toBe(FOOTAGE_EMBEDDERS.siglipCpu);
      const v = validateVectors(await w.embedImages(frames([[200, 10, 10], [10, 10, 200]]), 2, new AbortController().signal), 2);
      expect([v[0], v[768 + 2]]).toEqual([1, 1]);
      const t = validateVectors(await w.embedText(['a blue cake'], new AbortController().signal), 1);
      expect(t[2]).toBe(1);
      const pids = fs.readFileSync(pidfile, 'utf8').trim().split('\n').map((l) => l.split(' '));
      expect(pids.map((p) => p[0]).sort()).toEqual(['query', 'scan']);
      expect(new Set(pids.map((p) => p[1])).size).toBe(2);
      const env = JSON.parse(fs.readFileSync(envfile, 'utf8'));
      expect({ ...env, argv: undefined, cwd: fs.realpathSync(env.cwd) }).toEqual({ ...OFFLINE_ENV, argv: undefined, cwd: fs.realpathSync(tmpDir) });
      expect(w.relevance(1)).toBeGreaterThan(0.99); // the worker's own scale 20 and bias −10 (fake)
      expect(w.relevance(0)).toBeLessThan(0.001);
      // the frames went through a per-batch scratch folder that is gone; no text file was written anywhere
      expect(fs.readdirSync(tmpDir)).toEqual([]);
    } finally { await w.release(); delete process.env.PF_FAKE_SEARCH_PIDFILE; delete process.env.PF_FAKE_SEARCH_ENVFILE; }
    for (const [, pid] of fs.readFileSync(pidfile, 'utf8').trim().split('\n').map((l) => l.split(' '))) expect(alive(Number(pid))).toBe(false);
  });
  it('the query worker answers one request at a time, in order', async () => {
    const w = new KeptWorker(spec(), 'query', 'cpu');
    try {
      const words = ['red', 'green', 'blue', 'cake', 'red'];
      const res = await Promise.all(words.map((t) => w.request({ cmd: 'embed-text', texts: [t] }, new AbortController().signal, 30_000)));
      const idx = res.map((o) => { const b = Buffer.from(o.vectors, 'base64'); for (let i = 0; i < 768; i++) if (b.readFloatLE(i * 4) === 1) return i; return -1; });
      expect(idx).toEqual([0, 1, 2, 767, 0]);
    } finally { await w.stop(); }
  });
  it('a query too long is 400 query_too_long; a model the worker refuses is 409 picture_search_not_ready model_missing; a crash is 502', async () => {
    expect(await withMode('too-long', async () => { const w = new SearchWorkers(spec(), 'cpu'); try { return await code(w.embedText(['x'], new AbortController().signal)); } finally { await w.release(); } })).toBe('query_too_long');
    expect(await withMode('load-fail', async () => { const w = new SearchWorkers(spec(), 'cpu'); try { return await code(w.embedText(['x'], new AbortController().signal)); } finally { await w.release(); } })).toBe('picture_search_not_ready');
    expect(await withMode('crash', async () => { const w = new SearchWorkers(spec(), 'cpu'); try { return await code(w.embedText(['x'], new AbortController().signal)); } finally { await w.release(); } })).toBe('search_engine_failed');
  });
  it('vectors of wrong length, with NaN or not of unit length fail validation (502 search_engine_failed), never shown', async () => {
    for (const mode of ['wrong-length', 'nan', 'not-unit']) {
      const got = await withMode(mode, async () => {
        const w = new SearchWorkers(spec(), 'cpu');
        try { const v = await w.embedText(['red'], new AbortController().signal); return await code(Promise.resolve().then(() => validateVectors(v, 1))); } finally { await w.release(); }
      });
      expect({ mode, got }).toEqual({ mode, got: 'search_engine_failed' });
    }
  });
  it('keep 0 seconds: one process per request, gone after it; release kills a kept worker', async () => {
    const pidfile = path.join(dir, 'pids0');
    process.env.PF_FAKE_SEARCH_PIDFILE = pidfile;
    try {
      const w = new KeptWorker(spec(0), 'query', 'cpu');
      await w.request({ cmd: 'embed-text', texts: ['red'] }, new AbortController().signal, 30_000);
      await new Promise((r) => setTimeout(r, 300));
      const pid = Number(fs.readFileSync(pidfile, 'utf8').trim().split(' ')[1]);
      expect(alive(pid)).toBe(false);
      const k = new KeptWorker(spec(30), 'query', 'cpu');
      await k.request({ cmd: 'embed-text', texts: ['red'] }, new AbortController().signal, 30_000);
      expect(k.pid && alive(k.pid)).toBe(true);
      const kp = k.pid!;
      await k.stop();
      expect(alive(kp)).toBe(false);
    } finally { delete process.env.PF_FAKE_SEARCH_PIDFILE; }
  });
});

describe('the reviewed worker script pf_search.py (runnable here without torch)', () => {
  const src = fs.readFileSync(SEARCH_WORKER, 'utf8');
  it('its seven pins equal SEARCH_PICTURE.pins (path, bytes, sha256)', () => {
    const pins = [...src.matchAll(/\("([^"]+)", (\d+), "([0-9a-f]{64})"\)/g)].map((m) => ({ path: m[1], bytes: Number(m[2]), sha256: m[3] }));
    expect(pins).toEqual(SEARCH_PICTURE.pins.map((p) => ({ path: p.path, bytes: p.bytes, sha256: p.sha256 })));
  });
  it('opens no socket: with a server listening on this machine, check-offline reaches nothing and reports refused', async () => {
    let connections = 0;
    const server = net.createServer((s) => { connections++; s.destroy(); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as net.AddressInfo).port;
    try {
      const out = execFileSync(PY, ['-I', SEARCH_WORKER, 'check-offline', '--port', String(port)], { cwd: tmpDir, env: { ...process.env, ...OFFLINE_ENV } }).toString();
      expect(JSON.parse(out.trim())).toEqual({ event: 'result', refused: true });
      await new Promise((r) => setTimeout(r, 100));
      expect(connections).toBe(0);
    } finally { server.close(); }
  });
  it('sets the offline variables before any import, loads only with local_files_only, and has no download, face, crop or query-by-image code', () => {
    const head = src.slice(0, src.indexOf('import socket'));
    for (const v of ['HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY']) expect(head).toContain(`os.environ["${v}"] = "1"`);
    for (const m of src.matchAll(/from_pretrained\(([^)]*)\)/g)) expect(m[1]).toContain('local_files_only=True');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n').replace(/"""[\s\S]*?"""/g, '');
    expect(code).not.toMatch(/\b(urllib|requests|http\.client|hf_hub_download|snapshot_download)\b/);
    expect(code).not.toMatch(/face|crop|detect|person|similar/i);
  });
  it('refuses model files that are not the pinned ones (verify exits 1, model_missing, naming files never contents)', () => {
    const m = path.join(dir, 'badmodel');
    fs.mkdirSync(m, { recursive: true });
    fs.writeFileSync(path.join(m, 'config.json'), Buffer.alloc(276, 32)); // exact size, wrong bytes
    let out = '', status = 0;
    try { execFileSync(PY, ['-I', SEARCH_WORKER, 'verify', '--model', m], { cwd: tmpDir }); } catch (e: any) { out = e.stdout.toString(); status = e.status; }
    expect(status).toBe(1);
    const o = JSON.parse(out.trim());
    expect(o.code).toBe('model_missing');
    expect(o.message).toContain('config.json (checksum)');
    expect(o.message).toContain('model.safetensors (absent)');
  });
  it('the probe of a Python without torch is engine_not_working naming the module, with the next step', async () => {
    const s = await probeSearchPython({ python: PY, script: SEARCH_WORKER, tmpDir });
    expect(s.code).toBe('engine_not_working');
    expect(s.detail).toMatch(/cannot import torch/);
    expect(s.detail).toMatch(/install/);
  });
});

describe('the honest setup state, in the order a person fixes things', () => {
  let store: Store;
  beforeAll(() => { store = new Store(path.join(dir, 'data')); });
  afterAll(() => store.close());
  const rt = (o: { python?: string | null; modelDir?: string | null; worker?: string; sha?: string | null }) => createSearchRuntime({
    cfg: { ...loadConfig({}), dataDir: store.dataDir, toolsPython: o.python ?? null, searchModelDir: o.modelDir ?? null, libraryDir: null },
    store, lane: new FifoComputeLane(), worker: o.worker ?? FAKE, workerSha256: o.sha === undefined ? sha(o.worker ?? FAKE) : o.sha,
  });
  it('no reviewed digest, or another file → engine_unverified; PF_TOOLS_PYTHON unset → engine_not_configured with the step', async () => {
    let r = rt({ sha: null });
    expect((await r.setup()).code).toBe('engine_unverified'); await r.stop();
    r = rt({ sha: '0'.repeat(64) });
    expect((await r.setup()).code).toBe('engine_unverified'); await r.stop();
    r = rt({});
    const s = await r.setup();
    expect(s.code).toBe('engine_not_configured');
    expect(s.detail).toContain('PF_TOOLS_PYTHON');
    await r.stop();
  });
  it('a Python without transformers → engine_not_working naming it (fake probe); with real pf_search.py and no torch → naming torch', async () => {
    let r = rt({ python: PY });
    const s = await withMode('probe-missing', () => r.setup());
    expect(s.code).toBe('engine_not_working');
    expect(s.detail).toContain('transformers');
    await r.stop();
    r = rt({ python: PY, worker: SEARCH_WORKER });
    expect(await r.setup()).toMatchObject({ code: 'engine_not_working', detail: expect.stringContaining('torch') });
    await r.stop();
  });
  it('model absent → model_missing with exactly 1,539,637,736 bytes; files of the exact sizes with other bytes → model_missing, never ready', async () => {
    let r = rt({ python: PY });
    expect(await r.setup()).toMatchObject({ code: 'model_missing', missingBytes: 1_539_637_736 });
    await r.stop();
    const m = path.join(dir, 'model-wrong');
    fs.mkdirSync(m, { recursive: true });
    for (const pin of SEARCH_PICTURE.pins) if (pin.path !== 'model.safetensors') fs.writeFileSync(path.join(m, pin.path), Buffer.alloc(pin.bytes, 1));
    r = rt({ python: PY, modelDir: m });
    expect(await r.setup()).toMatchObject({ code: 'model_missing', missingBytes: 1_539_637_736 });
    await r.stop();
    // one pin of the right size shows its bytes are counted by checksum, not by size
    fs.writeFileSync(path.join(m, 'config.json'), Buffer.alloc(276, 2));
    r = rt({ python: PY, modelDir: m });
    expect((await r.setup()).code).toBe('model_missing');
    await r.stop();
    fs.rmSync(m, { recursive: true, force: true });
  });
  it('creating the runtime makes no file and starts no process', async () => {
    const r = rt({ python: PY });
    expect(fs.existsSync(path.join(store.dataDir, 'search'))).toBe(false);
    await r.stop();
  });
});
