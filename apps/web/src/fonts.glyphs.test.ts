/**
 * Glyph checks of the bundled fonts (ADR-0022, plan 4.8). Reads each family's Hebrew .woff of every weight of FONT_CATALOG
 * (and of TITLE_FONT_ROWS) with node:zlib: the cmap (formats 4 and 12) and the GPOS feature list. A family is offered for
 * pointed Hebrew only when this test proves it, never by hand:
 *   - the 27 letters U+05D0-05EA,
 *   - the 16 points U+05B0-05BC, U+05C1, U+05C2, U+05C7,
 *   - maqaf U+05BE, geresh U+05F3, gershayim U+05F4 and the sheqel sign U+20AA,
 *   - the GPOS feature 'mark' (what positions a point under or over its letter).
 * Recorded, not required: meteg U+05BD, rafe U+05BF and the cantillation marks U+0591-05AF.
 * Each latin file must hold the digits, comma, '!' and the em dash U+2014.
 * It parses .woff. The browser proof (pnpm proof:fonts) covers the .woff2 files the build ships, which are the same fonts
 * in another container; this test does not read them.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, TITLE_FONT_ROWS, type FontEntry } from '@pulseframe/core';

const require_ = createRequire(import.meta.url);
const packageDir = (pkg: string) => path.dirname(require_.resolve(`${pkg}/package.json`, { paths: [import.meta.dirname] }));

/** The tables of a WOFF 1 file, inflated. */
function woffTables(buf: Buffer): Map<string, Buffer> {
  if (buf.toString('latin1', 0, 4) !== 'wOFF') throw new Error('not a WOFF 1 file');
  const n = buf.readUInt16BE(12);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < n; i++) {
    const e = 44 + i * 20;
    const tag = buf.toString('latin1', e, e + 4), off = buf.readUInt32BE(e + 4), comp = buf.readUInt32BE(e + 8), orig = buf.readUInt32BE(e + 12);
    const raw = buf.subarray(off, off + comp);
    out.set(tag, comp < orig ? zlib.inflateSync(raw) : Buffer.from(raw));
  }
  return out;
}

/** Every code point the cmap maps to a glyph other than 0: all Unicode subtables, formats 4 and 12 (others are skipped). */
export function cmapCodePoints(cmap: Buffer): Set<number> {
  const cps = new Set<number>();
  const n = cmap.readUInt16BE(2);
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8), offset = cmap.readUInt32BE(8 + i * 8);
    if (platform !== 0 && platform !== 3) continue;
    if (seen.has(offset)) continue;
    seen.add(offset);
    const format = cmap.readUInt16BE(offset);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(offset + 6), segs = segX2 / 2;
      const endBase = offset + 14, startBase = endBase + segX2 + 2, deltaBase = startBase + segX2, rangeBase = deltaBase + segX2;
      for (let s = 0; s < segs; s++) {
        const end = cmap.readUInt16BE(endBase + s * 2), start = cmap.readUInt16BE(startBase + s * 2);
        const delta = cmap.readInt16BE(deltaBase + s * 2), rangeOff = cmap.readUInt16BE(rangeBase + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let g: number;
          if (rangeOff === 0) g = (c + delta) & 0xffff;
          else {
            const at = rangeBase + s * 2 + rangeOff + (c - start) * 2;
            if (at + 2 > cmap.length) continue;
            g = cmap.readUInt16BE(at);
            if (g !== 0) g = (g + delta) & 0xffff;
          }
          if (g !== 0) cps.add(c);
        }
      }
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g++) {
        const at = offset + 16 + g * 12;
        const start = cmap.readUInt32BE(at), end = cmap.readUInt32BE(at + 4), glyph = cmap.readUInt32BE(at + 8);
        for (let c = start; c <= end; c++) if (glyph + (c - start) !== 0) cps.add(c);
      }
    }
  }
  return cps;
}

