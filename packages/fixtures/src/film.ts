/**
 * Fixtures of the family film proof and the moments job tests (ADR-0026): generateFilmFixtures({ outDir }) writes six clips,
 * one still, a 120 BPM accented music loop and truth.json. Every number is fixed in FILM_FIXTURE, so the truth comes from these
 * formulas and never from the code under test (this file imports nothing from core or the server). Deterministic: the pictures
 * and sounds are computed with integer hashing and + − × /, and encoded with pinned settings in one thread.
 * Tests import this file by relative path (apps/server has no @pulseframe/fixtures dependency).
 *
 * Picture (640×360, 30 fps, written as raw yuv420p, limited range, tagged BT.709):
 * - A CHROMA-ONLY barcode in the top sixth carries (clip << 12 | frame). Its two cell colours have the SAME luma (one Y value,
 *   FILM_BARCODE.y) and, decoded with BT.709 or BT.601, the same relative luminance within 0.001 and neither is saturated red,
 *   so the grey measurement of the moments job and the photosensitivity analyser do not see it (the shared barcodeFrame of
 *   index.ts paints a 16/235 strip, which the tracking proof found to be a flash by itself). It is read from decoded RGB with
 *   readFilmBarcode (readBarcodeChannel of index.ts on the blue channel). A flat grey gutter of 4 rows (the strip's grey)
 *   keeps the strip's macroblocks clear of the picture below.
 * - Below it: a static value-noise texture (lattices 16, 8 and 4 px). A truth window is a bright disc moving on a circle over
 *   that texture; the whip-pan decoy pans the whole texture at FILM_FIXTURE.decoyPxPerFrame (1219 permille of the width per
 *   second, over the 1200 the verifier asked for); the dark stretch is grey 4 everywhere below the strip, so the whole frame's
 *   mean grey is under 20 even with the strip.
 * Sound (48 kHz stereo, both channels equal; AAC): uniform noise of peak 0.01 (−40 dBFS) over the whole file, and 1 kHz bursts
 * of 150 ms every 500 ms at amplitude 0.5 (−6 dBFS) over the truth window. Sound time t belongs to video frame t·30 − offset.
 * The music loop has no energy at 1 kHz: an accented click on every beat (220 Hz on the bar's first beat, 110 Hz otherwise).
 *
 * Clips (names in alphabetical order; capture times in a different order):
 * film-a 14 s, its picture starts 0.5 s late (15 frames; video input remuxed with -itsoffset), truth [4 s, 10 s);
 * film-b 15 s, whip-pan decoy [1.5 s, 3 s), truth [7 s, 13 s);  film-c 13 s, truth [2.5 s, 8.5 s), dark [9.5 s, 12 s);
 * film-d 16 s, no sound, truth [5 s, 11 s);  film-e 12 s, static and silent (no sound stream), no truth;
 * film-f 12 s, constant noise, the disc moves from 1.8 s to the end (85 % active; see activeShare), no truth window.
 * Truth frames are frames of the video stream (source frames), half-open. Capture: the clips carry the UTC instant in the
 * container's creation_time (the life line shows it on the home zone's wall clock, Israel = UTC+2 in December); the still
 * carries its wall clock in its file name (IMG_YYYYMMDD_HHMMSS, read as approximate). The day is Tuesday 16 December 2025
 * (26 Kislev 5786, the second day of Hanukkah; checked with core's calendar and the Intl Hebrew calendar in
 * packages/evals/src/family-film-fixture.test.ts), mid-morning, so no evening rule applies. It lies in the past, so the upload
 * reads these dates (a capture date more than 48 hours after the import is refused as a wrong clock).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { BARCODE, readBarcodeChannel } from './index.ts';

export interface FilmFixtureTruth {
  clips: { name: string; clip: number; frames: number; rate: { num: number; den: number }; startOffsetFrames: number; sound: boolean;
    truth: { fromFrame: number; toFrame: number } | null; decoy: { fromFrame: number; toFrame: number } | null; dark: { fromFrame: number; toFrame: number } | null;
    activeShare: number; capture: string }[];
  still: { name: string; capture: string };
  /** The music loop (no energy at 1 kHz): beats from 0 s, bar starts every `meter` beats. */
  music?: { name: string; bpm: number; meter: number; seconds: number };
}

