/**
 * Perform mode's moves (ADR-0025, W1): the pad catalogue, the two named banks, the grid a take snaps to, quantise and the pure
 * planner. Typed by performContract.ts (lead; not edited here). Pure: no Date, no Math.random, no engine import; every number
 * that enters the op's arguments is rounded to 1e-6, hits are taken in (frame, pad, tap) order, so the same input gives
 * byte-identical arguments in Node and in the browser.
 *
 * The planner holds a hit instead of planning what apply_take (takeOps.ts) would refuse, and the op re-checks everything:
 * - steps only from TAKE_STEP_OPS; no freeze (wave 2); the take's sequenceId on every step that names a sequence when the take
 *   is not on the main sequence; never a live field on a title; never a key on the light of a clip the take did not make.
 * - The flash rule is performFlash.ts (lightChanges, lightRanges, flashClassOf, with the frozen FLASH_TABLE_V1), modelled here
 *   frame by frame so a 200-hit take plans without applying anything: strobe hits claim their light first; every change of
 *   light the take makes (the start of a light-changing adjustment, a title or a sticker, and inner key changes on its light
 *   channels) keeps flashGapFrames from every other change of light, stays outside every strobe or light transition widened by
 *   the gap, and lasts at least the gap. An envelope or fade on a light channel whose inner key cannot keep the gap is stretched
 *   over the whole hit (its keys then sit on the clip's first frame and its end, which change no light by rule 5), never held.
 * - The zoom punch is scale keys on the topmost visible picture clip at the hit (x and y too when they are not 0, so it zooms
 *   about the frame centre), written as one replace_clip_keyframes (range form) per property, exact only where the property is
 *   constant over [a − 1, b]: its last key copies the easing of the segment it lands in, keys outside [a − 1, b] stay, so every
 *   frame outside [a, b) is drawn as before (moves.property.test.ts samples them).
 * - Sound lanes: unlocked, unmuted sound tracks that earlier perform:take runs made are reused before add_track; at most
 *   MAX_SOUND_LANES lanes per take. A sound is the source's whole frames, cut at the end of the edit (sequenceDuration counts sound).
 * - A sticker goes on a picture track above the topmost picture at the hit (an existing free one, else one add_track the take makes).
 * Lengths in the specs are seconds; frames come from frameOfSeconds once, from the absolute time.
 */
import * as T from '@pulseframe/time';
import type { Asset, Clip, Keyframe, ProjectDocument, Sequence, Track } from './schema.ts';
import { DEFAULT_TEXT_ANIMATION, TransformSchema, type TextAnimation } from './schema.ts';
import type { TemplateStep } from './templateContract.ts';
import { MAX_TRANSFORM_KEYS, type Easing } from './keyframe.ts';
import { animatableParams, findEffect, GPU_EFFECT_IDS } from './effects.ts';
import { adjustmentRefusal } from './validate.ts';
import { sampleKeyframes, TRANSFORM_RANGE } from './animation.ts';
import { followedBeats } from './beatgrid.ts';
import { flashGapFrames } from './flashSafety.ts';
import { defaultMotionFrames, MOTION_PRESETS, motionKeys } from './motionPresets.ts';
import { findTextPreset } from './textPresets.ts';
import { OpError } from './ops.ts';
import { PERFORM_REFUSALS } from './performRefusals.ts';
import { effectChangesLightIn, FLASH_TABLE_V1, flashClassOf, lightChanges, lightRanges, type FlashClass } from './performFlash.ts';
import {
  MAX_SOUND_LANES, MAX_TAKE_HITS, MAX_TAKE_STEPS, MAX_TAKE_SUMMARY, MAX_TAKE_TRACKS, PAD_COUNT, PERFORM_RECIPE_ID, PULSE_FALLBACK_BPM, PULSE_MAX_HOLD_SECONDS,
  type ApplyTakeArgs, type BankId, type Chip, type DefaultBank, type FrameOfSeconds, type HeldReason, type Hit, type MoveSpec, type PadBank, type PerformGrid,
  type PlanPerformance, type QuantiseTaps,
} from './performContract.ts';

/** Built: POST /takes plans for real. */
export const PERFORM_PLANNER_BUILT: boolean = true;

// ---------- the catalogue ----------
type Spec<K extends MoveSpec['kind']> = Extract<MoveSpec, { kind: K }>;
const adjust = (id: string, minSeconds: number, effects: Spec<'adjust'>['effects'], fadeOutSeconds = 0): Spec<'adjust'> => ({ id, kind: 'adjust', minSeconds, effects, fadeOutSeconds });
/**
 * The pad catalogue, by move id. Canvas2D (work on every machine): the zoom punch, colour split, blur hit, pixelate,
 * black-and-white, confetti burst, speed lines, a sound, a title and a sticker. GPU (need a graphics adapter): pulse, shake,
 * glitch, RGB shake, zoom blur, and the beat strobe («הבזק על הפעימה»), which is in no bank: the editor offers it only when the
 * music has an analysed beat grid, and the planner holds it `no_music` where no followed music plays under the hit.
 */
