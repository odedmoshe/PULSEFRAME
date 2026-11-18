/**
 * Multicam maths and queries (ADR-0020). LEAD: the signatures, syncGrid and the rules below; W1: every body marked todo().
 * Pure; no op here writes anything (multicamOps.ts does, through applyTransaction).
 *
 * RULES OF THE BODIES (plan §1 D2–D5, §3; multicamContract.ts header)
 * - Maps are evaluated in BigInt fractions (Frac): make() throws above 2^53 timescale, so a RationalTime is built only by
 *   quantise(). Never T.fromSeconds, never a float stored (ADR-0003).
 * - A piece's map is piecewise-linear through its anchors; the end slopes extend; one anchor = a pure offset (slope 1).
 * - quantise rounds half up to syncGrid(group.sampleRate, settings.frameRate); identity on a value already on the grid, so
 *   offset-only maps are exact both ways (A→B→A is T.eq-exact).
 * - remapSource = Q(fromGroup(to, toGroup(from, s))): the ONE rounding of a switch.
 * - Group time of a segment from its sourceIn and sourceEnd (speed.ts); a timeline frame from a group time with T.snapToFrame.
 * - Lookups by id use own properties (Object.hasOwn): ids that name Object.prototype members are never plain-object keys.
 */
import * as T from '@pulseframe/time';
import { DEFAULT_TEXT_STYLE, type AngleLook, type Clip, type MediaClip, type MulticamAngle, type MulticamGroup, type MulticamPiece, type ProjectDocument, type Sequence, type TextClip, type Track } from './schema.ts';
import type { RedactRegion } from './tracking.ts';
import { isTimeEffect } from './effects.ts';
import { findLayout, layoutPlacements } from './layouts.ts';
import { isFreeze, isRamped, isReverse, sourceEnd, speedOf, toSourceSpan } from './speed.ts';
import { DEFAULT_DRIFT_TOLERANCE_FRAMES, SOUND_CHUNK_MAX_ERROR_S, SOUND_CHUNK_MAX_SECONDS, SOUND_DRIFT_CHUNK_THRESHOLD_S } from './multicamLimits.ts';
/** An exact fraction (d > 0, not necessarily reduced). Internal map arithmetic never builds a RationalTime until quantise(). */
export interface Frac { n: bigint; d: bigint }
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
/** The one grid of composed source times: lcm(sampleRate, frameRate.num). 48000@30 -> 48000; 48000@30000/1001 -> 240000. */
export const syncGrid = (sampleRate: number, frameRate: { num: number; den: number }): number => (sampleRate / gcd(sampleRate, frameRate.num)) * frameRate.num;
/** The group of a project by id (own property), or undefined. */
export const multicamGroupOf = (doc: ProjectDocument, groupId: string): MulticamGroup | undefined =>
  doc.multicam && Object.hasOwn(doc.multicam, groupId) ? doc.multicam[groupId] : undefined;
/** The groups of a project (none when it has no `multicam` key). */
export const multicamGroups = (doc: ProjectDocument): MulticamGroup[] => Object.values(doc.multicam ?? {});

// ---------- exact fractions (ADR-0003: never a float, never T.fromSeconds) ----------
const bgcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
const red = (n: bigint, d: bigint): Frac => { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d); return g > 1n ? { n: n / g, d: d / g } : { n, d }; };
const isFrac = (x: Frac | T.RationalTime): x is Frac => typeof (x as Frac).n === 'bigint';
const floorDiv = (a: bigint, b: bigint): bigint => { const q = a / b; return a % b !== 0n && (a < 0n) !== (b < 0n) ? q - 1n : q; };
/** A time (or a fraction) as an exact fraction. */
export const frac = (x: Frac | T.RationalTime): Frac => (isFrac(x) ? x : { n: BigInt(x.value), d: BigInt(x.timescale) });
export const fracAdd = (a: Frac, b: Frac): Frac => red(a.n * b.d + b.n * a.d, a.d * b.d);
export const fracSub = (a: Frac, b: Frac): Frac => red(a.n * b.d - b.n * a.d, a.d * b.d);
export const fracMul = (a: Frac, b: Frac): Frac => red(a.n * b.n, a.d * b.d);
const fdiv = (a: Frac, b: Frac): Frac => red(a.n * b.d, a.d * b.n);
export const fracCmp = (a: Frac, b: Frac): -1 | 0 | 1 => { const l = a.n * b.d, r = b.n * a.d; return l < r ? -1 : l > r ? 1 : 0; };
const fabs = (a: Frac): Frac => (a.n < 0n ? { n: -a.n, d: a.d } : a);
const fmin = (a: Frac, b: Frac): Frac => (fracCmp(a, b) <= 0 ? a : b);
const ZERO_F: Frac = { n: 0n, d: 1n };
const int = (k: number | bigint): Frac => ({ n: BigInt(k), d: 1n });
/** Lossy, for messages and reports only (never stored): a fraction in seconds. */
export const fracSeconds = (x: Frac): number => Number((x.n * 1_000_000_000n) / x.d) / 1e9;
/** A small decimal (a tolerance in frames, three decimals at most) as an exact fraction. */
const decimal = (x: number): Frac => red(BigInt(Math.round(x * 1000)), 1000n);

