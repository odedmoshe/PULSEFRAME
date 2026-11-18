/**
 * Segmented export (ADR-0024 §3–§5): the planner with a fake frame key, the run-length view, the exact track timescale, the encode
 * and join arguments, real two-segment encodes and joins with ffmpeg (exact frame count, constant frame rate, decoded frames equal
 * to the parts; 1–2 frame segments documented as not joinable), encoder determinism (a measurement), the self-check selection and
 * its rotation, and runSegmentedExport end to end with a FAKE render page (labelled: it feeds generated RGBA frames to the sink
 * the way apps/web/src/render.ts posts them) and a real store, real encoders and a real join.
 *
 * TEST STAND-IN (labelled): engine segmentFrames / segmentGrid / segmentKey are W1's and may still be stubs in this tree. The mock
 * below calls the real functions and falls back to a reference version of their contract ONLY while they throw 'not built yet';
 * once W1's bodies are merged the real ones run here.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RENDER_CACHE_JOB_ERRORS, MIN_SEGMENT_FRAMES, SEGMENT_SECONDS } from '@pulseframe/core';
import type * as Engine from '@pulseframe/engine';

vi.mock('@pulseframe/engine', async (importOriginal) => {
  const real = await importOriginal<typeof Engine>();
  const fallback = <A extends unknown[], R>(fn: (...a: A) => R, ref: (...a: A) => R) => (...a: A): R => {
    try { return fn(...a); } catch (e) { if (!/not built yet/.test(String((e as Error)?.message))) throw e; return ref(...a); }
  };
  const refFrames = (rate: { num: number; den: number }, seconds = SEGMENT_SECONDS) => Math.max(MIN_SEGMENT_FRAMES, Math.round((seconds * rate.num) / rate.den));
  const refGrid = (firstFrame: number, frames: number, S: number) => {
    const out: { index: number; first: number; frames: number }[] = [];
    for (let a = firstFrame, end = firstFrame + frames; a < end;) { const b = Math.min((Math.floor(a / S) + 1) * S, end); out.push({ index: Math.floor(a / S), first: a - firstFrame, frames: b - a }); a = b; }
    if (out.length > 1 && out[0]!.frames < MIN_SEGMENT_FRAMES) { const h = out.shift()!; out[0] = { index: h.index, first: h.first, frames: h.frames + out[0]!.frames }; }
    if (out.length > 1 && out[out.length - 1]!.frames < MIN_SEGMENT_FRAMES) { const t = out.pop()!; out[out.length - 1]!.frames += t.frames; }
    return out;
  };
  const refKey = (keys: readonly string[], params: unknown, digest: (t: string) => string) => digest(`pf-seg/1\n${JSON.stringify({ params, frames: keys })}`);
  return { ...real, segmentFrames: fallback(real.segmentFrames, refFrames), segmentGrid: fallback(real.segmentGrid, refGrid), segmentKey: fallback(real.segmentKey, refKey) };
});

const { FrameFlashCheck, reportFromCells } = await import('./flashCheck.ts');
const { flashCells, UnkeyableError } = await import('@pulseframe/engine');
const { SegmentStore, RENDER_CACHE_PURGED } = await import('./segmentStore.ts');
const Database = (await import('better-sqlite3')).default;
/** Rows of render_segment_projects that reference this project, read through a second connection to the store's index. */
const storeDirs = new WeakMap<object, string>();
function projectRefs(store: object, projectId: string): number {
  const db = new Database(path.join(storeDirs.get(store)!, 'index.sqlite'), { readonly: true });
  try { return (db.prepare('SELECT COUNT(*) AS n FROM render_segment_projects WHERE project_id = ?').get(projectId) as { n: number }).n; } finally { db.close(); }
}
const X = await import('./exportSegments.ts');
const { ApiError } = await import('./store.ts');
type Manifest = import('./export.ts').Manifest;
type SegmentSink = import('./export.ts').SegmentSink;

