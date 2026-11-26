/**
 * «בדיקה לפני ייצוא» — the document rules and the explanation pass (wave 8 qc; contract in qcContract.ts). Pure: exact rationals
 * (T.frameIndexAt, T.cmp on exact source times, as exportChecks.ts insideSource), no Date, no float time. Every rule is a RULE OF
 * THUMB with its numbers in `measured`; nothing here calls a film fine, and no rule blocks an export or an agent (report only).
 *
 * documentChecks(doc) runs on the PROJECTED output document (preflight's outputDoc), its main sequence:
 *   flash_clip         C10: a media, text or drawn clip on a visible video or text track lasting fewer than ⌈fps·1/10⌉ frames.
 *                      Skipped: a clip fully under a covering clip (C3's guard) and a clip inside a transition overlap (it carries
 *                      a transition, or the next clip on its track starts with one, so its picture plays on). Warning, no fix.
 *   held_past_picture  C1: a frame of a video clip whose picture source time (speed.ts pictureSourceAt, the evaluator's rule) is at
 *                      or past the PICTURE end (frameCount + startFrames) / the FILE's frame rate: the file's sound runs on and the
 *                      last picture is held under it (ingest.ts). Also a picture that starts late in its file (video.startTime > 0)
 *                      holds the first picture before it (atStart 1, no fix). Note. Fix (forward clips only): trim the picture alone.
 *                      A ramped clip is skipped and named.
 *   title_hidden       C3: a text or drawn clip on a visible text track covered at EVERY frame by media clips on higher visible
 *                      video tracks that cover the frame by geometry (exportChecks.ts coversFrame) AND carry only enabled effects
 *                      of QC_COVER_SAFE_EFFECTS, outside their own transition span. Adjustment clips are not modelled (a miss).
 *   ends_mid_word /    C5: an unmuted sound clip whose transcript (lineage.ts transcriptFor) has a word around one of its edges by
 *   cut_mid_word       at least QC_LIMITS.wordMarginFrames project frames (in source time at the clip's speed). Excused: a fade or
 *                      a volume key at ≤ EDGE_SILENT_LEVEL at that edge; a razor split (the neighbour continues the same source).
 *                      The edge at the film's end is ends_mid_word (warning); every other edge is cut_mid_word (note), at most
 *                      QC_LIMITS.maxListedPerCode rows plus one summary row. Approximate word times → note with approximate 1;
 *                      segment timing → skipped 'segment_timing'; an untimed copy → skipped 'untimed_copy'. Never quotes a word.
 * explainFindings(doc, firstFrame, checks): the one pass that adds `explained` (C6), see its comment.
 */
import * as T from '@pulseframe/time';
import { coversFrame } from './exportChecks.ts';
import { transformAt } from './animation.ts';
import { transcriptFor, untimedCopyFinder } from './lineage.ts';
import { isRamped, pictureSourceAt, sourceEnd, speedOf, startOffsetFrames, timelineOfSource, toSourceSpan } from './speed.ts';
import { sequenceDuration } from './validate.ts';
import { volumeLevelAt } from './volume.ts';
import type { Clip, MediaClip, ProjectDocument, Track } from './schema.ts';
import type { ExportChecks, ExportFinding } from './sendContract.ts';
import { EXPLAINED_FOR, QC_COVER_SAFE_EFFECTS, QC_LIMITS, QC_SEVERITY, type DocumentChecks, type ExplainedReason, type ExplainFindings, type QcIssue, type QcSkipReason } from './qcContract.ts';

/** True once the rules are built: preflight's scope then names them with their numbers (apps/server preflight.ts). */
export const QC_BUILT = true;

/**
 * C5(b): a volume level at or under this at a sound clip's edge is a deliberate ending (1/100 = −40 dB: the word is not heard).
 * A rule of thumb of this file (qcContract.ts QC_LIMITS is frozen); a softer level is not excused.
 */
export const EDGE_SILENT_LEVEL = 0.01;