/** Round half up to the grid; identity for a value already on it. */
export function quantise(x: Frac | T.RationalTime, grid: number): T.RationalTime {
  const f = frac(x), G = BigInt(grid);
  return T.normalize(T.rt(floorDiv(2n * f.n * G + f.d, 2n * f.d), grid));
}
export function isPlaced(piece: MulticamPiece): boolean { return piece.anchors.length > 0; }

// ---------- piecewise-linear maps through the anchors ----------
interface MapPoints { key: string; g: Frac[]; s: Frac[] }
const maps = new WeakMap<object, MapPoints>();
function mapOf(piece: MulticamPiece): MapPoints {
  const a = piece.anchors;
  if (!a.length) throw new RangeError(`multicam: file ${piece.assetId} is not placed in group time (it has no sync anchors)`);
  const key = `${a.length}:${a[0]!.group.value}/${a[0]!.group.timescale}:${a[0]!.source.value}/${a[0]!.source.timescale}:${a.at(-1)!.group.value}/${a.at(-1)!.group.timescale}:${a.at(-1)!.source.value}/${a.at(-1)!.source.timescale}`;
  let m = maps.get(a);
  if (!m || m.key !== key) { m = { key, g: a.map((k) => frac(k.group)), s: a.map((k) => frac(k.source)) }; maps.set(a, m); }
  return m;
}
/** The linear piece of the map that x falls in (end pieces extend): the largest i in [0, n−2] with xs[i] ≤ x. */
function segIndex(xs: Frac[], x: Frac): number {
  let lo = 0, hi = xs.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fracCmp(xs[mid]!, x) <= 0) lo = mid; else hi = mid - 1; }
  return lo;
}
function through(xs: Frac[], ys: Frac[], x: Frac): Frac {
  if (xs.length === 1) return fracAdd(ys[0]!, fracSub(x, xs[0]!));
  const i = segIndex(xs, x);
  return fracAdd(ys[i]!, fdiv(fracMul(fracSub(x, xs[i]!), fracSub(ys[i + 1]!, ys[i]!)), fracSub(xs[i + 1]!, xs[i]!)));
}
/** Exact group time of a source time of this piece (piecewise-linear through anchors; end slopes extend). Throws on an unplaced piece. */
export function toGroupExact(piece: MulticamPiece, source: T.RationalTime | Frac): Frac { const m = mapOf(piece); return through(m.s, m.g, frac(source)); }
/** Exact source time of this piece shown at a group time (the inverse of toGroupExact). Throws on an unplaced piece. */
export function fromGroupExact(piece: MulticamPiece, group: T.RationalTime | Frac): Frac { const m = mapOf(piece); return through(m.g, m.s, frac(group)); }
/** Q(fromGroup(to, toGroup(from, s))): the ONE rounding of a switch. */
export function remapSource(from: MulticamPiece, to: MulticamPiece, source: T.RationalTime, grid: number): T.RationalTime {
  return quantise(fromGroupExact(to, toGroupExact(from, source)), grid);
}
/** Group-time span a placed piece covers: [toGroup(0), toGroup(assetDuration)), quantised; null when unplaced. */
export function pieceCoverage(piece: MulticamPiece, assetDuration: T.RationalTime, grid: number): { start: T.RationalTime; end: T.RationalTime } | null {
  if (!isPlaced(piece)) return null;
  return { start: quantise(toGroupExact(piece, ZERO_F), grid), end: quantise(toGroupExact(piece, assetDuration), grid) };
}
/** The grid of a group's composed source times in this project (syncGrid of the group's sample rate and the frame rate). */
export const groupGrid = (doc: ProjectDocument, group: MulticamGroup): number => syncGrid(group.sampleRate, doc.settings.frameRate);
const assetOf = (doc: ProjectDocument, id: string) => (Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined);
const clipEndOf = (c: Clip) => T.add(c.start, c.duration);

