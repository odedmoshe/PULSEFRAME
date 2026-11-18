import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { AssetSchema } from '@pulseframe/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ELEMENT_CATEGORIES, ELEMENTS, elementSvg } from '../../../packages/core/src/elements.ts';
import { canRasteriseSvg, elementFfmpegArgs, elementPreview, makeElement, sizeSvg } from './elements.ts';
import { createSynth, sfxPreview, type SynthRunner } from './sfx.ts';
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

/**
 * The stored pixels of a PNG (8-bit RGBA, not interlaced), read here with zlib rather than by a decoder,
 * so the colour checks below look at what is in the file and not at what some reader makes of it.
 */
function pngPixels(png: Buffer): { w: number; h: number; px: Buffer } {
  let pos = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos), type = png.toString('ascii', pos + 4, pos + 8), body = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); expect([body[8], body[9], body[12]]).toEqual([8, 6, 0]); }
    if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!, line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4]! : 0, b = y ? px[(y - 1) * stride + x]! : 0, c = x >= 4 && y ? px[(y - 1) * stride + x - 4]! : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      px[y * stride + x] = (line[x]! + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { w, h, px };
}
/** Render with the production arguments in one colour (both colour slots) and report how far any visible pixel is from that colour. */
async function colourError(id: string, rgb: [number, number, number], longSide: number, tag: string) {
  const hex = `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  const svgFile = path.join(dir, `${tag}.svg`), png = path.join(dir, `${tag}.png`);
  fs.writeFileSync(svgFile, sizeSvg(elementSvg(id, { color: hex, color2: hex }), id, longSide));
  await exec('ffmpeg', elementFfmpegArgs(svgFile, png, longSide), { timeout: 30_000 });
  const { w, h, px } = pngPixels(fs.readFileSync(png));
  let partial = 0, opaque = 0, worstPartial = 0, worstOpaque = 0, worstBeyondRounding = 0;
  for (let i = 0; i < px.length; i += 4) {
    const al = px[i + 3]!;
    if (al === 0) continue;
    const d = Math.max(Math.abs(px[i]! - rgb[0]), Math.abs(px[i + 1]! - rgb[1]), Math.abs(px[i + 2]! - rgb[2]));
    if (al === 255) { opaque++; worstOpaque = Math.max(worstOpaque, d); }
    // At alpha below 16 the colour is known only coarsely (a step of 1 in the drawn value is 16 or more in the stored one), and it contributes next to nothing.
    // Whatever the colour, the drawn (premultiplied) value was a whole number, so the stored colour can be off by up to 127.5 / alpha from rounding alone.
    else if (al >= 16) { partial++; worstPartial = Math.max(worstPartial, d); worstBeyondRounding = Math.max(worstBeyondRounding, d - Math.ceil(127.5 / al)); }
  }
  return { w, h, px, partial, opaque, worstPartial, worstOpaque, worstBeyondRounding };
}

// Finding: the decoder's pixels are premultiplied and were written into a PNG as they came, so every partly transparent pixel was darkened.
describe('element pictures store straight alpha: a partly transparent pixel has the colour of the opaque interior', () => {
  it('white circle: the soft edge is white, not grey', async () => {
    const r = await colourError('element.shape.circle', [255, 255, 255], 256, 'sa_white');
    expect(r.opaque).toBeGreaterThan(1000);
    expect(r.partial).toBeGreaterThan(300);
    expect(r.worstOpaque).toBe(0);
    expect(r.worstPartial).toBeLessThanOrEqual(2);
  }, 30_000);
  it('red circle: edge pixels are red with partial alpha, not dark red', async () => {
    const r = await colourError('element.shape.circle', [255, 0, 0], 160, 'sa_red');
    expect(r.partial).toBeGreaterThan(200);
    expect(r.worstOpaque).toBe(0);
    expect(r.worstPartial).toBeLessThanOrEqual(2);
  }, 30_000);
  it('the half-transparent highlighter keeps the yellow that was picked', async () => {
    const r = await colourError('element.line.highlight-marker', [255, 230, 0], 1024, 'sa_marker');
    const mid = (Math.floor(r.h / 2) * r.w + Math.floor(r.w / 2)) * 4;
    expect(r.px[mid + 3]).toBeGreaterThanOrEqual(138); // opacity 0.55
    expect(r.px[mid + 3]).toBeLessThanOrEqual(142);
    expect(Math.abs(r.px[mid]! - 255)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.px[mid + 1]! - 230)).toBeLessThanOrEqual(2);
    expect(r.px[mid + 2]).toBeLessThanOrEqual(2);
    expect(r.partial).toBeGreaterThan(100_000); // the whole body is partly transparent
    // 230 is not a multiple of anything convenient: at low alpha its drawn value is rounded, which is all that is allowed on top of the 2 (darkening was 100 and more)
    expect(r.worstBeyondRounding).toBeLessThanOrEqual(2);
  }, 30_000);
  it('a shape whose short side would come out odd is drawn at its final size, not resampled (which shifted edge colours)', async () => {
    const svg = sizeSvg(elementSvg('element.shape.ellipse', {}), 'element.shape.ellipse', 200);
    expect(svg).toContain('width="200" height="134"'); // 133.33 -> 134: the size the scale step picked before, now drawn directly
    const r = await colourError('element.shape.ellipse', [255, 0, 0], 200, 'sa_odd');
    expect([r.w, r.h]).toEqual([200, 134]);
    expect(r.worstPartial).toBeLessThanOrEqual(2);
    const tall = ELEMENTS.find((e) => e.height > e.width)!;
    expect(sizeSvg(elementSvg(tall.id, {}), tall.id, 301)).toMatch(/width="\d*[02468]" height="301"/);
    expect(sizeSvg(elementSvg('element.shape.circle', {}), 'element.shape.circle', 333)).toContain('width="333" height="332"'); // never longer than the long side
  }, 30_000);
  it(`all ${ELEMENTS.length} elements, drawn in one colour: every visible pixel has that colour`, async () => {
    const queue = [...ELEMENTS]; const bad: string[] = [];
    const worker = async (n: number) => {
      for (let e = queue.shift(); e; e = queue.shift()) {
        try {
          const r = await colourError(e.id, [255, 0, 0], 96, `sa_all_${n}`);
          if (r.partial + r.opaque === 0) bad.push(`${e.id}: nothing drawn`);
          if (r.worstOpaque > 0 || r.worstPartial > 2) bad.push(`${e.id}: off by ${Math.max(r.worstOpaque, r.worstPartial)}`);
          if (Math.max(r.w, r.h) !== 96 || r.w % 2 || r.h % 2) bad.push(`${e.id}: ${r.w}x${r.h}`);
        } catch (x) { bad.push(`${e.id}: ${String((x as Error).message).slice(0, 120)}`); }
      }
    };
    await Promise.all([worker(0), worker(1), worker(2), worker(3)]);
    expect(bad).toEqual([]);
  }, 120_000);
});

describe('makeElement', () => {
  it('stores an image asset with transparency at the requested size', async () => {
    const a = await makeElement(store, 'element.symbol.check', { color: '#00FF00', longSide: 256 }, 'tester');
    const parsed = AssetSchema.parse({ id: 'a_test', ...a });
    expect(parsed.kind).toBe('image');
    expect(parsed.name).toBe('Check mark.png');
    expect(parsed.image).toMatchObject({ width: 256, height: 256, hasAlpha: true });
    expect(parsed.provenance).toMatchObject({ origin: 'generated', importedBy: 'tester', procedural: { id: 'element.symbol.check', version: 2 } }); // 2: straight alpha (ELEMENT_PICTURE_VERSION)
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

/** Element drawing shares the synthesis queue of the sound effects (stand-in runner, labelled: it writes a marker file instead of running ffmpeg). */
describe('element drawing is bounded together with the sounds', () => {
  function counting() {
    let starts = 0, active = 0, most = 0; const release: (() => void)[] = [];
    const runner: SynthRunner = async (args) => {
      const n = ++starts; active++; most = Math.max(most, active);
      await new Promise<void>((r) => release.push(r));
      fs.writeFileSync(args.at(-1)!, `stand-in output ${n}`);
      active--;
    };
    return { runner, get starts() { return starts; }, get most() { return most; }, finishAll: async () => { for (let i = 0; i < 200; i++) { release.shift()?.(); await new Promise((r) => setImmediate(r)); } } };
  }
  it('the same picture asked for 30 times at once is drawn once; another colour is another picture', async () => {
    await canRasteriseSvg();
    const c = counting(); const q = createSynth(c.runner);
    const same = Array.from({ length: 30 }, () => elementPreview(store.tmpDir, 'element.shape.star-5', { color: '#112233' }, q));
    const other = elementPreview(store.tmpDir, 'element.shape.star-5', { color: '#112234' }, q);
    await new Promise((r) => setImmediate(r));
    expect(c.starts).toBe(2);
    await c.finishAll();
    const out = await Promise.all(same);
    expect(out.every((b) => b === out[0])).toBe(true);
    expect((await other).equals(out[0]!)).toBe(false);
    expect(c.starts).toBe(2);
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('el_'))).toEqual([]);
  });
  it('sounds and elements together never run more than two processes, and the overflow is refused with 429', async () => {
    await canRasteriseSvg();
    const c = counting(); const q = createSynth(c.runner);
    const settle = (p: Promise<Buffer>) => p.then(() => 'ok', (e: { status?: number; code?: string }) => `${e.status} ${e.code}`);
    const all = [
      ...Array.from({ length: 20 }, (_, i) => settle(elementPreview(store.tmpDir, 'element.shape.circle', { color: `#0000${(16 + i).toString(16)}` }, q))),
      ...['sfx.click', 'sfx.pop', 'sfx.beep', 'sfx.ding', 'sfx.wind', 'sfx.rain'].map((id) => settle(sfxPreview(store.tmpDir, id, q))),
    ];
    await c.finishAll();
    const out = await Promise.all(all);
    expect(c.most).toBe(2);
    expect(c.starts).toBe(18);
    expect(out.filter((o) => o === 'ok')).toHaveLength(18);
    expect(out.filter((o) => o === '429 synthesis_busy')).toHaveLength(8);
  });
  it('a drawing that fails is a typed 500 that says why, and leaves no files', async () => {
    const { SynthFailure } = await import('./sfx.ts');
    const q = createSynth(() => Promise.reject(new SynthFailure('timeout')));
    await expect(elementPreview(store.tmpDir, 'element.shape.circle', {}, q)).rejects.toMatchObject({ status: 500, code: 'element_render_failed', details: { id: 'element.shape.circle', reason: 'timeout' } });
    expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('el_'))).toEqual([]);
  });
});

