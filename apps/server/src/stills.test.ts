/**
 * W1 (wave 8 cover): the stills job on synthetic files written at test time (packages/evals/src/stills-proof.measure.ts fixtures,
 * imported by relative path) with the real Store, Derivatives, Governance, app (app.fetch, no port) and MCP handler, and the real
 * ffmpeg reader. Turns on the W1 todo rows of stillsContracts.test.ts (server): 202 then output.answer, { cached: true } with no ffmpeg
 * started; 422 stills_range_too_long / no_video / invalid_request; 409 with details.jobId, 429; cancel writes nothing; a restart
 * recovers and runs again. Plus: the seeking reader checks its frames (B-frames pass; an MPEG-TS seek that lands late is caught and
 * read again with a preroll), records do not depend on their range, the cache key, the export pause, the noise term's numbers.
 * The counting/slowing reader wrapper is instrumentation around the real reader, not a mock. Needs ffmpeg.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { STILLS_ALGO, STILLS_LONG_SIDE, stillsStage, type SharpAnswer, type StillsJobOutput } from '@pulseframe/core';
import {
  countedReader, createStillsHarness, DARK, dataOf, decodeAll, ffmpegOn, OWNER, readBarcode, remuxTs, writeBarcodeClip, writeDarkNoisy, writeMotion, writePng, writeRamp,
  type StillsHarness,
} from '../../../packages/evals/src/stills-proof.measure.ts';
import { readStillsFrames, recoverStillsJobs, startStillsJob, stillsReady, stillsGreyCheck, stillsGreySize, StillsSeekMiss, stopStillsJobs, cancelStillsJob, STILLS_SEEK_PREROLL_US } from './stills.ts';
import { frameSource, ffmpegVersionLine } from './tracking.ts';

vi.setConfig({ testTimeout: 120_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let h: StillsHarness, fx = '';
const F = {} as { ramp: string; bar: string; ts: string; dark: string; motion: string; r60: string; photo: string };
beforeAll(async () => {
  await stillsReady(); // direct calls below need the ffmpeg build line (the routes wait for it themselves)
  fx = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stills-unit-fx-'));
  F.ramp = await writeRamp(path.join(fx, 'ramp.mp4'), { width: 640, height: 360, frames: 64, peak: 37 });
  F.bar = await writeBarcodeClip(path.join(fx, 'bar.mp4'), { width: 320, height: 180, frames: 1200, rate: { num: 30, den: 1 }, codec: 'x264-bframes' });
  F.ts = remuxTs(F.bar, path.join(fx, 'bar.ts'));
  F.dark = await writeDarkNoisy(path.join(fx, 'dark.mp4'), { width: 480, height: 270 });
  F.motion = await writeMotion(path.join(fx, 'motion.mp4'), { width: 320, height: 180, frames: 60 });
  F.r60 = await writeBarcodeClip(path.join(fx, 'r60.mp4'), { width: 160, height: 90, frames: 240, rate: { num: 60, den: 1 }, codec: 'lossless' });
  F.photo = writePng(path.join(fx, 'photo.png'), 64, 48);
  h = createStillsHarness();
}, 300_000);
afterAll(async () => {
  await h?.close();
  fs.rmSync(fx, { recursive: true, force: true });
});
const job = async (pid: string, body: Record<string, unknown>, extra = {}) => {
  const r = startStillsJob(h.store, h.gov, OWNER, pid, body as never, h.deps(extra));
  if ('cached' in r) return { cached: true as const, answer: r.answer, output: null };
  const j = await h.settle(r.jobId);
  expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
  return { cached: false as const, answer: (j.output as StillsJobOutput).answer, output: j.output as StillsJobOutput };
};
const imported = async (name: string, file: string, rate = { num: 30, den: 1 }) => { const pid = h.project(name, rate); return { pid, a: await h.importFile(pid, file) }; };
const assetOf = (pid: string, a: string) => h.store.getProject(pid).doc.assets[a]!;
const ac = () => new AbortController().signal;
/** A new file per test where the cache must start empty (the derivative is per file content, shared by every project). */
let seed = 100;
const freshMotion = () => { seed++; return writeMotion(path.join(fx, `motion${seed}.mp4`), { width: 320, height: 180, frames: 60, seed }); };
const freshRamp = () => { seed++; return writeRamp(path.join(fx, `ramp${seed}.mp4`), { width: 640, height: 360, frames: 64, peak: 37, seed }); };