export interface TaggedSegment { sequenceId: string; track: Track; clip: MediaClip; group: MulticamGroup; angle: MulticamAngle; pieceIndex: number }
/** The tagged segment of a clip already found on its track; null when it is not one (untagged, unknown group or angle, a file of no piece). */
export function segmentOf(doc: ProjectDocument, sequenceId: string, track: Track, clip: Clip): TaggedSegment | null {
  if (clip.type !== 'media' || !clip.multicam) return null;
  const group = multicamGroupOf(doc, clip.multicam.groupId);
  const angle = group?.angles.find((a) => a.id === clip.multicam!.angleId);
  const pieceIndex = angle ? angle.pieces.findIndex((p) => p.assetId === clip.assetId) : -1;
  return group && angle && pieceIndex >= 0 ? { sequenceId, track, clip, group, angle, pieceIndex } : null;
}
/** The tagged clip with its group, angle and the index of the piece whose asset it shows; null for an untagged or unknown clip. */
export function taggedSegment(doc: ProjectDocument, clipId: string): TaggedSegment | null {
  for (const seq of Object.values(doc.sequences))
    for (const track of seq.tracks)
      for (const clip of track.clips) if (clip.id === clipId) return segmentOf(doc, seq.id, track, clip);
  return null;
}
/** Group time shown at the segment's start and end (quantised); a freeze has start = end. */
export function groupRangeOf(doc: ProjectDocument, seg: TaggedSegment): { start: T.RationalTime; end: T.RationalTime } {
  const piece = seg.angle.pieces[seg.pieceIndex]!, grid = groupGrid(doc, seg.group);
  const a = quantise(toGroupExact(piece, seg.clip.sourceIn), grid), b = quantise(toGroupExact(piece, sourceEnd(seg.clip)), grid);
  return isReverse(seg.clip) ? { start: b, end: a } : { start: a, end: b };
}
const ownSequence = (doc: ProjectDocument, id: string): Sequence | undefined => (Object.hasOwn(doc.sequences, id) ? doc.sequences[id] : undefined);
const covering = (c: Clip, t: T.RationalTime) => T.lte(c.start, t) && T.lt(t, clipEndOf(c));
/** Source time of the picture of a clip at timeline time t (speed.ts pictureSourceAt, exact for ramps too). */
function pictureSource(c: MediaClip, t: T.RationalTime, frame: T.RationalTime): Frac {
  const off = c.reverse ? T.sub(T.sub(c.duration, frame), T.sub(t, c.start)) : T.sub(t, c.start);
  return fracAdd(frac(c.sourceIn), frac(toSourceSpan(c, off)));
}
/** Group time of the picture on a program track at timeline time t (the tagged segment under t), or null. */
export function groupTimeAt(doc: ProjectDocument, sequenceId: string, trackId: string, t: T.RationalTime): { groupId: string; g: T.RationalTime; clipId: string } | null {
  const seq = ownSequence(doc, sequenceId), track = seq?.tracks.find((x) => x.id === trackId);
  if (!seq || !track) return null;
  const frame = T.frameTime(1, doc.settings.frameRate);
  for (const c of track.clips) {
    if (!covering(c, t)) continue;
    const seg = segmentOf(doc, seq.id, track, c);
    const piece = seg?.angle.pieces[seg.pieceIndex];
    if (!seg || !piece || !isPlaced(piece)) return null;
    return { groupId: seg.group.id, g: quantise(toGroupExact(piece, pictureSource(seg.clip, t, frame)), groupGrid(doc, seg.group)), clipId: c.id };
  }
  return null;
}
/**
 * Where a program track shows each group time of a group: built once for many lookups (a recorded session resolves up to a
 * thousand group-time cuts). Only forward or reversed constant-speed segments of placed files are indexed (a freeze shows one
 * moment, a ramp has no exact inverse). The lookup returns the frame-snapped timeline time (T.snapToFrame of the exact time),
 * nearest to `near` when the group time occurs more than once (the earliest without `near`), or null when it was cut out.
 */
