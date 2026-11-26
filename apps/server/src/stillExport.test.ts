/**
 * «שמירת התמונה» — the still export (wave 8 cover W2; verify C5, C7, C8, C10, C11). Replaces the W2 todo rows of
 * stillsContracts.test.ts (the 3000x2000 PNG of exactly the crop's pixels with output.still; JPEG mjpeg 4:4:4; no tags, and a
 * still with tags fails still_tags and saves nothing; the refusals over 8192 / outside the file / no picture / off the paper shape;
 * an agent retrying the owner's still is refused 403).
 *
 * Real ffmpeg and ffprobe throughout. The render page is NOT run here (no Chromium in a unit test): `standInHost` is a LABELLED
 * STAND-IN for RenderHost that answers the page's still with the stored PNG's own bytes when the session asks for exactly the
 * stored picture's size (what a 1:1 draw of the still's document must give) and records what it was asked. The real page's 1:1
 * draw is proven by pnpm proof:stills P1/P2/P4 (stills-proof.still.ts).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { stillDocument, STILLS_REFUSALS, type Asset } from '@pulseframe/core';

/** TEST fault (labelled): when set, the written picture gets this PNG chunk inserted before the check runs. */
const fault: { chunk: { type: string; data: Buffer } | null } = { chunk: null };
vi.mock('./stillFile.ts', async (importOriginal) => {
  const m = await importOriginal<typeof import('./stillFile.ts')>();
  return {
    ...m,
    writeStillFile: async (o: Parameters<typeof m.writeStillFile>[0]) => {
      if (!fault.chunk) return m.writeStillFile(o);
      await m.runStillFfmpeg(m.stillFileArgs({ input: o.renderedPng, crop: o.crop, format: o.format, outFile: o.outFile }));
      fs.writeFileSync(o.outFile, insertPngChunk(fs.readFileSync(o.outFile), fault.chunk.type, fault.chunk.data));
      return m.checkStillFile(o.outFile, o.format, o.crop);
    },
  };
});

import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter, stillFileName, stillOutputOf } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { checkStillFile, jpegSegments, pngChunks, runStillFfmpeg, stillChunkProblems, stillFileArgs, writeStillFile } from './stillFile.ts';

// ---------- synthetic pictures with known pixels ----------
/** The known picture: every pixel's colour is a function of its coordinates (a one-pixel checkerboard on top of the low bits of x and y). */
const pix = (x: number, y: number): [number, number, number] => {
  const c = (x + y) & 1 ? 255 : 0;
  return [(x & 255) ^ c, (y & 255) ^ c, (((x >> 8) & 15) | (((y >> 8) & 15) << 4)) ^ (c & 0x55)];
};
function knownRgb(w: number, h: number, ox = 0, oy = 0): Buffer {
  const b = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const p = pix(x + ox, y + oy), o = (y * w + x) * 3; b[o] = p[0]; b[o + 1] = p[1]; b[o + 2] = p[2]; }
  return b;
}
function writePng(file: string, w: number, h: number): string {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-c:v', 'png', file], { input: knownRgb(w, h), maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return file;
}
function decodeRgb(file: string): Buffer {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  return r.stdout as Buffer;
}
/** Bytes that differ and the largest difference (reported, never loosened). */
function diff(a: Buffer, b: Buffer) { let n = 0, max = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { n++; max = Math.max(max, d); } } return { lengthA: a.length, lengthB: b.length, differing: n, max }; }
function psnr(a: Buffer, b: Buffer): number { let se = 0; for (let i = 0; i < a.length; i++) se += (a[i]! - b[i]!) ** 2; return 10 * Math.log10((255 * 255) / (se / a.length)); }
const crc32 = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
/** A PNG with one more chunk right after IHDR (test fault). */
function insertPngChunk(png: Buffer, type: string, data: Buffer): Buffer {
  const at = 8 + 12 + png.readUInt32BE(8);
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([png.subarray(0, at), head, data, crc, png.subarray(at)]);
}
/** A JPEG with one more segment right after SOI (test fault). */
function insertJpegSegment(jpg: Buffer, marker: number, data: Buffer): Buffer {
  const head = Buffer.from([0xff, marker, 0, 0]); head.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([jpg.subarray(0, 2), head, data, jpg.subarray(2)]);
}

