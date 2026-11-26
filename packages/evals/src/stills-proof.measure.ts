/**
 * pnpm proof:stills, part measure (W1, wave 8 cover): checks M1–M12 of stills-proof.ts STILLS_CHECKS. Node and the server only, no
 * browser. The integrator calls runStillsMeasureChecks() from stills-proof.ts.
 *
 * WHAT RUNS: the real Store, Auth, Governance, Derivatives, the real app (createApp, requests through app.fetch: no port is opened)
 * and MCP handler, the real stills job (apps/server/src/stills.ts) with the real ffmpeg reader. The export wait of M11 is the compute
 * lane's export flag, the very call export.ts makes around a server export (FifoComputeLane.setExportActive), not a rendered export.
 * The only wrapper is a COUNTING (and, where a check needs time, slowing) wrapper around the real reader: instrumentation, not a mock.
 * FIXTURES: synthetic only, written here from Node frames through ffmpeg (H.264 -qp 0 grey, lossless; x264 with forced B-frames for the
 * barcode), in a temp dir, deleted after. Frames and ranks are asserted, never absolute numbers against a committed value (C12).
 * Each check returns true or a sentence; nobody has looked at any picture; the measure is a heuristic within one clip.
 * Stand-alone: `tsx packages/evals/src/stills-proof.measure.ts` (exit 0 all pass, 1 a failure).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '@pulseframe/time';
import { rangeOfClip, STILLS_LABEL, STILLS_MAX_OPEN_JOBS, STILLS_MEASURE_BUILT, STILLS_METHOD, type SharpAnswer, type StillsData, type StillsJobOutput } from '@pulseframe/core';
import { HE_COVER } from '../../i18n/src/index.ts';
import { Auth } from '../../../apps/server/src/auth.ts';
import { Capabilities } from '../../../apps/server/src/capabilities.ts';
import { loadConfig, type Config } from '../../../apps/server/src/config.ts';
import { Derivatives } from '../../../apps/server/src/derive.ts';
import { Exporter } from '../../../apps/server/src/export.ts';
import { Governance, type Principal } from '../../../apps/server/src/governance.ts';
import { createApp } from '../../../apps/server/src/http.ts';
import { describeMedia } from '../../../apps/server/src/ingest.ts';
import { FifoComputeLane } from '../../../apps/server/src/lane.ts';
import { createMcp } from '../../../apps/server/src/mcp.ts';
import { Presence } from '../../../apps/server/src/presence.ts';
import { Speech } from '../../../apps/server/src/speech.ts';
import { cancelStillsJob, readStillsFrames, recoverStillsJobs, setStillsMeasureBuiltForTests, startStillsJob, stillsGreySize, StillsSeekMiss, stopStillsJobs, type ReadStillsFrames, type StillsDeps } from '../../../apps/server/src/stills.ts';
import { Store, type JobRow } from '../../../apps/server/src/store.ts';
import { frameSource } from '../../../apps/server/src/tracking.ts';

// ===================== fixtures (synthetic; exported for apps/server/src/stills.test.ts) =====================
export type Rate = { num: number; den: number };
/** mulberry32 + Box–Muller: deterministic test grain and texture. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { u, normal: () => Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u()) };
}
/** A frozen texture: an 8-pixel checker of ±amp/2 plus per-pixel detail of σ amp/3 around base. */
export function texture(W: number, H: number, seed: number, base = 128, amp = 60): Float64Array {
  const g = rng(seed), t = new Float64Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) t[y * W + x] = base + ((((x >> 3) + (y >> 3)) % 2) ? amp / 2 : -amp / 2) + (amp / 3) * g.normal();
  return t;
}
/** Separable box blur of radius r with clamped edges (running sums, O(W·H)); `axis` 'x' blurs along x only. */
export function boxBlur(src: Float64Array, W: number, H: number, r: number, axis: 'xy' | 'x' = 'xy'): Float64Array {
  if (r <= 0) return src;
  const n = 2 * r + 1;
  const pass = (inp: Float64Array, horizontal: boolean) => {
    const out = new Float64Array(W * H), len = horizontal ? W : H, lines = horizontal ? H : W;
    for (let l = 0; l < lines; l++) {
      const at = (i: number) => inp[horizontal ? l * W + Math.max(0, Math.min(W - 1, i)) : Math.max(0, Math.min(H - 1, i)) * W + l]!;
      let s = 0;
      for (let d = -r; d <= r; d++) s += at(d);
      for (let i = 0; i < len; i++) { out[horizontal ? l * W + i : i * W + l] = s / n; s += at(i + r + 1) - at(i - r); }
    }
    return out;
  };
  const h = pass(src, true);
  return axis === 'x' ? h : pass(h, false);
}
export const toBytes = (f: Float64Array): Uint8Array => { const b = new Uint8Array(f.length); for (let i = 0; i < f.length; i++) b[i] = Math.max(0, Math.min(255, Math.round(f[i]!))); return b; };
export const shiftX = (src: Float64Array, W: number, H: number, dx: number): Float64Array => { const o = new Float64Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) o[y * W + x] = src[y * W + Math.max(0, Math.min(W - 1, x - dx))]!; return o; };
/** A 12-bit barcode in the top third: bit b is a bar of x ∈ [b·w + 2, (b + 1)·w − 2), 235 for 1 and 16 for 0. */
export const BAR_BITS = 12;
export function drawBarcode(px: Uint8Array, W: number, H: number, value: number): void {
  const w = Math.floor(W / BAR_BITS);
  for (let b = 0; b < BAR_BITS; b++) { const v = (value >> b) & 1 ? 235 : 16; for (let y = 0; y < Math.floor(H / 3); y++) for (let x = b * w + 2; x < (b + 1) * w - 2; x++) px[y * W + x] = v; }
}
/** Reads the barcode back from grey (channels 1) or rgb24 (channels 3, green). */
export function readBarcode(px: Uint8Array, W: number, H: number, channels = 1): number {
  const w = Math.floor(W / BAR_BITS), y = Math.floor(H / 6);
  let v = 0;
  for (let b = 0; b < BAR_BITS; b++) { const i = (y * W + b * w + Math.floor(w / 2)) * channels + (channels === 3 ? 1 : 0); if (px[i]! > 128) v |= 1 << b; }
  return v;
}
/** Writes `frames` grey frames from Node through ffmpeg: H.264 lossless grey (-qp 0, gray, tagged full range so the grey read back equals the bytes written; an editable codec, so import does not conform it) or x264 with three forced B-frames (.mp4). */
export async function writeGreyVideo(file: string, spec: { width: number; height: number; frames: number; rate: Rate; codec: 'lossless' | 'x264-bframes' }, frameAt: (k: number) => Uint8Array): Promise<string> {
  const enc = spec.codec === 'lossless' ? ['-c:v', 'libx264', '-qp', '0', '-preset', 'veryfast', '-pix_fmt', 'gray', '-color_range', 'pc'] : ['-c:v', 'libx264', '-crf', '4', '-x264-params', 'bframes=3:b-adapt=0:keyint=60:min-keyint=60', '-pix_fmt', 'yuv420p'];
  const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${spec.width}x${spec.height}`, '-r', `${spec.rate.num}/${spec.rate.den}`, '-i', 'pipe:0', ...enc, file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  const done = new Promise<number | null>((r) => p.on('close', r));
  for (let k = 0; k < spec.frames; k++) if (!p.stdin.write(frameAt(k))) await new Promise((r) => p.stdin.once('drain', r));
  p.stdin.end();
  if ((await done) !== 0) throw new Error(`fixture ${path.basename(file)}: ffmpeg failed: ${err.slice(-300)}`);
  return file;
}
export const remuxTs = (src: string, out: string) => { execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', src, '-c', 'copy', '-f', 'mpegts', out]); return out; };
export const writePng = (file: string, W: number, H: number) => { execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${W}x${H}:d=1`, '-frames:v', '1', file]); return file; };

