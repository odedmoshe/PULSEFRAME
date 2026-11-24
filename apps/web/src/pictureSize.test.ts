/**
 * The size and quality the preview composites a frame at (pictureSize.ts; ADR-0005 amendment of 2026-11-24). The rule on its
 * own; that the player's pump draws with it is tested on the real Player in player.multicam.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fitScale } from '@pulseframe/core';
import { pictureSize, PLAYING_SHORT_SIDE } from './pictureSize.ts';

const playing = (width: number, height: number) => pictureSize({ width, height }, { playing: true });
const paused = (width: number, height: number) => pictureSize({ width, height }, { playing: false });
/** The proxy of a source, as apps/server/src/derive.ts makes it: at most 540 lines high, an even width of the same shape. */
const proxyOf = (w: number, h: number) => { const ph = h <= 540 ? Math.max(2, h - (h % 2)) : 540; return { w: Math.max(2, Math.round((w * ph) / h / 2) * 2), h: ph }; };

describe('pictureSize', () => {
  it('paused: the project\'s own size and the full picture, whatever the size', () => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [3840, 2160], [640, 360], [1919, 1079], [1080, 1080]] as const) expect(paused(w, h)).toEqual({ width: w, height: h, scale: 1, quality: 'full' });
  });
  it('playing: the short side of the frame is the height of a proxy (540), draft', () => {
    expect(playing(1920, 1080)).toEqual({ width: 960, height: 540, scale: 0.5, quality: 'draft' });
    expect(playing(3840, 2160)).toEqual({ width: 960, height: 540, scale: 0.25, quality: 'draft' });
    expect(playing(1080, 1920)).toEqual({ width: 540, height: 960, scale: 0.5, quality: 'draft' });
    expect(playing(2160, 3840)).toEqual({ width: 540, height: 960, scale: 0.25, quality: 'draft' });
    expect(playing(1080, 1080)).toMatchObject({ width: 540, height: 540, quality: 'draft' });
    expect(playing(1080, 1350)).toMatchObject({ width: 540, height: 675, quality: 'draft' });
    expect(playing(1280, 720)).toMatchObject({ width: 960, height: 540, quality: 'draft' }); // a 720-line project plays from its proxies too
    expect(playing(720, 1280)).toMatchObject({ width: 540, height: 960, quality: 'draft' });
  });
  it('playing a frame whose short side is at most 540: full size, the full picture (nothing is reduced, so nothing is draft)', () => {
    for (const [w, h] of [[960, 540], [540, 960], [640, 360], [360, 640], [320, 180], [540, 540], [480, 1000]] as const) expect(playing(w, h)).toEqual({ width: w, height: h, scale: 1, quality: 'full' });
  });
  it('the limit is the proxy\'s height limit (apps/server/src/derive.ts)', () => {
    const derive = fs.readFileSync(path.join(import.meta.dirname, '../../server/src/derive.ts'), 'utf8');
    const m = /const proxyHeight = s\.height <= (\d+) \? [^:]+ : (\d+);/.exec(derive);
    expect(m, 'the proxy height rule in derive.ts').not.toBeNull();
    expect([Number(m![1]), Number(m![2])]).toEqual([PLAYING_SHORT_SIDE, PLAYING_SHORT_SIDE]);
  });
  it('in a landscape or square project a picture fitted to the playing frame is exactly its proxy\'s size: drawn pixel for pixel', () => {
    const cases: [project: [number, number], source: [number, number]][] = [
      [[1920, 1080], [1920, 1080]], [[1920, 1080], [3840, 2160]], [[1920, 1080], [1280, 720]], [[1920, 1080], [1440, 1080]], [[3840, 2160], [1920, 1080]],
      [[1280, 720], [1920, 1080]], [[1080, 1080], [1080, 1080]], [[1080, 1080], [1080, 1920]], [[1920, 1080], [1080, 1920]],
    ];
    for (const [[pw, ph], [sw, sh]] of cases) {
      const at = playing(pw, ph), fit = fitScale(at.width, at.height, sw, sh, 'contain'), proxy = proxyOf(sw, sh);
      // contain in such a frame is limited by the height (the source is no wider in shape than the frame, or the frame is its height)
      if (sw / sh <= pw / ph) {
        expect(sh * fit, `${sw}x${sh} in ${pw}x${ph}`).toBeCloseTo(proxy.h, 9);
        expect(Math.abs(sw * fit - proxy.w), `${sw}x${sh} in ${pw}x${ph}`).toBeLessThanOrEqual(1); // the proxy's width is rounded to an even number
      }
    }
    expect(fitScale(960, 540, 1920, 1080, 'contain') * 1920).toBe(960);
  });
  it('the playing picture has the project\'s shape within a pixel (both sides rounded from one scale), also for odd sizes', () => {
    for (const [w, h] of [[1920, 1080], [1919, 1079], [1366, 768], [2048, 858], [721, 1281], [1080, 1350], [4096, 2160], [1000, 3000], [3000, 1000]] as const) {
      const at = playing(w, h);
      expect(Math.min(at.width, at.height), `${w}x${h}`).toBe(PLAYING_SHORT_SIDE);
      expect(Math.abs(at.width - w * at.scale), `${w}x${h}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(at.height - h * at.scale), `${w}x${h}`).toBeLessThanOrEqual(0.5);
      expect(at.scale).toBeCloseTo(PLAYING_SHORT_SIDE / Math.min(w, h), 12);
    }
  });
  it('never more pixels while playing than paused, and never an enlarged picture', () => {
    for (const [w, h] of [[1920, 1080], [320, 180], [540, 960], [541, 541], [8000, 600]] as const) {
      const at = playing(w, h);
      expect(at.scale).toBeLessThanOrEqual(1);
      expect(at.width).toBeLessThanOrEqual(w);
      expect(at.height).toBeLessThanOrEqual(h);
    }
  });
  it('an angle viewer is always draft, at most its height limit, playing or not; the playing limit does not apply to it', () => {
    for (const p of [true, false]) {
      expect(pictureSize({ width: 1920, height: 1080 }, { playing: p, draftMaxHeight: 270 })).toEqual({ width: 480, height: 270, scale: 0.25, quality: 'draft' });
      expect(pictureSize({ width: 320, height: 180 }, { playing: p, draftMaxHeight: 400 })).toEqual({ width: 320, height: 180, scale: 1, quality: 'draft' }); // smaller than the limit: not enlarged, still draft
      expect(pictureSize({ width: 1080, height: 1920 }, { playing: p, draftMaxHeight: 360 })).toMatchObject({ width: 203, height: 360, quality: 'draft' });
      expect(pictureSize({ width: 3840, height: 2160 }, { playing: p, draftMaxHeight: 1080 })).toMatchObject({ width: 1920, height: 1080, quality: 'draft' });
    }
  });
  it('no document yet (0×0): full, no size, no NaN', () => {
    expect(playing(0, 0)).toEqual({ width: 0, height: 0, scale: 1, quality: 'full' });
    expect(paused(0, 0)).toEqual({ width: 0, height: 0, scale: 1, quality: 'full' });
  });
});