let dir: string, work: string;
const P = (n: string) => path.join(work, n);

describe('stillFile: the crop of the rendered PNG, PNG and JPEG without metadata', () => {
  beforeAll(() => { work = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stillfile-')); });
  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  it('3000x2000, a 10x15 landscape crop 1620x1080 at (37, 21): the PNG is exactly those source pixels (no resample, no shift)', async () => {
    const src = writePng(P('known-3000.png'), 3000, 2000);
    const crop = { x: 37, y: 21, w: 1620, h: 1080 };
    const v = await writeStillFile({ renderedPng: src, crop, format: 'png', outFile: P('crop.png') });
    expect([v.codec, v.width, v.height, v.tags, v.chunks]).toEqual(['png', 1620, 1080, [], []]);
    const got = decodeRgb(P('crop.png')), want = knownRgb(1620, 1080, 37, 21);
    expect(diff(got, want)).toEqual({ lengthA: want.length, lengthB: want.length, differing: 0, max: 0 });
  }, 60_000);
  it('an odd-sized picture (3001x2001) saved whole is 3001x2001 and equal pixel for pixel; odd offsets crop exactly too', async () => {
    const src = writePng(P('known-3001.png'), 3001, 2001);
    await writeStillFile({ renderedPng: src, crop: { x: 0, y: 0, w: 3001, h: 2001 }, format: 'png', outFile: P('whole.png') });
    expect(diff(decodeRgb(P('whole.png')), knownRgb(3001, 2001)).differing).toBe(0);
    const v = await writeStillFile({ renderedPng: src, crop: { x: 1, y: 3, w: 999, h: 17 }, format: 'png', outFile: P('odd.png') });
    expect([v.width, v.height]).toEqual([999, 17]);
    expect(diff(decodeRgb(P('odd.png')), knownRgb(999, 17, 1, 3)).differing).toBe(0);
  }, 60_000);
  it('the written PNG\'s own chunks: IHDR, pHYs, IDAT…, IEND only (no tEXt, zTXt, iTXt, tIME, eXIf, iCCP)', () => {
    const chunks = pngChunks(fs.readFileSync(P('crop.png')));
    expect(chunks[0]).toBe('IHDR');
    expect(chunks.at(-1)).toBe('IEND');
    expect([...new Set(chunks)].sort()).toEqual(['IDAT', 'IEND', 'IHDR', 'pHYs']);
  });
  it('JPEG: mjpeg 4:4:4 (yuvj444p) of the crop\'s size; its segments are SOI, APP0 JFIF, DQT, SOF0, DHT, SOS, EOI — no APP1 (EXIF), no COM', async () => {
    const v = await writeStillFile({ renderedPng: P('known-3000.png'), crop: { x: 37, y: 21, w: 1620, h: 1080 }, format: 'jpeg', outFile: P('crop.jpg') });
    expect([v.codec, v.pixFmt, v.width, v.height, v.tags, v.chunks]).toEqual(['mjpeg', 'yuvj444p', 1620, 1080, [], []]);
    const seg = jpegSegments(fs.readFileSync(P('crop.jpg')));
    expect([...new Set(seg.map((s) => s.marker.toString(16)))].sort()).toEqual(['c0', 'c4', 'd8', 'd9', 'da', 'db', 'e0']);
    expect(seg.find((s) => s.marker === 0xe0)!.id).toBe('JFIF');
    // a measurement, not a gate on the encoder: the PSNR of q 2 on this one-pixel checkerboard (printed so the number is seen)
    const db = psnr(decodeRgb(P('crop.jpg')), knownRgb(1620, 1080, 37, 21));
    console.log(`stillExport.test: JPEG q2 4:4:4 PSNR on the one-pixel checkerboard crop = ${db.toFixed(2)} dB (one sample)`);
    expect(db).toBeGreaterThan(20);
  }, 60_000);
  it('the arguments: crop=w:h:x:y:exact=1; PNG -c:v png -map_metadata -1; JPEG format=yuvj444p -c:v mjpeg -q:v 2 -flags +bitexact', () => {
    const png = stillFileArgs({ input: 'in.png', crop: { x: 3, y: 1, w: 16, h: 20 }, format: 'png', outFile: 'o.png' }).join(' ');
    expect(png).toContain('-vf crop=16:20:3:1:exact=1,setsar=1 -c:v png -map_metadata -1');
    const jpg = stillFileArgs({ input: 'in.png', crop: { x: 3, y: 1, w: 16, h: 20 }, format: 'jpeg', outFile: 'o.jpg' }).join(' ');
    expect(jpg).toContain('-vf crop=16:20:3:1:exact=1,setsar=1,format=yuvj444p -c:v mjpeg -q:v 2 -flags +bitexact -map_metadata -1 -frames:v 1');
    expect(() => stillFileArgs({ input: 'i', crop: { x: 0.5, y: 0, w: 16, h: 16 }, format: 'png', outFile: 'o' })).toThrow(RangeError);
  });
  it('the check can fail: a PNG with tEXt, tIME, eXIf or iCCP, a JPEG with an EXIF APP1 or a comment is still_tags', async () => {
    const png = fs.readFileSync(P('crop.png'));
    for (const [type, data] of [['tEXt', Buffer.from('Comment\0hello', 'latin1')], ['tIME', Buffer.from([7, 234, 11, 26, 8, 0, 0])], ['eXIf', Buffer.from('MM\0*\0\0\0\x08', 'latin1')], ['iCCP', Buffer.from('p\0\0x', 'latin1')]] as const) {
      const bad = insertPngChunk(png, type, data);
      expect(stillChunkProblems(bad, 'png')).toEqual([`png:${type}`]);
      fs.writeFileSync(P(`bad-${type}.png`), bad);
      const e = await checkStillFile(P(`bad-${type}.png`), 'png', { w: 1620, h: 1080 }).then(() => null, (x) => x);
      expect([e?.code, e?.hint]).toEqual(['still_tags', STILLS_REFUSALS.stillTags.hint]);
      expect(e.message).toContain(type);
    }
    const jpg = fs.readFileSync(P('crop.jpg'));
    const exif = insertJpegSegment(jpg, 0xe1, Buffer.from('Exif\0\0MM\0*', 'latin1'));
    expect(stillChunkProblems(exif, 'jpeg')).toEqual(['jpeg:ffe1(Exif)']);
    const com = insertJpegSegment(jpg, 0xfe, Buffer.from('Lavc60.31.102', 'latin1'));
    expect(stillChunkProblems(com, 'jpeg')).toEqual(['jpeg:fffe']);
    fs.writeFileSync(P('bad-com.jpg'), com);
    expect((await checkStillFile(P('bad-com.jpg'), 'jpeg', { w: 1620, h: 1080 }).catch((x) => x)).code).toBe('still_tags');
    // without +bitexact this ffmpeg writes its comment: the reason the flag is there (and the check sees it)
    await runStillFfmpeg(['-hide_banner', '-v', 'error', '-y', '-i', P('known-3000.png'), '-vf', 'crop=64:64:0:0,setsar=1,format=yuvj444p', '-c:v', 'mjpeg', '-q:v', '2', '-map_metadata', '-1', '-frames:v', '1', '-f', 'image2', '-update', '1', P('plain.jpg')]);
    const plain = stillChunkProblems(fs.readFileSync(P('plain.jpg')), 'jpeg');
    console.log(`stillExport.test: mjpeg without +bitexact carries ${JSON.stringify(plain)}`);
    expect(plain).toContain('jpeg:fffe');
  }, 60_000);
  it('a wrong size or codec fails the ordinary validation', async () => {
    await expect(checkStillFile(P('crop.png'), 'png', { w: 1621, h: 1080 })).rejects.toThrow(/export failed validation/);
    await expect(checkStillFile(P('crop.png'), 'jpeg', { w: 1620, h: 1080 })).rejects.toThrow(/not a JPEG|export failed validation/);
  });
});

// ---------- the export through the server (owner session), with the labelled stand-in for the render page ----------
const R = { num: 30, den: 1 };
let cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, exporter: Exporter, ownerCookie: string;
const base = () => `http://127.0.0.1:${cfg.port}`;
const bearer = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const owner = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, headers: Record<string, string>) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...bearer(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, text: msg.result.content[0].text as string };
};