export function programLocator(doc: ProjectDocument, sequenceId: string, trackId: string, groupId: string): (g: T.RationalTime | Frac, near?: T.RationalTime) => T.RationalTime | null {
  const seq = ownSequence(doc, sequenceId), track = seq?.tracks.find((x) => x.id === trackId);
  const rate = doc.settings.frameRate;
  const entries: { clip: MediaClip; piece: MulticamPiece; s0: Frac; s1: Frac; lo: number; hi: number }[] = [];
  for (const c of track?.clips ?? []) {
    const seg = seq && track ? segmentOf(doc, seq.id, track, c) : null;
    if (!seg || seg.group.id !== groupId || isFreeze(seg.clip) || isRamped(seg.clip)) continue;
    const piece = seg.angle.pieces[seg.pieceIndex]!;
    if (!isPlaced(piece)) continue;
    const s0 = frac(seg.clip.sourceIn), s1 = frac(sourceEnd(seg.clip));
    const g0 = fracSeconds(toGroupExact(piece, s0)), g1 = fracSeconds(toGroupExact(piece, s1));
    entries.push({ clip: seg.clip, piece, s0, s1, lo: Math.min(g0, g1) - 1e-6, hi: Math.max(g0, g1) + 1e-6 });
  }
  return (g, near) => {
    const gf = frac(g), gn = fracSeconds(gf);
    let best: T.RationalTime | null = null;
    for (const e of entries) {
      if (gn < e.lo || gn > e.hi) continue;
      const s = fromGroupExact(e.piece, gf);
      if (fracCmp(s, e.s0) < 0 || fracCmp(s, e.s1) >= 0) continue;
      const sp = speedOf(e.clip);
      const off = fracMul(e.clip.reverse ? fracSub(e.s1, s) : fracSub(s, e.s0), red(BigInt(sp.den), BigInt(sp.num)));
      const t = fracAdd(frac(e.clip.start), off);
      const idx = floorDiv(2n * t.n * BigInt(rate.num) + t.d * BigInt(rate.den), 2n * t.d * BigInt(rate.den));
      const at = T.frameTime(Number(idx), rate);
      if (!best) { best = at; continue; }
      if (near ? T.lt(T.max(T.sub(at, near), T.sub(near, at)), T.max(T.sub(best, near), T.sub(near, best))) : T.lt(at, best)) best = at;
    }
    return best;
  };
}
/** Frame-snapped timeline time at which the program track shows group time g of groupId; nearest to `near` when it occurs more than once; null when cut out. */
export function timelineAtGroupTime(doc: ProjectDocument, sequenceId: string, trackId: string, groupId: string, g: T.RationalTime, near?: T.RationalTime): T.RationalTime | null {
  return programLocator(doc, sequenceId, trackId, groupId)(g, near);
}
/** The master sound clip of a group covering t: a tagged clip of a sound angle, or of the reference angle, on an audio track (the latest-starting one where chunks overlap). */
function masterAt(doc: ProjectDocument, sequenceId: string, groupId: string, t: T.RationalTime): { clip: MediaClip; piece: MulticamPiece; group: MulticamGroup } | null {
  const seq = ownSequence(doc, sequenceId);
  let best: { clip: MediaClip; piece: MulticamPiece; group: MulticamGroup } | null = null;
  for (const track of seq?.tracks ?? []) {
    if (track.kind !== 'audio') continue;
    for (const c of track.clips) {
      if (!covering(c, t)) continue;
      const seg = segmentOf(doc, sequenceId, track, c);
      if (!seg || seg.group.id !== groupId || !(seg.angle.kind === 'sound' || seg.angle.id === seg.group.referenceAngleId)) continue;
      const piece = seg.angle.pieces[seg.pieceIndex]!;
      if (!isPlaced(piece) || isReverse(seg.clip)) continue;
      if (!best || T.lt(best.clip.start, seg.clip.start)) best = { clip: seg.clip, piece, group: seg.group };
    }
  }
  return best;
}
/** Group time of the master sound (a tagged clip of a sound angle, or of the reference angle, on an audio track) covering t, or null. */
export function masterGroupTimeAt(doc: ProjectDocument, sequenceId: string, groupId: string, t: T.RationalTime): T.RationalTime | null {
  const m = masterAt(doc, sequenceId, groupId, t);
  if (!m) return null;
  return quantise(toGroupExact(m.piece, fracAdd(frac(m.clip.sourceIn), frac(toSourceSpan(m.clip, T.sub(t, m.clip.start))))), groupGrid(doc, m.group));
}
/** How far a picture segment is out of step with the master sound at its start and end (positive = picture late). Null when no master sound covers it. */
export interface SyncOffset { clipId: string; startSeconds: number; endSeconds: number; startFrames: number; endFrames: number; slipBy: T.RationalTime }
export function segmentSyncOffset(doc: ProjectDocument, clipId: string): SyncOffset | null {
  const seg = taggedSegment(doc, clipId);
  if (!seg || seg.track.kind !== 'video') return null;
  const piece = seg.angle.pieces[seg.pieceIndex]!;
  if (!isPlaced(piece)) return null;
  const rate = doc.settings.frameRate, frame = T.frameTime(1, rate), grid = groupGrid(doc, seg.group), c = seg.clip;
  const tS = c.start, tE = T.lt(frame, c.duration) ? T.sub(clipEndOf(c), frame) : c.start;
  const picture = (t: T.RationalTime) => quantise(toGroupExact(piece, pictureSource(c, t, frame)), grid);
  let mS = masterGroupTimeAt(doc, seg.sequenceId, seg.group.id, tS), mE = masterGroupTimeAt(doc, seg.sequenceId, seg.group.id, tE);
  if (!mS && !mE) return null;
  mS ??= T.sub(mE!, T.sub(tE, tS));
  mE ??= T.add(mS, T.sub(tE, tS));
  const offS = T.sub(mS, picture(tS)), offE = T.sub(mE, picture(tE));
  const fps = rate.num / rate.den;
  const sp = speedOf(c);
  // the slip that puts the start back in step: the offset in timeline time (source / speed), on the frame grid
  const by = fracMul(frac(offS), red(BigInt(sp.den), BigInt(sp.num)));
  const idx = floorDiv(2n * by.n * BigInt(rate.num) + by.d * BigInt(rate.den), 2n * by.d * BigInt(rate.den));
  return { clipId, startSeconds: T.toSeconds(offS), endSeconds: T.toSeconds(offE), startFrames: T.toSeconds(offS) * fps, endFrames: T.toSeconds(offE) * fps, slipBy: T.frameTime(Number(idx), rate) };
}

// ---------- covering a stretch of program with the pieces of one angle ----------
/** Why a part starts where it does: the first of a run, after a stretch nothing covers, at the edge of the previous file, or at a drift through-edit (re-anchored). */
export type PartStart = 'start' | 'gap' | 'piece-boundary' | 'drift';
export interface CoverPart { k0: number; k1: number; pieceIndex: number; sourceIn: T.RationalTime; after: PartStart; chunked: boolean }
export interface CoverOptions {
  /** Exact group time shown at the start of program frame k (monotone non-decreasing in k). */
  gAt: (k: number) => Frac;
  /** Frames [from, frames) to cover. */
  from?: number; frames: number;
  /** Source time one program frame of a part plays (one frame at speed 1; 0 for a freeze). */
  span: Frac;
  /** The project frame. */
  frame: Frac;
  /** Through-edits: picture (every frame start within tolerance of the map) or sound (chunks: the whole chunk within tolerance, 1-frame overlaps, at most SOUND_CHUNK_MAX_SECONDS). Only at speed 1. */
  drift: { tolerance: Frac; mode: 'picture' | 'sound' } | null;
  grid: number;
}
/**
 * Largest Δ in [0, limit] such that the error e(δ) = fromGroup(p, gs + δ) − (s0 + δ) stays within ±tol for every δ in [0, Δ]
 * (e is piecewise-linear, so this is exact per linear piece of the map); 0 when e(0) is already outside.
 */
