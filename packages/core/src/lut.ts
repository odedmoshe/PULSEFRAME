/**
 * Strict parser for Adobe/Resolve `.cube` 3D LUTs plus helpers for a shader pass.
 * The input is untrusted: work is linear in the text length and the only thrown type is LutError.
 */

export type LutErrorCode = 'too_large' | 'unsupported' | 'malformed';

export class LutError extends Error {
  readonly code: LutErrorCode;
  readonly line: number | null;
  constructor(code: LutErrorCode, message: string, line: number | null = null) {
    super(message);
    this.name = 'LutError';
    this.code = code;
    this.line = line;
  }
}

export interface Lut3D {
  title: string | null;
  /** entries per axis, 2..65 */
  size: number;
  /** size^3 RGB triples in file order (red fastest, then green, then blue), values as written */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

export const LUT_MAX_SIZE = 65;
export const LUT_MAX_TEXT_LENGTH = 16 * 1024 * 1024;

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const INT_RE = /^\d+$/;

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function parseNumber(tok: string, line: number): number {
  if (tok.length > 64 || !NUMBER_RE.test(tok)) {
    throw new LutError('malformed', `Not a number: "${tok.slice(0, 32)}"`, line);
  }
  const n = Number(tok);
  if (!Number.isFinite(n)) throw new LutError('malformed', `Number is not finite: "${tok}"`, line);
  return n;
}

function parseNumbers(toks: string[], from: number, count: number, line: number, what: string): number[] {
  if (toks.length - from !== count) {
    throw new LutError('malformed', `${what} needs exactly ${count} numbers`, line);
  }
  const out: number[] = [];
  for (let i = from; i < toks.length; i++) out.push(parseNumber(toks[i]!, line));
  return out;
}

function trimLine(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && (s[a] === ' ' || s[a] === '\t' || s[a] === '\r')) a++;
  while (b > a && (s[b - 1] === ' ' || s[b - 1] === '\t' || s[b - 1] === '\r')) b--;
  return s.slice(a, b);
}

export function parseCube(text: string, opts?: { maxSize?: number }): Lut3D {
  if (typeof text !== 'string') throw new LutError('malformed', 'LUT text must be a string');
  if (text.length > LUT_MAX_TEXT_LENGTH) {
    throw new LutError('too_large', `LUT text exceeds ${LUT_MAX_TEXT_LENGTH} characters`);
  }
  const maxSizeOpt = opts?.maxSize;
  const maxSize =
    typeof maxSizeOpt === 'number' && Number.isFinite(maxSizeOpt)
      ? Math.max(2, Math.min(LUT_MAX_SIZE, Math.floor(maxSizeOpt)))
      : LUT_MAX_SIZE;

  let title: string | null = null;
  let size = 0;
  let sizeLine = 0;
  let data: Float32Array | null = null;
  let total = 0;
  let filled = 0;
  const domainMin: [number, number, number] = [0, 0, 0];
  const domainMax: [number, number, number] = [1, 1, 1];

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let lineNo = 0;
  while (pos <= text.length) {
    let end = text.indexOf('\n', pos);
    if (end < 0) end = text.length;
    lineNo++;
    const line = trimLine(text.slice(pos, end));
    pos = end + 1;
    if (line === '' || line.charCodeAt(0) === 35) continue;

    const first = line.charCodeAt(0);
    if (isLetter(first)) {
      const toks = line.split(/[ \t]+/);
      const kw = toks[0]!.toUpperCase();
      if (data !== null && filled > 0) {
        throw new LutError('malformed', `Keyword ${kw} after data`, lineNo);
      }
      switch (kw) {
        case 'TITLE': {
          let t = line.slice(5).trim();
          if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1);
          title = t;
          break;
        }
        case 'LUT_1D_SIZE':
          throw new LutError('unsupported', '1D LUTs are not supported', lineNo);
        case 'LUT_3D_SIZE': {
          if (size !== 0) throw new LutError('malformed', 'Duplicate LUT_3D_SIZE', lineNo);
          if (toks.length !== 2 || !INT_RE.test(toks[1]!) || toks[1]!.length > 9) {
            throw new LutError('malformed', 'LUT_3D_SIZE must be an integer', lineNo);
          }
          const n = Number(toks[1]);
          if (n < 2) throw new LutError('malformed', 'LUT_3D_SIZE must be at least 2', lineNo);
          if (n > maxSize) throw new LutError('too_large', `LUT_3D_SIZE ${n} exceeds ${maxSize}`, lineNo);
          size = n;
          sizeLine = lineNo;
          total = n * n * n;
          data = new Float32Array(total * 3);
          break;
        }
        case 'DOMAIN_MIN': {
          const v = parseNumbers(toks, 1, 3, lineNo, 'DOMAIN_MIN');
          domainMin[0] = v[0]!;
          domainMin[1] = v[1]!;
          domainMin[2] = v[2]!;
          break;
        }
        case 'DOMAIN_MAX': {
          const v = parseNumbers(toks, 1, 3, lineNo, 'DOMAIN_MAX');
          domainMax[0] = v[0]!;
          domainMax[1] = v[1]!;
          domainMax[2] = v[2]!;
          break;
        }
        case 'LUT_3D_INPUT_RANGE': {
          const v = parseNumbers(toks, 1, 2, lineNo, 'LUT_3D_INPUT_RANGE');
          for (let c = 0; c < 3; c++) {
            domainMin[c] = v[0]!;
            domainMax[c] = v[1]!;
          }
          break;
        }
        default:
          throw new LutError('malformed', `Unknown keyword "${toks[0]!.slice(0, 32)}"`, lineNo);
      }
      continue;
    }

    // data line
    if (data === null) throw new LutError('malformed', 'Data before LUT_3D_SIZE', lineNo);
    if (filled >= total) throw new LutError('malformed', `More than ${total} data lines`, lineNo);
    const toks = line.split(/[ \t]+/);
    const v = parseNumbers(toks, 0, 3, lineNo, 'Data line');
    const o = filled * 3;
    data[o] = v[0]!;
    data[o + 1] = v[1]!;
    data[o + 2] = v[2]!;
    filled++;
  }

  if (data === null) throw new LutError('malformed', 'Missing LUT_3D_SIZE');
  if (filled !== total) {
    throw new LutError('malformed', `Expected ${total} data lines (size ${size} from line ${sizeLine}), found ${filled}`);
  }
  for (let c = 0; c < 3; c++) {
    if (!(domainMax[c]! > domainMin[c]!)) {
      throw new LutError('malformed', 'DOMAIN_MAX must be greater than DOMAIN_MIN for every channel');
    }
  }
  return { title, size, data, domainMin, domainMax };
}