const exec = promisify(execFile);
const dirs: string[] = [];
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const openStores: InstanceType<typeof SegmentStore>[] = [];
afterAll(() => { for (const s of openStores) { try { s.close(); } catch { /* closed */ } } for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const LONG = 180_000;

const W = 64, H = 36;
/** A generated RGBA frame: a moving gradient, `v` changes the picture; programme frames 15–26 strobe black/white (flash check across a join at 20). */
function rgba(f: number, v = 0, strobe = true): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  const flash = strobe && f >= 15 && f < 27 ? (f % 2 ? 255 : 0) : null;
  for (let p = 0; p < W * H; p++) {
    const x = p % W, y = (p / W) | 0;
    px[p * 4] = flash ?? (x * 4 + f * 7 + v * 50) & 255;
    px[p * 4 + 1] = flash ?? (y * 7 + f * 3) & 255;
    px[p * 4 + 2] = flash ?? (x + y + f * 11 + v * 90) & 255;
    px[p * 4 + 3] = 255;
  }
  return px;
}
const concat = (parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function framemd5(file: string): Promise<string[]> {
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'], { maxBuffer: 64 << 20, timeout: LONG });
  return stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim());
}

function manifestOf(o: { frames: number; firstFrame?: number; rate?: { num: number; den: number }; quality?: 'draft' | 'standard' | 'high' }): Manifest {
  return {
    revision: 7,
    engine: {} as Manifest['engine'],
    options: { format: 'mp4-h264-aac', captions: 'burned', quality: o.quality ?? 'draft', scale: 1, mode: 'incremental' },
    output: { width: W, height: H, firstFrame: o.firstFrame ?? 0, frames: o.frames, frameRate: o.rate ?? { num: 10, den: 1 }, sampleRate: 48000 },
    assets: [], fonts: [], effects: [], transitions: [], audioEffects: [], estimate: { bytes: null, basis: 'test' },
  };
}
const ENGINE = { bundle: 'bundle-test', browser: 'fake|launch=test', schemaVersion: 2 };
const env = (threads = 2): import('./exportSegments.ts').SegmentEnv => ({ digest: (t) => sha(t), engine: ENGINE, encoderId: `enc-test-${threads}`, threads, gpu: null, assetHash: () => 'a', fontHash: () => 'f', effectVersion: () => 1 });
function newStore(over: Partial<import('./segmentStore.ts').SegmentStoreOptions> = {}) {
  const dir = path.join(tmp('pf-segx-'), 'render-cache');
  const s = new SegmentStore({ dir, capBytes: 1 << 30, autoClear: true, minFreeBytes: 0, quota: () => ({ quotaBytes: 0, otherBytes: 0 }), freeDiskBytes: () => 1e15, ...over });
  openStores.push(s);
  storeDirs.set(s, dir);
  return s;
}

describe('trackTimescale', () => {
  it('is exact for 30000/1001, 24000/1001, 25, 12.5 and 60 (k = smallest power of two with num·k >= 10000)', () => {
    expect(X.trackTimescale({ num: 30000, den: 1001 })).toEqual({ timescale: 30000, frameTicks: 1001 });
    expect(X.trackTimescale({ num: 24000, den: 1001 })).toEqual({ timescale: 24000, frameTicks: 1001 });
    expect(X.trackTimescale({ num: 25, den: 1 })).toEqual({ timescale: 12800, frameTicks: 512 });
    expect(X.trackTimescale({ num: 25, den: 2 })).toEqual({ timescale: 12800, frameTicks: 1024 });
    expect(X.trackTimescale({ num: 60, den: 1 })).toEqual({ timescale: 15360, frameTicks: 256 });
    for (const r of [{ num: 30000, den: 1001 }, { num: 24000, den: 1001 }, { num: 25, den: 1 }, { num: 25, den: 2 }, { num: 60, den: 1 }]) {
      const { timescale, frameTicks } = X.trackTimescale(r);
      expect(timescale * r.den).toBe(frameTicks * r.num); // frameTicks / timescale is exactly den / num seconds
    }
  });
});

describe('encode and join arguments', () => {
  it('a segment encode uses the single-pass filter, preset, CRF, GOP and scene-cut settings and colour tags, a keyframe on the tail pad, the start zone, and a cut', () => {
    const a = X.segmentEncodeArgs({ width: 640, height: 360, frameRate: { num: 30000, den: 1001 }, quality: 'high', segFrames: 60, threads: 4, outFile: '/w/seg.pad.mp4' });
    expect(a.join(' ')).toBe('-hide_banner -v error -y -f rawvideo -pix_fmt rgba -video_size 640x360 -framerate 30000/1001 -i pipe:0 '
      + '-vf scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p '
      + '-c:v libx264 -preset medium -crf 16 -profile:v high -threads 4 -force_key_frames expr:eq(n,60) -x264-params open-gop=0:zones=0,0,b=1.4 '
      + '-color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -video_track_timescale 30000 -bitexact -an -f mp4 /w/seg.pad.mp4');
    // no -g, -keyint_min or -sc_threshold: x264's defaults, as in the single pass (export.ts passes none of them either)
    expect(a).not.toEqual(expect.arrayContaining(['-g']));
    expect(a).not.toEqual(expect.arrayContaining(['-sc_threshold']));
    expect(X.segmentCutArgs({ padded: '/w/seg.pad.mp4', frames: 60, frameRate: { num: 30000, den: 1001 }, outFile: '/w/seg.mp4' }).join(' ')).toBe(
      '-hide_banner -v error -y -i /w/seg.pad.mp4 -map 0:v:0 -c copy -frames:v 60 -video_track_timescale 30000 -bitexact -f mp4 /w/seg.mp4');
    expect(X.paddedPath('/w/seg-000001.mp4')).toBe('/w/seg-000001.pad.mp4');
    expect(X.SEGMENT_TAIL_PAD).toBe(1);
    expect(X.segmentEncodeArgs({ width: 2, height: 2, frameRate: { num: 25, den: 1 }, quality: 'draft', segFrames: 50, threads: 1, outFile: 'o' })).toEqual(expect.arrayContaining(['veryfast', '28', '12800']));
  });

  it('the single pass sets no GOP or scene-cut option the segments would have to match (export.ts source)', () => {
    const src = fs.readFileSync(new URL('./export.ts', import.meta.url), 'utf8');
    for (const opt of ["'-g'", "'-keyint_min'", "'-sc_threshold'", "'-x264-params'", "'-force_key_frames'"]) expect(src).not.toContain(opt);
  });

  it('keeps the CRF table and preset rule equal to the single-pass export (export.ts holds them module-private)', () => {
    const src = fs.readFileSync(new URL('./export.ts', import.meta.url), 'utf8');
    const m = /'mp4-h264-aac': \{ draft: (\d+), standard: (\d+), high: (\d+) \}/.exec(src);
    expect(m && { draft: Number(m[1]), standard: Number(m[2]), high: Number(m[3]) }).toEqual(X.SEGMENT_CRF);
    expect(src).toContain("'-preset', options.quality === 'draft' ? 'veryfast' : 'medium'");
  });

  it('the join copies the video with setts on N·D, adds the WAV as AAC and moves the index to the front', () => {
    expect(X.joinArgs({ listFile: '/w/l.ffconcat', wav: '/w/a.wav', outFile: '/w/out.mp4', frameRate: { num: 30000, den: 1001 } }).join(' ')).toBe(
      '-hide_banner -v error -y -f concat -safe 0 -i /w/l.ffconcat -i /w/a.wav -map 0:v:0 -map 1:a:0 -c:v copy '
      + '-bsf:v setts=dts=STARTDTS+N*1001:pts=STARTDTS+N*1001+PTS-DTS:duration=1001 -video_track_timescale 30000 -c:a aac -b:a 192k -movflags +faststart -f mp4 /w/out.mp4');
    expect(X.concatList(['/a/b.mp4', "/x/it's.mp4"])).toBe("ffconcat version 1.0\nfile '/a/b.mp4'\nfile '/x/it'\\''s.mp4'\n");
  });

  it('cfrProblem accepts exactly N·D from 0 and names anything else', () => {
    expect(X.cfrProblem([0, 2002, 1001, 3003], 1001)).toBeNull();
    expect(X.cfrProblem([1001, 2002], 1001)).toMatch(/first PTS/);
    expect(X.cfrProblem([0, 1001, 3003], 1001)).toMatch(/1 PTS deltas/);
    expect(X.cfrProblem([], 1001)).toMatch(/no video/);
  });
});

/** Encodes parts of a generated programme as separate segments, joins them, and returns the facts the join must keep. */
async function encodeAndJoin(parts: number[], rate = { num: 30000, den: 1001 }, threads = 2) {
  const dir = tmp('pf-join-');
  const files: string[] = [];
  let f0 = 0;
  for (const [i, n] of parts.entries()) {
    const out = path.join(dir, `p${i}.mp4`);
    await X.encodeSegmentFile(Array.from({ length: n }, (_, k) => rgba(f0 + k, 0, false)), { width: W, height: H, frameRate: rate, quality: 'standard', threads, outFile: out });
    files.push(out);
    f0 += n;
  }
  const list = path.join(dir, 'l.ffconcat');
  fs.writeFileSync(list, X.concatList(files));
  const wav = path.join(dir, 'a.wav');
  X.silentWav(wav, 48000, Math.round((f0 * rate.den * 48000) / rate.num));
  const joined = path.join(dir, 'joined.mp4');
  await exec('ffmpeg', X.joinArgs({ listFile: list, wav, outFile: joined, frameRate: rate }), { timeout: LONG });
  const pts = await X.packetPts(joined);
  const partsMd5 = (await Promise.all(files.map(framemd5))).flat();
  return { total: f0, pts, joinedMd5: await framemd5(joined), partsMd5, offsets: await Promise.all(files.map(X.firstPacketOffset)), frameTicks: X.trackTimescale(rate).frameTicks, files };
}

describe('real encode and join (ffmpeg)', () => {
  it.each([[[60, 60]], [[3, 60, 3]], [[60, 62]], [[60, 60, 17]]])('segments %j join to the exact frame count, constant frame rate and the decoded frames of the parts', async (parts) => {
    const r = await encodeAndJoin(parts);
    expect(r.pts.length).toBe(r.total);
    expect(X.cfrProblem(r.pts, r.frameTicks)).toBeNull();
    expect(new Set(r.offsets).size).toBe(1);
    expect(r.joinedMd5).toEqual(r.partsMd5);
  }, LONG);

  it('also at 25 and 12.5 fps', async () => {
    for (const rate of [{ num: 25, den: 1 }, { num: 25, den: 2 }]) {
      const r = await encodeAndJoin([50, 7], rate);
      expect(r.pts.length).toBe(57);
      expect(X.cfrProblem(r.pts, r.frameTicks)).toBeNull();
      expect(r.joinedMd5).toEqual(r.partsMd5);
    }
  }, LONG);

  it('documents why no segment may be shorter than 3 frames: a 1-frame segment beside a 60-frame one does not join exactly (a 2-frame one does since the tail pad, measured; the grid keeps 3)', async () => {
    for (const parts of [[1, 60], [2, 60], [60, 1], [60, 2]]) {
      const r = await encodeAndJoin(parts);
      const exact = r.pts.length === r.total && X.cfrProblem(r.pts, r.frameTicks) === null && JSON.stringify(r.joinedMd5) === JSON.stringify(r.partsMd5);
      console.log(`[join] ${parts.join('+')}: first-packet offsets ${r.offsets.join(', ')}; ${r.pts.length} of ${r.total} packets; ${X.cfrProblem(r.pts, r.frameTicks) ?? 'exact'}`);
      if (parts.includes(1)) {
        expect(new Set(r.offsets).size).toBe(2); // the 1-frame segment is written with PTS = DTS: the export's ptsOffsetTicks check refuses it
        expect(exact).toBe(false);
      } else {
        // encoded as 3 frames (2 + the tail pad), the 2-frame segment gets the same B-frame delay and joins exactly
        expect(new Set(r.offsets).size).toBe(1);
        expect(exact).toBe(true);
      }
    }
  }, LONG);

  it('the same segment encoded twice is byte-identical at a fixed thread count (measurement)', async () => {
    const threads = 4;
    const dir = tmp('pf-det-');
    const frames = Array.from({ length: 60 }, (_, k) => rgba(k, 3, false));
    const o = { width: W, height: H, frameRate: { num: 30000, den: 1001 }, quality: 'high' as const, threads };
    await X.encodeSegmentFile(frames, { ...o, outFile: path.join(dir, 'a.mp4') });
    await X.encodeSegmentFile(frames, { ...o, outFile: path.join(dir, 'b.mp4') });
    const a = sha(fs.readFileSync(path.join(dir, 'a.mp4'))), b = sha(fs.readFileSync(path.join(dir, 'b.mp4')));
    const { stdout } = await exec('ffmpeg', ['-version']);
    console.log(`[determinism] ${stdout.split('\n')[0]}; 60 frames ${W}×${H}, -threads ${threads}: ${a === b ? 'byte-identical' : 'DIFFERENT'} (${a.slice(0, 16)} / ${b.slice(0, 16)})`);
    expect(a).toBe(b);
  }, LONG);

  it('a segment holds exactly its own frames (the tail pad is cut) and leaves no padded file', async () => {
    const dir = tmp('pf-cut-');
    const out = path.join(dir, 's.mp4');
    const frames = Array.from({ length: 17 }, (_, k) => rgba(k, 1, false));
    await X.encodeSegmentFile(frames, { width: W, height: H, frameRate: { num: 30, den: 1 }, quality: 'standard', threads: 2, outFile: out });
    expect((await X.packetPts(out)).length).toBe(17);
    expect((await framemd5(out)).length).toBe(17);
    expect(fs.readdirSync(dir)).toEqual(['s.mp4']);
  }, LONG);

  it('the frame before a join is coded at least as well as the middle of its segment (no end-of-stream quantiser climb; measurement)', async () => {
    // A textured picture with fresh grain every frame (lavfi mandelbrot + temporal noise, fixed seed): MB-tree matters, as on the
    // snow overlay of the proof's fixture A. Measured with the earlier settings (no tail pad): last frame 33.68 dB, frames 40–47 34.36 dB.
    const w = 320, h = 180, n = 60;
    const dir = tmp('pf-tail-');
    const raw = path.join(dir, 'src.rgba');
    await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `mandelbrot=s=${w}x${h}:r=30,noise=alls=20:allf=t:all_seed=7`, '-frames:v', String(n), '-pix_fmt', 'rgba', '-f', 'rawvideo', raw], { timeout: LONG });
    const all = fs.readFileSync(raw);
    const frames = Array.from({ length: n }, (_, f) => new Uint8Array(all.subarray(f * w * h * 4, (f + 1) * w * h * 4)));
    const out = path.join(dir, 's.mp4');
    await X.encodeSegmentFile(frames, { width: w, height: h, frameRate: { num: 30, den: 1 }, quality: 'standard', threads: 2, outFile: out });
    const r = await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${w}x${h}`, '-framerate', '30', '-i', raw, '-i', out,
      '-lavfi', '[0:v]scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p,settb=1/30,setpts=N[a];[1:v]settb=1/30,setpts=N[b];[a][b]psnr=stats_file=-', '-f', 'null', '-'], { maxBuffer: 64 << 20, timeout: LONG });
    const p = [...r.stdout.matchAll(/psnr_avg:(\S+)/g)].map((m) => Number(m[1]));
    expect(p.length).toBe(n);
    const meanDb = (xs: number[]) => -10 * Math.log10(xs.reduce((m, x) => m + 10 ** (-x / 10), 0) / xs.length);
    const middle = meanDb(p.slice(40, 48)), last = p[n - 1]!;
    console.log(`[tail] frames 40–47 ${middle.toFixed(2)} dB, last frame ${last.toFixed(2)} dB; last eight ${p.slice(n - 8).map((x) => x.toFixed(1)).join(' ')}`);
    expect(last).toBeGreaterThanOrEqual(middle);
  }, LONG);

  it('a hard cut inside a segment gets a keyframe, as in the single pass (scene-cut detection on)', async () => {
    const w = 320, h = 180;
    const dir = tmp('pf-cutscene-');
    const grab = async (src: string, file: string) => { await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', src, '-frames:v', '30', '-pix_fmt', 'rgba', '-f', 'rawvideo', file], { timeout: LONG }); const b = fs.readFileSync(file); return Array.from({ length: 30 }, (_, f) => new Uint8Array(b.subarray(f * w * h * 4, (f + 1) * w * h * 4))); };
    const frames = [...await grab(`mandelbrot=s=${w}x${h}:r=30`, path.join(dir, 'a.rgba')), ...await grab(`testsrc2=s=${w}x${h}:r=30`, path.join(dir, 'b.rgba'))];
    const out = path.join(dir, 's.mp4');
    await X.encodeSegmentFile(frames, { width: w, height: h, frameRate: { num: 30, den: 1 }, quality: 'standard', threads: 2, outFile: out });
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pict_type', '-of', 'csv=p=0', out], { timeout: LONG });
    const types = stdout.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean);
    expect(types.length).toBe(60);
    expect(types.flatMap((t, i) => (t === 'I' ? [i] : []))).toEqual([0, 30]);
    expect(types[29]).toBe('P'); // the frame before the cut's keyframe references nothing after it
  }, LONG);

  it('incrementalAvailable runs the two-segment self-test once per process and finds this ffmpeg able', async () => {
    const p = X.incrementalAvailable();
    expect(X.incrementalAvailable()).toBe(p);
    expect(await p).toEqual({ ok: true });
  }, LONG);
});

describe('planSegments and planView (fake frame key)', () => {
  it('marks segments cached, render or uncacheable with its code, yielding to the event loop after each segment', async () => {
    const store = newStore();
    const m = manifestOf({ frames: 61, firstFrame: 0 }); // 10 fps: cells of 20, the 1-frame tail merged: 20, 20, 21
    const keyOf = (f: number) => { if (f === 25) throw new UnkeyableError('unkeyable_value', 'layers[0].params.x'); return sha(`f${f}`); };
    let ticks = 0;
    const tick = () => { ticks++; if (ticks < 100) setImmediate(tick); };
    setImmediate(tick);
    const plan = await X.planSegments({} as never, m, env(), store, keyOf);
    expect(ticks).toBeGreaterThanOrEqual(2);
    expect(plan.segFrames).toBe(20);
    expect(plan.revision).toBe(7);
    expect(plan.segments.map((s) => [s.first, s.frames, s.state])).toEqual([[0, 20, 'render'], [20, 20, 'uncacheable'], [40, 21, 'render']]);
    expect(plan.segments[1]).toMatchObject({ key: null, uncacheable: 'unkeyable_value' });
    // Store the first under its key: the next plan finds it.
    const pin = store.pin([]);
    const file = path.join(tmp('pf-v-'), 'v.mp4'); fs.writeFileSync(file, 'video');
    await store.put(plan.segments[0]!.key!, { videoFile: file, frames: 20, width: W, height: H, rgbaSha256: Array(20).fill('x'), ptsOffsetTicks: 0, cells: Array.from({ length: 20 }, () => ({ cols: 1, rows: 1, rgb: new Float32Array(3) })), renderMs: 100, projectId: 'p' }, pin);
    const again = await X.planSegments({} as never, m, env(), store, keyOf);
    expect(again.segments.map((s) => s.state)).toEqual(['cached', 'uncacheable', 'render']);
    expect(again.segments[0]!.key).toBe(plan.segments[0]!.key);
    // A different encoder id (another thread count) keys every segment differently.
    const other = await X.planSegments({} as never, m, env(3), store, keyOf);
    expect(other.segments[0]!.state).toBe('render');
    const view = X.planView(again, m, store);
    expect(view).toMatchObject({ revision: 7, mode: 'incremental', segFrames: 20, firstFrame: 0, frames: 61, segments: { total: 3, cached: 1, render: 1, uncacheable: 1 }, framesToRender: 41, uncacheable: [{ code: 'unkeyable_value', segments: 1 }] });
    expect(view.runs).toEqual([{ state: 'cached', firstSegment: 0, segments: 1, firstFrame: 0, frames: 20 }, { state: 'uncacheable', firstSegment: 1, segments: 1, firstFrame: 20, frames: 20 }, { state: 'render', firstSegment: 2, segments: 1, firstFrame: 40, frames: 21 }]);
    expect(view.estimate.seconds).toBeNull(); // one measured segment is not history
    expect(view.cache.segments).toBe(1);
    pin.release();
  });

  it('keys the range by programme frame, merges runs, and stops on cancel; other errors are not swallowed', async () => {
    const store = newStore();
    const m = manifestOf({ frames: 50, firstFrame: 18 }); // [18, 68): 2-frame head merged, 20, 8 → 22, 20, 8
    const seen: number[] = [];
    const plan = await X.planSegments({} as never, m, env(), store, (f) => { seen.push(f); return sha(`f${f}`); });
    expect(seen[0]).toBe(18);
    expect(seen.length).toBe(50);
    expect(plan.segments.map((s) => [s.index, s.first, s.frames])).toEqual([[0, 0, 22], [2, 22, 20], [3, 42, 8]]);
    const view = X.planView(plan, m, store);
    expect(view.runs).toEqual([{ state: 'render', firstSegment: 0, segments: 3, firstFrame: 0, frames: 50 }]);
    let n = 0;
    await expect(X.planSegments({} as never, m, env(), store, (f) => sha(`f${f}`), () => ++n > 1)).rejects.toThrow('canceled');
    await expect(X.planSegments({} as never, m, env(), store, () => { throw new TypeError('boom'); })).rejects.toThrow('boom');
  });
});

describe('selectSelfCheck', () => {
  const segsOf = (R: number, S = 20) => Array.from({ length: R }, (_, i) => ({ index: i, first: i * S, frames: S, key: sha(`seg${i}`), state: 'cached' as const }));
  const digest = (t: string) => sha(t);

  it('every-segment: first, last and one seeded interior frame of every reused segment, in programme order', () => {
    const store = newStore();
    const segs = segsOf(5);
    const pick = X.selectSelfCheck(segs, store, 'every-segment', 'seed-a', digest);
    expect(pick.length).toBe(15);
    for (const s of segs) {
      const fr = pick.filter((p) => p.segment === s).map((p) => p.frame);
      expect(fr[0]).toBe(s.first);
      expect(fr[2]).toBe(s.first + s.frames - 1);
      expect(fr[1]).toBeGreaterThan(s.first);
      expect(fr[1]).toBeLessThan(s.first + s.frames - 1);
    }
    expect(pick.map((p) => p.frame)).toEqual([...pick.map((p) => p.frame)].sort((a, b) => a - b));
  });

  it('sample: n = R up to 8, else clamp(ceil(0.1 R), 8, 64), reproducible from its seed', () => {
    const store = newStore();
    expect([1, 8, 9, 80, 81, 200, 640, 641, 5000].map(X.sampleSize)).toEqual([1, 8, 8, 8, 9, 20, 64, 64, 64]);
    const segs = segsOf(30);
    const a = X.selectSelfCheck(segs, store, 'sample', 'seed-a', digest);
    expect(a.length).toBe(8);
    expect(X.selectSelfCheck(segs, store, 'sample', 'seed-a', digest)).toEqual(a);
    const b = X.selectSelfCheck(segs, store, 'sample', 'seed-b', digest);
    expect(b.map((p) => p.frame)).not.toEqual(a.map((p) => p.frame)); // same segments (none verified yet), other frames
    for (const p of a) { expect(p.frame).toBeGreaterThanOrEqual(p.segment.first); expect(p.frame).toBeLessThan(p.segment.first + p.segment.frames); }
  });

  it('its rotation covers every reused segment within ceil(R/n) rounds (least recently verified first)', async () => {
    let t = 1;
    const store = newStore({ now: () => t });
    const R = 100;
    const segs = segsOf(R, 3);
    const pin = store.pin([]);
    for (const s of segs) {
      const file = path.join(tmp('pf-v-'), 'v.mp4'); fs.writeFileSync(file, s.key);
      await store.put(s.key, { videoFile: file, frames: 3, width: W, height: H, rgbaSha256: ['a', 'b', 'c'], ptsOffsetTicks: 0, cells: Array.from({ length: 3 }, () => ({ cols: 1, rows: 1, rgb: new Float32Array(3) })), renderMs: 1, projectId: 'p' }, pin);
    }
    const n = X.sampleSize(R);
    const rounds = Math.ceil(R / n);
    const covered = new Set<string>();
    for (let r = 0; r < rounds; r++) {
      const pick = X.selectSelfCheck(segs, store, 'sample', `job:${r}`, digest);
      expect(pick.length).toBe(n);
      for (const p of pick) covered.add(p.segment.key!);
      t++;
      store.markVerified(pick.map((p) => p.segment.key!));
    }
    expect(covered.size).toBe(R);
    pin.release();
  });
});

// ---------- runSegmentedExport with a fake render page ----------
interface Programme { version: Map<number, number>; /** pixels drawn differently from what the key says (a planted keying bug) */ bug?: Map<number, number> }
function makeExport(o: { store: InstanceType<typeof SegmentStore>; frames: number; firstFrame?: number; prog: Programme; selfCheck?: 'sample' | 'every-segment'; canceledAfterFrames?: number; jobId?: string; tamperStream?: boolean; threads?: number; beforeBatch?: (pos: number) => Promise<void> | void }) {
  const work = tmp('pf-work-');
  const manifest = manifestOf({ frames: o.frames, firstFrame: o.firstFrame ?? 0 });
  const first = manifest.output.firstFrame;
  const processes: unknown[] = [];
  const stages: string[] = [];
  let delivered = 0;
  const drawn: number[] = [];
  const deps: import('./exportSegments.ts').SegmentedExportDeps = {
    doc: {} as never, manifest, projectId: 'prj_a', jobId: o.jobId ?? 'job_1', attempt: 1,
    env: env(o.threads), store: o.store, keyOf: (f) => sha(`frame ${f} v${o.prog.version.get(f) ?? 0}`), selfCheck: o.selfCheck ?? 'every-segment',
    workDir: work, outFile: path.join(work, 'out.mp4'),
    // FAKE render page (test only): draws the runs in order and posts up to 4 frames per request, like render.ts.
    async render(runs, sink: SegmentSink, onAbort) {
      let aborted = false;
      onAbort(() => { aborted = true; });
      const order = runs.flatMap((r) => Array.from({ length: r.count }, (_, k) => r.first + k));
      let pos = 0;
      while (pos < order.length) {
        if (aborted) throw new Error('render aborted');
        await o.beforeBatch?.(pos);
        if (aborted) throw new Error('render aborted');
        const batch = order.slice(pos, pos + 4).map((rel) => { drawn.push(rel); const f = first + rel; return rgba(f, o.prog.bug?.get(f) ?? o.prog.version.get(f) ?? 0); });
        try { await sink.accept(o.tamperStream && pos === 8 ? pos + 1 : pos, concat(batch)); } catch (e) { throw new Error(`frame upload failed: ${(e as Error).message}`); }
        pos += batch.length;
        delivered += batch.length;
      }
      return { stageMs: { fake: true } };
    },
    async mixAudio(wav) { X.silentWav(wav, 48000, Math.round((o.frames * 48000) / 10)); return { clips: 0, mixPeakDbfs: null, loudness: null, clipped: false }; },
    canceled: () => o.canceledAfterFrames !== undefined && delivered >= o.canceledAfterFrames,
    stage: (t) => stages.push(t),
    onProcess: (p) => processes.push(p),
  };
  return { deps, manifest, processes, stages, drawn, work };
}
const allFrames = (frames: number, prog: Programme, first = 0) => Array.from({ length: frames }, (_, k) => rgba(first + k, prog.version.get(first + k) ?? 0));

describe('runSegmentedExport (fake render page, real store, encoders and join)', () => {
  it('a first export renders and stores every segment; the flash report equals the single-pass report across the joins', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    const x = makeExport({ store, frames: 61, prog });
    const r = await X.runSegmentedExport(x.deps);
    expect(r.report).toMatchObject({ segFrames: 20, total: 3, reused: 0, rendered: 3, uncacheable: 0, corruptDropped: 0, notStored: 0, encoderId: 'enc-test-2', engine: ENGINE });
    expect(r.report.selfCheck).toMatchObject({ mode: 'every-segment', segmentsChecked: 0, framesChecked: 0, framesPerSegment: 3, mismatches: 0 });
    expect(r.report.selfCheck.seed).toBe(sha('job_1:1'));
    expect(r.validation).toMatchObject({ videoCodec: 'h264', audioCodec: 'aac', frames: 61, packets: 61, constantFrameRate: true, width: W, height: H });
    expect(store.status().segments).toBe(3);
    expect(store.cleanSelfChecks(ENGINE)).toBe(0); // nothing was checked, so it is not a clean self-check
    const single = new FrameFlashCheck(W, H, { num: 10, den: 1 });
    single.feed(concat(allFrames(61, prog)));
    expect(r.photosensitivity).toEqual(single.report(0));
    expect(r.photosensitivity?.verdict).toBe('fail'); // the strobe at 15–26 straddles the join at 20
    expect(x.stages).toEqual(expect.arrayContaining(['rendering audio', 'keying', 'joining', 'validating']));
  }, LONG);

  it('after a change in one segment, renders only that one, checks 3 frames of each reused one, and equals a clean export', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog }).deps);
    for (let f = 22; f < 24; f++) prog.version.set(f, 1); // a title in the second segment
    const x = makeExport({ store, frames: 61, prog, jobId: 'job_2' });
    const r = await X.runSegmentedExport(x.deps);
    expect(r.report).toMatchObject({ total: 3, reused: 2, rendered: 1, corruptDropped: 0 });
    expect(r.report.selfCheck).toMatchObject({ mode: 'every-segment', segmentsChecked: 2, framesChecked: 6, framesPerSegment: 3 });
    expect(x.drawn.slice(0, 6)).toEqual([0, expect.any(Number), 19, 40, expect.any(Number), 60]); // self-check frames first, programme order
    expect(x.drawn.slice(6)).toEqual(Array.from({ length: 20 }, (_, k) => 20 + k));
    expect(store.cleanSelfChecks(ENGINE)).toBe(1);
    // Clean segmented export of the same revision on an empty cache: same decoded frames (and the same video, the encoder being deterministic here).
    const clean = makeExport({ store: newStore(), frames: 61, prog, jobId: 'job_clean' });
    const c = await X.runSegmentedExport(clean.deps);
    expect(await framemd5(x.deps.outFile)).toEqual(await framemd5(clean.deps.outFile));
    expect(r.photosensitivity).toEqual(c.photosensitivity);
    // Sample mode reports one frame per checked segment.
    const s = await X.runSegmentedExport(makeExport({ store, frames: 61, prog, selfCheck: 'sample', jobId: 'job_3' }).deps);
    expect(s.report).toMatchObject({ reused: 3, rendered: 0 });
    expect(s.report.selfCheck).toMatchObject({ mode: 'sample', segmentsChecked: 3, framesChecked: 3, framesPerSegment: 1 });
  }, LONG);

  it('a self-check mismatch fails with render_cache_self_check_failed before any encoder starts, purges the reused entries and resets the counter', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog }).deps);
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog, jobId: 'job_ok' }).deps); // a clean self-check: counter 1
    expect(store.cleanSelfChecks(ENGINE)).toBe(1);
    prog.version.set(45, 1); // the third segment changed (to render)...
    const bug = new Map<number, number>([[0, 5], [19, 5]]); // ...and the first segment draws differently than its key says (a keying bug)
    const x = makeExport({ store, frames: 61, prog: { ...prog, bug }, jobId: 'job_bad' });
    let err: unknown;
    try { await X.runSegmentedExport(x.deps); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(ApiError);
    const e = err as InstanceType<typeof ApiError>;
    expect(e.code).toBe('render_cache_self_check_failed'); // rethrown as the typed error, not the page's "frame upload failed"
    expect(e.hint).toBe(RENDER_CACHE_JOB_ERRORS.selfCheckFailed.hint);
    expect(e.details).toMatchObject({ segment: { first: 0, frames: 20 }, frame: 0, purged: 2 });
    expect(e.message).toBe(RENDER_CACHE_JOB_ERRORS.selfCheckFailed.message(0, 20, 0, 2));
    expect(x.processes.filter(Boolean)).toEqual([]); // no encoder was started
    expect(x.drawn[0]).toBe(0);
    expect(x.drawn.length).toBe(4); // the page posts 4 frames a request; it was stopped after the first request (6 self-check frames + 20 to render were asked for)
    expect(store.status().segments).toBe(1); // only the two reused entries were purged; the old third segment (not used by this export) stays
    expect(store.cleanSelfChecks(ENGINE)).toBe(0);
    expect(fs.existsSync(x.deps.outFile)).toBe(false);
  }, LONG);

  it('a privacy purge part-way through stops the export with render_cache_purged; no segment it renders afterwards is stored or references the project', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    // Purge while the page is in the second of three 20-frame segments, once the first segment has been committed.
    let purged: { removed: number; bytes: number } | null = null;
    const x = makeExport({
      store, frames: 61, prog,
      async beforeBatch(pos) {
        if (pos !== 24) return;
        for (let i = 0; i < 600 && store.status().segments < 1; i++) await new Promise((r) => setTimeout(r, 25));
        expect(store.status().segments).toBe(1);
        purged = store.purgeProject('prj_a');
      },
    });
    let err: unknown;
    try { await X.runSegmentedExport(x.deps); } catch (e) { err = e; }
    expect(purged).toMatchObject({ removed: 1 });
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: RENDER_CACHE_PURGED.code, hint: RENDER_CACHE_PURGED.hint, details: { projectId: 'prj_a', retryable: false } });
    expect((err as Error).message).toBe(RENDER_CACHE_PURGED.message('prj_a'));
    expect(store.status().segments).toBe(0);
    expect(projectRefs(store, 'prj_a')).toBe(0);
    expect(fs.existsSync(x.deps.outFile)).toBe(false);
    // A new export (pinned after the purge) stores again.
    const r = await X.runSegmentedExport(makeExport({ store, frames: 61, prog, jobId: 'job_after' }).deps);
    expect(r.report).toMatchObject({ reused: 0, rendered: 3 });
    expect(store.status().segments).toBe(3);
  }, LONG);

  it('a purge with a revision fence refuses an export of an older snapshot (a retry), and one during reuse names the purge instead of a missing segment', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog }).deps); // revision 7, 3 segments stored
    // The privacy change committed as revision 8: a retry of the revision-7 snapshot is refused and stores nothing.
    store.purgeProject('prj_a', { revision: 8 });
    expect(store.status().segments).toBe(0);
    await expect(X.runSegmentedExport(makeExport({ store, frames: 61, prog, jobId: 'job_retry' }).deps)).rejects.toMatchObject({ code: RENDER_CACHE_PURGED.code });
    expect(store.status().segments).toBe(0);
    expect(projectRefs(store, 'prj_a')).toBe(0);
    // Reuse: a later snapshot stores 3 segments; the next export reuses them and a purge runs during its render.
    const later = (x: ReturnType<typeof makeExport>) => { x.manifest.revision = 9; return x; };
    await X.runSegmentedExport(later(makeExport({ store, frames: 61, prog, jobId: 'job_9' })).deps);
    // (a) every segment reused, the purge during the self-check: no put follows, so the cells read would have failed untyped.
    const y = later(makeExport({ store, frames: 61, prog, jobId: 'job_9a', beforeBatch: (pos) => { if (pos === 4) store.purgeProject('prj_a'); } }));
    await expect(X.runSegmentedExport(y.deps)).rejects.toMatchObject({ code: RENDER_CACHE_PURGED.code, hint: RENDER_CACHE_PURGED.hint });
    expect(store.status().segments).toBe(0);
    expect(projectRefs(store, 'prj_a')).toBe(0);
    expect(fs.existsSync(y.deps.outFile)).toBe(false);
    // (b) two reused and one to render, the purge while it renders: its put is refused.
    await X.runSegmentedExport(later(makeExport({ store, frames: 61, prog, jobId: 'job_9c' })).deps);
    prog.version.set(45, 1);
    const x = later(makeExport({ store, frames: 61, prog, jobId: 'job_9b', beforeBatch: (pos) => { if (pos === 8) store.purgeProject('prj_a'); } }));
    await expect(X.runSegmentedExport(x.deps)).rejects.toMatchObject({ code: RENDER_CACHE_PURGED.code });
    expect(x.drawn.length).toBeGreaterThan(8);
    expect(store.status().segments).toBe(0);
    expect(projectRefs(store, 'prj_a')).toBe(0);
    expect(fs.existsSync(x.deps.outFile)).toBe(false);
  }, LONG);

  it('the sink refuses out-of-order frames', async () => {
    const store = newStore();
    const x = makeExport({ store, frames: 30, prog: { version: new Map() }, tamperStream: true });
    await expect(X.runSegmentedExport(x.deps)).rejects.toThrow(/frame_out_of_order|expected frame 8 of the segmented stream, got 9/);
  }, LONG);

  it('a corrupt stored segment is dropped, counted and rendered again', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog }).deps);
    const plan = await X.planSegments({} as never, manifestOf({ frames: 61 }), env(), store, (f) => sha(`frame ${f} v0`));
    const h = await store.open(plan.segments[1]!.key!, { verify: false });
    const buf = fs.readFileSync(h!.videoPath); buf[buf.length - 10]! ^= 0xff; fs.writeFileSync(h!.videoPath, buf);
    const r = await X.runSegmentedExport(makeExport({ store, frames: 61, prog, jobId: 'job_2' }).deps);
    expect(r.report).toMatchObject({ reused: 2, rendered: 1, corruptDropped: 1 });
    expect(r.validation).toMatchObject({ frames: 61, constantFrameRate: true });
  }, LONG);

  it('a stored segment with another packet timing fails as segment_join_mismatch before rendering', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 61, prog }).deps);
    const plan = await X.planSegments({} as never, manifestOf({ frames: 61 }), env(), store, (f) => sha(`frame ${f} v0`));
    const key = plan.segments[2]!.key!;
    const h = (await store.open(key, { verify: true }))!;
    const cells = await store.readCells(key);
    const copy = path.join(tmp('pf-v-'), 'v.mp4'); fs.copyFileSync(h.videoPath, copy);
    store.drop([key]);
    const pin = store.pin([]);
    await store.put(key, { videoFile: copy, frames: h.meta.frames, width: W, height: H, rgbaSha256: h.meta.rgbaSha256, ptsOffsetTicks: h.meta.ptsOffsetTicks + 1, cells, renderMs: 1, projectId: 'prj_a' }, pin);
    pin.release();
    const x = makeExport({ store, frames: 61, prog, jobId: 'job_2' });
    await expect(X.runSegmentedExport(x.deps)).rejects.toMatchObject({ code: 'segment_join_mismatch', hint: RENDER_CACHE_JOB_ERRORS.joinMismatch.hint });
    expect(x.drawn).toEqual([]);
  }, LONG);

  it('when the store has no room, segments are joined from the work directory and counted in notStored', async () => {
    const store = newStore({ capBytes: 100 });
    const prog: Programme = { version: new Map() };
    const x = makeExport({ store, frames: 61, prog });
    const r = await X.runSegmentedExport(x.deps);
    expect(r.report).toMatchObject({ rendered: 3, notStored: 3, cacheBytesAfter: 0 });
    expect(r.validation).toMatchObject({ frames: 61, constantFrameRate: true });
    expect(store.status().segments).toBe(0);
    const single = new FrameFlashCheck(W, H, { num: 10, den: 1 });
    single.feed(concat(allFrames(61, prog)));
    expect(r.photosensitivity).toEqual(single.report(0));
  }, LONG);

  it('507 storage_quota_exceeded only when the joined file itself cannot fit under the ceiling', async () => {
    const store = newStore({ quota: () => ({ quotaBytes: 1000, otherBytes: 0 }) });
    const x = makeExport({ store, frames: 30, prog: { version: new Map() } });
    await expect(X.runSegmentedExport(x.deps)).rejects.toMatchObject({ status: 507, code: 'storage_quota_exceeded' });
    expect(fs.existsSync(x.deps.outFile)).toBe(false);
  }, LONG);

  it('a range export off the grid shares the interior segments of the full export', async () => {
    const store = newStore();
    const prog: Programme = { version: new Map() };
    await X.runSegmentedExport(makeExport({ store, frames: 100, prog }).deps); // 20 × 5
    const x = makeExport({ store, frames: 59, firstFrame: 19, prog, jobId: 'job_r' }); // [19, 78): 1+20+20+18 → 21, 20, 18
    const r = await X.runSegmentedExport(x.deps);
    expect(r.report).toMatchObject({ total: 3, reused: 1, rendered: 2 });
    expect(r.validation).toMatchObject({ frames: 59, constantFrameRate: true });
    expect(r.photosensitivity).toEqual(reportFromCells(allFrames(59, prog, 19).map((f) => flashCells(f, W, H)), { num: 10, den: 1 }, 19));
  }, LONG);

  it('cancel stops the export with Error("canceled") and keeps the segments already committed', async () => {
    const store = newStore();
    const x = makeExport({ store, frames: 61, prog: { version: new Map() }, canceledAfterFrames: 44 });
    await expect(X.runSegmentedExport(x.deps)).rejects.toThrow('canceled');
    expect(store.status().segments).toBeGreaterThanOrEqual(1);
    const r = await X.runSegmentedExport(makeExport({ store, frames: 61, prog: { version: new Map() }, jobId: 'job_retry' }).deps);
    expect(r.report.reused).toBeGreaterThanOrEqual(1);
    expect(r.validation).toMatchObject({ frames: 61, constantFrameRate: true });
  }, LONG);
});
