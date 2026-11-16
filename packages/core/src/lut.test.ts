import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  LUT_MAX_TEXT_LENGTH,
  LutError,
  identityLut,
  lutToRgba8Strip,
  parseCube,
  sampleLut,
  sampleStrip,
  serializeCube,
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