/** LABELLED STAND-IN for RenderHost.renderStill (see the header). `mode` lets a test make the page fail or answer garbage. */
const host = {
  mode: 'one-to-one' as 'one-to-one' | 'throw' | 'garbage',
  calls: [] as { width: number; height: number; firstFrame: number; frames: number; doc: unknown }[],
  async renderStill(url: string): Promise<Buffer> {
    const token = new URL(url).hash.replace('#token=', '');
    const s = exporter.sessions.get(token);
    if (!s) throw new Error('stand-in: no such render session');
    this.calls.push({ width: s.outWidth, height: s.outHeight, firstFrame: s.firstFrame, frames: s.totalFrames, doc: JSON.parse(JSON.stringify(s.doc)) });
    if (this.mode === 'throw') throw new Error('stand-in: the page went away');
    if (this.mode === 'garbage') return Buffer.from('not a picture');
    const a = Object.values(s.doc.assets)[0]!;
    const own = a.image ?? a.video!;
    if (own.width !== s.outWidth || own.height !== s.outHeight) throw new Error(`stand-in: asked for ${s.outWidth}x${s.outHeight}, the stored picture is ${own.width}x${own.height} (not 1:1)`);
    return fs.readFileSync(store.blobPath(a.contentHash));
  },
  async renderAll(): Promise<never> { throw new Error('stand-in: renderAll is not used by a still'); },
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
function importPicture(pid: string, file: string, w: number, h: number, extra: Partial<Asset> = {}): string {
  const bytes = fs.readFileSync(file);
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  const tmp = path.join(dir, `blob-${Date.now()}-${Math.random()}`);
  fs.copyFileSync(file, tmp);
  store.putBlob(contentHash, tmp, bytes.length, 'image/png');
  const asset = { kind: 'image' as const, name: 'IMG_0001.png', contentHash, byteSize: bytes.length, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: prov, ...extra };
  return store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
}
let metaN = 0;
/** An asset row whose stored file does not exist (each with its own content hash, so the library does not merge them). */
function importMeta(pid: string, asset: Record<string, unknown>): string {
  const contentHash = `sha256:${createHash('sha256').update(`meta-${++metaN}`).digest('hex')}`;
  return store.commit({ projectId: pid, actor: 'test', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { contentHash, byteSize: 1, provenance: prov, duration: T.rt(10, 1), ...asset } } }] }).results[0]!.output!.assetId as string;
}
const project = (name: string) => store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
async function finished(jobId: string) {
  for (let i = 0; i < 600; i++) { const j = store.getJob(jobId); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`job ${jobId} did not finish`);
}
const tmpLeft = () => (fs.existsSync(store.tmpDir) ? fs.readdirSync(store.tmpDir) : []);
let photo3000: string, photo3001: string;