/** F1: frame k is the texture box-blurred by min(|k − peak|, 8). */
export const writeRamp = (file: string, o: { width: number; height: number; frames: number; peak: number; rate?: Rate; seed?: number }) => {
  const tex = texture(o.width, o.height, o.seed ?? 1);
  return writeGreyVideo(file, { width: o.width, height: o.height, frames: o.frames, rate: o.rate ?? { num: 30, den: 1 }, codec: 'lossless' }, (k) => toBytes(boxBlur(tex, o.width, o.height, Math.min(8, Math.abs(k - o.peak)))));
};
/** The barcode clip: grey 128 with the frame index as a barcode and a textured lower part. */
export const writeBarcodeClip = (file: string, o: { width: number; height: number; frames: number; rate: Rate; codec: 'lossless' | 'x264-bframes' }) => {
  const tex = toBytes(texture(o.width, o.height, 2, 128, 30));
  return writeGreyVideo(file, o, (k) => { const px = tex.slice(); drawBarcode(px, o.width, o.height, k); return px; });
};
/**
 * The noisy dark clip (C3; M5): a dim room — a texture of low contrast around grey 30, every frame box-blurred (radius 2) and clean,
 * except frame `grainy` (blurred radius 3 plus grain σ 6, as at high gain) and frame `sharp` (the texture sharp and clean). The raw
 * Sobel energy ranks the grainy frame first; the noise term is meant to turn that round. Synthetic.
 */