interface ClipSpec { name: string; seconds: number; sound: boolean; offset: number; truth?: [number, number]; decoy?: [number, number]; dark?: [number, number]; activeFrom?: number; capture: string }
export const FILM_FIXTURE = {
  width: 640, height: 360, fps: { num: 30, den: 1 }, sampleRate: 48000,
  disc: { radius: 40, grey: 235, centre: { x: 320, y: 200 }, path: 60, radPerFrame: 0.15 },
  decoyPxPerFrame: 26,
  noisePeak: 0.01, burst: { amplitude: 0.5, hz: 1000, onMs: 150, everyMs: 500 },
  darkGrey: 4,
  clips: [
    { name: 'film-a.mp4', seconds: 14, sound: true, offset: 15, truth: [4, 10], capture: '2025-12-16T08:09:00.000000Z' },
    { name: 'film-b.mp4', seconds: 15, sound: true, offset: 0, truth: [7, 13], decoy: [1.5, 3], capture: '2025-12-16T08:00:00.000000Z' },
    { name: 'film-c.mp4', seconds: 13, sound: true, offset: 0, truth: [2.5, 8.5], dark: [9.5, 12], capture: '2025-12-16T08:20:00.000000Z' },
    { name: 'film-d.mp4', seconds: 16, sound: false, offset: 0, truth: [5, 11], capture: '2025-12-16T08:04:00.000000Z' },
    { name: 'film-e.mp4', seconds: 12, sound: false, offset: 0, capture: '2025-12-16T08:26:00.000000Z' },
    { name: 'film-f.mp4', seconds: 12, sound: true, offset: 0, activeFrom: 1.8, capture: '2025-12-16T08:13:00.000000Z' },
  ] as ClipSpec[],
  still: { name: 'IMG_20251216_102300.png', capture: '2025-12-16T10:23:00' },
  music: { name: 'music-120bpm.m4a', bpm: 120, meter: 4, seconds: 96 },
} as const;

/**
 * The barcode strip: Y (limited range) of both cell colours, and their chroma. Decoded (BT.709 limited) bit 1 ≈ RGB(87, 65, 207),
 * bit 0 ≈ RGB(152, 63, 42); relative luminance 0.1038 both (BT.601 decode: 0.0884 both). Bits are read on the blue channel.
 */
export const FILM_BARCODE = { y: 85, grey: 80, one: { u: 188, v: 132 }, zero: { u: 110, v: 168 }, channel: 2 as const, gutterRows: 4 } as const;
/** The frame value of the barcode (16 bits). */
export const filmBarcodeValue = (clip: number, frame: number) => ((clip << 12) | frame) & 0xffff;
/** Read the film barcode from packed RGB(A) pixels (rect: where the 640×360 picture sits in the image). */
export const readFilmBarcode = (pixels: Uint8Array, stride: number, channels: number, rect: { x: number; y: number; w: number; h: number }) => readBarcodeChannel(pixels, stride, channels, rect, FILM_BARCODE.channel);

