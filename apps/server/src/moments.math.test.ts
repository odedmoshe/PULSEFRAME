/**
 * The moments maths (ADR-0026) on synthetic grey frames and sound series with known truth: a disc moving over a static
 * texture is movement inside the picture, a whole-picture translation is camera movement, a whip pan faster than the search is
 * caught by the border rule, planted hard cuts split stretches, dark, blown and blurred stretches are gated, a burst is found
 * within one hop, a file without sound has no sound series, and a static silent file is flat. No fixtures, no ffmpeg.
 */
import { describe, expect, it } from 'vitest';
import { MOMENTS_GATES, momentsStep, type PictureSeries, type SoundSeries } from '@pulseframe/core';
import { bestShift, boxImage, findMoments, frameOfHop, hopsOfSample, median, percentile, pictureGates, pictureSample, robustZ, soundLevels, type PictureSample } from './moments.math.ts';
import { frameOf, texture } from './vision/synthetic.ts';
import type { GreyFrame } from './vision/types.ts';

const W = 320, H = 180, SPS = 5, R30 = { num: 30, den: 1 }, S = momentsStep(R30);
const tex = texture(41, [16, 8, 4]);
const still = frameOf(W, H, tex);
/** A disc of radius r (grey 235) at (cx, cy) over the static texture. */
const discFrame = (cx: number, cy: number, r = 24, bg: (x: number, y: number) => number = tex) => frameOf(W, H, (x, y) => ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r ? 235 : bg(x, y)));
const shifted = (dx: number, dy = 0) => frameOf(W, H, (x, y) => tex(x - dx, y - dy));
const flat = (v: number) => ({ width: W, height: H, data: new Uint8Array(W * H).fill(v) }) as GreyFrame;
/** A 3×3 box blur, applied `n` times. */
function blur(f: GreyFrame, n = 8): GreyFrame {
  let cur = f.data;
  for (let i = 0; i < n; i++) {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += cur[yy * W + xx]!; c++; } }
      out[y * W + x] = Math.round(s / c);
    }
    cur = out;
  }
  return { width: W, height: H, data: cur };
}

/** The picture series of a frame sequence, as the job builds it. */
function seriesOf(frames: GreyFrame[]): PictureSeries & { samples: PictureSample[] } {
  const samples = frames.map((f, k) => pictureSample(k ? frames[k - 1]! : null, f, SPS));
  const col = <K extends keyof PictureSample>(key: K) => samples.map((s) => s[key]);
  const gated = pictureGates({ luma: col('luma') as number[], sharp: col('sharp') as number[], inner: col('inner') as number[], pan: col('pan') as number[], change: col('change') as number[], border: col('border') as boolean[] });
  return { source: 'original', step: S, count: frames.length, width: W, height: H, luma: col('luma') as number[], sharp: col('sharp') as number[], inner: col('inner') as number[], pan: col('pan') as number[], change: col('change') as number[], gated, digest: 'x', samples };
}
const asset = (count: number, off = 0) => ({ frames: count * S, rate: R30, startOffsetFrames: off });
const discAt = (k: number) => discFrame(160 + 50 * Math.cos(k * 0.96), 100 + 30 * Math.sin(k * 0.96));

