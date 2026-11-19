/**
 * Timing of a transition (ADR-0012): its eased progress, where its decisive moment falls, the velocity ramp's frame offsets
 * and the light envelope of a light transition. Pure functions of whole frames: nothing here is stored, and preview,
 * stills and export get the same numbers from the one evaluator (ADR-0005). Times stay exact integers of frames; the
 * floats are render quantities only (ADR-0003).
 *
 * Frame l of a transition of n frames is the clip's frame l (0 … n−1, counted from the transition's first frame).
 */
import * as T from '@pulseframe/time';
import { followedBeats } from './beatgrid.ts';
import type { MediaClip, ProjectDocument } from './schema.ts';

/** The ease of every transition (moved verbatim from engine evaluate.ts). */
export const smooth = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/**
 * Frame k (1 … n−1, counted from the transition's first frame) of the followed beat nearest the middle of the window (the
 * earlier one on a tie); null when the transition is not locked to the beat, is shorter than 3 frames, or no beat falls there.
 */
export function beatSwitchFrame(doc: ProjectDocument, clip: MediaClip, sequenceId = doc.mainSequenceId): number | null {
  const tr = clip.transition;
  if (!tr || tr.sync !== 'beat' || tr.frames < 3) return null;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, n = tr.frames, s = T.frameIndexAt(clip.start, rate);
  let best: number | null = null;
  for (const h of followedBeats(doc, s / fps, (s + n) / fps, sequenceId)) {
    const k = Math.ceil(h.t * fps - 1e-6) - s; // the first frame that shows the hit (as the strobe schedule places it)
    if (k < 1 || k > n - 1) continue;
    if (best === null || Math.abs(k - n / 2) < Math.abs(best - n / 2)) best = k;
  }
  return best;
}

/**
 * Eased progress on transition frame l (0 … n−1). k = null gives exactly the value every transition had before ADR-0012;
 * with a switch frame k it is strictly increasing, inside (0, 1), below 0.5 before k and at or above 0.5 from k on.
 */
export function transitionProgress(l: number, n: number, k: number | null): number {
  if (k === null) return smooth((l + 1) / (n + 1));
  return l < k ? 0.5 * smooth((l + 1) / (k + 1)) : 0.5 + 0.5 * smooth((l - k + 1) / (n - k + 1));
}

/** The first frame whose progress is at least 0.5: where hard-switch kernels cut and where a light peaks. */
export const switchFrame = (n: number, k: number | null): number => k ?? Math.ceil((n - 1) / 2);

/**
 * Velocity ramp: on frame l the outgoing picture shows its frame (l + out) past its end, and the incoming picture its frame
 * (l − in), counted from its sourceIn. Whole frames: the picture is remapped, the sound is not.
 */
export function velocityOffsets(n: number, v: number, l: number): { out: number; in: number } {
  return { out: Math.floor(((v - 1) * l * (l + 1)) / (2 * n)), in: Math.floor(((v - 1) * (n - 1 - l) * (n - l)) / (2 * n)) };
}

/** Source a velocity ramp reads: frames after the previous clip's end (instead of n) and frames before the incoming clip's sourceIn. */
export const velocityNeeds = (n: number, v: number) => ({ outFrames: n + Math.floor(((v - 1) * (n - 1)) / 2), headFrames: Math.floor(((v - 1) * (n - 1)) / 2) });

/** Longest light of a light transition, in seconds (ADR-0012, under ADR-0009 decision 5). */
export const LIGHT_SECONDS = 0.4;

/** Light of a light transition on frame l: one sin² rise and fall lasting min(0.4 s, n frames), equal to 1 on the switch frame. */
export function lightEnvelope(n: number, fps: number, sw: number, l: number): number {
  const D = Math.min(LIGHT_SECONDS * fps, n), u = (l - sw) / D + 0.5;
  if (!(u > 0 && u < 1)) return 0;
  const s = Math.sin(Math.PI * u);
  return s * s;
}

/** The first frame whose light is above 0 (the flash start a light transition asks the schedule for), or null when none is. */
export function lightStartFrame(n: number, fps: number, sw: number): number | null {
  for (let l = 0; l < n; l++) if (lightEnvelope(n, fps, sw, l) > 0) return l;
  return null;
}
