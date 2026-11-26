/**
 * The tracking job (ADR-0015): the frame reader's numbering against the frame barcode, a job that attaches a track,
 * cancel, a track edited mid-job, recovery after a restart, and the event loop staying responsive while a job runs.
 * Served in-process (app.fetch, no port). Fixtures are generated here: the barcode fixture (packages/fixtures) and
 * synthetic videos with exact truth (vision/synthetic.ts) encoded with H.264 and B-frames.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  /**
   * LABELLED TEST DOUBLE until W1 merges (tracking wave): trackSummary as its contract in packages/core/src/tracking.ts
   * describes it (counts per state; maximal runs of unknown/weak/lost and single re-acquired frames, ascending; `to` taken as
   * exclusive here). The real function is used as soon as it no longer throws "not implemented yet".
   */
  const summaryDouble = (t: import('@pulseframe/core').MotionTrack) => {
    const counts = Object.fromEntries(real.TRACK_STATES.map((s) => [s, 0])) as Record<import('@pulseframe/core').TrackStateName, number>;
    const problems: import('@pulseframe/core').TrackProblem[] = [];
    t.st.forEach((code, i) => {
      const name = real.TRACK_STATES[code]!;
      counts[name]++;
      if (name === 'reacquired') problems.push({ from: t.from + i, to: t.from + i + 1, state: 'reacquired' });
      else if (name === 'unknown' || name === 'weak' || name === 'lost') {
        const prev = problems.at(-1);
        if (prev && prev.state === name && prev.to === t.from + i) prev.to++; else problems.push({ from: t.from + i, to: t.from + i + 1, state: name });
      }
    });
    return { samples: t.st.length, counts, problems };
  };
  const trackSummary: typeof real.trackSummary = (t) => { try { return real.trackSummary(t); } catch (e) { if (/not implemented yet/.test((e as Error).message)) return summaryDouble(t); throw e; } };
  return { ...real, trackSummary };
});

import { defineOp, getOp, OpError, ST, TRACKER_METHOD, TrackOpArgs, TrackRunBody, type MotionTrack } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcodeChannel } from '../../../packages/fixtures/src/index.ts';
import { heavy } from './analysis.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { describeMedia } from './ingest.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Store, type JobRow } from './store.ts';
import { cancelTrackingJob, frameSource, readFrames, recoverTrackingJobs, startTrackingJob, stopTrackingJobs } from './tracking.ts';
import { discScene, texture } from './vision/synthetic.ts';
import type { FrameSource, GreyFrame, ReadFrames } from './vision/types.ts';

/**
 * LABELLED TEST DOUBLE until W1 merges (tracking wave): the internal op attach_motion_track as its contract
 * (TrackOpArgs.attach_motion_track) describes it — replaces samples [from, from+n) except hand-placed ones, extends the range
 * and fills gaps with unknown at the nearest known position, records the origin — and, as W1's op does, refuses measured
 * samples marked manual (invalid_args). Registered only while the real op is absent.
 */
