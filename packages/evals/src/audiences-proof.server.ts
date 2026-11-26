/**
 * pnpm proof:audiences, part server (builder W2): checks 6, 14, 15, 16 and 17 of audiences-proof.ts, over the real server
 * (startServer on 127.0.0.1, a free port) and its real export path: every version is exported through POST …/exports with
 * `variantId`, the ONE projection and the one evaluate + compositor (ADR-0005). W1's rules are used as built; until they are merged
 * (core AUDIENCE_PROJECTION_BUILT false) every check answers "BLOCKED: …", never a pass. The web bundle (`pnpm build`) is needed for
 * every render.
 *
 * SYNTHETIC fixtures only, made here and deleted at the end (under 2 MB): a 6 s 320×180 barcode video at 30 fps with its 1 s beeps
 * (packages/fixtures generateBarcodeFixture) — the camera sound; a 3 s pulsed 1 kHz tone from ffmpeg `sine` (mono WAV) — the speech,
 * on a track the music ducks under; and built-in music «רגוע ונעים» made by the server's own synthesiser (POST …/music), placed twice:
 * alone on A-music, and on A-mixed beside one camera-sound clip (so A-mixed is not all music). No owner clip is used.
 *
 * The timeline (frames at 30 fps): T1 a title 0–180 (0.09 of the height); V1 the barcode video 15–90 and 90–165, a flash transition
 * of 10 frames at 90; an adjustment clip 15–165 with a strobe (3 a second, full amount). Sound: A-music the music 0–60, ducked 10 dB
 * under A-speech; A-mixed the music 60–105 and the camera sound 150–180 (the picture of that clip removed); A-speech the tone 105–150.
 * The project has NO loudness target and NO master limiter (checked), so a level read from the WAV is the mix as planned.
 *
 * Check 15 renders the strobe and the flash transition on the software WebGPU adapter: slow on 4 CPUs; one sample, NOT gated
 * (AUDIENCES_PROOF_SERVER.notGated). Nobody here looks or listens: each check is a measurement (hashes, PSNR, RMS in dB), and every
 * level is relative (the same stretch of the master export and of the version export), never an absolute loudness.
 * Run alone: `tsx packages/evals/src/audiences-proof.server.ts` (exit 0 all pass, 1 a failure, 2 only blocked ones besides passes).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from 'playwright';
import * as T from '@pulseframe/time';
import { AUDIENCE_PROJECTION_BUILT, DB_GAIN, type ProjectDocument } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { chooseFormat } from './editor-ui.ts';
import type { AudiencesProofPart } from './audiences-proof.core.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WEB = path.join(ROOT, 'apps/web/dist');
const R = { num: 30, den: 1 };
const W = 320, H = 180;
const f = (n: number) => T.frameTime(n, R);
const evidence: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 28, ...(input ? { input } : {}) });
const fail = (what: string, got: unknown) => `${what}: ${JSON.stringify(got).slice(0, 700)}`;
/** parity-suite.ts TH.psnr: the export against the still, as the other proofs that compare an export with a still use it */
export const PARITY_PSNR = 36;
const NOT_BUILT = 'BLOCKED: W1\'s audience rules are not merged in this build (core AUDIENCE_PROJECTION_BUILT is false), so no version for an audience can be made or exported';
const NO_WEB = 'BLOCKED: the web bundle is missing (`pnpm build`), so nothing can be rendered';

// ---------- the world: one server, one project, two versions, the exports every check reads ----------
type Who = Record<string, string>;
interface Job { id: string; status: string; error?: unknown; output?: any; retryOf?: string | null }
interface World {
  s: RunningServer; base: string; agent: Who; pid: string; calm: string; gp: string;
  ids: Record<string, string>; tracks: Record<string, string>;
  /** export results by name; a string is why it did not finish */
  exports: Record<string, { job: Job; file: string } | string>;
}
let worldP: Promise<World | string> | null = null;
const world = () => (worldP ??= makeWorld().catch((e) => `the fixture could not be built: ${String((e as Error)?.stack ?? e).slice(0, 600)}`));

