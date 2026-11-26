/**
 * Marked source ranges — «פנינים» (wave 7 pearls track): the pure functions, the cascades and the validation. BUILDER A owns this
 * file (decisions §5); the contract is sourceRangesContract.ts.
 *
 * MODULE RULE: ops.ts, peopleOps.ts and validate.ts import this file, so it must not use a value of ops.ts (or of the contract,
 * which imports ops.ts) while the module loads; inside functions it may. Keep the op registrations in sourceRangeOps.ts. The
 * contract's numbers this file needs (the cap, the issue code, the usage limits) are repeated below as plain constants, and
 * sourceRanges.test.ts checks they equal the contract's.
 *
 * RULES OF THE BODIES (decisions §2, verifier C6–C8):
 * - Own-property lookups only (Object.hasOwn); `people` ids may name Object.prototype members (PERSON_ID allows "constructor").
 * - No float seconds, no Date, no localeCompare and no Intl here: exact rationals (packages/time); people ordered by
 *   personNameKey with `<`, then id; lists by capture wall (events.ts compareWall), asset id, span start (T.cmp), range id.
 * - rangeUsage: group ranges by timeLineage root and call timingRelations once per root (memo per document object). With delta
 *   the copy's offset and s′ = s + delta, e′ = e + delta on the clip's asset: a clip on a video track whose file has video counts
 *   frame i when k(i) = sourceFrameIndexAt(asset, clip, clip.start + i/rate, rate) has kLo ≤ k < kHi, kLo = sourceFrameOfTime(asset,
 *   s′), kHi = the first k with sourceTimeOfFrame(asset, k) ≥ e′ (at least kLo + 1); k(i) is monotone, so two binary searches find
 *   the run (a freeze clip has one k); an audio-track clip or a file without video: s′ ≤ pictureSourceAt(...) < e′; a still or a
 *   whole range: every frame. No reject by [sourceIn, sourceEnd) (a freeze clip would be lost); reject by k of the first and last
 *   frame. Untimed copies are listed, never counted. Transition handles and time-effect taps are not counted (USAGE_LIMITS).
 *   A whole-file range seen through a copy is the stretch [0, duration) of its own file, counted by the span rule.
 *   A span that lies wholly before the copy's time zero (e′ ≤ 0) or at or after its end (s′ ≥ its duration) is not in the copy.
 * - screenTime: visible video tracks only; interval unions on sorted integer pairs.
 * - detachRangesOfAsset / untagPerson mutate the draft and return the entity ids they changed (the range ids), deleting the
 *   `sourceRanges` key when it empties; untagPerson removes a presence range left with nobody and drops an emptied `people`.
 */
import * as T from '@pulseframe/time';
import type { Asset, MediaClip, ProjectDocument, SourceRange, SourceSpan } from './schema.ts';
import type { Issue } from './validate.ts';
import type { PlaceRangeArgs, RangeFilter, RangeUsage, RangeUse, ScreenTime, UsageResult } from './sourceRangesContract.ts';
import { pictureSourceAt, sourceFrameIndexAt, sourceFrameOfTime, sourceTimeOfFrame } from './speed.ts';
import { timeLineage, timingRelations, type TimingRelation } from './lineage.ts';
import { personNameKey } from './people.ts';
import { compareWall } from './events.ts';
import { shownCapture } from './capture.ts';
import { verbatimTokens } from './quotes.ts';
import { sha256Hex } from './sha256.ts';

/** Thrown by a function of this file that cannot answer (kept for callers that catch it; nothing throws it once built). */
export class SourceRangesNotBuilt extends Error {
  constructor(what: string) { super(`${what}: marked ranges are not built in this build yet`); this.name = 'SourceRangesNotBuilt'; }
}
/** = sourceRangesContract.ts MAX_SOURCE_RANGES / SOURCE_RANGE_ISSUE / USAGE_LIMITS (no load-time import of the contract). */
const MAX_RANGES = 2000;
const ISSUE = 'source_range';
const LIMITS = ['transition_handles', 'time_effect_taps'] as const;

