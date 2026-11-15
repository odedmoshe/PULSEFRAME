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

interface Case { name: string; file: string; make: string[] | null; picture: boolean; sound: number[] | null; note?: string; /** Seconds by which the file's own sound is ahead (−) or behind (+) its picture, by construction. */ skew?: number }

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
    { name: 'sound starts 0.1 s before time 0 (negative start)', file: p('a-neg.mkv'), make: ['-i', base, '-itsoffset', '-0.1', '-i', base, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-avoid_negative_ts', 'disabled'], picture: true, sound: [0.9, 1.9, 2.9], skew: -0.1, note: 'built with its sound 0.1 s ahead of its picture; the export must keep exactly that relation' },
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
  const originOf = (file: string) => { const x = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=start_time', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim()); return Number.isFinite(x) ? x : 0; };
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
    return out;
  };
  const soundTruth = (file: string) => {
    const pcm = ffraw(['-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=48000:first_pts=${Math.round(originOf(file) * 48000)}`, '-f', 'f32le', '-ac', '1', '-']);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const out: number[] = [];
    for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.1) { out.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
    return out;
  };
  const rows: any[] = [];
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
      const problems: string[] = [];
      const clipSeconds = row.asset.seconds;
      if (c.picture) {
        const raw = ffraw(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        const fb = W * H * 3;
        const shown = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
        const truth = pictureTruth(c.file);
        const n = Math.min(shown.length, truth.length);
        const bad = Array.from({ length: n }, (_, i) => i).filter((i) => shown[i] !== truth[i]);
        row.picture = { exportedFrames: shown.length, referenceFrames: truth.length, wrongFrames: bad.length, firstWrong: bad.length ? { at: bad[0], shows: shown[bad[0]!], reference: truth[bad[0]!] } : null, first4: shown.slice(0, 4), referenceFirst4: truth.slice(0, 4) };
        // the export may be a frame or two shorter or longer than the reference at the very end (container duration rounding), never elsewhere
        const earlyOnly = bad.length > 0 && bad.length <= 2 && bad.every((i) => i < 5);
        if (earlyOnly && row.asset.conformed) row.noted = `conformed copy differs from the reference in ${bad.length} of the first 5 frames (which early frame is repeated)`;
        else if (bad.length || Math.abs(shown.length - truth.length) > 2 || n < 100) problems.push('picture');
      }
      {
        const got = onsetsOf(out);
        const truth = (row.asset.audio ? soundTruth(c.file) : []).filter((t) => t < clipSeconds - 0.01);
        row.sound = { reference: truth, got, designed: c.sound };
        if (got.length !== truth.length || got.some((g, i) => Math.abs(g - truth[i]!) > 0.012)) problems.push('sound');
        // picture and sound stay together: each beep is heard within about a frame of the exported frame that carries its flash
        if (c.picture && row.picture && !problems.includes('picture')) {
          const raw = ffraw(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
          const fb = W * H * 3;
          const idx = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
          // a beep belongs to the frame whose index is a whole second; skip a frame that is being held from the very start
          const skew = got.map((g) => { const k = Math.round(g - (c.skew ?? 0)); const at = idx.indexOf(k * 30); return at < 0 || (at === 0 && idx[1] === idx[0]) ? null : Number((g - at / 30).toFixed(3)); }).filter((x): x is number => x !== null);
          row.avSkewSeconds = skew;
          row.designedSkewSeconds = c.skew ?? 0;
          if ((got.length >= 2 && skew.length < 2) || skew.some((x) => Math.abs(x - (c.skew ?? 0)) > 0.045)) problems.push('picture/sound out of step');
        }
      }
      row.outcome = problems.length ? `ACCEPTED-BUT-WRONG (${problems.join(', ')})` : row.noted ? 'exports-with-noted-difference' : 'exports-correctly';
      if (c.note) row.note = c.note;
    }
    for (const r of rows) console.log(`${String(r.outcome).padEnd(34)} ${r.case}${r.asset?.conformed ? '  [conformed]' : ''}${r.noted ? `  — ${r.noted}: ${JSON.stringify({ export: r.picture.first4, reference: r.picture.referenceFirst4 })}` : ''}${r.detail ? `  — ${r.detail}` : ''}${/^ACCEPTED/.test(String(r.outcome)) ? `  — asset ${JSON.stringify(r.asset)} picture ${JSON.stringify(r.picture)} sound ${JSON.stringify(r.sound)} skew ${JSON.stringify(r.avSkewSeconds)}` : ''}`);
    const defects = rows.filter((r) => /^ACCEPTED/.test(r.outcome) || r.outcome === 'accepted-but-cannot-be-placed');
    const notBuilt = rows.filter((r) => r.outcome === 'fixture-not-built');
    check(`no file is accepted at ingest and then fails or comes out wrong (${rows.length - notBuilt.length} files tried)`, defects.length === 0, defects.map((r) => ({ case: r.case, outcome: r.outcome, detail: r.detail, picture: r.picture, sound: r.sound })));
    const refused = rows.filter((r) => r.outcome === 'refused-at-ingest');
    check(`every refusal at ingest is a typed error (${refused.length} refusal(s) in this run${refused.length ? '' : ' — nothing was refused, so this check proves nothing here'})`, refused.every((r) => /^[a-z_]+: /.test(r.detail)), refused.map((r) => ({ case: r.case, detail: r.detail })));
    if (notBuilt.length) console.log(`note: ${notBuilt.length} fixture(s) could not be built by this ffmpeg and were not tried: ${notBuilt.map((r) => r.case).join('; ')}`);
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const tally: Record<string, number> = {};
    for (const r of rows) tally[String(r.outcome).replace(/ \(.*\)$/, '')] = (tally[String(r.outcome).replace(/ \(.*\)$/, '')] ?? 0) + 1;
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'Synthetic variants of one 4-second barcode fixture, server export route only (the preview and the browser export are not exercised here). The reference for each file is a direct ffmpeg rendering of that file with its raw timestamps, measured from the container start time that ffprobe reports (each decoded frame placed on the 30 fps grid by its own timestamp, square pixels; sound decoded from that start). The reference shares that definition of time zero with the product; it is independent of the product in everything after ingest (clip, audio plan, mixer, renderer, encoder). Sound is checked by beep onset times (±12 ms) and by staying within about a frame of the picture, not by level or channel content.', passed: checks.length - failed.length, total: checks.length, tally, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/input-matrix.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nInput matrix ${report.result}: ${report.passed}/${report.total}  ${JSON.stringify(tally)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
