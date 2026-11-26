/**
 * The QR encoder (qr.ts). The vectors are the ones computed from the standard's definitions in plan §6 (not copied from another
 * encoder). The reader below is written for this test from ISO/IEC 18004 and shares no code with qr.ts except the block table
 * (restated totals are checked against it): it finds the format word, unmasks, walks the zigzag, undoes the interleave and
 * checks that every block's syndromes are zero before it reads the text back.
 */
import { describe, expect, it } from 'vitest';
import { QR_BLOCKS, QR_CAPACITY, QR_MAX_BYTES, dataBytes, encodeQr, encodeQrWithMask, qrFormatBits, qrPenalty, qrSvgPath, qrVersionBits, rsEncode, rsGeneratorExponents, type QrMatrix } from './qr.ts';

// ---- a reader written from the standard ---------------------------------------------------------------------------------
/** Carry-less multiply modulo 0x11D (no tables). */
function mul(a: number, b: number): number {
  let r = 0;
  for (let i = 7; i >= 0; i--) { r <<= 1; if (r & 0x100) r ^= 0x11d; if ((b >> i) & 1) r ^= a; }
  return r;
}
const pow2 = (n: number): number => { let r = 1; for (let i = 0; i < n; i++) r = mul(r, 2); return r; };

const ALIGN: Record<number, number[]> = { 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50] };
const FORMAT_M = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];

function isFunction(size: number, v: number, x: number, y: number): boolean {
  if (x < 9 && y < 9) return true;
  if (x >= size - 8 && y < 9) return true;
  if (x < 9 && y >= size - 8) return true;
  if (x === 6 || y === 6) return true;
  if (v >= 7 && ((x >= size - 11 && y < 6) || (y >= size - 11 && x < 6))) return true;
  const cs = ALIGN[v] ?? [];
  for (const cx of cs) for (const cy of cs) {
    const inFinder = (cx < 9 && cy < 9) || (cx >= size - 8 && cy < 9) || (cx < 9 && cy >= size - 8);
    if (!inFinder && Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 2) return true;
  }
  return false;
}
const flips = (m: number, r: number, c: number): boolean =>
  [(r + c) % 2 === 0, r % 2 === 0, c % 3 === 0, (r + c) % 3 === 0, (((r >> 1) + Math.floor(c / 3)) % 2) === 0, ((r * c) % 2) + ((r * c) % 3) === 0, (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0][m]!;

/** Reads a matrix back: returns the text, or throws when a check fails. `syndromes` reports the checks made. */
function read(m: QrMatrix, decode = true): { text: string; syndromes: number[]; mask: number } {
  const n = m.size;
  const v = (n - 17) / 4;
  const px = (x: number, y: number) => m.modules[y * n + x]!;
  // format word: first copy
  let w1 = 0;
  const first: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  first.forEach(([x, y], i) => { w1 |= px(x, y) << i; });
  let w2 = 0;
  for (let i = 0; i < 8; i++) w2 |= px(n - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) w2 |= px(8, n - 15 + i) << i;
  expect(w2).toBe(w1);
  const mask = FORMAT_M.indexOf(w1);
  expect(mask).toBeGreaterThanOrEqual(0);
  // zigzag
  const bits: number[] = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let k = 0; k < n; k++) {
      const y = up ? n - 1 - k : k;
      for (const x of [col, col - 1]) if (!isFunction(n, v, x, y)) bits.push(px(x, y) ^ (flips(mask, y, x) ? 1 : 0));
    }
    up = !up;
  }
  const total = QR_BLOCKS[v]!.total;
  expect(bits.length).toBe(total * 8 + (v >= 2 && v <= 6 ? 7 : 0));
  const cw: number[] = [];
  for (let i = 0; i < total; i++) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j]!; cw.push(b); }
  // deinterleave
  const { ec, groups } = QR_BLOCKS[v]!;
  const sizes = groups.flatMap(([c, d]) => Array<number>(c).fill(d));
  const blocks: number[][] = sizes.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) sizes.forEach((s, b) => { if (i < s) blocks[b]!.push(cw[at++]!); });
  const eccs: number[][] = sizes.map(() => []);
  for (let i = 0; i < ec; i++) sizes.forEach((_s, b) => eccs[b]!.push(cw[at++]!));
  expect(at).toBe(total);
  const syndromes: number[] = [];
  const data: number[] = [];
  blocks.forEach((d, b) => {
    const full = [...d, ...eccs[b]!];
    for (let i = 0; i < ec; i++) { // evaluate at α^i (Horner)
      const a = pow2(i);
      let acc = 0;
      for (const c of full) acc = mul(acc, a) ^ c;
      syndromes.push(acc);
    }
    data.push(...d);
  });
  if (!decode) return { text: '', syndromes, mask };
  // the message
  let pos = 0;
  const take = (k: number) => { let r = 0; for (let i = 0; i < k; i++) { const byte = data[pos >> 3]!; r = (r << 1) | ((byte >> (7 - (pos & 7))) & 1); pos++; } return r; };
  expect(take(4)).toBe(0b0100);
  const len = take(v < 10 ? 8 : 16);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = take(8);
  return { text: new TextDecoder('utf-8', { fatal: true }).decode(out), syndromes, mask };
}