const own = <V>(rec: Record<string, V> | undefined, id: string): V | undefined => (rec && Object.hasOwn(rec, id) ? rec[id] : undefined);
const byStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every range of the document by id ({} when none). */
export function rangesOf(doc: ProjectDocument): Readonly<Record<string, SourceRange>> { return doc.sourceRanges ?? {}; }
/** A range by id, own property only; null when absent. */
export function sourceRangeOf(doc: ProjectDocument, rangeId: string): SourceRange | null { return own(doc.sourceRanges, rangeId) ?? null; }
/** The span a range covers in its asset's time: its own, or [0, duration) for span null. */
export function rangeSpan(doc: ProjectDocument, range: SourceRange): SourceSpan {
  if (range.span) return range.span;
  const asset = own(doc.assets, range.assetId);
  return { start: T.ZERO, end: asset ? asset.duration : T.ZERO };
}

// ---------- list order (C7) ----------
/** Range ids in list order: capture wall (dated first), asset id, span start (a whole file starts at 0), range id. */
export function rangeListOrder(doc: ProjectDocument): string[] {
  const walls = new Map<string, string | null>();
  const wall = (assetId: string) => { if (!walls.has(assetId)) walls.set(assetId, Object.hasOwn(doc.assets, assetId) ? shownCapture(doc, assetId)?.wall ?? null : null); return walls.get(assetId)!; };
  return Object.values(rangesOf(doc)).sort((a, b) => {
    const wa = wall(a.assetId), wb = wall(b.assetId);
    if (wa !== wb) { if (wa === null) return 1; if (wb === null) return -1; const c = compareWall(wa, wb); if (c) return c; const s = byStr(wa, wb); if (s) return s; }
    return byStr(a.assetId, b.assetId) || T.cmp(a.span?.start ?? T.ZERO, b.span?.start ?? T.ZERO) || byStr(a.id, b.id);
  }).map((r) => r.id);
}

// ---------- usage (C6, C7) ----------
interface ClipSite { sequenceId: string; trackId: string; trackKind: 'video' | 'audio'; hidden: boolean; clip: MediaClip; fromFrame: number; toFrame: number }
/** The first project frame whose time is at or after `t`. */
const ceilFrame = (t: T.RationalTime, rate: T.Rate) => T.frameIndexAt(t, rate) + (T.isFrameAligned(t, rate) ? 0 : 1);
/** Every media clip of every sequence on a video or audio track, with its project frames [fromFrame, toFrame). */
function clipSites(doc: ProjectDocument): Map<string, ClipSite[]> {
  const rate = doc.settings.frameRate;
  const byAsset = new Map<string, ClipSite[]>();
  for (const [sequenceId, seq] of Object.entries(doc.sequences)) {
    for (const track of seq.tracks) {
      if (track.kind !== 'video' && track.kind !== 'audio') continue;
      for (const clip of track.clips) {
        if (clip.type !== 'media') continue;
        const fromFrame = ceilFrame(clip.start, rate), toFrame = ceilFrame(T.add(clip.start, clip.duration), rate);
        if (toFrame <= fromFrame) continue;
        let list = byAsset.get(clip.assetId);
        if (!list) byAsset.set(clip.assetId, (list = []));
        list.push({ sequenceId, trackId: track.id, trackKind: track.kind, hidden: track.hidden, clip, fromFrame, toFrame });
      }
    }
  }
  return byAsset;
}
/** The first index in [lo, hi) for which `pred` holds (pred is false…false true…true), or hi. */
function lowerBound(lo: number, hi: number, pred: (i: number) => boolean): number {
  while (lo < hi) { const mid = lo + Math.floor((hi - lo) / 2); if (pred(mid)) hi = mid; else lo = mid + 1; }
  return lo;
}
/** The first source frame k of `asset` with sourceTimeOfFrame(asset, k) ≥ t (never below 0). */
function firstFrameAtOrAfter(asset: { video: NonNullable<Asset['video']> }, t: T.RationalTime): number {
  const k = sourceFrameOfTime(asset, t);
  return T.lt(sourceTimeOfFrame(asset, k), t) ? k + 1 : k;
}
/**
 * The run of project frames of a clip whose class is 0, where cls(f) is −1 below the span, 0 in it and 1 at or past it. The class
 * is monotone in f: rising for a forward (or frozen, or ramped) clip, falling for a reversed one.
 */
