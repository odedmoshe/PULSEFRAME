import { describe, expect, it } from 'vitest';
import type { Asset } from '@pulseframe/core';
import { MIN_LANE_PX, showsOwnSound, soundBand } from './clipWave.logic.ts';

const video = (audio: boolean) => ({ kind: 'video', video: {}, ...(audio ? { audio: { sampleRate: 48000, channels: 2, codec: 'aac' } } : {}) }) as unknown as Asset;
const base = { trackKind: 'video', clipType: 'media', asset: video(true), laneHeight: 64, freeze: false, missing: false };

describe('showsOwnSound', () => {
  it('a video clip whose file has sound, in a lane of 56 px or more', () => {
    expect(MIN_LANE_PX).toBe(56);
    expect(showsOwnSound(base)).toBe(true);
    expect(showsOwnSound({ ...base, laneHeight: 56 })).toBe(true);
    expect(showsOwnSound({ ...base, laneHeight: 55 })).toBe(false);
  });
  it('never for a silent file, a picture, a sound track, a freeze frame or a missing file', () => {
    expect(showsOwnSound({ ...base, asset: video(false) })).toBe(false);
    expect(showsOwnSound({ ...base, asset: { kind: 'image' } as unknown as Asset })).toBe(false);
    expect(showsOwnSound({ ...base, trackKind: 'audio' })).toBe(false);
    expect(showsOwnSound({ ...base, freeze: true })).toBe(false);
    expect(showsOwnSound({ ...base, missing: true })).toBe(false);
    expect(showsOwnSound({ ...base, asset: undefined })).toBe(false);
  });
});

describe('soundBand', () => {
  it('the lower third of the clip, at least 14 px, never more than half; it ends at the clip bottom', () => {
    for (const h of [50, 58, 80, 120]) {
      const b = soundBand(h);
      expect(b.top + b.height).toBe(h);
      expect(b.height).toBeGreaterThanOrEqual(14);
      expect(b.height).toBeLessThanOrEqual(h / 2);
    }
    expect(soundBand(58).height).toBe(20);
  });
});
