/**
 * Multicam sync fixtures (ADR-0020). Deterministic from `seed`; truth comes from the construction, never from the code under
 * test.
 *
 * SOUND is NON-periodic seeded speech built from docs/demo/narration-sample-he.m4a: pieces of 0.6–2.5 s from random places in
 * the narration, each at a random pitch (±3 semitones, by resampling) and tempo (±10 %, by overlap-add), with gaps of
 * 0.3–2 s. A click every second, or the beep fixture, has equal correlation peaks every period and a sync gate rightly calls
 * it ambiguous (plan, "facts both designs missed" c).
 * GROUP TIME is the reference recorder's own clock: group sample k is sample k of the recorder (a WAV, mono; two channels in
 * the dialogue variant, one mic per channel).
 * PICTURE files (H.264 + AAC 256 kb/s in MP4, 320×180) carry in their barcode strip readBarcodeChannel(…, 0) = the group frame
 * shown (round(g·fps) mod 65536, where g is the group time of the frame's start) and readBarcodeChannel(…, 1) = the angle's
 * index in `angles`. Their sound is the room as that camera heard it.
 * ANGLES: 0 the reference recorder; 1 a camera at −30,000 samples (it started first); 2 a camera at +57,321 samples,
 * polarity flipped, pink noise at 10 dB SNR; 3 a camera at +100 ppm (its clock runs fast: group = offset + source·(1+1e-4),
 * evaluated by interpolation rather than asetrate), split into two files at 60 % of its length.
 * EXTRAS (extras: true; needs seconds ≥ 60): the room plays a backing loop for 20 s in the middle (speech pauses); camera 4
 * records only that loop (periodic: expect ambiguous), camera 5 only pink noise (expect no-shared-sound), camera 6 has a 2 s
 * pause inside (expect inconsistent).
 * DIALOGUE (dialogue: true): two speakers taking turns of 2–8 s, about one turn in three overlapping the next by 1–1.5 s;
 * speaker 2 is pitch-shifted up 5 semitones; each mic hears the other speaker at −15 dB. `turns` lists who speaks when.
 * video: false writes the cameras as sound-only WAV files (for long timing runs: the 16-bit barcode wraps after 36 min at 30 fps).
 * Capture dates (captureAt, wall clock, whole seconds, no zone) are written per file from a fixed base, so the capture-time
 * prior can be checked against the truth.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BARCODE, mulberry32 } from './index.ts';

export interface MulticamFixtureOptions { outDir: string; seconds: number; fps?: { num: number; den: number }; sampleRate?: number; seed?: number; narrationPath: string; dialogue?: boolean; extras?: boolean; video?: boolean }
export interface MulticamFixtureFile { path: string; groupStartSamples: number; captureAt?: string }
export interface MulticamFixtureAngle { label: string; kind: 'picture' | 'sound'; files: MulticamFixtureFile[]; truth: { offsetSamples: number; driftPpm: number; polarity: 1 | -1 }; expect: 'reference' | 'confident' | 'ambiguous' | 'no-shared-sound' | 'inconsistent' }
export interface MulticamFixture { sampleRate: number; fps: { num: number; den: number }; angles: MulticamFixtureAngle[]; turns: { speaker: 0 | 1; startSeconds: number; endSeconds: number }[] }

const WIDTH = 320, HEIGHT = 180;
const CAPTURE_BASE = Date.UTC(2026, 4, 1, 18, 0, 0); // 2026-05-01 18:00:00, wall clock

function run(args: string[], feed?: (stdin: NodeJS.WritableStream) => Promise<void>, onData?: (b: Buffer) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { stdio: [feed ? 'pipe' : 'ignore', onData ? 'pipe' : 'ignore', 'pipe'] });
    let err = '';
    p.stderr!.on('data', (d) => (err += d));
    if (onData) p.stdout!.on('data', onData);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
    if (feed) { p.stdin!.on('error', () => {}); feed(p.stdin!).then(() => p.stdin!.end(), reject); }
  });
}
async function decodeMono(file: string, sr: number): Promise<Float32Array> {
  const chunks: Buffer[] = [];
  await run(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], undefined, (b) => chunks.push(b));
  const buf = Buffer.concat(chunks);
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4)));
}
function wavBytes(chans: Float32Array[], sr: number): Buffer {
  const C = chans.length, n = chans[0]!.length;
  const b = Buffer.alloc(44 + n * 2 * C);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * C, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(C, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2 * C, 28); b.writeUInt16LE(2 * C, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2 * C, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < C; c++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chans[c]![i]! * 32767))), 44 + (i * C + c) * 2);
  return b;
}
/** Read x at a fractional sample index (linear interpolation; 0 outside). */
const at = (x: Float32Array, i: number) => { const k = Math.floor(i), f = i - k; const a = k >= 0 && k < x.length ? x[k]! : 0, b = k + 1 >= 0 && k + 1 < x.length ? x[k + 1]! : 0; return a + (b - a) * f; };

