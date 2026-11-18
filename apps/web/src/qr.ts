/**
 * A QR code encoder with no dependency (ADR-0023): the drop dialog draws the code's address with it, black on a white plate in
 * both themes. Byte mode (UTF-8), error correction level M, versions 1–10 (the drop URL is at most 52 bytes: version 4).
 *
 * Written from ISO/IEC 18004: the block table (QR_BLOCKS), the alignment centres, Reed-Solomon over GF(256) with the polynomial
 * 0x11D, the zigzag placement that skips the timing column, all eight masks with the four penalty rules (the lowest wins, the
 * lowest mask number on a tie), the BCH(15,5) format word (generator 0x537, XOR 0x5412) and the BCH(18,6) version word
 * (generator 0x1F25, versions 7 and up). qr.test.ts checks it against the vectors computed from those definitions and reads
 * every code it makes back with a reader of its own.
 * Pure and deterministic: the same text always gives the same matrix.
 */
export interface QrMatrix {
  version: number;
  /** 17 + 4 × version */
  size: number;
  /** Row-major, 1 = dark, no quiet zone. */
  modules: Uint8Array;
  /** The mask pattern chosen (0–7): the one with the lowest penalty. */
  mask: number;
}
/** Largest text (in UTF-8 bytes) that fits: version 10 at level M. */
export const QR_MAX_BYTES = 213;

/** Per version (index = version): total codewords, error correction codewords per block, and the blocks as [count, data codewords]. */
export const QR_BLOCKS: readonly { total: number; ec: number; groups: readonly (readonly [number, number])[] }[] = [
  { total: 0, ec: 0, groups: [] },
  { total: 26, ec: 10, groups: [[1, 16]] },
  { total: 44, ec: 16, groups: [[1, 28]] },
  { total: 70, ec: 26, groups: [[1, 44]] },
  { total: 100, ec: 18, groups: [[2, 32]] },
  { total: 134, ec: 24, groups: [[2, 43]] },
  { total: 172, ec: 16, groups: [[4, 27]] },
  { total: 196, ec: 18, groups: [[4, 31]] },
  { total: 242, ec: 22, groups: [[2, 38], [2, 39]] },
  { total: 292, ec: 22, groups: [[3, 36], [2, 37]] },
  { total: 346, ec: 26, groups: [[4, 43], [1, 44]] },
];
/** Alignment pattern centres per version (index = version). */
export const QR_ALIGNMENT: readonly (readonly number[])[] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
/** Byte-mode capacity at level M per version (index = version). */
export const QR_CAPACITY: readonly number[] = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

const dataCodewords = (v: number): number => QR_BLOCKS[v]!.groups.reduce((n, [c, d]) => n + c * d, 0);

// ---- GF(256), polynomial 0x11D ------------------------------------------------------------------------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const gmul = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

/** The generator polynomial of `n` error correction codewords: the product of (x − α^i), i < n; coefficients highest degree first. */
export function rsGenerator(n: number): number[] {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] = next[j]! ^ g[j]!;
      next[j + 1] = next[j + 1]! ^ gmul(g[j]!, EXP[i]!);
    }
    g = next;
  }
  return g;
}
/** The exponents (powers of α) of the generator's coefficients, highest degree first: 10 codewords → 0,251,67,46,61,118,70,64,94,32,45. */
export const rsGeneratorExponents = (n: number): number[] => rsGenerator(n).map((c) => LOG[c]!);
/** The `n` error correction codewords of `data` (the remainder of data·x^n divided by the generator). */
export function rsEncode(data: ArrayLike<number>, n: number): number[] {
  const gen = rsGenerator(n);
  const rem = new Array<number>(n).fill(0);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i]! ^ rem[0]!;
    rem.shift(); rem.push(0);
    if (factor !== 0) for (let j = 0; j < n; j++) rem[j] = rem[j]! ^ gmul(gen[j + 1]!, factor);
  }
  return rem;
}

