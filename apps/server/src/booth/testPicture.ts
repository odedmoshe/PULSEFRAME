/**
 * The booth's built-in test pictures on the server (wave 8 booth; verify C6): core's RGBA (packages/core/src/booth/testPicture.ts) as
 * PNG bytes (png.ts), made once per process, with the content hash the scene document imports. `putBoothPictures` stores them in the
 * blob store again before every export strip: the storage cleaner removes unreferenced blobs older than ten minutes (storage.ts).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BOOTH_SCENE_H, BOOTH_SCENE_W, type BoothTestPictureRef } from '@pulseframe/core';
import { boothTestPictureRgba, type BoothPictureWhich } from '@pulseframe/core/booth/testPicture.ts';
import type { Store } from '../store.ts';
import { encodePng } from './png.ts';

export interface BoothPicture extends BoothTestPictureRef { which: BoothPictureWhich; png: Buffer; rgbaSha256: string }
export interface BoothPictures { a: BoothPicture; b: BoothPicture; /** sha256 over both RGBA buffers (a then b): the part of every picture recipe that names the pixels */ rgbaSha256: string }

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
let made: BoothPictures | null = null;
export function boothPictures(): BoothPictures {
  if (made) return made;
  const one = (which: BoothPictureWhich): BoothPicture => {
    const rgba = boothTestPictureRgba(which);
    const png = encodePng(rgba, BOOTH_SCENE_W, BOOTH_SCENE_H);
    return { which, png, contentHash: `sha256:${sha(png)}`, byteSize: png.length, rgbaSha256: `sha256:${sha(rgba)}` };
  };
  const a = one('a'), b = one('b');
  made = { a, b, rgbaSha256: `sha256:${createHash('sha256').update(boothTestPictureRgba('a')).update(boothTestPictureRgba('b')).digest('hex')}` };
  return made;
}
/** Writes both pictures into the blob store (a no-op for one already there). */
export function putBoothPictures(store: Store): BoothPictures {
  const p = boothPictures();
  // putBlob keeps a file that is there (and drops the temporary copy) and records the row again if the cleaner removed it
  for (const pic of [p.a, p.b]) store.putBlob(pic.contentHash, writeTmp(store, pic.png), pic.byteSize, 'image/png');
  return p;
}
function writeTmp(store: Store, bytes: Buffer): string {
  fs.mkdirSync(store.tmpDir, { recursive: true });
  const f = path.join(store.tmpDir, `booth_${randomBytes(6).toString('hex')}.png`);
  fs.writeFileSync(f, bytes);
  return f;
}
