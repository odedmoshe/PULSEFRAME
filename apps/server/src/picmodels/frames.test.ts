/**
 * Decoding AS SHOWN (picmodels/frames.ts): for all 8 EXIF orientations the decoded picture has the size ingest records as
 * `asset.image`, and a marker drawn at a known SHOWN place comes back there; a video frame n is frame n, not frame 0.
 * Synthetic pictures made here (packages/evals/src/picmodels-fixtures.ts), deleted after.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { drawFaces, makeExifStill } from '../../../../packages/evals/src/picmodels-fixtures.ts';
import { describeMedia, jpegOrientation } from '../ingest.ts';
import { decodeArgs, decodeShown, orientationFilter, scaledSize } from './frames.ts';

const ffmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-picframes-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const never = new AbortController().signal;
/** Centroids of magenta blobs (as the fake adapter finds them), sorted. */
const blobs = (b: Buffer, w: number, h: number) => {
  const seen = new Uint8Array(w * h), out: { x: number; y: number }[] = [];
  const mag = (i: number) => b[3 * i]! >= 200 && b[3 * i + 1]! <= 60 && b[3 * i + 2]! >= 200;
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !mag(s)) continue;
    let sx = 0, sy = 0, n = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const i = st.pop()!; const x = i % w, y = (i - x) / w; sx += x + 0.5; sy += y + 0.5; n++; for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !seen[j] && mag(j)) { seen[j] = 1; st.push(j); } }
    if (n >= 4) out.push({ x: sx / n, y: sy / n });
  }
  return out.sort((p, q) => p.x - q.x || p.y - q.y);
};

describe('frames.ts: the decided command lines', () => {
  it('stills: autorotation off and the explicit EXIF filter; video: select on the decode index; never anything but files', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(orientationFilter)).toEqual(['', 'hflip', 'hflip,vflip', 'vflip', 'transpose=0', 'transpose=1', 'transpose=3', 'transpose=2']);
    const s = decodeArgs({ kind: 'still', file: '/x.jpg', orientation: 6, shown: { width: 480, height: 640 } }, { w: 480, h: 640 });
    expect(s).toContain('-noautorotate');
    expect(s.slice(s.indexOf('-vf'), s.indexOf('-vf') + 2)).toEqual(['-vf', 'transpose=1,scale=480:640:flags=bilinear']);
    const v = decodeArgs({ kind: 'video', file: '/x.mp4', frame: 12, shown: { width: 640, height: 360 } }, { w: 640, h: 360 });
    expect(v).not.toContain('-noautorotate');
    expect(v[v.indexOf('-vf') + 1]).toBe('select=eq(n\\,12),scale=640:360:flags=bilinear');
    for (const a of [s, v]) expect(a.slice(a.indexOf('-protocol_whitelist'), a.indexOf('-protocol_whitelist') + 2)).toEqual(['-protocol_whitelist', 'file']);
    expect(scaledSize(960, 480)).toEqual({ w: 640, h: 320 });
    expect(scaledSize(480, 640)).toEqual({ w: 480, h: 640 });
    expect(scaledSize(3000, 4000)).toEqual({ w: 480, h: 640 });
  });
});

describe.skipIf(!ffmpeg)('frames.ts: decoding as shown', () => {
  const W = 320, H = 240;
  const faces = [{ a: { x: 61, y: 41 }, b: { x: 101, y: 41 } }];
  for (const o of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`EXIF ${o}: the decoded size is asset.image's and the drawn eyes come back at their shown place (within 0.5 px)`, async () => {
      const fx = makeExifStill(dir, `exif${o}.jpg`, o, W, H, faces);
      expect(jpegOrientation(fx.file)).toBe(o);
      const meta = await describeMedia(fx.file);
      expect(meta.image && [meta.image.width, meta.image.height]).toEqual([W, H]);
      const pic = await decodeShown({ kind: 'still', file: fx.file, orientation: o, shown: { width: W, height: H } }, never, W);
      expect([pic.w, pic.h, pic.rgb.length]).toEqual([W, H, W * H * 3]);
      const got = blobs(pic.rgb, W, H);
      expect(got).toHaveLength(2);
      for (const [g, want] of got.map((g, i) => [g, [faces[0]!.a, faces[0]!.b][i]!] as const)) { expect(Math.abs(g.x - want.x)).toBeLessThan(0.5); expect(Math.abs(g.y - want.y)).toBeLessThan(0.5); }
      // scaled to the eyes' long side 640: the same place as a fraction of the picture
      const big = await decodeShown({ kind: 'still', file: fx.file, orientation: o, shown: { width: W, height: H } }, never);
      expect([big.w, big.h]).toEqual([640, 480]);
      const b2 = blobs(big.rgb, 640, 480);
      expect(b2).toHaveLength(2);
      expect(Math.abs(b2[0]!.x / 640 - 61 / W)).toBeLessThan(1 / 640);
      expect(Math.abs(b2[0]!.y / 480 - 41 / H)).toBeLessThan(1 / 480);
    });
  }
  it('a video frame n is decoded, not frame 0; a frame past the end is a 502 with codes only', async () => {
    const w = 160, h = 96, n = 6;
    const frames = Buffer.concat(Array.from({ length: n }, (_, k) => drawFaces(w, h, [{ a: { x: 21 + 10 * k, y: 41 }, b: { x: 61 + 10 * k, y: 41 } }])));
    const file = path.join(dir, 'v.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${w}x${h}`, '-framerate', '24', '-i', 'pipe:0', '-c:v', 'libx264', '-qp', '0', '-pix_fmt', 'yuv444p', file], { input: frames });
    const pic = await decodeShown({ kind: 'video', file, frame: 4, shown: { width: w, height: h } }, never, w);
    expect(blobs(pic.rgb, w, h).map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[61, 41], [101, 41]]);
    const e = await decodeShown({ kind: 'video', file, frame: 99, shown: { width: w, height: h } }, never, w).catch((x) => x);
    expect([e.status, e.code, JSON.stringify(e.details)]).toEqual([502, 'eyes_engine_failed', '{"reason":"decode","exit":0}']);
  });
  it('an aborted decode rejects with the signal\'s reason', async () => {
    const ac = new AbortController();
    ac.abort(new Error('stop'));
    await expect(decodeShown({ kind: 'still', file: path.join(dir, 'exif1.jpg'), orientation: 1, shown: { width: W, height: H } }, ac.signal)).rejects.toThrow('stop');
  });
});