/** The feature tags of the GPOS table (empty when there is none). */
export function gposFeatures(gpos: Buffer | undefined): Set<string> {
  const tags = new Set<string>();
  if (!gpos) return tags;
  const featureList = gpos.readUInt16BE(6);
  const count = gpos.readUInt16BE(featureList);
  for (let i = 0; i < count; i++) tags.add(gpos.toString('latin1', featureList + 2 + i * 6, featureList + 6 + i * 6));
  return tags;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const LETTERS = range(0x5d0, 0x5ea);
const POINTS = [...range(0x5b0, 0x5bc), 0x5c1, 0x5c2, 0x5c7];
const PUNCTUATION = { maqaf: 0x5be, geresh: 0x5f3, gershayim: 0x5f4, sheqel: 0x20aa };
const LATIN_NEEDED = [...range(0x30, 0x39), 0x2c, 0x21, 0x2014];
const missing = (cps: Set<number>, want: number[]) => want.filter((c) => !cps.has(c)).map((c) => `U+${c.toString(16).toUpperCase().padStart(4, '0')}`);

/** The families under test: the catalogue and the title rows (a row is in the catalogue only once it has passed). */
const FAMILIES: readonly FontEntry[] = [...new Map([...FONT_CATALOG, ...TITLE_FONT_ROWS].map((f) => [f.family, f])).values()];

describe('bundled fonts: glyphs and the mark feature', () => {
  it('the test parser reads the cmap and the GPOS features of a known file', () => {
    const t = woffTables(fs.readFileSync(path.join(packageDir('@fontsource/heebo'), 'files/heebo-hebrew-400-normal.woff')));
    const cps = cmapCodePoints(t.get('cmap')!);
    expect(cps.has(0x5d0)).toBe(true);
    expect(cps.has(0x430), "Cyrillic is not in a Hebrew subset").toBe(false);
    expect(gposFeatures(t.get('GPOS')).size).toBeGreaterThan(0);
  });

  it('the parser can fail: a table without the feature, or without a table, reports no mark', () => {
    // GPOS header (10 bytes) then a feature list with one 'kern' record.
    const g = Buffer.alloc(10 + 2 + 6 + 2);
    g.writeUInt16BE(1, 0); g.writeUInt16BE(0, 2); g.writeUInt16BE(0, 4); g.writeUInt16BE(10, 6); g.writeUInt16BE(0, 8);
    g.writeUInt16BE(1, 10); g.write('kern', 12, 'latin1'); g.writeUInt16BE(0, 16);
    expect([...gposFeatures(g)]).toEqual(['kern']);
    expect(gposFeatures(undefined).has('mark')).toBe(false);
    expect(missing(new Set([0x5d0]), LETTERS)).toHaveLength(26);
  });

  for (const font of FAMILIES) {
    describe(font.family, () => {
      const dir = () => path.join(packageDir(font.package), 'files');
      for (const w of font.weights) {
        it(`hebrew ${w}: 27 letters, 16 points, maqaf, geresh, gershayim, sheqel and the 'mark' feature`, () => {
          const t = woffTables(fs.readFileSync(path.join(dir(), `${font.slug}-hebrew-${w}-normal.woff`)));
          const cps = cmapCodePoints(t.get('cmap')!);
          expect(missing(cps, LETTERS), 'letters').toEqual([]);
          expect(missing(cps, POINTS), 'points').toEqual([]);
          for (const [name, c] of Object.entries(PUNCTUATION)) expect(cps.has(c), name).toBe(true);
          const features = gposFeatures(t.get('GPOS'));
          expect(features.has('mark'), `GPOS features: ${[...features].join(',')}`).toBe(true);
          // recorded, not required
          const recorded = { meteg: cps.has(0x5bd), rafe: cps.has(0x5bf), cantillation: range(0x591, 0x5af).filter((c) => cps.has(c)).length };
          expect(recorded.cantillation).toBeGreaterThanOrEqual(0);
          RECORDED.push({ family: font.family, weight: w, ...recorded });
        });
        it(`latin ${w}: digits, comma, '!' and the em dash`, () => {
          const t = woffTables(fs.readFileSync(path.join(dir(), `${font.slug}-latin-${w}-normal.woff`)));
          expect(missing(cmapCodePoints(t.get('cmap')!), LATIN_NEEDED)).toEqual([]);
        });
      }
    });
  }

  it('records meteg, rafe and cantillation counts (informational)', () => {
    // eslint-disable-next-line no-console
    if (process.env.PF_FONT_RECORD) console.log(JSON.stringify(RECORDED));
    expect(RECORDED.length).toBeGreaterThanOrEqual(0);
  });
});

const RECORDED: { family: string; weight: number; meteg: boolean; rafe: boolean; cantillation: number }[] = [];
