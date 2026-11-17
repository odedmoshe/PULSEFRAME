/**
 * Fixtures with independent truth for the time effects (ADR-0011): one barcode per colour channel, and the flat-grey
 * video whose frames merge to known levels. The motion tracking fixture (ADR-0015): its truth file against the drawn pictures.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { barcodeFrame, BARCODE, decoyDistance, generateGreyFixture, generateTrackingFixture, greyLevel, readBarcode, readBarcodeChannel, TRACKING_FIXTURE, trackingFrame, trackingTruth } from './index.ts';

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

describe('motion tracking fixture (ADR-0015)', () => {
  const F = TRACKING_FIXTURE;
  it('the look-alike stays at least 400 px from the disc on every frame it is shown, and only then', () => {
    let shown = 0, nearest = Infinity;
    for (let f = 0; f < F.frames; f++) {
      const d = decoyDistance(f);
      if (f < F.decoy.from || f > F.decoy.to) { expect(d).toBeNull(); continue; }
      shown++;
      nearest = Math.min(nearest, d!);
    }
    expect(shown).toBe(80);
    expect(nearest).toBeGreaterThanOrEqual(400);
  });

  it('the truth file\'s centres equal the centroid of the disc as drawn (4×4 samples per pixel, before encoding) within 0.25 px; the file is H.264 with B-frames and AAC; the barcode reads each frame; nothing is magenta', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-track-'));
    try {
      const out = path.join(dir, 'tracking.mp4');
      const fx = await generateTrackingFixture({ out });
      const truth = JSON.parse(fs.readFileSync(fx.truthFile, 'utf8')) as { width: number; height: number; frames: number; truth: { cx: number; cy: number; r: number; occluded: boolean }[] };
      expect([truth.width, truth.height, truth.frames, truth.truth.length]).toEqual([1280, 720, 240, 240]);
      expect(truth.truth.filter((t) => t.occluded).length).toBe(20);
      for (const f of [0, 37, 101, 149, 233]) {
        const { rgb, coverage } = trackingFrame(f, { coverage: true });
        let sum = 0, sx = 0, sy = 0;
        for (let y = 0; y < F.height; y++) for (let x = 0; x < F.width; x++) { const k = coverage![y * F.width + x]!; if (k) { sum += k; sx += k * (x + 0.5); sy += k * (y + 0.5); } }
        const t = truth.truth[f]!;
        expect(Math.hypot(sx / sum - t.cx, sy / sum - t.cy)).toBeLessThan(0.25);
        expect(Math.abs(Math.sqrt(sum / Math.PI) - t.r)).toBeLessThan(0.25); // the area gives the radius back too
        expect(t).toEqual(JSON.parse(JSON.stringify(trackingTruth(f))));
        expect(readBarcode(new Uint8Array(rgb), F.width, 3, { x: 0, y: 0, w: F.width, h: F.height })).toBe(f);
        let magenta = 0;
        for (let i = 0; i < rgb.length; i += 3) if (rgb[i]! > 150 && rgb[i + 2]! > 150 && rgb[i + 1]! < 100) magenta++;
        expect(magenta).toBe(0);
      }
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', out], { encoding: 'utf8' }));
      const v = probe.streams.find((x: { codec_type: string }) => x.codec_type === 'video'), a = probe.streams.find((x: { codec_type: string }) => x.codec_type === 'audio');
      expect([v.codec_name, v.width, v.height, v.r_frame_rate, Number(v.nb_read_frames), v.has_b_frames > 0, a?.codec_name]).toEqual(['h264', 1280, 720, '30/1', 240, true, 'aac']);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 240_000);
});