function driftReach(p: MulticamPiece, gs: Frac, s0: Frac, tol: Frac, limit: Frac): Frac {
  const m = mapOf(p);
  let e = fracSub(fromGroupExact(p, gs), s0);
  if (fracCmp(fabs(e), tol) > 0) return ZERO_F;
  if (m.g.length === 1) return limit;
  let lo = ZERO_F, i = segIndex(m.g, gs);
  for (;;) {
    const last = i >= m.g.length - 2;
    const hi = last ? limit : fmin(limit, fracSub(m.g[i + 1]!, gs));
    const k = fracSub(fdiv(fracSub(m.s[i + 1]!, m.s[i]!), fracSub(m.g[i + 1]!, m.g[i]!)), int(1)); // slope of e on this piece
    if (k.n !== 0n) {
      const reach = fracAdd(lo, fdiv(fracSub(k.n > 0n ? tol : { n: -tol.n, d: tol.d }, e), k));
      if (fracCmp(reach, hi) < 0) return fracCmp(reach, lo) < 0 ? lo : reach;
    }
    if (last || fracCmp(hi, limit) >= 0) return limit;
    e = fracAdd(e, fracMul(k, fracSub(hi, lo)));
    lo = hi; i++;
  }
}
/** Exact largest |e(δ)| over [0, len] (see driftReach): at the ends and at the anchors in between. */
function errMax(p: MulticamPiece, gs: Frac, s0: Frac, len: Frac): Frac {
  const m = mapOf(p);
  const e = (d: Frac) => fabs(fracSub(fromGroupExact(p, fracAdd(gs, d)), fracAdd(s0, d)));
  let best = fracCmp(e(ZERO_F), e(len)) >= 0 ? e(ZERO_F) : e(len);
  const end = fracAdd(gs, len);
  for (const g of m.g) if (fracCmp(g, gs) > 0 && fracCmp(g, end) < 0) { const x = e(fracSub(g, gs)); if (fracCmp(x, best) > 0) best = x; }
  return best;
}
/**
 * The parts that show a stretch of program with the files of one angle: frame k shows group time gAt(k). A part is a run of
 * frames on one placed file, frame-aligned, inside the file; a new part starts at a file edge and at a drift through-edit,
 * re-anchored there with Q(fromGroup(piece, gAt(k))). Frames no file covers are returned as uncovered. Shared by place_multicam
 * (planPicture, planSound) and switch_angles, so both follow one rule.
 */
export function coverParts(doc: ProjectDocument, angle: MulticamAngle, o: CoverOptions): { parts: CoverPart[]; uncovered: { k0: number; k1: number }[] } {
  const N = o.frames;
  const pcs = angle.pieces.flatMap((p, i) => { const a = assetOf(doc, p.assetId); return isPlaced(p) && a ? [{ p, i, D: frac(a.duration) }] : []; });
  const freeze = o.span.n === 0n;
  const at = (x: (typeof pcs)[number], k: number) => quantise(fromGroupExact(x.p, o.gAt(k)), o.grid);
  const started = (x: (typeof pcs)[number], k: number) => !T.isNegative(at(x, k));
  const ended = (x: (typeof pcs)[number], k: number) => { const s = frac(at(x, k)); return freeze ? fracCmp(s, x.D) >= 0 : fracCmp(fracAdd(s, o.span), x.D) > 0; };
  const parts: CoverPart[] = [], uncovered: { k0: number; k1: number }[] = [];
  const speedOne = !freeze && fracCmp(o.span, o.frame) === 0;
  const chunkCap = Number(floorDiv(BigInt(SOUND_CHUNK_MAX_SECONDS) * o.frame.d, o.frame.n));
  const threshold = red(BigInt(Math.round(SOUND_DRIFT_CHUNK_THRESHOLD_S * 1e6)), 1_000_000n);
  let k = o.from ?? 0, after: PartStart = 'start', chunking = false;
  // picture: a file that starts less than the drift tolerance after this frame starts (the second file of a card change,
  // measured a fraction of a frame later than the first one ends) shows from its first frame here, instead of leaving a
  // one-frame hole that the fill would show as a flash of another angle; the error is within the through-edit tolerance
  const startsWithin = (c: (typeof pcs)[number], k: number) => o.drift?.mode === 'picture' && !started(c, k) && fracCmp(fabs(frac(at(c, k))), o.drift.tolerance) <= 0;
  while (k < N) {
    let x = pcs.find((c) => started(c, k) && !ended(c, k));
    let snapped = false;
    if (!x) { x = pcs.find((c) => startsWithin(c, k)); snapped = !!x; }
    if (!x) {
      let next = N;
      for (const c of pcs) {
        if (ended(c, k)) continue;
        let lo = k + 1, hi = N; // smallest k' in [k+1, N) with the file started, else N
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2); if (started(c, mid)) hi = mid; else lo = mid + 1; }
        if (lo > k + 1 && lo <= N && startsWithin(c, lo - 1)) lo--; // the frame before it shows it (startsWithin)
        if (lo < next && lo < N && !ended(c, lo)) next = lo;
      }
      uncovered.push({ k0: k, k1: next });
      k = next; after = 'gap'; chunking = false;
      continue;
    }
    const s = snapped ? T.ZERO : at(x, k), sf = frac(s);
    let n = N - k;
    if (!freeze) { const room = fracSub(x.D, sf); n = Math.min(n, Number(floorDiv(room.n * o.span.d, room.d * o.span.n))); }
    let byDrift = false;
    if (o.drift && speedOne) {
      const g = o.gAt(k);
      if (o.drift.mode === 'picture') {
        const reach = driftReach(x.p, g, sf, o.drift.tolerance, fracMul(int(n), o.frame));
        const m = Number(floorDiv(reach.n * o.frame.d, reach.d * o.frame.n)) + 1;
        if (m < n) { n = Math.max(1, m); byDrift = true; }
      } else {
        if (!chunking && fracCmp(driftReach(x.p, g, sf, threshold, fracMul(int(n), o.frame)), fracMul(int(n), o.frame)) < 0) chunking = true;
        if (chunking) {
          const reach = driftReach(x.p, g, sf, o.drift.tolerance, fracMul(int(n), o.frame));
          const L = Math.min(n, chunkCap, Math.max(2, Number(floorDiv(reach.n * o.frame.d, reach.d * o.frame.n))));
          if (L < n) { n = L; byDrift = true; }
        }
      }
    }
    parts.push({ k0: k, k1: k + n, pieceIndex: x.i, sourceIn: s, after, chunked: chunking });
    if (byDrift) { after = 'drift'; k = o.drift!.mode === 'sound' ? k + n - 1 : k + n; }
    else { after = 'piece-boundary'; k += n; chunking = false; }
  }
  return { parts, uncovered };
}

