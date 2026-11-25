import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIX_KEYS, makeLibraryFixture, type LibraryFixture } from '../../../../packages/evals/src/library-fixtures.ts';
import type { Config } from '../config.ts';
import { canRasteriseSvg } from '../elements.ts';
import { LibraryService } from './index.ts';
import * as raster from './raster.ts';
import { libraryThumb } from './thumbs.ts';

let base: string, fx: LibraryFixture, s: LibraryService, tmp: string;
const code = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
/** RGBA of the centre pixel of a PNG (ffmpeg decodes it). */
const centre = (png: Buffer): number[] => {
  const f = path.join(tmp, `c${Math.random().toString(36).slice(2)}.png`);
  fs.writeFileSync(f, png);
  const info = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
  const [w, h] = info as [number, number];
  const o = ((h >> 1) * w + (w >> 1)) * 4;
  return [w, h, raw[o]!, raw[o + 1]!, raw[o + 2]!, raw[o + 3]!];
};

beforeAll(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-libraster-'));
  fx = await makeLibraryFixture(path.join(base, 'fx'));
  tmp = path.join(base, 'tmp'); fs.mkdirSync(tmp);
  fs.mkdirSync(path.join(base, 'data'));
  s = new LibraryService({ dataDir: path.join(base, 'data'), libraryDir: fx.root } as Config);
  await new Promise((r) => setTimeout(r, 20));
  await s.idle();
}, 120_000);
afterAll(() => { s.close(); fs.rmSync(base, { recursive: true, force: true }); });

describe('sizing', () => {
  it('sets the long side, keeps the short side even, keeps the viewBox, replaces currentColor', () => {
    const out = raster.sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12" width="24px" height="12"><path fill="currentColor" d="M0 0h1v1z"/></svg>', 256, '#ff0000');
    expect(out).toContain('viewBox="0 0 24 12"');
    expect(out).toContain('width="256" height="128"');
    expect(out).not.toContain('width="24px"');
    expect(out).toContain('fill="#ff0000"');
    expect(raster.sizedSvg('<svg xmlns="http://www.w3.org/2000/svg" width="30" height="31"/>', 100)).toContain('viewBox="0 0 30 31" width="98" height="100"');
    expect(() => raster.sizedSvg('<svg xmlns="http://www.w3.org/2000/svg"/>', 100)).toThrow(/no size/);
  });
});

describe('untrusted SVG', () => {
  it('an unsafe SVG is refused 422 svg_unsafe before ffmpeg is started; a thumbnail of it too', async () => {
    const before = raster.libraryRasterRuns;
    const ix = s.get(FIX_KEYS.unsafe)!;
    expect(await code(raster.rasteriseRow(tmp, fx.root, ix, 128, undefined, 'preview'))).toBe('svg_unsafe');
    expect(await code(libraryThumb(path.join(base, 'data'), tmp, fx.root, ix, 128))).toBe('svg_unsafe');
    expect(raster.libraryRasterRuns).toBe(before);
  });
  it('an icon becomes a PNG with alpha at the asked size in the asked colour (BLOCKED without librsvg)', async (t) => {
    if (!(await canRasteriseSvg())) return t.skip();
    const { png, sourceSha256 } = await raster.rasteriseRow(tmp, fx.root, s.get(FIX_KEYS.iconCircle)!, 256, '#ff0000', 'add');
    const [w, h, r, g, b, a] = centre(png);
    expect([w, h]).toEqual([256, 256]);
    expect(r).toBeGreaterThanOrEqual(200);
    expect([g, b, a]).toEqual([0, 0, 255]);
    expect(sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const thumb = await libraryThumb(path.join(base, 'data'), tmp, fx.root, s.get(FIX_KEYS.heart)!, 128);
    expect(centre(thumb).slice(0, 3)).toEqual([128, 128, 255]);
  });
  it('a picture thumbnail is a PNG made here (a cached one is still checked against the file)', async () => {
    const t = await libraryThumb(path.join(base, 'data'), tmp, fx.root, s.get(FIX_KEYS.menorah)!, 128);
    expect(centre(t).slice(0, 2)).toEqual([128, 128]);
    expect(await code(libraryThumb(path.join(base, 'data'), tmp, fx.root, s.get(FIX_KEYS.tampered)!, 128))).toBe('not_found'); // sound has no picture
    // the cached thumbnail of a file changed since indexing is not served
    const p = path.join(fx.root, 'visual', 'emoji', 'fluent', 'assets', 'Menorah', '3D', 'menorah_3d.png');
    const st = fs.statSync(p);
    fs.utimesSync(p, st.atime, new Date(st.mtimeMs + 5000));
    try { expect(await code(libraryThumb(path.join(base, 'data'), tmp, fx.root, s.get(FIX_KEYS.menorah)!, 128))).toBe('library_changed_since_index'); }
    finally { fs.utimesSync(p, st.atime, st.mtime); }
  });
});