async function call(w: { s: RunningServer; agent: Who }, method: string, p: string, body?: unknown): Promise<{ status: number; body: any; raw: Buffer }> {
  const r = await fetch(`${w.s.url}/api/v1${p}`, { method, headers: { ...w.agent, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await r.arrayBuffer());
  let parsed: any = null;
  if ((r.headers.get('content-type') ?? '').includes('json')) parsed = JSON.parse(raw.toString('utf8'));
  return { status: r.status, body: parsed, raw };
}
const ok = <B>(r: { status: number; body: B }, what: string): B => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

async function makeWorld(): Promise<World | string> {
  if (!fs.existsSync(path.join(WEB, 'render.html'))) return NO_WEB;
  if (!AUDIENCE_PROJECTION_BUILT) return NOT_BUILT;
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-audiences-proof-'));
  const fx = path.join(base, 'fx');
  fs.mkdirSync(fx, { recursive: true });
  const video = (await generateBarcodeFixture({ out: path.join(fx, 'camera.mp4'), frames: 180, fps: R, width: W, height: H })).file;
  const speech = path.join(fx, 'speech.wav');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=3', '-af', "volume='if(lt(mod(t,0.5),0.25),0.5,0)':eval=frame", '-ac', '1', '-c:a', 'pcm_s16le', speech]);
  const sizes = { video: fs.statSync(video).size, speech: fs.statSync(speech).size };
  evidence.fixtureBytes = sizes;
  const s = await startServer({ port: 0, dataDir: path.join(base, 'data'), webDist: WEB, speechPython: null, voicePython: null, backupDir: null });
  const w = { s, base, agent: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } as Who, pid: '', calm: '', gp: '', ids: {} as Record<string, string>, tracks: {} as Record<string, string>, exports: {} };
  const pid = ok(await call(w, 'POST', '/projects', { name: 'audiences proof', width: W, height: H, frameRate: R }), 'create the project').project.id as string;
  w.pid = pid;
  const upload = async (file: string) => {
    const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...w.agent, 'x-filename': path.basename(file) }, body: new Uint8Array(fs.readFileSync(file)) });
    const j = (await r.json()) as { assetId?: string };
    if (!j.assetId) throw new Error(`upload of ${path.basename(file)}: ${JSON.stringify(j).slice(0, 300)}`);
    return j.assetId;
  };
  const vid = await upload(video), sp = await upload(speech);
  const tx = async (ops: { op: string; args: unknown }[]) => ok(await call(w, 'POST', `/projects/${pid}/transactions`, { ops }), `commit ${ops.map((o) => o.op).join(',')}`) as { results: { output?: Record<string, unknown> }[] };
  const doc = (): ProjectDocument => s.store.wholeProject(pid).doc;
  const tracks = () => doc().sequences[doc().mainSequenceId]!.tracks;
  // picture
  w.ids.title = (await tx([{ op: 'add_text', args: { text: 'סבתא', start: f(0), duration: f(180) } }])).results[0]!.output!.clipId as string;
  await tx([{ op: 'update_text', args: { clipId: w.ids.title, style: { sizeFrac: 0.09 } } }]);
  w.ids.a = (await tx([{ op: 'add_clip', args: { assetId: vid, start: f(15), sourceIn: f(15), duration: f(75), withLinkedAudio: false } }])).results[0]!.output!.clipId as string;
  w.ids.b = (await tx([{ op: 'add_clip', args: { assetId: vid, start: f(90), sourceIn: f(90), duration: f(75), withLinkedAudio: false } }])).results[0]!.output!.clipId as string;
  await tx([{ op: 'set_transition', args: { clipId: w.ids.b, type: 'flash', frames: 10 } }]);
  w.ids.adj = (await tx([{ op: 'add_adjustment', args: { span: { start: f(15), duration: f(150) }, effects: [{ type: 'light.strobe', params: { rate: 3, amount: 1 } }] } }])).results[0]!.output!.clipId as string;
  // sound
  for (const k of ['music', 'mixed', 'speech'] as const) w.tracks[k] = (await tx([{ op: 'add_track', args: { kind: 'audio', name: k } }])).results[0]!.output!.trackId as string;
  const music = ok(await call(w, 'POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, seed: 3, start: T.ZERO, trackId: w.tracks.music }), 'built-in music') as { assetId: string; clipId: string };
  w.ids.music = music.clipId;
  await tx([{ op: 'trim_clip', args: { clipId: music.clipId, edge: 'end', to: f(60) } }]);
  w.ids.mixedMusic = (await tx([{ op: 'add_clip', args: { assetId: music.assetId, trackId: w.tracks.mixed, start: f(60), sourceIn: f(60), duration: f(45) } }])).results[0]!.output!.clipId as string;
  const camPic = (await tx([{ op: 'add_clip', args: { assetId: vid, start: f(150), duration: f(30), audioTrackId: w.tracks.mixed } }])).results[0]!.output!.clipId as string;
  await tx([{ op: 'delete_clip', args: { clipId: camPic, includeLinked: false } }]);
  w.ids.cam = tracks().find((t) => t.id === w.tracks.mixed)!.clips.find((c) => c.type === 'media' && c.assetId === vid)!.id;
  w.ids.speech = (await tx([{ op: 'add_clip', args: { assetId: sp, trackId: w.tracks.speech, start: f(105), duration: f(45) } }])).results[0]!.output!.clipId as string;
  await tx([{ op: 'set_ducking', args: { trackId: w.tracks.music, sourceTrackIds: [w.tracks.speech], reductionDb: 10 } }]);
  const settings = doc().settings as { loudness?: unknown; audio?: { loudness?: unknown; limiter?: unknown } } & Record<string, unknown>;
  evidence.mixSettings = { loudness: settings.loudness ?? settings.audio?.loudness ?? null, limiter: settings.audio?.limiter ?? (settings as { limiter?: unknown }).limiter ?? null };
  // the two versions
  w.calm = (await tx([{ op: 'add_audience_version', args: { profile: 'calm' } }])).results[0]!.output!.variantId as string;
  w.gp = (await tx([{ op: 'add_audience_version', args: { profile: 'grandparents' } }])).results[0]!.output!.variantId as string;
  evidence.timeline = tracks().map((t) => ({ kind: t.kind, name: t.name, clips: t.clips.map((c) => [T.frameIndexAt(c.start, R), T.frameIndexAt(T.add(c.start, c.duration), R)]) }));
  return w;
}

async function waitJob(w: World, id: string, ms = 20 * 60_000): Promise<Job> {
  const until = Date.now() + ms;
  for (;;) {
    const j = (await call(w, 'GET', `/jobs/${id}`)).body as Job;
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j;
    if (Date.now() > until) return { ...j, status: 'timed-out' };
    await sleep(250);
  }
}
async function download(w: World, job: Job, name: string): Promise<string> {
  const file = path.join(w.base, name);
  fs.writeFileSync(file, (await call(w, 'GET', `/jobs/${job.id}/output`)).raw);
  return file;
}
/** One export through the one path; a string when it did not finish. */
async function exportOnce(w: World, name: string, options: Record<string, unknown>): Promise<{ job: Job; file: string } | string> {
  if (w.exports[name]) return w.exports[name]!;
  const r = await call(w, 'POST', `/projects/${w.pid}/exports`, options);
  if (!r.body?.jobId) return (w.exports[name] = `the export ${name} did not start: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  const job = await waitJob(w, r.body.jobId);
  if (job.status !== 'succeeded') return (w.exports[name] = `the export ${name} ${job.status}: ${JSON.stringify(job.error).slice(0, 300)}`);
  return (w.exports[name] = { job, file: await download(w, job, `${name}.${options.format === 'wav' ? 'wav' : 'mp4'}`) });
}
const frameMd5 = (file: string) => String(ff(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'])).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop()!.trim());

/**
 * Checks 6 and 14: export the version once to the end; start a second export of it that waits in the queue behind the first, cancel
 * it there, and retry it (POST /jobs/:id/retry). The retry renders the canceled job's immutable snapshot, which is already the
 * projected document; it is planned as resolved (verifier C1), so a rule that is not idempotent (×4/3) is not applied twice.
 */
async function retrySame(id: '6' | '14', profile: 'calm' | 'grandparents'): Promise<true | string> {
  const got = await world();
  if (typeof got === 'string') return got;
  const w = got;
  const variantId = profile === 'calm' ? w.calm : w.gp;
  const options = { format: 'mp4-h264-aac', variantId };
  const firstStart = await call(w, 'POST', `/projects/${w.pid}/exports`, options);
  const queued = await call(w, 'POST', `/projects/${w.pid}/exports`, options);
  if (!firstStart.body?.jobId || !queued.body?.jobId) return fail('the exports did not start', [firstStart.body, queued.body]);
  const cancel = (await call(w, 'POST', `/jobs/${queued.body.jobId}/cancel`, {})).body;
  const first = await waitJob(w, firstStart.body.jobId);
  if (first.status !== 'succeeded') return fail('the first export', first);
  const canceled = await waitJob(w, queued.body.jobId);
  if (canceled.status !== 'canceled') return fail('the second export was not canceled in the queue', { cancel, status: canceled.status });
  const retry = await call(w, 'POST', `/jobs/${queued.body.jobId}/retry`, {});
  if (!retry.body?.jobId) return fail('the retry did not start', retry.body);
  const again = await waitJob(w, retry.body.jobId);
  if (again.status !== 'succeeded') return fail('the retry', again);
  const a = await download(w, first, `${profile}-first.mp4`), b = await download(w, again, `${profile}-retry.mp4`);
  w.exports[`${profile}-mp4`] = { job: first, file: a };
  const ha = frameMd5(a), hb = frameMd5(b);
  const sameFrames = ha.length === 180 && ha.length === hb.length && ha.every((h, i) => h === hb[i]);
  const sameManifest = JSON.stringify(first.output?.manifest) === JSON.stringify(again.output?.manifest);
  // the control: the same version's master-frame export (the projection skipped) differs, so equal hashes are not equal by accident
  const master = await exportOnce(w, 'master-mp4', { format: 'mp4-h264-aac' });
  const masterDiffers = typeof master === 'string' ? master : frameMd5(master.file).some((h, i) => h !== ha[i]);
  evidence[`c${id}`] = { profile, frames: ha.length, sameFrames, sameManifest, retryOf: again.retryOf, firstOutput: first.output?.manifest?.output, retryOutput: again.output?.manifest?.output, masterDiffers };
  return sameFrames && sameManifest && again.retryOf === queued.body.jobId && masterDiffers === true ? true : fail(`retry of the ${profile} export`, evidence[`c${id}`]);
}

// ---------- 15: photosensitivity report, one sample, not gated ----------
async function c15(): Promise<true | string> {
  const got = await world();
  if (typeof got === 'string') return got;
  const w = got;
  const master = await exportOnce(w, 'master-mp4', { format: 'mp4-h264-aac' });
  if (typeof master === 'string') return /gpu|webgpu|adapter/i.test(master) ? `BLOCKED: the strobe and the flash transition need a WebGPU adapter and none rendered here: ${master}` : master;
  const calmRun = w.exports['calm-mp4'] ?? await exportOnce(w, 'calm-mp4', { format: 'mp4-h264-aac', variantId: w.calm });
  if (typeof calmRun === 'string') return calmRun;
  type Rep = { verdict: string; frames: number; ranges: { from: T.RationalTime; to: T.RationalTime; kind: string; flashesPerSecond: number; area: number }[] } | undefined;
  const pm = master.job.output?.photosensitivity as Rep, pc = calmRun.job.output?.photosensitivity as Rep;
  const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(3));
  const view = (r: Rep) => r && { verdict: r.verdict, frames: r.frames, ranges: r.ranges.map((x) => ({ from: sec(x.from), to: sec(x.to), kind: x.kind, flashesPerSecond: x.flashesPerSecond, area: x.area })) };
  evidence.c15 = { note: 'one sample; a measurement of the export\'s own flash check, not gated', master: view(pm), calm: view(pc), masterWallSeconds: master.job.output?.wallSeconds ?? null };
  if (!pm || !pc) return fail('an export has no photosensitivity report', evidence.c15);
  const overlaps = (pc.ranges ?? []).filter((c) => pm.ranges.some((m) => T.cmp(c.from, m.to) < 0 && T.cmp(m.from, c.to) < 0));
  return pm.ranges.length > 0 && overlaps.length === 0 ? true : fail('master flash stretches and calm stretches on the same range', evidence.c15);
}

// ---------- 16: paused editor preview = server still (byte-identical); export frame within the parity limit ----------
let browserP: Promise<Browser> | null = null;
async function c16(): Promise<true | string> {
  const got = await world();
  if (typeof got === 'string') return got;
  const w = got;
  const decodeRgb = (args: string[]) => ff([...args, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const e = a[i]! - b[i]!; s += e * e; } return s === 0 ? 99 : 10 * Math.log10((255 * 255) / (s / a.length)); };
  const browser = await (browserP ??= chromium.launch());
  const rows: Record<string, unknown>[] = [];
  for (const [profile, variantId] of [['calm', w.calm], ['grandparents', w.gp]] as const) {
    const FRAME = 0; // the title alone (the barcode starts at 15): a frame that holds the version's text rule and no decoded video
    const stillPng = (await call(w, 'GET', `/projects/${w.pid}/frame?index=${FRAME}&variant=${variantId}`)).raw;
    const stillRgba = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], stillPng);
    const masterRgba = ff(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], (await call(w, 'GET', `/projects/${w.pid}/frame?index=${FRAME}`)).raw);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let previewSame = false, maxDiff: number | null = null, chose: string | null = null;
    try {
      await page.goto(`${w.s.ownerUrl}&project=${w.pid}`);
      await page.locator('canvas[data-testid=preview]').waitFor({ timeout: 30_000 });
      await chooseFormat(page, variantId).then(() => { chose = variantId; }, (e) => { chose = `could not choose the version in the format switch: ${String(e).slice(0, 200)}`; });
      for (let i = 0; i < 200 && !previewSame; i++) {
        await sleep(100);
        const got2: string = await page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
          if (!c) return '';
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let s = ''; for (let k = 0; k < d.length; k += 0x8000) s += String.fromCharCode(...d.subarray(k, k + 0x8000));
          return `${c.width}x${c.height}:${btoa(s)}`;
        });
        if (!got2) continue;
        const [size, data] = got2.split(':');
        const px = Buffer.from(data!, 'base64');
        if (size !== `${W}x${H}` || px.length !== stillRgba.length) { maxDiff = null; continue; }
        let m = 0; for (let k = 0; k < px.length; k++) m = Math.max(m, Math.abs(px[k]! - stillRgba[k]!));
        maxDiff = m; previewSame = m === 0;
      }
    } finally { await ctx.close(); }
    const run = w.exports[`${profile}-mp4`] ?? await exportOnce(w, `${profile}-mp4`, { format: 'mp4-h264-aac', variantId });
    // the export frame against the still, both as RGB (the still converted by ffmpeg from its RGBA)
    const stillRgb = ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${W}x${H}`, '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stillRgba);
    const exportRgb = typeof run === 'string' ? null : decodeRgb(['-i', run.file]);
    const p = exportRgb ? Number(psnr(exportRgb, stillRgb).toFixed(2)) : null;
    rows.push({ profile, frame: FRAME, chose, previewSame, maxDiff, exportPsnr: p, parityLimit: PARITY_PSNR, versionDiffersFromMaster: !stillRgba.equals(masterRgba), errors: errors.slice(0, 3), ...(typeof run === 'string' ? { exportError: run } : {}) });
  }
  evidence.c16 = rows;
  // grandparents differs from the master at frame 0 (its title is larger); calm's title rule is the master's, so calm may equal it
  const okRows = rows.every((r) => r.chose && !String(r.chose).startsWith('could not') && r.previewSame === true && typeof r.exportPsnr === 'number' && (r.exportPsnr as number) >= PARITY_PSNR);
  return okRows && rows[1]!.versionDiffersFromMaster === true ? true : fail('preview, still and export of the versions', rows);
}

// ---------- 17: sound, relative to the master export, no loudness target and no limiter ----------
async function c17(): Promise<true | string> {
  const got = await world();
  if (typeof got === 'string') return got;
  const w = got;
  const mix = evidence.mixSettings as { loudness: unknown; limiter: unknown };
  if (mix.loudness !== null || mix.limiter !== null) return fail('the fixture must have no loudness target and no master limiter', mix);
  const m = await exportOnce(w, 'master-wav', { format: 'wav' }), g = await exportOnce(w, 'grandparents-wav', { format: 'wav', variantId: w.gp });
  if (typeof m === 'string') return m;
  if (typeof g === 'string') return g;
  const pcm = (file: string) => { const b = ff(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', '48000', '-']); return new Float32Array(b.buffer, b.byteOffset, b.length / 4); };
  const pm = pcm(m.file), pg = pcm(g.file);
  const rms = (x: Float32Array, a: number, b: number) => { let s = 0, n = 0; for (let i = Math.round(a * 48000) * 2; i < Math.round(b * 48000) * 2 && i < x.length; i++) { s += x[i]! * x[i]!; n++; } return Math.sqrt(s / Math.max(1, n)); };
  const db = (a: number, b: number) => Number((20 * Math.log10(rms(pg, a, b) / rms(pm, a, b))).toFixed(3));
  // stretches in seconds, inside one clip each and away from its edges (music 0–2, mixed music 2–3.5, speech 3.5–5, camera beep 5.0–5.1)
  const stretches = { musicOnly: [0.2, 1.8], mixedTrackMusic: [2.2, 3.3], speechOnly: [3.7, 4.8], cameraSound: [4.98, 5.2] } as const;
  const rows = Object.fromEntries(Object.entries(stretches).map(([k, [a, b]]) => [k, { seconds: [a, b], masterRms: Number(rms(pm, a, b).toFixed(6)), versionRms: Number(rms(pg, a, b).toFixed(6)), db: db(a, b) }]));
  const want = { musicOnly: 20 * Math.log10(DB_GAIN[-8]!), mixedTrackMusic: 0, speechOnly: 0, cameraSound: 0 } as Record<string, number>;
  const off = Object.entries(rows).filter(([k, r]) => !(r.masterRms > 1e-4) || Math.abs(r.db - want[k]!) > 0.1);
  evidence.c17 = { note: 'measured from the exported WAVs, version against master on the same stretch; nobody has listened («לא נשמע»)', mix, stretches: rows, expectedDb: want, tolerance: 0.1 };
  return off.length === 0 ? true : fail('sound stretches', evidence.c17);
}

export async function closeAudiencesProofServer(): Promise<void> {
  if (browserP) { await (await browserP).close().catch(() => {}); browserP = null; }
  if (!worldP) return;
  const w = await worldP;
  worldP = null;
  if (typeof w === 'string') return;
  await w.s.close();
  fs.rmSync(w.base, { recursive: true, force: true });
}

const guard = (run: () => Promise<true | string>) => async (): Promise<true | string> => { try { return await run(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 700)}`; } };
export const AUDIENCES_PROOF_SERVER: AudiencesProofPart & { notGated: string[] } = {
  built: AUDIENCE_PROJECTION_BUILT,
  checks: { 6: guard(() => retrySame('6', 'calm')), 14: guard(() => retrySame('14', 'grandparents')), 15: guard(c15), 16: guard(c16), 17: guard(c17) },
  evidence,
  notGated: ['15'],
};

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    let failed = 0, blocked = 0;
    try {
      for (const [id, run] of Object.entries(AUDIENCES_PROOF_SERVER.checks)) {
        const t0 = Date.now();
        const r = await run();
        const tag = r === true ? 'PASS' : r.startsWith('BLOCKED') ? 'BLOCKED' : AUDIENCES_PROOF_SERVER.notGated.includes(id) ? 'NOT-GATED' : 'FAIL';
        if (tag === 'FAIL') failed++; if (tag === 'BLOCKED') blocked++;
        console.log(`${tag}  ${id}  (${((Date.now() - t0) / 1000).toFixed(1)} s)${r === true ? '' : `  ${r}`}`);
      }
    } finally { await closeAudiencesProofServer(); }
    console.log(JSON.stringify(evidence, null, 1).slice(0, 6000));
    process.exit(failed ? 1 : blocked ? 2 : 0);
  })();
}