export const MOVES: readonly MoveSpec[] = Object.freeze([
  { id: 'move.punch', kind: 'punch', minSeconds: 0.1, scale: 1.18, releaseSeconds: 0.12 },
  adjust('move.colour-split', 0.4, [{ type: 'digital.rgb-split', params: { amount: 0.02 } }]),
  adjust('move.blur-hit', 0.35, [{ type: 'blur.gaussian', params: { radius: 0.04 }, envelope: { param: 'radius', from: 0.04, to: 0, shape: 'decay', seconds: 0.35 } }]),
  adjust('move.pixelate', 0.3, [{ type: 'stylize.pixelate', params: { size: 0.05 }, envelope: { param: 'size', from: 0.06, to: 0.01, shape: 'decay', seconds: 0.3 } }]),
  adjust('move.black-white', 0.4, [{ type: 'color.grayscale', params: { amount: 1 } }]),
  adjust('move.confetti', 1.5, [{ type: 'overlay.confetti', params: { mode: 'burst', area: 'frame' } }], 0.4),
  adjust('move.speed-lines', 0.6, [{ type: 'overlay.speed-lines', params: { amount: 0.7 } }]),
  { id: 'move.sound-impact', kind: 'sound', minSeconds: 0.05, source: { sfxId: 'sfx.impact' }, gain: 1 },
  { id: 'move.title-wow', kind: 'title', minSeconds: 0.6, text: 'וואו!', style: { sizeFrac: 0.12 }, animation: { by: 'word', in: 'pop', out: 'fade', loop: null, inFrames: 8, outFrames: 6 } },
  { id: 'move.sticker-star', kind: 'sticker', minSeconds: 0.6, source: { elementId: 'element.shape.star-5', color: '#FFD166' }, transform: { scale: 0.3, y: -0.2 }, motionId: 'motion.in.pop' },
  adjust('move.pulse', 0.5, [{ type: 'motion.pulse', params: { amount: 0.12 }, onBeat: true }]),
  adjust('move.shake', 0.4, [{ type: 'motion.shake', params: { amount: 0.04, speed: 10 }, onBeat: true }]),
  adjust('move.glitch', 0.3, [{ type: 'digital.glitch', params: { amount: 0.1 } }]),
  adjust('move.rgb-shake', 0.3, [{ type: 'digital.rgb-shake', params: { amount: 0.02 }, onBeat: true }]),
  adjust('move.zoom-blur', 0.3, [{ type: 'blur.zoom', params: { amount: 0.3 }, envelope: { param: 'amount', from: 0.35, to: 0, shape: 'decay', seconds: 0.3 } }]),
  adjust('move.beat-strobe', 1, [{ type: 'light.strobe', params: { follow: 'music', every: 1, amount: 0.6 } }]),
] satisfies MoveSpec[]);
const BANKS: Readonly<Record<BankId, readonly string[]>> = {
  canvas: ['move.punch', 'move.colour-split', 'move.blur-hit', 'move.pixelate', 'move.black-white', 'move.confetti', 'move.sound-impact', 'move.title-wow'],
  gpu: ['move.punch', 'move.pulse', 'move.shake', 'move.glitch', 'move.rgb-shake', 'move.zoom-blur', 'move.sound-impact', 'move.sticker-star'],
};
/** 'canvas' (the default, Canvas2D on every machine) or 'gpu' (shake, glitch, pulse: needs a graphics adapter). */
export const defaultBank: DefaultBank = (id) => {
  const ids = Object.hasOwn(BANKS, id) ? BANKS[id] : BANKS.canvas;
  return Object.freeze(ids.map((m) => structuredClone(MOVES.find((x) => x.id === m)!)));
};

// ---------- time ----------
/** One conversion from absolute seconds to the nearest frame boundary (ties up), through an exact rational (ADR-0003). */
export const frameOfSeconds: FrameOfSeconds = (seconds, rate) => T.nearestFrameIndex(T.fromSeconds(seconds.toFixed(6)), rate);
const r6 = (x: number) => { const v = Math.round(x * 1e6) / 1e6; return Object.is(v, -0) ? 0 : v; };
const own = <V>(rec: Readonly<Record<string, V>>, key: string): V | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);
const startFrame = (c: Clip, rate: T.Rate) => { const i = T.frameIndexAt(c.start, rate); return T.isFrameAligned(c.start, rate) ? i : i + 1; };
const endFrame = (c: Clip, rate: T.Rate) => { const e = T.add(c.start, c.duration); const i = T.frameIndexAt(e, rate); return T.isFrameAligned(e, rate) ? i : i + 1; };

// ---------- the grid ----------
function medianGap(grid: readonly number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < grid.length; i++) { const g = grid[i]! - grid[i - 1]!; if (g > 1e-9) gaps.push(g); }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[(gaps.length - 1) >> 1]!;
}
/** Midpoints between neighbours no further apart than twice the median period (a gap between two pieces of music is not bridged). */
function withMidpoints(grid: readonly number[]): number[] {
  const m = medianGap(grid);
  if (grid.length < 2 || m <= 0) return [...grid];
  const out: number[] = [];
  for (let i = 0; i < grid.length; i++) {
    out.push(grid[i]!);
    if (i + 1 < grid.length) { const g = grid[i + 1]! - grid[i]!; if (g > 1e-9 && g <= 2 * m * (1 + 1e-9)) out.push(grid[i]! + g / 2); }
  }
  return out;
}
/** Timeline seconds of the grid a take snaps to (empty when no analysed music is followed, or snap is off). */
export const performGrid: PerformGrid = (doc, settings, sequenceId) => {
  if (settings.snap === 'off') return [];
  const seqId = sequenceId ?? doc.mainSequenceId;
  if (!Object.hasOwn(doc.sequences, seqId)) return [];
  let beats = followedBeats(doc, 0, Infinity, seqId);
  if (settings.tempo === 'half') beats = beats.filter((b) => ((b.index % 2) + 2) % 2 === settings.parity);
  let grid: number[] = [];
  for (const b of beats) if (!grid.length || b.t - grid[grid.length - 1]! > 1e-9) grid.push(b.t);
  if (settings.tempo === 'double') grid = withMidpoints(grid);
  if (settings.snap === 'half') grid = withMidpoints(grid);
  return grid;
};