type Span = [number, number];
const ONE = { num: 1, den: 1 };
/** ⌈rate · r⌉ frames, in integers. */
const ceilFrames = (rate: T.Rate, r: { num: number; den: number }) => { const a = rate.num * r.num, b = rate.den * r.den; return Math.floor((a + b - 1) / b); };
/** Merged, sorted [from, to) frame spans. */
function merge(spans: Span[]): Span[] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Span[] = [];
  for (const [a, b] of s) { const l = out[out.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else out.push([a, b]); }
  return out;
}
/** True when [a, b) lies inside the union of merged spans. */
const inside = (a: number, b: number, merged: Span[]) => b <= a || merged.some(([x, y]) => x <= a && b <= y);
const clipEnd = (c: { start: T.RationalTime; duration: T.RationalTime }) => T.add(c.start, c.duration);
const ms = (t: T.RationalTime) => Number(T.toMicros(t)) / 1000;
const isPicture = (c: Clip) => c.type === 'media' || c.type === 'text' || c.type === 'drawn';
const visibleTracks = (doc: ProjectDocument) => (doc.sequences[doc.mainSequenceId]?.tracks ?? []).map((track, index) => ({ track, index }));

/** C3's guard: the clip covers the frame by geometry and every enabled effect keeps its alpha and geometry. */
function coversForTitle(doc: ProjectDocument, c: MediaClip): boolean {
  return coversFrame(doc, c) && (c.effects ?? []).every((e) => !e.enabled || (QC_COVER_SAFE_EFFECTS as readonly string[]).includes(e.type));
}
/** The frames a covering clip covers under C3: its range minus its own (incoming) transition span. */
function coverSpan(c: MediaClip, rate: T.Rate): Span {
  const a = T.frameIndexAt(c.start, rate), b = T.frameIndexAt(clipEnd(c), rate);
  return [Math.min(b, a + (c.transition?.frames ?? 0)), b];
}
/** Covering clips (C3) on visible video tracks above track index `i`, with their spans. */
function coverersAbove(doc: ProjectDocument, i: number): { clip: MediaClip; span: Span }[] {
  const rate = doc.settings.frameRate;
  return visibleTracks(doc).filter((x) => x.index > i && x.track.kind === 'video' && !x.track.hidden)
    .flatMap((x) => x.track.clips.filter((c): c is MediaClip => c.type === 'media' && coversForTitle(doc, c)).map((clip) => ({ clip, span: coverSpan(clip, rate) })));
}

// ---------- held_past_picture (C1): shared by the rule and by explained `picture_ends` ----------
interface Held { clip: MediaClip; tail: Span | null; head: Span | null; ramped: boolean }
/**
 * For a video clip on a visible video track: the frames that hold the last picture (`tail`, source time ≥ the picture end) and
 * those that hold the first picture of a file whose picture starts late (`head`, source time < startFrames / file rate). Forward
 * clips hold at their end (tail) and their start (head); reversed clips the other way round. Exact: T.cmp of rationals.
 */
function heldOf(doc: ProjectDocument, c: MediaClip): Held | null {
  if (c.freeze) return null;
  const a = doc.assets[c.assetId];
  const v = a?.kind === 'video' ? a.video : undefined;
  if (!v || v.frameCount === null || v.frameCount === undefined) return null;
  const startFrames = Math.max(0, startOffsetFrames(v));
  const picEnd = T.frameTime(v.frameCount + startFrames, v.frameRate);
  const picStart = T.frameTime(startFrames, v.frameRate);
  const mayHold = T.lt(picEnd, a!.duration) || startFrames > 0;
  if (!mayHold) return null;
  if (isRamped(c)) return { clip: c, tail: null, head: null, ramped: true };
  const rate = doc.settings.frameRate, one = T.frameTime(1, rate);
  const s = T.frameIndexAt(c.start, rate), e = T.frameIndexAt(clipEnd(c), rate);
  const src = (k: number) => pictureSourceAt(c, T.frameTime(k, rate), one);
  /** first k in [s, e) where pred holds, for a predicate false-then-true over k (e when none) */
  const firstTrue = (pred: (k: number) => boolean) => { let lo = s, hi = e; while (lo < hi) { const m = (lo + hi) >> 1; if (pred(m)) hi = m; else lo = m + 1; } return lo; };
  const held = (k: number) => T.cmp(src(k), picEnd) >= 0;
  const early = (k: number) => startFrames > 0 && T.lt(src(k), picStart);
  let tail: Span | null, head: Span | null;
  if (!c.reverse) {
    const h = firstTrue(held); tail = h < e ? [h, e] : null;
    const p = firstTrue((k) => !early(k)); head = p > s ? [s, p] : null;
  } else {
    const h = firstTrue((k) => !held(k)); tail = h > s ? [s, h] : null;
    const p = firstTrue(early); head = p < e ? [p, e] : null;
  }
  return { clip: c, tail, head, ramped: false };
}
function heldAll(doc: ProjectDocument): Held[] {
  return visibleTracks(doc).filter((x) => x.track.kind === 'video' && !x.track.hidden)
    .flatMap((x) => x.track.clips.flatMap((c) => (c.type === 'media' ? [heldOf(doc, c)] : []))).filter((h): h is Held => !!h);
}

