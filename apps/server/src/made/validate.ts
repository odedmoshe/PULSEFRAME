/**
 * Checking a made clip's file before the job may succeed («קליפ מקוד», wave 8 motioncode, W1; plan §4.2): facts about the file only.
 * ffprobe must report VP9 at exactly the drawn size and rate, the packet count must equal the frames, the alpha tag must be there
 * when alpha was drawn; then three frames are decoded back WITH libvpx-vp9 (the native decoder drops alpha, verify C2b) and compared
 * with the PNGs the browser drew.
 *
 * Decode-back tolerances are HEURISTICS (the plan's guesses, kept until the proof measures more): mean |Δalpha| at most 4 levels
 * of 255, the share of pixels with alpha ≥ 128 within 1 percentage point, and the colour bias (signed mean Δ of R, G or B over 2×2
 * blocks opaque in both) at most MADE_RGB_TOLERANCE levels in the worst of the three channels. The numbers measured are kept in the report whatever the verdict.
 */
import { decodePng } from '../colourMatch.ts';
import { countVideoPackets, ffprobe, videoHasAlpha } from '../ingest.ts';
import { runMadeFfmpeg } from './encode.ts';

export const MADE_ALPHA_TOLERANCE = 4;
export const MADE_COVERAGE_TOLERANCE = 0.01;
/**
 * Worst-channel mean |Δ| over opaque pixels after VP9 at crf 20 and back (heuristic). Measured once in encode.test.ts on a 64×48
 * synthetic clip: 1.8–2.0 with the BT.709 matrix, 8.0 for a file converted with the default BT.601 matrix but tagged BT.709. Set
 * between the two; the proof's numbers may move it.
 */
export const MADE_RGB_TOLERANCE = 4;

/** rgbMean: the colour BIAS: |mean signed Δ| of the worst channel (R, G or B) between 2×2 block means, over blocks opaque in both. */
export interface MadeFrameCompare { frame: number; alphaMean: number; coverageA: number; coverageB: number; rgbMean: number; /** opaque 2×2 blocks the colour bias was measured over */ blocks: number }
export type MadeFileCheck =
  | { ok: true; compared: MadeFrameCompare[] }
  | { ok: false; why: 'frameCount'; got: number; want: number; detail: string }
  | { ok: false; why: 'decodeBack'; frame: number; detail: string; compared: MadeFrameCompare[] };

/**
 * Compare two RGBA buffers of one size (pure). Colour is compared as the MEAN of each 2×2 block (the 4:2:0 chroma block) that is
 * fully opaque in both: 4:2:0 shares one chroma sample per block, so at an edge between two colours (or a shape and the transparent
 * outside) single pixels differ by the format's subsampling, while the block's mean keeps (the conversion is linear). Measured once:
 * per pixel, anti-aliased text gave worst-channel 4.4 and a three.js cube 8.75 with the right matrix, and the cube's block means
 * still 5.5 in absolute value (VP9 noise of ±5 on a flat moving face at 96×54). A wrong matrix is a BIAS (every pixel of a colour
 * moves the same way; 8.0 for the BT.601 file in encode.test.ts), compression noise is not, so the SIGNED mean is compared.
 */
export function compareRgba(a: Uint8Array, b: Uint8Array, frame: number, width = a.length / 4): MadeFrameCompare {
  const n = a.length / 4;
  const height = n / width;
  let da = 0, ca = 0, cb = 0, opaque = 0;
  const d = [0, 0, 0];
  for (let i = 0; i < a.length; i += 4) {
    da += Math.abs(a[i + 3]! - b[i + 3]!);
    if (a[i + 3]! >= 128) ca++;
    if (b[i + 3]! >= 128) cb++;
  }
  for (let y = 0; y + 1 < height; y += 2) for (let x = 0; x + 1 < width; x += 2) {
    const px = [(y * width + x) * 4, (y * width + x + 1) * 4, ((y + 1) * width + x) * 4, ((y + 1) * width + x + 1) * 4];
    if (!px.every((i) => a[i + 3] === 255 && b[i + 3]! >= 250)) continue;
    opaque++;
    for (let c = 0; c < 3; c++) { let sa = 0, sb = 0; for (const i of px) { sa += a[i + c]!; sb += b[i + c]!; } d[c]! += (sa - sb) / 4; }
  }
  return { frame, alphaMean: da / n, coverageA: ca / n, coverageB: cb / n, rgbMean: opaque ? Math.max(...d.map(Math.abs)) / opaque : 0, blocks: opaque };
}
/**
 * Fewest opaque 2×2 blocks for the colour bias to be judged (heuristic): over a few dozen blocks VP9's error does not average out
 * (measured once: a 96×54 end card, 55 blocks, bias 4.9 with the right matrix). Below it the bias is measured and kept, not judged.
 */
