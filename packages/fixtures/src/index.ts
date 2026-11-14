/**
 * Procedural media fixtures with independent truth (SPEC Appendix C3).
 * Every video frame carries its own index as a 16-bit barcode; audio has a 1 kHz beep
 * at each whole second together with a visible flash, so A/V sync is measurable.
 * Generated on demand (not committed): deterministic input, pinned encoder settings.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BarcodeFixtureOptions { out: string; width?: number; height?: number; fps?: { num: number; den: number }; frames?: number; sampleRate?: number }
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
  let value = 0;
  const y = Math.round(rect.y + (rect.h * BARCODE.stripFrac) / 2);
  for (let i = 0; i < BARCODE.bits; i++) {
    const x = Math.round(rect.x + ((i + 0.5) * rect.w) / BARCODE.bits);
    const o = (y * stride + x) * channels;
    value = (value << 1) | ((pixels[o]! + pixels[o + 1]! + pixels[o + 2]!) / 3 > 128 ? 1 : 0);
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

/** H.264 (High, B-frames, 1 s GOP) + AAC in MP4. */
export async function generateBarcodeFixture(o: BarcodeFixtureOptions) {
  const width = o.width ?? 640;
  const height = o.height ?? 360;
  const fps = o.fps ?? { num: 30, den: 1 };
  const frames = o.frames ?? 120;
  const sampleRate = o.sampleRate ?? 48000;
  const fpsRounded = Math.round(fps.num / fps.den);
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  const wav = `${o.out}.wav`;
  fs.writeFileSync(wav, beepWav((frames * fps.den) / fps.num, sampleRate));
  try {
    await run(
      'ffmpeg',
      ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', `${fps.num}/${fps.den}`, '-i', 'pipe:0', '-i', wav,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-bf', '2', '-g', String(fpsRounded), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', o.out],
      async (stdin) => {
        for (let i = 0; i < frames; i++) if (!stdin.write(barcodeFrame(i, width, height, fpsRounded))) await new Promise((r) => stdin.once('drain', r));
      },
    );
  } finally {
    fs.rmSync(wav, { force: true });
  }
  return { file: o.out, width, height, fps, frames, sampleRate, beepEverySeconds: 1, beepMs: 100 };
}