// ---------- the mid-word rules (C5) ----------
interface Word { start: T.RationalTime; end: T.RationalTime; approximate: boolean }
interface Words { words: Word[]; segmentSpans: [T.RationalTime, T.RationalTime][] }

/** The document rules of one output (the projected document). */
export function documentChecks(doc: ProjectDocument): DocumentChecks {
  const issues: QcIssue[] = [];
  const skipped: DocumentChecks['skipped'] = [];
  const skip = (clipId: string, reason: QcSkipReason) => { if (!skipped.some((x) => x.clipId === clipId && x.reason === reason)) skipped.push({ clipId, reason }); };
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) return { built: true, issues, skipped };
  const rate = doc.settings.frameRate;
  const fr = (t: T.RationalTime) => T.frameIndexAt(t, rate);
  const ceilFrame = (t: T.RationalTime) => fr(t) + (T.isFrameAligned(t, rate) ? 0 : 1);
  const tracks = visibleTracks(doc);
  const filmEnd = sequenceDuration(doc);
  const filmFrames = fr(filmEnd);
  const clampRange = (a: number, b: number) => { const s = Math.max(0, Math.min(a, filmFrames)), e = Math.max(s, Math.min(b, filmFrames)); return { startFrame: s, endFrame: e }; };

  // flash_clip (C10)
  const minFrames = ceilFrames(rate, QC_LIMITS.flashClipSeconds);
  for (const { track, index } of tracks) {
    if (track.hidden || !(track.kind === 'video' || track.kind === 'text')) continue;
    let cover: Span[] | null = null;
    for (const c of track.clips) {
      if (!isPicture(c)) continue;
      const a = fr(c.start), b = fr(clipEnd(c)), frames = b - a;
      if (frames >= minFrames) continue;
      if (c.type === 'media' && c.transition) continue; // inside its own transition overlap
      const next = track.clips.find((x) => x !== c && T.eq(x.start, clipEnd(c)));
      if (next?.type === 'media' && next.transition) continue; // the next clip's transition plays this picture on
      cover ??= merge(coverersAbove(doc, index).map((x) => x.span));
      if (inside(a, b, cover)) continue;
      const neighbours = track.clips.filter((x) => x !== c && (T.eq(clipEnd(x), c.start) || T.eq(x.start, clipEnd(c)))).map((x) => x.id);
      issues.push({
        code: 'flash_clip', severity: QC_SEVERITY.flash_clip, ids: [c.id, ...neighbours], range: clampRange(a, b), measured: { frames, minFrames },
        message: `a picture lasts ${frames} frame${frames === 1 ? '' : 's'}, under the rule of thumb of ${minFrames} (1/10 s rounded up to frames); often a trim leftover. If it is intended, it can be ignored`,
      });
    }
  }

  // held_past_picture (C1)
  for (const h of heldAll(doc)) {
    const c = h.clip, a = doc.assets[c.assetId]!, v = a.video!;
    if (h.ramped) { skip(c.id, 'ramped'); continue; }
    const fileFps = `${v.frameRate.num}/${v.frameRate.den}`;
    if (h.tail) {
      const [x, y] = h.tail, n = y - x;
      const canTrim = !c.reverse && x > fr(c.start);
      issues.push({
        code: 'held_past_picture', severity: QC_SEVERITY.held_past_picture, ids: [c.id], range: clampRange(x, y), measured: { heldFrames: n, atStart: 0, firstHeldFrame: c.reverse ? y - 1 : x, filePictureFrames: v.frameCount! },
        message: `the file's sound runs on after its last picture (${v.frameCount} pictures at ${fileFps} fps), so ${n} frame${n === 1 ? '' : 's'} of this clip hold the last picture${c.reverse ? ' (a reversed clip: trimming its start would remove them; no fix is offered)' : ''}`,
        ...(canTrim ? { fix: { label: 'Trim the picture to its last picture (the sound keeps its length)', ops: [{ op: 'trim_clip', args: { clipId: c.id, edge: 'end', to: T.frameTime(x, rate), includeLinked: false } }] } } : {}),
      });
    }
    if (h.head) {
      const [x, y] = h.head, n = y - x;
      issues.push({
        code: 'held_past_picture', severity: QC_SEVERITY.held_past_picture, ids: [c.id], range: clampRange(x, y), measured: { heldFrames: n, atStart: 1, startFrames: Math.max(0, startOffsetFrames(v)) },
        message: `the picture starts ${Math.max(0, startOffsetFrames(v))} file frames after the file's time zero (${fileFps} fps), so ${n} frame${n === 1 ? '' : 's'} of this clip hold the first picture; no fix is offered`,
      });
    }
  }

  // title_hidden (C3)
  for (const { track, index } of tracks) {
    if (track.hidden || track.kind !== 'text') continue;
    const titles = track.clips.filter((c) => c.type === 'text' || c.type === 'drawn');
    if (!titles.length) continue;
    const coverers = coverersAbove(doc, index);
    if (!coverers.length) continue;
    const merged = merge(coverers.map((x) => x.span));
    for (const c of titles) {
      const a = fr(c.start), b = fr(clipEnd(c));
      if (b <= a || !inside(a, b, merged)) continue;
      const by = coverers.filter((x) => x.span[0] < b && a < x.span[1]).map((x) => x.clip.id);
      issues.push({
        code: 'title_hidden', severity: QC_SEVERITY.title_hidden, ids: [c.id, ...by], range: clampRange(a, b), measured: { frames: b - a, coverers: by.length },
        message: `a ${c.type === 'drawn' ? 'drawing' : 'title'} is under a full-frame opaque picture on a higher track at every one of its ${b - a} frames, so it is not seen (effects that key, move or warp the picture above count as not covering; adjustment clips are not looked at)`,
      });
    }
  }

  // ends_mid_word / cut_mid_word (C5)
  const wordsMemo = new Map<string, Words | null>();
  const wordsOf = (assetId: string): Words | null => {
    if (wordsMemo.has(assetId)) return wordsMemo.get(assetId)!;
    const found = transcriptFor(doc, assetId);
    let out: Words | null = null;
    if (found) {
      out = { words: [], segmentSpans: [] };
      const sh = (t: T.RationalTime) => (T.isZero(found.offset) ? t : T.sub(t, found.offset));
      for (const seg of found.transcript.segments) {
        if (seg.timing === 'segment') { out.segmentSpans.push([sh(seg.start), sh(T.add(seg.start, seg.duration))]); continue; }
        for (const w of seg.words) out.words.push({ start: sh(w.start), end: sh(T.add(w.start, w.duration)), approximate: seg.timing === 'approximate' });
      }
      out.words.sort((x, y) => T.cmp(x.start, y.start) || T.cmp(x.end, y.end));
    }
    wordsMemo.set(assetId, out);
    return out;
  };
  const anchors = Object.keys(doc.transcripts ?? {});
  const untimedOf = untimedCopyFinder(doc, anchors);
  const ends: QcIssue[] = [], cuts: QcIssue[] = [];
  const sameSource = (x: MediaClip, y: MediaClip) => x.assetId === y.assetId && !x.reverse && !y.reverse && !isRamped(x) && !isRamped(y) && speedOf(x).num * speedOf(y).den === speedOf(y).num * speedOf(x).den && T.eq(sourceEnd(x), y.sourceIn);
  for (const { track } of tracks) {
    if (track.kind !== 'audio' || track.muted) continue;
    for (const c of track.clips) {
      if (c.type !== 'media' || c.gain <= 0) continue;
      const asset = doc.assets[c.assetId];
      if (!asset?.audio) continue;
      const w = wordsOf(c.assetId);
      if (!w) { if (anchors.length && untimedOf(c.assetId)) skip(c.id, 'untimed_copy'); continue; }
      if (isRamped(c)) { skip(c.id, 'ramped'); continue; }
      const margin = toSourceSpan(c, T.frameTime(QC_LIMITS.wordMarginFrames, rate));
      const prev = track.clips.find((x): x is MediaClip => x !== c && x.type === 'media' && T.eq(clipEnd(x), c.start));
      const next = track.clips.find((x): x is MediaClip => x !== c && x.type === 'media' && T.eq(x.start, clipEnd(c)));
      const edges: { edge: 'start' | 'end'; src: T.RationalTime }[] = [
        { edge: 'start', src: c.reverse ? sourceEnd(c) : c.sourceIn },
        { edge: 'end', src: c.reverse ? c.sourceIn : sourceEnd(c) },
      ];
      for (const { edge, src } of edges) {
        // excuses (C5 b, c)
        if (edge === 'end' && (c.fadeOut && !T.isZero(c.fadeOut) || volumeLevelAt(c.volume, c.duration) <= EDGE_SILENT_LEVEL || next && sameSource(c, next))) continue;
        if (edge === 'start' && (c.fadeIn && !T.isZero(c.fadeIn) || volumeLevelAt(c.volume, T.ZERO) <= EDGE_SILENT_LEVEL || prev && sameSource(prev, c))) continue;
        const lo = T.sub(src, margin), hi = T.add(src, margin);
        // the last word starting at or before src − margin; it is cut when it ends at or after src + margin
        let l = 0, h = w.words.length;
        while (l < h) { const m = (l + h) >> 1; if (T.lte(w.words[m]!.start, lo)) l = m + 1; else h = m; }
        let word: Word | null = null;
        for (let i = l - 1; i >= 0 && i >= l - 8; i--) { const x = w.words[i]!; if (T.lte(hi, x.end)) { word = x; break; } } // overlapping words are rare; look a few back
        if (!word) {
          if (w.segmentSpans.some(([a, b]) => T.lte(a, lo) && T.lte(hi, b))) skip(c.id, 'segment_timing');
          continue;
        }
        const atFilmEnd = edge === 'end' && T.eq(clipEnd(c), filmEnd);
        const tw0 = timelineOfSource(c, word.start), tw1 = timelineOfSource(c, word.end);
        const range = edge === 'end'
          ? clampRange(Math.max(fr(c.start), fr(c.reverse ? tw1 : tw0)), fr(clipEnd(c)))
          : clampRange(fr(c.start), Math.min(fr(clipEnd(c)), ceilFrame(c.reverse ? tw0 : tw1)));
        if (range.endFrame <= range.startFrame) range.endFrame = Math.min(filmFrames, range.startFrame + 1);
        const measured = { wordStartMs: Math.round(ms(word.start)), wordEndMs: Math.round(ms(word.end)), cutMs: Math.round(ms(src)), approximate: word.approximate ? 1 : 0 };
        const approx = word.approximate ? ' (the word times are marked approximate: a note only)' : '';
        if (atFilmEnd) {
          ends.push({ code: 'ends_mid_word', severity: word.approximate ? 'note' : QC_SEVERITY.ends_mid_word, ids: [c.id], range, measured,
            message: `the film ends inside a spoken word of the transcript: the cut is ${measured.cutMs - measured.wordStartMs} ms after the word starts and ${measured.wordEndMs - measured.cutMs} ms before it ends (file clock)${approx}` });
        } else {
          cuts.push({ code: 'cut_mid_word', severity: QC_SEVERITY.cut_mid_word, ids: [c.id, ...(edge === 'end' && next ? [next.id] : edge === 'start' && prev ? [prev.id] : [])], range, measured,
            message: `a cut at the ${edge} of a sound clip lies inside a spoken word of the transcript: ${measured.cutMs - measured.wordStartMs} ms after it starts and ${measured.wordEndMs - measured.cutMs} ms before it ends (file clock)${approx}` });
        }
      }
    }
  }
  issues.push(...ends);
  cuts.sort((x, y) => x.range.startFrame - y.range.startFrame || x.range.endFrame - y.range.endFrame);
  const max = QC_LIMITS.maxListedPerCode;
  issues.push(...cuts.slice(0, max));
  if (cuts.length > max) {
    const rest = cuts.slice(max);
    issues.push({ code: 'cut_mid_word', severity: 'note', ids: [...new Set(rest.flatMap((x) => x.ids))], range: clampRange(Math.min(...rest.map((x) => x.range.startFrame)), Math.max(...rest.map((x) => x.range.endFrame))), measured: { more: rest.length, listed: max },
      message: `${rest.length} more cuts lie inside spoken words (only the first ${max} are listed one by one)` });
  }
  return { built: true, issues, skipped };
}