function runOf(site: ClipSite, reverse: boolean, cls: (f: number) => -1 | 0 | 1): [number, number] {
  const { fromFrame: a, toFrame: b } = site;
  const first = cls(a), last = cls(b - 1);
  if (first === last && first !== 0) return [a, a]; // reject by the first and last frame
  if (!reverse) return [lowerBound(a, b, (f) => cls(f) >= 0), lowerBound(a, b, (f) => cls(f) >= 1)];
  return [lowerBound(a, b, (f) => cls(f) <= 0), lowerBound(a, b, (f) => cls(f) <= -1)];
}
/** One clip's use of a span given on the clip's own asset clock ([s, e)); null when no frame counts. */
function useOfClip(doc: ProjectDocument, site: ClipSite, range: SourceRange, rangeSpanOwn: SourceSpan, delta: T.RationalTime): RangeUse | null {
  // a whole-file range counts every frame of a clip of that file; on a copy it is the stretch [0, duration) of the file it was marked on
  const span = range.span === null && site.clip.assetId !== range.assetId ? rangeSpanOwn : range.span;
  const asset = own(doc.assets, site.clip.assetId);
  if (!asset) return null;
  const rate = doc.settings.frameRate, frame = T.frameTime(1, rate), c = site.clip;
  const medium = site.trackKind === 'video' ? 'picture' : 'sound';
  const base = { sequenceId: site.sequenceId, trackId: site.trackId, clipId: c.id, medium, hidden: site.hidden } as const;
  const at = (f: number) => T.frameTime(f, rate);
  if (asset.kind === 'image') return { ...base, fromFrame: site.fromFrame, toFrame: site.toFrame, source: { start: rangeSpanOwn.start, end: rangeSpanOwn.end } };
  // a whole range counts every frame; its `source` is what the clip shows, cut to the file
  const whole = span === null, sp = span ?? rangeSpanOwn;
  const s = T.add(sp.start, delta), e = T.add(sp.end, delta);
  if (!whole && (!T.lt(T.ZERO, e) || !T.lt(s, asset.duration))) return null;
  const cut = (lo: T.RationalTime, hi: T.RationalTime): SourceSpan => ({ start: T.max(sp.start, T.sub(lo, delta)), end: T.min(sp.end, T.sub(hi, delta)) });
  if (whole) {
    const a = site.fromFrame, b = site.toFrame - 1;
    if (site.trackKind === 'video' && asset.video) {
      const va = { ...asset, video: asset.video };
      const k1 = sourceFrameIndexAt(va, c, at(a), rate), k2 = sourceFrameIndexAt(va, c, at(b), rate);
      return { ...base, fromFrame: site.fromFrame, toFrame: site.toFrame, source: cut(sourceTimeOfFrame(va, Math.min(k1, k2)), sourceTimeOfFrame(va, Math.max(k1, k2) + 1)) };
    }
    const x1 = pictureSourceAt(c, at(a), frame), x2 = pictureSourceAt(c, at(b), frame);
    return { ...base, fromFrame: site.fromFrame, toFrame: site.toFrame, source: cut(T.min(x1, x2), T.add(T.max(x1, x2), frame)) };
  }
  if (site.trackKind === 'video' && asset.video) {
    const va = { ...asset, video: asset.video };
    const kLo = sourceFrameOfTime(va, s), kHi = Math.max(kLo + 1, firstFrameAtOrAfter(va, e));
    const k = (f: number) => sourceFrameIndexAt(va, c, at(f), rate);
    const [from, to] = runOf(site, c.reverse === true, (f) => { const x = k(f); return x < kLo ? -1 : x >= kHi ? 1 : 0; });
    if (to <= from) return null;
    const k1 = k(from), k2 = k(to - 1), lo = Math.min(k1, k2), hi = Math.max(k1, k2);
    return { ...base, fromFrame: from, toFrame: to, source: cut(sourceTimeOfFrame(va, lo), sourceTimeOfFrame(va, hi + 1)) };
  }
  const x = (f: number) => pictureSourceAt(c, at(f), frame);
  const [from, to] = runOf(site, c.reverse === true, (f) => { const v = x(f); return T.lt(v, s) ? -1 : T.lt(v, e) ? 0 : 1; });
  if (to <= from) return null;
  const x1 = x(from), x2 = x(to - 1), lo = T.min(x1, x2), top = T.max(x1, x2);
  // the end of the last counted instant: the next instant of the clip, or one project frame later for a clip that holds still
  const next = c.reverse ? x(Math.max(from - 1, site.fromFrame)) : x(to);
  const hi = T.lt(top, next) ? next : T.add(top, frame);
  return { ...base, fromFrame: from, toFrame: to, source: cut(lo, hi) };
}
/** Sorted, merged stretches (touching ones join). */
function mergeSpans(spans: SourceSpan[]): SourceSpan[] {
  const sorted = spans.filter((s) => T.lt(s.start, s.end)).sort((a, b) => T.cmp(a.start, b.start) || T.cmp(a.end, b.end));
  const out: SourceSpan[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && T.lte(s.start, last.end)) { if (T.lt(last.end, s.end)) last.end = s.end; }
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}
const usageMemo = new WeakMap<ProjectDocument, UsageResult>();
/** Usage of every range in every sequence (decisions §2.5). Memoised per document object. */
export function rangeUsage(doc: ProjectDocument): UsageResult {
  const hit = usageMemo.get(doc);
  if (hit) return hit;
  const ranges = rangesOf(doc);
  const sites = clipSites(doc);
  const usedAssets = [...sites.keys()];
  const out: Record<string, RangeUsage> = {};
  // group by time-lineage root: one timingRelations per root (C7)
  const groups = new Map<string, SourceRange[]>();
  const offsetOf = new Map<string, T.RationalTime>();
  for (const r of Object.values(ranges)) {
    const lin = timeLineage(doc, r.assetId);
    offsetOf.set(r.assetId, lin.offset);
    let g = groups.get(lin.rootAssetId);
    if (!g) groups.set(lin.rootAssetId, (g = []));
    g.push(r);
  }
  for (const [root, group] of groups) {
    const rel = timingRelations(doc, root);
    const related: { assetId: string; rel: TimingRelation }[] = [];
    for (const id of usedAssets) { const x = rel(id); if (x) related.push({ assetId: id, rel: x }); }
    for (const r of group) {
      const uses: RangeUse[] = [], untimed: string[] = [];
      const ownSpan = rangeSpan(doc, r), oA = offsetOf.get(r.assetId)!;
      for (const { assetId, rel: x } of related) {
        if (x.kind === 'untimed') { if (!untimed.includes(assetId)) untimed.push(assetId); continue; }
        // root moment t is moment t + x.delta of this asset; the range's own clock is root − oA
        const delta = T.add(oA, x.delta);
        for (const site of sites.get(assetId)!) { const u = useOfClip(doc, site, r, ownSpan, delta); if (u) uses.push(u); }
      }
      out[r.id] = { rangeId: r.id, uses, usedSource: mergeSpans(uses.map((u) => u.source)), untimedCopies: untimed.sort(byStr) };
    }
  }
  const order = rangeListOrder(doc);
  const sortedOut: Record<string, RangeUsage> = {};
  for (const id of order) sortedOut[id] = out[id]!;
  const result: UsageResult = { ranges: sortedOut, unused: order.filter((id) => out[id]!.uses.length === 0), limits: LIMITS };
  usageMemo.set(doc, result);
  return result;
}
/** The merged used stretches of one file's source (the viewer strip), in that file's time. */
export function assetUsage(doc: ProjectDocument, assetId: string): SourceSpan[] {
  const u = rangeUsage(doc);
  return mergeSpans(Object.values(rangesOf(doc)).filter((r) => r.assetId === assetId).flatMap((r) => u.ranges[r.id]?.usedSource ?? []));
}

