import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateBarcodeFixture, readBarcode } from '../../../packages/fixtures/src/index.ts';
import { ingestUpload } from './ingest.ts';
import { Store } from './store.ts';

let dir: string;
let store: Store;
let base: string;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const upload = (file: string) => ingestUpload(store, Readable.toWeb(fs.createReadStream(file)) as any, path.basename(file), 'test', 1 << 30);
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-conform-'));
  store = new Store(path.join(dir, 'data'));
  base = path.join(dir, 'base.mp4');
  await generateBarcodeFixture({ out: base, frames: 60 });
}, 60_000);
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('conform route (SPEC §7)', () => {
  it('a constant-rate, upright H.264 file is stored as-is with no conform record', async () => {
    const a = await upload(base);
    expect(a.conform).toBeUndefined();
    expect(a.video).toMatchObject({ codec: 'h264', frameCount: 60, rotation: 0 });
  });
  it('rotation metadata: conformed upright with swapped dimensions; original bytes kept; frames map 1:1', async () => {
    const rot = path.join(dir, 'rot.mp4');
    ff(['-display_rotation', '90', '-i', base, '-c', 'copy', rot]);
    const a = await upload(rot);
    expect(a.conform).toMatchObject({ reasons: ['rotation'], frameMapping: 'identity', original: { width: 640, height: 360 } });
    expect(Math.abs(a.conform!.original.rotation)).toBe(90);
    expect(a.video).toMatchObject({ width: 360, height: 640, rotation: 0, frameCount: 60, codec: 'h264' });
    expect(fs.existsSync(store.blobPath(a.conform!.originalContentHash))).toBe(true);
    expect(fs.statSync(store.blobPath(a.conform!.originalContentHash)).size).toBe(a.conform!.originalByteSize);
    expect(a.contentHash).not.toBe(a.conform!.originalContentHash);
  }, 60_000);
  it('variable frame rate: conformed to the nearest standard constant rate; every conformed frame is the source frame nearest in time', async () => {
    // Drop every third frame without re-timing the rest: timestamps 0,1,3,4,6,7,... /30 s -> genuinely variable.
    const vfr = path.join(dir, 'vfr.mp4');
    ff(['-i', base, '-vf', "select='mod(n\\,3)'", '-fps_mode', 'vfr', '-an', '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', vfr]);
    const a = await upload(vfr);
    expect(a.conform!.reasons).toEqual(['variable-frame-rate']);
    expect(a.conform!.frameMapping).toBe('cfr-nearest-timestamp');
    const rate = a.video!.frameRate;
    expect(a.video!.rotation).toBe(0);
    // Decode the conformed copy and check each constant-rate frame against the kept source frames (indices not divisible by 3).
    const raw = ff(['-i', store.blobPath(a.contentHash), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const n = raw.length / (640 * 360 * 3);
    expect(n).toBe(a.video!.frameCount);
    const kept = Array.from({ length: 60 }, (_, i) => i).filter((i) => i % 3 !== 0);
    const t0 = kept[0]! / 30;
    let bad = 0;
    for (let k = 0; k < n; k++) {
      const got = readBarcode(raw.subarray(k * 640 * 360 * 3, (k + 1) * 640 * 360 * 3), 640, 3, { x: 0, y: 0, w: 640, h: 360 });
      const t = t0 + (k * rate.den) / rate.num;
      const dist = Math.min(...kept.map((i) => Math.abs(i / 30 - t)));
      // The shown frame must be a real source frame and no further than one source frame interval from the ideal time.
      if (!kept.includes(got) || Math.abs(got / 30 - t) > dist + 1 / 30 + 1e-6) bad++;
    }
    expect(bad).toBe(0);
  }, 60_000);
  it('a codec the editor cannot decode (HEVC) is conformed to H.264 with identical frame count', async () => {
    const hevc = path.join(dir, 'hevc.mp4');
    ff(['-i', base, '-c:v', 'libx265', '-x265-params', 'log-level=error', '-crf', '18', '-tag:v', 'hvc1', '-c:a', 'copy', hevc]);
    const a = await upload(hevc);
    expect(a.conform).toMatchObject({ reasons: ['codec'], frameMapping: 'identity', original: { codec: 'hevc' } });
    expect(a.video).toMatchObject({ codec: 'h264', frameCount: 60 });
    const raw = ff(['-i', store.blobPath(a.contentHash), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const wrong = Array.from({ length: 60 }, (_, k) => readBarcode(raw.subarray(k * 691200, (k + 1) * 691200), 640, 3, { x: 0, y: 0, w: 640, h: 360 })).filter((v, k) => v !== k);
    expect(wrong).toEqual([]);
  }, 60_000);
  it('non-media bytes are still rejected with a typed error', async () => {
    const junk = path.join(dir, 'junk.mp4');
    fs.writeFileSync(junk, Buffer.alloc(5000, 7));
    await expect(upload(junk)).rejects.toMatchObject({ code: 'unsupported_media' });
  });
});