// ---------- explanation of after-export findings (C6, C9, C14) ----------
/**
 * The one pass that adds `explained` to after-export findings (called after assembleChecks by the export, the fast export and the
 * loudness route, so the routes give byte-equal findings). Pure: it never removes, reorders or changes a finding's numbers; a
 * finding it cannot explain is returned as it came. Findings are timeline times; `firstFrame` is the export's first frame.
 * black  `dip_transition`: every frame inside a dip-black transition span (a clip's first `frames` frames).
 *        `fade_edge` (C9, tight): the run touches the export's first frame or the film's end, and every frame lies in frames
 *        where a drawn clip's effective opacity is < 1 (opacity keys or value, or a title's own entrance/exit animation) or at
 *        most QC_LIMITS.fadeEdgeSlackSeconds (rounded up to frames) beside them. A run that starts on an empty first frame (a gap
 *        at the very start, the empty_picture warning) is not explained. A range export that ends mid-film gets no fade_edge at
 *        its end (the film's end is the edge looked at): a miss, never a false fold.
 * silence `freeze_hold`: the run lies inside a freeze clip's span.
 * frozen (from the frame after its first, which is the picture the others equal):
 *        `picture_ends` inside held frames of held_past_picture; `slow_speed` inside clips whose one source frame lasts
 *        ≥ QC_LIMITS.slowFrameSeconds (1 / (file fps · speed)); `still_source` inside clips of a derived asset made from an image.
 */
