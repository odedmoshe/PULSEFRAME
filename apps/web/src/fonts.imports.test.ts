/**
 * The CSS imports of fonts.ts and titleFonts.ts name exactly the hebrew and latin file of every weight of every family of
 * FONT_CATALOG (ADR-0022), and every package is what the catalogue says: pinned at the version the row names, its LICENSE
 * the SIL OFL 1.1 text, its metadata listing the hebrew and latin subsets and the weights. Read as text: no stylesheet loads here.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, HELD_TITLE_FONTS, TITLE_FONT_ROWS } from '@pulseframe/core';

const here = (f: string) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const importsOf = (src: string) => [...src.matchAll(/^import '(@fontsource\/[^']+)';/gm)].map((m) => m[1]!);
const require_ = createRequire(import.meta.url);
const packageDir = (pkg: string) => path.dirname(require_.resolve(`${pkg}/package.json`, { paths: [import.meta.dirname] }));
const web = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };

describe('font imports', () => {
  it('fonts.ts and titleFonts.ts together import exactly the files of FONT_CATALOG, each once', () => {
    const imports = [...importsOf(here('./fonts.ts')), ...importsOf(here('./titleFonts.ts'))].sort();
    const expected = FONT_CATALOG.flatMap((f) => f.weights.flatMap((w) => ['hebrew', 'latin'].map((s) => `${f.package}/${s}-${w}.css`))).sort();
    expect(imports).toEqual(expected);
    expect(new Set(imports).size).toBe(imports.length);
  });

  it('fonts.ts imports titleFonts.ts, so every page that calls ensureFonts loads the title fonts', () => {
    expect(here('./fonts.ts')).toMatch(/^import '\.\/titleFonts\.ts';$/m);
    expect(here('./render.ts')).toMatch(/import \{ ensureFonts \} from '\.\/fonts\.ts'/);
  });

  it('titleFonts.ts lists the families of TITLE_FONT_ROWS, and TITLE_FONT_ROWS are rows of the catalogue', () => {
    expect(here('./titleFonts.ts')).toContain(`[${TITLE_FONT_ROWS.map((f) => `'${f.family}'`).join(', ')}] as const`);
    for (const r of TITLE_FONT_ROWS) expect(FONT_CATALOG).toContain(r);
  });

  it('a family held for the owner is neither in the catalogue nor pinned nor imported', () => {
    for (const h of HELD_TITLE_FONTS) {
      expect(FONT_CATALOG.some((f) => f.family === h.family)).toBe(false);
      expect(web.dependencies[h.package]).toBeUndefined();
      expect(here('./fonts.ts') + here('./titleFonts.ts')).not.toContain(h.package);
    }
  });

  for (const f of FONT_CATALOG) {
    it(`${f.family}: pinned exactly, OFL 1.1 LICENSE, hebrew and latin subsets and its weights in the metadata`, () => {
      expect(web.dependencies[f.package]).toBe(f.version);
      const dir = packageDir(f.package);
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string };
      expect(pkg.version).toBe(f.version);
      const licence = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
      expect(licence).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/i);
      expect(licence).toMatch(/PERMISSION & CONDITIONS/);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf8')) as { subsets: string[]; weights: number[]; license: { type: string } };
      expect(meta.license.type).toBe('OFL-1.1');
      expect(meta.subsets).toEqual(expect.arrayContaining(['hebrew', 'latin']));
      for (const w of f.weights) {
        expect(meta.weights).toContain(w);
        for (const s of ['hebrew', 'latin']) {
          expect(fs.existsSync(path.join(dir, 'files', `${f.slug}-${s}-${w}-normal.woff2`)), `${s} ${w} woff2`).toBe(true);
          expect(fs.existsSync(path.join(dir, 'files', `${f.slug}-${s}-${w}-normal.woff`)), `${s} ${w} woff`).toBe(true);
        }
      }
    });
  }

  it('no slug followed by a dash begins another slug (the export pins a family\'s files by that prefix)', () => {
    for (const a of FONT_CATALOG) for (const b of FONT_CATALOG) if (a !== b) expect(`${b.slug}-`.startsWith(`${a.slug}-`)).toBe(false);
  });

  it("a row says 'positioned' only for a family with the Hebrew subset", () => {
    for (const f of FONT_CATALOG) if (f.nikud) expect(f.hebrew).toBe(true);
  });
});