describe('the seeking reader checks that it got exactly the frames it asked for', () => {
  it('H.264 with B-frames: frames 912–960 of 1200 by input seek are exactly those (barcodes), first and last times as asked', async () => {
    const { pid, a } = await imported('bar', F.bar);
    const asset = assetOf(pid, a), src = frameSource(h.store, h.derivatives, asset, 'original');
    expect(src.kind).toBe('original');
    const seen: number[] = [];
    const r = await readStillsFrames(src, asset, 912, 49, (f, fr) => { seen.push(readBarcode(fr.data, fr.width, fr.height, 3) - f); }, ac(), { pixFmt: 'rgb24' });
    expect(seen).toEqual(new Array(49).fill(0));
    expect([r.frames, r.seek, r.trim]).toEqual([49, '30.383333', null]);
    expect(Math.abs(r.firstUs! - r.wantFirstUs)).toBeLessThan(2000);
  });
  it('MPEG-TS (start time about 1.47 s): the plain seek delivers later frames and is REFUSED by the reader; with the preroll it delivers the asked ones', async () => {
    const { pid, a } = await imported('ts', F.ts);
    const asset = assetOf(pid, a), src = frameSource(h.store, h.derivatives, asset, 'original');
    expect(asset.timeOrigin && T.toSeconds(asset.timeOrigin)).toBeGreaterThan(1.3);
    const plain: number[] = [];
    let miss: StillsSeekMiss | null = null;
    try { await readStillsFrames(src, asset, 912, 49, (_f, fr) => { plain.push(readBarcode(fr.data, fr.width, fr.height, 3)); }, ac(), { pixFmt: 'rgb24' }); } catch (e) { miss = e as StillsSeekMiss; }
    // the finding (ffmpeg 6.1.1 here): the TS seek lands between key frames, the decoder waits for the next key frame (960)
    console.info('stills TS plain seek (barcodes):', JSON.stringify({ first: plain[0], last: plain.at(-1), delivered: plain.length, details: miss?.details }));
    if (plain[0] !== 912) expect(miss).toBeInstanceOf(StillsSeekMiss);
    const seen: number[] = [];
    const r = await readStillsFrames(src, asset, 912, 49, (f, fr) => { seen.push(readBarcode(fr.data, fr.width, fr.height, 3) - f); }, ac(), { pixFmt: 'rgb24', prerollUs: STILLS_SEEK_PREROLL_US });
    expect(seen).toEqual(new Array(49).fill(0));
    expect([r.seek, r.trim]).toEqual(['20.383333', '10.000000']);
    // the job takes the same way and says nothing else: the right frames, motion to the frame before
    const counter = countedReader();
    const { answer } = await job(pid, { assetId: a, from: 913, to: 961 }, { readFrames: counter.read });
    expect(answer.frames.map((m) => m.frame)).toEqual(Array.from({ length: 48 }, (_, i) => 913 + i));
    expect(counter.asked().map((x) => x.prerollUs)).toEqual(plain[0] === 912 ? [0] : [0, STILLS_SEEK_PREROLL_US]);
  });
  it('a read past the file\'s end is refused (count), not padded', async () => {
    const { pid, a } = await imported('end', F.bar);
    const asset = assetOf(pid, a), src = frameSource(h.store, h.derivatives, asset, 'original');
    await expect(readStillsFrames(src, asset, 1190, 20, () => {}, ac())).rejects.toBeInstanceOf(StillsSeekMiss);
  });
  it('the grey self-check passes on this ffmpeg; the grey size is long side 960 at most, never enlarged, even', async () => {
    await expect(stillsGreyCheck()).resolves.toBeUndefined();
    expect(stillsGreySize(1920, 1080)).toEqual({ width: 960, height: 540 });
    expect(stillsGreySize(3001, 2001)).toEqual({ width: 960, height: 640 });
    expect(stillsGreySize(320, 181)).toEqual({ width: 320, height: 182 });
    expect(stillsGreySize(1080, 1920)).toEqual({ width: 540, height: 960 });
  });
});

