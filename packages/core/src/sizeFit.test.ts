/**
 * Size-fit plan (wave 7 send, C4): the accepted targets are exactly [minBytes, ∞) — minBytes passes and minBytes − 1 does not,
 * over random films — the plan never goes above the asked scale, it lowers the sound before it shrinks the picture, and the
 * figures of the decisions' worked example hold.
 */
import { describe, expect, it } from 'vitest';
import { planSizeFit, retryBitrate, sideAtScale, sizeFitMinBytes, SEND_FIT, type SizeFitInput, type SizeFitPlan, type SizeFitScale } from './index.ts';

/** A small deterministic generator (no Math.random: a failing case must replay). */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
const RATES = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }, { num: 24000, den: 1001 }, { num: 50, den: 1 }];
const SCALES: SizeFitScale[] = [1, 0.5, 0.25];
const film = (r: () => number): Omit<SizeFitInput, 'targetBytes'> => ({
  frames: 1 + Math.floor(r() ** 3 * 200_000),
  rate: RATES[Math.floor(r() * RATES.length)]!,
  width: 16 + Math.floor(r() * 8176), height: 16 + Math.floor(r() * 8176),
  sampleRate: [44100, 48000, 96000][Math.floor(r() * 3)]!,
  maxScale: SCALES[Math.floor(r() * 3)]!,
});
const ok = (p: ReturnType<typeof planSizeFit>): SizeFitPlan => { if (!p.ok) throw new Error(`refused, minBytes ${p.minBytes}`); return p; };