if (!getOp('attach_motion_track'))
  defineOp({
    name: 'attach_motion_track', version: 1, internal: true, description: 'TEST DOUBLE (tracking.test.ts) of the internal op attach_motion_track', args: TrackOpArgs.attach_motion_track,
    apply(d, a, ctx) {
      if (a.st.includes(ST.manual)) throw new OpError('invalid_args', 'measured samples cannot be marked manual', {});
      const t = d.motionTracks[a.motionTrackId]!;
      const lo = Math.min(t.from, a.from), hi = Math.max(t.from + t.x.length, a.from + a.x.length);
      const out = { x: [] as number[], y: [] as number[], s: [] as number[], q: [] as number[], st: [] as number[] };
      let near = 0;
      for (let f = lo; f < hi; f++) {
        const i = f - t.from, j = f - a.from;
        const own = i >= 0 && i < t.x.length, theirs = j >= 0 && j < a.x.length;
        if (own && (t.st[i] === ST.manual || !theirs)) { out.x.push(t.x[i]!); out.y.push(t.y[i]!); out.s.push(t.s?.[i] ?? 1000); out.q.push(t.q[i]!); out.st.push(t.st[i]!); near = out.x.length - 1; }
        else if (theirs) { out.x.push(a.x[j]!); out.y.push(a.y[j]!); out.s.push(a.s?.[j] ?? 1000); out.q.push(a.q[j]!); out.st.push(a.st[j]!); near = out.x.length - 1; }
        else { out.x.push(out.x[near] ?? t.x[0]!); out.y.push(out.y[near] ?? t.y[0]!); out.s.push(out.s[near] ?? 1000); out.q.push(0); out.st.push(ST.unknown); }
      }
      d.motionTracks[a.motionTrackId] = { ...t, from: lo, x: out.x, y: out.y, ...(t.kind === 'region' ? { s: out.s } : {}), q: out.q, st: out.st, origin: { method: a.method, params: a.params, createdAt: a.createdAt, createdBy: ctx.actor, edited: t.origin.edited } };
      return { affectedIds: [a.motionTrackId], summary: `Tracked ${a.x.length} frames (test double)` };
    },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let agent: Principal;
const headers = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
const terminal = (s: string) => ['succeeded', 'failed', 'canceled'].includes(s);
async function settle(jobId: string, ms = 120_000) {
  const t0 = Date.now();
  for (;;) { const j = store.getJob(jobId); if (terminal(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status} (${j.stage})`); await sleep(25); }
}

/** Encode grey frames as H.264 with B-frames (yuv420p, 30 fps), no sound. */
function encode(file: string, frames: GreyFrame[] | { width: number; height: number; count: number; frame: (n: number) => Uint8Array }) {
  const src = Array.isArray(frames) ? { width: frames[0]!.width, height: frames[0]!.height, count: frames.length, frame: (n: number) => frames[n]!.data } : frames;
  return new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-video_size', `${src.width}x${src.height}`, '-framerate', '30', '-i', 'pipe:0', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-bf', '2', '-g', '30', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-300)}`))));
    p.stdin.on('error', () => {});
    void (async () => { for (let n = 0; n < src.count; n++) if (!p.stdin.write(src.frame(n))) await new Promise((r) => p.stdin.once('drain', r)); p.stdin.end(); })();
  });
}
const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
/** Store a copy of the file and import it into a project through the internal import op, as an upload does. */
async function importInto(projectId: string, file: string) {
  const meta = await describeMedia(file);
  const contentHash = sha(file);
  const copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
  fs.copyFileSync(file, copy);
  store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
  const asset = { ...meta, name: path.basename(file), contentHash, byteSize: fs.statSync(file).size, provenance: { origin: 'upload' as const, importedAt: new Date().toISOString(), importedBy: 'test' } };
  const r = store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
  return r.results[0]!.output!.assetId as string;
}
/** A track with one hand-placed sample (work px of a W×H picture, pixel centres), written through the internal restore op. */
function seedTrack(projectId: string, id: string, assetId: string, frame: number, cx: number, cy: number, W: number, H: number, box?: { w: number; h: number }) {
  const track: MotionTrack = {
    id, assetId, name: id, kind: box ? 'region' : 'point', from: frame, ...(box ? { box: { w: Math.round((box.w / W) * 1e4), h: Math.round((box.h / H) * 1e4) } } : {}),
    x: [Math.round(((cx + 0.5) / W) * 1e4)], y: [Math.round(((cy + 0.5) / H) * 1e4)], ...(box ? { s: [1000] } : {}), q: [100], st: [ST.manual],
    origin: { method: 'manual', params: {}, createdAt: '2026-11-17T00:00:00.000Z', createdBy: 'user:local', edited: false },
  };
  store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id, state: { kind: 'motionTrack', track } }] } }] });
}
const trackOf = (projectId: string, id: string) => store.getProject(projectId).doc.motionTracks[id]!;
/**
 * A hand correction of the first sample, leaving the track as edit_motion_track{set} leaves it (moved, origin.edited = true):
 * through that op once it is registered (W1), until then the same state through the internal restore op.
 */
