/**
 * The server's test pictures and the PNG encoder (wave 8 booth; verify C6): the PNG round-trips through the existing header reader and
 * through an independent inflate back to the same RGBA; the content hash is of the PNG, the recipe part is of the RGBA; putBlob again.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BOOTH_SCENE_H, BOOTH_SCENE_W } from '@pulseframe/core';
import { boothTestPictureRgba } from '@pulseframe/core/booth/testPicture.ts';
import { pngSize } from '../framejobs.ts';
import { Store } from '../store.ts';
import { encodePng } from './png.ts';
import { boothPictures, putBoothPictures } from './testPicture.ts';

/** Independent PNG reader for the test: chunks, CRCs, inflate, filter 0 rows. */
function decode(png: Buffer): { w: number; h: number; rgba: Uint8Array } {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  let off = 8, w = 0, h = 0;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off), type = png.toString('latin1', off + 4, off + 8), data = png.subarray(off + 8, off + 8 + len);
    expect(png.readUInt32BE(off + 8 + len)).toBe(zlib.crc32(png.subarray(off + 4, off + 8 + len)) >>> 0);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); expect([...data.subarray(8)]).toEqual([8, 6, 0, 0, 0]); }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) { expect(raw[y * (w * 4 + 1)]).toBe(0); rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4); }
  return { w, h, rgba };
}

describe('PNG encoder and test pictures', () => {
  it('round-trips through pngSize (framejobs.ts) and an independent decode to the same RGBA', () => {
    const p = boothPictures();
    for (const which of ['a', 'b'] as const) {
      const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-png-')), `${which}.png`);
      fs.writeFileSync(f, p[which].png);
      expect(pngSize(f)).toEqual({ width: BOOTH_SCENE_W, height: BOOTH_SCENE_H });
      fs.rmSync(path.dirname(f), { recursive: true, force: true });
      const d = decode(p[which].png);
      expect(Buffer.from(d.rgba).equals(Buffer.from(boothTestPictureRgba(which)))).toBe(true);
      expect(p[which].contentHash).toBe(`sha256:${createHash('sha256').update(p[which].png).digest('hex')}`);
      expect(p[which].rgbaSha256).toBe(`sha256:${createHash('sha256').update(boothTestPictureRgba(which)).digest('hex')}`);
    }
    expect(p.rgbaSha256).toBe(`sha256:${createHash('sha256').update(boothTestPictureRgba('a')).update(boothTestPictureRgba('b')).digest('hex')}`);
    expect(boothPictures()).toBe(p); // once per process
    expect(() => encodePng(new Uint8Array(3), 1, 1)).toThrow();
  });
  it('putBoothPictures stores both blobs, and again after the cleaner removed one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-blobs-'));
    const store = new Store(dir);
    try {
      const p = putBoothPictures(store);
      expect(fs.readFileSync(store.blobPath(p.a.contentHash)).equals(p.a.png)).toBe(true);
      putBoothPictures(store); // a second put keeps the file and leaves no temporary copy
      expect(fs.readdirSync(store.tmpDir).filter((f) => f.startsWith('booth_'))).toEqual([]);
      fs.rmSync(store.blobPath(p.b.contentHash));
      putBoothPictures(store);
      expect(fs.readFileSync(store.blobPath(p.b.contentHash)).equals(p.b.png)).toBe(true);
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