describe('size-fit plan (core, integers)', () => {
  it('B: planSizeFit accepts every target ≥ sizeFitMinBytes and refuses minBytes − 1 (random durations, rates, sizes)', () => {
    const r = rng(7);
    for (let i = 0; i < 400; i++) {
      const f = film(r);
      const min = sizeFitMinBytes(f);
      expect(planSizeFit({ ...f, targetBytes: min }).ok, JSON.stringify(f)).toBe(true);
      const below = planSizeFit({ ...f, targetBytes: min - 1 });
      expect(below, JSON.stringify(f)).toEqual({ ok: false, code: 'size_fit_too_small', minBytes: min });
      // every larger target is accepted too (monotone: a few random points above the minimum)
      for (let k = 0; k < 5; k++) expect(planSizeFit({ ...f, targetBytes: min + Math.floor(r() * min * 3) }).ok).toBe(true);
    }
  });
  it('B: the chosen video rate meets the 3/100 floor exactly (checked again with BigInt here) and the planned streams fit the target', () => {
    const r = rng(11);
    for (let i = 0; i < 300; i++) {
      const f = film(r), target = sizeFitMinBytes(f) + Math.floor(r() * 50_000_000);
      const p = planSizeFit({ ...f, targetBytes: target });
      if (!p.ok) continue;
      const { num, den } = f.rate;
      expect(BigInt(p.videoBitrate) * BigInt(den) * 100n >= 3n * BigInt(p.width) * BigInt(p.height) * BigInt(num)).toBe(true);
      // planned bytes: (v + a)·seconds/8 + O ≤ target (the 97/100 share leaves the rest unclaimed)
      const planned = ((BigInt(p.videoBitrate) + BigInt(p.audioBitrate)) * BigInt(f.frames) * BigInt(den)) / (8n * BigInt(num)) + BigInt(p.overheadBytes);
      expect(planned <= BigInt(target)).toBe(true);
      expect(Number.isInteger(p.videoBitrate) && Number.isInteger(p.overheadBytes)).toBe(true);
    }
  });
  it('B: planSizeFit never picks a scale above maxScale and prefers a lower audio rate before a smaller picture', () => {
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const f = film(r), target = sizeFitMinBytes(f) + Math.floor(r() * 80_000_000);
      const p = planSizeFit({ ...f, targetBytes: target });
      if (!p.ok) continue;
      expect(p.scale).toBeLessThanOrEqual(f.maxScale);
      // a plan capped at a larger scale than the chosen one never lands on a scale between them (larger ones all missed the floor)
      if (p.scale < f.maxScale) for (const s of SEND_FIT.scales) if (s > p.scale && s <= f.maxScale) expect(ok(planSizeFit({ ...f, maxScale: s, targetBytes: target })).scale).toBe(p.scale);
    }
    // one hand case: a target where 96 kb/s misses the floor at full size but 48 kb/s meets it keeps the full picture
    const f = { frames: 30 * 60, rate: { num: 30, den: 1 }, width: 320, height: 180, sampleRate: 48000, maxScale: 1 as const };
    let picked: SizeFitPlan | null = null;
    for (let t = 1_000_000; t < 5_000_000 && !picked; t += 1000) { const p = planSizeFit({ ...f, targetBytes: t }); if (p.ok && p.scale === 1 && p.audioBitrate < 96_000) picked = p; }
    expect(picked?.scale).toBe(1);
  });
  it('the decisions example: 4 min of 1080p30 keeps 1920×1080 at 64 MB and gives 480×270 at 16 MB', () => {
    const f = { frames: 4 * 60 * 30, rate: { num: 30, den: 1 }, width: 1920, height: 1080, sampleRate: 48000, maxScale: 1 as const };
    expect(ok(planSizeFit({ ...f, targetBytes: 64_000_000 }))).toMatchObject({ scale: 1, width: 1920, height: 1080 });
    expect(ok(planSizeFit({ ...f, targetBytes: 16_000_000 }))).toMatchObject({ scale: 0.25, width: 480, height: 270 });
  });
  // S6 as written (F1 at 600,000 → half size) cannot be met: 600,000 is under the schema floor of 1,000,000 and F1 keeps full
  // size down to about 413,000 bytes. The half-size case is 12 s of a 1280×720 project at 1,000,000 bytes (→ 640×360).
  it('the proof fixtures: F1 (12 s 640×360 30 fps) keeps full size at 1,500,000 and even at 600,000; 12 s of 1280×720 at 1,000,000 goes to half; a 20-minute film refuses 1,000,000', () => {
    const f1 = { frames: 360, rate: { num: 30, den: 1 }, width: 640, height: 360, sampleRate: 48000, maxScale: 1 as const };
    expect(ok(planSizeFit({ ...f1, targetBytes: 1_500_000 }))).toMatchObject({ scale: 1, width: 640, height: 360, audioBitrate: 96_000 });
    expect(ok(planSizeFit({ ...f1, targetBytes: 600_000 }))).toMatchObject({ scale: 1 });
    expect(ok(planSizeFit({ ...f1, width: 1280, height: 720, targetBytes: 1_000_000 }))).toMatchObject({ scale: 0.5, width: 640, height: 360 });
    const long = { frames: 20 * 60 * 30, rate: { num: 30, den: 1 }, width: 640, height: 360, sampleRate: 48000, maxScale: 1 as const };
    const r = planSizeFit({ ...long, targetBytes: 1_000_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.minBytes).toBeGreaterThan(1_000_000);
  });
  it('sides at a scale are rounded exactly as the export rounds them (max(2, round(n·s/2)·2))', () => {
    for (let n = 1; n <= 9000; n += 7) for (const s of SCALES) expect(sideAtScale(n, s)).toBe(Math.max(2, Math.round((n * s) / 2) * 2));
  });
  it('retryBitrate is ⌊v·target·97/(got·100)⌋ and refuses non-integers', () => {
    expect(retryBitrate(1_000_000, 1_500_000, 1_600_000)).toBe(Math.floor((1_000_000 * 1_500_000 * 97) / (1_600_000 * 100)));
    expect(retryBitrate(4_000_000_000, 4_000_000_000, 4_000_000_001)).toBe(3_879_999_999); // exact past 2^53 in the product
    expect(() => retryBitrate(1.5, 1, 1)).toThrow();
    expect(() => planSizeFit({ frames: 0, rate: { num: 30, den: 1 }, width: 2, height: 2, sampleRate: 48000, maxScale: 1, targetBytes: 1_000_000 })).toThrow();
  });
});
