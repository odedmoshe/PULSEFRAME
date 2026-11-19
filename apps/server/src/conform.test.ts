import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateBarcodeFixture, readBarcode } from '../../../packages/fixtures/src/index.ts';
import { ingestUpload, jpegOrientation } from './ingest.ts';
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
  it('sound that runs on after the last picture is kept: the asset is as long as its sound in whole frames; a file whose sound ends with its picture is unchanged', async () => {
    const a0 = await upload(base); // 60 frames at 30 fps with 2 s of sound
    expect(Number(a0.duration.value) / a0.duration.timescale).toBe(2);
    const longSound = path.join(dir, 'long-sound.mp4');
    ff(['-t', '1', '-i', base, '-i', base, '-map', '0:v', '-map', '1:a', '-c', 'copy', longSound]); // picture cut to about 1 s, sound 2 s
    const a = await upload(longSound);
    expect(a.conform).toBeUndefined();
    const frames = a.video!.frameCount!;
    expect(frames).toBeGreaterThan(25); expect(frames).toBeLessThan(36); // the picture stream itself is still about 1 s
    const seconds = Number(a.duration.value) / a.duration.timescale;
    expect(seconds).toBeGreaterThan(1.9); expect(seconds).toBeLessThanOrEqual(2.05);
    expect(Number.isInteger(Number((seconds * 30).toFixed(6)))).toBe(true); // whole frames
    // the other way round (sound shorter than the picture) keeps the picture length
    const shortSound = path.join(dir, 'short-sound.mp4');
    ff(['-i', base, '-map', '0:v', '-c:v', 'copy', '-map', '0:a', '-c:a', 'aac', '-af', 'atrim=0:1', shortSound]);
    const b = await upload(shortSound);
    expect(Number(b.duration.value) / b.duration.timescale).toBe(2);
  }, 60_000);
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
  it('non-square pixels: conformed to square pixels at the shown width; frames map 1:1 and read correctly at full frame', async () => {
    const sar = path.join(dir, 'sar.mp4');
    ff(['-i', base, '-vf', 'scale=480:360,setsar=4/3', '-c:v', 'libx264', '-crf', '14', '-c:a', 'copy', sar]);
    const a = await upload(sar);
    expect(a.conform).toMatchObject({ reasons: ['pixel-aspect'], frameMapping: 'identity', original: { width: 480, height: 360 } });
    expect(a.video).toMatchObject({ width: 640, height: 360, frameCount: 60, codec: 'h264' });
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', store.blobPath(a.contentHash), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
    const fb = 640 * 360 * 3;
    expect([0, 17, 59].map((i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), 640, 3, { x: 0, y: 0, w: 640, h: 360 }))).toEqual([0, 17, 59]);
  }, 60_000);
  it('container start time: an MPEG-TS file (streams start around 1.4 s) records its origin; stream starts are measured from it, and frames are counted', async () => {
    const ts = path.join(dir, 'c.ts');
    ff(['-i', base, '-c', 'copy', ts]);
    const a = await upload(ts);
    expect(a.conform).toBeUndefined();
    expect(a.timeOrigin).toBeDefined();
    const origin = Number(a.timeOrigin!.value) / a.timeOrigin!.timescale;
    expect(origin).toBeGreaterThan(1);
    const rel = (t?: { value: string; timescale: number }) => (t ? Number(t.value) / t.timescale : 0);
    expect(Math.min(rel(a.video!.startTime), rel(a.audio!.startTime))).toBe(0); // the earlier stream defines time zero
    expect(Math.max(rel(a.video!.startTime), rel(a.audio!.startTime))).toBeLessThan(0.1); // only the offset between the streams is kept
    expect(a.video!.frameCount).toBe(60); // MPEG-TS does not state it; counted from packets
  }, 60_000);
  it('a file that starts at 0 records no origin and no stream offsets (nothing changes for ordinary files)', async () => {
    const a = await upload(base);
    expect(a.video!.untaggedColour).toBeUndefined(); // the fixture states BT.709
    expect(a.timeOrigin).toBeUndefined();
    expect(a.video!.startTime).toBeUndefined();
    expect(a.audio!.startTime).toBeUndefined();
  });
  it('a file that does not state its colour encoding is marked, so the editor can say its colours are a guess', async () => {
    const plain = path.join(dir, 'untagged.mp4');
    ff(['-i', base, '-c:v', 'libx264', '-crf', '18', '-bsf:v', 'h264_metadata=colour_primaries=2:transfer_characteristics=2:matrix_coefficients=2', '-c:a', 'copy', plain]);
    const a = await upload(plain);
    expect(a.conform).toBeUndefined();
    expect(a.video!.untaggedColour).toBe(true);
  }, 60_000);
  it('still pictures in formats the editor does not draw directly (BMP, TIFF, one-frame GIF) become a lossless PNG copy; the original bytes are kept', async () => {
    for (const [name, args] of [['one.bmp', ['-frames:v', '1']], ['one.tiff', ['-frames:v', '1']], ['one.gif', ['-frames:v', '1']]] as const) {
      const file = path.join(dir, name);
      ff(['-i', base, ...args, file]);
      const a = await upload(file);
      expect(a.kind, name).toBe('image');
      expect(a.image, name).toMatchObject({ width: 640, height: 360, codec: 'png' });
      expect(a.conform, name).toMatchObject({ reasons: ['still-format'], frameMapping: 'identity' });
      expect(fs.existsSync(store.blobPath(a.conform!.originalContentHash)), name).toBe(true);
    }
    // an animated GIF stays a (converted) video
    const anim = path.join(dir, 'anim.gif');
    ff(['-i', base, '-frames:v', '6', '-vf', 'fps=10', anim]);
    expect((await upload(anim)).kind).toBe('video');
  }, 120_000);
  it('JPEG orientation tag: a photo stored sideways is recorded at the size it is shown; other tags leave the size alone', async () => {
    const jpg = path.join(dir, 'plain.jpg');
    ff(['-i', base, '-frames:v', '1', '-q:v', '3', jpg]); // 640×360, no EXIF
    const plain = fs.readFileSync(jpg);
    const withTag = (o: number) => { // insert an EXIF APP1 segment carrying only the Orientation tag right after the SOI marker
      const tiff = Buffer.alloc(26);
      tiff.write('MM', 0, 'latin1'); tiff.writeUInt16BE(42, 2); tiff.writeUInt32BE(8, 4); tiff.writeUInt16BE(1, 8);
      tiff.writeUInt16BE(0x0112, 10); tiff.writeUInt16BE(3, 12); tiff.writeUInt32BE(1, 14); tiff.writeUInt16BE(o, 18); tiff.writeUInt32BE(0, 22);
      const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
      const head = Buffer.alloc(4); head.writeUInt16BE(0xffe1, 0); head.writeUInt16BE(body.length + 2, 2);
      const file = path.join(dir, `exif${o}.jpg`);
      fs.writeFileSync(file, Buffer.concat([plain.subarray(0, 2), head, body, plain.subarray(2)]));
      return file;
    };
    expect(jpegOrientation(jpg)).toBe(1);
    for (const o of [1, 2, 3, 4]) { const f2 = withTag(o); expect(jpegOrientation(f2)).toBe(o); expect((await upload(f2)).image).toMatchObject({ width: 640, height: 360 }); }
    for (const o of [5, 6, 7, 8]) { const f2 = withTag(o); expect(jpegOrientation(f2)).toBe(o); expect((await upload(f2)).image).toMatchObject({ width: 360, height: 640 }); }
    expect(jpegOrientation(path.join(dir, 'base.mp4'))).toBe(1); // not a JPEG
  }, 120_000);
  it('high dynamic range (PQ and HLG, 10-bit HEVC) is tone-mapped to standard range: colour bars come back at their standard levels instead of grey and washed out', async () => {
    const pixelsOf = (file: string) => { const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }); return (x: number) => [...raw.subarray((100 * 640 + x) * 3, (100 * 640 + x) * 3 + 3)]; };
    for (const [name, transfer] of [['pq', 'smpte2084'], ['hlg', 'arib-std-b67']] as const) {
      const hdr = path.join(dir, `hdr-${name}.mp4`);
      // standard colour bars placed at HDR reference white (203 nits) in BT.2020, as a camera or phone would record them
      ff(['-f', 'lavfi', '-i', 'smptebars=s=640x360:r=30:d=1', '-vf', `zscale=tin=bt709:pin=bt709:min=bt709:rin=tv:t=${transfer}:p=bt2020:m=bt2020nc:r=tv:npl=203,format=yuv420p10le`, '-c:v', 'libx265', '-x265-params', 'log-level=error', '-color_primaries', 'bt2020', '-color_trc', transfer, '-colorspace', 'bt2020nc', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', hdr]);
      const a = await upload(hdr);
      expect(a.conform?.reasons, name).toContain('hdr');
      expect(a.conform?.method).toMatch(/tone-mapped/);
      expect(a.video).toMatchObject({ codec: 'h264', width: 640, height: 360 });
      const at = pixelsOf(store.blobPath(a.contentHash));
      const grey = at(45), red = at(503), blue = at(594), green = at(320);
      // the 75 % grey bar is 190 in standard range; read without tone mapping it comes out near 128
      for (const c of grey) expect(Math.abs(c - 190), `${name} grey ${grey}`).toBeLessThanOrEqual(name === 'pq' ? 8 : 25);
      expect(red[0]! > 170 && red[1]! < 45 && red[2]! < 30, `${name} red ${red}`).toBe(true);
      expect(blue[2]! > 170 && blue[0]! < 30 && blue[1]! < 40, `${name} blue ${blue}`).toBe(true);
      expect(green[1]! > 140 && green[0]! < 45 && green[2]! < 30, `${name} green ${green}`).toBe(true);
    }
  }, 120_000);
  it('non-media bytes are still rejected with a typed error', async () => {
    const junk = path.join(dir, 'junk.mp4');
    fs.writeFileSync(junk, Buffer.alloc(5000, 7));
    await expect(upload(junk)).rejects.toMatchObject({ code: 'unsupported_media' });
  });
});
