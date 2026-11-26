/**
 * Encoding a made clip («קליפ מקוד», wave 8 motioncode, W1; plan §4.2 with verify C2). ONE ffmpeg reads the PNG frames from a pipe and
 * writes three things at once:
 *  1. the file: VP9 with alpha (yuva420p, `alpha_mode=1`), converted from RGB with the BT.709 matrix (`out_color_matrix=bt709`,
 *     limited range) AND tagged bt709 (`-colorspace/-color_primaries/-color_trc`). Gate G1 found that a file converted with ffmpeg's
 *     default BT.601 matrix but tagged BT.709 draws about 8 levels off; tagging also keeps the asset from being `untaggedColour`;
 *  2. a small RGBA copy (at most 480 wide) for the flash analysis, composited over black AND over white (decision 3: a warning);
 *  3. the full-size alpha plane, for emptiness (made_empty, a fact: no pixel above alpha 0 in any frame; frames under 0.1% of their
 *     pixels drawn, the plan's heuristic, are only counted and reported) and for whether any pixel is not fully opaque.
 * A clip where every pixel of every frame is opaque (a full-frame plate) is encoded again without alpha (yuv420p): the alpha file is
 * decoded with libvpx-vp9 (ffmpeg's native VP9 decoder would drop the alpha; verify C2b) and re-encoded. Argument arrays only, no
 * shell, `-protocol_whitelist pipe,file`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable, Readable } from 'node:stream';
import type * as T from '@pulseframe/time';
import { FrameFlashCheck } from '../flashCheck.ts';

/** Share of a frame's pixels that must have alpha above 0 for the frame to count as drawn (heuristic; plan §4.2). */
export const MADE_EMPTY_SHARE = 0.001;
/** Width of the flash-analysis copy (plan §4.2). */
export const MADE_ANALYSIS_WIDTH = 480;

const VP9 = ['-c:v', 'libvpx-vp9', '-auto-alt-ref', '0', '-crf', '20', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-threads', '2'];
const TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export function analysisSize(width: number, height: number): { width: number; height: number } {
  if (width <= MADE_ANALYSIS_WIDTH) return { width, height };
  return { width: MADE_ANALYSIS_WIDTH, height: Math.max(2, 2 * Math.round((height * MADE_ANALYSIS_WIDTH) / width / 2)) };
}
/** The arguments of the one encode (pure; unit-tested). Output 1 is the file, pipe:1 the analysis copy, pipe:3 the alpha plane. */
export function madeEncodeArgs(o: { width: number; height: number; rate: T.Rate; out: string }): string[] {
  const a = analysisSize(o.width, o.height);
  return ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'pipe,file',
    '-f', 'image2pipe', '-framerate', `${o.rate.num}/${o.rate.den}`, '-c:v', 'png', '-i', 'pipe:0',
    '-filter_complex', `[0:v]format=rgba,split=3[e][a][m];[e]scale=out_color_matrix=bt709:out_range=tv,format=yuva420p[eo];[a]scale=${a.width}:${a.height}:flags=area,format=rgba[ao];[m]alphaextract,format=gray[mo]`,
    '-map', '[eo]', ...VP9, '-pix_fmt', 'yuva420p', ...TAGS, '-metadata:s:v:0', 'alpha_mode=1', '-f', 'webm', '-y', o.out,
    '-map', '[ao]', '-f', 'rawvideo', 'pipe:1',
    '-map', '[mo]', '-f', 'rawvideo', 'pipe:3'];
}
/** Re-encode an all-opaque clip without alpha (pure). */
export function madePlateArgs(src: string, out: string): string[] {
  return ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-c:v', 'libvpx-vp9', '-i', src,
    '-map', '0:v:0', '-map_metadata', '-1', '-map_metadata:s:v', '-1', '-vf', 'format=yuv420p', '-fps_mode', 'passthrough', ...VP9, '-pix_fmt', 'yuv420p', ...TAGS, '-f', 'webm', '-y', out];
}

export interface MadeEncodeAnalysis {
  frames: number;
  /** most flashes a second over the area (FrameFlashCheck areaPeak), over black and over white */
  flash: { black: { general: number; red: number }; white: { general: number; red: number } };
  /** a pixel below alpha 255 somewhere */
  alpha: boolean;
  /** frames with at least MADE_EMPTY_SHARE of their pixels drawn (heuristic; first/last near-empty frames are reported) */
  drawnFrames: number;
  /** frames with at least one pixel above alpha 0 (a fact: none at all = made_empty) */
  framesWithPixels: number;
  /** the first and last frame are empty (reported, not a failure) */
  emptyEnds: { first: boolean; last: boolean };
}
export class MadeEncodeError extends Error { constructor(message: string, readonly stderr: string) { super(message); } }

/** Splits a byte stream into fixed-size frames. */
class Framer {
  private parts: Buffer[] = []; private have = 0;
  constructor(private readonly size: number, private readonly onFrame: (f: Buffer) => void) {}
  push(b: Buffer) {
    this.parts.push(b); this.have += b.length;
    while (this.have >= this.size) {
      const all = Buffer.concat(this.parts); const f = all.subarray(0, this.size);
      this.onFrame(f); const rest = all.subarray(this.size); this.parts = rest.length ? [rest] : []; this.have = rest.length;
    }
  }
}