/** The set of distinct element pictures has no end (the colours are the caller's), so a new one needs room under the storage ceiling. */
describe('element pictures respect the storage ceiling', () => {
  it('a new picture is refused with 507 once the ceiling is reached; one that is already stored is not', async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-elements-quota-'));
    const s2 = new Store(path.join(d2, 'data'));
    try {
      const have = await makeElement(s2, 'element.shape.heart', { color: '#AA0000', longSide: 128 }, 't'); // no ceiling set: stored
      const blobs = () => fs.readdirSync(path.join(s2.dataDir, 'blobs')).length;
      expect(blobs()).toBe(1);
      s2.maxStorageBytes = 1000; // far below what the data directory already holds
      await expect(makeElement(s2, 'element.shape.heart', { color: '#AA0001', longSide: 128 }, 't')).rejects.toMatchObject({ status: 507, code: 'storage_quota_exceeded', details: { quotaBytes: 1000 } });
      expect(blobs()).toBe(1);
      expect(fs.readdirSync(s2.tmpDir).filter((f) => f.startsWith('el_'))).toEqual([]);
      expect((await makeElement(s2, 'element.shape.heart', { color: '#AA0000', longSide: 128 }, 't')).contentHash).toBe(have.contentHash);
      s2.maxStorageBytes = 0;
      expect((await makeElement(s2, 'element.shape.heart', { color: '#AA0001', longSide: 128 }, 't')).contentHash).not.toBe(have.contentHash);
      expect(blobs()).toBe(2);
    } finally {
      s2.close(); fs.rmSync(d2, { recursive: true, force: true });
    }
  }, 60_000);
});