function num(x: number): string {
  return Object.is(x, -0) ? '-0' : String(x);
}

export function serializeCube(lut: Lut3D): string {
  const out: string[] = [];
  if (lut.title !== null) out.push(`TITLE "${lut.title.replace(/[\r\n]+/g, ' ')}"`);
  out.push(`LUT_3D_SIZE ${lut.size}`);
  out.push(`DOMAIN_MIN ${lut.domainMin.join(' ')}`);
  out.push(`DOMAIN_MAX ${lut.domainMax.join(' ')}`);
  const n = lut.size ** 3;
  for (let i = 0; i < n; i++) {
    out.push(`${num(lut.data[i * 3]!)} ${num(lut.data[i * 3 + 1]!)} ${num(lut.data[i * 3 + 2]!)}`);
  }
  return out.join('\n') + '\n';
}

export function identityLut(size: number): Lut3D {
  if (!Number.isInteger(size) || size < 2) throw new LutError('malformed', 'size must be an integer >= 2');
  if (size > LUT_MAX_SIZE) throw new LutError('too_large', `size exceeds ${LUT_MAX_SIZE}`);
  const data = new Float32Array(size * size * size * 3);
  const d = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        data[i++] = r / d;
        data[i++] = g / d;
        data[i++] = b / d;
      }
    }
  }
  return { title: null, size, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : Number.isNaN(x) ? 0 : x;
}

/** Reference trilinear lookup. Input 0..1 per channel (mapped through the domain); output clamped to 0..1. */
export function sampleLut(lut: Lut3D, rgb: readonly [number, number, number]): [number, number, number] {
  const n = lut.size;
  const d = n - 1;
  const idx: number[] = [];
  const fr: number[] = [];
  for (let c = 0; c < 3; c++) {
    const lo = lut.domainMin[c]!;
    const hi = lut.domainMax[c]!;
    const t = clamp01((rgb[c]! - lo) / (hi - lo)) * d;
    const i0 = Math.min(Math.floor(t), d - 1);
    idx.push(i0);
    fr.push(t - i0);
  }
  const out: [number, number, number] = [0, 0, 0];
  for (let db = 0; db < 2; db++) {
    const wb = db ? fr[2]! : 1 - fr[2]!;
    for (let dg = 0; dg < 2; dg++) {
      const wg = dg ? fr[1]! : 1 - fr[1]!;
      for (let dr = 0; dr < 2; dr++) {
        const w = (dr ? fr[0]! : 1 - fr[0]!) * wg * wb;
        if (w === 0) continue;
        const o = ((idx[0]! + dr) + (idx[1]! + dg) * n + (idx[2]! + db) * n * n) * 3;
        out[0] += w * lut.data[o]!;
        out[1] += w * lut.data[o + 1]!;
        out[2] += w * lut.data[o + 2]!;
      }
    }
  }
  return [clamp01(out[0]), clamp01(out[1]), clamp01(out[2])];
}