export const DARK = { grainy: 10, sharp: 20, frames: 30 } as const;
export const writeDarkNoisy = (file: string, o: { width: number; height: number }) => {
  const W = o.width, H = o.height, tex = texture(W, H, 5, 30, 8), soft = toBytes(boxBlur(tex, W, H, 2)), grain = rng(9);
  return writeGreyVideo(file, { width: W, height: H, frames: DARK.frames, rate: { num: 30, den: 1 }, codec: 'lossless' }, (k) => {
    if (k === DARK.sharp) return toBytes(tex);
    if (k !== DARK.grainy) return soft;
    const b = boxBlur(tex, W, H, 3);
    for (let i = 0; i < b.length; i++) b[i] = b[i]! + 6 * grain.normal();
    return toBytes(b);
  });
};
/** F3: a static texture; frames 31–35 shifted 6·(k − 30) px along x and box-blurred along x (radius 3), as a camera move would. */
export const writeMotion = (file: string, o: { width: number; height: number; frames: number; seed?: number }) => {
  const W = o.width, H = o.height, tex = texture(W, H, o.seed ?? 3), still = toBytes(tex);
  return writeGreyVideo(file, { width: W, height: H, frames: o.frames, rate: { num: 30, den: 1 }, codec: 'lossless' }, (k) => (k >= 31 && k <= 35 ? toBytes(boxBlur(shiftX(tex, W, H, 6 * (k - 30)), W, H, 3, 'x')) : still));
};
/** F4: frames 60–70 sharper (blur |k − 65|) with the left 30 % blown white; the others blurred radius 3. */
export const writeExposure = (file: string, o: { width: number; height: number; frames: number }) => {
  const W = o.width, H = o.height, tex = texture(W, H, 4);
  return writeGreyVideo(file, { width: W, height: H, frames: o.frames, rate: { num: 30, den: 1 }, codec: 'lossless' }, (k) => {
    if (k < 60 || k > 70) return toBytes(boxBlur(tex, W, H, 3));
    const b = toBytes(boxBlur(tex, W, H, Math.abs(k - 65)));
    for (let y = 0; y < H; y++) for (let x = 0; x < Math.floor(0.3 * W); x++) b[y * W + x] = 255;
    return b;
  });
};