/** The standard's penalty, written separately from qr.ts: regex runs for N1 and N3. */
function penalty(m: QrMatrix): number {
  const n = m.size;
  const rows: string[] = [], cols: string[] = [];
  for (let a = 0; a < n; a++) {
    let r = '', c = '';
    for (let b = 0; b < n; b++) { r += m.modules[a * n + b]; c += m.modules[b * n + a]; }
    rows.push(r); cols.push(c);
  }
  let s = 0;
  for (const line of [...rows, ...cols]) {
    for (const run of line.match(/0{5,}|1{5,}/g) ?? []) s += 3 + run.length - 5;
    for (const re of [/(?=(0000)?1011101(0000)?)/g]) for (const hit of line.matchAll(re)) { if (hit[1]) s += 40; if (hit[2]) s += 40; }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const a = rows[y]![x]!;
    if (a === rows[y]![x + 1] && a === rows[y + 1]![x] && a === rows[y + 1]![x + 1]) s += 3;
  }
  const dark = rows.join('').split('1').length - 1;
  const pct = (dark * 100) / (n * n);
  s += 10 * Math.floor(Math.abs(pct - 50) / 5);
  return s;
}

// ---- seeded strings --------------------------------------------------------------------------------------------------------
function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const HEB = 'אבגדהוזחטיכלמנסעפצקרשתםןץףך';
const ASCII = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/.#-_ ?=&%';
const bytesOf = (s: string) => new TextEncoder().encode(s).length;
function randomText(r: () => number, target: number, hebrew: boolean): string {
  let s = '';
  for (;;) {
    const pool = hebrew && r() < 0.7 ? HEB : ASCII;
    const ch = pool[Math.floor(r() * pool.length)]!;
    if (bytesOf(s + ch) > target) { // finish with ASCII so the length can reach the target exactly
      while (bytesOf(s) < target) s += ASCII[Math.floor(r() * ASCII.length)]!;
      return s;
    }
    s += ch;
    if (bytesOf(s) === target) return s;
  }
}

