/**
 * Time effects on the shared evaluator (ADR-0011): which earlier (or sub-frame) pictures a time effect reads, with which
 * integer weights, and their exact integer merge; the shown frame of time.stutter; planned beat steps; and how many video
 * decoders a timeline needs at most.
 *
 * Everything here is a pure function of its arguments (the beat-step list is cached per document object, like the flash
 * schedule), so a frame drawn on its own equals the same frame drawn in sequence (SPEC §8).
 *
 * Times: the offsets are exact rationals built from the frame rate (ADR-0003); the windows they come from are whole frames
 * (delay, lag, hold) or whole degrees (angle). Floats appear only as render quantities (weights before rounding).
 */
import * as T from '@pulseframe/time';
import { followedBeats, isTimeEffect, TAP_WEIGHT_TOTAL, temporalOf, type Clip, type ProjectDocument, type Track } from '@pulseframe/core';
import { thinnedHits } from './gpu.ts';
import { flashGapFrames } from './strobeSchedule.ts'; // the flash schedule's spacing (core flashSafety.ts, re-exported there)

type Params = Record<string, number | string | boolean>;
/** Scratch slot (look.ts scratch) in which drawGraph places one tap at a time. Slots 0–7 are taken (look.ts, compositor2d.ts). */
export const TAP_PLACE_SLOT = 8;

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
/** A whole-number parameter, rounded and kept inside its declared range (the schema already holds it there; this only guards the arithmetic). */
const whole = (v: unknown, fallback: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(num(v, fallback))));
const end = (c: Clip) => T.add(c.start, c.duration);
/** The first frame that starts at or after a time (the frame a clip starting there is first drawn on). */
const firstFrameAt = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };

/** Offsets from the frame time of the pictures a 'taps' time effect reads, newest first (shutter: sub-frame samples in time order). Exact rationals. */
export function tapOffsets(type: string, params: Params, rate: T.Rate): T.RationalTime[] {
  switch (type) {
    case 'time.echo': {
      const count = whole(params.count, 4, 2, 5), delay = whole(params.delay, 3, 1, 15);
      return Array.from({ length: count }, (_, k) => T.frameTime(-k * delay, rate));
    }
    case 'time.split': {
      const lag = whole(params.lag, 4, 1, 15);
      return [0, 1, 2].map((k) => T.frameTime(-k * lag, rate));
    }
    case 'time.shutter': {
      // S samples spread over angle/360 of a frame (f = den/num seconds):
      //   centred   δ_j = (2j+1−S)·angle·den / (720·S·num)   (symmetric about the frame time, so the offsets sum to 0)
      //   trailing  δ_j = −(2j+1)·angle·den / (720·S·num)     (all before the frame time), listed oldest first
      const S = whole(params.samples, 8, 2, 16), angle = whole(params.angle, 180, 0, 720);
      const den = 720 * S * rate.num;
      const centred = params.timing !== 'trailing';
      return Array.from({ length: S }, (_, j) => T.rt(centred ? (2 * j + 1 - S) * angle * rate.den : -(2 * (S - 1 - j) + 1) * angle * rate.den, den));
    }
    default: return [T.ZERO];
  }
}

/** Whole numbers proportional to `raw` that add up to `total`: largest remainder, ties to the lower index. */
function apportion(raw: readonly number[], total: number): number[] {
  const sum = raw.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return raw.map((_, i) => (i === 0 ? total : 0));
  const exact = raw.map((v) => (v / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, v) => s + v, 0);
  const order = exact.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k]!.i]!++;
  return out;
}

/** Integer weights for n pictures summing to TAP_WEIGHT_TOTAL (blend/trail/lighten/shutter) or all 0 (split). Largest remainder, ties to the lower index. */
export function tapWeights(type: string, params: Params, n: number): number[] {
  if (n <= 0) return [];
  if (type === 'time.split') return Array(n).fill(0);
  if (type === 'time.echo') { const decay = num(params.decay, 0.6); return apportion(Array.from({ length: n }, (_, k) => decay ** k), TAP_WEIGHT_TOTAL); }
  return apportion(Array(n).fill(1), TAP_WEIGHT_TOTAL); // shutter (and anything else): equal
}