describe('pictureSample', () => {
  it('a disc moving over a static texture: inner movement high, camera movement about zero', () => {
    const s = pictureSample(discAt(0), discAt(1), SPS);
    expect(s.inner).toBeGreaterThanOrEqual(MOMENTS_GATES.activeMotionPermille);
    expect(s.pan).toBeLessThan(30);
    expect(s.border).toBe(false);
    const st = pictureSample(still, still, SPS);
    expect([st.inner, st.pan, st.change]).toEqual([0, 0, 0]);
  });
  it('a whole-picture translation by whole box pixels: pan high, inner <= 15 permille', () => {
    for (const [dx, dy] of [[8, 0], [-12, 4], [20, -8]] as const) {
      const s = pictureSample(still, shifted(dx, dy), SPS);
      expect(s.inner).toBeLessThanOrEqual(15);
      const d = Math.hypot(dx / 4, dy / 4);
      expect(s.pan).toBe(Math.round((1000 * d * SPS) / 80));
      expect(s.pan).toBeGreaterThan(100);
      expect(s.border).toBe(false);
    }
  });
  it('a 1200 permille/s whip pan lies outside the search and is flagged on its border', () => {
    // 1200 permille of the long side per second at 5 samples a second = 0.24 of 320 px = 76.8 px a sample (19 box pixels)
    const s = pictureSample(still, shifted(77, 0), SPS);
    expect(s.border).toBe(true);
    expect(s.pan).toBeGreaterThan(MOMENTS_GATES.whipPanPermillePerSecond);
  });
  it('a pan far beyond the search is flagged at every distance, even when its best in-range shift is not on the border', () => {
    for (const dx of [52, 61, 77, 90, 130]) for (const dy of [0, 9]) expect(pictureSample(still, shifted(dx, dy), SPS).border, `${dx},${dy}`).toBe(true);
    // a subject moving over a still background is not a camera move
    for (let k = 0; k < 6; k++) expect(pictureSample(discAt(k), discAt(k + 1), SPS).border).toBe(false);
  });
  it('a translation by a non-multiple of 4 px on a 1/f texture reports its residual (the stated limit)', () => {
    const s = pictureSample(still, shifted(6, 2), SPS);
    expect(s.border).toBe(false);
    expect(s.inner).toBeGreaterThan(0);
    expect(s.inner).toBeLessThan(MOMENTS_GATES.cutInnerPermille);
    console.log(`[moments.math] residual of a 6x2 px translation (1.5x0.5 box px): inner ${s.inner} permille, pan ${s.pan} permille/s`);
  });
  it('ties go to the smallest shift, then lowest dy, then dx; a flat picture never moves', () => {
    const b = boxImage(flat(100));
    expect(bestShift(b.data, b.data, b.w, b.h)).toMatchObject({ dx: 0, dy: 0, sad: 0 });
    const s = pictureSample(flat(100), flat(140), SPS);
    expect(s.pan).toBe(0);
    expect(s.change).toBe(s.inner);
  });
  it('luma and sharpness: flat grey has no gradient; a blurred texture is less sharp', () => {
    expect(pictureSample(null, flat(77), SPS)).toMatchObject({ luma: 77, sharp: 0, inner: 0, pan: 0, change: 0, border: false });
    expect(pictureSample(null, blur(still), SPS).sharp).toBeLessThan(0.5 * pictureSample(null, still, SPS).sharp);
  });
});

describe('soundLevels', () => {
  it('mean of the bucket peaks per 100 ms, dBFS x 10, floor -1000; bucket b belongs to hop floor(b*256/4800)', () => {
    const buckets = 19 * 3; // 3 hops' worth and a bit; hop 0 = buckets 0..18 (18.75 buckets a hop)
    const p = new Int16Array(buckets * 2);
    for (let b = 0; b < buckets; b++) { const amp = b < 19 ? 3277 : b < 38 ? 0 : 32767; p[2 * b] = -amp; p[2 * b + 1] = amp; }
    const lv = soundLevels(p, buckets * 256);
    expect(lv.length).toBe(Math.ceil((buckets * 256) / 4800));
    expect(lv[0]).toBe(-200); // 0.1 → -20 dBFS
    expect(lv[1]).toBe(-1000); // silence
    expect(lv[2]).toBeGreaterThan(-1); // full scale
    expect(soundLevels(new Int16Array(0), 0)).toEqual([]);
  });
});