// ---------- screen time ----------
/** Union of integer intervals [a, b): sorted, merged. */
function unionPairs(pairs: [number, number][]): [number, number][] {
  const sorted = pairs.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) { const last = out[out.length - 1]; if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]); }
  return out;
}
const lengthOf = (pairs: [number, number][]) => pairs.reduce((n, [a, b]) => n + (b - a), 0);
/** Screen time by manual tag in one sequence (default: the main one). */
export function screenTime(doc: ProjectDocument, sequenceId: string = doc.mainSequenceId): ScreenTime {
  const rate = doc.settings.frameRate;
  const seq = own(doc.sequences, sequenceId);
  const picture: [number, number][] = [];
  if (seq) for (const track of seq.tracks) {
    if (track.kind !== 'video' || track.hidden) continue;
    for (const clip of track.clips) if (clip.type === 'media') picture.push([ceilFrame(clip.start, rate), ceilFrame(T.add(clip.start, clip.duration), rate)]);
  }
  const pictureU = unionPairs(picture);
  const usage = rangeUsage(doc);
  const byPerson = new Map<string, { pairs: [number, number][]; clips: Set<string> }>();
  for (const id of Object.keys(doc.people ?? {})) byPerson.set(id, { pairs: [], clips: new Set() });
  for (const r of Object.values(rangesOf(doc))) {
    if (!r.people) continue;
    const uses = (usage.ranges[r.id]?.uses ?? []).filter((u) => u.sequenceId === sequenceId && u.medium === 'picture' && !u.hidden);
    if (!uses.length) continue;
    for (const p of r.people) {
      const slot = byPerson.get(p);
      if (!slot) continue; // a tag of a person not in the project (an invalid document) counts for nobody
      for (const u of uses) { slot.pairs.push([u.fromFrame, u.toFrame]); slot.clips.add(u.clipId); }
    }
  }
  const people = [...byPerson.entries()]
    .map(([personId, s]) => ({ personId, key: personNameKey(own(doc.people, personId)!.name), frames: lengthOf(unionPairs(s.pairs)), clips: [...s.clips].sort(byStr), pairs: s.pairs }))
    .sort((a, b) => byStr(a.key, b.key) || byStr(a.personId, b.personId));
  const tagged = lengthOf(unionPairs(people.flatMap((p) => p.pairs)));
  const pictureFrames = lengthOf(pictureU);
  return { sequenceId, rate: { num: rate.num, den: rate.den }, pictureFrames, untaggedFrames: pictureFrames - tagged, people: people.map(({ personId, frames, clips }) => ({ personId, frames, clips })) };
}