// ---------- planning a program ----------
export interface PlannedPicture { start: T.RationalTime; duration: T.RationalTime; angleId: string; pieceIndex: number; assetId: string; sourceIn: T.RationalTime; reason: 'angle' | 'fill' | 'piece-boundary' | 'drift' }
export interface PlannedSound { start: T.RationalTime; duration: T.RationalTime; angleId: string; pieceIndex: number; assetId: string; sourceIn: T.RationalTime; fadeIn?: T.RationalTime; fadeOut?: T.RationalTime }
export interface AnglePlanArgs { angleId: string; at: T.RationalTime; g0: T.RationalTime; duration: T.RationalTime; fill: boolean; driftToleranceFrames: number }
const mustAngleOf = (group: MulticamGroup, angleId: string): MulticamAngle => {
  const a = group.angles.find((x) => x.id === angleId);
  if (!a) throw new RangeError(`multicam: angle ${angleId} is not an angle of group ${group.id}`);
  return a;
};
/** The picture tolerance of drift through-edits as an exact time: driftToleranceFrames (three decimals) project frames. */
export const driftTolerance = (doc: ProjectDocument, frames: number = DEFAULT_DRIFT_TOLERANCE_FRAMES): Frac => fracMul(decimal(frames), frac(T.frameTime(1, doc.settings.frameRate)));
/** Picture segments showing group time g0 + (t − at) for t in [at, at+duration): split at piece edges and drift through-edits; gaps filled from covering placed angles when fill. All frame-aligned. */
export function planPicture(doc: ProjectDocument, group: MulticamGroup, a: AnglePlanArgs): { segments: PlannedPicture[]; uncovered: { start: T.RationalTime; end: T.RationalTime }[] } {
  const rate = doc.settings.frameRate, frame = frac(T.frameTime(1, rate)), grid = groupGrid(doc, group);
  const N = T.frameIndexAt(a.duration, rate), g0 = frac(a.g0);
  const gAt = (k: number) => fracAdd(g0, fracMul(int(k), frame));
  const opts = { gAt, frames: N, span: frame, frame, drift: { tolerance: driftTolerance(doc, a.driftToleranceFrames), mode: 'picture' as const }, grid };
  const plan: { angle: MulticamAngle; part: CoverPart; fill: boolean }[] = [];
  const main = mustAngleOf(group, a.angleId);
  const first = coverParts(doc, main, opts);
  for (const part of first.parts) plan.push({ angle: main, part, fill: false });
  let uncovered = first.uncovered;
  if (a.fill) {
    const others = [...group.angles.filter((x) => x.id === group.wideAngleId), ...group.angles.filter((x) => x.id !== group.wideAngleId)].filter((x) => x.id !== main.id && x.kind === 'picture' && x.pieces.some(isPlaced));
    for (const other of others) {
      const left: { k0: number; k1: number }[] = [];
      for (const u of uncovered) {
        const sub = coverParts(doc, other, { ...opts, from: u.k0, frames: u.k1 });
        for (const part of sub.parts) plan.push({ angle: other, part, fill: true });
        left.push(...sub.uncovered);
      }
      uncovered = left;
    }
  }
  plan.sort((x, y) => x.part.k0 - y.part.k0);
  const segments = plan.map(({ angle, part, fill }): PlannedPicture => ({
    start: T.add(a.at, T.frameTime(part.k0, rate)), duration: T.frameTime(part.k1 - part.k0, rate), angleId: angle.id, pieceIndex: part.pieceIndex,
    assetId: angle.pieces[part.pieceIndex]!.assetId, sourceIn: part.sourceIn,
    reason: part.after === 'drift' ? 'drift' : part.after === 'piece-boundary' ? 'piece-boundary' : fill ? 'fill' : 'angle',
  }));
  return { segments, uncovered: uncovered.map((u) => ({ start: T.add(a.g0, T.frameTime(u.k0, rate)), end: T.add(a.g0, T.frameTime(u.k1, rate)) })) };
}
/** Sound of one angle for the same span: one clip, or chunks (1-frame overlap, 1-frame fades) when drift exceeds SOUND_DRIFT_CHUNK_THRESHOLD_S. */
export function planSound(doc: ProjectDocument, group: MulticamGroup, a: Omit<AnglePlanArgs, 'fill' | 'driftToleranceFrames'>): { clips: PlannedSound[]; chunks: number; maxErrorSeconds: number } {
  const rate = doc.settings.frameRate, fl = T.frameTime(1, rate), frame = frac(fl), grid = groupGrid(doc, group);
  const N = T.frameIndexAt(a.duration, rate), g0 = frac(a.g0);
  const gAt = (k: number) => fracAdd(g0, fracMul(int(k), frame));
  const angle = mustAngleOf(group, a.angleId);
  const tol = red(BigInt(Math.round(SOUND_CHUNK_MAX_ERROR_S * 1e6)), 1_000_000n);
  const { parts } = coverParts(doc, angle, { gAt, frames: N, span: frame, frame, drift: { tolerance: tol, mode: 'sound' }, grid });
  let worst = ZERO_F, chunks = 0;
  const clips = parts.map((p, i): PlannedSound => {
    const piece = angle.pieces[p.pieceIndex]!;
    const len = fracMul(int(p.k1 - p.k0), frame);
    const err = errMax(piece, gAt(p.k0), frac(p.sourceIn), len);
    if (fracCmp(err, worst) > 0) worst = err;
    if (p.chunked) chunks++;
    const next = parts[i + 1];
    return {
      start: T.add(a.at, T.frameTime(p.k0, rate)), duration: T.frameTime(p.k1 - p.k0, rate), angleId: angle.id, pieceIndex: p.pieceIndex, assetId: piece.assetId, sourceIn: p.sourceIn,
      ...(p.after === 'drift' ? { fadeIn: fl } : {}), ...(next?.after === 'drift' ? { fadeOut: fl } : {}),
    };
  });
  return { clips, chunks, maxErrorSeconds: fracSeconds(worst) };
}