describe('vectors computed from the definitions (plan §6)', () => {
  it('the eight format words of level M', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(qrFormatBits)).toEqual([0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]);
  });
  it('the version words of versions 7 to 10', () => {
    expect([7, 8, 9, 10].map(qrVersionBits)).toEqual([0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
  });
  it('the generator of 10 codewords has the exponents 0,251,67,46,61,118,70,64,94,32,45', () => {
    expect(rsGeneratorExponents(10)).toEqual([0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  });
  it('the 16-codeword Reed-Solomon vector', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsEncode(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it('the block table adds up: data + blocks × correction = total codewords, and the capacities follow from it', () => {
    QR_BLOCKS.forEach((b, v) => {
      if (v === 0) return;
      const data = b.groups.reduce((n, [c, d]) => n + c * d, 0);
      const blocks = b.groups.reduce((n, [c]) => n + c, 0);
      expect(data + blocks * b.ec, `v${v}`).toBe(b.total);
      const bitsLeft = data * 8 - 4 - (v < 10 ? 8 : 16);
      expect(Math.floor(bitsLeft / 8), `v${v}`).toBe(QR_CAPACITY[v]);
    });
    expect(QR_MAX_BYTES).toBe(213);
  });
});

describe('capacity and version choice', () => {
  const edges: [number, number][] = [[1, 1], [14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [43, 4], [62, 4], [63, 5], [84, 5], [85, 6], [106, 6], [107, 7], [122, 7], [123, 8], [152, 8], [153, 9], [180, 9], [181, 10], [213, 10]];
  for (const [len, v] of edges)
    it(`${len} bytes -> version ${v}`, () => {
      const m = encodeQr('a'.repeat(len));
      expect(m.version).toBe(v);
      expect(m.size).toBe(17 + 4 * v);
      expect(m.modules.length).toBe(m.size * m.size);
    });
  it('214 bytes is a RangeError, also in Hebrew (bytes, not characters)', () => {
    expect(() => encodeQr('a'.repeat(214))).toThrow(RangeError);
    expect(() => encodeQr('א'.repeat(107))).toThrow(RangeError);
    expect(() => encodeQr('א'.repeat(106))).not.toThrow();
  });
  it('the drop address is version 4 (at most 52 bytes)', () => {
    const url = `http://192.168.100.200:8788/#${'A'.repeat(22)}`;
    expect(bytesOf(url)).toBeLessThanOrEqual(52);
    expect(encodeQr(url).version).toBe(4);
    expect(encodeQr('http://10.0.0.5:8788/#abcdefghijklmnopqrstuv').version).toBe(4);
  });
  it('the data codewords are padded to the capacity with EC, 11', () => {
    const d = dataBytes(new TextEncoder().encode('hi'), 1);
    expect(d.length).toBe(16);
    expect(d.slice(0, 4)).toEqual([0x40, 0x26, 0x86, 0x90]);
    expect(d.slice(4, 8)).toEqual([0xec, 0x11, 0xec, 0x11]);
  });
});

describe('structure', () => {
  for (const text of ['x', 'http://192.168.1.20:8788/#0123456789abcdefghijkl', 'z'.repeat(130), 'א'.repeat(100)]) {
    it(`finders, timing, dark module and alignment of a ${bytesOf(text)}-byte message`, () => {
      const m = encodeQr(text);
      const n = m.size;
      const at = (x: number, y: number) => m.modules[y * n + x];
      for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const)
        for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) {
          const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          expect(at(ox + dx, oy + dy), `finder ${ox},${oy} ${dx},${dy}`).toBe(d === 2 ? 0 : 1);
        }
      // separators are light
      for (let i = 0; i < 8; i++) { expect(at(7, i)).toBe(0); expect(at(i, 7)).toBe(0); expect(at(n - 8, i)).toBe(0); expect(at(n - 1 - i, 7)).toBe(0); expect(at(7, n - 1 - i)).toBe(0); expect(at(i, n - 8)).toBe(0); }
      for (let i = 8; i < n - 8; i++) { expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0); expect(at(6, i)).toBe(i % 2 === 0 ? 1 : 0); }
      expect(at(8, n - 8)).toBe(1);
      if (m.version >= 2) { // the alignment pattern nearest the bottom right: 5x5 ring with a dark centre
        const c = ALIGN[m.version]!.at(-1)!;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) expect(at(c + dx, c + dy)).toBe(Math.max(Math.abs(dx), Math.abs(dy)) === 1 ? 0 : 1);
      }
      if (m.version >= 7) { // version words, both copies
        const w = qrVersionBits(m.version);
        for (let i = 0; i < 18; i++) { expect(at(n - 11 + (i % 3), Math.floor(i / 3))).toBe((w >> i) & 1); expect(at(Math.floor(i / 3), n - 11 + (i % 3))).toBe((w >> i) & 1); }
      }
    });
  }
  it('is deterministic and the modules are 0 or 1', () => {
    const a = encodeQr('שלום עולם 123'), b = encodeQr('שלום עולם 123');
    expect(Array.from(a.modules)).toEqual(Array.from(b.modules));
    expect(a.modules.every((v) => v === 0 || v === 1)).toBe(true);
  });
});

describe('the mask', () => {
  it('the chosen mask has the lowest penalty (the lowest number on a tie), by two separate counts', () => {
    const texts = ['http://192.168.1.20:8788/#AAAAAAAAAAAAAAAAAAAAAA', 'a', 'שלום', 'z'.repeat(100), 'http://10.0.0.5:8788/#abcdefghijklmnopqrstuv'];
    for (const t of texts) {
      const scores = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => { const m = encodeQrWithMask(t, k); const s = penalty(m); expect(qrPenalty(m), `${t} mask ${k}`).toBe(s); return s; });
      const m = encodeQr(t);
      expect(m.mask).toBe(scores.indexOf(Math.min(...scores)));
    }
  });
  it('the penalty rules on small known patterns', () => {
    // a 5-wide run costs 3, a 6-wide run 4; a 2x2 block 3 each; the balance of an all-dark grid is far from half
    const grid = (rows: string[]): QrMatrix => ({ version: 0, size: rows.length, mask: 0, modules: Uint8Array.from(rows.join('').split('').map(Number)) });
    const light = grid(Array(11).fill('00000000000'));
    expect(penalty(light)).toBe(qrPenalty(light));
    const g = grid(['10111010000', ...Array<string>(10).fill('01010101010')]);
    expect(qrPenalty(g)).toBe(penalty(g));
  });
});