/** Full-range grey 0..255 to limited-range Y. */
const yOf = (g: number) => 16 + Math.round((Math.max(0, Math.min(255, g)) * 219) / 255);
const hash = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);
function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy), fx = smooth(gx - ix), fy = smooth(gy - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
/** The static texture's grey at (x, y): about 75..181. */
export const filmTexture = (seed: number) => (x: number, y: number) => 128 + 50 * (valueNoise(x, y, 16, seed) - 0.5) + 35 * (valueNoise(x, y, 8, seed + 1) - 0.5) + 25 * (valueNoise(x, y, 4, seed + 2) - 0.5);

const F = FILM_FIXTURE;
const strip = Math.round(F.height * BARCODE.stripFrac); // 60
const top = strip + FILM_BARCODE.gutterRows; // 64: first picture row
const fr = (s: number) => Math.round(s * F.fps.num / F.fps.den);
const range = (r?: readonly [number, number]) => (r ? { fromFrame: fr(r[0]), toFrame: fr(r[1]) } : null);

/** The truth of every clip, from FILM_FIXTURE alone. */
export function filmFixtureTruth(): FilmFixtureTruth {
  return {
    clips: F.clips.map((c, clip) => {
      const frames = fr(c.seconds);
      const activeShare = c.activeFrom !== undefined ? (frames - fr(c.activeFrom)) / frames : c.truth ? (fr(c.truth[1]) - fr(c.truth[0])) / frames : 0;
      return { name: c.name, clip, frames, rate: { ...F.fps }, startOffsetFrames: c.offset, sound: c.sound, truth: range(c.truth), decoy: range(c.decoy), dark: range(c.dark), activeShare: Math.round(activeShare * 1000) / 1000, capture: c.capture };
    }),
    still: { ...F.still },
    music: { ...F.music },
  };
}

/** Where the disc is on video frame f (continuous pixels), or null when no disc is shown. */
export function filmDisc(clip: number, f: number): { cx: number; cy: number; r: number } | null {
  const c = F.clips[clip]!;
  const on = (c.truth && f >= fr(c.truth[0]) && f < fr(c.truth[1])) || (c.activeFrom !== undefined && f >= fr(c.activeFrom));
  if (!on || (c.dark && f >= fr(c.dark[0]) && f < fr(c.dark[1]))) return null;
  const a = f * F.disc.radPerFrame;
  return { cx: F.disc.centre.x + F.disc.path * Math.cos(a), cy: F.disc.centre.y + F.disc.path * Math.sin(a), r: F.disc.radius };
}
/** The decoy's horizontal texture offset on frame f (it stays where the pan ended). */
const panOffset = (c: ClipSpec, f: number) => (c.decoy ? F.decoyPxPerFrame * Math.max(0, Math.min(f, fr(c.decoy[1])) - fr(c.decoy[0]) + (f >= fr(c.decoy[0]) ? 1 : 0)) : 0);

/** One video frame of a clip as raw yuv420p (Y 640×360, then U and V 320×180). */
function frameYuv(clip: number, f: number, plane: { w: number; y: Uint8Array }): Buffer {
  const W = F.width, H = F.height, c = F.clips[clip]!;
  const buf = Buffer.alloc((W * H * 3) / 2);
  const Y = buf.subarray(0, W * H), U = buf.subarray(W * H, W * H + (W * H) / 4), V = buf.subarray(W * H + (W * H) / 4);
  Y.fill(FILM_BARCODE.y, 0, top * W);
  const dark = c.dark && f >= fr(c.dark[0]) && f < fr(c.dark[1]);
  if (dark) Y.fill(yOf(F.darkGrey), top * W);
  else {
    const ox = panOffset(c, f);
    for (let y = top; y < H; y++) Y.set(plane.y.subarray((y - top) * plane.w + ox, (y - top) * plane.w + ox + W), y * W);
    const d = filmDisc(clip, f);
    if (d) {
      const yd = yOf(F.disc.grey);
      for (let y = Math.max(top, Math.floor(d.cy - d.r)); y <= Math.min(H - 1, Math.ceil(d.cy + d.r)); y++)
        for (let x = Math.max(0, Math.floor(d.cx - d.r)); x <= Math.min(W - 1, Math.ceil(d.cx + d.r)); x++)
          if ((x + 0.5 - d.cx) ** 2 + (y + 0.5 - d.cy) ** 2 <= d.r * d.r) Y[y * W + x] = yd;
    }
  }
  U.fill(128); V.fill(128);
  const value = filmBarcodeValue(clip, f), cw = W / 2 / BARCODE.bits; // 20 chroma pixels a cell
  for (let y = 0; y < strip / 2; y++)
    for (let x = 0; x < W / 2; x++) {
      const bit = (value >> (BARCODE.bits - 1 - Math.floor(x / cw))) & 1;
      U[y * (W / 2) + x] = bit ? FILM_BARCODE.one.u : FILM_BARCODE.zero.u;
      V[y * (W / 2) + x] = bit ? FILM_BARCODE.one.v : FILM_BARCODE.zero.v;
    }
  return buf;
}
function texturePlane(clip: number, extra: number): { w: number; y: Uint8Array } {
  const t = filmTexture(101 + 17 * clip), w = F.width + extra, h = F.height - top, y = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) y[j * w + i] = yOf(t(i, j + top));
  return { w, y };
}

