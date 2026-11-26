/**
 * Transparent video at import (wave 8 `motioncode`, gate G2; verify C2): the probe records `video.hasAlpha`, an alpha file gets
 * no H.264 proxy, and a file that must be conformed keeps its alpha (VP9 with alpha in WebM) or is refused in words when the
 * conversion cannot keep it. Synthetic files made here with ffmpeg; the working folder is deleted.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Asset } from '@pulseframe/core';
import { derivativeApplies } from './derive.ts';
import { conformArgs, describeMedia, ingestUpload, NeedsConform } from './ingest.ts';
import { Store } from './store.ts';

let dir: string;
let store: Store;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const upload = (file: string) => ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, path.basename(file), 'test', 1 << 30);
/** A 64×48 blue plate, left half fully transparent. */
const alphaVf = (max = 255) => `format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,32),0,${max})'`;
function webm(name: string, rate = '30', extraVf = '') {
  const out = path.join(dir, name);
  ff(['-f', 'lavfi', '-i', `color=c=0x2060e0:s=64x48:r=${rate}:d=1`, '-vf', alphaVf() + extraVf, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-metadata:s:v:0', 'alpha_mode=1', out]);
  return out;
}
/** Alpha of every pixel of the first frame, decoded with libvpx (ffmpeg's native VP9 decoder drops alpha). */
const alphaPlane = (file: string, vp9: boolean) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...(vp9 ? ['-c:v', 'libvpx-vp9'] : []), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 }).filter((_, i) => i % 4 === 3);
const leftRightAlpha = (a: Uint8Array) => {
  let left = 0, right = 0;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) { const v = a[y * 64 + x]!; if (x < 30) left = Math.max(left, v); if (x >= 34 && v < 250) right++; }
  return { leftMaxAlpha: left, rightPixelsBelow250: right };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-alpha-'));
  store = new Store(path.join(dir, 'data'));
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('transparent video at import (G2)', () => {
  it('describeMedia sets video.hasAlpha for a VP9 WebM with alpha_mode 1 (ffprobe reports its plane as yuv420p), and not for an opaque file', async () => {
    const m = await describeMedia(webm('a.webm'));
    expect(m.video).toMatchObject({ codec: 'vp9', hasAlpha: true, frameCount: 30 });
    const opaque = path.join(dir, 'o.webm');
    ff(['-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=30:d=1', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', opaque]);
    expect((await describeMedia(opaque)).video!.hasAlpha).toBeUndefined();
  }, 60_000);
  it('a 30000/1001 transparent WebM is not conformed: it keeps its file, its rate and its alpha', async () => {
    const a = await upload(webm('ntsc.webm', '30000/1001'));
    expect(a.conform).toBeUndefined();
    expect(a.video).toMatchObject({ frameRate: { num: 30000, den: 1001 }, hasAlpha: true });
  }, 60_000);
  it('no H.264 proxy is made for a file with alpha (it would draw a black box while playing); thumbnails still are', async () => {
    const meta = await describeMedia(webm('p.webm'));
    const asset = { ...meta, id: 'ast_a', name: 'p.webm', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, provenance: { origin: 'upload', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' } } as Asset;
    expect(derivativeApplies(asset)).toMatchObject({ proxy: false, thumbnails: true });
    expect(derivativeApplies({ ...asset, video: { ...asset.video!, hasAlpha: undefined } } as Asset)).toMatchObject({ proxy: true });
  }, 60_000);
  it('a transparent WebM that must be conformed (non-square pixels) keeps its alpha: VP9 with alpha in WebM, left half still transparent', async () => {
    const a = await upload(webm('sar.webm', '30', ',setsar=2/1'));
    expect(a.conform?.reasons).toEqual(['pixel-aspect']);
    expect(a).toMatchObject({ container: 'webm', mimeType: 'video/webm' });
    expect(a.video).toMatchObject({ codec: 'vp9', hasAlpha: true, width: 128, height: 48, frameCount: 30 });
    expect(a.conform!.method).toMatch(/alpha kept/);
    const plane = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-c:v', 'libvpx-vp9', '-i', store.blobPath(a.contentHash), '-frames:v', '1', '-vf', 'scale=64:48', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 }).filter((_, i) => i % 4 === 3);
    expect(leftRightAlpha(plane)).toEqual({ leftMaxAlpha: 0, rightPixelsBelow250: 0 });
  }, 120_000);
  it('ProRes 4444 with alpha (a codec the editor does not decode) is conformed with its alpha kept', async () => {
    const mov = path.join(dir, 'p.mov');
    ff(['-f', 'lavfi', '-i', 'color=c=0x2060e0:s=64x48:r=30:d=1', '-vf', `format=yuva444p10le,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,32),0,1023)'`, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', mov]);
    const a = await upload(mov);
    expect(a.conform?.reasons).toEqual(['codec']);
    expect(a.video).toMatchObject({ codec: 'vp9', hasAlpha: true, frameCount: 30 });
    expect(leftRightAlpha(alphaPlane(store.blobPath(a.contentHash), true))).toEqual({ leftMaxAlpha: 0, rightPixelsBelow250: 0 });
  }, 120_000);
  it('the conform arguments for an opaque file are unchanged (H.264, conform-1); for an alpha file with high dynamic range the import is refused in words, never converted without its alpha', async () => {
    const orig = { codec: 'hevc', width: 64, height: 48, avgFrameRate: '30/1', rFrameRate: '30/1', rotation: 0, frameCount: 30, durationSeconds: 1 };
    const opaque = conformArgs('in', 'out.mp4', new NeedsConform(['codec'], orig, { num: 30, den: 1 }));
    expect(opaque).toContain('libx264'); expect(opaque.join(' ')).toContain('format=yuv420p');
    const alpha = conformArgs('in', 'out.webm', new NeedsConform(['codec'], orig, { num: 30, den: 1 }, true));
    expect(alpha).toContain('libvpx-vp9'); expect(alpha.join(' ')).toContain('format=yuva420p');
    const hdr = path.join(dir, 'hdr.mov');
    ff(['-f', 'lavfi', '-i', 'color=c=0x2060e0:s=64x48:r=30:d=1', '-vf', `format=yuva444p10le,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,32),0,1023)'`, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-color_trc', 'smpte2084', '-color_primaries', 'bt2020', '-colorspace', 'bt2020nc', hdr]);
    const err = await upload(hdr).then(() => null, (e) => e);
    expect(err?.code).toBe('unsupported_media');
    expect(String(err?.message)).toMatch(/transparent/);
    expect(err?.details).toMatchObject({ alpha: true, he: expect.stringContaining('שקיפות') });
  }, 120_000);
});