// ---- BCH words -----------------------------------------------------------------------------------------------------------
/** The 15 format bits of level M and `mask` (0–7): BCH(15,5) with 0x537, XOR 0x5412. */
export function qrFormatBits(mask: number): number {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
/** The 18 version bits of versions 7 and up: BCH(18,6) with 0x1F25. */
export function qrVersionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

// ---- the data codewords --------------------------------------------------------------------------------------------------
/** The data codewords of a byte-mode message, padded to the version's capacity (header, count, data, terminator, 0xEC/0x11 pads). */
export function dataBytes(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = dataCodewords(version) * 8;
  put(0, Math.min(4, cap - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!; out.push(v); }
  for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}
/** Splits the data into blocks, adds each block's error correction and interleaves: data column by column, then the corrections. */
export function interleave(data: readonly number[], version: number): number[] {
  const { ec, groups } = QR_BLOCKS[version]!;
  const blocks: number[][] = [];
  let at = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { blocks.push(data.slice(at, at + size)); at += size; }
  const eccs = blocks.map((b) => rsEncode(b, ec));
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ec; i++) for (const e of eccs) out.push(e[i]!);
  return out;
}

// ---- the matrix ----------------------------------------------------------------------------------------------------------
/** True where the mask pattern flips the module at (row i, column j). */
export function maskFlips(mask: number, i: number, j: number): boolean {
  switch (mask) {
    case 0: return (i + j) % 2 === 0;
    case 1: return i % 2 === 0;
    case 2: return j % 3 === 0;
    case 3: return (i + j) % 3 === 0;
    case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
    case 5: return ((i * j) % 2) + ((i * j) % 3) === 0;
    case 6: return (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
    case 7: return (((i + j) % 2) + ((i * j) % 3)) % 2 === 0;
    default: throw new RangeError(`no mask pattern ${mask}`);
  }
}

interface Grid { size: number; dark: Uint8Array; fn: Uint8Array }
const set = (g: Grid, x: number, y: number, dark: boolean) => { g.dark[y * g.size + x] = dark ? 1 : 0; g.fn[y * g.size + x] = 1; };

/** The function patterns (finders, separators, timing, alignment, the dark module) and the reserved format and version areas. */
function functionPatterns(version: number): Grid {
  const size = 17 + 4 * version;
  const g: Grid = { size, dark: new Uint8Array(size * size), fn: new Uint8Array(size * size) };
  // timing
  for (let i = 0; i < size; i++) { set(g, 6, i, i % 2 === 0); set(g, i, 6, i % 2 === 0); }
  // finders with their separators
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]] as const)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      set(g, x, y, d !== 2 && d !== 4);
    }
  // alignment
  const centres = QR_ALIGNMENT[version]!;
  const last = centres.length - 1;
  for (let a = 0; a <= last; a++) for (let b = 0; b <= last; b++) {
    if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(g, centres[a]! + dx, centres[b]! + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // format areas (written for real once the mask is known) and the always-dark module
  for (let i = 0; i < 9; i++) { g.fn[8 * size + i] = 1; g.fn[i * size + 8] = 1; }
  for (let i = 0; i < 8; i++) { g.fn[8 * size + (size - 1 - i)] = 1; g.fn[(size - 1 - i) * size + 8] = 1; }
  set(g, 8, size - 8, true);
  // version areas
  if (version >= 7) for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { g.fn[i * size + (size - 11 + j)] = 1; g.fn[(size - 11 + j) * size + i] = 1; }
  return g;
}
function drawFormat(g: Grid, mask: number): void {
  const bits = qrFormatBits(mask);
  const b = (i: number) => ((bits >>> i) & 1) === 1;
  const { size } = g;
  for (let i = 0; i <= 5; i++) set(g, 8, i, b(i));
  set(g, 8, 7, b(6)); set(g, 8, 8, b(7)); set(g, 7, 8, b(8));
  for (let i = 9; i < 15; i++) set(g, 14 - i, 8, b(i));
  for (let i = 0; i < 8; i++) set(g, size - 1 - i, 8, b(i));
  for (let i = 8; i < 15; i++) set(g, 8, size - 15 + i, b(i));
  set(g, 8, size - 8, true);
}
function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = qrVersionBits(version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = g.size - 11 + (i % 3), b = Math.floor(i / 3);
    set(g, a, b, dark); set(g, b, a, dark);
  }
}
/** Places the codewords in the zigzag (two columns at a time from the bottom right, upward then downward, skipping column 6). */
function place(g: Grid, codewords: readonly number[]): void {
  const { size } = g;
  let bit = 0;
  const total = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const y = upward ? size - 1 - n : n;
      for (let c = 0; c < 2; c++) {
        const x = right - c;
        if (g.fn[y * size + x]) continue;
        // bits beyond the codewords are the remainder bits: light before the mask
        g.dark[y * size + x] = bit < total ? (codewords[bit >>> 3]! >>> (7 - (bit & 7))) & 1 : 0;
        bit++;
      }
    }
    upward = !upward;
  }
}