/** Mono samples of a clip's sound over the whole file (from the file's own start: video frame f is at (f + offset) / 30 s). */
export function filmClipSamples(clip: number): Float32Array | null {
  const c = F.clips[clip]!;
  if (!c.sound) return null;
  const sr = F.sampleRate, n = Math.round(((fr(c.seconds) + c.offset) * sr * F.fps.den) / F.fps.num), out = new Float32Array(n);
  let seed = 0x9e3779b9 ^ (clip * 7919);
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) out[i] = F.noisePeak * (2 * rnd() - 1);
  if (c.truth) {
    const t0 = (fr(c.truth[0]) + c.offset) / 30, t1 = (fr(c.truth[1]) + c.offset) / 30, b = F.burst, ramp = Math.round(0.005 * sr);
    for (let start = t0; start + b.onMs / 1000 <= t1 + 1e-9; start += b.everyMs / 1000) {
      const s0 = Math.round(start * sr), s1 = s0 + Math.round((b.onMs / 1000) * sr);
      for (let s = s0; s < s1 && s < n; s++) {
        const env = Math.min(1, (s - s0) / ramp, (s1 - s) / ramp);
        out[s] = out[s]! + b.amplitude * env * Math.sin((2 * Math.PI * b.hz * (s - s0)) / sr);
      }
    }
  }
  return out;
}
/** The music loop: an accented click on every beat at 120 BPM (220 Hz on the bar's first beat, 110 Hz otherwise), no 1 kHz energy. */
export function filmMusicSamples(): Float32Array {
  const sr = F.sampleRate, m = F.music, n = m.seconds * sr, out = new Float32Array(n), beat = (60 / m.bpm) * sr, len = Math.round(0.12 * sr);
  for (let k = 0; k * beat < n; k++) {
    const s0 = Math.round(k * beat), hz = k % m.meter === 0 ? 220 : 110, amp = k % m.meter === 0 ? 0.6 : 0.3;
    for (let s = s0; s < Math.min(n, s0 + len); s++) out[s] = amp * Math.exp(-(s - s0) / (0.03 * sr)) * Math.sin((2 * Math.PI * hz * (s - s0)) / sr);
  }
  return out;
}
function wav16(samples: Float32Array, sr: number): Buffer {
  const n = samples.length, buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  return buf;
}
const ffmpeg = (args: string[], feed?: (stdin: NodeJS.WritableStream) => Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-y', ...args].filter((a) => !(feed && a === '-nostdin')), { stdio: [feed ? 'pipe' : 'ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr!.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-500)}`))));
    if (feed) { p.stdin!.on('error', () => {}); feed(p.stdin!).then(() => p.stdin!.end(), reject); }
  });
const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** Write the clips, the still, the music and truth.json into outDir. */
export async function generateFilmFixtures(opts: { outDir: string }): Promise<FilmFixtureTruth> {
  const out = opts.outDir;
  fs.mkdirSync(out, { recursive: true });
  const truth = filmFixtureTruth();
  for (const [clip, c] of F.clips.entries()) {
    const frames = fr(c.seconds), plane = texturePlane(clip, c.decoy ? F.decoyPxPerFrame * (fr(c.decoy[1]) - fr(c.decoy[0]) + 1) : 0);
    const video = path.join(out, `.${clip}.video.mp4`), wav = path.join(out, `.${clip}.wav`);
    try {
      await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-video_size', `${F.width}x${F.height}`, '-framerate', `${F.fps.num}/${F.fps.den}`, ...BT709, '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-bf', '2', '-g', '30', '-threads', '1', '-pix_fmt', 'yuv420p', ...BT709, '-an', '-fflags', '+bitexact', '-flags:v', '+bitexact', video],
      async (stdin) => { for (let f = 0; f < frames; f++) if (!stdin.write(frameYuv(clip, f, plane))) await new Promise((r) => stdin.once('drain', r)); });
      const samples = filmClipSamples(clip);
      if (samples) fs.writeFileSync(wav, wav16(samples, F.sampleRate));
      await ffmpeg([...(c.offset ? ['-itsoffset', String(c.offset / 30)] : []), '-i', video, ...(samples ? ['-i', wav] : []), '-map', '0:v:0', ...(samples ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '160k'] : []), '-c:v', 'copy',
        '-metadata', `creation_time=${c.capture}`, '-movflags', '+faststart', '-fflags', '+bitexact', path.join(out, c.name)]);
    } finally {
      fs.rmSync(video, { force: true });
      fs.rmSync(wav, { force: true });
    }
  }
  // the still: the texture and the barcode of clip 6, frame 0, in RGB (the same decoded colours)
  const still = Buffer.alloc(F.width * F.height * 3), t = filmTexture(999), value = filmBarcodeValue(F.clips.length, 0);
  for (let y = 0; y < F.height; y++)
    for (let x = 0; x < F.width; x++) {
      const o = (y * F.width + x) * 3;
      if (y < strip) { const bit = (value >> (BARCODE.bits - 1 - Math.floor(x / (F.width / BARCODE.bits)))) & 1; still.set(bit ? [87, 65, 207] : [152, 63, 42], o); }
      else if (y < top) still.fill(FILM_BARCODE.grey, o, o + 3);
      else still.fill(Math.round(t(x, y)), o, o + 3);
    }
  await ffmpeg(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${F.width}x${F.height}`, '-i', 'pipe:0', '-frames:v', '1', '-fflags', '+bitexact', path.join(out, F.still.name)], async (stdin) => { stdin.write(still); });
  const mwav = path.join(out, '.music.wav');
  try {
    fs.writeFileSync(mwav, wav16(filmMusicSamples(), F.sampleRate));
    await ffmpeg(['-i', mwav, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-fflags', '+bitexact', path.join(out, F.music.name)]);
  } finally { fs.rmSync(mwav, { force: true }); }
  fs.writeFileSync(path.join(out, 'truth.json'), JSON.stringify(truth, null, 1) + '\n');
  return truth;
}
