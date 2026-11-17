import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  LUT_MAX_TEXT_LENGTH,
  LutError,
  identityLut,
  lutStrip,
  lutToRgba8Strip,
  parseCube,
  sampleLut,
  sampleStrip,
  serializeCube,
  unitDomainLut,
  type Lut3D,
} from './lut.js';

function err(fn: () => unknown): LutError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(LutError);
    return e as LutError;
  }
  throw new Error('expected LutError');
}

const rgbArb = fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }));

// size 2, entry (r,g,b) = distinct values; file order red fastest
const HAND = `LUT_3D_SIZE 2
0.0 0.0 0.0
0.1 0.0 0.0
0.0 0.2 0.0
0.1 0.2 0.0
0.0 0.0 0.3
0.1 0.0 0.3
0.0 0.2 0.3
1.0 1.0 1.0
`;

function cube(size: number, extra = ''): string {
  const lines = [`LUT_3D_SIZE ${size}`, extra];
  for (let i = 0; i < size ** 3; i++) lines.push('0 0 0');
  return lines.join('\n');
}

describe('parseCube', () => {
  it('parses identity sizes and samples them back', () => {
    for (const n of [2, 17, 33]) {
      const lut = parseCube(serializeCube(identityLut(n)));
      expect(lut.size).toBe(n);
      fc.assert(
        fc.property(rgbArb, (c) => {
          const o = sampleLut(lut, c);
          for (let i = 0; i < 3; i++) expect(Math.abs(o[i]! - c[i]!)).toBeLessThan(1e-6);
        }),
        { numRuns: 50 },
      );
    }
  });

  it('round trips random small LUTs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4 }), fc.array(fc.float({ noNaN: true, noDefaultInfinity: true }), { minLength: 192, maxLength: 192 }), (n, vals) => {
        const lut: Lut3D = { title: 'My LUT', size: n, data: Float32Array.from(vals.slice(0, n ** 3 * 3)), domainMin: [0, -1, 0], domainMax: [1, 2, 3] };
        const back = parseCube(serializeCube(lut));
        expect(back.size).toBe(n);
        expect(back.title).toBe('My LUT');
        expect(back.domainMin).toEqual(lut.domainMin);
        expect(back.domainMax).toEqual(lut.domainMax);
        expect(Array.from(back.data)).toEqual(Array.from(lut.data));
      }),
    );
  });

  it('uses red-fastest order', () => {
    const lut = parseCube(HAND);
    const at = (r: number, g: number, b: number) => Array.from(lut.data.slice((r + g * 2 + b * 4) * 3, (r + g * 2 + b * 4) * 3 + 3));
    expect(at(1, 0, 0)[0]).toBeCloseTo(0.1);
    expect(at(0, 1, 0)[1]).toBeCloseTo(0.2);
    expect(at(0, 0, 1)[2]).toBeCloseTo(0.3);
    expect(at(1, 1, 0)).toEqual([Math.fround(0.1), Math.fround(0.2), 0]);
    expect(at(1, 1, 1)).toEqual([1, 1, 1]);
  });

  it('accepts BOM, CRLF, comments, whitespace, any case, quoted title, scientific numbers', () => {
    const t = '﻿# hi\r\n\r\n  title "Warm look"\t\r\n\tlut_3d_size 2 \r\n' + Array(8).fill(' 1e-1\t0.5  +.25 ').join('\r\n') + '\r\n';
    const lut = parseCube(t);
    expect(lut.title).toBe('Warm look');
    expect(lut.data[0]).toBeCloseTo(0.1);
    expect(lut.data[2]).toBeCloseTo(0.25);
    expect(parseCube('TITLE bare\n' + cube(2)).title).toBe('bare');
  });

  it('rejects 1D LUTs as unsupported', () => {
    expect(err(() => parseCube('LUT_1D_SIZE 4\n0 0 0\n')).code).toBe('unsupported');
    const e = err(() => parseCube('LUT_3D_SIZE 2\nLUT_1D_SIZE 4\n'));
    expect(e.code).toBe('unsupported');
    expect(e.line).toBe(2);
  });

  it('rejects unknown keywords with the line', () => {
    const e = err(() => parseCube('# c\nFOO 1\nLUT_3D_SIZE 2\n'));
    expect(e).toMatchObject({ code: 'malformed', line: 2 });
  });

  it('validates the size', () => {
    expect(err(() => parseCube('LUT_3D_SIZE 1\n'))).toMatchObject({ code: 'malformed', line: 1 });
    expect(err(() => parseCube('LUT_3D_SIZE 2.5\n')).code).toBe('malformed');
    expect(err(() => parseCube('LUT_3D_SIZE abc\n')).code).toBe('malformed');
    expect(err(() => parseCube('LUT_3D_SIZE 66\n'))).toMatchObject({ code: 'too_large', line: 1 });
    expect(err(() => parseCube('LUT_3D_SIZE 17\n', { maxSize: 8 })).code).toBe('too_large');
    expect(err(() => parseCube('LUT_3D_SIZE 99999999999999\n')).code).toBe('malformed');
    expect(err(() => parseCube('0 0 0\nLUT_3D_SIZE 2\n'))).toMatchObject({ code: 'malformed', line: 1 });
    expect(err(() => parseCube('# nothing\n')).code).toBe('malformed');
  });

  it('validates data lines', () => {
    const bad = (line: string) => err(() => parseCube(`LUT_3D_SIZE 2\n0 0 0\n${line}\n`));
    expect(bad('0 0')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 0 0')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 abc')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 1e999')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 NaN')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 Infinity')).toMatchObject({ code: 'malformed', line: 3 });
    expect(bad('0 0 1.2.3')).toMatchObject({ code: 'malformed', line: 3 });
  });

  it('requires exactly size^3 data lines', () => {
    expect(err(() => parseCube(cube(2).split('\n').slice(0, -1).join('\n'))).code).toBe('malformed');
    const e = err(() => parseCube(cube(2) + '\n0 0 0\n'));
    expect(e.code).toBe('malformed');
    expect(e.line).toBe(11);
  });

  it('keeps every message short, whatever the file holds: a refusal never carries the file back', () => {
    const long = 'Q'.repeat(3_000_000);
    const cases = [
      `LUT_3D_SIZE 2\n0 0 0\n${long}\n`, // a keyword after data
      `${long} 1\n`, // an unknown keyword
      `LUT_3D_SIZE 2\n0 0 ${'9'.repeat(3_000_000)}\n`, // a number
      `LUT_3D_SIZE 2\n0 0 1e${'9'.repeat(40)}\n`, // not finite
      `LUT_3D_SIZE ${'7'.repeat(3_000_000)}\n`,
      `DOMAIN_MIN ${long} 0 0\n`,
      `TITLE "${long}"\nLUT_3D_SIZE 2\n0 0 0\n`,
    ];
    for (const text of cases) {
      const e = err(() => parseCube(text));
      expect(e.message.length).toBeLessThanOrEqual(120);
    }
    expect(err(() => parseCube(cases[0]!))).toMatchObject({ code: 'malformed', line: 3, message: `Keyword ${'Q'.repeat(32)} after data` });
  });

  it('rejects oversized text before other work', () => {
    expect(err(() => parseCube('#'.repeat(LUT_MAX_TEXT_LENGTH + 1))).code).toBe('too_large');
  });

  it('applies DOMAIN_MIN / DOMAIN_MAX', () => {
    const lut = parseCube(cube(2, 'DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2'));
    expect(lut.domainMax).toEqual([2, 2, 2]);
    const id = { ...identityLut(2), domainMax: [2, 2, 2] as [number, number, number] };
    const o = sampleLut(id, [1, 0.5, 2]);
    expect(o[0]).toBeCloseTo(0.5);
    expect(o[1]).toBeCloseTo(0.25);
    expect(o[2]).toBeCloseTo(1);
    expect(err(() => parseCube(cube(2, 'DOMAIN_MAX 0 1 1'))).code).toBe('malformed');
    expect(err(() => parseCube(cube(2, 'DOMAIN_MIN 0 0'))).code).toBe('malformed');
  });

  it('applies LUT_3D_INPUT_RANGE to all channels', () => {
    const lut = parseCube(cube(2, 'LUT_3D_INPUT_RANGE -1 3'));
    expect(lut.domainMin).toEqual([-1, -1, -1]);
    expect(lut.domainMax).toEqual([3, 3, 3]);
    expect(err(() => parseCube(cube(2, 'LUT_3D_INPUT_RANGE 3 3'))).code).toBe('malformed');
  });

  it('parses a 65 identity quickly', () => {
    const text = serializeCube(identityLut(65));
    const t0 = performance.now();
    const lut = parseCube(text);
    expect(lut.size).toBe(65);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it('never throws anything but LutError on junk', () => {
    const run = (s: string) => {
      try {
        parseCube(s);
      } catch (e) {
        expect(e).toBeInstanceOf(LutError);
      }
    };
    fc.assert(fc.property(fc.string({ maxLength: 300 }), run), { numRuns: 300 });
    fc.assert(
      fc.property(fc.array(fc.constantFrom('LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', '1 2 3', '# x', 'TITLE', '', 'zz', '0.5 0.5', '\t'), { maxLength: 20 }), (ls) => run(ls.join('\n'))),
      { numRuns: 300 },
    );
  });
});