// ---------- search, placement, film window, summary ----------
/** Range ids matching a query (bareWord tokens over label and tagged names, vowel points and punctuation ignored) and a filter, in list order. */
export function searchRanges(doc: ProjectDocument, query: string, filter: RangeFilter = {}): string[] {
  const want = verbatimTokens(query);
  const unused = filter.unused !== undefined ? new Set(rangeUsage(doc).unused) : null;
  return rangeListOrder(doc).filter((id) => {
    const r = own(doc.sourceRanges, id)!;
    if (filter.kind !== undefined && r.kind !== filter.kind) return false;
    if (filter.assetId !== undefined && r.assetId !== filter.assetId) return false;
    if (filter.personId !== undefined && !(r.people ?? []).includes(filter.personId)) return false;
    if (unused && unused.has(id) !== filter.unused) return false;
    if (!want.length) return true;
    const have = [...verbatimTokens(r.label), ...(r.people ?? []).flatMap((p) => { const person = own(doc.people, p); return person ? verbatimTokens(person.name) : []; })];
    return want.every((w) => have.some((h) => h.includes(w)));
  });
}
/** add_clip arguments for a range, snapped OUTWARD to project frames and clamped to the file (a spoken word is never cut short). */
export function placeRangeArgs(doc: ProjectDocument, range: SourceRange, rate: { num: number; den: number }): PlaceRangeArgs {
  const asset = own(doc.assets, range.assetId);
  if (!range.span || !asset || asset.kind === 'image') return { assetId: range.assetId };
  const frame = T.frameTime(1, rate);
  let sourceIn = T.max(T.ZERO, T.frameTime(T.frameIndexAt(range.span.start, rate), rate));
  let end = T.frameTime(ceilFrame(range.span.end, rate), rate);
  // clamped to the file: the last whole project frame from sourceIn that the file can fill
  if (T.lt(asset.duration, end)) end = T.add(sourceIn, T.frameTime(T.frameCount(T.sub(asset.duration, sourceIn), rate), rate));
  if (!T.lt(sourceIn, end)) { sourceIn = T.max(T.ZERO, T.sub(asset.duration, frame)); end = T.add(sourceIn, frame); }
  return { assetId: range.assetId, sourceIn, duration: T.sub(end, sourceIn) };
}
/** The range in the file's own video frames (sourceFrameOfTime), [fromFrame, toFrame); null for a still, a sound file or a whole range. */
export function filmWindowOfRange(asset: Pick<Asset, 'kind' | 'video' | 'duration'>, range: SourceRange): { fromFrame: number; toFrame: number } | null {
  if (!range.span || asset.kind === 'image' || !asset.video) return null;
  const va = { video: asset.video };
  const fromFrame = sourceFrameOfTime(va, range.span.start);
  let toFrame = Math.max(fromFrame + 1, firstFrameAtOrAfter(va, range.span.end));
  if (asset.video.frameCount !== null && asset.video.frameCount > fromFrame) toFrame = Math.min(toFrame, asset.video.frameCount);
  return { fromFrame, toFrame };
}
/** queries.ts summarize: how many ranges, and how many have no use. */
export function pearlsSummary(doc: ProjectDocument): { count: number; unused: number | null } {
  return { count: Object.keys(doc.sourceRanges ?? {}).length, unused: rangeUsage(doc).unused.length };
}
/**
 * The determinism digest of proof check P15: sha256 over the JSON of rangeUsage and of screenTime of every sequence (in key order) of
 * each document. Node and the browser (window.__pfPearlsHash, builder C) call this same function on the same documents.
 */