/** True when `c` is a cut piece that may join a run with an effect of id `effectId`. */
const carries = (c: Clip, effectId: string) => c.type !== 'caption' && !!c.effects?.some((e) => e.id === effectId);
/** The piece that ends exactly where `clip` starts on `track` and carries the same effect, if any (the adjacency rule of a cut). */
const pieceBefore = (track: Track, clip: Clip, effectId: string): Clip | null => {
  for (const c of track.clips) if (c !== clip && c.id !== clip.id && T.eq(end(c), clip.start) && T.lt(c.start, clip.start) && carries(c, effectId)) return c;
  return null;
};

/** The clip shown at `at` by the run of cut pieces that ends with `clip` on `track` (pieces end exactly where the next begins and carry an effect with id `effectId`); null when `at` is before the run. */
export function pieceAt(track: Track, clip: Clip, effectId: string, at: T.RationalTime): Clip | null {
  // each step goes to a piece that starts strictly earlier, so the walk ends
  for (let cur: Clip | null = clip; cur; cur = pieceBefore(track, cur, effectId)) if (!T.lt(at, cur.start)) return cur;
  return null;
}

/** Start of the run of cut pieces that ends with `clip`. */
export function runStart(track: Track, clip: Clip, effectId: string): T.RationalTime {
  let cur = clip;
  for (let prev = pieceBefore(track, cur, effectId); prev; prev = pieceBefore(track, cur, effectId)) cur = prev;
  return cur.start;
}

export interface TapMerger { add(index: number, rgba: Uint8ClampedArray): void; finish(out: Uint8ClampedArray): void }

/** `(c·a + 127) div 255`: a straight-alpha channel value premultiplied by its alpha, rounded. */
const premultiply = (c: number, a: number) => (a === 255 ? c : a === 0 ? 0 : ((c * a + 127) / 255) | 0);
/** `a ? min(255, (q·255 + (a >> 1)) div a) : 0`: back to straight alpha. */
const unpremultiply = (q: number, a: number) => (a === 255 ? Math.min(255, q) : a === 0 ? 0 : Math.min(255, ((q * 255 + (a >> 1)) / a) | 0));

/**
 * Exact integer merge of straight-alpha RGBA8 pictures, added one at a time (ADR-0011 formulas). Memory is one
 * Uint32Array of 4·pixels plus, for `trail`, one RGBA copy of the newest picture.
 *
 *   P = (c·a + 127) div 255 on every channel (premultiplied; alpha itself unchanged)
 *   blend, shutter   Q = (Σ W_k·P_k + 2048) >> 12, all four channels, ΣW = 4096
 *   trail            B = (Σ_{k≥1} V_k·P_k + 2048) >> 12 with ΣV = round(4096·decay), V ∝ decay^k;  Q = P_0 + ((255 − a_0)·B + 127) div 255
 *   lighten          Q = max_k ((G_k·P_k + 2048) >> 12), G_k = round(4096·decay^k), per channel
 *   split            red-now (P_0.r, P_1.g, P_2.b, max a), blue-now (P_2.r, P_1.g, P_0.b, max a)
 *   out              c = a ? min(255, (Q·255 + (a >> 1)) div a) : 0
 * Opaque pixels are exact; identical pictures give the picture back.
 */
