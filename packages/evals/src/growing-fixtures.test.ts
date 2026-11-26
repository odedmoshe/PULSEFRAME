/**
 * The fixture maker of proof:growing (integration of wave 8, W2 note 8): the drawn eyes of every synthetic face lie where the maker
 * says, measured on the picture AS SHOWN (EXIF applied by Pillow's exif_transpose, the browser's from-image rule), and the video's
 * barcode and drifting eyes are where eyesAt says. Synthetic drawn faces only; the folder is deleted after.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { magentaCentroids, makeGrowingFixtures, readBarcode, type GrowingFixtures } from './growing-fixtures.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-growing-fixtures-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const SHOWN = String.raw`
import sys
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGB')
sys.stdout.write('%d %d\n' % im.size); sys.stdout.flush()
sys.stdout.buffer.write(im.tobytes())
`;
function shown(file: string): { w: number; h: number; rgb: Buffer } {
  const out = execFileSync('python3', ['-I', '-c', SHOWN, file], { maxBuffer: 2 ** 26 });
  const nl = out.indexOf(10);
  const [w, h] = out.subarray(0, nl).toString().split(' ').map(Number) as [number, number];
  return { w, h, rgb: out.subarray(nl + 1) };
}

describe('growing fixtures (synthetic drawn faces)', () => {
  let f: GrowingFixtures;
  beforeAll(() => { f = makeGrowingFixtures(path.join(dir, 'fx')); }, 120_000);
  it('every face: shown size as recorded, both eye squares centred on the recorded points (EXIF 6 and 3 included)', () => {
    expect(f.faces.length).toBe(12);
    expect(f.faces.filter((x) => x.exif !== 0).map((x) => x.exif).sort()).toEqual([3, 6]);
    for (const face of f.faces) {
      const s = shown(face.file);
      expect([face.name, s.w, s.h]).toEqual([face.name, face.width, face.height]);
      const [a, b] = magentaCentroids(s.rgb, s.w, s.h, [face.a, face.b], 20);
      // a PNG is exact; a JPEG (quality 97, 4:4:4) may move an edge pixel in or out of the colour test
      const within = face.exif === 0 ? 1e-9 : 0.5;
      for (const [got, want] of [[a, face.a], [b, face.b]] as const) {
        expect(got, face.name).not.toBeNull();
        expect([face.name, Math.abs(got!.x - want.x) <= within, Math.abs(got!.y - want.y) <= within]).toEqual([face.name, true, true]);
      }
    }
  }, 60_000);
  it('the video: each sampled frame carries its number and its eyes where eyesAt says', () => {
    for (const n of [0, 12, 37, 59]) {
      const rgb = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', f.video.file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2 ** 24 });
      expect(readBarcode(rgb, f.video.width)).toBe(n);
      const e = f.video.eyesAt(n);
      const [a, b] = magentaCentroids(rgb, f.video.width, f.video.height, [e.a, e.b], 20);
      for (const [got, want] of [[a, e.a], [b, e.b]] as const) {
        expect(got).not.toBeNull();
        expect(Math.hypot(got!.x - want.x, got!.y - want.y)).toBeLessThan(0.75);
      }
    }
  }, 60_000);
});