/**
 * Element PNGs changed recipe (straight alpha, even short side), so the element version was raised to 2: new pictures carry the new
 * version and, having other bytes, a new content hash, so nothing keyed by the hash (the blob, its thumbnails and proxies, a
 * de-duplicating import) can hand back the old pixels. A project made before the change keeps its stored picture and still opens.
 */
describe('element version: a new recipe is a new identity, and old projects keep their pictures', () => {
  /** The ffmpeg arguments of version 1, as they were before the straight-alpha change (only the filter differed). */
  const version1Args = (svgFile: string, pngFile: string, longSide: number) => {
    const args = elementFfmpegArgs(svgFile, pngFile, longSide);
    const vf = args.indexOf('-vf') + 1;
    args[vf] = `scale='if(gte(iw,ih),${longSide},-2)':'if(gte(iw,ih),-2,${longSide})',format=rgba`;
    return args;
  };

  it('every element is at version 2, except the pack drawings changed on 2026-11-18 at version 3, and the asset made now records it', async () => {
    expect(ELEMENTS.filter((e) => e.version !== 2).map((e) => [e.id, e.version])).toEqual([
      ...['hanukkiah-1', 'hanukkiah-2', 'hanukkiah-3', 'hanukkiah-4', 'hanukkiah-5', 'hanukkiah-6', 'hanukkiah-7', 'hanukkiah-8', 'candle', 'candle-lit', 'candle-row', 'dreidel-spinning', 'latke', 'oil-jug', 'lights-garland', 'frame-candles'].map((s) => [`element.holiday.${s}`, 3]),
      ...['balloon', 'balloon-shine', 'balloons-bunch', 'balloon-heart', 'lollipop'].map((s) => [`element.party.${s}`, 3]),
    ]);
    const { ELEMENT_PICTURE_VERSION } = await import('@pulseframe/core');
    expect(ELEMENT_PICTURE_VERSION).toBe(2);
  });

  it('a project holding a version-1 element picture opens, replays, plans an export from its stored bytes and survives an archive round trip; adding the element again makes a separate version-2 asset', async () => {
    const { validateProject } = await import('@pulseframe/core');
    const { Exporter } = await import('./export.ts');
    const { importArchive, planArchive, writeArchive } = await import('./archive.ts');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-elements-v1-'));
    const dataDir = path.join(d, 'data');
    let s = new Store(dataDir);
    try {
      // what a server before the change stored: premultiplied bytes, provenance version 1
      const id = 'element.shape.circle', colour = '#FFFFFF', longSide = 256;
      const svgFile = path.join(d, 'old.svg'), oldPng = path.join(d, 'old.png');
      fs.writeFileSync(svgFile, sizeSvg(elementSvg(id, { color: colour, color2: '#3DE0C8' }), id, longSide));
      await exec('ffmpeg', version1Args(svgFile, oldPng, longSide), { timeout: 30_000 });
      const oldBytes = fs.readFileSync(oldPng);
      const { createHash } = await import('node:crypto');
      const oldHash = `sha256:${createHash('sha256').update(oldBytes).digest('hex')}`;
      const staged = path.join(s.tmpDir, 'old-element.png');
      fs.writeFileSync(staged, oldBytes);
      s.putBlob(oldHash, staged, oldBytes.length, 'image/png');
      const oldAsset = { kind: 'image' as const, container: 'png', mimeType: 'image/png', duration: { value: '0', timescale: 1 }, image: { width: longSide, height: longSide, codec: 'png', hasAlpha: true }, name: 'Circle.png', contentHash: oldHash, byteSize: oldBytes.length, provenance: { origin: 'generated' as const, importedAt: '2026-11-01T00:00:00.000Z', importedBy: 'user:local', procedural: { id, version: 1, generator: 'svg by formula, rasterised by ffmpeg librsvg; no third-party content' } } };
      const pid = s.createProject({ name: 'made before the change', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
      const imp = s.commit({ projectId: pid, actor: 'user:local', label: 'Add element Circle.png', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: oldAsset } }] });
      const oldId = imp.results[0]!.output!.assetId as string;
      s.commit({ projectId: pid, actor: 'user:local', label: 'Place element', ops: [{ op: 'add_clip', args: { assetId: oldId, start: { value: '0', timescale: 30 }, duration: { value: '90', timescale: 30 } } }] });

      // reopened by the new build: same document, same bytes, nothing to repair
      s.close();
      s = new Store(dataDir);
      const p = s.getProject(pid);
      expect(p.doc.assets[oldId]).toMatchObject({ contentHash: oldHash, byteSize: oldBytes.length, provenance: { procedural: { id, version: 1 } } });
      expect(validateProject(p.doc)).toEqual([]);
      expect(s.replay(pid).doc).toEqual(p.doc);
      expect(fs.readFileSync(s.blobPath(oldHash)).equals(oldBytes)).toBe(true);
      // the export plan renders from the stored version-1 bytes: no blocker, the asset is in the manifest with its own hash
      const exporter = new Exporter(s, null as never, () => '', path.join(d, 'no-web-dist'));
      const plan = exporter.plan(p.doc, p.revision, { format: 'png', frame: 10 });
      expect(plan.blockers).toEqual([]);
      expect(plan.manifest.assets).toEqual([{ id: oldId, contentHash: oldHash, byteSize: oldBytes.length, kind: 'image', clips: 1 }]);
      // and it travels in an archive and comes back as it was
      const tar = path.join(d, 'old.tar');
      const chunks: Buffer[] = [];
      for await (const c of writeArchive(planArchive(s, pid))) chunks.push(c);
      fs.writeFileSync(tar, Buffer.concat(chunks));
      const back = importArchive(s, tar);
      expect(Object.values(back.doc.assets)).toEqual([expect.objectContaining({ contentHash: oldHash, provenance: expect.objectContaining({ procedural: { id, version: 1, generator: expect.any(String) } }) })]);

      // the same element in the same colour and size, made now: version 2, other bytes, so another asset (not the old one re-used)
      const fresh = await makeElement(s, id, { color: colour, longSide }, 'user:local');
      expect(fresh.provenance).toMatchObject({ procedural: { id, version: 2 } });
      expect(fresh.contentHash).not.toBe(oldHash);
      const again = s.commit({ projectId: pid, actor: 'user:local', label: 'Add element Circle.png', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: fresh } }] });
      expect(again.results[0]!.output).toMatchObject({ deduplicated: false });
      const after = s.getProject(pid).doc;
      expect(Object.keys(after.assets)).toHaveLength(2);
      expect(after.assets[oldId]).toEqual(p.doc.assets[oldId]); // the old picture is untouched
      expect(fs.readFileSync(s.blobPath(oldHash)).equals(oldBytes)).toBe(true);
    } finally {
      s.close();
      fs.rmSync(d, { recursive: true, force: true });
    }
  }, 60_000);

  it('pictures held in memory are keyed by the version: after a version change the same request is drawn again (stand-in runner, labelled)', async () => {
    await canRasteriseSvg();
    let starts = 0;
    const q = createSynth(async (args) => { starts++; fs.writeFileSync(args.at(-1)!, `stand-in output ${starts}`); });
    const def = ELEMENTS.find((e) => e.id === 'element.shape.square')! as { version: number };
    const was = def.version;
    try {
      const a = await elementPreview(store.tmpDir, 'element.shape.square', { color: '#102030' }, q);
      expect(await elementPreview(store.tmpDir, 'element.shape.square', { color: '#102030' }, q)).toBe(a); // remembered
      expect(starts).toBe(1);
      def.version = was + 1; // as a later recipe change would
      const b = await elementPreview(store.tmpDir, 'element.shape.square', { color: '#102030' }, q);
      expect(starts).toBe(2);
      expect(b.equals(a)).toBe(false);
    } finally {
      def.version = was;
    }
  });
});
