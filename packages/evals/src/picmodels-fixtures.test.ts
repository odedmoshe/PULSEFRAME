/** The synthetic drawn faces of proof:picmodels: the decoded PNG has exactly the magenta squares at their drawn centres; the video is 24 frames. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { makePicmodelsFixtures, PICMODELS_CHECKS } from './picmodels-fixtures.ts';

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
  });
  it('the check list names every check of the corrected plan', () => {
    expect(Object.keys(PICMODELS_CHECKS)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10', 'E11', 'E12', 'R1', 'R2', 'U1']);
  });
});