describe('the job (W1 rows of the contract test)', () => {
  it('a measured clip answers 202, then the job\'s output.answer; a second request is { cached: true } with no ffmpeg started', async () => {
    const { pid, a } = await imported('rest', F.ramp);
    const clip = h.addClip(pid, a, 0, 64);
    const t = h.auth.tokens.agent;
    const r = await h.rest('POST', `/projects/${pid}/stills`, { assetId: a, clipId: clip }, t);
    expect([r.status, r.body.status]).toEqual([202, 'queued']);
    const j = await h.settle(r.body.jobId);
    expect(j.status).toBe('succeeded');
    const out = j.output as StillsJobOutput;
    expect([out.read, out.reused, out.answer.complete, out.answer.measuredFrames, out.answer.candidates[0]!.frame]).toEqual([64, 0, true, 64, 37]);
    expect(out.answer.frames[0]!.motion).toBeNull(); // frame 0 of the file
    expect(out.answer.frames.slice(1).every((m) => m.motion !== null)).toBe(true);
    expect(out.answer.source).toEqual({ width: 640, height: 360, rate: { num: 30, den: 1 }, conformed: null });
    expect(j.stage).toBe(stillsStage(64, 64));
    expect(typeof out.wallSeconds).toBe('number');
    const again = await h.rest('POST', `/projects/${pid}/stills`, { assetId: a, clipId: clip }, t);
    expect([again.status, again.body.cached]).toEqual([200, true]);
    expect(again.body.answer).toEqual(out.answer);
    const counter = countedReader();
    const c = startStillsJob(h.store, h.gov, OWNER, pid, { assetId: a, from: 10, to: 20 }, h.deps({ readFrames: counter.read }));
    expect('cached' in c && c.cached).toBe(true);
    expect(counter.calls()).toBe(0);
    // the data file: ascending, unique, a read row whose digest is the SHA-256 of the grey bytes; meta is the cache key
    const asset = assetOf(pid, a), d = dataOf(h.store, h.derivatives, asset.contentHash)!;
    expect(d.data.measured.map((m) => m.frame)).toEqual(Array.from({ length: 64 }, (_, i) => i));
    const grey = decodeAll(F.ramp, 640, 360);
    const digest = createHash('sha256'); for (const g of grey) digest.update(g);
    expect(d.data.reads).toEqual([{ from: 0, to: 64, digest: digest.digest('hex') }]);
    expect(d.data).toMatchObject({ algo: STILLS_ALGO, longSide: STILLS_LONG_SIDE, ffmpeg: await ffmpegVersionLine(), grey: { width: 640, height: 360 }, asset: { frames: 64, width: 640, height: 360, startOffsetFrames: 0 } });
    expect(h.derivatives.get(asset.contentHash, 'stills')!.meta).toEqual({ algo: STILLS_ALGO, longSide: STILLS_LONG_SIDE, ffmpeg: await ffmpegVersionLine(), frames: 64 });
    expect(JSON.stringify(d.data)).not.toMatch(/20\d\d-\d\d-\d\dT/); // no clock inside
  });
  it('a stretch over 600 frames is 422 stills_range_too_long; a picture file is 422 no_video; a clip of another file 422 invalid_request', async () => {
    const { pid, a } = await imported('refusals', F.bar);
    const ph = await h.importFile(pid, F.photo), m = await h.importFile(pid, F.motion);
    const clipM = h.addClip(pid, m, 0, 30), longClip = h.addClip(pid, a, 100, 601);
    const t = h.auth.tokens.agent, post = (b: unknown) => h.rest('POST', `/projects/${pid}/stills`, b, t);
    const code = async (b: unknown) => { const r = await post(b); return [r.status, r.body?.error?.code]; };
    expect(await code({ assetId: a, from: 0, to: 601 })).toEqual([422, 'stills_range_too_long']);
    expect(await code({ assetId: a, clipId: longClip })).toEqual([422, 'stills_range_too_long']);
    expect(await code({ assetId: ph, from: 0, to: 1 })).toEqual([422, 'no_video']);
    expect(await code({ assetId: a, clipId: clipM })).toEqual([422, 'invalid_request']);
    expect(await code({ assetId: a, from: 5, to: 5 })).toEqual([422, 'invalid_range']);
    expect(await code({ assetId: a, from: 1100, to: 1201 })).toEqual([422, 'out_of_bounds']);
    expect(await code({ assetId: 'ast_none', from: 0, to: 2 })).toEqual([404, 'not_found']);
    expect(await code({ assetId: a, clipId: 'clip_none' })).toEqual([422, 'incompatible']);
    const r = await post({ assetId: a, from: 0, to: 601 });
    expect(r.body.error.hint.length).toBeGreaterThan(10);
    expect(r.body.error.details).toMatchObject({ from: 0, to: 601, max: 600 });
    expect(h.store.openJobs('stills').filter((j) => j.projectId === pid)).toEqual([]);
  });
  it('one open job per project (409 stills_in_progress with details.jobId), three per server (429 busy); cancel writes nothing and stops ffmpeg', async () => {
    const ps = [] as { pid: string; a: string }[];
    for (let i = 0; i < 4; i++) ps.push(await imported(`busy${i}`, await freshRamp()));
    let n = 0;
    const slow = countedReader(25, () => { n++; });
    const start = (i: number, to = 64) => startStillsJob(h.store, h.gov, OWNER, ps[i]!.pid, { assetId: ps[i]!.a, from: 0, to }, h.deps({ readFrames: slow.read })) as { jobId: string };
    const first = start(0);
    let e409: any; try { start(0, 30); } catch (e) { e409 = e; }
    expect([e409.status, e409.code, e409.details.jobId]).toEqual([409, 'stills_in_progress', first.jobId]);
    const second = start(1), third = start(2);
    let e429: any; try { start(3); } catch (e) { e429 = e; }
    expect([e429.status, e429.code]).toEqual([429, 'busy']);
    while (n < 4) await sleep(10);
    const file = h.store.blobPath(assetOf(ps[0]!.pid, ps[0]!.a).contentHash);
    expect(ffmpegOn(file).length).toBeGreaterThan(0);
    expect(cancelStillsJob(h.store, first.jobId, 'user:owner').status).toBe('cancel-requested');
    expect(cancelStillsJob(h.store, second.jobId, 'user:owner')).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' }); // still waiting for the lane
    expect((await h.settle(first.jobId)).status).toBe('canceled');
    expect((await h.settle(second.jobId)).status).toBe('canceled');
    cancelStillsJob(h.store, third.jobId, 'user:owner');
    expect((await h.settle(third.jobId)).status).toBe('canceled');
    await sleep(300);
    expect(ffmpegOn(file)).toEqual([]);
    expect(h.derivatives.get(assetOf(ps[0]!.pid, ps[0]!.a).contentHash, 'stills')).toBeNull();
    expect(h.store.getJob(first.jobId).output).toBeNull();
  });
  it('a restart recovers a running stills job and runs it again from the start (stop leaves the row running)', async () => {
    const { pid, a } = await imported('recover', await freshMotion());
    let n = 0;
    const slow = countedReader(20, () => { n++; });
    const r = startStillsJob(h.store, h.gov, OWNER, pid, { assetId: a, from: 0, to: 60 }, h.deps({ readFrames: slow.read })) as { jobId: string };
    while (n < 3) await sleep(10);
    await stopStillsJobs(h.store);
    expect(h.store.getJob(r.jobId).status).toBe('running');
    expect(h.derivatives.get(assetOf(pid, a).contentHash, 'stills')).toBeNull();
    const counter = countedReader();
    expect(recoverStillsJobs(h.store, h.deps({ readFrames: counter.read }))).toBe(1);
    const j = await h.settle(r.jobId);
    expect(j.status).toBe('succeeded');
    expect(counter.asked()).toEqual([{ first: 0, count: 60, prerollUs: 0 }]);
    expect((j.output as StillsJobOutput).answer.complete).toBe(true);
  });
});

