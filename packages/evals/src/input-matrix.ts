/**
 * Input matrix: ordinary-but-varied media shapes, each taken through ingest and a real export.
 * The invariant that matters: a file is either refused at ingest with a typed error, or it exports correctly.
 * "Accepted, then fails or comes out wrong" is a defect. All files are SYNTHETIC variants of the barcode fixture
 * (frame-index barcode, 1 kHz beep at each whole second); no camera, phone or broadcast file is involved.
 *   pnpm build && pnpm conformance:inputs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/input-matrix');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffq = (args: string[]) => { try { execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }); return null; } catch (e: any) { return String(e.stderr ?? e).trim().split('\n').pop()!.slice(0, 160); } };
const ffraw = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

interface Case { name: string; file: string; make: string[] | null; picture: boolean; sound: number[] | null; note?: string; /** Seconds by which the file's own sound is ahead (−) or behind (+) its picture, by construction. */ skew?: number; /** The file does not say how its colours are encoded, so readers legitimately disagree; a colour difference is reported, not failed. */ ambiguousColour?: boolean }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const base = (await generateBarcodeFixture({ out: path.join(art, 'base.mp4') })).file;
  const p = (n: string) => path.join(art, n);
  const BEEPS = [0, 1, 2, 3];
  const V = ['-map', '0:v', '-c:v', 'copy'], A = ['-map', '0:a'];
  const cases: Case[] = [
    // --- sound shapes (picture copied)
    { name: 'aac mono 44.1 kHz', file: p('a-mono441.mp4'), make: ['-i', base, ...V, ...A, '-c:a', 'aac', '-ac', '1', '-ar', '44100'], picture: true, sound: BEEPS },
    { name: 'aac 5.1 48 kHz', file: p('a-51.mp4'), make: ['-i', base, ...V, ...A, '-c:a', 'aac', '-ac', '6'], picture: true, sound: BEEPS },
    { name: 'pcm 24-bit 96 kHz in MOV', file: p('a-pcm96.mov'), make: ['-i', base, ...V, ...A, '-c:a', 'pcm_s24le', '-ar', '96000'], picture: true, sound: BEEPS },
    { name: 'mp3 in MP4', file: p('a-mp3.mp4'), make: ['-i', base, ...V, ...A, '-c:a', 'libmp3lame', '-b:a', '160k'], picture: true, sound: BEEPS },
    { name: 'no sound stream', file: p('a-none.mp4'), make: ['-i', base, ...V, '-an'], picture: true, sound: [] },
    { name: 'sound 2 s shorter than picture', file: p('a-short.mp4'), make: ['-i', base, ...V, ...A, '-c:a', 'aac', '-t', '4', '-af', 'atrim=0:2'], picture: true, sound: [0, 1] },
    { name: 'sound starts 0.1 s before time 0 (negative start)', file: p('a-neg.mkv'), make: ['-i', base, '-itsoffset', '-0.1', '-i', base, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-avoid_negative_ts', 'disabled'], picture: true, sound: [0.9, 1.9, 2.9], skew: -0.1, note: 'built with its sound 0.1 s ahead of its picture, so its first beep lies before time 0 and is not presented; the export must keep exactly that relation' },
    // --- containers (same streams)
    { name: 'MOV container', file: p('c.mov'), make: ['-i', base, '-c', 'copy'], picture: true, sound: BEEPS },
    { name: 'Matroska container', file: p('c.mkv'), make: ['-i', base, '-c', 'copy'], picture: true, sound: BEEPS },
    { name: 'MPEG-TS container', file: p('c.ts'), make: ['-i', base, '-c', 'copy'], picture: true, sound: BEEPS, note: 'MPEG-TS streams normally start at a non-zero timestamp' },
    { name: 'AVI container (MPEG-4 part 2 + MP3)', file: p('c.avi'), make: ['-i', base, '-c:v', 'mpeg4', '-q:v', '3', '-c:a', 'libmp3lame'], picture: true, sound: BEEPS },
    { name: 'WebM (VP9 + Opus)', file: p('c.webm'), make: ['-i', base, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-deadline', 'good', '-cpu-used', '5', '-c:a', 'libopus'], picture: true, sound: BEEPS },
    // --- picture shapes (sound copied)
    { name: 'non-square pixels (480×360 stored, 4:3 pixel shape → 640×360 shown)', file: p('p-sar.mp4'), make: ['-i', base, '-vf', 'scale=480:360,setsar=4/3', '-c:v', 'libx264', '-crf', '14', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 10-bit', file: p('p-10bit.mp4'), make: ['-i', base, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p10le', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 4:4:4', file: p('p-444.mp4'), make: ['-i', base, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv444p', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 4:2:2', file: p('p-422.mp4'), make: ['-i', base, '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv422p', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 interlaced coding', file: p('p-interlaced.mp4'), make: ['-i', base, '-c:v', 'libx264', '-crf', '14', '-flags', '+ilme+ildct', '-x264opts', 'tff=1', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'odd picture size 642×362', file: p('p-odd.mp4'), make: ['-i', base, '-vf', 'scale=642:362', '-c:v', 'libx264', '-crf', '14', '-c:a', 'copy'], picture: true, sound: BEEPS },
    // --- colour encodings (not conformed: decoded directly by the browser)
    { name: 'H.264 tagged BT.601', file: p('p-bt601.mp4'), make: ['-i', base, '-vf', 'scale=out_color_matrix=bt601:out_range=tv', '-c:v', 'libx264', '-crf', '14', '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 BT.601 data with no colour tags', file: p('p-untagged.mp4'), make: ['-i', base, '-vf', 'scale=out_color_matrix=bt601:out_range=tv', '-c:v', 'libx264', '-crf', '14', '-bsf:v', 'h264_metadata=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2', '-c:a', 'copy'], picture: true, sound: BEEPS, ambiguousColour: true, note: 'untagged: decoders must guess; the reference assumes BT.601 as ffmpeg does' },
    { name: 'H.264 full range (BT.709)', file: p('p-full.mp4'), make: ['-i', base, '-vf', 'scale=out_color_matrix=bt709:out_range=full', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'copy'], picture: true, sound: BEEPS },
    { name: 'H.264 full range BT.601 (typical phone/JPEG-style)', file: p('p-full601.mp4'), make: ['-i', base, '-vf', 'scale=out_color_matrix=bt601:out_range=full', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', '-c:a', 'copy'], picture: true, sound: BEEPS },
    // --- sound-only files
    { name: 'WAV 16-bit', file: p('s.wav'), make: ['-i', base, '-vn', '-c:a', 'pcm_s16le'], picture: false, sound: BEEPS },
    { name: 'WAV 24-bit 44.1 kHz mono', file: p('s24.wav'), make: ['-i', base, '-vn', '-c:a', 'pcm_s24le', '-ar', '44100', '-ac', '1'], picture: false, sound: BEEPS },
    { name: 'FLAC', file: p('s.flac'), make: ['-i', base, '-vn', '-c:a', 'flac'], picture: false, sound: BEEPS },
    { name: 'MP3', file: p('s.mp3'), make: ['-i', base, '-vn', '-c:a', 'libmp3lame', '-b:a', '160k'], picture: false, sound: BEEPS },
    { name: 'M4A (AAC)', file: p('s.m4a'), make: ['-i', base, '-vn', '-c:a', 'aac'], picture: false, sound: BEEPS },
    { name: 'Ogg Vorbis', file: p('s.ogg'), make: ['-i', base, '-vn', '-c:a', 'libvorbis'], picture: false, sound: BEEPS },
    { name: 'Opus', file: p('s.opus'), make: ['-i', base, '-vn', '-c:a', 'libopus'], picture: false, sound: BEEPS },
  ];

  const s = await startServer({ port: 8819, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (pth: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${pth}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const onsetsOf = (file: string) => {
    const pcm = ffraw(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const out: number[] = [];
    for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.1) { out.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
    return out;
  };
  /**
   * Reference: ffmpeg's own rendering of the INPUT file on the file's clock, sampled on the project's frame grid from time 0
   * (first picture held until it starts, square pixels) and its sound decoded from time 0. The export must match this.
   */
  /** The file's own start time as ffprobe reports it for the container (independent of which streams are decoded). */
  const originOf = (file: string) => { const x = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()); return Number.isFinite(x) ? Math.max(0, x) : 0; }; // never below zero: material before time 0 is not presented
  /**
   * Picture reference, by arithmetic on the file's own timestamps: decode every frame in presentation order, read each frame's
   * timestamp with ffprobe, place frame k on the 30 fps grid at round((pts_k − origin) × 30), and hold a frame until the next one.
   * (Not ffmpeg's fps filter: for files with a negative start it places frames about a frame away from their timestamps.)
   */
  const pictureTruth = (file: string) => {
    const raw = ffraw(['-i', file, '-map', '0:v:0', '-vf', 'scale=iw*sar:ih,setsar=1,scale=640:360', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = W * H * 3;
    const codes = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
    const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 1 << 26 }).trim().split('\n').map((x) => Number(x.replace(/,/g, '')));
    const origin = originOf(file);
    const n = Math.min(codes.length, pts.length);
    const at = Array.from({ length: n }, (_, k) => Math.round((pts[k]! - origin) * 30));
    const out: number[] = [];
    for (let k = 0; k < n; k++) { const until = k + 1 < n ? at[k + 1]! : at[k]! + 1; while (out.length < until) out.push(codes[k]!); }
    /** RGB of the plain background of the source frame that carries barcode `code` (a point clear of the barcode, the moving box and the flash bar). */
    const colourOf = (code: number) => { const k = codes.indexOf(code); return k < 0 ? null : pixelAt(raw, k); };
    return { frames: out, colourOf };
  };
  const pixelAt = (raw: Buffer, frame: number) => { const o = frame * W * H * 3 + (120 * W + 40) * 3; return [raw[o]!, raw[o + 1]!, raw[o + 2]!]; };
  /** Peak of each stereo channel in a short window (the second beep), from a decode that keeps the container's clock. */
  /** `mono`: the reference for a mono source is the full signal in both channels (what players do), not a −3 dB spread. */
  const peaks = (file: string, origin: number | null, at: number, mono = false) => {
    const pcm = ffraw([...(origin === null ? [] : ['-copyts']), '-i', file, '-map', '0:a:0', '-af', `aresample=48000${origin === null ? '' : `:first_pts=${Math.round(origin * 48000)}`},${mono ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=sample_fmts=flt:channel_layouts=stereo`, '-f', 'f32le', '-']);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const from = Math.round((at + 0.004) * 48000), to = Math.round((at + 0.04) * 48000);
    let l = 0, r = 0;
    for (let i = from; i < to && i * 2 + 1 < x.length; i++) { l = Math.max(l, Math.abs(x[i * 2]!)); r = Math.max(r, Math.abs(x[i * 2 + 1]!)); }
    return [l, r];
  };
  const soundTruth = (file: string) => {
    const pcm = ffraw(['-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=48000:first_pts=${Math.round(originOf(file) * 48000)}`, '-f', 'f32le', '-ac', '1', '-']);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const out: number[] = [];
    for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.1) { out.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
    return out;
  };
  /** Compare one exported file with the references built from the input; fills `row` and returns what is wrong. */
  const assess = (c: Case, row: any, out: string): string[] => {
      const problems: string[] = [];
      const clipSeconds = row.asset.seconds;
      if (c.picture) {
        const raw = ffraw(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const fb = W * H * 3;
        const shown = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
        const ref = pictureTruth(c.file);
        const truth = ref.frames;
        const n = Math.min(shown.length, truth.length);
        const bad = Array.from({ length: n }, (_, i) => i).filter((i) => shown[i] !== truth[i]);
        row.picture = { exportedFrames: shown.length, referenceFrames: truth.length, wrongFrames: bad.length, firstWrong: bad.length ? { at: bad[0], shows: shown[bad[0]!], reference: truth[bad[0]!] } : null, first4: shown.slice(0, 4), referenceFirst4: truth.slice(0, 4) };
        // the export may be a frame or two shorter or longer than the reference at the very end (container duration rounding), never elsewhere
        // colour: the plain background of four source frames with different hues, export vs a direct decode of the input
        const diffs: number[] = [];
        for (const code of [10, 45, 70, 100]) {
          const at = shown.indexOf(code), want = ref.colourOf(code);
          if (at < 0 || !want) continue;
          const got = pixelAt(raw, at);
          diffs.push(Math.max(...got.map((v, ch) => Math.abs(v - want[ch]!))));
        }
        row.colour = { framesCompared: diffs.length, worstChannelDifference: diffs.length ? Math.max(...diffs) : null };
        if (diffs.length < 3) problems.push('colour');
        else if (Math.max(...diffs) > 12) { if (c.ambiguousColour) row.noted = `the file carries no colour tags: shown as the browser reads it, ${Math.max(...diffs)} of 255 away from the BT.601 reading used by the reference`; else problems.push('colour'); }
        const earlyOnly = bad.length > 0 && bad.length <= 2 && bad.every((i) => i < 5);
        if (earlyOnly && row.asset.conformed) row.noted = `conformed copy differs from the reference in ${bad.length} of the first 5 frames (which early frame is repeated): export ${JSON.stringify(shown.slice(0, 4))}, reference ${JSON.stringify(truth.slice(0, 4))}`;
        else if (bad.length || Math.abs(shown.length - truth.length) > 2 || n < 100) problems.push('picture');
      }
      {
        const got = onsetsOf(out);
        const truth = (row.asset.audio ? soundTruth(c.file) : []).filter((t) => t < clipSeconds - 0.01);
        row.sound = { reference: truth, got, designed: c.sound };
        if (got.length !== truth.length || got.some((g, i) => Math.abs(g - truth[i]!) > 0.012)) problems.push('sound');
        // level per stereo channel at the second beep the clip contains: export vs a direct decode of the input (same down-mix rule)
        if (truth.length >= 2 && got.length >= 2 && !problems.includes('sound')) {
          const refPeaks = peaks(c.file, originOf(c.file), truth[1]!, / 1ch /.test(String(row.asset.audio))), outPeaks = peaks(out, null, got[1]!);
          const dB = refPeaks.map((p, ch) => (p > 0.001 && outPeaks[ch]! > 0.001 ? Number((20 * Math.log10(outPeaks[ch]! / p)).toFixed(2)) : p <= 0.001 && outPeaks[ch]! <= 0.001 ? 0 : 99));
          row.level = { referencePeaks: refPeaks.map((p) => Number(p.toFixed(3))), exportPeaks: outPeaks.map((p) => Number(p.toFixed(3))), differenceDb: dB };
          if (dB.some((d) => Math.abs(d) > 1.5)) problems.push('level');
        }
        // picture and sound stay together: each beep is heard within about a frame of the exported frame that carries its flash
        if (c.picture && row.picture && !problems.includes('picture')) {
          const raw = ffraw(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
          const fb = W * H * 3;
          const idx = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
          // a beep belongs to the frame whose index is a whole second; skip a frame that is being held from the very start
          // (a beep cut off by time 0 starts "at 0" only because its beginning is not presented: it says nothing about step)
          const skew = got.filter((g) => !(g < 0.01 && (c.skew ?? 0) < 0)).map((g) => { const k = Math.round(g - (c.skew ?? 0)); const at = idx.indexOf(k * 30); return at < 0 || (at === 0 && idx[1] === idx[0]) ? null : Number((g - at / 30).toFixed(3)); }).filter((x): x is number => x !== null);
          row.avSkewSeconds = skew;
          row.designedSkewSeconds = c.skew ?? 0;
          if ((got.length >= 2 && skew.length < 2) || skew.some((x) => Math.abs(x - (c.skew ?? 0)) > 0.045)) problems.push('picture/sound out of step');
        }
      }
    return problems;
  };
  const rows: any[] = [];
  const browser = process.env.PF_MATRIX_BROWSER === '0' ? null : await chromium.launch();
  const page = browser ? await browser.newPage() : null;
  if (page) { await page.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`); await page.evaluate(() => (window as any).__pfBrowserExport.ready); }
  try {
    for (const c of cases) {
      const row: any = { case: c.name };
      rows.push(row);
      const made = c.make ? ffq([...c.make, c.file]) : null;
      if (made) { row.outcome = 'fixture-not-built'; row.detail = made; continue; }
      const pid = (await call('/projects', { name: c.name.slice(0, 60), width: W, height: H })).body.project.id;
      const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(c.file) }, body: fs.readFileSync(c.file) })).json();
      if (!up.assetId) { row.outcome = 'refused-at-ingest'; row.detail = `${up.error?.code}: ${String(up.error?.message).slice(0, 120)}`; continue; }
      row.asset = { kind: up.asset.kind, seconds: Number(T.toSeconds(up.asset.duration).toFixed(3)), conformed: up.asset.conform ? up.asset.conform.reasons ?? true : false, video: up.asset.video ? `${up.asset.video.codec} ${up.asset.video.width}x${up.asset.video.height}` : null, audio: up.asset.audio ? `${up.asset.audio.codec} ${up.asset.audio.channels}ch ${up.asset.audio.sampleRate}` : null, vStart: up.asset.video?.startTime ? T.toSeconds(up.asset.video.startTime) : 0, aStart: up.asset.audio?.startTime ? T.toSeconds(up.asset.audio.startTime) : 0 };
      const add = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
      if (add.status !== 200) { row.outcome = 'accepted-but-cannot-be-placed'; row.detail = add.body?.error?.code; continue; }
      const jobId = (await call(`/projects/${pid}/exports`, c.picture ? {} : { format: 'wav' })).body.jobId;
      let job: any;
      for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
      if (job.status !== 'succeeded') { row.outcome = 'ACCEPTED-BUT-EXPORT-FAILED'; row.detail = String(job.error?.message ?? job.error?.code).slice(0, 200); continue; }
      const out = p(`out-${rows.length}.${c.picture ? 'mp4' : 'wav'}`);
      fs.writeFileSync(out, (await call(`/jobs/${jobId}/output`)).body);
      const problems = assess(c, row, out);
      row.outcome = problems.length ? `ACCEPTED-BUT-WRONG (${problems.join(', ')})` : row.noted ? 'exports-with-noted-difference' : 'exports-correctly';
      if (c.note) row.note = c.note;
      // --- the same project through the browser export route (the browser's own decoders and encoders)
      if (page) {
        const rb: any = { asset: row.asset };
        row.browser = rb;
        const r: any = await page.evaluate(([pid2]) => (window as any).__pfBrowserExport.tryRun(pid2, { quality: 'high' }), [pid] as const).catch((e) => ({ ok: false, code: 'page_error', message: String(e) }));
        if (!r.ok) { rb.outcome = 'REFUSED-BY-BROWSER-ROUTE'; rb.detail = `${r.code}: ${String(r.message).slice(0, 140)}`; }
        else {
          const bf = p(`browser-${rows.length}.${r.result.container}`);
          fs.writeFileSync(bf, Buffer.from(r.result.base64, 'base64'));
          const bp = assess(c, rb, bf); // sound-only files are compared by sound alone
          rb.outcome = bp.length ? `WRONG (${bp.join(', ')})` : rb.noted ? 'noted-difference' : 'correct';
          rb.codecs = `${r.result.container}/${r.result.videoCodec}/${r.result.audioCodec}`;
        }
      }
    }
    for (const r of rows) console.log(`${String(r.outcome).padEnd(34)} ${r.case}${r.asset?.conformed ? '  [conformed]' : ''}${r.noted ? `  — ${r.noted}` : ''}${r.detail ? `  — ${r.detail}` : ''}${/^ACCEPTED/.test(String(r.outcome)) ? `  — asset ${JSON.stringify(r.asset)} picture ${JSON.stringify(r.picture)} colour ${JSON.stringify(r.colour)} sound ${JSON.stringify(r.sound)} level ${JSON.stringify(r.level)} skew ${JSON.stringify(r.avSkewSeconds)}` : ''}`);
    if (page) { console.log('\nbrowser export route:'); for (const r of rows) if (r.browser) console.log(`  ${String(r.browser.outcome).padEnd(40)} ${r.case}${r.browser.detail ? `  — ${r.browser.detail}` : ''}${/^WRONG/.test(String(r.browser.outcome)) ? `  — picture ${JSON.stringify(r.browser.picture)} colour ${JSON.stringify(r.browser.colour)} sound ${JSON.stringify(r.browser.sound)} level ${JSON.stringify(r.browser.level)} skew ${JSON.stringify(r.browser.avSkewSeconds)}` : ''}${r.browser.noted ? `  — ${r.browser.noted}` : ''}`); }
    console.log('colour worst difference (of 255) per picture file:', JSON.stringify(Object.fromEntries(rows.filter((r) => r.colour).map((r) => [r.case.slice(0, 28), r.colour.worstChannelDifference]))));
    console.log('level difference in dB [L, R] per file:', JSON.stringify(Object.fromEntries(rows.filter((r) => r.level).map((r) => [r.case.slice(0, 28), r.level.differenceDb]))));
    const defects = rows.filter((r) => /^ACCEPTED/.test(r.outcome) || r.outcome === 'accepted-but-cannot-be-placed');
    const browserBad = rows.filter((r) => r.browser && !['correct', 'noted-difference'].includes(r.browser.outcome));
    const notBuilt = rows.filter((r) => r.outcome === 'fixture-not-built');
    check(`no file is accepted at ingest and then fails or comes out wrong (${rows.length - notBuilt.length} files tried)`, defects.length === 0, defects.map((r) => ({ case: r.case, outcome: r.outcome, detail: r.detail, picture: r.picture, sound: r.sound })));
    if (page) check(`the browser export route gives the same result as the reference for every file the server route exports (${rows.filter((r) => r.browser).length} files)`, browserBad.length === 0, browserBad.map((r) => ({ case: r.case, outcome: r.browser.outcome, detail: r.browser.detail, sound: r.browser.sound, level: r.browser.level, colour: r.browser.colour })));
    const refused = rows.filter((r) => r.outcome === 'refused-at-ingest');
    check(`every refusal at ingest is a typed error (${refused.length} refusal(s) in this run${refused.length ? '' : ' — nothing was refused, so this check proves nothing here'})`, refused.every((r) => /^[a-z_]+: /.test(r.detail)), refused.map((r) => ({ case: r.case, detail: r.detail })));
    if (notBuilt.length) console.log(`note: ${notBuilt.length} fixture(s) could not be built by this ffmpeg and were not tried: ${notBuilt.map((r) => r.case).join('; ')}`);
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser?.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const tally: Record<string, number> = {};
    for (const r of rows) tally[String(r.outcome).replace(/ \(.*\)$/, '')] = (tally[String(r.outcome).replace(/ \(.*\)$/, '')] ?? 0) + 1;
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'Synthetic variants of one 4-second barcode fixture, server export route and browser export route (the editor preview is not exercised here). The reference for each file is a direct ffmpeg rendering of that file with its raw timestamps, measured from the container start time that ffprobe reports (each decoded frame placed on the 30 fps grid by its own timestamp, square pixels; sound decoded from that start). The reference shares that definition of time zero with the product; it is independent of the product in everything after ingest (clip, audio plan, mixer, renderer, encoder). Sound is checked by beep onset times (±12 ms), by staying within about a frame of the picture, and by the peak level of each stereo channel at one beep (±1.5 dB against a direct decode of the input; a mono source is expected at full level in both channels; for more than two channels the reference uses the same down-mix rule as the product, so those coefficients are not independently verified). Picture is checked by frame identity and by the background colour of four frames (worst channel difference ≤ 12 of 255 against a direct decode of the input).', passed: checks.length - failed.length, total: checks.length, tally, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/input-matrix.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nInput matrix ${report.result}: ${report.passed}/${report.total}  ${JSON.stringify(tally)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
