/**
 * Clip loudness match (wave 7, track send): the plan of new clip gains from measured loudness. Lead-built and complete (the op
 * match_clip_loudness in sendOps.ts calls it, so REST, MCP and the editor cannot disagree). Pure; no Date, no Intl.
 *
 * Because a clip's gain is linear and applied after its effects (engine audio.ts), changing it by d dB moves the clip's
 * integrated loudness and its peak by d dB, so re-measuring returns the target unless the peak or the gain range stopped it.
 */
import type { ProjectDocument } from './schema.ts';
import { LOUDNESS_MATCH, type MatchClipInput, type MatchClipOutput } from './sendContract.ts';

const round = (x: number, step: number) => Math.round(x / step) * step;
const r4 = (x: number) => Number(round(x, 1e-4).toFixed(4));
const r2 = (x: number) => Number(x.toFixed(2));

/** The ceiling a matched clip's peak must respect, and the headroom over it (send-decisions C15, open question "6 dB"). */
export function matchCeiling(doc: Pick<ProjectDocument, 'settings'>): { ceilingDb: number; headroomDb: number } {
  const lim = doc.settings.limiter;
  return { ceilingDb: lim?.ceiling ?? doc.settings.loudness?.truePeak ?? 0, headroomDb: lim ? LOUDNESS_MATCH.limiterHeadroomDb : 0 };
}

/**
 * New gain of one clip: wantDb = target − measured; roomDb = ceiling + headroom − peak; dB = min(want, room); new gain =
 * gain·10^(dB/20) rounded to 1e-4, capped at the gain range (0, 8]. `limitedBy` says what stopped it short of the target.
 */
export function planMatchGain(clip: MatchClipInput, target: number, ceiling: { ceilingDb: number; headroomDb: number }): MatchClipOutput {
  const wantDb = target - clip.measuredLufs;
  const roomDb = ceiling.ceilingDb + ceiling.headroomDb - clip.peakDbfs;
  let limitedBy: MatchClipOutput['limitedBy'] = roomDb < wantDb ? 'peak' : null;
  const db = Math.min(wantDb, roomDb);
  let to = r4(clip.gain * 10 ** (db / 20));
  if (to > LOUDNESS_MATCH.maxGain) { to = LOUDNESS_MATCH.maxGain; limitedBy = 'range'; }
  if (to < 1e-4) { to = 1e-4; limitedBy = 'range'; }
  return { clipId: clip.clipId, from: clip.gain, to, changeDb: r2(20 * Math.log10(to / clip.gain)), limitedBy };
}

/** Median of measured loudness values (the default target: it changes the selection least); null for none. */
export function medianLufs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return r2(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
}
