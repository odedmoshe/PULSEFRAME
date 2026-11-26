/**
 * The sound of a video clip drawn inside the clip, under its filmstrip (wave 8D P5 d): when and how tall. Drawn from the waveform
 * peaks the server made at import (the same derivative a sound clip draws; no new decode).
 */
import type { Asset } from '@pulseframe/core';

/** The lane height from which a video clip has room for its sound under the pictures (CSS px). */
export const MIN_LANE_PX = 56;

/**
 * Whether a clip shows its own sound: a media clip on a video track whose file is a video with sound, in a lane at least
 * MIN_LANE_PX tall; a freeze frame is silent, so it shows none.
 */
export function showsOwnSound(o: { trackKind: string; clipType: string; asset: Asset | undefined; laneHeight: number; freeze: boolean; missing: boolean }): boolean {
  return o.trackKind === 'video' && o.clipType === 'media' && !o.freeze && !o.missing && !!o.asset && o.asset.kind === 'video' && !!o.asset.audio && o.laneHeight >= MIN_LANE_PX;
}

/** The band of the clip the sound takes: the lower part, about a third of the clip and at least 14 px, leaving the pictures at least half. */
export function soundBand(clipHeight: number): { height: number; top: number } {
  const h = Math.max(14, Math.min(Math.round(clipHeight * 0.34), Math.floor(clipHeight / 2)));
  return { height: h, top: clipHeight - h };
}