export const MADE_RGB_MIN_BLOCKS = 256;
export const frameFails = (c: MadeFrameCompare) => c.alphaMean > MADE_ALPHA_TOLERANCE || Math.abs(c.coverageA - c.coverageB) > MADE_COVERAGE_TOLERANCE || (c.blocks >= MADE_RGB_MIN_BLOCKS && c.rgbMean > MADE_RGB_TOLERANCE);

/** Decode frames `frames` (indices) of a VP9 file to RGBA with libvpx-vp9 and the BT.709 matrix. */
export async function decodeFrames(file: string, width: number, height: number, frames: readonly number[], signal?: AbortSignal): Promise<Map<number, Uint8Array>> {
  const want = [...new Set(frames)].sort((x, y) => x - y);
  const select = want.map((f) => `eq(n\\,${f})`).join('+');
  const raw = await runMadeFfmpeg(['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-c:v', 'libvpx-vp9', '-i', file, '-map', '0:v:0',
    '-vf', `select='${select}',scale=in_color_matrix=bt709:in_range=tv,format=rgba`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], signal);
  const size = width * height * 4;
  const out = new Map<number, Uint8Array>();
  want.forEach((f, i) => { if ((i + 1) * size <= raw.length) out.set(f, new Uint8Array(raw.buffer, raw.byteOffset + i * size, size)); });
  return out;
}

export async function checkMadeFile(file: string, o: { width: number; height: number; rate: { num: number; den: number }; frames: number; alpha: boolean; samples: { frame: number; png: Buffer }[]; signal?: AbortSignal }): Promise<MadeFileCheck> {
  const probe = await ffprobe(file);
  const v = (probe.streams ?? []).find((s: any) => s.codec_type === 'video');
  const packets = await countVideoPackets(file);
  const problems: string[] = [];
  if (!v) problems.push('no video stream');
  else {
    if (v.codec_name !== 'vp9') problems.push(`codec ${v.codec_name}`);
    if (v.width !== o.width || v.height !== o.height) problems.push(`size ${v.width}x${v.height}, drawn ${o.width}x${o.height}`);
    if (v.r_frame_rate !== `${o.rate.num}/${o.rate.den}`) problems.push(`rate ${v.r_frame_rate}, drawn ${o.rate.num}/${o.rate.den}`);
    if (o.alpha && !videoHasAlpha(v)) problems.push('the alpha tag is missing');
  }
  if (packets !== o.frames) return { ok: false, why: 'frameCount', got: packets ?? 0, want: o.frames, detail: problems.join('; ') };
  if (problems.length) return { ok: false, why: 'decodeBack', frame: 0, detail: problems.join('; '), compared: [] };
  const decoded = await decodeFrames(file, o.width, o.height, o.samples.map((s) => s.frame), o.signal);
  const compared: MadeFrameCompare[] = [];
  for (const s of o.samples) {
    const back = decoded.get(s.frame);
    if (!back) return { ok: false, why: 'decodeBack', frame: s.frame, detail: 'the frame did not decode', compared };
    const drawn = await decodePng(s.png);
    const c = compareRgba(drawn.rgba, back, s.frame, o.width);
    compared.push(c);
  }
  const bad = compared.find(frameFails);
  if (bad) return { ok: false, why: 'decodeBack', frame: bad.frame, detail: `alpha ${bad.alphaMean.toFixed(2)}, coverage ${(bad.coverageA * 100).toFixed(2)}% vs ${(bad.coverageB * 100).toFixed(2)}%, rgb ${bad.rgbMean.toFixed(2)} over ${bad.blocks} blocks`, compared };
  return { ok: true, compared };
}

/** Pixels that differ between two PNGs of one size (determinism, when the bytes differ). */
export async function differingPixels(a: Buffer, b: Buffer): Promise<number> {
  const [x, y] = await Promise.all([decodePng(a), decodePng(b)]);
  if (x.width !== y.width || x.height !== y.height) return x.width * x.height;
  let n = 0;
  for (let i = 0; i < x.rgba.length; i += 4) if (x.rgba[i] !== y.rgba[i] || x.rgba[i + 1] !== y.rgba[i + 1] || x.rgba[i + 2] !== y.rgba[i + 2] || x.rgba[i + 3] !== y.rgba[i + 3]) n++;
  return n;
}