function correctByHand(projectId: string, id: string) {
  const t = trackOf(projectId, id);
  const ops = getOp('edit_motion_track')
    ? [{ op: 'edit_motion_track', args: { motionTrackId: id, set: [{ frame: t.from, x: t.x[0]! + 50, y: t.y[0]! }] } }]
    : [{ op: 'restore_entities', args: { targets: [{ id, state: { kind: 'motionTrack', track: { ...t, x: [t.x[0]! + 50, ...t.x.slice(1)], origin: { ...t.origin, edited: true } } } }] } }];
  const r = store.commit({ projectId, actor: 'user:local', allowInternal: true, ops });
  expect(trackOf(projectId, id)).toMatchObject({ x: [t.x[0]! + 50], origin: { edited: true } });
  return r;
}
const arraysDigest = (t: MotionTrack) => createHash('sha256').update(JSON.stringify([t.from, t.x, t.y, t.s ?? null, t.q, t.st])).digest('hex');
/** ffmpeg processes whose command line names this file (Linux /proc). */
const ffmpegOn = (file: string) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return c.startsWith('ffmpeg') && c.includes(file); } catch { return false; } });
/** The real reader, slowed down per frame so a job is still running when the test acts on it (instrumentation, not a mock). */
const slowReader = (ms: number): ReadFrames => (src, from, to, h, onFrame, signal) => readFrames(src, from, to, h, async (i, f) => { await sleep(ms); await onFrame(i, f); }, signal);

