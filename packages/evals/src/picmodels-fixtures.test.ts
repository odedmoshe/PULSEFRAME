/** The synthetic drawn faces of proof:picmodels: the decoded PNG has exactly the magenta squares at their drawn centres; the video is 24 frames. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { EXIF_FACE, makeExifStill, makePicmodelsFixtures, PICMODELS_CHECKS, storedFromShown } from './picmodels-fixtures.ts';

const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picmodels-fx-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const rgbOf = (file: string, extra: string[] = []) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, ...extra, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 64 << 20 });
const magentaCentroids = (b: Buffer, w: number, h: number) => {
  const seen = new Uint8Array(w * h), out: { x: number; y: number }[] = [];
  const mag = (i: number) => b[3 * i]! >= 215 && b[3 * i + 1]! <= 40 && b[3 * i + 2]! >= 215;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !mag(s)) continue;
    let sx = 0, sy = 0, n = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const i = st.pop()!; const x = i % w, y = (i - x) / w; sx += x + 0.5; sy += y + 0.5; n++; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && mag(j)) { seen[j] = 1; st.push(j); } }
    out.push({ x: sx / n, y: sy / n });
  }
  return out.sort((p, q) => p.x - q.x || p.y - q.y);
};

describe('picmodels fixtures (synthetic drawn faces)', () => {
  it.skipIf(!ffmpeg)('every still decodes to exactly its drawn eyes and decoys; the video has 24 frames with frame 12 where it should be', () => {
    const fx = makePicmodelsFixtures(dir);
    for (const s of Object.values(fx.stills)) {
      const want = [...s.faces.flatMap((f) => [f.a, f.b]), ...s.decoys].sort((p, q) => p.x - q.x || p.y - q.y);
      expect(magentaCentroids(rgbOf(s.file), s.width, s.height), s.name).toEqual(want);
    }
    expect(fx.stills.nine.faces).toHaveLength(9);
    const all = rgbOf(fx.video.file);
    expect(all.length).toBe(fx.video.width * fx.video.height * 3 * fx.video.frames);
    const f12 = all.subarray(12 * fx.video.width * fx.video.height * 3, 13 * fx.video.width * fx.video.height * 3);
    const c = magentaCentroids(Buffer.from(f12), fx.video.width, fx.video.height);
    expect(c.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[fx.video.eyesAt(12).a.x, 181], [fx.video.eyesAt(12).b.x, 181]]);
  }, 60_000); // several ffmpeg encodes: about 7 s on a loaded machine
  it('storedFromShown follows the EXIF definition: a pixel shown at (x, y) is stored where row 0 / column 0 say', () => {
    const W = 4, H = 3, shown = Buffer.alloc(W * H * 3);
    shown[3 * (0 * W + 3)] = 255; // shown top-right corner
    const at = (o: number) => { const s = storedFromShown(shown, W, H, o); const i = s.rgb.indexOf(255) / 3; return [s.width, s.height, i % s.width, Math.floor(i / s.width)]; };
    // stored (c, r) of the shown top-right pixel (x = W−1, y = 0)
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(at)).toEqual([[4, 3, 3, 0], [4, 3, 0, 0], [4, 3, 0, 2], [4, 3, 3, 2], [3, 4, 0, 3], [3, 4, 0, 0], [3, 4, 2, 0], [3, 4, 2, 3]]);
  });
  it.skipIf(!ffmpeg)('the EXIF stills: tagged with their orientation, and the stored JPEG keeps the drawn squares within half a pixel', () => {
    for (const o of [3, 6]) {
      const fx = makeExifStill(dir, `e${o}.jpg`, o, 640, 480, [EXIF_FACE]);
      const b = fs.readFileSync(fx.file);
      expect(b.includes(Buffer.from('Exif\0\0', 'latin1'))).toBe(true);
      const sw = o >= 5 ? 480 : 640, sh = o >= 5 ? 640 : 480;
      const got = magentaCentroids(execFileSync('ffmpeg', ['-v', 'error', '-noautorotate', '-i', fx.file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 64 << 20 }), sw, sh);
      const marks = Buffer.alloc(640 * 480 * 3);
      for (const p of [EXIF_FACE.a, EXIF_FACE.b]) for (let y = p.y - 3; y < p.y + 3; y++) for (let x = p.x - 3; x < p.x + 3; x++) { const i = 3 * (y * 640 + x); marks[i] = 255; marks[i + 2] = 255; }
      const want = magentaCentroids(storedFromShown(marks, 640, 480, o).rgb, sw, sh);
      expect(got).toHaveLength(2);
      got.forEach((g, i) => { expect(Math.abs(g.x - want[i]!.x)).toBeLessThan(0.5); expect(Math.abs(g.y - want[i]!.y)).toBeLessThan(0.5); });
    }
  }, 60_000);
  it('the check list names every check of the corrected plan', () => {
    expect(Object.keys(PICMODELS_CHECKS)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'R1', 'R2', 'U1']);
  });
});