export function tapMerger(type: string, params: Params, weights: readonly number[], pixels: number): TapMerger {
  const len = 4 * pixels;
  const acc = new Uint32Array(len);
  const check = (rgba: Uint8ClampedArray) => { if (rgba.length !== len) throw new RangeError(`tap picture has ${rgba.length / 4} pixels, expected ${pixels}`); };
  const decay = num(params.decay, 0.6);
  const mode = type === 'time.split' ? 'split' : type === 'time.echo' && (params.mode === 'trail' || params.mode === 'lighten') ? params.mode : 'blend';

  if (mode === 'split') {
    const blueNow = params.order === 'blue-now';
    return {
      add(index, rgba) {
        check(rgba);
        if (index < 0 || index > 2) return;
        const ch = blueNow ? 2 - index : index; // the channel this picture supplies
        for (let i = 0; i < len; i += 4) {
          const a = rgba[i + 3]!;
          acc[i + ch] = premultiply(rgba[i + ch]!, a);
          if (a > acc[i + 3]!) acc[i + 3] = a;
        }
      },
      finish(out) {
        for (let i = 0; i < len; i += 4) {
          const a = acc[i + 3]!;
          out[i] = unpremultiply(acc[i]!, a); out[i + 1] = unpremultiply(acc[i + 1]!, a); out[i + 2] = unpremultiply(acc[i + 2]!, a); out[i + 3] = a;
        }
      },
    };
  }

  if (mode === 'lighten') {
    const gain = weights.map((_, k) => Math.round(TAP_WEIGHT_TOTAL * decay ** k));
    return {
      add(index, rgba) {
        check(rgba);
        const G = gain[index] ?? 0;
        for (let i = 0; i < len; i += 4) {
          const a = rgba[i + 3]!;
          for (let c = 0; c < 3; c++) { const q = (G * premultiply(rgba[i + c]!, a) + 2048) >> 12; if (q > acc[i + c]!) acc[i + c] = q; }
          const qa = (G * a + 2048) >> 12;
          if (qa > acc[i + 3]!) acc[i + 3] = qa;
        }
      },
      finish(out) {
        for (let i = 0; i < len; i += 4) {
          const a = Math.min(255, acc[i + 3]!);
          out[i] = unpremultiply(acc[i]!, a); out[i + 1] = unpremultiply(acc[i + 1]!, a); out[i + 2] = unpremultiply(acc[i + 2]!, a); out[i + 3] = a;
        }
      },
    };
  }

  if (mode === 'trail') {
    // the weights of the older pictures: proportional to decay^k, adding up to the strength of the past, round(4096·decay)
    const past = apportion(weights.slice(1).map((_, j) => decay ** (j + 1)), Math.round(TAP_WEIGHT_TOTAL * decay));
    const newest = new Uint8ClampedArray(len); // P_0, premultiplied
    return {
      add(index, rgba) {
        check(rgba);
        if (index === 0) {
          for (let i = 0; i < len; i += 4) { const a = rgba[i + 3]!; newest[i] = premultiply(rgba[i]!, a); newest[i + 1] = premultiply(rgba[i + 1]!, a); newest[i + 2] = premultiply(rgba[i + 2]!, a); newest[i + 3] = a; }
          return;
        }
        const V = past[index - 1] ?? 0;
        if (!V) return;
        for (let i = 0; i < len; i += 4) {
          const a = rgba[i + 3]!;
          acc[i] = acc[i]! + V * premultiply(rgba[i]!, a); acc[i + 1] = acc[i + 1]! + V * premultiply(rgba[i + 1]!, a); acc[i + 2] = acc[i + 2]! + V * premultiply(rgba[i + 2]!, a); acc[i + 3] = acc[i + 3]! + V * a;
        }
      },
      finish(out) {
        for (let i = 0; i < len; i += 4) {
          const a0 = newest[i + 3]!, k = 255 - a0;
          const a = a0 + ((k * ((acc[i + 3]! + 2048) >> 12) + 127) / 255 | 0);
          for (let c = 0; c < 3; c++) out[i + c] = unpremultiply(newest[i + c]! + ((k * ((acc[i + c]! + 2048) >> 12) + 127) / 255 | 0), a);
          out[i + 3] = a;
        }
      },
    };
  }

  // blend (echo) and shutter: a weighted average of premultiplied pictures
  return {
    add(index, rgba) {
      check(rgba);
      const W = weights[index] ?? 0;
      if (!W) return;
      for (let i = 0; i < len; i += 4) {
        const a = rgba[i + 3]!;
        if (a === 0) continue;
        acc[i] = acc[i]! + W * premultiply(rgba[i]!, a); acc[i + 1] = acc[i + 1]! + W * premultiply(rgba[i + 1]!, a); acc[i + 2] = acc[i + 2]! + W * premultiply(rgba[i + 2]!, a); acc[i + 3] = acc[i + 3]! + W * a;
      }
    },
    finish(out) {
      for (let i = 0; i < len; i += 4) {
        const a = (acc[i + 3]! + 2048) >> 12;
        out[i] = unpremultiply((acc[i]! + 2048) >> 12, a); out[i + 1] = unpremultiply((acc[i + 1]! + 2048) >> 12, a); out[i + 2] = unpremultiply((acc[i + 2]! + 2048) >> 12, a); out[i + 3] = a;
      }
    },
  };
}

