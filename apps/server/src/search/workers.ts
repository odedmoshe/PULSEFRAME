/**
 * The two picture search workers (wave 7 search track; decisions §3 items 1–4, 12). Two separate processes of
 * apps/server/tools/pf_search.py — neither LocalTools nor pf_tools.py is used:
 *   - the SCAN worker (`serve --role scan`): the vision tower, CUDA fp16 when torch sees a device, else CPU fp32; used only by the scan
 *     job inside the compute lane (label searchLaneLabel), released by the lane hook before any other heavy holder;
 *   - the QUERY worker (`serve --role query`): the text tower on the CPU, outside the lane, one request at a time (FIFO).
 * Both: `python -I` (no PYTHON* variables, no user site, not the script's folder), HF_HUB_OFFLINE / TRANSFORMERS_OFFLINE /
 * HF_HUB_DISABLE_TELEMETRY, working directory the store's tmp folder; the script disarms its socket module itself and verifies the seven
 * pins before it loads. Kept for PF_TOOLS_KEEP_SECONDS after their last request (0 = one process per request), killed on release and at
 * shutdown. Texts travel inline in the JSON line and come back as vectors on stdout: nothing about a query is written to disk. Frames go
 * through a per-batch 0700 scratch folder under the tmp folder, deleted when the batch is answered.
 * Every vector is validated by the caller (answer.ts / indexJob.ts validateVectors); a worker error never echoes a query.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FOOTAGE_EMBEDDERS, type SearchSetup } from '@pulseframe/core';
import { searchError, type Embedder } from './contract.ts';
import { PYTHON_WORKER_FLAGS } from '../pythonArgs.ts';

export const OFFLINE_ENV = { HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1' } as const;
export interface WorkerSpec {
  python: string;
  /** apps/server/tools/pf_search.py (tests: the labelled fake) */
  script: string;
  /** the store's tmp folder */
  tmpDir: string;
  modelDir: string;
  keepSeconds: number;
}
export interface ReadyInfo { device: 'cuda' | 'cpu'; dtype: string; logitScale: number; logitBias: number; loadSeconds: number; versions: Record<string, string> }

const spawnWorker = (spec: Pick<WorkerSpec, 'python' | 'script' | 'tmpDir'>, args: string[], stdin: boolean): ChildProcess =>
  spawn(spec.python, [...PYTHON_WORKER_FLAGS, spec.script, ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], cwd: spec.tmpDir, env: { ...process.env, ...OFFLINE_ENV } });

function lines(p: ChildProcess, onLine: (o: any) => void): void {
  let buf = '';
  p.stdout!.setEncoding('utf8');
  p.stdout!.on('data', (d: string) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let o: unknown;
      try { o = JSON.parse(line); } catch { continue; }
      onLine(o);
    }
  });
}

/** `pf_search.py probe`: the engine part of the setup state (engine_not_working names the module it cannot import). */
export function probeSearchPython(spec: Pick<WorkerSpec, 'python' | 'script' | 'tmpDir'>, timeoutMs = 180_000): Promise<SearchSetup> {
  return new Promise((resolve) => {
    let p: ChildProcess;
    try { p = spawnWorker(spec, ['probe'], false); } catch (e) { resolve({ code: 'engine_not_working', detail: `the tools Python cannot be started: ${(e as Error).message}` }); return; }
    let result: any = null, err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    timer.unref();
    lines(p, (o) => { if (o?.event === 'result') result = o; });
    p.stderr!.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: 'engine_not_working', detail: `the tools Python (PF_TOOLS_PYTHON) cannot be started: ${e.message}` }); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && result?.ok) {
        const device = result.device === 'cuda' ? 'cuda' : 'cpu';
        const versions: Record<string, string> = {};
        for (const [k, v] of Object.entries(result.versions ?? {})) if (typeof v === 'string') versions[k] = v.slice(0, 40);
        resolve({ code: 'ready', detail: `tools environment answers (python ${String(result.python).slice(0, 20)})`, device, versions });
        return;
      }
      const missing = typeof result?.missing === 'string' ? result.missing.slice(0, 80) : null;
      resolve({ code: 'engine_not_working', detail: missing ? `the tools environment cannot import ${missing}: install the picture search requirements (apps/server/tools/requirements-search-win-cpu.txt) into PF_TOOLS_PYTHON` : `the picture search worker did not answer its probe (exit ${code})${err.trim() ? `; ${err.trim().slice(-200)}` : ''}` });
    });
  });
}

/** One kept worker process with a FIFO of requests. */
export class KeptWorker {
  private p: ChildProcess | null = null;
  private ready: Promise<ReadyInfo> | null = null;
  private info: ReadyInfo | null = null;
  private pending = new Map<number, { resolve: (o: any) => void; reject: (e: unknown) => void }>();
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private queued = 0;
  private idle: NodeJS.Timeout | null = null;
  constructor(private spec: WorkerSpec, readonly role: 'scan' | 'query', private device: 'auto' | 'cpu') {}
  get readyInfo(): ReadyInfo | null { return this.info; }
  get pid(): number | null { return this.p?.pid ?? null; }