/** One encode: push PNGs in order, then finish(). Cancel with the signal (the process is killed). */
export class MadeEncoder {
  private child: ChildProcess;
  private stderr = '';
  private closed: Promise<number | null>;
  private black: FrameFlashCheck; private white: FrameFlashCheck;
  private frames = 0; private alphaSeen = false; private drawn = 0; private withPixels = 0; private alphaFrames = 0; private firstEmpty = false; private lastEmpty = false;
  constructor(private readonly o: { width: number; height: number; rate: T.Rate; out: string; signal?: AbortSignal }) {
    const a = analysisSize(o.width, o.height);
    this.black = new FrameFlashCheck(a.width, a.height, o.rate);
    this.white = new FrameFlashCheck(a.width, a.height, o.rate);
    this.child = spawn('ffmpeg', madeEncodeArgs(o), { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    this.child.stderr!.on('data', (d: Buffer) => { if (this.stderr.length < 16384) this.stderr += d.toString(); });
    this.closed = new Promise((resolve) => { this.child.once('close', (code) => resolve(code)); this.child.once('error', (e) => { this.stderr += String(e); resolve(-1); }); });
    const overBlack = Buffer.alloc(a.width * a.height * 4); const overWhite = Buffer.alloc(a.width * a.height * 4);
    const analysis = new Framer(a.width * a.height * 4, (f) => {
      for (let i = 0; i < f.length; i += 4) {
        const al = f[i + 3]!; const k = al / 255; const w = 255 - al;
        for (let c = 0; c < 3; c++) { const v = f[i + c]! * k; overBlack[i + c] = Math.round(v); overWhite[i + c] = Math.round(v + w); }
        overBlack[i + 3] = 255; overWhite[i + 3] = 255;
      }
      this.black.feed(overBlack); this.white.feed(overWhite);
    });
    const px = o.width * o.height;
    const alphaPlane = new Framer(px, (f) => {
      let drawn = 0; let below = false;
      for (let i = 0; i < f.length; i++) { const v = f[i]!; if (v > 0) drawn++; if (v < 255) below = true; }
      if (below) this.alphaSeen = true;
      const isDrawn = drawn >= Math.max(1, px * MADE_EMPTY_SHARE);
      if (isDrawn) this.drawn++;
      if (drawn > 0) this.withPixels++;
      if (this.alphaFrames === 0) this.firstEmpty = !isDrawn;
      this.lastEmpty = !isDrawn;
      this.alphaFrames++;
    });
    (this.child.stdout as Readable).on('data', (d: Buffer) => analysis.push(d));
    (this.child.stdio[3] as Readable).on('data', (d: Buffer) => alphaPlane.push(d));
    (this.child.stdin as Writable).on('error', () => { /* reported by close */ });
    o.signal?.addEventListener('abort', () => this.kill(), { once: true });
  }
  kill() { try { this.child.kill('SIGKILL'); } catch { /* gone */ } }
  /** Write one PNG frame; resolves when the pipe can take more (back-pressure). */
  async push(png: Buffer): Promise<void> {
    this.frames++;
    const stdin = this.child.stdin as Writable;
    if (!stdin.write(png)) await new Promise<void>((r) => { const done = () => { stdin.off('drain', done); this.child.off('close', done); r(); }; stdin.on('drain', done); this.child.once('close', done); });
  }
  async finish(): Promise<MadeEncodeAnalysis> {
    (this.child.stdin as Writable).end();
    const code = await this.closed;
    if (this.o.signal?.aborted) throw new MadeEncodeError('canceled', this.stderr);
    if (code !== 0) throw new MadeEncodeError(`ffmpeg ended with ${code}: ${this.stderr.trim().split('\n').pop() ?? ''}`.slice(0, 400), this.stderr);
    const b = this.black.report(0).areaPeak; const w = this.white.report(0).areaPeak;
    return { frames: this.alphaFrames, flash: { black: { ...b }, white: { ...w } }, alpha: this.alphaSeen, drawnFrames: this.drawn, framesWithPixels: this.withPixels, emptyEnds: { first: this.firstEmpty, last: this.lastEmpty } };
  }
}

/** Run ffmpeg once with arguments, failing with its last error line. */
export function runMadeFfmpeg(args: string[], signal?: AbortSignal, timeoutMs = 15 * 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL' });
    const out: Buffer[] = []; let err = '';
    p.stdout.on('data', (b: Buffer) => out.push(b));
    p.stderr.on('data', (b: Buffer) => { if (err.length < 16384) err += b; });
    const abort = () => p.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    p.on('error', (e) => reject(new MadeEncodeError(`ffmpeg could not be started: ${e.message}`, err)));
    p.on('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return reject(new MadeEncodeError('canceled', err));
      code === 0 ? resolve(Buffer.concat(out)) : reject(new MadeEncodeError(`ffmpeg ended with ${code}: ${err.trim().split('\n').pop() ?? ''}`.slice(0, 400), err));
    });
  });
}
