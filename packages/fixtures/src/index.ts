/**
 * Procedural media fixtures with independent truth (SPEC Appendix C3).
 * Every video frame carries its own index as a 16-bit barcode; audio has a 1 kHz beep
 * at each whole second together with a visible flash, so A/V sync is measurable.
 * Generated on demand (not committed): deterministic input, pinned encoder settings.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BarcodeFixtureOptions { out: string; width?: number; height?: number; fps?: { num: number; den: number }; frames?: number; sampleRate?: number;
  /** Video codec (default h264). */ codec?: 'h264' | 'vp9' | 'av1';
  /** Container (default mp4; mp4 gets AAC, webm gets Opus). Muxing vp9/av1 into mp4 is supported by ffmpeg. */ container?: 'mp4' | 'webm';
  /** B-frames, h264 only (default 2). */ bframes?: number;
  /** Keyframe interval in frames (default: rounded fps, i.e. 1 s). */ gop?: number }
export const BARCODE = { bits: 16, stripFrac: 1 / 6 } as const;

const run = (cmd: string, args: string[], feed?: (stdin: NodeJS.WritableStream) => Promise<void>) =>
  new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-500)}`))));
    p.stdin.on('error', () => {});
    (feed ? feed(p.stdin) : Promise.resolve()).then(() => p.stdin.end(), reject);
  });

export function barcodeFrame(index: number, width: number, height: number, fpsRounded: number): Buffer {
  const buf = Buffer.alloc(width * height * 3);
  const strip = Math.round(height * BARCODE.stripFrac);
  const cell = width / BARCODE.bits;
  const hue = (index * 7) % 360;
  const [r, g, b] = hsl(hue, 0.55, 0.35);
  const box = Math.round(height / 6);
  const bx = Math.round(((index * 9) % (width - box)));
  const by = strip + Math.round((height - strip - box) / 2);
  const flash = index % fpsRounded < 2;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      if (y < strip) {
        const bit = (index >> (BARCODE.bits - 1 - Math.floor(x / cell))) & 1;
        buf[o] = buf[o + 1] = buf[o + 2] = bit ? 235 : 16;
      } else if (x >= bx && x < bx + box && y >= by && y < by + box) {
        buf[o] = buf[o + 1] = buf[o + 2] = 235;
      } else if (flash && y > height - box / 2) {
        buf[o] = 235; buf[o + 1] = 219; buf[o + 2] = 16;
      } else {
        buf[o] = r; buf[o + 1] = g; buf[o + 2] = b;
      }
    }
  return buf;
}
function hsl(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

/** Read the frame-index barcode from packed RGB(A) pixels, given where the source picture sits in the image. */
export function readBarcode(pixels: Uint8Array, stride: number, channels: number, rect: { x: number; y: number; w: number; h: number }): number {
  return barcodeBits(rect, (o) => (pixels[o * channels]! + pixels[o * channels + 1]! + pixels[o * channels + 2]!) / 3, stride);
}
/**
 * Read the frame-index barcode from one colour channel only (0 red, 1 green, 2 blue). A picture whose channels come from
 * different moments (time.split) carries one barcode per channel.
 */
export function readBarcodeChannel(pixels: Uint8Array, stride: number, channels: number, rect: { x: number; y: number; w: number; h: number }, channel: 0 | 1 | 2): number {
  return barcodeBits(rect, (o) => pixels[o * channels + channel]!, stride);
}
/** The 16 bits of the barcode strip, sampled at the middle of each cell; `level(o)` is the brightness at pixel offset o. */
function barcodeBits(rect: { x: number; y: number; w: number; h: number }, level: (offset: number) => number, stride: number): number {
  let value = 0;
  const y = Math.round(rect.y + (rect.h * BARCODE.stripFrac) / 2);
  for (let i = 0; i < BARCODE.bits; i++) {
    const x = Math.round(rect.x + ((i + 0.5) * rect.w) / BARCODE.bits);
    value = (value << 1) | (level(y * stride + x) > 128 ? 1 : 0);
  }
  return value;
}

function beepWav(seconds: number, sampleRate: number): Buffer {
  const n = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(n * 4);
  const beep = Math.round(0.1 * sampleRate);
  for (let i = 0; i < n; i++) {
    const inSecond = i % sampleRate;
    // 1 kHz beep for the first 100 ms of every second (hard onset = measurable), silence elsewhere.
    const v = inSecond < beep ? Math.round(Math.sin((2 * Math.PI * 1000 * inSecond) / sampleRate) * 0.5 * 32767) : 0;
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** The grey level of frame `index` of the grey fixture: every level is used, neighbouring frames differ by a lot, never black or white. */
export const greyLevel = (index: number) => 40 + ((index * 53) % 176);
export interface GreyFixtureOptions { out: string; frames?: number; fps?: { num: number; den: number }; width?: number; height?: number }
/**
 * A video whose frame F is one flat grey, greyLevel(F), all over: H.264 at -qp 0 (lossless), no sound. A flat picture
 * decodes flat at any quality, so a merge of earlier frames (time.echo) can be checked exactly against the levels the same
 * decoder gives for each frame on its own.
 */
export async function generateGreyFixture(o: GreyFixtureOptions) {
  const width = o.width ?? 320, height = o.height ?? 180, frames = o.frames ?? 120, fps = o.fps ?? { num: 30, den: 1 };
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  await run(
    'ffmpeg',
    ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', `${fps.num}/${fps.den}`, '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', 'medium', '-qp', '0', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps.num / fps.den)), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-an', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', o.out],
    async (stdin) => {
      for (let i = 0; i < frames; i++) if (!stdin.write(Buffer.alloc(width * height * 3, greyLevel(i)))) await new Promise((r) => stdin.once('drain', r));
    },
  );
  return { file: o.out, width, height, fps, frames, levels: Array.from({ length: frames }, (_, i) => greyLevel(i)) };
}

/** Default: H.264 (High, B-frames, 1 s GOP) + AAC in MP4. See options for VP9/AV1, webm, B-frames and GOP. */
export async function generateBarcodeFixture(o: BarcodeFixtureOptions) {
  const width = o.width ?? 640;
  const height = o.height ?? 360;
  const fps = o.fps ?? { num: 30, den: 1 };
  const frames = o.frames ?? 120;
  const sampleRate = o.sampleRate ?? 48000;
  const fpsRounded = Math.round(fps.num / fps.den);
  const codec = o.codec ?? 'h264';
  const container = o.container ?? 'mp4';
  const bframes = o.bframes ?? 2;
  const gop = o.gop ?? fpsRounded;
  const videoArgs =
    codec === 'h264' ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-bf', String(bframes)]
    : codec === 'vp9' ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1']
    : ['-c:v', 'libsvtav1', '-crf', '20', '-preset', '8'];
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const wav = `${o.out}.wav`;
  fs.writeFileSync(wav, beepWav((frames * fps.den) / fps.num, sampleRate));
  try {
    await run(
      'ffmpeg',
      ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', `${fps.num}/${fps.den}`, '-i', 'pipe:0', '-i', wav,
        ...videoArgs, '-pix_fmt', 'yuv420p', '-g', String(gop), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', container === 'webm' ? 'libopus' : 'aac', '-b:a', '160k', ...(container === 'mp4' ? ['-movflags', '+faststart'] : []), '-fflags', '+bitexact', '-flags:v', '+bitexact', o.out],
      async (stdin) => {
        for (let i = 0; i < frames; i++) if (!stdin.write(barcodeFrame(i, width, height, fpsRounded))) await new Promise((r) => stdin.once('drain', r));
      },
    );
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return { file: o.out, width, height, fps, frames, sampleRate, codec, container, bframes: codec === 'h264' ? bframes : null, gop, beepEverySeconds: 1, beepMs: 100 };
}

// ---------- motion tracking (ADR-0015) ----------
/**
 * The motion tracking fixture: a textured disc moving over a static noise background on a Lissajous path, growing and
 * shrinking, hidden for 20 frames, and an identical look-alike that appears far away while it is hidden. No real face or
 * person is used anywhere. Every number is fixed here, so the truth is computed from these formulas and never from the
 * code under test. Coordinates are continuous frame pixels: pixel i spans [i, i+1), so a point's u (0..1 of the width) is
 * cx / width and the picture's centre is (width/2, height/2).
 */
export const TRACKING_FIXTURE = {
  width: 1280, height: 720, fps: { num: 30, den: 1 }, frames: 240,
  /** Radius of the disc at scale 1; its scale is 1 + 0.2·sin(2πf/240), between 0.8 and 1.2. */
  radius: 70,
  /** Frames during which an opaque flat square hides the disc completely (inclusive). */
  occluded: { from: 150, to: 169 },
  /** The look-alike: the disc's own texture at a fixed place and scale, shown from `from` to `to` (inclusive). */
  decoy: { cx: 180, cy: 560, scale: 0.85, from: 160, to: 239 },
  /** Seed of the static background noise (mulberry32). */
  seed: 15,
  /** 4×4 samples per pixel on the edges of the disc. */
  supersample: 4,
} as const;
export interface TrackingTruth { cx: number; cy: number; r: number; occluded: boolean }

/** Where the disc is on frame f (TRACKING_FIXTURE): cx = 640 + 380·sin(3πf/240), cy = 420 + 150·sin(4πf/240 + 0.6), r = 70·(1 + 0.2·sin(2πf/240)). */
export function trackingTruth(f: number): TrackingTruth {
  const F = TRACKING_FIXTURE;
  return {
    cx: 640 + 380 * Math.sin((3 * Math.PI * f) / 240),
    cy: 420 + 150 * Math.sin((4 * Math.PI * f) / 240 + 0.6),
    r: F.radius * (1 + 0.2 * Math.sin((2 * Math.PI * f) / 240)),
    occluded: f >= F.occluded.from && f <= F.occluded.to,
  };
}

/** mulberry32: a small seeded generator (deterministic on every machine). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The colours of the disc's texture: strong contrasts, none of them magenta (a magenta sticker is measured over it). */
const DISC_PALETTE: readonly (readonly [number, number, number])[] = [[236, 142, 40], [28, 150, 160], [244, 232, 200], [26, 28, 38], [44, 84, 206], [120, 200, 70]];
const LATTICE = 7;
let discLattice: [number, number, number][] | null = null;
/** The disc's texture at (u, v) in disc units (−1..1 across its diameter): seeded colour cells blended bilinearly, a dark rim. */
function discColour(u: number, v: number): [number, number, number] {
  if (!discLattice) {
    const r = mulberry32(TRACKING_FIXTURE.seed * 7919 + 1);
    discLattice = Array.from({ length: (LATTICE + 1) * (LATTICE + 1) }, () => [...DISC_PALETTE[Math.floor(r() * DISC_PALETTE.length)]!] as [number, number, number]);
  }
  const gx = ((u + 1) / 2) * LATTICE, gy = ((v + 1) / 2) * LATTICE;
  const x0 = Math.max(0, Math.min(LATTICE - 1, Math.floor(gx))), y0 = Math.max(0, Math.min(LATTICE - 1, Math.floor(gy)));
  const fx = Math.max(0, Math.min(1, gx - x0)), fy = Math.max(0, Math.min(1, gy - y0));
  const at = (x: number, y: number) => discLattice![y * (LATTICE + 1) + x]!;
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  const rim = u * u + v * v > 0.86 * 0.86 ? 0.35 : 1;
  return [0, 1, 2].map((k) => rim * ((a[k]! * (1 - fx) + b[k]! * fx) * (1 - fy) + (c[k]! * (1 - fx) + d[k]! * fx) * fy)) as [number, number, number];
}

let trackingBackground: Buffer | null = null;
/** The static background: grey noise in 4×4-pixel cells (levels 70..150), the same on every frame. */
function backgroundOf(): Buffer {
  if (trackingBackground) return trackingBackground;
  const { width: W, height: H, seed } = TRACKING_FIXTURE;
  const r = mulberry32(seed);
  const cols = Math.ceil(W / 4), rows = Math.ceil(H / 4);
  const cells = Array.from({ length: cols * rows }, () => 70 + Math.floor(r() * 81));
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) { const v = cells[(y >> 2) * cols + (x >> 2)]!; const o = (y * W + x) * 3; buf[o] = buf[o + 1] = buf[o + 2] = v; }
  return (trackingBackground = buf);
}

/**
 * Draw a textured disc of radius r centred at (cx, cy) over `buf`, with S×S samples per pixel; `coverage` (optional) gets the
 * fraction of each pixel's samples that fall inside the disc.
 */
function drawDisc(buf: Buffer, W: number, H: number, cx: number, cy: number, r: number, coverage?: Float32Array) {
  const S = TRACKING_FIXTURE.supersample;
  const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const o = (y * W + x) * 3;
      let n = 0, R = 0, G = 0, B = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const dx = x + (i + 0.5) / S - cx, dy = y + (j + 0.5) / S - cy;
          if (dx * dx + dy * dy > r2) continue;
          const c = discColour(dx / r, dy / r);
          R += c[0]; G += c[1]; B += c[2]; n++;
        }
      if (!n) continue;
      const k = n / (S * S), out = 1 - k;
      buf[o] = Math.round(R / (S * S) + buf[o]! * out);
      buf[o + 1] = Math.round(G / (S * S) + buf[o + 1]! * out);
      buf[o + 2] = Math.round(B / (S * S) + buf[o + 2]! * out);
      if (coverage) coverage[y * W + x] = k;
    }
}

/** Grey level of the flat background variant (no texture around the disc: an echo's ghosts can be measured on their own). */
export const FLAT_LEVEL = 110;
/**
 * Frame `index` of the tracking fixture as packed RGB, before encoding: background, frame-index barcode (top sixth), the
 * look-alike (frames 160–239), the disc, and over frames 150–169 a flat grey square (side 3r) that hides the disc.
 * With `coverage`, also the disc's own coverage per pixel (0..1, the look-alike and the square left out), from which its
 * centroid can be measured independently of the truth formulas.
 */
export function trackingFrame(index: number, o: { coverage?: boolean; background?: 'noise' | 'flat' } = {}): { rgb: Buffer; coverage?: Float32Array } {
  const F = TRACKING_FIXTURE, W = F.width, H = F.height;
  const rgb = o.background === 'flat' ? Buffer.alloc(W * H * 3, FLAT_LEVEL) : Buffer.from(backgroundOf());
  const strip = Math.round(H * BARCODE.stripFrac), cell = W / BARCODE.bits;
  for (let y = 0; y < strip; y++)
    for (let x = 0; x < W; x++) { const bit = (index >> (BARCODE.bits - 1 - Math.floor(x / cell))) & 1; const p = (y * W + x) * 3; rgb[p] = rgb[p + 1] = rgb[p + 2] = bit ? 235 : 16; }
  if (index >= F.decoy.from && index <= F.decoy.to) drawDisc(rgb, W, H, F.decoy.cx, F.decoy.cy, F.radius * F.decoy.scale);
  const t = trackingTruth(index);
  const coverage = o.coverage ? new Float32Array(W * H) : undefined;
  drawDisc(rgb, W, H, t.cx, t.cy, t.r, coverage);
  if (t.occluded) {
    const half = 1.5 * t.r;
    for (let y = Math.max(0, Math.floor(t.cy - half)); y < Math.min(H, Math.ceil(t.cy + half)); y++)
      for (let x = Math.max(0, Math.floor(t.cx - half)); x < Math.min(W, Math.ceil(t.cx + half)); x++) { const p = (y * W + x) * 3; rgb[p] = rgb[p + 1] = rgb[p + 2] = 128; }
  }
  return { rgb, ...(coverage ? { coverage } : {}) };
}

/** Distance from the look-alike to the disc on frame f, or null when the look-alike is not shown. */
export function decoyDistance(f: number): number | null {
  const d = TRACKING_FIXTURE.decoy;
  if (f < d.from || f > d.to) return null;
  const t = trackingTruth(f);
  return Math.hypot(t.cx - d.cx, t.cy - d.cy);
}

export interface TrackingFixtureOptions { out: string; /** default: `<out without extension>.truth.json` */ truthOut?: string; /** 'flat': the same disc, occluder and look-alike on a flat grey background (FLAT_LEVEL). Default 'noise'. */ background?: 'noise' | 'flat' }
/**
 * Encode the tracking fixture (TRACKING_FIXTURE: 1280×720, 30 fps, 240 frames) as H.264 CRF 14 with 2 B-frames and a 1 s GOP,
 * with AAC sound (the beep track of the barcode fixture), and write its truth: per frame { cx, cy, r, occluded } in frame
 * pixels, plus the look-alike and the occlusion. The look-alike never comes within 400 px of the disc (checked here).
 */
export async function generateTrackingFixture(o: TrackingFixtureOptions) {
  const F = TRACKING_FIXTURE, W = F.width, H = F.height, fps = F.fps;
  for (let f = 0; f < F.frames; f++) { const d = decoyDistance(f); if (d !== null && d < 400) throw new Error(`tracking fixture: the look-alike is ${d.toFixed(1)} px from the disc on frame ${f}`); }
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const truthFile = o.truthOut ?? o.out.replace(/\.[^.\\/]+$/, '') + '.truth.json';
  const truth = Array.from({ length: F.frames }, (_, f) => trackingTruth(f));
  const wav = `${o.out}.wav`;
  fs.writeFileSync(wav, beepWav((F.frames * fps.den) / fps.num, 48000));
  try {
    await run(
      'ffmpeg',
      ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${W}x${H}`, '-framerate', `${fps.num}/${fps.den}`, '-i', 'pipe:0', '-i', wav,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-bf', '2', '-pix_fmt', 'yuv420p', '-g', String(Math.round(fps.num / fps.den)), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', o.out],
      async (stdin) => {
        for (let i = 0; i < F.frames; i++) if (!stdin.write(trackingFrame(i, { background: o.background ?? 'noise' }).rgb)) await new Promise((r) => stdin.once('drain', r));
      },
    );
  } finally {
    fs.rmSync(wav, { force: true });
  }
  const meta = { width: W, height: H, fps, frames: F.frames, background: o.background ?? 'noise', coordinates: 'continuous frame pixels: pixel i spans [i, i+1); u = cx / width', radius: F.radius, occluded: F.occluded, decoy: { ...F.decoy, r: F.radius * F.decoy.scale }, truth };
  fs.writeFileSync(truthFile, JSON.stringify(meta, null, 1) + '\n');
  return { file: o.out, truthFile, width: W, height: H, fps, frames: F.frames, codec: 'h264' as const, bframes: 2, truth, occluded: F.occluded, decoy: meta.decoy };
}