/** The LUT as an RGBA8 image: width = size*size, height = size; pixel (r + b*size, g) holds entry (r, g, b). */
export function lutToRgba8Strip(lut: Lut3D): { width: number; height: number; data: Uint8Array } {
  const n = lut.size;
  const width = n * n;
  const out = new Uint8Array(width * n * 4);
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const src = (r + g * n + b * n * n) * 3;
        const dst = (g * width + r + b * n) * 4;
        out[dst] = Math.round(clamp01(lut.data[src]!) * 255);
        out[dst + 1] = Math.round(clamp01(lut.data[src + 1]!) * 255);
        out[dst + 2] = Math.round(clamp01(lut.data[src + 2]!) * 255);
        out[dst + 3] = 255;
      }
    }
  }
  return { width, height: n, data: out };
}

/** JS model of the shader: two bilinear taps (nearest blue slices, half-texel insets) blended by the blue fraction. */
export function sampleStrip(
  strip: { width: number; height: number; data: Uint8Array },
  size: number,
  rgb: readonly [number, number, number],
): [number, number, number] {
  const d = size - 1;
  const rr = clamp01(rgb[0]) * d;
  const gg = clamp01(rgb[1]) * d;
  const bb = clamp01(rgb[2]) * d;
  const b0 = Math.min(Math.floor(bb), d);
  const b1 = Math.min(b0 + 1, d);
  const fb = bb - b0;
  const x0 = Math.min(Math.floor(rr), Math.max(d - 1, 0));
  const fx = rr - x0;
  const y0 = Math.min(Math.floor(gg), Math.max(d - 1, 0));
  const fy = gg - y0;
  const tap = (slice: number): [number, number, number] => {
    const acc: [number, number, number] = [0, 0, 0];
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? fy : 1 - fy;
      const y = Math.min(y0 + dy, strip.height - 1);
      for (let dx = 0; dx < 2; dx++) {
        const w = (dx ? fx : 1 - fx) * wy;
        const x = Math.min(slice * size + x0 + dx, strip.width - 1);
        const o = (y * strip.width + x) * 4;
        acc[0] += w * strip.data[o]!;
        acc[1] += w * strip.data[o + 1]!;
        acc[2] += w * strip.data[o + 2]!;
      }
    }
    return acc;
  };
  const a = tap(b0);
  const b = tap(b1);
  return [
    (a[0] * (1 - fb) + b[0] * fb) / 255,
    (a[1] * (1 - fb) + b[1] * fb) / 255,
    (a[2] * (1 - fb) + b[2] * fb) / 255,
  ];
}

/** The same table over the unit domain: unchanged when its domain is already 0..1, otherwise resampled (trilinear, sampleLut) onto a 0..1 grid of the same size. Inputs outside the file's domain take its edge values. */
export function unitDomainLut(lut: Lut3D): Lut3D {
  const unit = lut.domainMin.every((v) => v === 0) && lut.domainMax.every((v) => v === 1);
  if (unit) return lut;
  const n = lut.size;
  const d = n - 1;
  const data = new Float32Array(n * n * n * 3);
  let i = 0;
  for (let b = 0; b < n; b++) {
    for (let g = 0; g < n; g++) {
      for (let r = 0; r < n; r++) {
        const v = sampleLut(lut, [r / d, g / d, b / d]);
        data[i++] = v[0];
        data[i++] = v[1];
        data[i++] = v[2];
      }
    }
  }
  return { title: lut.title, size: n, data, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
}

/** File text to the strip a render pass samples: parseCube, unitDomainLut, lutToRgba8Strip. Every context (editor, render worker, browser export, proofs) uses this one function. Throws LutError. */
export function lutStrip(text: string): { key?: undefined } & { size: number; width: number; height: number; data: Uint8Array } {
  const lut = unitDomainLut(parseCube(text));
  return { size: lut.size, ...lutToRgba8Strip(lut) };
}