describe('records are independent of their range; the cache merges by frame', () => {
  it('extending a stretch reads only the new frames plus the one before; stored records stay; the merge equals a cold read', async () => {
    const file = await freshMotion();
    const { pid, a } = await imported('extend', file);
    const counter = countedReader();
    const first = await job(pid, { assetId: a, from: 10, to: 40 }, { readFrames: counter.read });
    expect(first.answer.frames[0]!.motion).not.toBeNull(); // frame 9 was read for it
    expect(first.answer.frames.map((m) => m.frame)).toEqual(Array.from({ length: 30 }, (_, i) => 10 + i));
    const before = dataOf(h.store, h.derivatives, assetOf(pid, a).contentHash)!.data;
    const ext = await job(pid, { assetId: a, from: 10, to: 50 }, { readFrames: counter.read });
    expect(counter.asked().map(({ first: f, count }) => [f, count])).toEqual([[9, 31], [39, 11]]);
    expect([ext.output!.read, ext.output!.reused]).toEqual([11, 30]);
    const after = dataOf(h.store, h.derivatives, assetOf(pid, a).contentHash)!.data;
    for (const m of before.measured) expect(after.measured.find((x) => x.frame === m.frame)).toEqual(m);
    expect(after.reads.map((r) => [r.from, r.to])).toEqual([[9, 40], [39, 50]]);
    // a cold read of the same stretch in a fresh data directory gives the same records
    const c = createStillsHarness();
    try {
      const p2 = c.project('cold2'), a2 = await c.importFile(p2, file);
      const r = startStillsJob(c.store, c.gov, OWNER, p2, { assetId: a2, from: 10, to: 50 }, c.deps()) as { jobId: string };
      expect((await c.settle(r.jobId)).status).toBe('succeeded');
      expect(dataOf(c.store, c.derivatives, c.store.getProject(p2).doc.assets[a2]!.contentHash)!.data.measured).toEqual(after.measured);
    } finally { await c.close(); }
  });
  it('a data file of another ffmpeg build is a miss: measured again from nothing, never merged', async () => {
    const { pid, a } = await imported('miss', await freshMotion());
    await job(pid, { assetId: a, from: 0, to: 20 });
    const asset = assetOf(pid, a), d = dataOf(h.store, h.derivatives, asset.contentHash)!;
    const tmp = path.join(h.store.tmpDir, 'other-build.json');
    fs.writeFileSync(tmp, JSON.stringify({ ...d.data, ffmpeg: 'ffmpeg version 0.0-other' }));
    await h.derivatives.put(asset.contentHash, 'stills', tmp, 'application/json', { algo: STILLS_ALGO, longSide: STILLS_LONG_SIDE, ffmpeg: 'ffmpeg version 0.0-other', frames: 20 });
    fs.rmSync(tmp, { force: true });
    const g = await h.rest('GET', `/projects/${pid}/stills?assetId=${a}&from=0&to=20`, undefined, h.auth.tokens.observer);
    expect([g.status, g.body.measuredFrames, g.body.complete]).toEqual([200, 0, false]);
    const counter = countedReader();
    const r = await job(pid, { assetId: a, from: 5, to: 20 }, { readFrames: counter.read });
    expect(r.cached).toBe(false);
    expect(counter.asked().map((x) => [x.first, x.count])).toEqual([[4, 16]]);
    expect(dataOf(h.store, h.derivatives, asset.contentHash)!.data.reads).toHaveLength(1);
  });
  it('GET: a stretch partly measured lists its records, complete false and no candidates; the observer may read, not start', async () => {
    const { pid, a } = await imported('get', await freshMotion());
    await job(pid, { assetId: a, from: 20, to: 30 });
    const obs = h.auth.tokens.observer;
    const part = (await h.rest('GET', `/projects/${pid}/stills?assetId=${a}&from=15&to=30`, undefined, obs)).body as SharpAnswer;
    expect([part.measuredFrames, part.complete, part.median, part.candidates]).toEqual([10, false, null, []]);
    expect(part.frames.map((m) => m.frame)).toEqual(Array.from({ length: 10 }, (_, i) => 20 + i));
    const full = (await h.rest('GET', `/projects/${pid}/stills?assetId=${a}&from=20&to=30`, undefined, obs)).body as SharpAnswer;
    expect([full.complete, full.heuristic, full.candidates.length > 0]).toEqual([true, true, true]);
    expect((await h.rest('GET', `/projects/${pid}/stills?assetId=${a}&from=0&to=61`, undefined, obs)).body.error.code).toBe('out_of_bounds');
    expect((await h.rest('POST', `/projects/${pid}/stills`, { assetId: a, from: 0, to: 5 }, obs)).status).toBe(403);
  });
  it('MCP: numbers only (text parts), the same answer as REST', async () => {
    const { pid, a } = await imported('mcp', await freshMotion());
    const f = await h.tool('find_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 12 }, h.auth.tokens.agent);
    expect(f.isError, f.text).toBe(false);
    await h.settle(JSON.parse(f.text).jobId);
    const g = await h.tool('read_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 12 }, h.auth.tokens.observer);
    const again = await h.tool('find_sharp_frames', { projectId: pid, assetId: a, from: 0, to: 12 }, h.auth.tokens.agent);
    for (const r of [f, g, again]) expect(r.content.every((c) => c.type === 'text')).toBe(true);
    expect(JSON.parse(again.text).cached).toBe(true);
    expect(JSON.parse(again.text).answer).toEqual(JSON.parse(g.text));
  });
});

describe('what the numbers say (a heuristic within one clip)', () => {
  it('a 60 fps file in a 30 fps project: the clip\'s range counts every source frame', async () => {
    const { pid, a } = await imported('r60', F.r60);
    const clip = h.addClip(pid, a, 0, 30, T.rt(1, 1));
    const { answer } = await job(pid, { assetId: a, clipId: clip });
    expect([answer.from, answer.to, answer.frames.length]).toEqual([60, 119, 59]);
  });
  it('motion: frames moved and blurred along x rank below the static frame; their motion > 0, the static frame\'s 0', async () => {
    const { pid, a } = await imported('motion', F.motion);
    const { answer } = await job(pid, { assetId: a, from: 0, to: 60 });
    const f = (k: number) => answer.frames[k]!;
    for (const k of [31, 32, 33, 34, 35]) { expect(f(k).sharp).toBeLessThan(f(37).sharp); expect(f(k).motion).toBeGreaterThan(0); }
    expect(f(37).motion).toBe(0);
    expect(answer.candidates.map((c) => c.frame)).toEqual([30]); // the second static plateau ends at 59, 29 frames from 30 (< 1 s): «נמצאו 1»
  });
  it('the noisy dark clip: the raw Sobel would pick the grainy blurred frame; the noise-corrected measure picks the clean sharp one (numbers shown)', async () => {
    const { pid, a } = await imported('dark', F.dark);
    const { answer } = await job(pid, { assetId: a, from: 0, to: DARK.frames });
    const g = answer.frames[DARK.grainy]!, s = answer.frames[DARK.sharp]!, soft = answer.frames[5]!;
    console.info('stills noisy dark clip (synthetic, 480x270, read at its own size):', JSON.stringify({ grainy: g, sharp: s, soft, median: answer.median, candidates: answer.candidates.map((c) => [c.frame, c.sharp, c.sharpRatioPermille]) }));
    const naive = [...answer.frames].sort((x, y) => y.sobel - x.sobel || x.frame - y.frame)[0]!.frame;
    expect(naive).toBe(DARK.grainy);
    expect(answer.candidates[0]!.frame).toBe(DARK.sharp);
    expect(g.sigma100).toBeGreaterThan(540);
    expect(g.sigma100).toBeLessThan(660);
    expect(g.sobel).toBeGreaterThan(g.sharp);
  });
  it('an export running pauses the read (ffmpeg waits on the pipe) and the job finishes only after it', async () => {
    const { pid, a } = await imported('lane', await freshRamp());
    let n = 0;
    const slow = countedReader(10, () => { n++; });
    const r = startStillsJob(h.store, h.gov, OWNER, pid, { assetId: a, from: 0, to: 64 }, h.deps({ readFrames: slow.read })) as { jobId: string };
    while (n < 3) await sleep(5);
    h.lane.setExportActive(true);
    await sleep(100);
    const at = n;
    await sleep(600);
    expect(n - at).toBeLessThanOrEqual(1);
    expect(h.store.getJob(r.jobId).status).toBe('running');
    const ended = Date.now();
    h.lane.setExportActive(false);
    const j = await h.settle(r.jobId);
    expect(j.status).toBe('succeeded');
    expect(Date.parse(j.updatedAt)).toBeGreaterThanOrEqual(ended - 5);
  });
});