/**
 * The grid point a time snaps to and the local period there, or null when the time lies outside the grid's coverage by more
 * than half a local period (before the first point, after the last, or in a break wider than twice the median period).
 * Ties go to the earlier point.
 */
function nearestOnGrid(grid: readonly number[], median: number, t: number): { g: number; period: number } | null {
  const n = grid.length;
  if (n < 2) return null;
  let lo = -1, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (grid[mid]! <= t) lo = mid; else hi = mid; }
  const gapBefore = (i: number) => (i >= 1 && i < n ? grid[i]! - grid[i - 1]! : median);
  if (lo < 0) { const p = grid[1]! - grid[0]!; return grid[0]! - t <= p / 2 ? { g: grid[0]!, period: p } : null; }
  if (lo >= n - 1) { const p = grid[n - 1]! - grid[n - 2]!; return t - grid[n - 1]! <= p / 2 ? { g: grid[n - 1]!, period: p } : null; }
  const left = grid[lo]!, right = grid[lo + 1]!, gap = right - left;
  if (gap <= 2 * median * (1 + 1e-9)) return t - left <= right - t ? { g: left, period: gap } : { g: right, period: gap };
  const pl = gapBefore(lo), pr = gapBefore(lo + 2), dl = t - left, dr = right - t;
  const okL = dl <= pl / 2, okR = dr <= pr / 2;
  if (okL && (!okR || dl <= dr)) return { g: left, period: pl };
  if (okR) return { g: right, period: pr };
  return null;
}
const byHit = (x: Hit, y: Hit) => x.frame - y.frame || x.pad - y.pad || x.tap - y.tap;

/**
 * Quantise: each tap moves `strength` of the way to its nearest grid point (ties earlier); a tap outside the grid's coverage
 * keeps its time and is flagged (snapped false). The start frame is one conversion of the absolute moved time; the end is the
 * release moved by the same amount, or snapped by the same rule when the hold is at least 0.75 of the local grid step. A hit is
 * at least the pad's shortest length. Sorted by (frame, pad, tap); frames are never negative.
 */
export const quantiseTaps: QuantiseTaps = (taps, grid, settings, rate, bank) => {
  const g = settings.snap === 'off' ? [] : [...grid].sort((a, b) => a - b);
  const median = medianGap(g);
  const hits = taps.map((tap, i): Hit => {
    const spec = tap.pad >= 0 && tap.pad < bank.length ? bank[tap.pad] ?? null : null;
    const minFrames = spec ? Math.max(1, frameOfSeconds(spec.minSeconds, rate)) : 1;
    const near = nearestOnGrid(g, median, tap.down);
    const shift = near ? settings.strength * (near.g - tap.down) : 0;
    const frame = Math.max(0, frameOfSeconds(tap.down + shift, rate));
    let end = frameOfSeconds(tap.up + shift, rate);
    if (near && tap.up - tap.down >= 0.75 * near.period) {
      const e = nearestOnGrid(g, median, tap.up);
      if (e) end = frameOfSeconds(tap.up + settings.strength * (e.g - tap.up), rate);
    }
    return { tap: i, pad: tap.pad, frame, frames: Math.max(minFrames, end - frame, 1), snapped: !!near, movedMs: r6(shift * 1000) };
  });
  return hits.sort(byHit);
};

// ---------- the planner ----------
/** The class of light a move has: adjustments by their effects (performFlash.ts); a title or sticker appearing is a change of light. */
function moveClass(spec: MoveSpec): FlashClass {
  if (spec.kind === 'adjust') return flashClassOf(spec.effects, FLASH_TABLE_V1);
  return spec.kind === 'title' || spec.kind === 'sticker' ? 'colour' : 'none';
}
const GPU = new Set(GPU_EFFECT_IDS);
const effectHas = (type: string, param: string): boolean => { const d = findEffect(type); if (!d) return false; return Object.hasOwn(d.params.parse({}) as Record<string, unknown>, param); };
/** Why a pad cannot be planned at all (a malformed pad from a stored bank or the pad editor), or null. */
function padProblem(spec: MoveSpec): string | null {
  if (spec.kind === 'adjust') {
    for (const fx of spec.effects) {
      const d = findEffect(fx.type);
      if (!d) return `unknown effect ${fx.type}`;
      const why = adjustmentRefusal(fx.type);
      if (why) return `${fx.type} cannot go on an adjustment`;
      if (!d.params.safeParse(fx.params ?? {}).success) return `the parameters of ${fx.type} are not valid`;
      if (fx.envelope) {
        const { param, from, to } = fx.envelope;
        if (!animatableParams(fx.type).includes(param)) return `${param} is not a numeric parameter of ${fx.type}`;
        if (!d.params.safeParse({ ...fx.params, [param]: from }).success || !d.params.safeParse({ ...fx.params, [param]: to }).success) return `the envelope of ${fx.type}.${param} leaves its range`;
      }
    }
  }
  if (spec.kind === 'title' && spec.presetId !== undefined && !findTextPreset(spec.presetId)) return `unknown text style ${spec.presetId}`;
  return null;
}
/** Entrances that only fade in from 0 on opacity (a sticker's appearance, rule 5's exception), worked out once from the library. */
let safeEntrances: Set<string> | null = null;
function safeEntrance(id: string): boolean {
  if (!safeEntrances) {
    safeEntrances = new Set();
    for (const m of MOTION_PRESETS) {
      if (m.kind !== 'in') continue;
      const op = motionKeys(m.id, { totalFrames: 120, rest: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } }).opacity;
      if (!op) { safeEntrances.add(m.id); continue; }
      const ok = op[0]!.frame === 0 && op[0]!.value === 0 && op.slice(1).every((k, i) => i === 0 ? k.value > 0 && op[0]!.easing !== 'hold' : k.value === op[i]!.value);
      if (ok) safeEntrances.add(m.id);
    }
  }
  return safeEntrances.has(id);
}
const hasPicture = (a: Asset | undefined) => !!a && (!!a.video || (a.kind === 'image' && !!a.image));
const pictureAt = (doc: ProjectDocument, c: Clip) => c.type === 'media' && hasPicture(own(doc.assets, c.assetId));

