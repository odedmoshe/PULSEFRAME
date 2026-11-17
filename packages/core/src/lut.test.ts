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

/** A non-separable table over an arbitrary domain: output = rotated channels of the domain-normalised input, with a gamma. */
function rotatedGamma(n: number, lo: number, hi: number): Lut3D {
  const data = new Float32Array(n ** 3 * 3);
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const x = [r, g, b].map((v) => lo + ((hi - lo) * v) / (n - 1)); // the input this entry stands for
    const u = x.map((v) => (v - lo) / (hi - lo));
    data[i++] = Math.pow(u[2]!, 1 / 2.2);
    data[i++] = Math.pow(u[0]!, 1 / 2.2);
    data[i++] = Math.pow(u[1]!, 1 / 2.2);
  }
  return { title: 'rot', size: n, data, domainMin: [lo, lo, lo], domainMax: [hi, hi, hi] };
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