export const explainFindings: ExplainFindings = (doc, firstFrame, checks: ExportChecks) => {
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) return checks;
  const rate = doc.settings.frameRate;
  const fr = (t: T.RationalTime) => T.frameIndexAt(t, rate);
  const endFrame = fr(sequenceDuration(doc));
  const tracks = visibleTracks(doc).filter((x) => !x.track.hidden);
  let cache: ReturnType<typeof precompute> | null = null;
  const pre = () => (cache ??= precompute(doc, tracks, rate, endFrame));
  const reasonOf = (x: ExportFinding): ExplainedReason | null => {
    if (x.kind === 'clipped') return null;
    if (x.kind === 'silence') return pre().freeze.some(([a, b]) => T.lte(a, x.from) && T.lte(x.to, b)) ? 'freeze_hold' : null;
    const a = fr(x.from), b = Math.max(a, fr(x.to));
    const p = pre();
    if (x.kind === 'black') {
      if (inside(a, b, p.dip)) return 'dip_transition';
      const atEdge = a <= firstFrame || b >= endFrame;
      const startGap = a <= firstFrame && !p.drawnAt(a);
      if (atEdge && !startGap && inside(a, b, p.fade)) return 'fade_edge';
      return null;
    }
    const a1 = Math.min(b, a + 1);
    if (inside(a1, b, p.held)) return 'picture_ends';
    if (inside(a1, b, p.slow)) return 'slow_speed';
    if (inside(a1, b, p.still)) return 'still_source';
    return null;
  };
  const pass = (xs: ExportFinding[]) => xs.map((x) => {
    if (x.explained) return x;
    const r = reasonOf(x);
    return r && EXPLAINED_FOR[r] === x.kind ? { ...x, explained: r } : x;
  });
  return { ...checks, picture: { ...checks.picture, findings: pass(checks.picture.findings) }, sound: { ...checks.sound, findings: pass(checks.sound.findings) } };
};