/** The furthest a stutter that follows the music holds a beat's picture before it steps on steadily again. */
const BEAT_HOLD_FRAMES = 60;
/** Index of the last element of an ascending list that is ≤ x, or -1. */
const lastAtOrBefore = (list: Float64Array, x: number) => { let lo = 0, hi = list.length - 1, at = -1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (list[mid]! <= x) { at = mid; lo = mid + 1; } else hi = mid - 1; } return at; };

/**
 * Timeline frame whose picture time.stutter shows on frame `frame` (steady steps, planned beat steps or freeze).
 *   steady   Fh = max(c0, F − F mod hold): anchored to the timeline, so a cut does not move the steps
 *   music, steps    the latest planned beat frame b with c0 ≤ b ≤ F and F − b ≤ 60; otherwise steady
 *   music, freeze   b when F − b < hold, else F
 * c0 is the first frame of the run of cut pieces. Without analysed music (no planned beats) the steady steps apply;
 * `freeze` without the music has no beats to stop on and steps steadily too.
 */
export function stutterFrame(doc: ProjectDocument, sequenceId: string, track: Track, clip: Clip, effectId: string, params: Params, frame: number): number {
  const rate = doc.settings.frameRate;
  const hold = whole(params.hold, 3, 2, 12);
  const c0 = firstFrameAt(runStart(track, clip, effectId), rate);
  const steady = Math.max(c0, frame - (((frame % hold) + hold) % hold));
  if (params.follow !== 'music') return steady;
  const beats = beatStepFrames(doc, sequenceId, whole(params.every, 1, 1, 16));
  const at = lastAtOrBefore(beats, frame);
  const b = at >= 0 && beats[at]! >= c0 ? beats[at]! : null;
  if (b === null || beats.length === 0) return params.pattern === 'freeze' && beats.length ? frame : steady;
  if (params.pattern === 'freeze') return frame - b < hold ? b : frame;
  return frame - b <= BEAT_HOLD_FRAMES ? b : steady;
}

const beatSteps = new WeakMap<ProjectDocument, Map<string, Float64Array>>();
/**
 * Planned beat frames for effects that change the picture on beats: thinned like the strobe's and at least flashGapFrames apart. Cached per document and sequence.
 * The beats followed on the timeline (core followedBeats) whose running number is a multiple of `every`, thinned regularly
 * for fast music (gpu.ts thinnedHits), each moved to the first frame that shows it (ceil(t·fps − 1e−6), as the flash
 * schedule does), and kept only when the last kept one is at least flashGapFrames earlier: never more than three a second.
 */
export function beatStepFrames(doc: ProjectDocument, sequenceId: string, every: number): Float64Array {
  let bySeq = beatSteps.get(doc);
  if (!bySeq) beatSteps.set(doc, (bySeq = new Map()));
  const step = Math.max(1, Math.round(num(every, 1)));
  const key = `${sequenceId}\n${step}`;
  const had = bySeq.get(key);
  if (had) return had;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seq = doc.sequences[sequenceId];
  let last = 0;
  for (const tr of seq?.tracks ?? []) for (const c of tr.clips) last = Math.max(last, T.toSeconds(end(c)));
  const kept: number[] = [];
  if (seq) {
    let prev = -Infinity;
    for (const t of thinnedHits(followedBeats(doc, 0, last, sequenceId), step, gap / fps)) {
      const frame = Math.ceil(t * fps - 1e-6);
      if (frame - prev >= gap) { kept.push(frame); prev = frame; }
    }
  }
  const out = Float64Array.from(kept);
  bySeq.set(key, out);
  return out;
}