describe('strip', () => {
  it('lays out entries as (r + b*size, g)', () => {
    const lut = parseCube(HAND);
    const s = lutToRgba8Strip(lut);
    expect([s.width, s.height]).toEqual([4, 2]);
    const px = (x: number, y: number) => Array.from(s.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    expect(px(0, 0)).toEqual([0, 0, 0, 255]);
    expect(px(1, 0)).toEqual([26, 0, 0, 255]); // r=1,g=0,b=0
    expect(px(0, 1)).toEqual([0, 51, 0, 255]); // g=1
    expect(px(1, 1)).toEqual([26, 51, 0, 255]);
    expect(px(2, 0)).toEqual([0, 0, 77, 255]); // b=1 -> x = 0 + 2
    expect(px(3, 0)).toEqual([26, 0, 77, 255]);
    expect(px(2, 1)).toEqual([0, 51, 77, 255]);
    expect(px(3, 1)).toEqual([255, 255, 255, 255]);
  });

  it('sampleStrip of identity 33 is within 2/255', () => {
    const s = lutToRgba8Strip(identityLut(33));
    fc.assert(
      fc.property(rgbArb, (c) => {
        const o = sampleStrip(s, 33, c);
        for (let i = 0; i < 3; i++) expect(Math.abs(o[i]! - c[i]!)).toBeLessThanOrEqual(2 / 255);
      }),
    );
  });

  it('sampleStrip tracks sampleLut for a smooth LUT within 3/255', () => {
    const n = 33;
    const lut = identityLut(n);
    for (let i = 0; i < n ** 3; i++) {
      const r = lut.data[i * 3]!;
      const g = lut.data[i * 3 + 1]!;
      const b = lut.data[i * 3 + 2]!;
      lut.data[i * 3] = Math.pow(b, 1 / 2.2);
      lut.data[i * 3 + 1] = Math.pow(r, 1 / 2.2);
      lut.data[i * 3 + 2] = Math.pow(g, 1 / 2.2);
    }
    const s = lutToRgba8Strip(lut);
    fc.assert(
      fc.property(rgbArb, (c) => {
        const a = sampleStrip(s, n, c);
        const b = sampleLut(lut, c);
        for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(3 / 255);
      }),
    );
  });
});

/**
 * A non-separable table over an arbitrary domain: output = rotated channels of the domain-normalised input, with a gamma
 * (`ofInput`: of the input value itself, clamped to 0..1, as a conversion table would hold).
 */
function rotatedGamma(n: number, lo: number, hi: number, ofInput = false): Lut3D {
  const data = new Float32Array(n ** 3 * 3);
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const x = [r, g, b].map((v) => lo + ((hi - lo) * v) / (n - 1)); // the input this entry stands for
    const u = x.map((v) => (ofInput ? Math.min(1, Math.max(0, v)) : (v - lo) / (hi - lo)));
    data[i++] = Math.pow(u[2]!, 1 / 2.2);
    data[i++] = Math.pow(u[0]!, 1 / 2.2);
    data[i++] = Math.pow(u[1]!, 1 / 2.2);
  }
  return { title: 'rot', size: n, data, domainMin: [lo, lo, lo], domainMax: [hi, hi, hi] };
}