// ---------- looks ----------
const PLACEMENT = ['x', 'y', 'scale', 'rotation'] as const;
/** The look a segment carries (for set_angle_look): effect param keyframes stripped; time effects excluded; per-variant transforms collected; the piece's redact and follow. */
export function lookOfClip(doc: ProjectDocument, clip: MediaClip): { look: AngleLook; redact: RedactRegion[] | undefined; follow: MediaClip['follow']; dropped: string[] } {
  const dropped = new Set<string>();
  if (PLACEMENT.some((p) => clip.keyframes?.[p]?.length)) dropped.add('keyframes');
  const effects = (clip.effects ?? []).filter((e) => !isTimeEffect(e.type)).map((e) => {
    const { keyframes, ...rest } = structuredClone(e);
    if (keyframes && Object.keys(keyframes).length) dropped.add('effect_keyframes');
    return rest;
  });
  const variantTransforms: Record<string, NonNullable<AngleLook['variantTransforms']>[string]> = {};
  for (const v of Object.values(doc.variants ?? {})) { const ov = Object.hasOwn(v.overrides, clip.id) ? v.overrides[clip.id] : undefined; if (ov?.transform && Object.keys(ov.transform).length) variantTransforms[v.id] = structuredClone(ov.transform); }
  const look: AngleLook = {
    transform: { ...clip.transform },
    ...(effects.length ? { effects } : {}), ...(clip.mask ? { mask: structuredClone(clip.mask) } : {}), ...(clip.blend ? { blend: clip.blend } : {}),
    ...(Object.keys(variantTransforms).length ? { variantTransforms } : {}),
  };
  return { look, redact: clip.redact ? structuredClone(clip.redact) : undefined, follow: clip.follow ? structuredClone(clip.follow) : undefined, dropped: [...dropped] };
}

// ---------- the angle viewer ----------
const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Layout of n live tiles (layouts.ts): 2 side by side, 3–4 a 2×2 grid, 5–9 a 3×3 grid; one tile fills the frame. */
const viewerLayout = (n: number): string | null => (n <= 1 ? null : n === 2 ? 'layout.side-by-side' : n <= 4 ? 'layout.grid-2x2' : 'layout.grid-3x3');
/**
 * Never-saved grid document of the live angles over group span [g0, g0+duration): one video track per piece, cells from layoutPlacements, label text clips, no sound. Frame f shows group time g0 + frameTime(f).
 * `rtl`: the cells are mirrored left-right so tile 1 sits top right, as a right-to-left reader reads it (the tile buttons' order); each picture's own framing is not mirrored.
 */