/** One narration piece at pitch ratio p (resampled) stretched by s in time (overlap-add, 1024-sample Hann grains, hop 256). */
function piece(src: Float32Array, start: number, len: number, p: number, stretch: number): Float32Array {
  const res = Float32Array.from({ length: Math.floor(len / p) }, (_, i) => at(src, start + i * p));
  const G = 1024, Hs = 256, Ha = Hs / stretch, out = new Float32Array(Math.floor(res.length * stretch) + G), norm = new Float32Array(out.length);
  for (let k = 0; k * Hs < out.length - G; k++) {
    const a = Math.round(k * Ha);
    if (a + G > res.length) break;
    for (let i = 0; i < G; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / G); out[k * Hs + i] = out[k * Hs + i]! + res[a + i]! * w; norm[k * Hs + i] = norm[k * Hs + i]! + w; }
  }
  for (let i = 0; i < out.length; i++) out[i] = norm[i]! > 1e-3 ? out[i]! / norm[i]! : 0;
  const fade = Math.min(480, out.length >> 2);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] = out[i]! * g; out[out.length - 1 - i] = out[out.length - 1 - i]! * g; }
  return out;
}
/** Seeded speech over [from, to) seconds of a buffer of n samples (added in place). pitchSemis shifts the whole voice. */
function speak(dst: Float32Array, src: Float32Array, sr: number, rnd: () => number, from: number, to: number, pitchSemis: number, gaps: [number, number]): void {
  let t = from;
  while (t < to) {
    const len = Math.round((0.6 + rnd() * 1.9) * sr), start = Math.floor(rnd() * Math.max(1, src.length - len * 1.3));
    const p = 2 ** ((pitchSemis + (rnd() * 6 - 3)) / 12), tempo = 0.9 + rnd() * 0.2;
    const x = piece(src, start, len, p, p / tempo);
    const s0 = Math.round(t * sr);
    const room = Math.min(x.length, Math.round(to * sr) - s0);
    for (let i = 0; i < room; i++) if (s0 + i >= 0 && s0 + i < dst.length) dst[s0 + i] = dst[s0 + i]! + 0.9 * x[i]!;
    t += x.length / sr + gaps[0] + rnd() * (gaps[1] - gaps[0]);
  }
}
function pink(rnd: () => number, n: number): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926; ss += out[i]! * out[i]!;
  }
  const r = Math.sqrt(ss / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) out[i] = out[i]! / r;
  return out;
}
const rms = (x: Float32Array) => { let s = 0, n = 0; for (let i = 0; i < x.length; i++) if (x[i] !== 0) { s += x[i]! * x[i]!; n++; } return Math.sqrt(s / Math.max(1, n)); };
/** A backing loop: a 2 s pattern of four plucked notes, the same every period. */
const loopAt = (t: number) => { const u = ((t % 2) + 2) % 2, k = Math.floor(u / 0.5), v = u - k * 0.5, f = [220, 277.18, 329.63, 440][k]!; return 0.25 * Math.exp(-6 * v) * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t)) + (v < 0.02 ? 0.2 * Math.sin(2 * Math.PI * 3000 * t) : 0); };

/** A picture frame: barcode strip with the group frame in red, the angle index in green; a moving box below it. */
function frame(groupFrame: number, angle: number, k: number): Buffer {
  const buf = Buffer.alloc(WIDTH * HEIGHT * 3), strip = Math.round(HEIGHT * BARCODE.stripFrac), cell = WIDTH / BARCODE.bits;
  const v = ((groupFrame % 65536) + 65536) % 65536, bx = (k * 3) % (WIDTH - 30);
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    const o = (y * WIDTH + x) * 3;
    if (y < strip) { const bit = 15 - Math.floor(x / cell); buf[o] = (v >> bit) & 1 ? 235 : 16; buf[o + 1] = (angle >> bit) & 1 ? 235 : 16; buf[o + 2] = 128; }
    else if (x >= bx && x < bx + 30 && y > HEIGHT / 2 && y < HEIGHT / 2 + 30) buf[o] = buf[o + 1] = buf[o + 2] = 220;
    else { buf[o] = 40 + angle * 25; buf[o + 1] = 60; buf[o + 2] = 90; }
  }
  return buf;
}
const capture = (groupSeconds: number) => new Date(CAPTURE_BASE + Math.floor(groupSeconds) * 1000).toISOString().slice(0, 19);

