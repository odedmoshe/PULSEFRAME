/**
 * Motion tracking end to end (ADR-0015), on the synthetic tracking fixture (packages/fixtures TRACKING_FIXTURE: a textured disc
 * on a noise background, an occluder, a look-alike; no real face or person anywhere). Gates P1–P12 of the tracking plan are
 * checked; P13 is recorded only.
 *   P1  the frame reader's index equals the frame barcode on every frame: proxy, original, a file whose picture starts late;
 *   P2  accuracy on usable frames (median ≤ 1 px, p95 ≤ 3 px; size median ≤ 5 %);
 *   P3  occlusion: ≥ 90 % of frames 150–169 weak or lost, no usable sample > 8 px off, re-acquired by frame 175;
 *   P4  the look-alike: no usable sample within 100 px of it;
 *   P5  two runs give the same SHA-256 of the sample arrays;
 *   P6  cancel: canceled within 2 s, no ffmpeg left, the revision unchanged;
 *   P7  a magenta sticker that follows the disc, on stills (median ≤ 2 px, max ≤ 5 px from the truth projected here); the
 *       export agrees with the stills within 2 px, the editor preview too;
 *   P8  the same at speed ½ (held pairs identical), speed 2, reversed, slipped, split, with stutter, and in a 9:16 cover format;
 *   P9  blur: the disc's |Laplacian| energy drops ≥ 80 %; outside the padded box the picture is byte-identical; full cover is
 *       the exact colour; on occluded frames the whole picture's energy drops ≥ 60 %;
 *   P10 echo on a redacted clip: each ghost's energy drops ≥ 80 % (flat-background variant, the region on hand-placed samples);
 *   P11 FlashAnalyser passes the loss fallback at speed 1 and speed 4;
 *   P12 preflight ranges equal the lost and weak runs mapped to the timeline (speed 1 and 2);
 *   P13 recorded only: tracking frames/s, frames decoded, event-loop lag p99 (budget 100 ms), commit p95 at 43,200 samples (budget +15 ms).
 * The truth is the fixture's own formulas; positions are projected through the document's fit and transform written out here
 * (never through core geometry). Stills come from render_frame, the export is an mp4 decoded with ffmpeg.
 * Evidence: docs/evidence/tracking-proof.json.
 *   pnpm build && pnpm proof:tracking
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { generateTrackingFixture, readBarcode, TRACKING_FIXTURE, trackingTruth } from '@pulseframe/fixtures';
import { FlashAnalyser, flashCells } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import type { FrameSource, GreyFrame, ReadFrames } from '../../../apps/server/src/vision/types.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/tracking-proof');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const measurements: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const FX = TRACKING_FIXTURE, SW = FX.width, SH = FX.height, N = FX.frames;
/** Stored state codes (core ST): usable = tracked, manual, interpolated, reacquired. */
const USABLE = new Set([1, 4, 5, 6]);
const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
const pct = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const r2 = (v: number) => Number(v.toFixed(2));

/** Where a point of the fixture's picture (source px) lands in a W×H frame: fitted (contain or cover) and centred, moved by the clip's x, y (fractions of the frame), scaled about its centre. No rotation in this proof. */
function project(W: number, H: number, fit: 'contain' | 'cover', sx: number, sy: number, t = { x: 0, y: 0, scale: 1 }) {
  const k = fit === 'cover' ? Math.max(W / SW, H / SH) : Math.min(W / SW, H / SH);
  return { x: W / 2 + t.x * W + (sx - SW / 2) * k * t.scale, y: H / 2 + t.y * H + (sy - SH / 2) * k * t.scale };
}
interface Rgb { w: number; h: number; rgb: Buffer }
const decodePng = (png: Buffer): Rgb => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
/** Centre of the magenta pixels (the sticker), in frame px (pixel centres at x + 0.5). */
function magenta(p: Rgb): { x: number; y: number; n: number } | null {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0, i = 0; y < p.h; y++) for (let x = 0; x < p.w; x++, i += 3) if (p.rgb[i]! > 150 && p.rgb[i + 2]! > 150 && p.rgb[i + 1]! < 110) { n++; sx += x + 0.5; sy += y + 0.5; }
  return n ? { x: sx / n, y: sy / n, n } : null;
}
/** Mean |Laplacian| of the luminance over the pixels for which `inside` holds, scanned within a bounding box. */
function lapEnergy(p: Rgb, box: { x0: number; y0: number; x1: number; y1: number }, inside: (x: number, y: number) => boolean): number {
  const L = (x: number, y: number) => { const i = (y * p.w + x) * 3; return 0.299 * p.rgb[i]! + 0.587 * p.rgb[i + 1]! + 0.114 * p.rgb[i + 2]!; };
  let s = 0, n = 0;
  for (let y = Math.max(1, Math.floor(box.y0)); y <= Math.min(p.h - 2, Math.ceil(box.y1)); y++)
    for (let x = Math.max(1, Math.floor(box.x0)); x <= Math.min(p.w - 2, Math.ceil(box.x1)); x++)
      if (inside(x + 0.5, y + 0.5)) { s += Math.abs(4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1)); n++; }
  return n ? s / n : 0;
}
const circleEnergy = (p: Rgb, cx: number, cy: number, r: number, not: { cx: number; cy: number; r: number }[] = []) =>
  lapEnergy(p, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, (x, y) => Math.hypot(x - cx, y - cy) <= r && not.every((o) => Math.hypot(x - o.cx, y - o.cy) > o.r));
const frameBarcode = (p: Rgb) => readBarcode(p.rgb, p.w, 3, { x: 0, y: 0, w: p.w, h: p.h });

