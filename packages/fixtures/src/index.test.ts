/**
 * Fixtures with independent truth for the time effects (ADR-0011): one barcode per colour channel, and the flat-grey
 * video whose frames merge to known levels.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { barcodeFrame, BARCODE, generateGreyFixture, greyLevel, readBarcode, readBarcodeChannel } from './index.ts';

const W = 320, H = 180;
const rect = { x: 0, y: 0, w: W, h: H };
const rgb = (index: number) => new Uint8Array(barcodeFrame(index, W, H, 30));

describe('barcodes', () => {
  it('readBarcodeChannel reads each colour channel on its own: a picture made of three frames\' channels gives the three indices', () => {
    for (const [a, b, c] of [[37, 33, 29], [0, 65535 & 1234, 4321], [90, 86, 82]] as const) {
      const ra = rgb(a), rb = rgb(b), rc = rgb(c);
      const mixed = new Uint8Array(W * H * 3);
      for (let i = 0; i < W * H; i++) { mixed[i * 3] = ra[i * 3]!; mixed[i * 3 + 1] = rb[i * 3 + 1]!; mixed[i * 3 + 2] = rc[i * 3 + 2]!; }
      expect([0, 1, 2].map((ch) => readBarcodeChannel(mixed, W, 3, rect, ch as 0 | 1 | 2))).toEqual([a, b, c]);
    }
  });
  it('readBarcode still averages the channels, as before; both read RGBA as well', () => {
    const p = rgb(4242);
    expect(readBarcode(p, W, 3, rect)).toBe(4242);
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) { rgba.set(p.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
    expect(readBarcode(rgba, W, 4, rect)).toBe(4242);
    expect(readBarcodeChannel(rgba, W, 4, rect, 1)).toBe(4242);
    expect(BARCODE.bits).toBe(16);
  });
});

describe('grey fixture', () => {
  it('greyLevel uses mid levels and changes a lot from frame to frame', () => {
    for (let i = 0; i < 400; i++) { expect(greyLevel(i)).toBeGreaterThanOrEqual(40); expect(greyLevel(i)).toBeLessThanOrEqual(215); }
    for (let i = 1; i < 30; i++) expect(Math.abs(greyLevel(i) - greyLevel(i - 1))).toBeGreaterThan(20);
  });
  it('every frame decodes flat, and lossless: the decoded luma of frame F is the one the encoder was given for greyLevel(F)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-grey-'));
    try {
      const out = path.join(dir, 'grey.mp4');
      const fx = await generateGreyFixture({ out, frames: 12, width: 64, height: 36 });
      expect(fx.levels).toEqual(Array.from({ length: 12 }, (_, i) => greyLevel(i)));
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }));
      expect(probe.streams.map((s: { codec_type: string }) => s.codec_type)).toEqual(['video']);
      expect(probe.streams[0].codec_name).toBe('h264');
      // decoded luma, frame by frame (ffmpeg reads the limited-range luma back as full-range grey): one value per frame, that grey
      const y = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
      expect(y.length).toBe(12 * 64 * 36);
      for (let k = 0; k < 12; k++) {
        const frame = y.subarray(k * 64 * 36, (k + 1) * 64 * 36);
        expect(new Set(frame).size).toBe(1);
        expect(frame[0]).toBe(greyLevel(k)); // read back as full-range grey
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
