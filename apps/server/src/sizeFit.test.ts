/**
 * Size-fit on the server (wave 7 send, C4–C7): the plan writes manifest.fit and refuses with size_fit_format / size_fit_too_small
 * (with details.minBytes) instead of size_fit_not_built; segment keys are the same with and without sizeFit; the fit pass
 * (real ffmpeg, a synthetic intermediate made here) publishes only a file at or under the target, retries once, fails typed
 * with both byte counts, labels the TEST fault, and is stopped by a cancel. Nothing reads the environment.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { planSizeFit, SEND_API_REFUSALS, sizeFitMinBytes, type SizeFitManifest } from '@pulseframe/core';
import { loadConfig } from './config.ts';
import { Exporter, pictureCheckFor, soundChecksOf, type Manifest } from './export.ts';
import { FrameFlashCheck, reportFromCells } from './flashCheck.ts';
import { flashCells } from '@pulseframe/engine';
import { encoderIdFor, frameKeyFor } from './renderCacheEnv.ts';
import type { SegmentEnv } from './exportSegments.ts';
import { attemptOutcome, runSizeFit, SIZE_FIT_METHOD } from './sizeFit.ts';
import { ApiError, Store } from './store.ts';

const exec = promisify(execFile);
const R = { num: 30, den: 1 };
let dir: string, store: Store, exporter: Exporter;
let intermediate: string, wav: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sizefit-'));
  void loadConfig;
  store = new Store(dir);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  // a synthetic full-quality intermediate as the export writes it: 2 s 320×180 30 fps of noisy test pattern, CRF 16, BT.709 tags
  intermediate = path.join(dir, 'out.mp4');
  wav = path.join(dir, 'mix.wav');
  await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-ac', '2', '-c:a', 'pcm_s16le', wav]);
  await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30,noise=alls=40:allf=t', '-i', wav, '-frames:v', '60', '-map', '0:v', '-map', '1:a',
    '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '16', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', intermediate]);
}, 60_000);
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

function seed(name: string, seconds = 12, size = { width: 640, height: 360 }) {
  const pid = store.createProject({ name, ...size, frameRate: R }).doc.id;
  store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(seconds * 30, R) } }] });
  return store.getProject(pid);
}

/** This test runs without the web bundle, so a title also gets renderer_unavailable: only the size-fit blockers are compared. */
const fitBlockers = (bs: { code: string }[]) => bs.filter((b) => b.code.startsWith('size_fit'));
describe('size-fit plan on the server', () => {
  it('B: plan with sizeFit gives manifest.fit and size_fit_format / size_fit_too_small (details.minBytes) instead of size_fit_not_built', () => {
    const p = seed('plan');
    const ok = exporter.plan(p.doc, p.revision, { sizeFit: { targetBytes: 1_500_000 } });
    expect(fitBlockers(ok.blockers)).toEqual([]);
    expect(ok.manifest.fit).toMatchObject({ targetBytes: 1_500_000, scale: 1, width: 640, height: 360, audioBitrate: 96_000 });
    expect(ok.manifest.options).toMatchObject({ quality: 'high', scale: 1, sizeFit: { targetBytes: 1_500_000 } });
    expect(ok.manifest.fit!.basis).toMatch(/HEURISTIC/);
    // a draft request is still rendered at high quality for the intermediate; an asked scale is the upper bound
    const half = exporter.plan(p.doc, p.revision, { sizeFit: { targetBytes: 1_500_000 }, quality: 'draft', scale: 0.5 });
    expect(half.manifest.options).toMatchObject({ quality: 'high', scale: 0.5 });
    expect(half.manifest.output).toMatchObject({ width: 320, height: 180 });
    // format
    const webm = exporter.plan(p.doc, p.revision, { sizeFit: { targetBytes: 1_500_000 }, format: 'webm-vp9-opus' });
    expect(webm.blockers).toContainEqual(expect.objectContaining({ code: 'size_fit_format', message: SEND_API_REFUSALS.sizeFitFormat.message('webm-vp9-opus'), hint: SEND_API_REFUSALS.sizeFitFormat.hint }));
    expect(webm.manifest.fit).toBeUndefined();
    // too small: a 20-minute title at 1,000,000
    const long = seed('long', 20 * 60);
    const small = exporter.plan(long.doc, long.revision, { sizeFit: { targetBytes: 1_000_000 } });
    const min = sizeFitMinBytes({ frames: 20 * 60 * 30, rate: R, width: 640, height: 360, sampleRate: long.doc.settings.sampleRate, maxScale: 1 });
    expect(fitBlockers(small.blockers)).toEqual([{ code: 'size_fit_too_small', message: SEND_API_REFUSALS.sizeFitTooSmall.message(1_000_000, min), ids: [], hint: SEND_API_REFUSALS.sizeFitTooSmall.hint, minBytes: min }]);
    expect(fitBlockers(exporter.plan(long.doc, long.revision, { sizeFit: { targetBytes: min } }).blockers)).toEqual([]);
    expect(fitBlockers(exporter.plan(long.doc, long.revision, { sizeFit: { targetBytes: min - 1 } }).blockers).map((b) => b.code)).toEqual(['size_fit_too_small']);
    // the half-size case of the proof: 12 s of a 1280×720 project at 1,000,000 bytes
    const big = seed('big', 12, { width: 1280, height: 720 });
    expect(exporter.plan(big.doc, big.revision, { sizeFit: { targetBytes: 1_000_000 } }).manifest.output).toMatchObject({ width: 640, height: 360 });
  });
  it('B: segment keys are the same with and without sizeFit', () => {
    const p = seed('keys');
    const plain = exporter.plan(p.doc, p.revision, { quality: 'high', scale: 0.5 }).manifest;
    const fitted = exporter.plan(p.doc, p.revision, { sizeFit: { targetBytes: 1_000_000 }, scale: 0.5 }).manifest;
    expect(fitted.fit?.scale).toBe(0.5);
    expect(fitted.output).toEqual(plain.output);
    expect(encoderIdFor('ffmpeg version test', fitted, 2)).toBe(encoderIdFor('ffmpeg version test', plain, 2));
    const env = { digest: (s: string) => `d:${s.length}:${s.slice(0, 64)}`, assetHash: () => null, fontHash: () => 'f', effectVersion: () => 1, gpu: null } as unknown as SegmentEnv;
    const a = frameKeyFor(p.doc, plain, env), b = frameKeyFor(p.doc, fitted, env);
    for (let k = 0; k < 360; k += 7) expect(b(k)).toBe(a(k));
  });
  it('nothing in the fit reads the environment (the fault comes only from startServer deps)', () => {
    for (const f of ['sizeFit.ts', 'export.ts']) expect(fs.readFileSync(path.join(import.meta.dirname, f), 'utf8')).not.toMatch(/process\.env/);
    expect(fs.readFileSync(path.join(import.meta.dirname, 'index.ts'), 'utf8')).toMatch(/if \(deps\.fitFault\) exporter\.fitFault = deps\.fitFault;/);
  });
});