// ===================== the harness (real server parts, no port) =====================
export const OWNER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
export interface StillsHarness {
  dir: string; cfg: Config; store: Store; auth: Auth; gov: Governance; derivatives: Derivatives; lane: FifoComputeLane; exporter: Exporter;
  app: ReturnType<typeof createApp>; mcp: ReturnType<typeof createMcp>;
  rest(method: string, p: string, body: unknown, token: string): Promise<{ status: number; body: any }>;
  tool(name: string, args: Record<string, unknown>, token: string): Promise<{ isError: boolean; content: { type: string; text?: string }[]; text: string }>;
  project(name: string, rate?: Rate): string;
  importFile(projectId: string, file: string): Promise<string>;
  addClip(projectId: string, assetId: string, start: number, frames: number, sourceIn?: T.RationalTime): string;
  deps(extra?: Partial<StillsDeps>): StillsDeps;
  settle(jobId: string, ms?: number): Promise<JobRow>;
  close(): Promise<void>;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const terminal = (s: string) => ['succeeded', 'failed', 'canceled'].includes(s);
export function createStillsHarness(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stills-'))): StillsHarness {
  const cfg: Config = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  const store = new Store(dir);
  const auth = new Auth(cfg);
  const gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const lane = new FifoComputeLane();
  exporter.lane = lane;
  const capabilities = new Capabilities(store, cfg);
  const derivatives = new Derivatives(store);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  const app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
  const base = `http://127.0.0.1:${cfg.port}`;
  const bearer = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  let rpc = 0;
  const h: StillsHarness = {
    dir, cfg, store, auth, gov, derivatives, lane, exporter, app, mcp,
    async rest(method, p, body, token) {
      const r = await app.fetch(new Request(`${base}/api/v1${p}`, { method, headers: bearer(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const text = await r.text();
      return { status: r.status, body: text ? JSON.parse(text) : null };
    },
    async tool(name, args, token) {
      const r = await mcp(new Request(`${base}/mcp`, { method: 'POST', headers: { ...bearer(token), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
      const text = await r.text();
      const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
      if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
      return { isError: msg.result.isError === true, content: msg.result.content, text: msg.result.content[0].text as string };
    },
    project: (name, rate = { num: 30, den: 1 }) => store.createProject({ name, width: 640, height: 360, frameRate: rate }).doc.id,
    async importFile(projectId, file) {
      const meta = await describeMedia(file);
      const contentHash = `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
      const copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
      fs.copyFileSync(file, copy);
      store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
      const asset = { ...meta, name: path.basename(file), contentHash, byteSize: fs.statSync(file).size, provenance: { origin: 'upload' as const, importedAt: '2026-11-26T12:00:00.000Z', importedBy: 'proof' } };
      return store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
    },
    addClip(projectId, assetId, start, frames, sourceIn) {
      const R = store.getProject(projectId).doc.settings.frameRate;
      return store.commit({ projectId, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.frameTime(start, R), duration: T.frameTime(frames, R), ...(sourceIn ? { sourceIn } : {}) } }] }).results[0]!.output!.clipId as string;
    },
    deps: (extra = {}) => ({ derivatives, lane, ...extra }),
    async settle(jobId, ms = 240_000) {
      const t0 = Date.now();
      for (;;) { const j = store.getJob(jobId); if (terminal(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status} (${j.stage})`); await sleep(20); }
    },
    async close() {
      await stopStillsJobs(store);
      (app as any).browserExport?.stop();
      await mcp.close();
      await capabilities.stop();
      await derivatives.stop();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}
/** The real reader, counted and optionally slowed per frame (instrumentation, not a mock). */
export function countedReader(msPerFrame = 0, onFrame?: () => void): { read: ReadStillsFrames; calls: () => number; asked: () => { first: number; count: number; prerollUs: number }[] } {
  const asked: { first: number; count: number; prerollUs: number }[] = [];
  return {
    read: (src, asset, first, count, cb, signal, opts) => { asked.push({ first, count, prerollUs: opts?.prerollUs ?? 0 }); return readStillsFrames(src, asset, first, count, async (f, fr) => { onFrame?.(); if (msPerFrame) await sleep(msPerFrame); await cb(f, fr); }, signal, opts); },
    calls: () => asked.length, asked: () => asked,
  };
}
/** ffmpeg processes whose command line names this file (Linux /proc). */
export const ffmpegOn = (file: string) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return c.startsWith('ffmpeg') && c.includes(file); } catch { return false; } });
/** A whole-file decode at the stills grey size, no seek (the proof's own reading). */
export function decodeAll(file: string, W: number, H: number, pixFmt: 'gray' | 'rgb24' = 'gray'): Uint8Array[] {
  const out = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `scale=${W}:${H}:flags=area,format=${pixFmt}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 2 ** 31 - 1 });
  const size = W * H * (pixFmt === 'rgb24' ? 3 : 1), frames: Uint8Array[] = [];
  for (let o = 0; o + size <= out.length; o += size) frames.push(new Uint8Array(out.buffer, out.byteOffset + o, size));
  return frames;
}
/** The proof's own Sobel and Immerkær σ (written again here, not imported), for M1. */
export function ownNumbers(px: Uint8Array, W: number, H: number): { sobel: number; sigma100: number } {
  let s = 0, n = 0;
  const p = (x: number, y: number) => px[y * W + x]!;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const gx = (p(x + 1, y - 1) + 2 * p(x + 1, y) + p(x + 1, y + 1)) - (p(x - 1, y - 1) + 2 * p(x - 1, y) + p(x - 1, y + 1));
    const gy = (p(x - 1, y + 1) + 2 * p(x, y + 1) + p(x + 1, y + 1)) - (p(x - 1, y - 1) + 2 * p(x, y - 1) + p(x + 1, y - 1));
    s += gx * gx + gy * gy;
    n += Math.abs(p(x - 1, y - 1) - 2 * p(x, y - 1) + p(x + 1, y - 1) - 2 * p(x - 1, y) + 4 * p(x, y) - 2 * p(x + 1, y) + p(x - 1, y + 1) - 2 * p(x, y + 1) + p(x + 1, y + 1));
  }
  const area = (W - 2) * (H - 2);
  return { sobel: Math.min(65535, Math.round(s / area / 16)), sigma100: Math.round((100 * Math.sqrt(Math.PI / 2) * n) / (6 * area)) };
}
export const dataOf = (store: Store, d: Derivatives, contentHash: string): { data: StillsData; blob: string } | null => {
  const row = d.get(contentHash, 'stills');
  if (row?.status !== 'ready' || !row.blobHash) return null;
  return { data: JSON.parse(fs.readFileSync(store.blobPath(row.blobHash), 'utf8')) as StillsData, blob: row.blobHash };
};

// ===================== the checks =====================
export type CheckResult = true | string;
export interface MeasureProofResult { results: Record<string, CheckResult>; evidence: Record<string, unknown> }

/**
 * Runs M1–M12. `forceBuilt` runs the bodies before the integrator flips STILLS_MEASURE_BUILT (W1's own run); without it and with the
 * flag off every check is BLOCKED (not built), never a pass.
 */
export async function runStillsMeasureChecks(opts: { forceBuilt?: boolean; log?: (s: string) => void } = {}): Promise<MeasureProofResult> {
  const log = opts.log ?? ((s: string) => console.log(s));
  const ids = Array.from({ length: 12 }, (_, i) => `M${i + 1}`);
  if (!STILLS_MEASURE_BUILT && !opts.forceBuilt) return { results: Object.fromEntries(ids.map((id) => [id, 'BLOCKED: STILLS_MEASURE_BUILT is off'])), evidence: {} };
  if (opts.forceBuilt) setStillsMeasureBuiltForTests(true);
  const results: Record<string, CheckResult> = {}, evidence: Record<string, unknown> = {};
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stills-fx-'));
  const h = createStillsHarness();
  const tokens = h.auth.tokens;
  const check = async (id: string, fn: () => Promise<CheckResult>) => {
    const t0 = Date.now();
    try { results[id] = await Promise.race([fn(), sleep(300_000).then(() => 'did not finish within 300 s')]); } catch (e) { results[id] = `threw: ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`; }
    log(`${id} ${results[id] === true ? 'pass' : `FAIL — ${results[id]}`} (${Date.now() - t0} ms)`);
  };
  const run = async (pid: string, body: Record<string, unknown>, deps: StillsDeps = h.deps()) => {
    const r = startStillsJob(h.store, h.gov, OWNER, pid, body as never, deps);
    if ('cached' in r) return { cached: true as const, answer: r.answer, job: null };
    const job = await h.settle(r.jobId);
    if (job.status !== 'succeeded') throw new Error(`job ${job.status}: ${JSON.stringify(job.error)}`);
    return { cached: false as const, answer: (job.output as StillsJobOutput).answer, job };
  };
  try {
    log('stills-proof measure: writing synthetic fixtures');
    const ramp = await writeRamp(path.join(fx, 'ramp.mp4'), { width: 1280, height: 720, frames: 120, peak: 47 });
    const barMp4 = await writeBarcodeClip(path.join(fx, 'bar.mp4'), { width: 320, height: 180, frames: 1200, rate: { num: 30, den: 1 }, codec: 'x264-bframes' });
    const barTs = remuxTs(barMp4, path.join(fx, 'bar.ts'));
    const r60 = await writeBarcodeClip(path.join(fx, 'r60.mp4'), { width: 160, height: 90, frames: 240, rate: { num: 60, den: 1 }, codec: 'lossless' });
    const dark = await writeDarkNoisy(path.join(fx, 'dark.mp4'), { width: 960, height: 540 });
    const motion = await writeMotion(path.join(fx, 'motion.mp4'), { width: 640, height: 360, frames: 60 });
    const expo = await writeExposure(path.join(fx, 'expo.mp4'), { width: 320, height: 180, frames: 100 });
    const photo = writePng(path.join(fx, 'photo.png'), 64, 48);
    // a file of its own for every check that needs an empty cache (the derivative is per file content, shared by every project)
    const freshRamp = (seed: number) => writeRamp(path.join(fx, `ramp${seed}.mp4`), { width: 640, height: 360, frames: 120, peak: 47, seed });
    const freshMotion = (seed: number) => writeMotion(path.join(fx, `motion${seed}.mp4`), { width: 640, height: 360, frames: 60, seed });

    await check('M1', async () => {
      const pid = h.project('M1');
      const a = await h.importFile(pid, ramp);
      const clip = h.addClip(pid, a, 0, 120);
      const { answer } = await run(pid, { assetId: a, clipId: clip });
      if (!answer.complete || answer.measuredFrames !== 120) return `not complete: ${answer.measuredFrames}/120`;
      if (answer.candidates[0]?.frame !== 47) return `candidate 1 is frame ${answer.candidates[0]?.frame}, not 47`;
      const g = stillsGreySize(1280, 720);
      const own = decodeAll(ramp, g.width, g.height).map((px) => ownNumbers(px, g.width, g.height));
      const diff = answer.frames.filter((m) => own[m.frame]!.sobel !== m.sobel || own[m.frame]!.sigma100 !== m.sigma100);
      evidence.M1 = { grey: g, candidates: answer.candidates.map((c) => ({ frame: c.frame, sharp: c.sharp, ratio: c.sharpRatioPermille })), median: answer.median };
      return diff.length ? `the proof's own decode + Sobel + σ differ at frames ${diff.slice(0, 5).map((m) => m.frame).join(', ')}` : true;
    });

    const barcodeCheck = async (file: string, label: string): Promise<CheckResult> => {
      const pid = h.project(label);
      const a = await h.importFile(pid, file);
      const asset = h.store.getProject(pid).doc.assets[a]!;
      const src = frameSource(h.store, h.derivatives, asset, 'original');
      const g = stillsGreySize(src.width, src.height);
      // the plain input seek, alone: what it delivers (barcode numbers) and whether the reader's own check accepts it
      const plain: number[] = [];
      let plainMiss: Record<string, unknown> | null = null;
      try { await readStillsFrames(src, asset, 912, 49, (_f, fr) => { plain.push(readBarcode(fr.data, g.width, g.height, 3)); }, new AbortController().signal, { pixFmt: 'rgb24' }); } catch (e) { if (e instanceof StillsSeekMiss) plainMiss = e.details; else throw e; }
      const counter = countedReader();
      const { answer } = await run(pid, { assetId: a, from: 913, to: 961 }, h.deps({ readFrames: counter.read }));
      const used = counter.asked().at(-1)!;
      const seen: number[] = [];
      await readStillsFrames(src, asset, used.first, used.count, (_f, fr) => { seen.push(readBarcode(fr.data, g.width, g.height, 3)); }, new AbortController().signal, { pixFmt: 'rgb24', prerollUs: used.prerollUs });
      evidence[label] = { plainSeek: { firstBarcode: plain[0] ?? null, lastBarcode: plain.at(-1) ?? null, delivered: plain.length, readerRefused: plainMiss }, job: { reads: counter.asked(), firstBarcode: seen[0], lastBarcode: seen.at(-1) }, startTime: asset.timeOrigin ?? null };
      const want = Array.from({ length: 49 }, (_, i) => 912 + i);
      if (JSON.stringify(seen) !== JSON.stringify(want)) return `the job's read delivered barcodes ${seen[0]}…${seen.at(-1)} (${seen.length}), not 912…960`;
      if (answer.measuredFrames !== 48 || answer.frames[0]!.frame !== 913 || answer.frames.at(-1)!.frame !== 960 || answer.frames[0]!.motion === null) return `answer frames ${answer.frames[0]?.frame}…${answer.frames.at(-1)?.frame}`;
      const plainRight = JSON.stringify(plain) === JSON.stringify(want);
      if (!plainRight && !plainMiss) return `the plain seek delivered barcodes ${plain[0]}…${plain.at(-1)} and the reader did NOT refuse them`;
      return true;
    };
    await check('M2', () => barcodeCheck(barMp4, 'M2'));
    await check('M3', () => barcodeCheck(barTs, 'M3'));

    await check('M4', async () => {
      const pid = h.project('M4', { num: 30, den: 1 });
      const a = await h.importFile(pid, r60);
      const clip = h.addClip(pid, a, 0, 30, T.rt(1, 1)); // 1 s of project time at 30 fps on a 60 fps file
      const range = rangeOfClip(h.store.getProject(pid).doc, clip);
      const { answer } = await run(pid, { assetId: a, clipId: clip });
      evidence.M4 = { range };
      if (range.from !== 60 || range.to !== 119) return `rangeOfClip gave [${range.from}, ${range.to}), not [60, 119)`;
      const frames = answer.frames.map((m) => m.frame);
      return frames.length === 59 && frames.every((f, i) => f === 60 + i) ? true : `the answer has ${frames.length} records, not one per source frame`;
    });

    await check('M5', async () => {
      const pid = h.project('M5');
      const a = await h.importFile(pid, dark);
      const { answer } = await run(pid, { assetId: a, from: 0, to: DARK.frames });
      const g = answer.frames[DARK.grainy]!, s = answer.frames[DARK.sharp]!;
      const naive = [...answer.frames].sort((x, y) => y.sobel - x.sobel || x.frame - y.frame)[0]!.frame;
      evidence.M5 = { grainy: g, sharp: s, naiveTop: naive, correctedTop: answer.candidates[0]?.frame, label: STILLS_LABEL.en };
      if (naive !== DARK.grainy) return `the naive Sobel already picks frame ${naive} (fixture does not exercise the noise term)`;
      if (answer.candidates[0]?.frame !== DARK.sharp) return `the noise-corrected measure still picks frame ${answer.candidates[0]?.frame}, not the clean sharp frame ${DARK.sharp} (grainy ${g.sobel}/${g.sigma100}/${g.sharp}, sharp ${s.sobel}/${s.sigma100}/${s.sharp})`;
      if (!(g.sigma100 >= 540 && g.sigma100 <= 660)) return `sigma100 of the grainy frame is ${g.sigma100}, not about 600`;
      return g.sobel > g.sharp ? true : `raw sobel ${g.sobel} not above sharp ${g.sharp}`;
    });

    await check('M6', async () => {
      const pid = h.project('M6');
      const a = await h.importFile(pid, motion);
      const { answer } = await run(pid, { assetId: a, from: 0, to: 60 });
      const f = (k: number) => answer.frames[k]!;
      evidence.M6 = { moved: [31, 32, 33, 34, 35].map((k) => ({ frame: k, sharp: f(k).sharp, motion: f(k).motion })), static37: f(37), candidates: answer.candidates.map((c) => c.frame) };
      const bad = [31, 32, 33, 34, 35].filter((k) => !(f(k).sharp < f(37).sharp) || !(f(k).motion! > 0));
      if (bad.length) return `frames ${bad.join(', ')} do not rank below frame 37 with motion > 0`;
      if (f(37).motion !== 0) return `frame 37's motion is ${f(37).motion}, not 0`;
      return answer.candidates.some((c) => c.frame >= 31 && c.frame <= 35) ? 'a moved frame is a candidate' : true;
    });

    await check('M7', async () => {
      const pid = h.project('M7');
      const a = await h.importFile(pid, expo);
      const { answer } = await run(pid, { assetId: a, from: 0, to: 100 });
      const inside = answer.candidates.filter((c) => c.frame >= 60 && c.frame <= 70);
      evidence.M7 = { candidates: answer.candidates.map((c) => ({ frame: c.frame, hi: c.hi, manyClipped: c.manyClipped })) };
      if (!inside.length) return `no candidate in 60–70: ${answer.candidates.map((c) => c.frame).join(', ')}`;
      if (inside.some((c) => c.hi < 250 || !c.manyClipped)) return 'a candidate in 60–70 does not report hi >= 250 permille and manyClipped';
      if (answer.method !== STILLS_METHOD || answer.label.he !== STILLS_LABEL.he || answer.label.en !== STILLS_LABEL.en || answer.heuristic !== true) return 'the answer does not carry the method and both labels';
      return true;
    });

    await check('M8', async () => {
      const pid = h.project('M8');
      const motion8 = await freshMotion(81);
      const a = await h.importFile(pid, motion8);
      const counter = countedReader();
      const deps = h.deps({ readFrames: counter.read });
      await run(pid, { assetId: a, from: 10, to: 40 }, deps);
      const again = await run(pid, { assetId: a, from: 10, to: 40 }, deps);
      if (!again.cached || counter.calls() !== 1) return `a second request was not cached (calls ${counter.calls()})`;
      const before = dataOf(h.store, h.derivatives, h.store.getProject(pid).doc.assets[a]!.contentHash)!.data;
      const ext = await run(pid, { assetId: a, from: 10, to: 50 }, deps);
      const asked = counter.asked()[1]!;
      if (asked.first !== 39 || asked.count !== 11) return `extending read [${asked.first}, +${asked.count}), not the new frames plus the one before ([39, +11))`;
      const after = dataOf(h.store, h.derivatives, h.store.getProject(pid).doc.assets[a]!.contentHash)!.data;
      const kept = before.measured.every((m) => JSON.stringify(after.measured.find((x) => x.frame === m.frame)) === JSON.stringify(m));
      if (!kept || (ext.job!.output as StillsJobOutput).reused !== 30) return 'stored records changed, or reused is not 30';
      // two cold runs (fresh data directories) of [10, 50) give byte-identical data files, and equal the extended one's records
      const blobs: string[] = [], records: string[] = [];
      for (let i = 0; i < 2; i++) {
        const c = createStillsHarness();
        try {
          const p2 = c.project('cold'), a2 = await c.importFile(p2, motion8);
          const r = startStillsJob(c.store, c.gov, OWNER, p2, { assetId: a2, from: 10, to: 50 }, c.deps());
          if ('cached' in r) return 'a cold run was cached';
          const j = await c.settle(r.jobId);
          if (j.status !== 'succeeded') return `cold run ${j.status}`;
          const d = dataOf(c.store, c.derivatives, c.store.getProject(p2).doc.assets[a2]!.contentHash)!;
          blobs.push(d.blob); records.push(JSON.stringify(d.data.measured));
        } finally { await c.close(); }
      }
      evidence.M8 = { coldBlobs: blobs, extendedReads: after.reads };
      if (blobs[0] !== blobs[1]) return 'two cold runs gave different data files';
      return records[0] === JSON.stringify(after.measured) ? true : 'the merged records differ from a cold read of the same stretch (a record depends on its range)';
    });

    await check('M9', async () => {
      const pid = h.project('M9');
      const a = await h.importFile(pid, barMp4), b = await h.importFile(pid, motion), ph = await h.importFile(pid, photo); // 1200 frames: 601 lies inside the file
      const clipB = h.addClip(pid, b, 0, 30);
      const t = tokens.agent;
      const long = await h.rest('POST', `/projects/${pid}/stills`, { assetId: a, from: 0, to: 601 }, t);
      const pic = await h.rest('POST', `/projects/${pid}/stills`, { assetId: ph, from: 0, to: 1 }, t);
      const other = await h.rest('POST', `/projects/${pid}/stills`, { assetId: a, clipId: clipB }, t);
      evidence.M9 = { long: long.body?.error, picture: pic.body?.error?.code, other: other.body?.error?.code };
      if (long.status !== 422 || long.body.error.code !== 'stills_range_too_long') return `601 frames: ${long.status} ${long.body?.error?.code}`;
      const he = HE_COVER.find(([re]) => re.test(long.body.error.message));
      if (!he) return `no Hebrew for "${long.body.error.message}"`;
      (evidence.M9 as Record<string, unknown>).he = he[1](he[0].exec(long.body.error.message)!);
      if (pic.status !== 422 || pic.body.error.code !== 'no_video') return `picture: ${pic.status} ${pic.body?.error?.code}`;
      return other.status === 422 && other.body.error.code === 'invalid_request' ? true : `other file: ${other.status} ${other.body?.error?.code}`;
    });

    await check('M10', async () => {
      const pid = h.project('M10');
      const a = await h.importFile(pid, await freshRamp(101));
      const asset = h.store.getProject(pid).doc.assets[a]!;
      const file = h.store.blobPath(asset.contentHash);
      let n = 0;
      const slow = countedReader(30, () => { n++; });
      const r = startStillsJob(h.store, h.gov, OWNER, pid, { assetId: a, from: 0, to: 120 }, h.deps({ readFrames: slow.read }));
      if ('cached' in r) return 'cached (the fixture was measured before)';
      while (n < 5) await sleep(10);
      cancelStillsJob(h.store, r.jobId, 'user:owner');
      const j = await h.settle(r.jobId);
      await sleep(200);
      if (j.status !== 'canceled' || h.derivatives.get(asset.contentHash, 'stills') !== null) return `after cancel: ${j.status}, derivative ${JSON.stringify(h.derivatives.get(asset.contentHash, 'stills')?.status)}`;
      if (ffmpegOn(file).length) return 'ffmpeg still runs after the cancel';
      // a restart: the job's reader is stopped (row stays running), recovery runs it again from the start
      n = 0;
      const r2 = startStillsJob(h.store, h.gov, OWNER, pid, { assetId: a, from: 0, to: 120 }, h.deps({ readFrames: slow.read }));
      if ('cached' in r2) return 'cached';
      while (n < 5) await sleep(10);
      await stopStillsJobs(h.store);
      if (h.store.getJob(r2.jobId).status !== 'running') return `after stop the row is ${h.store.getJob(r2.jobId).status}`;
      const recovered = recoverStillsJobs(h.store, h.deps());
      const j2 = await h.settle(r2.jobId);
      return recovered >= 1 && j2.status === 'succeeded' && (j2.output as StillsJobOutput).answer.complete ? true : `recovered ${recovered}, ${j2.status}`;
    });

    await check('M11', async () => {
      const pids = [h.project('M11a'), h.project('M11b'), h.project('M11c'), h.project('M11d')];
      const assets: string[] = [];
      const ramp11 = await freshRamp(111);
      for (const p of pids) assets.push(await h.importFile(p, ramp11));
      let n = 0;
      const slow = countedReader(15, () => { n++; });
      const deps = h.deps({ readFrames: slow.read });
      const started = startStillsJob(h.store, h.gov, OWNER, pids[0]!, { assetId: assets[0]!, from: 0, to: 120 }, deps);
      if ('cached' in started) return 'cached (the fixture was measured before)';
      const first = started;
      while (n < 3) await sleep(10);
      // an export starts (the lane's export flag, as export.ts sets it): the measurement pauses until it ends
      h.lane.setExportActive(true);
      await sleep(100);
      const atStart = n;
      await sleep(800);
      const paused = n - atStart <= 1 && h.store.getJob(first.jobId).status === 'running';
      const exportEnded = Date.now();
      h.lane.setExportActive(false);
      let same: any = null, busy: any = null;
      try { startStillsJob(h.store, h.gov, OWNER, pids[0]!, { assetId: assets[0]!, from: 0, to: 60 }, deps); } catch (e) { same = e; }
      const others = [1, 2].map((i) => startStillsJob(h.store, h.gov, OWNER, pids[i]!, { assetId: assets[i]!, from: 0, to: 120 }, deps) as { jobId: string });
      try { startStillsJob(h.store, h.gov, OWNER, pids[3]!, { assetId: assets[3]!, from: 0, to: 120 }, deps); } catch (e) { busy = e; }
      for (const o of others) cancelStillsJob(h.store, o.jobId, 'user:owner');
      const j = await h.settle(first.jobId);
      for (const o of others) await h.settle(o.jobId);
      evidence.M11 = { pausedFrames: n - atStart, same: same?.code, sameJob: same?.details?.jobId === first.jobId, busy: busy?.code, max: STILLS_MAX_OPEN_JOBS, note: 'export = the lane flag export.ts sets, not a rendered export' };
      if (!paused) return 'the measurement went on while the export ran';
      if (j.status !== 'succeeded' || Date.parse(j.updatedAt) < exportEnded) return `the job finished before the export ended (${j.status})`;
      if (same?.status !== 409 || same.code !== 'stills_in_progress' || same.details?.jobId !== first.jobId) return `same project: ${same?.status} ${same?.code}`;
      return busy?.status === 429 && busy.code === 'busy' ? true : `fourth project: ${busy?.status} ${busy?.code}`;
    });

    await check('M12', async () => {
      const pid = h.project('M12');
      const a = await h.importFile(pid, await freshMotion(121));
      const f = await h.tool('find_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 20 }, tokens.agent);
      if (f.isError) return `find_sharp_frames: ${f.text}`;
      const started = JSON.parse(f.text);
      if (started.jobId) await h.settle(started.jobId);
      const again = await h.tool('find_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 20 }, tokens.agent);
      const read = await h.tool('read_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 20 }, tokens.observer);
      const obsStart = await h.tool('find_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 21 }, tokens.observer);
      const parts = [f, again, read].flatMap((r) => r.content.map((c) => c.type));
      const ans = JSON.parse(read.text) as SharpAnswer;
      evidence.M12 = { parts: [...new Set(parts)], cached: JSON.parse(again.text).cached === true, readComplete: ans.complete, observerStart: obsStart.isError };
      if (parts.some((t) => t !== 'text')) return 'an answer carries a non-text part';
      if (JSON.parse(again.text).cached !== true || !ans.complete || ans.frames.length !== 20) return 'the agent\'s second call or the observer\'s read is not the stored answer';
      return obsStart.isError ? true : 'the observer could start a measurement';
    });
  } finally {
    await h.close();
    fs.rmSync(fx, { recursive: true, force: true });
    if (opts.forceBuilt) setStillsMeasureBuiltForTests(STILLS_MEASURE_BUILT);
  }
  return { results, evidence };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await runStillsMeasureChecks({ forceBuilt: process.env.PF_STILLS_FORCE_BUILT === '1' });
  console.log(JSON.stringify(r.evidence, null, 1));
  const fails = Object.entries(r.results).filter(([, v]) => v !== true);
  console.log(`stills-proof measure: ${Object.keys(r.results).length - fails.length}/${Object.keys(r.results).length} pass`);
  process.exit(fails.some(([, v]) => typeof v === 'string' && !v.startsWith('BLOCKED')) ? 1 : fails.length ? 2 : 0);
}