/** The matrix of `text` under one given mask (0–7), with its format and version words drawn. encodeQr chooses the mask. */
export function encodeQrWithMask(text: string, mask: number): QrMatrix {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new RangeError(`no mask pattern ${mask}`);
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > QR_MAX_BYTES) throw new RangeError(`a QR code at level M, version 10 holds at most ${QR_MAX_BYTES} bytes; got ${bytes.length}`);
  let version = 1;
  while (QR_CAPACITY[version]! < bytes.length) version++;
  const codewords = interleave(dataBytes(bytes, version), version);
  const g = functionPatterns(version);
  place(g, codewords);
  const { size } = g;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!g.fn[y * size + x] && maskFlips(mask, y, x)) g.dark[y * size + x] ^= 1;
  drawFormat(g, mask);
  drawVersion(g, version);
  return { version, size, modules: g.dark, mask };
}

/** The penalty of a finished matrix: N1 runs of five or more (3 + extra), N2 2×2 blocks (3), N3 finder-like 1011101 with four light on a side (40), N4 balance (10 per 5% away from half). */
export function qrPenalty(m: Pick<QrMatrix, 'size' | 'modules'>): number {
  const { size: n, modules: d } = m;
  const at = (x: number, y: number) => d[y * n + x]!;
  let score = 0;
  // N1 and N3, rows then columns
  for (const rows of [true, false]) for (let a = 0; a < n; a++) {
    const line: number[] = [];
    for (let b = 0; b < n; b++) line.push(rows ? at(b, a) : at(a, b));
    let run = 1;
    for (let b = 1; b <= n; b++) {
      if (b < n && line[b] === line[b - 1]) { run++; continue; }
      if (run >= 5) score += 3 + (run - 5);
      run = 1;
    }
    for (let b = 0; b + 7 <= n; b++) {
      if (line[b] === 1 && line[b + 1] === 0 && line[b + 2] === 1 && line[b + 3] === 1 && line[b + 4] === 1 && line[b + 5] === 0 && line[b + 6] === 1) {
        const lightBefore = b >= 4 && line[b - 1] === 0 && line[b - 2] === 0 && line[b - 3] === 0 && line[b - 4] === 0;
        const lightAfter = b + 11 <= n && line[b + 7] === 0 && line[b + 8] === 0 && line[b + 9] === 0 && line[b + 10] === 0;
        if (lightBefore) score += 40;
        if (lightAfter) score += 40;
      }
    }
  }
  // N2
  for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
    const c = at(x, y);
    if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
  }
  // N4
  let dark = 0;
  for (let i = 0; i < d.length; i++) dark += d[i]!;
  const total = n * n;
  score += 10 * Math.floor(Math.abs(20 * dark - 10 * total) / total);
  return score;
}

/** Byte mode (UTF-8), error correction level M, versions 1–10. Throws RangeError when the text is longer than QR_MAX_BYTES bytes. Deterministic. */
export function encodeQr(text: string): QrMatrix {
  let best: QrMatrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = encodeQrWithMask(text, mask);
    const s = qrPenalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return best!;
}

/** One SVG path of the dark modules, including a quiet zone of `quiet` modules (default 4). */
export function qrSvgPath(m: QrMatrix, quiet = 4): { d: string; viewBox: string } {
  const q = Math.max(0, Math.floor(quiet));
  const parts: string[] = [];
  for (let y = 0; y < m.size; y++) {
    let x = 0;
    while (x < m.size) {
      if (!m.modules[y * m.size + x]) { x++; continue; }
      let w = 1;
      while (x + w < m.size && m.modules[y * m.size + x + w]) w++;
      parts.push(`M${x + q} ${y + q}h${w}v1h-${w}z`);
      x += w;
    }
  }
  const side = m.size + 2 * q;
  return { d: parts.join(''), viewBox: `0 0 ${side} ${side}` };
}
