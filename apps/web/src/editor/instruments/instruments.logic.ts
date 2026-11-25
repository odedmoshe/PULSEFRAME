/**
 * Pure logic of «כלים מוקלטים» in the editor (wave 7 instruments track). LEAD: signatures. Builder W3 owns this file and builds the
 * bodies (tests in instruments.logic.test.ts).
 */
import type { MusicKitStatus } from '@pulseframe/core';

/** True once builder W3 has built the interface; flipped at integration. While false, InstrumentsChoice renders nothing. */
export const INSTRUMENTS_UI_BUILT: boolean = false;
/** The kit of a style in the answer of GET /api/v1/music/kits, or null. */
export const kitOfStyle = (kits: readonly MusicKitStatus[], styleId: string): MusicKitStatus | null => kits.find((k) => k.styleId === styleId) ?? null;
/**
 * The blind order of a comparison: which of «א» and «ב» is the recorded version. The page draws it (crypto.getRandomValues) once per
 * comparison; this function only maps a drawn bit, so tests can pin it.
 */
export const auditionOrder = (bit: 0 | 1): { a: 'synth' | 'recorded'; b: 'synth' | 'recorded' } => (bit === 0 ? { a: 'recorded', b: 'synth' } : { a: 'synth', b: 'recorded' });
/** The preview URL of a style with the chosen sound (and the level-match header asked for when `match`). */
export const instrumentsPreviewUrl = (styleId: string, bars: number, seed: number, instruments: 'synth' | 'recorded', match = false): string =>
  `/api/v1/music/${encodeURIComponent(styleId)}/audio?bars=${bars}&seed=${seed}${instruments === 'recorded' ? '&instruments=recorded' : ''}${match ? '&match=1' : ''}`;
/** The volume an <audio> element gets from x-pf-level-scale (a decimal ≤ 1; anything else → 1). */
export function levelScale(header: string | null): number {
  const v = header === null ? Number.NaN : Number(header);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
}