/**
 * Largest difference, in units of 1/255, between `got` and the file's definition (sampleLut on the table as parsed) over a fixed
 * set of 300,000 colours, half of them dark (below 0.15), where a gamma-type table is steepest.
 */
function worstOf255(lut: Lut3D, got: (c: [number, number, number]) => readonly number[]): number {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  let worst = 0;
  for (let i = 0; i < 300_000; i++) {
    const k = i % 2 === 0 ? 0.15 : 1;
    const c: [number, number, number] = [rnd() * k, rnd() * k, rnd() * k];
    const a = got(c);
    const b = sampleLut(lut, c);
    for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(a[j]! - b[j]!) * 255);
  }
  return worst;
}

describe('unit domain and the strip every context uses', () => {
  it('unitDomainLut returns the very same table when the domain is already 0..1', () => {
    const lut = rotatedGamma(9, 0, 1);
    expect(unitDomainLut(lut)).toBe(lut);
  });

  it('unitDomainLut resamples another domain onto a 0..1 grid of the same size, keeping title and what sampleLut answers', () => {
    const lut = rotatedGamma(17, 0, 2);
    const unit = unitDomainLut(lut);
    expect(unit).not.toBe(lut);
    expect([unit.size, unit.title, unit.domainMin, unit.domainMax]).toEqual([17, 'rot', [0, 0, 0], [1, 1, 1]]);
    expect(unit.data.length).toBe(lut.data.length);
    // grid points of the new table are the old table sampled there
    expect(Array.from(unit.data.slice(0, 3))).toEqual(sampleLut(lut, [0, 0, 0]).map((v) => Math.fround(v)));
    const last = 17 ** 3 - 1;
    expect(Array.from(unit.data.slice(last * 3, last * 3 + 3))).toEqual(sampleLut(lut, [1, 1, 1]).map((v) => Math.fround(v)));
    fc.assert(
      fc.property(rgbArb, (c) => {
        const a = sampleLut(unit, c);
        const b = sampleLut(lut, c);
        for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(1e-5);
      }),
    );
  });

  it('a table with domain 0..2 samples, through lutStrip, like sampleLut on the original within 3/255', () => {
    const lut = rotatedGamma(33, 0, 2);
    const strip = lutStrip(serializeCube(lut));
    expect([strip.size, strip.width, strip.height, strip.data.length]).toEqual([33, 33 * 33, 33, 33 * 33 * 33 * 4]);
    // ignoring the domain would be far off: the plain strip of the same file answers differently
    const naive = lutToRgba8Strip(lut);
    const far = sampleStrip(naive, 33, [0.5, 0.5, 0.5]).map((v, i) => Math.abs(v - sampleLut(lut, [0.5, 0.5, 0.5])[i]!));
    expect(Math.max(...far)).toBeGreaterThan(20 / 255);
    fc.assert(
      fc.property(rgbArb, (c) => {
        const a = sampleStrip(strip, strip.size, c);
        const b = sampleLut(lut, c);
        for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(3 / 255);
      }),
    );
  });

  it('a domain that does not line up with the file\'s grid is resampled onto the smallest finer grid that holds every entry of the file, and loses nothing', () => {
    // 0..1.5 at size 17: entries at k*3/32, all on a grid of 33. -0.1..1.1 at size 17: entries at -0.1 + k*0.075, on a grid of 41.
    for (const [lo, hi, grid] of [[0, 1.5, 33], [-0.1, 1.1, 41]] as const) {
      const lut = rotatedGamma(17, lo, hi);
      const unit = unitDomainLut(lut);
      expect([unit.size, unit.domainMin, unit.domainMax]).toEqual([grid, [0, 0, 0], [1, 1, 1]]);
      const strip = lutStrip(serializeCube(lut));
      expect([strip.size, strip.width, strip.height]).toEqual([grid, grid * grid, grid]);
      expect(worstOf255(lut, (c) => sampleLut(unit, c))).toBeLessThanOrEqual(0.01);
      expect(worstOf255(lut, (c) => sampleStrip(strip, strip.size, c))).toBeLessThanOrEqual(1); // what is left is the 8-bit strip
    }
  });

  it('a domain that fits no grid up to 65 (a video-range table, 0..1.25) is resampled at 65: an approximation, within 4/255 of the file\'s definition even in the steepest cell (5/255 for the worst domain found)', () => {
    // Measured with this table (a gamma of the domain-normalised input, so the first cell is very steep): 3.3 of 255 for both.
    // On the file's own grid size the same tables were 5.8 and 5.3 of 255 away.
    for (const [n, lo, hi] of [[17, 0.0625, 0.9375], [33, 0, 1.25]] as const) {
      const lut = rotatedGamma(n, lo, hi);
      const strip = lutStrip(serializeCube(lut));
      expect(strip.size).toBe(65);
      expect(worstOf255(lut, (c) => sampleStrip(strip, strip.size, c))).toBeLessThanOrEqual(4);
    }
    // the worst found: a domain with no relation to any grid (0.01..1.37 at size 33) is 4.5 of 255 away in its darkest cell
    const awkward = rotatedGamma(33, 0.01, 1.37);
    const awkwardStrip = lutStrip(serializeCube(awkward));
    expect(awkwardStrip.size).toBe(65);
    expect(worstOf255(awkward, (c) => sampleStrip(awkwardStrip, awkwardStrip.size, c))).toBeLessThanOrEqual(5);
    // a gentler table (a gamma of the real input value, as a conversion table holds) over the same video-range domain: within 1/255
    const gentle = rotatedGamma(17, 0.0625, 0.9375, true);
    const strip = lutStrip(serializeCube(gentle));
    expect(worstOf255(gentle, (c) => sampleStrip(strip, strip.size, c))).toBeLessThanOrEqual(1);
  });

  it('LUT_3D_INPUT_RANGE is honoured the same way, and a unit-domain file gives exactly the plain strip', () => {
    const wide = rotatedGamma(9, 0, 4);
    const text = `LUT_3D_SIZE 9\nLUT_3D_INPUT_RANGE 0 4\n${serializeCube(wide).split('\n').slice(4).join('\n')}`;
    const strip = lutStrip(text);
    for (const c of [[0, 0, 0], [1, 1, 1], [0.25, 0.5, 0.75], [0.9, 0.1, 0.4]] as const) {
      const a = sampleStrip(strip, 9, c);
      const b = sampleLut(wide, c);
      for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThanOrEqual(3 / 255);
    }
    const plain = rotatedGamma(9, 0, 1);
    const viaText = lutStrip(serializeCube(plain));
    expect(viaText.size).toBe(9);
    expect(Array.from(viaText.data)).toEqual(Array.from(lutToRgba8Strip(plain).data));
  });

  it('lutStrip throws only LutError on text that is not a 3D table', () => {
    expect(err(() => lutStrip('hello')).code).toBe('malformed');
    expect(err(() => lutStrip('LUT_1D_SIZE 4\n0 0 0\n')).code).toBe('unsupported');
  });
});