  private start(): Promise<ReadyInfo> {
    if (this.ready) return this.ready;
    const p = spawnWorker(this.spec, ['serve', '--role', this.role, '--model', this.spec.modelDir, '--device', this.device], true);
    this.p = p;
    let err = '';
    this.ready = new Promise<ReadyInfo>((resolve, reject) => {
      lines(p, (o) => {
        if (o?.event === 'ready') {
          this.info = { device: o.device === 'cuda' ? 'cuda' : 'cpu', dtype: String(o.dtype), logitScale: Number(o.logitScale), logitBias: Number(o.logitBias), loadSeconds: Number(o.loadSeconds), versions: o.versions ?? {} };
          resolve(this.info);
        } else if (o?.event === 'error' && o.id === undefined) {
          reject(o.code === 'model_missing' ? searchError('notReady', { setup: 'model_missing' }, 'model_missing') : searchError('engineFailed', { reason: String(o.code).slice(0, 40) }));
        } else if (typeof o?.id === 'number') {
          const w = this.pending.get(o.id);
          if (w) { this.pending.delete(o.id); w.resolve(o); }
        }
      });
      p.stderr!.on('data', (d) => { err = (err + d).slice(-2000); });
      p.stdin!.on('error', () => { /* the process went away; 'close' reports it */ });
      p.on('error', (e) => reject(searchError('engineFailed', { reason: 'spawn', message: e.message.slice(0, 200) })));
      p.on('close', (code) => {
        if (this.p === p) { this.p = null; this.ready = null; this.info = null; }
        reject(searchError('engineFailed', { reason: 'exited', exit: code }));
        for (const [, w] of this.pending) w.reject(searchError('engineFailed', { reason: 'exited', exit: code }));
        this.pending.clear();
      });
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  /** One request, after the ones before it; resolves with the worker's result line, rejects with a search refusal. */
  request(body: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<any> {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    this.queued++;
    const run = async () => {
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      const info = await this.start();
      void info;
      const p = this.p;
      if (!p) throw searchError('engineFailed', { reason: 'exited' });
      const id = this.nextId++;
      const answer = new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(searchError('engineFailed', { reason: 'timeout' })); this.kill(); }, timeoutMs);
        timer.unref();
        const onAbort = () => { this.pending.delete(id); clearTimeout(timer); reject(signal.reason ?? new Error('aborted')); if (this.role === 'scan') this.kill(); };
        signal.addEventListener('abort', onAbort, { once: true });
        const done = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
        this.pending.set(id, { resolve: (o) => { done(); resolve(o); }, reject: (e) => { done(); reject(e); } });
      });
      p.stdin!.write(`${JSON.stringify({ id, ...body })}\n`);
      const o = await answer;
      if (o.event === 'error') throw o.code === 'query_too_long' ? searchError('queryTooLong') : searchError('engineFailed', { reason: String(o.code).slice(0, 40) });
      return o;
    };
    const res = this.chain.then(run, run);
    this.chain = res.catch(() => {});
    return res.finally(() => {
      this.queued--;
      if (this.queued === 0 && this.p) {
        if (!this.spec.keepSeconds) this.kill();
        else { this.idle = setTimeout(() => this.kill(), this.spec.keepSeconds * 1000); this.idle.unref(); }
      }
    });
  }
  kill(): void {
    if (this.idle) { clearTimeout(this.idle); this.idle = null; }
    const p = this.p;
    this.p = null; this.ready = null; this.info = null;
    if (p) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  }
  /** Resolves once the process is gone (shutdown). */
  async stop(): Promise<void> {
    const p = this.p;
    this.kill();
    if (p && p.exitCode === null && p.signalCode === null) await Promise.race([new Promise((r) => p.once('close', r)), new Promise((r) => setTimeout(r, 3000))]);
  }
}

/** float32 little-endian base64 → Float32Array (copied, aligned). */
export function decodeVectors(b64: unknown): Float32Array {
  if (typeof b64 !== 'string') return new Float32Array(0);
  const b = Buffer.from(b64, 'base64');
  const out = new Float32Array(Math.floor(b.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = b.readFloatLE(i * 4);
  return b.length % 4 ? new Float32Array(out.length + 1).fill(Number.NaN) : out;
}

/** The production Embedder: the two workers of pf_search.py. `device` comes from the probe (cuda → the fp16 embedder id). */
export class SearchWorkers implements Embedder {
  readonly id: string;
  readonly dim = 768;
  readonly scan: KeptWorker;
  readonly query: KeptWorker;
  constructor(private spec: WorkerSpec, device: 'cuda' | 'cpu') {
    this.id = device === 'cuda' ? FOOTAGE_EMBEDDERS.siglipGpu : FOOTAGE_EMBEDDERS.siglipCpu;
    this.scan = new KeptWorker(spec, 'scan', device === 'cuda' ? 'auto' : 'cpu');
    this.query = new KeptWorker(spec, 'query', 'cpu');
  }
  /** sigmoid(logit_scale · cos + logit_bias) with the checkpoint's own scale and bias, as the query worker reported them. */
  relevance(cos: number): number {
    const info = this.query.readyInfo;
    if (!info || !Number.isFinite(info.logitScale) || !Number.isFinite(info.logitBias)) return 0; // unknown: nothing passes the floor
    return 1 / (1 + Math.exp(-(info.logitScale * cos + info.logitBias)));
  }
  async embedImages(rgb: Uint8Array, count: number, signal: AbortSignal): Promise<Float32Array> {
    const dir = path.join(this.spec.tmpDir, `search-scan-${randomBytes(6).toString('hex')}`);
    fs.mkdirSync(dir, { mode: 0o700 });
    try {
      const file = path.join(dir, 'frames.rgb');
      fs.writeFileSync(file, rgb, { mode: 0o600 });
      const o = await this.scan.request({ cmd: 'embed-images', input: file, count }, signal, 30 * 60_000);
      return decodeVectors(o.vectors);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  async embedText(texts: readonly string[], signal: AbortSignal): Promise<Float32Array> {
    const o = await this.query.request({ cmd: 'embed-text', texts: [...texts] }, signal, 5 * 60_000);
    return decodeVectors(o.vectors);
  }
  async release(): Promise<void> {
    await Promise.all([this.scan.stop(), this.query.stop()]);
  }
}