export function multiviewDocument(doc: ProjectDocument, groupId: string, opts: { liveAngleIds: string[]; g0: T.RationalTime; duration: T.RationalTime; width: number; height: number; rtl?: boolean }): ProjectDocument {
  const group = multicamGroupOf(doc, groupId);
  if (!group) throw new RangeError(`multicam: group ${groupId} not found`);
  const rate = doc.settings.frameRate;
  const N = T.frameIndexAt(opts.duration, rate), dur = T.frameTime(N, rate);
  const live = opts.liveAngleIds.map((id) => group.angles.find((a) => a.id === id)).filter((a): a is MulticamAngle => !!a && a.kind === 'picture').slice(0, 9);
  const W = opts.width, H = opts.height, fit = doc.settings.fit ?? 'contain';
  const size = (a: MulticamAngle) => { const v = assetOf(doc, a.pieces[0]!.assetId)?.video; return v ? { width: v.width, height: v.height } : { width: W, height: H }; };
  const layoutId = viewerLayout(live.length);
  const def = layoutId ? findLayout(layoutId)! : null;
  const slots = def ? def.slots : [{ x: 0, y: 0, w: 1, h: 1 }];
  const placements = def && live.length ? layoutPlacements(def.id, { frame: { width: W, height: H }, fit, pictures: Array.from({ length: def.count }, (_, i) => size(live[Math.min(i, live.length - 1)]!)) }) : [{ transform: { x: 0, y: 0, scale: 1 }, mask: null }];
  const tracks: Track[] = [];
  const labels: TextClip[] = []; // one text track each (titles on one track may not overlap)
  live.forEach((angle, i) => {
    const m = opts.rtl === true, s0 = slots[i]!, slot = m ? { ...s0, x: 1 - s0.x - s0.w } : s0, p0 = placements[i]!, look = angle.look?.transform;
    const place = m ? { ...p0, transform: { ...p0.transform, x: -p0.transform.x } } : p0; // the cell mirrored about the frame's centre line
    const pic = size(angle), f = (fit === 'cover' ? Math.max : Math.min)(W / pic.width, H / pic.height), w0 = (pic.width * f) / W, h0 = (pic.height * f) / H;
    const s = place.transform.scale * (look?.scale ?? 1);
    const transform = { x: clampN(place.transform.x + (look?.x ?? 0) * slot.w, -4, 4), y: clampN(place.transform.y + (look?.y ?? 0) * slot.h, -4, 4), scale: clampN(s, 0.01, 20), rotation: look?.rotation ?? 0, opacity: 1 };
    // crop to the cell, in layer space (before scale), wherever the look moved the picture inside it
    const mw = slot.w / (w0 * s), mh = slot.h / (h0 * s), mx = -((look?.x ?? 0) * slot.w) / (w0 * s), my = -((look?.y ?? 0) * slot.h) / (h0 * s);
    const crops = live.length > 1 && (mw < 1 - 1e-9 || mh < 1 - 1e-9 || Math.abs(mx) > 1e-9 || Math.abs(my) > 1e-9);
    const mask = crops ? { shape: 'rect' as const, x: clampN(mx, -1, 1), y: clampN(my, -1, 1), width: clampN(mw, 0.01, 2), height: clampN(mh, 0.01, 2), radius: 0, feather: 0, invert: false } : undefined;
    const plan = planPicture(doc, group, { angleId: angle.id, at: T.ZERO, g0: opts.g0, duration: dur, fill: false, driftToleranceFrames: DEFAULT_DRIFT_TOLERANCE_FRAMES });
    angle.pieces.forEach((piece, pi) => {
      const clips = plan.segments.filter((x) => x.pieceIndex === pi).map((x, j): MediaClip => ({
        id: `mv_c${i}_${pi}_${j}`, type: 'media', assetId: x.assetId, start: x.start, duration: x.duration, sourceIn: x.sourceIn, gain: 0, linkGroupId: null, transform,
        ...(angle.look?.effects?.length ? { effects: angle.look.effects.map((e, n) => ({ ...structuredClone(e), id: `mv_fx${i}_${pi}_${j}_${n}` })) } : {}),
        ...(mask ? { mask } : {}), ...(piece.redact ? { redact: structuredClone(piece.redact) } : {}),
      }));
      tracks.push({ id: `mv_v${i}_${pi}`, kind: 'video', name: `${angle.label} ${pi + 1}`, locked: false, muted: true, hidden: false, clips });
    });
    if (N > 0) labels.push({ id: `mv_l${i}`, type: 'text', start: T.ZERO, duration: dur, text: angle.label, style: { ...DEFAULT_TEXT_STYLE, sizeFrac: clampN(0.05 * slot.h, 0.005, 1) },
      transform: { x: clampN(slot.x + slot.w / 2 - 0.5, -4, 4), y: clampN(slot.y + slot.h * 0.9 - 0.5, -4, 4), scale: 1, rotation: 0, opacity: 1 } });
  });
  labels.forEach((c, i) => tracks.push({ id: `mv_t${i}`, kind: 'text', name: `T${i + 1}`, locked: false, muted: false, hidden: false, clips: [c] }));
  const { width: _w, height: _h, ...settings } = doc.settings;
  return {
    ...structuredClone({ ...doc, sequences: {}, variants: {}, markers: {}, recipeRuns: {} }),
    settings: { ...structuredClone(settings), width: W, height: H },
    sequences: { [doc.mainSequenceId]: { id: doc.mainSequenceId, name: `${group.name} · multiview`, tracks } },
  };
}