/**
 * Video decoders one clip needs on each frame it is drawn: its own picture, and for a time effect whose taps decode
 * (echo, split) one more per extra picture. Images and titles need none.
 */
function clipDecoders(doc: ProjectDocument, clip: Clip): number {
  if (clip.type !== 'media') return 0;
  const asset = doc.assets[clip.assetId];
  if (!asset || asset.kind === 'image' || !asset.video) return 0;
  const first = clip.effects?.find((e) => e.enabled);
  if (!first || !isTimeEffect(first.type)) return 1;
  const temporal = temporalOf(first.type);
  if (!temporal || temporal.kind !== 'taps' || !temporal.decodes) return 1;
  return tapOffsets(first.type, first.params, doc.settings.frameRate).length;
}

/**
 * The upper bound of video decoders per frame (see maxDecodeLanes) as steps: [frame, lanes] in frame order, each value
 * holding until the next step's frame (the last step is 0).
 */
export function decodeLaneSteps(doc: ProjectDocument, sequenceId = doc.mainSequenceId): [number, number][] {
  const seq = doc.sequences[sequenceId];
  if (!seq) return [];
  const rate = doc.settings.frameRate;
  const events = new Map<number, number>();
  const span = (from: number, to: number, n: number) => { if (n <= 0 || to <= from) return; events.set(from, (events.get(from) ?? 0) + n); events.set(to, (events.get(to) ?? 0) - n); };
  for (const track of seq.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.type !== 'media') continue;
      const first = firstFrameAt(clip.start, rate), last = firstFrameAt(end(clip), rate);
      span(first, last, clipDecoders(doc, clip));
      // the previous clip plays on from its handle under a transition at this clip's start (evaluate.ts), with its own taps
      if (clip.transition) {
        const prev = track.clips.find((c) => c.type === 'media' && c.id !== clip.id && T.eq(end(c), clip.start));
        // frames of the transition: clip-local frame indices 0 … frames−1 (evaluate.ts)
        if (prev) span(first, Math.min(last, T.frameIndexAt(clip.start, rate) + clip.transition.frames + (T.isFrameAligned(clip.start, rate) ? 0 : 1)), clipDecoders(doc, prev));
      }
    }
  }
  let cur = 0;
  return [...events.keys()].sort((a, b) => a - b).map((f) => [f, (cur += events.get(f)!)]);
}

/**
 * Most video decoders any frame of the sequence may need (picture layers, transition outgoing sides, decoding taps), and
 * where. An UPPER BOUND: drawGraph decodes a source frame once however many layers and taps of one frame show it (stacked
 * copies of a clip, a freeze frame, taps held at the run start, slow motion), so a frame can need fewer; decodeOverBudget
 * (decodeBudget.ts) counts exactly. `fromFrame` is the first frame where the bound is that high and `toFrame` the first
 * frame after that stretch (exclusive). Counted per clip and frame range, never by evaluating frames, so it is cheap for
 * long timelines.
 */
export function maxDecodeLanes(doc: ProjectDocument, sequenceId = doc.mainSequenceId): { lanes: number; fromFrame: number; toFrame: number } {
  let best = 0, from = 0, to = 0, open = false;
  for (const [f, cur] of decodeLaneSteps(doc, sequenceId)) {
    if (open && cur < best) { to = f; open = false; }
    if (cur > best) { best = cur; from = f; open = true; }
  }
  return { lanes: best, fromFrame: from, toFrame: best ? to : 0 };
}