export function pearlsDigest(docs: readonly ProjectDocument[]): string {
  return sha256Hex(JSON.stringify(docs.map((d) => ({ usage: rangeUsage(d), screen: Object.keys(d.sequences).map((id) => screenTime(d, id)) }))));
}
/** True when `t` lies in [span.start, span.end). Exact. */
export type SpanTest = (t: T.RationalTime) => boolean;

// ---------- cascades and validation (called from ops.ts, peopleOps.ts and validate.ts) ----------
/** remove_asset: the ranges of the file go with it. Returns the range ids removed (entity ids). */
export function detachRangesOfAsset(draft: ProjectDocument, assetId: string): string[] {
  const map = draft.sourceRanges;
  if (!map) return [];
  const gone = Object.values(map).filter((r) => r.assetId === assetId).map((r) => r.id);
  for (const id of gone) delete map[id];
  if (Object.keys(map).length === 0) delete draft.sourceRanges;
  return gone;
}
/** remove_person (the owner's): the person leaves every range. Returns the range ids changed or removed. */
export function untagPerson(draft: ProjectDocument, personId: string): string[] {
  const map = draft.sourceRanges;
  if (!map) return [];
  const changed: string[] = [];
  for (const r of Object.values(map)) {
    if (!r.people?.includes(personId)) continue;
    changed.push(r.id);
    const left = r.people.filter((p) => p !== personId);
    if (left.length) r.people = left;
    else if (r.kind === 'presence') delete map[r.id];
    else delete r.people;
  }
  if (Object.keys(map).length === 0) delete draft.sourceRanges;
  return changed;
}
/** validateProject's rules for ranges (code SOURCE_RANGE_ISSUE): asset exists and is not a colour table; span null for a still and
 * for presence; 0 ≤ start < end ≤ duration; presence has people and no label; people ids exist, sorted, unique; at most MAX_SOURCE_RANGES. */
export function validateSourceRanges(doc: ProjectDocument): Issue[] {
  const issues: Issue[] = [];
  const map = doc.sourceRanges ?? {};
  const add = (id: string, message: string) => issues.push({ code: ISSUE, message: `marked range ${id}: ${message}`, ids: [id] });
  const keys = Object.keys(map);
  if (keys.length > MAX_RANGES) issues.push({ code: ISSUE, message: `${keys.length} marked ranges; a project holds at most ${MAX_RANGES}`, ids: [] });
  for (const key of keys) {
    const r = map[key]!;
    if (r.id !== key) add(key, `key ${key} != id ${r.id}`);
    const asset = own(doc.assets, r.assetId);
    if (!asset) add(r.id, `file ${r.assetId} is not in the library`);
    else if (asset.kind === 'lut') add(r.id, 'a colour table has no time to mark');
    if (r.span) {
      if (asset?.kind === 'image') add(r.id, 'a photo is marked whole');
      if (r.kind === 'presence') add(r.id, 'a "who is in it" tag covers the whole file');
      if (T.isNegative(r.span.start) || !T.lt(r.span.start, r.span.end) || (asset && T.lt(asset.duration, r.span.end))) add(r.id, 'the span is outside the file or empty');
    }
    if (r.kind === 'presence' && (!r.people?.length || r.label !== '')) add(r.id, 'a "who is in it" tag has people and no name');
    if (/[\n\r]/.test(r.label)) add(r.id, 'the name is one line');
    if (r.people) {
      for (const p of r.people) if (!own(doc.people, p)) add(r.id, `person ${p} is not in this project`);
      if (r.people.some((p, i) => i > 0 && !(r.people![i - 1]! < p))) add(r.id, 'people are stored sorted and unique');
    }
  }
  return issues;
}