export async function generateMulticamFixture(o: MulticamFixtureOptions): Promise<MulticamFixture> {
  const sr = o.sampleRate ?? 48000, fps = o.fps ?? { num: 30, den: 1 }, N = Math.round(o.seconds * sr), seconds = N / sr;
  const rnd = mulberry32(o.seed ?? 1);
  if (o.extras && seconds < 60) throw new Error('the extras need a fixture of at least 60 seconds');
  fs.mkdirSync(o.outDir, { recursive: true });
  const src = await decodeMono(o.narrationPath, sr);
  // ---- the room (group time) ----
  const turns: MulticamFixture['turns'] = [];
  const voices = [new Float32Array(N), new Float32Array(N)];
  const breakAt = o.extras ? Math.round(seconds * 0.45) : -1, breakLen = 20;
  const inBreak = (t: number) => breakAt >= 0 && t >= breakAt && t < breakAt + breakLen;
  if (o.dialogue) {
    let t = 0.5, who: 0 | 1 = 0;
    while (t < seconds - 1) {
      const end = Math.min(seconds - 0.5, t + 2 + rnd() * 6);
      if (!inBreak(t)) { turns.push({ speaker: who, startSeconds: Number(t.toFixed(4)), endSeconds: Number(end.toFixed(4)) }); speak(voices[who]!, src, sr, rnd, t, end, who === 1 ? 5 : 0, [0.08, 0.25]); }
      const overlap = rnd() < 0.34;
      t = overlap ? end - (1 + rnd() * 0.5) : end + 0.2 + rnd() * 0.8;
      who = who === 0 ? 1 : 0;
    }
  } else speak(voices[0]!, src, sr, rnd, 0.3, seconds, 0, [0.3, 2]);
  if (breakAt >= 0) for (const v of voices) v.fill(0, breakAt * sr, (breakAt + breakLen) * sr);
  const loopRoom = new Float32Array(N);
  if (breakAt >= 0) for (let i = breakAt * sr; i < (breakAt + breakLen) * sr && i < N; i++) loopRoom[i] = loopAt(i / sr);
  const room = Float32Array.from({ length: N }, (_, i) => 0.7 * (voices[0]![i]! + voices[1]![i]!) + loopRoom[i]!);
  const BLEED = 10 ** (-15 / 20);
  const angles: MulticamFixtureAngle[] = [];
  // ---- 0: the reference recorder ----
  const recPath = path.join(o.outDir, 'recorder.wav');
  const recChans = o.dialogue ? [voices[0]!.map((v, i) => v + BLEED * voices[1]![i]! + loopRoom[i]!), voices[1]!.map((v, i) => v + BLEED * voices[0]![i]! + loopRoom[i]!)] : [room];
  fs.writeFileSync(recPath, wavBytes(recChans, sr));
  angles.push({ label: 'Recorder', kind: 'sound', files: [{ path: recPath, groupStartSamples: 0, captureAt: capture(0) }], truth: { offsetSamples: 0, driftPpm: 0, polarity: 1 }, expect: 'reference' });

  // ---- cameras: sound as heard, picture as the barcode of group frames ----
  const camera = async (index: number, name: string, lengthSamples: number, groupOf: (s: number) => number, sound: (s: number, g: number) => number): Promise<string> => {
    const audio = Float32Array.from({ length: lengthSamples }, (_, s) => sound(s, groupOf(s)));
    const wav = path.join(o.outDir, `${name}.wav`);
    fs.writeFileSync(wav, wavBytes([audio], sr));
    if (o.video === false) return wav;
    const out = path.join(o.outDir, `${name}.mp4`);
    const frames = Math.floor((lengthSamples / sr) * (fps.num / fps.den));
    try {
      await run(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${WIDTH}x${HEIGHT}`, '-framerate', `${fps.num}/${fps.den}`, '-i', 'pipe:0', '-i', wav,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps.num / fps.den)), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', out],
      async (stdin) => {
        for (let k = 0; k < frames; k++) {
          const s = Math.round((k * fps.den * sr) / fps.num), g = groupOf(s) / sr;
          if (!stdin.write(frame(Math.round((g * fps.num) / fps.den), index, k))) await new Promise((r) => stdin.once('drain', r));
        }
      });
    } finally { fs.rmSync(wav, { force: true }); }
    return out;
  };
  const roomAt = (g: number) => at(room, g);
  const camLen = Math.min(N, Math.round(seconds * 0.85 * sr));
  // 1: started 30,000 samples before the recorder
  {
    const off = -30000;
    const file = await camera(1, 'cam1', camLen, (s) => s + off, (_s, g) => 0.9 * roomAt(g));
    angles.push({ label: 'Camera 1', kind: 'picture', files: [{ path: file, groupStartSamples: off, captureAt: capture(off / sr) }], truth: { offsetSamples: off, driftPpm: 0, polarity: 1 }, expect: 'confident' });
  }
  // 2: +57,321 samples, polarity flipped, pink noise at 10 dB SNR
  {
    const off = 57321, len = Math.min(camLen, N - off), noise = pink(rnd, len);
    const clean = Float32Array.from({ length: len }, (_, s) => -roomAt(s + off));
    const k = rms(clean) / 10 ** (10 / 20);
    const file = await camera(2, 'cam2', len, (s) => s + off, (s) => clean[s]! + k * noise[s]!);
    angles.push({ label: 'Camera 2', kind: 'picture', files: [{ path: file, groupStartSamples: off, captureAt: capture(off / sr) }], truth: { offsetSamples: off, driftPpm: 0, polarity: -1 }, expect: 'confident' });
  }
  // 3: +100 ppm, two files split at 60 % of its length
  {
    const off = 24000, ppm = 100, len = Math.min(camLen, Math.floor((N - off) / (1 + ppm * 1e-6)) - 10), cut = Math.round(len * 0.6);
    const g = (s: number) => off + s * (1 + ppm * 1e-6);
    const a = await camera(3, 'cam3a', cut, g, (_s, gg) => 0.9 * roomAt(gg));
    const b = await camera(3, 'cam3b', len - cut, (s) => g(s + cut), (_s, gg) => 0.9 * roomAt(gg));
    angles.push({ label: 'Camera 3', kind: 'picture', files: [{ path: a, groupStartSamples: off, captureAt: capture(off / sr) }, { path: b, groupStartSamples: Math.round(g(cut)), captureAt: capture(g(cut) / sr) }], truth: { offsetSamples: off, driftPpm: ppm, polarity: 1 }, expect: 'confident' });
  }
  if (o.extras) {
    // 4: only the backing loop (periodic), over the music break
    const off4 = (breakAt - 2) * sr, len4 = 25 * sr;
    const f4 = await camera(4, 'cam4-loop', len4, (s) => s + off4, (s) => loopAt((s + off4) / sr));
    angles.push({ label: 'Camera 4 (loop only)', kind: 'picture', files: [{ path: f4, groupStartSamples: off4, captureAt: capture(off4 / sr) }], truth: { offsetSamples: off4, driftPpm: 0, polarity: 1 }, expect: 'ambiguous' });
    // 5: only pink noise
    const len5 = 40 * sr, n5 = pink(rnd, len5);
    const f5 = await camera(5, 'cam5-noise', len5, (s) => s + sr, (s) => 0.08 * n5[s]!);
    angles.push({ label: 'Camera 5 (noise only)', kind: 'picture', files: [{ path: f5, groupStartSamples: sr, captureAt: capture(1) }], truth: { offsetSamples: sr, driftPpm: 0, polarity: 1 }, expect: 'no-shared-sound' });
    // 6: paused for 2 s at 40 % of its length
    const off6 = 3 * sr, len6 = Math.min(Math.round(seconds * 0.6 * sr), N - off6 - 2 * sr), pause = Math.round(len6 * 0.4);
    const g6 = (s: number) => off6 + s + (s >= pause ? 2 * sr : 0);
    const f6 = await camera(6, 'cam6-paused', len6, g6, (_s, gg) => 0.9 * roomAt(gg));
    angles.push({ label: 'Camera 6 (paused inside)', kind: 'picture', files: [{ path: f6, groupStartSamples: off6, captureAt: capture(off6 / sr) }], truth: { offsetSamples: off6, driftPpm: 0, polarity: 1 }, expect: 'inconsistent' });
  }
  return { sampleRate: sr, fps, angles, turns };
}