describe('the still export through the server (owner\'s own session)', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-still-export-'));
    const web = path.join(dir, 'web');
    fs.mkdirSync(web);
    fs.writeFileSync(path.join(web, 'render.html'), '<!doctype html><title>stand-in</title>'); // open() only checks that the page exists
    cfg = { ...loadConfig({}), dataDir: path.join(dir, 'data'), port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
    store = new Store(cfg.dataDir);
    auth = new Auth(cfg);
    exporter = new Exporter(store, host as never, () => `${base()}/render.html`, web);
    capabilities = new Capabilities(store, cfg);
    derivatives = new Derivatives(store);
    const gov = new Governance(store);
    auth.resolveGrant = (t) => gov.principalForToken(t);
    const speech = new Speech(store, cfg);
    mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
    app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
    ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
    photo3000 = writePng(path.join(dir, 'photo-3000.png'), 3000, 2000);
    photo3001 = writePng(path.join(dir, 'photo-3001.png'), 3001, 2001);
  }, 60_000);
  afterAll(async () => {
    (app as any).browserExport?.stop();
    await mcp.close();
    await capabilities.stop();
    await derivatives.stop();
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => { host.mode = 'one-to-one'; host.calls = []; fault.chunk = null; });

  it('3000x2000 photo, 10x15 landscape crop at (37, 21): a PNG of exactly the crop\'s pixels, output.still with the print line, the snapshot is stillDocument', async () => {
    const pid = project('still-3000');
    const assetId = importPicture(pid, photo3000, 3000, 2000);
    const crop = { x: 37, y: 21, w: 1620, h: 1080 };
    const r = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId, sourceFrame: 0, crop, paper: '10x15', orientation: 'landscape' } }, owner());
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const j = await finished(r.body.jobId);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    // rendered once, at the stored picture's own size, from the still's own document
    expect(host.calls.map((c) => [c.width, c.height, c.firstFrame, c.frames])).toEqual([[3000, 2000, 0, 1]]);
    expect(host.calls[0]!.doc).toEqual(JSON.parse(JSON.stringify(stillDocument(store.getProject(pid).doc.assets[assetId]!, 0))));
    expect(j.input.snapshot).toEqual(host.calls[0]!.doc);
    expect(j.input.manifest.output).toMatchObject({ width: 1620, height: 1080, firstFrame: 0, frames: 1 });
    expect(j.output.mimeType).toBe('image/png');
    expect(j.output.still).toEqual({
      format: 'png', width: 1620, height: 1080, crop, source: { width: 3000, height: 2000, rate: null, conformed: null },
      print: { paper: '10x15', orientation: 'landscape', ppi: 270, tier: 'usual' }, untriedSize: false, fileName: 'IMG_0001.png',
    });
    const file = path.join(store.outDir, j.output.file);
    expect(diff(decodeRgb(file), knownRgb(1620, 1080, 37, 21)).differing).toBe(0);
    expect([...new Set(pngChunks(fs.readFileSync(file)))].sort()).toEqual(['IDAT', 'IEND', 'IHDR', 'pHYs']);
    expect(j.output.validation).toMatchObject({ codec: 'png', width: 1620, height: 1080, tags: [], chunks: [] });
    expect(tmpLeft()).toEqual([]);
    const dl = await app.fetch(new Request(`${base()}/api/v1/jobs/${j.id}/output`, { headers: owner() }));
    expect([dl.status, dl.headers.get('content-type')]).toEqual([200, 'image/png']);
  }, 60_000);
  it('JPEG of the same crop: image/jpeg, .jpg, mjpeg 4:4:4, no APP1 and no COM', async () => {
    const pid = project('still-jpeg');
    const assetId = importPicture(pid, photo3000, 3000, 2000);
    const r = await rest('POST', `/projects/${pid}/exports`, { format: 'jpeg', still: { assetId, sourceFrame: 0, crop: { x: 37, y: 21, w: 1620, h: 1080 } } }, owner());
    const j = await finished(r.body.jobId);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect([j.output.mimeType, path.extname(j.output.file), j.output.still.format, j.output.still.print, j.output.still.fileName]).toEqual(['image/jpeg', '.jpg', 'jpeg', null, 'IMG_0001.jpg']);
    expect(j.output.validation).toMatchObject({ codec: 'mjpeg', pixFmt: 'yuvj444p', width: 1620, height: 1080, tags: [], chunks: [] });
    expect(jpegSegments(fs.readFileSync(path.join(store.outDir, j.output.file))).map((s) => s.marker).filter((m) => (m >= 0xe1 && m <= 0xef) || m === 0xfe)).toEqual([]);
  }, 60_000);
  it('an odd-sized picture saved whole: 3001x2001 (no even rounding), equal pixel for pixel', async () => {
    const pid = project('still-odd');
    const assetId = importPicture(pid, photo3001, 3001, 2001);
    const plan = await rest('POST', `/projects/${pid}/exports/plan`, { format: 'png', still: { assetId, sourceFrame: 0 } }, owner());
    expect([plan.status, plan.body.manifest?.output?.width, plan.body.manifest?.output?.height, plan.body.blockers]).toEqual([200, 3001, 2001, []]);
    const r = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId, sourceFrame: 0 } }, owner());
    const j = await finished(r.body.jobId);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(host.calls.map((c) => [c.width, c.height])).toEqual([[3001, 2001]]);
    expect([j.output.still.width, j.output.still.height]).toEqual([3001, 2001]);
    expect(diff(decodeRgb(path.join(store.outDir, j.output.file)), knownRgb(3001, 2001)).differing).toBe(0);
  }, 60_000);
  it('refused before anything is rendered: over 8192, outside the file, no picture, crop outside, crop off the paper, an unknown file', async () => {
    const pid = project('still-refusals');
    const big = importMeta(pid, { kind: 'image', name: 'big.png', container: 'png', mimeType: 'image/png', image: { width: 8193, height: 4000, codec: 'png', hasAlpha: false } });
    const vid = importMeta(pid, { kind: 'video', name: 'v.mp4', container: 'mp4', mimeType: 'video/mp4', video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 } });
    const snd = importMeta(pid, { kind: 'audio', name: 's.wav', container: 'wav', mimeType: 'audio/wav', audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' } });
    const okPhoto = importPicture(pid, photo3000, 3000, 2000);
    const codes = async (still: Record<string, unknown>) => {
      const r = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still }, owner());
      return [r.status, ...(r.body.error.details?.blockers ?? []).map((b: any) => b.code)];
    };
    const tooBig = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId: big, sourceFrame: 0 } }, owner());
    expect(tooBig.body.error.details.blockers[0]).toMatchObject({ code: 'still_too_large', message: STILLS_REFUSALS.stillTooLarge.message(8193, 4000), hint: STILLS_REFUSALS.stillTooLarge.hint });
    expect(tooBig.body.error.details.blockers.map((b: any) => b.code)).toEqual(['still_too_large', 'missing_media']);
    expect(await codes({ assetId: vid, sourceFrame: 300 })).toEqual([422, 'out_of_bounds', 'missing_media']);
    expect(await codes({ assetId: snd, sourceFrame: 0 })).toEqual([422, 'still_no_picture', 'missing_media']);
    expect(await codes({ assetId: okPhoto, sourceFrame: 0, crop: { x: 2000, y: 0, w: 1620, h: 1080 } })).toEqual([422, 'still_options']);
    const off = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId: okPhoto, sourceFrame: 0, crop: { x: 0, y: 0, w: 1700, h: 1080 }, paper: '10x15', orientation: 'landscape' } }, owner());
    expect(off.body.error.details.blockers.map((b: any) => b.message)).toEqual([STILLS_REFUSALS.stillPaperShape.message('10x15', 'landscape')]);
    // the whole frame of a 3:2 photo is 10x15 landscape-shaped; with a paper but no crop the whole frame is checked
    expect((await rest('POST', `/projects/${pid}/exports/plan`, { format: 'png', still: { assetId: okPhoto, sourceFrame: 0, paper: 'a4', orientation: 'landscape' } }, owner())).body.blockers.map((b: any) => b.code)).toEqual(['still_options']);
    expect((await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId: 'ast_none', sourceFrame: 0 } }, owner())).body.error.code).toBe('not_found');
    expect(host.calls).toEqual([]);
    expect(store.openJobs('export').filter((j) => j.projectId === pid)).toEqual([]);
  });
  it('the page failing, or answering something that is not a picture: the job fails, nothing is published, no temporary file is left', async () => {
    const pid = project('still-fail');
    const assetId = importPicture(pid, photo3001, 3001, 2001);
    const before = fs.readdirSync(store.outDir).length;
    for (const mode of ['throw', 'garbage'] as const) {
      host.mode = mode;
      const r = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId, sourceFrame: 0 } }, owner());
      const j = await finished(r.body.jobId);
      expect([mode, j.status]).toEqual([mode, 'failed']);
      expect(j.error.code).toBe(mode === 'throw' ? 'renderer_unavailable' : 'export_failed');
      expect(tmpLeft()).toEqual([]);
      expect(fs.readdirSync(store.outDir).length).toBe(before);
    }
  }, 60_000);
  it('TEST fault: a written picture that carries a tEXt chunk fails still_tags and saves nothing', async () => {
    const pid = project('still-tags');
    const assetId = importPicture(pid, photo3001, 3001, 2001);
    const before = fs.readdirSync(store.outDir).length;
    fault.chunk = { type: 'tEXt', data: Buffer.from('Creation Time\x002026:11:26', 'latin1') };
    const r = await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId, sourceFrame: 0, crop: { x: 0, y: 0, w: 64, h: 64 } } }, owner());
    const j = await finished(r.body.jobId);
    expect([j.status, j.error.code, j.error.hint]).toEqual(['failed', 'still_tags', STILLS_REFUSALS.stillTags.hint]);
    expect(j.error.message).toContain('tEXt');
    expect(tmpLeft()).toEqual([]);
    expect(fs.readdirSync(store.outDir).length).toBe(before);
  }, 60_000);
  it('retry and batch: an agent retrying the owner\'s still (REST retry, MCP retry_job) or batching one is 403 owner_required; the owner\'s retry renders the same document', async () => {
    const pid = project('still-retry');
    const assetId = importPicture(pid, photo3001, 3001, 2001);
    host.mode = 'throw';
    const first = await finished((await rest('POST', `/projects/${pid}/exports`, { format: 'png', still: { assetId, sourceFrame: 0, crop: { x: 5, y: 7, w: 300, h: 200 } } }, owner())).body.jobId);
    expect(first.status).toBe('failed');
    host.mode = 'one-to-one';
    host.calls = [];
    for (const t of [auth.tokens.agent, auth.tokens.observer]) {
      const r = await rest('POST', `/jobs/${first.id}/retry`, undefined, bearer(t));
      expect(r.status).toBe(403);
    }
    const ra = await rest('POST', `/jobs/${first.id}/retry`, undefined, bearer(auth.tokens.agent));
    expect([ra.body.error.code, ra.body.error.message]).toEqual(['owner_required', STILLS_REFUSALS.ownerRequired.message()]);
    const m = await tool('retry_job', { jobId: first.id }, auth.tokens.agent);
    expect([m.isError, JSON.parse(m.text).error.code]).toEqual([true, 'owner_required']);
    const b = await rest('POST', `/projects/${pid}/exports/batch`, { items: [{}], options: { format: 'png', still: { assetId, sourceFrame: 0 } } }, bearer(auth.tokens.agent));
    expect([b.status, b.body.error.code]).toEqual([403, 'owner_required']);
    const mb = await tool('export_batch', { projectId: pid, items: [{}], options: { format: 'png', still: { assetId, sourceFrame: 0 } } }, auth.tokens.agent);
    expect([mb.isError, JSON.parse(mb.text).error.code]).toEqual([true, 'owner_required']);
    const mp = await tool('export_project', { projectId: pid, format: 'jpeg', still: { assetId, sourceFrame: 0 } }, auth.tokens.agent);
    expect([mp.isError, JSON.parse(mp.text).error.code]).toEqual([true, 'owner_required']);
    expect(host.calls).toEqual([]);
    const again = await rest('POST', `/jobs/${first.id}/retry`, undefined, owner());
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    const j = await finished(again.body.jobId);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.input.snapshot).toEqual(first.input.snapshot);
    expect(diff(decodeRgb(path.join(store.outDir, j.output.file)), knownRgb(300, 200, 5, 7)).differing).toBe(0);
    // the owner's batch of one item is one still job; an item naming a sequence is refused with still_options
    const ob = await rest('POST', `/projects/${pid}/exports/batch`, { items: [{ sequenceId: 'seq_main' }], options: { format: 'png', still: { assetId, sourceFrame: 0 } } }, owner());
    expect([ob.status, ob.body.error.details.blockers.map((x: any) => x.code)]).toEqual([422, ['still_options']]);
    expect(tmpLeft()).toEqual([]);
  }, 60_000);
});