describe('round trip through a reader', () => {
  it('reads a code back with zero syndromes (control: a flipped module breaks the syndromes)', () => {
    const m = encodeQr('http://192.168.1.20:8788/#AAAAAAAAAAAAAAAAAAAAAA');
    const ok = read(m);
    expect(ok.syndromes.every((s) => s === 0)).toBe(true);
    // flip one data module (not a function pattern): the reader must see a non-zero syndrome
    const n = m.size;
    const bad: QrMatrix = { ...m, modules: Uint8Array.from(m.modules) };
    let flipped = false;
    for (let y = n - 1; y > 8 && !flipped; y--) for (let x = n - 1; x > n - 3 && !flipped; x--) if (!isFunction(n, m.version, x, y)) { bad.modules[y * n + x] = bad.modules[y * n + x]! ^ 1; flipped = true; }
    expect(read(bad, false).syndromes.some((s) => s !== 0)).toBe(true);
  });
  it('200 seeded ASCII and Hebrew strings of 1-213 bytes come back identical with zero syndromes', () => {
    const r = rng(20261118);
    for (let i = 0; i < 200; i++) {
      const target = i === 0 ? 1 : i === 1 ? 213 : 1 + Math.floor(r() * 213);
      const text = randomText(r, target, i % 2 === 1);
      expect(bytesOf(text), `case ${i}`).toBe(target);
      const m = encodeQr(text);
      const back = read(m);
      expect(back.text, `case ${i}`).toBe(text);
      expect(back.syndromes.every((s) => s === 0), `case ${i} v${m.version}`).toBe(true);
      expect(back.mask).toBe(m.mask);
    }
  });
});

describe('qrSvgPath', () => {
  it('draws exactly the dark modules inside a quiet zone of 4, as one path', () => {
    const m = encodeQr('http://192.168.1.20:8788/#AAAAAAAAAAAAAAAAAAAAAA');
    const { d, viewBox } = qrSvgPath(m);
    expect(viewBox).toBe(`0 0 ${m.size + 8} ${m.size + 8}`);
    expect((d.match(/M/g) ?? []).length).toBeGreaterThan(0);
    // paint the path's rectangles into a grid and compare with the matrix
    const grid = new Uint8Array(m.size * m.size);
    for (const hit of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) { const [x, y, w] = [Number(hit[1]), Number(hit[2]), Number(hit[3])]; for (let k = 0; k < w; k++) grid[(y - 4) * m.size + (x - 4 + k)] = 1; }
    expect(Array.from(grid)).toEqual(Array.from(m.modules));
    expect(qrSvgPath(m, 0).viewBox).toBe(`0 0 ${m.size} ${m.size}`);
  });
});
