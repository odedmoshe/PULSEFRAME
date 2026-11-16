import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AssetSchema } from '@pulseframe/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT_CATEGORIES, ELEMENTS, elementSvg } from '../../../packages/core/src/elements.ts';
import { canRasteriseSvg, elementFfmpegArgs, elementPreview, makeElement, sizeSvg } from './elements.ts';
import { Store } from './store.ts';

const exec = promisify(execFile);
let dir: string;
let store: Store;
beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-elements-')); store = new Store(path.join(dir, 'data')); });
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function renderPng(id: string, color: string, longSide: number, tag: string): Promise<Buffer> {
  const svgFile = path.join(dir, `${tag}.svg`), png = path.join(dir, `${tag}.png`);
  fs.writeFileSync(svgFile, sizeSvg(elementSvg(id, { color, color2: '#0000FF' }), id, longSide));
  await exec('ffmpeg', elementFfmpegArgs(svgFile, png, longSide), { timeout: 30_000 });
  return fs.readFileSync(png);
}
async function decode(png: Buffer, tag: string): Promise<{ w: number; h: number; raw: Buffer }> {
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const f = path.join(dir, `${tag}.dec.png`);
  fs.writeFileSync(f, png);
  const { stdout } = await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  return { w, h, raw: stdout as unknown as Buffer };
}

describe('element rasteriser', () => {
  it('this machine can read SVG', async () => { expect(await canRasteriseSvg()).toBe(true); });

  // At least two per category, spread over several designs.
  const sample = ELEMENT_CATEGORIES.flatMap((c) => ELEMENTS.filter((e) => e.category === c).filter((_, i) => i % 7 === 0).slice(0, 2).map((e) => e.id));
  it('samples all categories', () => { expect(sample.length).toBeGreaterThanOrEqual(12); });
  for (const id of sample) {
    it(`${id}: size, alpha, colour, determinism`, async () => {
      const tag = id.replaceAll('.', '_');
      const a = await renderPng(id, '#FF0000', 160, tag);
      const def = ELEMENTS.find((e) => e.id === id)!;
      const { w, h, raw } = await decode(a, tag);
      expect(Math.max(w, h)).toBe(160);
      expect(w / h).toBeCloseTo(def.width / def.height, 1);
      expect(raw.length).toBe(w * h * 4);
      let transparent = 0, opaque = 0, red = 0;
      for (let i = 0; i < raw.length; i += 4) {
        const al = raw[i + 3]!;
        if (al === 0) transparent++;
        if (al === 255) opaque++;
        if (al === 255 && raw[i] === 255 && raw[i + 1] === 0 && raw[i + 2] === 0) red++;
      }
      expect(transparent).toBeGreaterThan(0);
      expect(opaque).toBeGreaterThan(0);
      expect(red).toBeGreaterThan(0);
      expect((await renderPng(id, '#FF0000', 160, `${tag}_b`)).equals(a)).toBe(true);
    }, 30_000);
  }
});

describe('makeElement', () => {
  it('stores an image asset with transparency at the requested size', async () => {
    const a = await makeElement(store, 'element.symbol.check', { color: '#00FF00', longSide: 256 }, 'tester');
    const parsed = AssetSchema.parse({ id: 'a_test', ...a });
    expect(parsed.kind).toBe('image');
    expect(parsed.name).toBe('Check mark.png');
    expect(parsed.image).toMatchObject({ width: 256, height: 256, hasAlpha: true });
    expect(parsed.provenance).toMatchObject({ origin: 'generated', importedBy: 'tester', procedural: { id: 'element.symbol.check', version: 1 } });
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('el_'))).toEqual([]);
    const wide = await makeElement(store, 'element.bar.solid', {}, 'tester');
    expect(wide.image).toMatchObject({ width: 1024, height: 256 });
    expect((await makeElement(store, 'element.symbol.check', { color: '#00FF00', longSide: 256 }, 'tester')).contentHash).toBe(a.contentHash);
  }, 60_000);
  it('unknown id is 404 and bad options are 400', async () => {
    await expect(makeElement(store, 'element.arrow.nope', {}, 't')).rejects.toMatchObject({ status: 404 });
    await expect(makeElement(store, 'element.symbol.check', { color: 'red' }, 't')).rejects.toMatchObject({ status: 400 });
    await expect(makeElement(store, 'element.symbol.check', { color2: '#12' }, 't')).rejects.toMatchObject({ status: 400 });
    await expect(makeElement(store, 'element.symbol.check', { longSide: 10 }, 't')).rejects.toMatchObject({ status: 400 });
    await expect(makeElement(store, 'element.symbol.check', { longSide: 4096 }, 't')).rejects.toMatchObject({ status: 400 });
  });
  it('preview returns PNG bytes without storing', async () => {
    const b = await elementPreview(store.tmpDir, 'element.shape.heart', { longSide: 128 });
    expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect((await elementPreview(store.tmpDir, 'element.shape.heart', { longSide: 128 })).equals(b)).toBe(true);
    await expect(elementPreview(store.tmpDir, 'element.nope.nope', {})).rejects.toMatchObject({ status: 404 });
  }, 30_000);
});