describe('output.still: file name, conformed source, untried size (pure)', () => {
  const video = (o: Partial<Asset> = {}): Asset => ({ id: 'ast_v', kind: 'video', name: 'IMG_0042.MOV', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mov', mimeType: 'video/quicktime', duration: T.rt(4000, 1), video: { width: 3840, height: 2160, frameRate: { num: 30000, den: 1001 }, codec: 'h264', rotation: 0, frameCount: 100000 }, provenance: prov, ...o });
  it('the file name is `{asset name} · {frame time}` on the file\'s own clock, exact, no date; unsafe characters replaced', () => {
    expect(stillFileName(video(), 0, 'png')).toBe('IMG_0042 · 0m00.000s.png');
    expect(stillFileName(video(), 137, 'jpeg')).toBe('IMG_0042 · 0m04.571s.jpg'); // 137·1001/30000 = 4.571233 s
    expect(stillFileName(video(), 90000, 'png')).toBe('IMG_0042 · 50m03.000s.png'); // 90000·1001/30000 = 3003 s
    expect(stillFileName(video(), 99999, 'png')).toBe('IMG_0042 · 55m36.633s.png'); // 3336.63330 s
    expect(stillFileName(video({ video: { width: 2, height: 2, frameRate: { num: 1, den: 1 }, codec: 'h264', rotation: 0, frameCount: 9000 } }), 3725, 'png')).toBe('IMG_0042 · 1h02m05.000s.png');
    expect(stillFileName(video({ name: 'a/b:c*?.mp4' }), 0, 'png')).toBe('a_b_c__ · 0m00.000s.png');
    expect(stillFileName({ name: 'photo.heic', kind: 'image', image: { width: 1, height: 1, codec: 'hevc', hasAlpha: false } }, 0, 'jpeg')).toBe('photo.jpg');
    expect(stillFileName(video(), 0, 'png')).not.toMatch(/20\d\d/);
  });
  it('a conformed file says so (its reasons, hdr kept); over 24 MP the size is labelled untried; the rate is the file\'s own', () => {
    const conform = { originalContentHash: `sha256:${'b'.repeat(64)}`, originalByteSize: 2, reasons: ['hdr', 'rotation'] as ('hdr' | 'rotation')[], original: { codec: 'hevc', width: 2160, height: 3840, avgFrameRate: '30/1', rFrameRate: '30/1', rotation: 90, frameCount: 10, durationSeconds: 1 }, frameMapping: 'identity' as const, method: 'm' };
    const st = { source: { width: 3840, height: 2160 }, crop: { x: 0, y: 0, w: 3840, h: 2160 } };
    const o = stillOutputOf(video({ conform }), { assetId: 'ast_v', sourceFrame: 1 }, st, 'png');
    expect(o.source).toEqual({ width: 3840, height: 2160, rate: { num: 30000, den: 1001 }, conformed: ['hdr', 'rotation'] });
    expect(o.untriedSize).toBe(false); // 8.3 MP
    const big = stillOutputOf(video(), { assetId: 'ast_v', sourceFrame: 1 }, { source: { width: 6000, height: 4001 }, crop: { x: 0, y: 0, w: 16, h: 16 } }, 'png');
    expect(big.untriedSize).toBe(true); // 24,006,000 > 24,000,000
    expect(stillOutputOf(video(), { assetId: 'ast_v', sourceFrame: 1 }, { source: { width: 6000, height: 4000 }, crop: { x: 0, y: 0, w: 16, h: 16 } }, 'png').untriedSize).toBe(false); // exactly 24 MP
  });
});