interface Entry {
  hit: Hit; spec: MoveSpec; cls: FlashClass; a: number; b: number; merged: Hit[];
  held?: HeldReason; since?: number; steps?: TemplateStep[];
}
interface Lane { id: string | null; bind: string | null; busy: [number, number][] }
type Planned = { steps: TemplateStep[]; changes: number[]; commit: () => void } | { held: HeldReason; since?: number };

export const planPerformance: PlanPerformance = (doc, input) => {
  const seqId = input.sequenceId ?? doc.mainSequenceId;
  const seq: Sequence | undefined = own(doc.sequences, seqId);
  if (!seq) throw new OpError(PERFORM_REFUSALS.unknownSequence.code, PERFORM_REFUSALS.unknownSequence.message(seqId), { sequenceId: seqId }, PERFORM_REFUSALS.unknownSequence.hint);
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seqArg = seqId !== doc.mainSequenceId ? { sequenceId: seqId } : {};
  const secondsOf = (f: number) => T.toSeconds(T.frameTime(f, rate));
  const framesOfSeconds = (s: number) => Math.max(1, frameOfSeconds(s, rate));
  const warnings: string[] = [];
  const warn = (w: string) => { if (!warnings.includes(w) && warnings.length < 50) warnings.push(w.slice(0, 400)); };

  // the end of the edit: the last picture or title (a sound past it would lengthen the film)
  let editEnd = 0;
  for (const t of seq.tracks) for (const c of t.clips) if ((t.kind === 'video' && c.type === 'media') || (t.kind === 'text' && c.type === 'text')) editEnd = Math.max(editEnd, endFrame(c, rate));

  // the flash model: changes of light already in the sequence, kept changes of this take, light ranges (old and this take's strobes)
  const changes: number[] = lightChanges(doc, new Set(), seqId, FLASH_TABLE_V1).map((c) => c.frame).sort((x, y) => x - y);
  const ranges: { from: number; to: number }[] = lightRanges(doc, seqId, FLASH_TABLE_V1).map((r) => ({ from: r.from, to: r.to }));
  const addChange = (f: number) => { let i = changes.length; while (i > 0 && changes[i - 1]! > f) i--; changes.splice(i, 0, f); };
  const nearestChange = (f: number): number | null => {
    let best: number | null = null;
    let lo = 0, hi = changes.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (changes[mid]! < f) lo = mid + 1; else hi = mid; }
    for (const i of [lo - 1, lo]) if (i >= 0 && i < changes.length && (best === null || Math.abs(changes[i]! - f) < Math.abs(best - f))) best = changes[i]!;
    return best;
  };
  /** Why a change of light at `f` breaks the rule, with `own` the take's other changes for this hit. */
  const breachAt = (f: number, mine: readonly number[]): { since: number } | null => {
    const r = ranges.find((x) => f >= x.from - gap && f < x.to + gap);
    if (r) return { since: f - r.from };
    const n = nearestChange(f);
    if (n !== null && Math.abs(n - f) < gap) return { since: Math.abs(n - f) };
    for (const m of mine) if (m !== f && Math.abs(m - f) < gap) return { since: Math.abs(m - f) };
    return null;
  };
  const fits = (f: number, mine: readonly number[]) => breachAt(f, mine) === null && mine.every((m) => Math.abs(m - f) >= gap);

  // 1–3: cap, availability, range, merge and retrigger
  const chips = new Map<number, Chip>();
  const chipOf = (h: Hit, spec: MoveSpec, state: Chip['state'], frame = h.frame, frames = h.frames, reason?: HeldReason, since?: number) =>
    chips.set(h.tap, { tap: h.tap, pad: h.pad, moveId: spec.id, frame, frames, state, ...(reason ? { reason } : {}), ...(since !== undefined ? { since } : {}) });
  const entries: Entry[] = [];
  const lastByPad = new Map<number, Entry>();
  const problems = new Map<number, string | null>();
  let considered = 0;
  for (const hit of [...input.hits].sort(byHit)) {
    const spec = hit.pad >= 0 && hit.pad < PAD_COUNT ? input.bank[hit.pad] ?? null : null;
    if (!spec) { warn(`tap ${hit.tap} is on an empty pad and was left out`); continue; }
    if (!problems.has(hit.pad)) problems.set(hit.pad, padProblem(spec));
    const problem = problems.get(hit.pad);
    if (problem) { warn(`pad ${hit.pad + 1} (${spec.id}) cannot be played: ${problem}`); continue; }
    const cls = moveClass(spec);
    const hold = (reason: HeldReason, since?: number, a = hit.frame, len = hit.frames) => { chipOf(hit, spec, 'held', a, len, reason, since); };
    if (considered++ >= MAX_TAKE_HITS) { hold('take_full'); continue; }
    if (spec.kind === 'adjust' && !input.gpu && spec.effects.some((e) => GPU.has(e.type))) { hold('needs_gpu'); continue; }
    const assetId = spec.kind === 'sound' || spec.kind === 'sticker' ? input.assets[hit.pad] ?? null : null;
    const asset = assetId !== null ? own(doc.assets, assetId) : undefined;
    if (spec.kind === 'sound' && !(asset && asset.audio && !asset.video && asset.kind === 'audio')) { hold('missing_asset'); continue; }
    if (spec.kind === 'sticker' && !(asset && asset.kind === 'image' && asset.image)) { hold('missing_asset'); continue; }
    const a = hit.frame;
    let len = Math.max(hit.frames, framesOfSeconds(spec.minSeconds));
    if (cls !== 'none') len = Math.max(len, gap);
    if (spec.kind === 'sound') len = T.frameCount(asset!.duration, rate);
    if (a >= editEnd) { hold('outside_edit'); continue; }
    const b = Math.min(a + len, editEnd);
    if (spec.kind === 'sound' && b - a < 1) { hold('sound_too_short', undefined, a, Math.max(1, b - a)); continue; }
    if (cls !== 'none' && b - a < gap) { hold('flash_limit', b - a, a, b - a); continue; }
    // the same pad again while its hit lasts: merge, or cut the previous one when this hit starts inside its release
    const prev = spec.kind === 'sound' ? undefined : lastByPad.get(hit.pad);
    if (prev && a <= prev.b) {
      const rel = releaseOf(prev.spec, prev.b - prev.a);
      const minLen = Math.max(3, prev.cls !== 'none' ? gap : 1);
      if (a < prev.b && a >= prev.b - rel && a - 1 - prev.a >= minLen) prev.b = a - 1;
      else { prev.b = Math.max(prev.b, b); prev.merged.push(hit); continue; }
    }
    const e: Entry = { hit, spec, cls, a, b, merged: [] };
    entries.push(e);
    if (spec.kind !== 'sound') lastByPad.set(hit.pad, e);
  }
  function releaseOf(spec: MoveSpec, len: number): number {
    if (spec.kind === 'punch') return Math.min(len, framesOfSeconds(spec.releaseSeconds));
    if (spec.kind === 'adjust') return spec.fadeOutSeconds > 0 ? Math.min(len, framesOfSeconds(spec.fadeOutSeconds)) : 0;
    if (spec.kind === 'title') { const an = { ...DEFAULT_TEXT_ANIMATION, ...spec.animation }; return an.out ? Math.min(len, scaled(an.outFrames)) : 0; }
    return 0;
  }
  function scaled(f: number) { return Math.max(1, Math.round((f * fps) / 30)); }

  // the take's tracks, steps and the working state of the clips it keys
  let steps = 0, tracksAdded = 0, binds = 0;
  const bindName = () => `h${binds++}`;
  const working = new Map<string, Partial<Record<'x' | 'y' | 'scale', Keyframe[]>>>();
  const madeRuns = Object.values(doc.recipeRuns).filter((r) => r.recipeId === PERFORM_RECIPE_ID);
  const busyOf = (t: Track): [number, number][] => t.clips.map((c) => [startFrame(c, rate), endFrame(c, rate)]);
  const soundLanes: Lane[] = seq.tracks.filter((t) => t.kind === 'audio' && !t.locked && !t.muted && madeRuns.some((r) => r.createdIds.includes(t.id))).map((t) => ({ id: t.id, bind: null, busy: busyOf(t) }));
  let lanesUsed = new Set<Lane>();
  const pictureLanes: Lane[] = [];
  const pictureBusy = new Map<string, [number, number][]>();
  const free = (busy: readonly [number, number][], a: number, b: number) => busy.every(([x, y]) => y <= a || b <= x);
  const trackRef = (l: Lane) => (l.id !== null ? l.id : { $ref: l.bind!, out: 'trackId' });

  // 5: realisation per kind (each returns its steps, its changes of light and what to record when kept)
  const planPunch = (e: Entry, spec: Spec<'punch'>): Planned => {
    let target: { track: Track; clip: Clip } | null = null;
    for (let i = seq.tracks.length - 1; i >= 0 && !target; i--) {
      const t = seq.tracks[i]!;
      if (t.kind !== 'video' || t.hidden) continue;
      for (const c of t.clips) if (pictureAt(doc, c) && startFrame(c, rate) <= e.a && e.a < endFrame(c, rate)) { target = { track: t, clip: c }; break; }
    }
    if (!target) return { held: 'no_picture' };
    if (target.track.locked) return { held: 'locked' };
    if (target.clip.follow) return { held: 'follows_track' };
    const clip = target.clip, cs = startFrame(clip, rate), b = Math.min(e.b, endFrame(clip, rate));
    if (b - e.a < 2) return { held: 'crosses_cut' };
    const la = e.a - cs, lb = b - cs, from = la === 0 ? la : la - 1;
    const r = Math.min(framesOfSeconds(spec.releaseSeconds), lb - la);
    const m = spec.scale;
    const keysNow = working.get(clip.id) ?? {};
    const out: TemplateStep[] = [];
    const next: Partial<Record<'x' | 'y' | 'scale', Keyframe[]>> = {};
    for (const p of ['scale', 'x', 'y'] as const) {
      const keys = keysNow[p] ?? (clip.keyframes?.[p] ? [...clip.keyframes[p]!] : []);
      const at = (f: number) => (keys.length ? sampleKeyframes(keys, T.frameTime(f, rate), TRANSFORM_RANGE[p]) : clip.transform[p]);
      const s = at(la);
      for (let f = from; f <= lb; f++) if (at(f) !== s) return { held: 'has_motion' };
      const before = keys.filter((k) => T.lt(k.time, T.frameTime(from, rate)));
      const after = keys.filter((k) => T.lt(T.frameTime(lb, rate), k.time));
      const inside = keys.filter((k) => !before.includes(k) && !after.includes(k));
      // a curve shaped by its neighbours (smooth), or a custom one, next to the range: inserting keys would reshape it
      const near = [...before.slice(-2), ...inside, ...after.slice(0, 2)];
      if (near.some((k) => k.easing === 'smooth' || k.easing === 'bezier')) return { held: 'has_motion' };
      if (p !== 'scale' && s === 0) continue;
      const landing = [...before, ...inside].at(-1);
      const easing: Easing = after.length ? (landing ? landing.easing : 'hold') : 'linear';
      const sm = r6(s * m), s0 = r6(s);
      const made: { f: number; v: number; e: Easing }[] = [];
      if (from < la) made.push({ f: from, v: s0, e: 'hold' });
      if (r < lb - la) made.push({ f: la, v: sm, e: 'hold' }, { f: lb - r, v: sm, e: 'ease-out' });
      else made.push({ f: la, v: sm, e: 'ease-out' });
      made.push({ f: lb, v: s0, e: easing });
      if (made.some((k) => !TransformSchema.shape[p].safeParse(k.v).success)) return { held: 'has_motion' };
      if (before.length + after.length + made.length > MAX_TRANSFORM_KEYS) return { held: 'too_many_keys' };
      const newKeys: Keyframe[] = made.map((k) => ({ time: T.frameTime(k.f, rate), value: k.v, easing: k.e }));
      out.push({ op: 'replace_clip_keyframes', args: { clipId: clip.id, property: p, keys: newKeys, from: T.frameTime(from, rate), to: T.frameTime(lb, rate) } });
      next[p] = [...before, ...newKeys, ...after];
    }
    return { steps: out, changes: [], commit: () => { working.set(clip.id, { ...keysNow, ...next }); e.b = b; } };
  };

  const planSound = (e: Entry, spec: Spec<'sound'>, assetId: string): Planned => {
    let lane = soundLanes.find((l) => free(l.busy, e.a, e.b) && (lanesUsed.has(l) || lanesUsed.size < MAX_SOUND_LANES));
    const out: TemplateStep[] = [];
    let created: Lane | null = null;
    if (!lane) {
      if (lanesUsed.size >= MAX_SOUND_LANES || tracksAdded >= MAX_TAKE_TRACKS) return { held: 'too_many_sounds' };
      created = { id: null, bind: `lane${soundLanes.length}`, busy: [] };
      out.push({ op: 'add_track', args: { ...seqArg, kind: 'audio', name: 'הופעה' }, bind: created.bind! });
      lane = created;
    }
    const bind = bindName();
    out.push({ op: 'add_clip', args: { ...seqArg, assetId, trackId: trackRef(lane), start: T.frameTime(e.a, rate), duration: T.frameTime(e.b - e.a, rate) }, bind });
    if (spec.gain !== 1) out.push({ op: 'set_clip_gain', args: { clipId: { $ref: bind }, gain: r6(spec.gain) } });
    const l = lane;
    return { steps: out, changes: [], commit: () => { if (created) { soundLanes.push(created); tracksAdded++; } l.busy.push([e.a, e.b]); lanesUsed = new Set([...lanesUsed, l]); } };
  };

  const planTitle = (e: Entry, spec: Spec<'title'>): Planned => {
    const total = e.b - e.a;
    const an: TextAnimation = { ...DEFAULT_TEXT_ANIMATION, ...spec.animation };
    // frames of an animation are designed at 30 fps; entrance plus exit must fit the title (set_text_animation refuses otherwise)
    let inF = an.in ? Math.min(600, scaled(an.inFrames)) : 0, outF = an.out ? Math.min(600, scaled(an.outFrames)) : 0;
    let exit: TextAnimation['out'] = an.out;
    if (inF + outF > total) {
      if (an.in && exit) { inF = Math.max(1, Math.floor((total * inF) / (inF + outF))); outF = total - inF; if (outF < 1) { exit = null; outF = 0; } }
      else if (an.in) inF = total; else outF = total;
    }
    const args: Record<string, unknown> = { ...seqArg, text: spec.text, start: T.frameTime(e.a, rate), duration: T.frameTime(total, rate) };
    if (spec.style) args.style = spec.style;
    if (spec.transform) args.transform = spec.transform;
    if (spec.presetId !== undefined) args.presetId = spec.presetId;
    if (an.in || exit || an.loop) args.animation = { by: an.by, in: an.in, out: exit, loop: an.loop, inFrames: an.in ? inF : Math.min(600, scaled(an.inFrames)), outFrames: exit ? outF : Math.min(600, scaled(an.outFrames)) };
    return { steps: [{ op: 'add_text', args }], changes: [e.a], commit: () => {} };
  };

  const planSticker = (e: Entry, spec: Spec<'sticker'>, assetId: string): Planned => {
    let top = -1;
    seq.tracks.forEach((t, i) => { if (t.kind === 'video' && !t.hidden && t.clips.some((c) => pictureAt(doc, c) && startFrame(c, rate) <= e.a && e.a < endFrame(c, rate))) top = i; });
    const busy = (t: Track) => pictureBusy.get(t.id) ?? busyOf(t);
    const existing = seq.tracks.find((t, i) => i > top && t.kind === 'video' && !t.locked && !t.hidden && free(busy(t), e.a, e.b));
    let lane: Lane | undefined = existing ? { id: existing.id, bind: null, busy: busy(existing) } : pictureLanes.find((l) => free(l.busy, e.a, e.b));
    const out: TemplateStep[] = [];
    let created: Lane | null = null;
    if (!lane) {
      if (tracksAdded >= MAX_TAKE_TRACKS || pictureLanes.length >= 2) return { held: 'take_full' };
      created = { id: null, bind: `slane${pictureLanes.length}`, busy: [] };
      out.push({ op: 'add_track', args: { ...seqArg, kind: 'video', name: 'הופעה' }, bind: created.bind! });
      lane = created;
    }
    const bind = bindName();
    const total = e.b - e.a;
    out.push({ op: 'add_clip', args: { ...seqArg, assetId, trackId: trackRef(lane), start: T.frameTime(e.a, rate), duration: T.frameTime(total, rate) }, bind });
    if (spec.transform && Object.keys(spec.transform).length) out.push({ op: 'set_clip_transform', args: { clipId: { $ref: bind }, transform: spec.transform } });
    const motion = spec.motionId;
    if (motion !== undefined) {
      if (MOTION_PRESETS.some((m) => m.id === motion) && safeEntrance(motion) && total >= 2) out.push({ op: 'apply_motion_preset', args: { clipId: { $ref: bind }, presetId: motion, frames: Math.min(total, defaultMotionFrames(motion, fps)) } });
      else warn(`the sticker motion ${motion} was left out: only entrances that fade in from nothing are played on a pad`);
    }
    const l = lane;
    return { steps: out, changes: [e.a], commit: () => {
      if (created) { pictureLanes.push(created); tracksAdded++; }
      l.busy.push([e.a, e.b]);
      if (l.id !== null) pictureBusy.set(l.id, l.busy);
    } };
  };

  const planAdjust = (e: Entry, spec: Spec<'adjust'>): Planned => {
    const L = e.b - e.a;
    const music = followedBeats(doc, secondsOf(e.a), secondsOf(e.b) - 1e-9, seqId).length > 0;
    if (spec.effects.some((fx) => fx.type === 'light.strobe' && (fx.params?.follow ?? 'steady') === 'music') && !music) return { held: 'no_music' };
    let len = L;
    const effects = spec.effects.map((fx) => {
      const params: Record<string, unknown> = { ...fx.params };
      if (fx.onBeat && effectHas(fx.type, 'follow') && music) params.follow = 'music';
      else if (fx.onBeat && fx.type === 'motion.pulse') {
        const bpm = PULSE_FALLBACK_BPM, beats = (secondsOf(e.a) * bpm) / 60;
        const off = r6((1 - (beats - Math.floor(beats))) % 1);
        params.bpm = bpm; params.offset = off >= 1 ? 0 : off;
        len = Math.min(len, framesOfSeconds(PULSE_MAX_HOLD_SECONDS));
      }
      return { type: fx.type, ...(Object.keys(params).length ? { params: roundParams(params) } : {}) };
    });
    const bind = bindName();
    const out: TemplateStep[] = [{ op: 'add_adjustment', args: { ...seqArg, span: { start: T.frameTime(e.a, rate), duration: T.frameTime(len, rate) }, effects }, bind }];
    const mine: number[] = [e.a];
    // the adjustment's opacity is light when its effects change light; an effect's keys are light when that effect changes light
    const light = e.cls === 'colour';
    // an inner key change on a light channel keeps the gap from the hit's start, its end and every other change; else it spans the hit
    const inner = (f: number, lit: boolean) => !lit || (f - e.a >= gap && e.a + len - f >= gap && fits(f, mine));
    const key = (k: number, param: string, f: number, value: number, easing: Easing) => out.push({ op: 'set_effect_keyframe', args: { clipId: { $ref: bind }, effectId: { $ref: bind, out: 'effectIds', at: k }, param, time: T.frameTime(f, rate), value: r6(value), easing } });
    if (e.cls !== 'light') spec.effects.forEach((fx, k) => {
      const env = fx.envelope;
      if (!env || env.from === env.to) return;
      const lit = light && effectChangesLightIn(FLASH_TABLE_V1, fx.type);
      const n = framesOfSeconds(env.seconds);
      if (env.shape === 'decay') {
        let end = Math.min(n, len);
        if (end < len - 1 && !inner(e.a + end, lit)) end = len;
        if (lit && end < len - 1) mine.push(e.a + end);
        key(k, env.param, 0, env.from, 'ease-out'); key(k, env.param, end, env.to, 'linear');
      } else {
        let begin = Math.max(0, len - n);
        if (begin > 0 && !inner(e.a + begin, lit)) begin = 0;
        if (lit && begin > 0) mine.push(e.a + begin);
        key(k, env.param, begin, env.from, 'linear'); key(k, env.param, len, env.to, 'linear');
      }
    });
    if (e.cls !== 'light' && spec.fadeOutSeconds > 0) {
      let begin = Math.max(0, len - framesOfSeconds(spec.fadeOutSeconds));
      if (light && begin > 0 && !inner(e.a + begin, true)) { const wider = len - Math.max(len - begin, gap); begin = wider > 0 && inner(e.a + wider, true) ? wider : 0; }
      if (light && begin > 0) mine.push(e.a + begin);
      out.push({ op: 'set_keyframe', args: { clipId: { $ref: bind }, property: 'opacity', time: T.frameTime(begin, rate), value: 1, easing: 'linear' } });
      out.push({ op: 'set_keyframe', args: { clipId: { $ref: bind }, property: 'opacity', time: T.frameTime(len, rate), value: 0, easing: 'linear' } });
    }
    return { steps: out, changes: light ? mine : [], commit: () => { e.b = e.a + len; if (e.cls === 'light') ranges.push({ from: e.a, to: e.a + len }); } };
  };

  const realise = (e: Entry): Planned => {
    const s = e.spec;
    switch (s.kind) {
      case 'punch': return planPunch(e, s);
      case 'sound': return planSound(e, s, input.assets[e.hit.pad]!);
      case 'title': return planTitle(e, s);
      case 'sticker': return planSticker(e, s, input.assets[e.hit.pad]!);
      case 'adjust': return planAdjust(e, s);
    }
  };
  const decide = (e: Entry) => {
    // a strobe claims its light first: no change of light may sit within its range widened by the gap
    if (e.cls === 'light') {
      const c = changes.find((f) => f >= e.a - gap && f < e.b + gap);
      if (c !== undefined) { e.held = 'flash_limit'; e.since = c - e.a; return; }
    } else if (e.cls === 'colour') {
      const br = breachAt(e.a, []);
      if (br) { e.held = 'flash_limit'; e.since = br.since; return; }
    }
    const p = realise(e);
    if ('held' in p) { e.held = p.held; if (p.since !== undefined) e.since = p.since; return; }
    for (const f of p.changes) { const br = f === e.a ? null : breachAt(f, p.changes); if (br) { e.held = 'flash_limit'; e.since = br.since; return; } }
    if (steps + p.steps.length > MAX_TAKE_STEPS) { e.held = 'take_full'; return; }
    steps += p.steps.length;
    p.commit();
    for (const f of p.changes) addChange(f);
    e.steps = p.steps;
  };
  // 4: light hits (strobes) first, then every other hit in (frame, pad, tap) order
  for (const e of entries) if (e.cls === 'light') decide(e);
  for (const e of entries) if (e.cls !== 'light') decide(e);

  // chips and the arguments
  const allSteps: TemplateStep[] = [];
  let kept = 0;
  for (const e of entries) {
    if (e.steps) { kept++; allSteps.push(...e.steps); chipOf(e.hit, e.spec, 'kept', e.a, e.b - e.a); for (const m of e.merged) chipOf(m, e.spec, 'merged', e.a, e.b - e.a); }
    else { chipOf(e.hit, e.spec, 'held', e.a, e.b - e.a, e.held, e.since); for (const m of e.merged) chipOf(m, e.spec, 'held', e.a, e.b - e.a, e.held, e.since); }
  }
  const chipList = [...chips.values()].sort((x, y) => x.frame - y.frame || x.pad - y.pad || x.tap - y.tap);
  const held = chipList.filter((c) => c.state === 'held').length;
  if (!kept) return { args: null, chips: chipList, warnings };
  const merged = chipList.filter((c) => c.state === 'merged').length;
  const s = input.settings;
  const summary = [`${kept} hit${kept === 1 ? '' : 's'} kept, ${merged} merged, ${held} held, from ${input.hits.length} tap${input.hits.length === 1 ? '' : 's'} (snap ${s.snap}, tempo ${s.tempo}, strength ${r6(s.strength)})`];
  for (let pad = 0; pad < PAD_COUNT; pad++) {
    const mine = chipList.filter((c) => c.pad === pad);
    if (!mine.length) continue;
    const reasons = new Map<string, number>();
    for (const c of mine) if (c.reason) reasons.set(c.reason, (reasons.get(c.reason) ?? 0) + 1);
    const why = [...reasons].map(([r, n]) => `${r} ${n}`).join(', ');
    summary.push(`pad ${pad + 1} ${mine[0]!.moveId}: ${mine.filter((c) => c.state === 'kept').length} kept, ${mine.filter((c) => c.state === 'merged').length} merged, ${mine.filter((c) => c.state === 'held').length} held${why ? ` (${why})` : ''}`.slice(0, 400));
  }
  const args: ApplyTakeArgs = {
    ...(input.sequenceId !== undefined ? { sequenceId: input.sequenceId } : {}),
    take: { snap: s.snap, tempo: s.tempo, parity: s.parity, strength: r6(s.strength), taps: Math.min(input.hits.length, 1000), hits: kept, held: Math.min(held, 1000), summary: summary.slice(0, MAX_TAKE_SUMMARY) },
    steps: allSteps,
  };
  return { args, chips: chipList, warnings };
};
const roundParams = (p: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === 'number' ? r6(v) : v]));