let barcode: string, late: string, discFile: string, panFile: string;
const disc = discScene({ width: 320, height: 240, frames: 90, start: { x: 70, y: 110 }, velocity: { x: 2.1, y: 0.6 }, curve: { x: 0, y: -0.01 } });
let pid = '', discAsset = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tracking-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, undefined, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov);
  agent = auth.authenticate(new Request('http://127.0.0.1/', { headers: headers() }));

  barcode = (await generateBarcodeFixture({ out: path.join(dir, 'barcode.mp4'), frames: 64, bframes: 2 })).file;
  late = path.join(dir, 'late.mp4');
  await new Promise<void>((resolve, reject) => { const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-itsoffset', '0.5', '-i', barcode, '-i', barcode, '-map', '0:v', '-map', '1:a', '-c', 'copy', late]); p.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg ${c}`)))); });
  discFile = path.join(dir, 'disc.mp4');
  await encode(discFile, disc.frames);
  // 300 frames of 640×360: a textured picture twice that size, panned by whole pixels (crop offset ⌊1.7n⌋, ⌊0.4n⌋)
  const big = texture(41), BW = 1280, BH = 720, plane = new Uint8Array(BW * BH);
  for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) plane[y * BW + x] = Math.max(0, Math.min(255, Math.round(big(x, y))));
  panFile = path.join(dir, 'pan.mp4');
  await encode(panFile, { width: 640, height: 360, count: 300, frame: (n) => { const ox = Math.floor(1.7 * n), oy = Math.floor(0.4 * n), out = new Uint8Array(640 * 360); for (let y = 0; y < 360; y++) out.set(plane.subarray((y + oy) * BW + ox, (y + oy) * BW + ox + 640), y * 640); return out; } });

  pid = store.createProject({ name: 'tracking', width: 320, height: 240, frameRate: { num: 30, den: 1 } }).doc.id;
  discAsset = await importInto(pid, discFile);
  store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: discAsset, start: { value: '0', timescale: 30 } } }] });
}, 180_000);
afterAll(async () => {
  await stopTrackingJobs(store);
  (app as any)?.browserExport?.stop();
  await mcp?.close();
  await capabilities?.stop();
  await derivatives?.stop();
  store?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('frame reader: output frame k is source index k (frame barcode)', () => {
  const readAll = async (src: FrameSource, from: number, to: number) => {
    const got: number[] = [];
    const r = await readFrames(src, from, to, 360, (i, f) => { got.push(i - readBarcodeChannel(f.data, f.width, 1, { x: 0, y: 0, w: f.width, h: f.height }, 0)); }, new AbortController().signal);
    expect(r.frames).toBe(to - from);
    expect(r.digest).toMatch(/^[0-9a-f]{64}$/);
    return got; // index − barcode, all zero when every frame is the one asked for
  };
  const original = (file: string): FrameSource => ({ file, kind: 'original', blobHash: 'n/a', width: 640, height: 360, frameCount: 64, rate: { num: 30, den: 1 } });
  it('the 64-frame barcode fixture (H.264, 2 B-frames): windows [0, 64) and [17, 40)', async () => {
    expect(await readAll(original(barcode), 0, 64)).toEqual(new Array(64).fill(0));
    expect(await readAll(original(barcode), 17, 40)).toEqual(new Array(23).fill(0));
  }, 60_000);
  it('its editing proxy (Derivatives), chosen by frameSource when it is ready', async () => {
    const assetId = await importInto(pid, barcode);
    const asset = store.getProject(pid).doc.assets[assetId]!;
    expect(frameSource(store, derivatives, asset, 'proxy').kind).toBe('original'); // not made yet
    derivatives.ensure(asset);
    await derivatives.idle();
    const src = frameSource(store, derivatives, asset, 'proxy');
    expect(src.kind).toBe('proxy');
    expect(frameSource(store, derivatives, asset, 'original').kind).toBe('original');
    expect(await readAll(src, 0, 64)).toEqual(new Array(64).fill(0));
    expect(await readAll(src, 17, 40)).toEqual(new Array(23).fill(0));
  }, 120_000);
  it('a file whose picture starts 0.5 s late: frames are still numbered from its first picture', async () => {
    const meta = await describeMedia(late);
    expect(meta.video?.startTime).toBeTruthy();
    expect(await readAll(original(late), 0, 64)).toEqual(new Array(64).fill(0));
    expect(await readAll(original(late), 17, 40)).toEqual(new Array(23).fill(0));
  }, 60_000);
  it('asking past the last frame is refused with frame_count_mismatch', async () => {
    await expect(readFrames(original(barcode), 60, 70, 360, () => {}, new AbortController().signal)).rejects.toMatchObject({ code: 'frame_count_mismatch' });
  }, 60_000);
});

describe('tracking job', () => {
  it('refusals before any job exists', async () => {
    expect((await rest('POST', `/projects/${pid}/motion-tracks/mtk_none/track`, {})).body.error.code).toBe('not_found');
    seedTrack(pid, 'mtk_edited', discAsset, 10, disc.truth[10]!.cx, disc.truth[10]!.cy, 320, 240);
    const t = trackOf(pid, 'mtk_edited');
    store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id: t.id, state: { kind: 'motionTrack', track: { ...t, origin: { ...t.origin, edited: true } } } }] } }] });
    const r = await rest('POST', `/projects/${pid}/motion-tracks/mtk_edited/track`, {});
    expect([r.status, r.body.error.code]).toEqual([409, 'would_discard_edits']);
    const n = await rest('POST', `/projects/${pid}/motion-tracks/mtk_edited/track`, { overwrite: true, from: 40, to: 60 });
    expect([n.status, n.body.error.code]).toEqual([422, 'no_anchor']);
    const o = await rest('POST', `/projects/${pid}/motion-tracks/mtk_edited/track`, { overwrite: true, from: 0, to: 91 });
    expect([o.status, o.body.error.code]).toEqual([422, 'out_of_bounds']);
    expect((await rest('POST', `/projects/${pid}/motion-tracks/mtk_edited/track`, { extra: 1 })).status).toBe(400);
  });

  it('a job succeeds: 202, the track is attached through the internal op, stages are monotonic, and it follows the disc', async () => {
    seedTrack(pid, 'mtk_disc', discAsset, 30, disc.truth[30]!.cx, disc.truth[30]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    const events: { id: string; stage: string | null }[] = [];
    const onJob = (j: any) => events.push({ id: j.id, stage: j.stage }); // the first stage is written before the response returns
    store.events.on('job', onJob);
    const rev0 = store.getProject(pid).revision;
    const r = await rest('POST', `/projects/${pid}/motion-tracks/mtk_disc/track`, {});
    expect(r.status).toBe(202);
    const jobId = r.body.jobId as string;
    const job = await settle(jobId);
    store.events.off('job', onJob);
    const stages = events.filter((e) => e.id === jobId && e.stage).map((e) => e.stage!);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
    expect(job.output).toMatchObject({ motionTrackId: 'mtk_disc', from: 0, to: 90, frames: 90, input: 'original', revision: rev0 + 1 });
    expect(job.output.decodedFrames).toBeGreaterThanOrEqual(90);
    expect(job.output.trackingFps).toBeGreaterThan(0);

    const t = trackOf(pid, 'mtk_disc');
    expect([t.from, t.x.length, t.st[30]]).toEqual([0, 90, ST.manual]);
    expect(t.origin).toMatchObject({ method: TRACKER_METHOD, params: { algo: 'pf-track 2', input: 'original', workWidth: 320, workHeight: 240, direction: 'both' } });
    expect(String(t.origin.params.inputDigest)).toMatch(/^[0-9a-f]{64}$/);
    expect(String(t.origin.params.ffmpeg)).toMatch(/^ffmpeg version /);
    const err: number[] = [];
    for (let f = 0; f < 90; f++) {
      if (f === 30) continue;
      expect(t.st[f], `frame ${f}`).toBe(ST.tracked);
      err.push(Math.hypot((t.x[f]! / 1e4) * 320 - 0.5 - disc.truth[f]!.cx, (t.y[f]! / 1e4) * 240 - 0.5 - disc.truth[f]!.cy));
    }
    err.sort((a, b) => a - b);
    expect(err[Math.floor(err.length / 2)]!).toBeLessThanOrEqual(0.5);
    expect(err.at(-1)!).toBeLessThanOrEqual(1.5);
    expect(t.s!.every((v) => Math.abs(v - 1000) <= 30)).toBe(true);

    // stages: reading → forward (counting up) → backward (counting up) → saving
    const phase = (s: string) => (s === 'reading frames' ? 0 : s.startsWith('tracking forward') ? 1 : s.startsWith('tracking backward') ? 2 : s === 'saving track' ? 3 : -1);
    expect(stages[0]).toBe('reading frames');
    expect(stages.at(-1)).toBe('saving track');
    expect(stages.every((s) => phase(s) >= 0)).toBe(true);
    for (let i = 1; i < stages.length; i++) {
      expect(phase(stages[i]!)).toBeGreaterThanOrEqual(phase(stages[i - 1]!));
      const a = /(\d+)\/(\d+)$/.exec(stages[i - 1]!), b = /(\d+)\/(\d+)$/.exec(stages[i]!);
      if (a && b && phase(stages[i]!) === phase(stages[i - 1]!)) expect(Number(b[1])).toBeGreaterThanOrEqual(Number(a[1]));
    }
    expect(stages).toContain('tracking forward 59/59');
    expect(stages).toContain('tracking backward 30/30');

    const v = await rest('GET', `/projects/${pid}/motion-tracks/mtk_disc`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ motionTrackId: 'mtk_disc', assetId: discAsset, kind: 'region', from: 0, to: 90, usedBy: { follow: [], redact: [] } });
    expect(v.body.counts).toMatchObject({ manual: 1, tracked: 89 });
    expect(v.body.counts).toEqual(job.output.counts);
    expect(v.body.note).toMatch(/no AI model/);
    expect(v.body.note).toMatch(/not guaranteed redaction/);
    expect((await rest('GET', `/projects/${pid}/motion-tracks/mtk_none`)).status).toBe(404);
  }, 180_000);

  it('cancel while running: canceled within 2 s, its ffmpeg is gone, nothing is attached', async () => {
    seedTrack(pid, 'mtk_cancel', discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    const job = startTrackingJob(store, gov, agent, pid, 'mtk_cancel', TrackRunBody.parse({}), { readFrames: slowReader(60) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('tracking forward'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    const rev = store.getProject(pid).revision;
    const file = store.blobPath(store.getProject(pid).doc.assets[discAsset]!.contentHash);
    expect(ffmpegOn(file).length).toBeGreaterThan(0);
    // a second job for the same track is refused while this one runs
    expect((await rest('POST', `/projects/${pid}/motion-tracks/mtk_cancel/track`, {})).body.error.code).toBe('tracking_in_progress');
    const t0 = performance.now();
    const c = await rest('POST', `/jobs/${job.id}/cancel`, {});
    expect(c.body).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
    const done = await settle(job.id, 10_000);
    const ms = performance.now() - t0;
    expect(done.status).toBe('canceled');
    expect(done.error.message).toMatch(/nothing attached/);
    expect(ms).toBeLessThanOrEqual(2000);
    expect(ffmpegOn(file)).toEqual([]);
    expect(store.getProject(pid).revision).toBe(rev);
    expect(trackOf(pid, 'mtk_cancel').x).toHaveLength(1);
    expect((await rest('POST', `/jobs/${job.id}/cancel`, {})).body.outcome).toBe('already-finished');
  }, 60_000);

  it('a job waiting for the shared heavy slot (still renders, loudness) waits without working, and a cancel ends it at once', async () => {
    seedTrack(pid, 'mtk_wait', discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    // both heavy slots held by stand-ins for long still renders
    const releases: (() => void)[] = [];
    const holders = [0, 1].map(() => heavy(() => new Promise<void>((r) => releases.push(r))));
    await sleep(10);
    try {
      const job = startTrackingJob(store, gov, agent, pid, 'mtk_wait', TrackRunBody.parse({}));
      await sleep(300);
      expect(store.getJob(job.id)).toMatchObject({ status: 'running', stage: 'reading frames' });
      const file = store.blobPath(store.getProject(pid).doc.assets[discAsset]!.contentHash);
      expect(ffmpegOn(file)).toEqual([]); // nothing decoded while it waits
      const t0 = performance.now();
      await rest('POST', `/jobs/${job.id}/cancel`, {});
      expect((await settle(job.id, 5000)).status).toBe('canceled');
      expect(performance.now() - t0).toBeLessThan(500);
    } finally {
      for (const r of releases) r();
      await Promise.all(holders);
    }
  }, 60_000);

  it('the track edited while the job runs: the job fails with track_changed and attaches nothing', async () => {
    seedTrack(pid, 'mtk_changed', discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    const job = startTrackingJob(store, gov, agent, pid, 'mtk_changed', TrackRunBody.parse({ direction: 'forward', to: 40 }), { readFrames: slowReader(20) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('tracking forward'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    const t = trackOf(pid, 'mtk_changed');
    const edit = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'restore_entities', args: { targets: [{ id: t.id, state: { kind: 'motionTrack', track: { ...t, name: 'renamed' } } }] } }] });
    const done = await settle(job.id);
    expect(done.status).toBe('failed');
    expect(done.error.code).toBe('track_changed');
    expect(store.getProject(pid).revision).toBe(edit.revision);
    expect(trackOf(pid, 'mtk_changed')).toMatchObject({ name: 'renamed', x: t.x, st: t.st });
  }, 60_000);

  it('a hand correction while the job runs (origin.edited set): track_changed, not would_discard_edits, and nothing attached', async () => {
    seedTrack(pid, 'mtk_fixed', discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    const job = startTrackingJob(store, gov, agent, pid, 'mtk_fixed', TrackRunBody.parse({ direction: 'forward', to: 40 }), { readFrames: slowReader(20) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('tracking forward'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    const edit = correctByHand(pid, 'mtk_fixed');
    const corrected = arraysDigest(trackOf(pid, 'mtk_fixed'));
    const done = await settle(job.id);
    expect([done.status, done.error.code], JSON.stringify(done.error)).toEqual(['failed', 'track_changed']);
    expect(done.error.hint ?? '').not.toMatch(/overwrite/);
    expect(store.getProject(pid).revision).toBe(edit.revision);
    expect(arraysDigest(trackOf(pid, 'mtk_fixed'))).toBe(corrected);
  }, 60_000);

  it('a hand correction while the job waits (queued, or left running by a restart): track_changed when it starts', async () => {
    seedTrack(pid, 'mtk_fixed2', discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    // as startTrackingJob writes it; the correction lands before the runner gets to it
    const waiting = store.createJob(pid, 'tracking', agent.actor, { motionTrackId: 'mtk_fixed2', assetId: discAsset, from: 0, to: 40, direction: 'forward', input: 'proxy', trackVersion: store.entityVersion(pid, 'mtk_fixed2')?.revision ?? null, projectRevision: store.getProject(pid).revision });
    store.updateJob(waiting.id, { status: 'running', stage: 'tracking forward 3/39' });
    const edit = correctByHand(pid, 'mtk_fixed2');
    expect(recoverTrackingJobs(store)).toBe(1);
    const done = await settle(waiting.id);
    expect([done.status, done.error.code], JSON.stringify(done.error)).toEqual(['failed', 'track_changed']);
    expect(store.getProject(pid).revision).toBe(edit.revision);
  }, 60_000);

  it('a cancel answered "cancel-requested" ends canceled with nothing attached wherever it lands; the status never goes back to running', async () => {
    const moments = ['as the last frame reaches the tracker', 'while the stage turns to saving', 'just after the stage turned to saving'] as const;
    for (const [n, moment] of moments.entries()) {
      const id = `mtk_late${n}`;
      seedTrack(pid, id, discAsset, 0, disc.truth[0]!.cx, disc.truth[0]!.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
      const before = arraysDigest(trackOf(pid, id)), rev = store.getProject(pid).revision;
      const events: { status: string; stage: string | null }[] = [];
      let jobId = '', cut = -1, answer: ReturnType<typeof cancelTrackingJob> | null = null;
      const cancel = () => { if (answer) return; cut = events.length; answer = cancelTrackingJob(store, jobId, 'user:local'); };
      const onJob = (j: JobRow) => {
        if (j.id !== jobId) return;
        events.push({ status: j.status, stage: j.stage });
        if (j.status !== 'running' || j.stage !== 'saving track') return;
        if (moment === 'while the stage turns to saving') cancel();
        else if (moment === 'just after the stage turned to saving') queueMicrotask(cancel);
      };
      // instrumentation of the real reader: the cancel arrives while ffmpeg delivers the last frame, before the tracker sees it
      const reader: ReadFrames = (src, from, to, h, onFrame, signal) => readFrames(src, from, to, h, async (i, f) => { if (moment === 'as the last frame reaches the tracker' && i === to - 1) cancel(); await onFrame(i, f); }, signal);
      store.events.on('job', onJob);
      try {
        jobId = startTrackingJob(store, gov, agent, pid, id, TrackRunBody.parse({ direction: 'forward', to: 20 }), { readFrames: reader }).id;
        const done = await settle(jobId);
        expect(answer, moment).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
        expect(done.status, `${moment}: ${JSON.stringify(events.slice(cut))}`).toBe('canceled');
        expect(events.slice(cut).map((e) => e.status).filter((s) => s !== 'cancel-requested' && s !== 'canceled'), moment).toEqual([]);
        expect(store.getProject(pid).revision, moment).toBe(rev);
        expect(arraysDigest(trackOf(pid, id)), moment).toBe(before);
      } finally { store.events.off('job', onJob); }
    }
  }, 120_000);

  it('a job left running by a restart is tracked again by recoverTrackingJobs, with the same result as an uninterrupted run', async () => {
    const at = disc.truth[45]!;
    seedTrack(pid, 'mtk_once', discAsset, 45, at.cx, at.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    seedTrack(pid, 'mtk_again', discAsset, 45, at.cx, at.cy, 320, 240, { w: 2 * disc.radius, h: 2 * disc.radius });
    const once = startTrackingJob(store, gov, agent, pid, 'mtk_once', TrackRunBody.parse({ from: 20, to: 80 }));
    expect((await settle(once.id)).status).toBe('succeeded');
    // as startTrackingJob would have written it, then the process "died" while it ran
    const interrupted = store.createJob(pid, 'tracking', agent.actor, { motionTrackId: 'mtk_again', assetId: discAsset, from: 20, to: 80, direction: 'both', input: 'proxy', trackVersion: store.entityVersion(pid, 'mtk_again')?.revision ?? null, projectRevision: store.getProject(pid).revision });
    store.updateJob(interrupted.id, { status: 'running', stage: 'tracking forward 10/34' });
    expect(recoverTrackingJobs(store)).toBe(1);
    const again = await settle(interrupted.id);
    expect(again.status, JSON.stringify(again.error)).toBe('succeeded');
    expect(arraysDigest(trackOf(pid, 'mtk_again'))).toBe(arraysDigest(trackOf(pid, 'mtk_once')));
    expect(trackOf(pid, 'mtk_again').x).toHaveLength(60);
  }, 120_000);

  it('the event loop stays responsive during a 300-frame 640×360 job (delay p99 ≤ 100 ms)', async () => {
    const p2 = store.createProject({ name: 'pan', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const assetId = await importInto(p2, panFile);
    store.commit({ projectId: p2, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId, start: { value: '0', timescale: 30 } } }] });
    // anchored mid-clip, so both the forward read and the backward chunks (read forward, walked in reverse) are measured
    seedTrack(p2, 'mtk_pan', assetId, 150, 590 - Math.floor(1.7 * 150), 290 - Math.floor(0.4 * 150), 640, 360, { w: 80, h: 80 });
    const h = monitorEventLoopDelay({ resolution: 10 });
    h.enable();
    const r = await rest('POST', `/projects/${p2}/motion-tracks/mtk_pan/track`, {});
    expect(r.status).toBe(202);
    const job = await settle(r.body.jobId, 240_000);
    h.disable();
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
    const p99 = h.percentile(99) / 1e6;
    console.log(`tracking 300 frames of 640×360: ${job.output.trackingFps} frames/s; event-loop delay p50 ${(h.percentile(50) / 1e6).toFixed(1)} ms, p99 ${p99.toFixed(1)} ms, max ${(h.max / 1e6).toFixed(1)} ms`);
    expect(p99).toBeLessThanOrEqual(100);
    // the picture pans by whole pixels, so the truth is exact: the feature at (590, 290) of frame 0 is at (590 − ⌊1.7n⌋, 290 − ⌊0.4n⌋)
    expect(job.output.decodedFrames).toBe(300 + 151); // forward [150, 300) and one backward chunk [0, 151), each decoded from the start
    const t = trackOf(p2, 'mtk_pan');
    expect(t.x).toHaveLength(300);
    let worst = 0, used = 0;
    expect(t.st[150]).toBe(ST.manual);
    for (let n = 0; n < 300; n++) {
      if (n === 150 || t.st[n] !== ST.tracked) continue;
      used++;
      worst = Math.max(worst, Math.hypot((t.x[n]! / 1e4) * 640 - 0.5 - (590 - Math.floor(1.7 * n)), (t.y[n]! / 1e4) * 360 - 0.5 - (290 - Math.floor(0.4 * n))));
    }
    expect(used).toBeGreaterThanOrEqual(290);
    expect(worst).toBeLessThanOrEqual(1.5);
  }, 300_000);
});