function precompute(doc: ProjectDocument, tracks: { track: Track; index: number }[], rate: T.Rate, endFrame: number) {
  const fr = (t: T.RationalTime) => T.frameIndexAt(t, rate);
  const video = tracks.filter((x) => x.track.kind === 'video');
  const pictures = tracks.filter((x) => x.track.kind === 'video' || x.track.kind === 'text').flatMap((x) => x.track.clips.filter(isPicture));
  const media = video.flatMap((x) => x.track.clips.filter((c): c is MediaClip => c.type === 'media'));
  const dip = merge(media.filter((c) => c.transition?.type === 'dip-black').map((c) => { const s = fr(c.start); return [s, Math.min(fr(clipEnd(c)), s + c.transition!.frames)] as Span; }));
  // frames where a drawn clip's effective opacity is < 1, then widened by the slack on both sides (C9)
  const fading: Span[] = [];
  for (const c of pictures) {
    const s = fr(c.start), e = fr(clipEnd(c));
    if (c.type === 'text' && c.animation) {
      if (c.animation.in) fading.push([s, Math.min(e, s + c.animation.inFrames)]);
      if (c.animation.out) fading.push([Math.max(s, e - c.animation.outFrames), e]);
    }
    if (c.transform.opacity < 1 && !c.keyframes?.opacity?.length) { fading.push([s, e]); continue; }
    if (c.keyframes?.opacity?.length) for (let k = s; k < e; k++) if (transformAt(c, T.frameTime(k, rate)).opacity < 1) fading.push([k, k + 1]);
  }
  const slack = ceilFrames(rate, QC_LIMITS.fadeEdgeSlackSeconds);
  const fade = merge(merge(fading).map(([a, b]) => [Math.max(0, a - slack), Math.min(Math.max(endFrame, b), b + slack)] as Span));
  const drawnSpans = merge(pictures.map((c) => [fr(c.start), fr(clipEnd(c))] as Span));
  const drawnAt = (k: number) => drawnSpans.some(([a, b]) => a <= k && k < b);
  const held = merge(heldAll(doc).flatMap((h) => [h.tail, h.head].filter((x): x is Span => !!x)));
  const slow = merge(media.filter((c) => {
    const v = doc.assets[c.assetId]?.video;
    if (!v || c.freeze || isRamped(c)) return false;
    const sp = c.speed ?? ONE;
    // 1 / (fileRate · speed) ≥ slow: fileRate.den · sp.den · slow.den ≥ slow.num · fileRate.num · sp.num (integers)
    return BigInt(v.frameRate.den) * BigInt(sp.den) * BigInt(QC_LIMITS.slowFrameSeconds.den) >= BigInt(QC_LIMITS.slowFrameSeconds.num) * BigInt(v.frameRate.num) * BigInt(sp.num);
  }).map((c) => [fr(c.start), fr(clipEnd(c))] as Span));
  const still = merge(media.filter((c) => {
    const ids = doc.assets[c.assetId]?.provenance.derived?.sourceAssetIds ?? [];
    return doc.assets[c.assetId]?.kind === 'video' && ids.some((id) => doc.assets[id]?.kind === 'image');
  }).map((c) => [fr(c.start), fr(clipEnd(c))] as Span));
  const freeze = media.filter((c) => c.freeze).map((c) => [c.start, clipEnd(c)] as [T.RationalTime, T.RationalTime]).sort((x, y) => T.cmp(x[0], y[0]));
  // adjacent freeze clips make one span
  const freezeMerged: [T.RationalTime, T.RationalTime][] = [];
  for (const [a, b] of freeze) { const l = freezeMerged[freezeMerged.length - 1]; if (l && T.lte(a, l[1])) l[1] = T.max(l[1], b); else freezeMerged.push([a, b]); }
  return { dip, fade, drawnAt, held, slow, still, freeze: freezeMerged };
}