describe('robust statistics', () => {
  it('order statistics and z centred on the 20th percentile, clipped to [0, 4]', () => {
    expect(median([5, 1, 3, 2])).toBe(2);
    expect(percentile([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 20)).toBe(2);
    const z = robustZ([0, 0, 0, 0, 0, 0, 0, 0, 100, 1000], 1000);
    expect(z.slice(0, 8)).toEqual(new Array(8).fill(0));
    expect(robustZ([0, 0, 0, 0, 0, 0, 0, 0, 30, 1000], 1000)[8]).toBeCloseTo(3, 9); // (30 - 0) / (1.4826 * 0 + 10)
    expect(Math.max(...z)).toBe(4);
  });
  it('sound hops of a picture sample count the picture start offset', () => {
    expect(hopsOfSample(0, 6, 300, R30, 0)).toEqual([0, 1]);
    expect(hopsOfSample(0, 6, 300, R30, 15)).toEqual([5, 6]);
    expect(frameOfHop(5, R30, 15)).toBe(0);
    expect(frameOfHop(10, R30, 0)).toBe(30);
  });
});

describe('findMoments', () => {
  /** 60 samples (12 s): static, with a moving disc over samples [20, 40) (4 s). */
  const discClip = (from = 20, to = 40, n = 60) => Array.from({ length: n }, (_, k) => (k >= from && k < to ? discAt(k) : still));
  it('finds the moving disc: peak inside, the clean stretch covers it, values measured, basis inner-motion', () => {
    const pic = seriesOf(discClip());
    const r = findMoments(pic, null, asset(60));
    expect(r.flat).toBe(false);
    const w = r.windows[0]!;
    expect(w.peakFrame).toBeGreaterThanOrEqual(20 * S);
    expect(w.peakFrame).toBeLessThan(40 * S);
    expect(w.fromFrame).toBeLessThanOrEqual(20 * S);
    expect(w.toFrame).toBeGreaterThanOrEqual(40 * S);
    expect(w.basis).toEqual(['inner-motion']);
    expect(w.motion!).toBeGreaterThanOrEqual(MOMENTS_GATES.activeMotionPermille);
    expect([w.level, w.burstFrame]).toEqual([null, undefined]);
    expect(r.file.level).toBeNull();
    expect(r.windows.length).toBeLessThanOrEqual(4);
    for (const a of r.windows) for (const b of r.windows) if (a !== b) expect(Math.abs(a.peakFrame - b.peakFrame)).toBeGreaterThanOrEqual(4 * 30);
  });
  it('a static silent file is flat with no windows; a file without sound has no sound file value', () => {
    const r = findMoments(seriesOf(new Array(40).fill(still)), null, asset(40));
    expect(r).toEqual({ flat: true, windows: [], file: { motion: 0, level: null } });
  });
  it('a planted hard cut splits the clean stretch', () => {
    // two shots of equal sharpness: a dark texture, then a bright other one (a hard cut at sample 30); a disc on the first over [10, 25)
    const t2 = texture(99, [16, 8, 4]);
    const darkBg = (x: number, y: number) => 45 + 0.6 * (tex(x, y) - 128), brightBg = (x: number, y: number) => 205 + 0.6 * (t2(x, y) - 128);
    const shotA = frameOf(W, H, darkBg), shotB = frameOf(W, H, brightBg);
    const frames = Array.from({ length: 60 }, (_, k) => (k < 30 ? (k >= 10 && k < 25 ? discFrame(160 + 50 * Math.cos(k * 0.96), 100 + 30 * Math.sin(k * 0.96), 24, darkBg) : shotA) : shotB));
    const pic = seriesOf(frames);
    expect(pic.change[30]!).toBeGreaterThan(MOMENTS_GATES.cutChangePermille);
    expect(pic.gated[30]).toBe(1);
    const w = findMoments(pic, null, asset(60)).windows[0]!;
    expect(w.peakFrame).toBeLessThan(30 * S);
    expect(w.toFrame).toBeLessThanOrEqual(30 * S);
  });
  it('dark, blown and box-blurred stretches are gated and lie in no window', () => {
    const dark = flat(8), blown = flat(250), blurred = blur(still);
    const frames = Array.from({ length: 80 }, (_, k) => (k >= 10 && k < 20 ? dark : k >= 30 && k < 40 ? blown : k >= 50 && k < 60 ? blurred : k >= 62 && k < 78 ? discAt(k) : discAt(k % 3)));
    const pic = seriesOf(frames);
    for (let k = 10; k < 20; k++) expect(pic.gated[k]).toBe(1);
    for (let k = 30; k < 40; k++) expect(pic.gated[k]).toBe(1);
    for (let k = 51; k < 60; k++) expect(pic.gated[k]).toBe(1);
    const r = findMoments(pic, null, asset(80));
    for (const w of r.windows) for (const [a, b] of [[10, 20], [30, 40], [51, 60]]) expect(w.toFrame <= a! * S || w.fromFrame >= b! * S).toBe(true);
  });
  it('a 1200 permille/s whip pan is gated (widened by one sample) and lies in no window', () => {
    // static, a whip pan over samples [20, 26), then a moving disc over [40, 55)
    const frames = Array.from({ length: 70 }, (_, k) => (k >= 20 && k < 26 ? shifted(77 * (k - 19)) : k >= 40 && k < 55 ? discAt(k) : still));
    const pic = seriesOf(frames);
    for (let k = 19; k <= 27; k++) expect(pic.gated[k]).toBe(1);
    const r = findMoments(pic, null, asset(70));
    expect(r.windows.length).toBeGreaterThan(0);
    for (const w of r.windows) expect(w.toFrame <= 19 * S || w.fromFrame >= 28 * S).toBe(true);
  });
  it('a burst is found within one hop; the window says sound; start offset respected', () => {
    for (const off of [0, 15]) {
      const hops = 130, level = new Array(hops).fill(-400);
      const burstHop = 61;
      for (let h = burstHop; h < burstHop + 2; h++) level[h] = -60;
      for (let h = burstHop + 5; h < 100; h += 5) level[h] = -60;
      const sound: SoundSeries = { source: 'waveform-peaks', hopMs: 100, count: hops, level };
      const frames = 360 - off;
      const r = findMoments(null, sound, { frames, rate: R30, startOffsetFrames: off });
      const w = r.windows[0]!;
      expect(w.basis).toEqual(['sound']);
      expect(w.burstFrame).toBeDefined();
      const hopOfBurst = ((w.burstFrame! + off) * 10) / 30;
      expect(Math.abs(hopOfBurst - burstHop)).toBeLessThanOrEqual(1);
      expect(r.file.level).toBe(-400);
      expect(w.level!).toBeGreaterThan(0);
    }
  });
  it('both signals: weight 0.5 each; a quiet picture and loud sound still find the burst', () => {
    const pic = seriesOf(discClip(30, 45, 60));
    const level = new Array(130).fill(-400);
    for (let h = 61; h < 89; h += 3) level[h] = -80;
    const r = findMoments(pic, { source: 'waveform-peaks', hopMs: 100, count: 130, level }, asset(60));
    const w = r.windows[0]!;
    expect(w.basis).toEqual(['inner-motion', 'sound']);
    expect(w.peakFrame).toBeGreaterThanOrEqual(30 * S);
    expect(w.peakFrame).toBeLessThan(45 * S);
  });
  it('is deterministic and returns integer frames inside the file', () => {
    const pic = seriesOf(discClip());
    const a = JSON.stringify(findMoments(pic, null, asset(60))), b = JSON.stringify(findMoments(pic, null, asset(60)));
    expect(a).toBe(b);
    for (const w of findMoments(pic, null, asset(60)).windows) {
      for (const f of [w.peakFrame, w.fromFrame, w.toFrame]) expect(Number.isInteger(f)).toBe(true);
      expect(w.toFrame).toBeLessThanOrEqual(60 * S);
    }
  });
});