/**
 * The closing filter of the loss fallback, written out from the contract (core tracking.ts lossFlags): bad = unknown | lost
 * (| weak when weakIsLost); every bad frame is widened by H = ceil(fps/3) source frames each way; then good runs shorter than
 * H + 1 that have bad on both sides (the ends of the track count as bad: outside the track is bad) are filled.
 */
function closing(st: readonly number[], fps: number, weakIsLost: boolean): Uint8Array {
  const H = Math.max(1, Math.ceil(fps / 3 - 1e-9)), n = st.length, bad = (s: number) => s === 0 || s === 3 || (weakIsLost && s === 2);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (bad(st[i]!)) for (let j = Math.max(0, i - H); j <= Math.min(n - 1, i + H); j++) out[j] = 1;
  for (let i = 0; i < n;) { if (out[i]) { i++; continue; } let j = i; while (j < n && !out[j]) j++; if (j - i < H + 1) out.fill(1, i, j); i = j; }
  return out;
}
/** Frames listed by preflight issues of a code, as a sorted list. */
const issueFrames = (issues: any[], code: string) => [...new Set(issues.filter((x) => x.code === code && x.range).flatMap((x) => Array.from({ length: x.range.endFrame - x.range.startFrame }, (_, k) => x.range.startFrame + k)))].sort((a, b) => a - b);
const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const runsOf = (frames: number[]) => { const out: [number, number][] = []; for (const x of frames) { const l = out.at(-1); if (l && l[1] === x) l[1] = x + 1; else out.push([x, x + 1]); } return out; };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const fixture = await generateTrackingFixture({ out: path.join(art, 'tracking.mp4') });
  const flat = await generateTrackingFixture({ out: path.join(art, 'tracking-flat.mp4'), background: 'flat' });
  const late = path.join(art, 'tracking-late.mp4');
  ff(['-y', '-itsoffset', '0.5', '-i', fixture.file, '-i', fixture.file, '-map', '0:v', '-map', '1:a', '-c', 'copy', late]);
  const sticker = path.join(art, 'sticker.png');
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xff00ff:s=32x32', '-frames:v', '1', sticker]);
  const long = path.join(art, 'long-6min.mp4');
  ff(['-y', '-f', 'lavfi', '-i', 'testsrc2=s=64x36:r=30', '-t', '360', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', long]);
  const dataDir = path.join(art, 'data');
  const s = await startServer({ port: 8833, dataDir });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const get = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: any; revision: number };
  const waitJob = async (id: string, ms = 600_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(100); } };
  const waitProxy = async (pid: string, assetId: string) => { for (let i = 0; i < 1200; i++) { const d = (await call(`/projects/${pid}/assets/${assetId}/derivatives`)).body; const p = d.derivatives?.find((x: any) => x.kind === 'proxy'); if (p?.status === 'ready') return true; if (p?.status === 'failed') return false; await sleep(250); } return false; };
  const still = async (pid: string, index: number, variant?: string) => { const r = await call(`/projects/${pid}/frame?index=${index}${variant ? `&variant=${variant}` : ''}`); if (r.status !== 200) throw new Error(`still ${index} failed: ${JSON.stringify(r.body).slice(0, 300)}`); return decodePng(r.body as Buffer); };
  let exports = 0;
  const exportFile = async (pid: string, body: Record<string, unknown> = {}) => {
    const st = await call(`/projects/${pid}/exports`, body);
    if (st.status !== 202) throw new Error(`export refused: ${JSON.stringify(st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `export-${++exports}.mp4`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return { file, job };
  };
  const clipsOf = (d: any, kind: string) => d.sequences[d.mainSequenceId].tracks.filter((t: any) => t.kind === kind).flatMap((t: any) => t.clips);
  const browser = await chromium.launch();
  try {
    // ---------- the main project: the fixture on V1, from timeline frame 0 ----------
    const pid = (await call('/projects', { name: 'tracking', width: SW, height: SH })).body.project.id as string;
    const up = await upload(pid, fixture.file);
    const assetId = up.assetId as string;
    const added = await txs(pid, [{ op: 'add_clip', args: { assetId, start: f(0), withLinkedAudio: false } }]);
    const v1 = added.results[0].output.clipId as string, v1Track = added.results[0].output.trackId as string;
    const proxyReady = await waitProxy(pid, assetId);

    console.log('\n# P1 the frame reader: output frame k shows barcode k (proxy, original, a picture that starts late)');
    {
      const readerModule: string = '../../../apps/server/src/tracking.ts'; // the job's own reader (no second implementation here)
      const { readFrames } = (await import(readerModule)) as { readFrames: ReadFrames };
      const probe = (file: string) => { const v = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams[0]; return { width: v.width as number, height: v.height as number, frames: Number(v.nb_read_frames) }; };
      const proxyFile = path.join(art, 'proxy.mp4');
      if (proxyReady) fs.writeFileSync(proxyFile, (await call(`/projects/${pid}/assets/${assetId}/derivatives/proxy`)).body);
      const rows: Record<string, unknown>[] = [];
      for (const [kind, file] of [['original', fixture.file], ['proxy', proxyFile], ['late-start', late]] as const) {
        if (!fs.existsSync(file)) { rows.push({ kind, error: 'file missing (proxy not ready)' }); continue; }
        const p = probe(file);
        const src: FrameSource = { file, kind: kind === 'proxy' ? 'proxy' : 'original', blobHash: kind, width: p.width, height: p.height, frameCount: p.frames, rate: R };
        const wrong: { index: number; barcode: number }[] = [];
        let seen = 0;
        const out = await readFrames(src, 0, p.frames, 360, (index: number, g: GreyFrame) => { seen++; const b = readBarcode(g.data, g.width, 1, { x: 0, y: 0, w: g.width, h: g.height }); if (b !== index) wrong.push({ index, barcode: b }); }, new AbortController().signal);
        // a window that starts later: output frame 0 must be source frame 17
        const win: number[] = [];
        await readFrames(src, 17, 40, 360, (index: number, g: GreyFrame) => { win.push(readBarcode(g.data, g.width, 1, { x: 0, y: 0, w: g.width, h: g.height }) - index); }, new AbortController().signal);
        rows.push({ kind, frames: p.frames, read: out.frames, seen, wrong: wrong.length, firstWrong: wrong.slice(0, 4), window17to40Ok: win.length === 23 && win.every((d) => d === 0), digest: out.digest.slice(0, 16) });
      }
      check('P1 the reader\'s frame index equals the frame barcode on 100% of frames of the original, the proxy and a file whose picture starts 0.5 s late (also for a window 17..40)', rows.length === 3 && rows.every((r: any) => !r.error && r.frames === N && r.read === N && r.seen === N && r.wrong === 0 && r.window17to40Ok), rows);
    }

    console.log('\n# P2–P4 tracking the disc (a box around it on frame 0)');
    const t0 = trackingTruth(0);
    const seed = { assetId, kind: 'region', frame: 0, x: Math.round((t0.cx / SW) * 1e4), y: Math.round((t0.cy / SH) * 1e4), w: Math.round(((2 * t0.r) / SW) * 1e4), h: Math.round(((2 * t0.r) / SH) * 1e4) };
    const trackA = (await txs(pid, [{ op: 'create_motion_track', args: { ...seed, name: 'Disc A' } }])).results[0].output.motionTrackId as string;
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const runA = await call(`/projects/${pid}/motion-tracks/${trackA}/track`, {});
    const jobA = runA.status === 202 ? await waitJob(runA.body.jobId) : { status: 'refused', error: runA.body };
    lag.disable();
    measurements.trackingJob = { status: jobA.status, output: jobA.output ?? null, error: jobA.error ?? null };
    let d = (await get(pid)).project;
    const A = d.motionTracks?.[trackA];
    const at = (t: any, frame: number) => { const i = frame - t.from; return i >= 0 && i < t.st.length ? { x: (t.x[i] / 1e4) * SW, y: (t.y[i] / 1e4) * SH, s: t.s ? t.s[i] / 1000 : 1, q: t.q[i], st: t.st[i] as number } : null; };
    const usableAt = (t: any, frame: number) => { const v = at(t, frame); return !!v && USABLE.has(v.st); };
    if (jobA.status !== 'succeeded' || !A) {
      check('P2 the tracking job finished and attached its samples', false, measurements.trackingJob);
    } else {
      const errs: number[] = [], sizeErrs: number[] = [], usableFrames: number[] = [];
      let worstUsable = 0;
      for (let fr = 0; fr < N; fr++) {
        const v = at(A, fr);
        if (!v || !USABLE.has(v.st)) continue;
        const tr = trackingTruth(fr);
        const e = Math.hypot(v.x - tr.cx, v.y - tr.cy);
        worstUsable = Math.max(worstUsable, e);
        if (tr.occluded) continue;
        usableFrames.push(fr);
        errs.push(e);
        sizeErrs.push(Math.abs(t0.r * v.s - tr.r) / tr.r);
      }
      const p2 = { usable: usableFrames.length, medianPx: r2(median(errs)), p95Px: r2(pct(errs, 95)), maxPx: r2(Math.max(...errs)), sizeMedian: Number(median(sizeErrs).toFixed(4)), counts: jobA.output?.counts };
      measurements.P2 = p2;
      check('P2 accuracy on usable frames: median error ≤ 1.0 px, p95 ≤ 3.0 px; size error median ≤ 5%', usableFrames.length >= 150 && p2.medianPx <= 1 && p2.p95Px <= 3 && p2.sizeMedian <= 0.05, p2);
      const occ = Array.from({ length: 20 }, (_, k) => FX.occluded.from + k);
      const weakOrLost = occ.filter((fr) => { const v = at(A, fr); return !!v && (v.st === 2 || v.st === 3); }).length;
      const back = Array.from({ length: N - FX.occluded.to - 1 }, (_, k) => FX.occluded.to + 1 + k).find((fr) => usableAt(A, fr)) ?? null;
      check('P3 occlusion: at least 90% of frames 150–169 are weak or lost; no usable sample anywhere is more than 8 px off; re-acquired by frame 175', weakOrLost >= 18 && worstUsable <= 8 && back !== null && back <= 175, { weakOrLost, of: 20, worstUsablePx: r2(worstUsable), firstUsableAfter: back, stateThere: back !== null ? at(A, back)?.st : null });
      const nearDecoy = Array.from({ length: N }, (_, fr) => fr).filter((fr) => { const v = at(A, fr); return !!v && USABLE.has(v.st) && Math.hypot(v.x - FX.decoy.cx, v.y - FX.decoy.cy) < 100; });
      check('P4 the look-alike: no usable sample within 100 px of it', nearDecoy.length === 0, { nearDecoy: nearDecoy.slice(0, 8) });
    }

    console.log('\n# P5 the same seed tracked again gives the same arrays');
    {
      const trackB = (await txs(pid, [{ op: 'create_motion_track', args: { ...seed, name: 'Disc B' } }])).results[0].output.motionTrackId as string;
      const runB = await call(`/projects/${pid}/motion-tracks/${trackB}/track`, {});
      const jobB = runB.status === 202 ? await waitJob(runB.body.jobId) : { status: 'refused' };
      d = (await get(pid)).project;
      const sha = (t: any) => (t ? createHash('sha256').update(JSON.stringify({ from: t.from, x: t.x, y: t.y, s: t.s, q: t.q, st: t.st })).digest('hex') : null);
      const a = sha(d.motionTracks?.[trackA]), b = sha(d.motionTracks?.[trackB]);
      check('P5 two runs on the same seed give the same SHA-256 of the sample arrays', jobB.status === 'succeeded' && !!a && a === b, { a, b, job: jobB.status });
      await txs(pid, [{ op: 'remove_motion_track', args: { motionTrackId: trackB } }]);
    }

    console.log('\n# P6 cancel while tracking');
    {
      const trackC = (await txs(pid, [{ op: 'create_motion_track', args: { ...seed, name: 'Disc C' } }])).results[0].output.motionTrackId as string;
      const before = (await get(pid)).revision;
      const runC = await call(`/projects/${pid}/motion-tracks/${trackC}/track`, { input: 'original' });
      let stage: string | null = null, status = 'queued';
      for (let i = 0; i < 3000 && runC.status === 202; i++) { const j = (await call(`/jobs/${runC.body.jobId}`)).body; stage = j.stage; status = j.status; if (['running', 'succeeded', 'failed', 'canceled'].includes(j.status)) break; await sleep(15); }
      const tCancel = Date.now();
      const cancel = await call(`/jobs/${runC.body.jobId}/cancel`, {});
      let end: any = null;
      for (;;) { end = (await call(`/jobs/${runC.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(end.status) || Date.now() - tCancel > 10_000) break; await sleep(20); }
      const ms = Date.now() - tCancel;
      await sleep(250);
      const ours = execFileSync('ps', ['-eo', 'args'], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('ffmpeg') && l.includes(dataDir));
      const after = (await get(pid)).revision;
      const C = (await get(pid)).project.motionTracks?.[trackC];
      check('P6 cancel: a running tracking job ends canceled within 2 s, no ffmpeg of this server is left, the revision is unchanged and the track still holds only its seed', status === 'running' && cancel.status === 200 && end.status === 'canceled' && ms <= 2000 && ours.length === 0 && after === before && C?.st.length === 1, { stageWhenCanceled: stage, cancel: cancel.body, status: end.status, ms, ffmpegLeft: ours.length, revision: [before, after], samples: C?.st.length });
      await txs(pid, [{ op: 'remove_motion_track', args: { motionTrackId: trackC } }]);
    }

    console.log('\n# P7 a magenta sticker follows the disc: stills, export, editor preview');
    const stickerAsset = (await upload(pid, sticker)).assetId as string;
    const st = await txs(pid, [{ op: 'add_clip', args: { assetId: stickerAsset, start: f(0), duration: f(N) } }]);
    const stickerClip = st.results[0].output.clipId as string, stickerTrack = st.results[0].output.trackId as string;
    await txs(pid, [{ op: 'set_clip_transform', args: { clipId: stickerClip, transform: { scale: 0.04 } } }, { op: 'set_clip_follow', args: { clipId: stickerClip, follow: { motionTrackId: trackA, targetTrackId: v1Track, scale: false, smooth: 0 }, offset: { x: 0, y: 0 } } }]);
    d = (await get(pid)).project;
    const tA = d.motionTracks?.[trackA];
    /** Stills of the given timeline frames: the sticker's centre against the truth of the source frame the barcode names. */
    const measure = async (frames: number[], o: { variant?: string; W?: number; H?: number; fit?: 'contain' | 'cover'; sourceOf?: (frame: number) => Promise<number> } = {}) => {
      const W = o.W ?? SW, H = o.H ?? SH, fit = o.fit ?? 'contain';
      const rows: { frame: number; source: number; err: number; at: { x: number; y: number } | null }[] = [];
      for (const fr of frames) {
        const p = await still(pid, fr, o.variant);
        const source = o.sourceOf ? await o.sourceOf(fr) : frameBarcode(p);
        if (!tA || !usableAt(tA, source) || trackingTruth(source).occluded) continue;
        const want = project(W, H, fit, trackingTruth(source).cx, trackingTruth(source).cy);
        if (want.x < 30 || want.y < 30 || want.x > W - 30 || want.y > H - 30) continue; // off the visible frame in a cropped format
        const m = magenta(p);
        rows.push({ frame: fr, source, err: m ? Math.hypot(m.x - want.x, m.y - want.y) : Infinity, at: m && { x: r2(m.x), y: r2(m.y) } });
      }
      const errs = rows.map((r) => r.err);
      return { rows, n: rows.length, medianPx: r2(median(errs)), maxPx: r2(Math.max(...errs)) };
    };
    const sampleFrames = Array.from({ length: 30 }, (_, k) => k * 8);
    const p7 = await measure(sampleFrames);
    measurements.P7 = { n: p7.n, medianPx: p7.medianPx, maxPx: p7.maxPx };
    check('P7 the sticker that follows the disc, on stills: centroid median ≤ 2 px and max ≤ 5 px from the truth projected independently (usable frames)', p7.n >= 15 && p7.medianPx <= 2 && p7.maxPx <= 5, { ...measurements.P7 as object, worst: [...p7.rows].sort((a, b) => b.err - a.err).slice(0, 3) });
    {
      const { file } = await exportFile(pid);
      const pick = p7.rows.map((r) => r.frame);
      const raw = pick.length === 0 ? Buffer.alloc(0) : ff(['-i', file, '-vf', `select='${pick.map((n) => `eq(n\\,${n})`).join('+')}'`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const fb = SW * SH * 3, diffs: { frame: number; px: number }[] = [];
      pick.forEach((fr, k) => { if ((k + 1) * fb > raw.length) { diffs.push({ frame: fr, px: Infinity }); return; } const m = magenta({ w: SW, h: SH, rgb: raw.subarray(k * fb, (k + 1) * fb) }); const sRow = p7.rows[k]!; diffs.push({ frame: fr, px: m && sRow.at ? r2(Math.hypot(m.x - sRow.at.x, m.y - sRow.at.y)) : Infinity }); });
      check('P7 the export (mp4 decoded with ffmpeg) puts the sticker where the stills do, within 2 px', diffs.length === pick.length && diffs.length > 0 && diffs.every((x) => x.px <= 2), { frames: diffs.length, maxPx: Math.max(...diffs.map((x) => x.px)), worst: [...diffs].sort((a, b) => b.px - a.px).slice(0, 3) });
    }
    {
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' })).newPage();
      await page.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor();
      const diffs: { frame: number; px: number }[] = [];
      for (const r of p7.rows.filter((_, k) => k % 3 === 0)) {
        await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const b = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + x, clientY: b.top + 5, bubbles: true })); }, (r.frame / 30) * 90 + 0.5);
        await page.waitForFunction((t) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(t) && c?.dataset.quality === 'full'; }, r.frame, { timeout: 15000 }).catch(() => {});
        const m = await page.evaluate(() => {
          const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
          const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let n = 0, sx = 0, sy = 0;
          for (let y = 0, i = 0; y < c.height; y++) for (let x = 0; x < c.width; x++, i += 4) if (px[i]! > 150 && px[i + 2]! > 150 && px[i + 1]! < 110) { n++; sx += x + 0.5; sy += y + 0.5; }
          return n ? { x: (sx / n) * (1280 / c.width), y: (sy / n) * (720 / c.height) } : null;
        });
        diffs.push({ frame: r.frame, px: m && r.at ? r2(Math.hypot(m.x - r.at.x, m.y - r.at.y)) : Infinity });
      }
      await page.screenshot({ path: path.join(art, 'editor-follow.png') });
      check('P7 the editor preview (the proxy, same evaluator) puts the sticker where the stills do, within 2 px; no page errors', diffs.length >= 4 && diffs.every((x) => x.px <= 2) && errors.length === 0, { frames: diffs.length, maxPx: Math.max(...diffs.map((x) => x.px)), errors: errors.slice(0, 3) });
      await page.context().close();
    }

    console.log('\n# P8 the same through edits of the followed clip, and in a 9:16 cover format');
    const variants: { name: string; ops: unknown[]; frames: number[]; pairs?: true }[] = [
      { name: 'speed 0.5', ops: [{ op: 'set_clip_speed', args: { clipId: v1, speed: 0.5 } }], frames: Array.from({ length: 10 }, (_, k) => [k * 24, k * 24 + 1]).flat(), pairs: true },
      { name: 'speed 2', ops: [{ op: 'set_clip_speed', args: { clipId: v1, speed: 2 } }], frames: Array.from({ length: 20 }, (_, k) => k * 6) },
      { name: 'reversed', ops: [{ op: 'set_clip_reverse', args: { clipId: v1, reverse: true } }], frames: Array.from({ length: 20 }, (_, k) => k * 12) },
      { name: 'slipped', ops: [{ op: 'trim_clip', args: { clipId: v1, edge: 'end', to: f(180) } }, { op: 'slip_clip', args: { clipId: v1, by: f(30) } }], frames: Array.from({ length: 15 }, (_, k) => k * 12) },
      { name: 'split', ops: [{ op: 'split_clip', args: { clipId: v1, at: f(100) } }], frames: [88, 92, 96, 99, 100, 101, 104, 108, 112, 120, 140, 200] },
      { name: 'stutter', ops: [{ op: 'add_effect', args: { clipId: v1, type: 'time.stutter' } }], frames: Array.from({ length: 20 }, (_, k) => k * 11 + 1) },
    ];
    const p8: Record<string, unknown> = {};
    for (const v of variants) {
      const r = await call(`/projects/${pid}/transactions`, { ops: v.ops });
      if (r.status !== 200) { check(`P8 ${v.name}: the edit was accepted`, false, r.body); continue; }
      const m = await measure(v.frames);
      let pairsSame: boolean | null = null;
      if (v.pairs) {
        const byFrame = new Map(m.rows.map((x) => [x.frame, x.at]));
        const pairs = v.frames.filter((x) => x % 2 === 0).filter((x) => byFrame.has(x) && byFrame.has(x + 1));
        pairsSame = pairs.length >= 4 && pairs.every((x) => JSON.stringify(byFrame.get(x)) === JSON.stringify(byFrame.get(x + 1)));
      }
      p8[v.name] = { n: m.n, medianPx: m.medianPx, maxPx: m.maxPx, ...(pairsSame !== null ? { pairsSame } : {}) };
      check(`P8 ${v.name}: the sticker follows the disc on stills (median ≤ 2 px, max ≤ 5 px)${v.pairs ? '; the two timeline frames of each held source frame are identical' : ''}`, m.n >= 6 && m.medianPx <= 2 && m.maxPx <= 5 && (pairsSame ?? true), { ...(p8[v.name] as object), worst: [...m.rows].sort((a, b) => b.err - a.err).slice(0, 2) });
      const undo = await call(`/projects/${pid}/undo`, {});
      if (undo.status !== 200) throw new Error(`undo after ${v.name} failed: ${JSON.stringify(undo.body).slice(0, 300)}`);
    }
    {
      const tall = (await txs(pid, [{ op: 'add_variant', args: { name: 'Tall', width: 720, height: 1280, fit: 'cover' } }])).results[0].output.variantId as string;
      const m = await measure(Array.from({ length: 30 }, (_, k) => k * 8), { variant: tall, W: 720, H: 1280, fit: 'cover', sourceOf: async (fr) => frameBarcode(await still(pid, fr)) });
      p8['9:16 cover'] = { n: m.n, medianPx: m.medianPx, maxPx: m.maxPx };
      check('P8 9:16 cover format: the sticker follows the disc where it is in the cropped frame (median ≤ 2 px, max ≤ 5 px)', m.n >= 4 && m.medianPx <= 2 && m.maxPx <= 5, p8['9:16 cover']);
    }
    measurements.P8 = p8;

    console.log('\n# P12 preflight lists the lost and weak runs where the timeline shows them');
    {
      d = (await get(pid)).project;
      const tr = d.motionTracks[trackA];
      await txs(pid, [{ op: 'set_redact_region', args: { clipId: v1, region: { motionTrackId: trackA } } }]);
      const flags = closing(tr.st, 30, true);
      const expectRedact = (map: (t: number) => number | null, n: number) => Array.from({ length: n }, (_, t) => t).filter((t) => { const idx = map(t); if (idx === null) return false; const i = idx - tr.from; return i < 0 || i >= tr.st.length || flags[i] === 1; });
      const expectFollow = (map: (t: number) => number | null, n: number) => Array.from({ length: n }, (_, t) => t).filter((t) => { const idx = map(t); if (idx === null) return false; const i = idx - tr.from; return i < 0 || i >= tr.st.length || [0, 2, 3].includes(tr.st[i]); });
      const pf1 = (await call(`/projects/${pid}/preflight`)).body;
      const r1 = { redact: issueFrames(pf1.issues, 'redact_track_loss'), follow: issueFrames(pf1.issues, 'follow_track_loss') };
      const e1 = { redact: expectRedact((t) => t, N), follow: expectFollow((t) => t, N) };
      await txs(pid, [{ op: 'set_clip_speed', args: { clipId: v1, speed: 2 } }]);
      const pf2 = (await call(`/projects/${pid}/preflight`)).body;
      const r2r = { redact: issueFrames(pf2.issues, 'redact_track_loss'), follow: issueFrames(pf2.issues, 'follow_track_loss'), missing: issueFrames(pf2.issues, 'follow_target_missing') };
      const e2 = { redact: expectRedact((t) => (t < N / 2 ? 2 * t : null), N / 2), follow: expectFollow((t) => (t < N / 2 ? 2 * t : null), N / 2), missing: Array.from({ length: N / 2 }, (_, k) => N / 2 + k) };
      await call(`/projects/${pid}/undo`, {});
      const warnOnly = [...pf1.issues, ...pf2.issues].filter((x: any) => /track_loss|target_missing/.test(x.code)).every((x: any) => x.severity === 'warning');
      const says = pf1.issues.some((x: any) => x.code === 'redact_track_loss' && /not guaranteed redaction/.test(x.message));
      check('P12 preflight at speed 1: the privacy-region ranges are exactly the lost/weak frames widened by the loss filter, the follow ranges exactly the unknown/weak/lost frames; warnings only, saying tracking is not guaranteed redaction', sameList(r1.redact, e1.redact) && sameList(r1.follow, e1.follow) && e1.redact.length > 0 && warnOnly && says, { redact: { got: runsOf(r1.redact), want: runsOf(e1.redact) }, follow: { got: runsOf(r1.follow), want: runsOf(e1.follow) } });
      check('P12 preflight at speed 2: the same runs at half the timeline frame (source 2t); the sticker after the clip ends follows a missing target', sameList(r2r.redact, e2.redact) && sameList(r2r.follow, e2.follow) && sameList(r2r.missing, e2.missing), { redact: { got: runsOf(r2r.redact), want: runsOf(e2.redact) }, follow: { got: runsOf(r2r.follow), want: runsOf(e2.follow) }, missing: { got: runsOf(r2r.missing), want: runsOf(e2.missing) } });
      // the region stays for P9 and P11; the sticker is hidden there (it would add its own edges)
      await txs(pid, [{ op: 'update_track', args: { trackId: stickerTrack, hidden: true } }]);
    }

    console.log('\n# P9 blur, full cover, the outside untouched, the whole picture on loss');
    {
      d = (await get(pid)).project;
      const tr = d.motionTracks[trackA];
      const region = clipsOf(d, 'video').find((c: any) => c.id === v1).redact[0];
      const lossAt = closing(tr.st, 30, true); // frames the loss fallback blurs whole are left out here
      const pick = [20, 60, 100, 200, 230].filter((fr) => usableAt(tr, fr) && lossAt[fr - tr.from] !== 1);
      const redacted: Record<number, Rgb> = {};
      for (const fr of pick) redacted[fr] = await still(pid, fr);
      const occl = [155, 160, 165];
      const occRed: Record<number, Rgb> = {};
      for (const fr of occl) occRed[fr] = await still(pid, fr);
      // the same frames without the region (removed, then the region comes back through undo)
      await txs(pid, [{ op: 'set_redact_region', args: { clipId: v1, regionId: region.id, region: null } }]);
      const plain: Record<number, Rgb> = {}, occPlain: Record<number, Rgb> = {};
      for (const fr of pick) plain[fr] = await still(pid, fr);
      for (const fr of occl) occPlain[fr] = await still(pid, fr);
      await call(`/projects/${pid}/undo`, {});
      const drops: { frame: number; drop: number }[] = [], outside: { frame: number; differing: number }[] = [];
      for (const fr of pick) {
        const t = trackingTruth(fr);
        const base = circleEnergy(plain[fr]!, t.cx, t.cy, 0.85 * t.r), red = circleEnergy(redacted[fr]!, t.cx, t.cy, 0.85 * t.r);
        drops.push({ frame: fr, drop: Number((1 - red / base).toFixed(3)) });
        // the padded box of the region at this frame (from the stored sample), widened by 4 feather radii and 4 px
        const v = at(tr, fr)!;
        const hw = ((tr.box.w / 1e4) * SW * v.s * (1 + region.pad)) / 2, hh = ((tr.box.h / 1e4) * SH * v.s * (1 + region.pad)) / 2, m = 4 * region.feather * SH + 4;
        let differing = 0;
        const a = redacted[fr]!.rgb, b = plain[fr]!.rgb;
        for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
          if (Math.abs(x + 0.5 - v.x) <= hw + m && Math.abs(y + 0.5 - v.y) <= hh + m) continue;
          const i = (y * SW + x) * 3;
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differing++;
        }
        outside.push({ frame: fr, differing });
      }
      check('P9 blur: the |Laplacian| energy inside the disc drops by at least 80% on every measured frame', pick.length >= 3 && drops.every((x) => x.drop >= 0.8), drops);
      check('P9 outside the padded box (plus four feather radii) the picture is byte-identical to the clip without the region', pick.length >= 3 && outside.every((x) => x.differing === 0), outside);
      const wholeDrops = occl.map((fr) => ({ frame: fr, drop: Number((1 - lapEnergy(occRed[fr]!, { x0: 0, y0: 0, x1: SW, y1: SH }, () => true) / lapEnergy(occPlain[fr]!, { x0: 0, y0: 0, x1: SW, y1: SH }, () => true)).toFixed(3)) }));
      check('P9 on occluded frames (tracking lost) the whole picture is blurred: its energy drops by at least 60%', wholeDrops.every((x) => x.drop >= 0.6), wholeDrops);
      // full cover: the region's inner half is exactly the colour
      await txs(pid, [{ op: 'set_redact_region', args: { clipId: v1, regionId: region.id, region: { style: 'fill', color: '#00c800' } } }]);
      const fills: { frame: number; checked: number; off: number; worst: number }[] = [];
      for (const fr of pick.slice(0, 3)) {
        const p = await still(pid, fr), v = at(tr, fr)!;
        const ax = ((tr.box.w / 1e4) * SW * v.s * (1 + region.pad)) / 2 * 0.5, ay = ((tr.box.h / 1e4) * SH * v.s * (1 + region.pad)) / 2 * 0.5;
        let checked = 0, off = 0, worst = 0;
        for (let y = Math.floor(v.y - ay); y <= Math.ceil(v.y + ay); y++) for (let x = Math.floor(v.x - ax); x <= Math.ceil(v.x + ax); x++) {
          if (((x + 0.5 - v.x) / ax) ** 2 + ((y + 0.5 - v.y) / ay) ** 2 > 1) continue;
          const i = (y * SW + x) * 3, dev = Math.max(Math.abs(p.rgb[i]! - 0), Math.abs(p.rgb[i + 1]! - 200), Math.abs(p.rgb[i + 2]! - 0));
          checked++; if (dev) off++; worst = Math.max(worst, dev);
        }
        fills.push({ frame: fr, checked, off, worst });
      }
      check('P9 full cover: every pixel of the region\'s inner half is exactly #00c800', fills.length >= 2 && fills.every((x) => x.checked > 500 && x.off === 0), fills);
      await call(`/projects/${pid}/undo`, {}); // back to blur
      measurements.P9 = { drops, wholeDrops, fills };
    }

    console.log('\n# P11 the loss fallback is not a flash (FlashAnalyser on the export, speed 1 and speed 4)');
    {
      const rows: Record<string, unknown>[] = [];
      for (const speed of [1, 4]) {
        if (speed !== 1) await txs(pid, [{ op: 'set_clip_speed', args: { clipId: v1, speed } }]);
        const { file, job } = await exportFile(pid);
        const w = 160, hh = 90;
        const raw = ff(['-i', file, '-vf', `scale=${w}:${hh}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
        const fa = new FlashAnalyser(30), fb = w * hh * 4;
        for (let k = 0; k < raw.length / fb; k++) fa.push(flashCells(raw.subarray(k * fb, (k + 1) * fb), w, hh));
        const rep = fa.report();
        rows.push({ speed, frames: rep.frames, verdict: rep.verdict, ranges: rep.ranges.slice(0, 3), exportsOwnCheck: job.output?.photosensitivity?.verdict ?? null });
        if (speed !== 1) await call(`/projects/${pid}/undo`, {});
      }
      check('P11 FlashAnalyser passes the exported picture with the whole-picture loss fallback, at speed 1 and at speed 4', rows.every((r: any) => r.verdict === 'pass' && r.frames > 0), rows);
    }

    console.log('\n# P10 echo on a redacted clip: every ghost is covered at its own frame');
    {
      const ep = (await call('/projects', { name: 'tracking-echo', width: SW, height: SH })).body.project.id as string;
      const ea = (await upload(ep, flat.file)).assetId as string;
      const ec = (await txs(ep, [{ op: 'add_clip', args: { assetId: ea, start: f(0), withLinkedAudio: false } }])).results[0].output.clipId as string;
      // a region track on hand-placed samples at the truth (this check is about the echo, not about the tracker)
      const mt = (await txs(ep, [{ op: 'create_motion_track', args: { assetId: ea, name: 'Truth', kind: 'region', frame: 0, x: seed.x, y: seed.y, w: seed.w, h: seed.h } }])).results[0].output.motionTrackId as string;
      const set = Array.from({ length: N - 1 }, (_, k) => { const tr = trackingTruth(k + 1); return { frame: k + 1, x: Math.round((tr.cx / SW) * 1e4), y: Math.round((tr.cy / SH) * 1e4), s: Math.round((tr.r / t0.r) * 1000) }; });
      await txs(ep, [{ op: 'edit_motion_track', args: { motionTrackId: mt, set } }]);
      await txs(ep, [{ op: 'add_effect', args: { clipId: ec, type: 'time.echo', params: { count: 4, delay: 15 } } }]);
      const frames = [100, 105, 110];
      const plainE: Record<number, Rgb> = {};
      for (const fr of frames) plainE[fr] = await (async () => { const r = await call(`/projects/${ep}/frame?index=${fr}`); return decodePng(r.body as Buffer); })();
      await txs(ep, [{ op: 'set_redact_region', args: { clipId: ec, region: { motionTrackId: mt } } }]);
      const rows: { frame: number; ghost: number; source: number; drop: number }[] = [];
      for (const fr of frames) {
        const red = decodePng((await call(`/projects/${ep}/frame?index=${fr}`)).body as Buffer);
        const taps = [0, 1, 2, 3].map((k) => ({ k, src: fr - 15 * k, ...trackingTruth(fr - 15 * k) }));
        for (const tp of taps) {
          const others = taps.filter((o) => o.k !== tp.k).map((o) => ({ cx: o.cx, cy: o.cy, r: o.r * 1.3 }));
          const base = circleEnergy(plainE[fr]!, tp.cx, tp.cy, 0.85 * tp.r, others), after = circleEnergy(red, tp.cx, tp.cy, 0.85 * tp.r, others);
          rows.push({ frame: fr, ghost: tp.k, source: tp.src, drop: Number((1 - after / base).toFixed(3)) });
        }
      }
      check('P10 echo (4 pictures, 15 frames apart) on a clip with a tracked privacy region: the picture and each of its 3 ghosts lose at least 80% of their |Laplacian| energy (each covered at its own source frame)', rows.length === 12 && rows.every((x) => x.drop >= 0.8), rows);
      measurements.P10 = rows;
    }

    console.log('\n# P13 recorded: speed, decoding, event-loop lag, commit time at 43,200 samples');
    {
      const out = (measurements.trackingJob as any)?.output ?? {};
      const lp = (await call('/projects', { name: 'tracking-latency', width: 640, height: 360 })).body.project.id as string;
      const lu = await upload(lp, long);
      const la = lu.assetId as string, lastFrame = Math.min(10_799, (lu.asset?.video?.frameCount ?? 10_800) - 1);
      const time = async (n: number) => { const ms: number[] = []; for (let i = 0; i < n; i++) { const t1 = performance.now(); await txs(lp, [{ op: 'rename_project', args: { name: `latency ${i}` } }]); ms.push(performance.now() - t1); } return ms; };
      await time(5); // warm up
      const baseMs = await time(25);
      const ids: string[] = (await txs(lp, Array.from({ length: 4 }, (_, k) => ({ op: 'create_motion_track', args: { assetId: la, name: `Long ${k + 1}`, kind: 'point', frame: 0, x: 5000, y: 5000 } })))).results.map((r: any) => r.output.motionTrackId);
      await txs(lp, ids.map((id) => ({ op: 'edit_motion_track', args: { motionTrackId: id, set: [{ frame: lastFrame, x: 5000, y: 5000 }] } })));
      const samples = Object.values((await get(lp)).project.motionTracks ?? {}).reduce((n: number, t: any) => n + t.st.length, 0);
      const fullMs = await time(25);
      const p95 = (v: number[]) => Number(pct(v, 95).toFixed(1));
      measurements.P13 = {
        trackingFps: out.trackingFps ?? null, framesTracked: out.frames ?? null, framesDecoded: out.decodedFrames ?? null, input: out.input ?? null,
        eventLoopLagMs: { p50: Number((lag.percentile(50) / 1e6).toFixed(1)), p99: Number((lag.percentile(99) / 1e6).toFixed(1)), max: Number((lag.max / 1e6).toFixed(1)), budgetP99: 100, withinBudget: lag.percentile(99) / 1e6 <= 100 },
        commitMs: { samples, baselineP95: p95(baseMs), withSamplesP95: p95(fullMs), deltaP95: Number((pct(fullMs, 95) - pct(baseMs, 95)).toFixed(1)), budgetDelta: 15, withinBudget: pct(fullMs, 95) - pct(baseMs, 95) <= 15 },
      };
      console.log('  P13', JSON.stringify(measurements.P13));
      check('P13 recorded (not a gate): the project held 43,200 track samples while commit time was measured', samples === 43_200, { samples });
    }
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' },
      scope: 'Model-free motion tracking (ADR-0015) on the synthetic tracking fixture only (a textured disc on noise, an occluder, a look-alike; no real face or person). Stills through render_frame, the export decoded with ffmpeg, the editor preview in headless Chromium. P13 is recorded, not gated. Not covered: real footage, faces, a GPU.',
      fixture: { width: SW, height: SH, frames: N, fps: FX.fps, occluded: FX.occluded, decoy: FX.decoy },
      passed: checks.length - failed.length, total: checks.length, measurements, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/tracking-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nTracking proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