describe('attemptOutcome (pure)', () => {
  it('fits at or under the target; the TEST fault forces attempt 1 (once) or every attempt (always) over', () => {
    expect(attemptOutcome(1000, 1000, 1, null)).toEqual({ fits: true, countedBytes: 1000, forced: false });
    expect(attemptOutcome(1001, 1000, 1, null)).toEqual({ fits: false, countedBytes: 1001, forced: false });
    expect(attemptOutcome(900, 1000, 1, 'overshoot-once')).toEqual({ fits: false, countedBytes: 1001, forced: true });
    expect(attemptOutcome(900, 1000, 2, 'overshoot-once')).toEqual({ fits: true, countedBytes: 900, forced: false });
    expect(attemptOutcome(900, 1000, 2, 'overshoot-always')).toEqual({ fits: false, countedBytes: 1001, forced: true });
    expect(attemptOutcome(1500, 1000, 1, 'overshoot-always').countedBytes).toBe(1500);
  });
});

describe('runSizeFit (real ffmpeg on a synthetic intermediate)', () => {
  const output: Manifest['output'] = { width: 320, height: 180, firstFrame: 0, frames: 60, frameRate: R, sampleRate: 48000 };
  const fitFor = (targetBytes: number): SizeFitManifest => {
    const p = planSizeFit({ targetBytes, frames: 60, rate: R, width: 320, height: 180, sampleRate: 48000, maxScale: 1 });
    if (!p.ok) throw new Error('fixture plan refused');
    const { ok: _ok, ...rest } = p;
    return { targetBytes, ...rest };
  };
  const deps = (targetBytes: number, fault: 'overshoot-once' | 'overshoot-always' | null = null, extra: Partial<Parameters<typeof runSizeFit>[0]> = {}) => {
    const work = fs.mkdtempSync(path.join(dir, 'work-'));
    const stages: string[] = [];
    return { stages, work, d: { intermediate, wav, workDir: work, output, fit: fitFor(targetBytes), fault, canceled: () => false, stage: (s: string) => stages.push(s), onProcess: () => {}, ...extra } };
  };
  it('fits a target: the file is at or under it, exact frames, allowed tags only, stages in words', async () => {
    const target = 300_000;
    expect(fs.statSync(intermediate).size).toBeGreaterThan(target);
    const { d, stages } = deps(target);
    const r = await runSizeFit(d);
    expect(r.fit).toMatchObject({ result: 'fitted', targetBytes: target, scale: 1, width: 320, height: 180, method: SIZE_FIT_METHOD });
    expect(r.fit.bytes).toBe(fs.statSync(r.file).size);
    expect(r.fit.bytes).toBeLessThanOrEqual(target);
    // x264's two-pass rate control can land a little over on a 2 s film (one sample here: 301,680 for 300,000), so the retry may run
    expect(r.fit.attempts.length).toBeGreaterThanOrEqual(1);
    expect(r.fit.attempts[r.fit.attempts.length - 1]!.bytes).toBe(r.fit.bytes);
    expect(r.validation).toMatchObject({ frames: 60, packets: 60, constantFrameRate: true, width: 320, height: 180, videoCodec: 'h264', audioCodec: 'aac' });
    expect(stages.slice(0, 4)).toEqual(['checking size', 'fitting size 1/2', 'fitting size 2/2', 'checking size']);
    expect('test' in r.fit).toBe(false);
  }, 60_000);
  it('already fits: the intermediate itself, one encode, the scale and size stated', async () => {
    const { d } = deps(50_000_000);
    const r = await runSizeFit(d);
    expect(r.file).toBe(intermediate);
    expect(r.fit).toMatchObject({ result: 'already_fits', attempts: [], scale: 1, width: 320, height: 180, bytes: fs.statSync(intermediate).size });
  });
  it('overshoot-once: two attempts, the second at or under the target, labelled TEST', async () => {
    const { d, stages } = deps(300_000, 'overshoot-once');
    const r = await runSizeFit(d);
    expect(r.fit.attempts).toHaveLength(2);
    expect(r.fit.attempts[1]!.videoBitrate).toBeLessThan(r.fit.attempts[0]!.videoBitrate);
    expect(r.fit.bytes).toBeLessThanOrEqual(300_000);
    expect(r.fit.test).toMatch(/^TEST fault: overshoot-once/);
    expect(stages.filter((x) => x === 'fitting size 2/2')).toHaveLength(2);
  }, 90_000);
  it('overshoot-always: size_fit_missed with both byte counts, no fitted file left', async () => {
    const { d, work } = deps(300_000, 'overshoot-always');
    const e = await runSizeFit(d).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('size_fit_missed');
    expect(e.details.attempts).toHaveLength(2);
    expect(e.details.countedBytes).toHaveLength(2);
    expect(e.details.retryable).toBe(false);
    expect(e.details.test).toMatch(/TEST fault/);
    expect(fs.readdirSync(work).filter((f) => f.endsWith('.mp4'))).toEqual([]);
  }, 90_000);
  it('a cancel stops the running encoder and nothing is returned', async () => {
    let cancel = false;
    const { d } = deps(300_000, null, { canceled: () => cancel, onProcess: (p) => { if (p) { cancel = true; p.kill('SIGKILL'); } } });
    const started = Date.now();
    const e = await runSizeFit(d).then(() => null, (x) => x);
    expect(e).toBeInstanceOf(Error);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 30_000);
});

// The export's picture-check glue (export.ts pictureCheckFor) lives with the fit tests: both are B's server half of track send.
describe('export picture checks (server glue, C10)', () => {
  it('the single-pass hook (FrameFlashCheck onCells) and the segmented hook (cells in order) give the same findings, in timeline time', () => {
    // a title over the whole range (so a black stretch is context picture); frames: 20 noisy, 30 black, 150 noisy; range from frame 30
    const p = seed('pc', 12);
    const W = 64, H = 36, rate = R;
    const doc = { ...p.doc, settings: { ...p.doc.settings, width: W, height: H } };
    const output: Manifest['output'] = { width: W, height: H, firstFrame: 30, frames: 200, frameRate: rate, sampleRate: 48000 };
    const frame = (k: number) => { const a = new Uint8Array(W * H * 4); if (k >= 20 && k < 50) return a; let s = (k + 1) * 2654435761 >>> 0; for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24; } return a; };
    const single = pictureCheckFor(doc, 'mp4-h264-aac', output)!;
    const fc = new FrameFlashCheck(W, H, rate, (c) => single.feed(c));
    for (let k = 0; k < 200; k++) fc.feed(frame(k));
    const seg = pictureCheckFor(doc, 'mp4-h264-aac', output)!;
    reportFromCells((function* () { for (let k = 0; k < 200; k++) { const c = flashCells(frame(k), W, H); seg.feed(c); yield c; } })(), rate, output.firstFrame);
    const a = single.result(output.firstFrame), b = seg.result(output.firstFrame);
    expect(a).toEqual(b);
    expect(a.status).toBe('measured');
    expect(a.findings).toEqual([{ kind: 'black', from: T.frameTime(50, rate), to: T.frameTime(80, rate), context: 'picture', measured: expect.objectContaining({ frames: 30, drawnFrames: 30 }) }]);
    // a feed that stopped early is not measured (never a partial report presented as the whole)
    const short = pictureCheckFor(doc, 'mp4-h264-aac', output)!;
    short.feed(flashCells(frame(0), W, H));
    expect(short.result(30)).toMatchObject({ status: 'not_measured', findings: [] });
    // no picture checks for a still or a sound file
    expect(pictureCheckFor(doc, 'png', output)).toBeNull();
    expect(pictureCheckFor(doc, 'wav', output)).toBeNull();
  });
  it('without the sound checks of the mix the sound half says not measured', () => {
    expect(soundChecksOf(null)).toMatchObject({ status: 'not_measured', findings: [] });
    expect(soundChecksOf({ clips: 1, mixPeakDbfs: null, loudness: null, clipped: false } as never)).toMatchObject({ status: 'not_measured' });
  });
});
