/**
 * The shorts planner (ADR-0018, plan §4.4): picks → the steps of ONE apply_sequence_plan (public ops with bindings), the
 * measured origins of the shorts it makes, and a readable plan view. Pure: the same document, body and context give the
 * same plan. Times are exact (ADR-0003).
 *
 * Per pick:
 *  1. the excerpt: the pick snapped OUTWARD to word edges ('words'), or to phrase edges where the transcript has no word
 *     timing (snapped_to_phrase); 'exact' refuses an edge off a word edge (off_word_boundary, with the nearest edges);
 *  2. removals (optional): pauses between words of at least minPauseSeconds, keeping PAUSE_KEEP_SECONDS each side (without
 *     word timing: silences of the measured features, rmsDb < −35 dB); fillers (fillers.ts findFillers), cut at the middle
 *     of the gaps on either side. A removal is skipped when it is shorter than a frame (removal_skipped_too_tight), when it
 *     would put a picture cut of the short (a join, or a source scene cut inside a kept span) closer than flashGapFrames to
 *     another (removal_skipped_flash_gap), or when the short would hold more than SHORTS_CAPS.maxPiecesPerShort pieces;
 *  3. pieces: each kept span starts at its exact source time (sourceIn) and lasts its length rounded UP to whole frames
 *     (a word is never cut short); starts are running sums of whole frames; a span is split at the first frame whose
 *     source frame (speed.ts sourceFrameIndexAt) is at or past a source scene cut, so every shot is its own clip;
 *  4. steps: add_sequence; per piece add_clip (picture and its sound) and the reframe (replace_clip_keyframes x keys or
 *     set_clip_transform); JOIN_FADE fades on the sound at removal joins only; for the blurred backdrop a second picture
 *     track, a picture-only copy under it blurred (BACKDROP) and the foreground at backdropScale; captions (a transcript
 *     caption track on the short's sound, its look, and a bottom margin above the safe area); a title (add_text with a text
 *     style, verbatim for a quote).
 * Score and reasons in an origin come only from the measured candidate (ctx.candidates); nothing is typed or made up.
 */
import * as T from '@pulseframe/time';
import type { Asset, MediaClip, ProjectDocument, SequenceFormat, SequenceOrigin, ShortReason, Transcript } from './schema.ts';
import {
  BACKDROP, JOIN_FADE, PAUSE_KEEP_SECONDS, SHORTS_CAPS, SHORTS_RANK_METHOD, ShortsError, shortsRefusal,
  type BuildShortsBody, type PlannedShort, type PlanWarning, type PlanWarningCode, type ShortPick, type ShortsPlan, type ShortsPlanContext,
} from './shortsContract.ts';
import type { TemplateStep } from './templateContract.ts';
import { findProfile } from './variants.ts';
import { findFillers } from './fillers.ts';
import { flashGapFrames } from './flashSafety.ts';
import { startOffsetFrames, sourceFrameIndexAt } from './speed.ts';
import { fitScale } from './geometry.ts';
import { backdropScale, planReframe, trackSamples } from './reframe.ts';
import { isVerbatim } from './quotes.ts';
import { findCaptionLook } from './captionPresets.ts';
import { sequenceOf } from './sequences.ts';
import { DEFAULT_CAPTION_STYLE } from './schema.ts';
import type { MotionTrack } from './tracking.ts';

/** A silence of the measured features, for tightening without word timing. */
export const SHORTS_SILENCE_DB = -35;
/** Title: shown for the first seconds, styled with this text style (textPresets.ts). */
export const SHORTS_TITLE = { seconds: 3, presetId: 'classic-outline' } as const;
/** The method written into the origin of a short made from a pick that names no measured candidate. */
export const SHORTS_PICK_METHOD = 'shorts-plan 1: picked range snapped to word edges; no measured candidate' as const;

type Span = { start: T.RationalTime; end: T.RationalTime };
interface Piece { sourceIn: T.RationalTime; frames: number; start: number; joinBefore: boolean; joinAfter: boolean }
interface Layout { pieces: Piece[]; cuts: { frame: number; join: boolean }[]; frames: number }

const ceilFrames = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };
const sec = (s: number) => T.fromSeconds(Number(s.toFixed(6)));
const mid = (a: T.RationalTime, b: T.RationalTime) => { const s = T.add(a, b); return T.normalize({ value: s.value, timescale: s.timescale * 2 }); };
const fmtS = (t: T.RationalTime) => T.toSeconds(t).toFixed(3);
/** The source frame index at which a scene cut's new shot starts (the first frame shown at or after the cut). */
const cutIndex = (asset: Asset, c: T.RationalTime) => {
  const rate = asset.video!.frameRate;
  return Math.max(0, ceilFrames(c, rate) - startOffsetFrames(asset.video!));
};

/** Pieces and picture cuts of a short made of `spans`, split at the source scene cuts inside them. */
function layout(asset: Asset, spans: Span[], sceneCuts: readonly T.RationalTime[], rate: T.Rate): Layout {
  const pieces: Piece[] = [];
  const cuts: { frame: number; join: boolean }[] = [];
  let at = 0;
  const video = asset.video!;
  for (const [si, sp] of spans.entries()) {
    // whole frames, outward; at the end of the file the clip cannot read further than the file
    const available = T.frameIndexAt(T.sub(asset.duration, sp.start), rate);
    const frames = Math.max(1, Math.min(ceilFrames(T.sub(sp.end, sp.start), rate), available));
    if (si > 0) cuts.push({ frame: at, join: true });
    // split at scene cuts inside the span: the first clip-local frame whose source frame is at or past the cut's frame
    const clip = { type: 'media', start: T.frameTime(at, rate), duration: T.frameTime(frames, rate), sourceIn: sp.start } as MediaClip;
    const splits: number[] = [];
    for (const c of sceneCuts) {
      if (!T.lt(sp.start, c) || !T.lt(c, sp.end)) continue;
      const want = cutIndex(asset, c);
      // the source frame shown rises with the clip-local frame (a forward clip at speed 1): binary search for the first one
      const shown = (j: number) => sourceFrameIndexAt({ duration: asset.duration, video }, clip, T.frameTime(at + j, rate), rate);
      if (shown(frames - 1) < want) continue;
      let lo = 0, hi = frames - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (shown(m) >= want) hi = m; else lo = m + 1; }
      if (lo > 0 && !splits.includes(lo)) splits.push(lo);
    }
    splits.sort((a, b) => a - b);
    const bounds = [0, ...splits, frames];
    for (let b = 0; b + 1 < bounds.length; b++) {
      const from = bounds[b]!, to = bounds[b + 1]!;
      if (b > 0) cuts.push({ frame: at + from, join: false });
      pieces.push({ sourceIn: T.add(sp.start, T.frameTime(from, rate)), frames: to - from, start: at + from, joinBefore: si > 0 && b === 0, joinAfter: si < spans.length - 1 && b + 1 === bounds.length - 1 });
    }
    at += frames;
  }
  return { pieces, cuts, frames: at };
}
/** True when every picture cut next to a join is at least `gap` frames from its neighbours (source-only pairs are the material's own). */
function flashSafe(l: Layout, gap: number): boolean {
  const cuts = [...l.cuts].sort((a, b) => a.frame - b.frame);
  for (let i = 1; i < cuts.length; i++) if ((cuts[i]!.join || cuts[i - 1]!.join) && cuts[i]!.frame - cuts[i - 1]!.frame < gap) return false;
  return true;
}
/** `excerpt` minus the union of `removals` (sorted, merged, clipped). */
function subtract(excerpt: Span, removals: Span[]): Span[] {
  const rs = [...removals].sort((a, b) => T.cmp(a.start, b.start));
  const out: Span[] = [];
  let cur = excerpt.start;
  for (const r of rs) {
    const s = T.max(r.start, excerpt.start), e = T.min(r.end, excerpt.end);
    if (!T.lt(s, e)) continue;
    if (T.lt(cur, s)) out.push({ start: cur, end: s });
    if (T.lt(cur, e)) cur = e;
  }
  if (T.lt(cur, excerpt.end)) out.push({ start: cur, end: excerpt.end });
  return out;
}

interface TWord { id: string; text: string; start: T.RationalTime; end: T.RationalTime; timing: 'word' | 'segment' | 'approximate' }
const wordsOf = (tr: Transcript | undefined): TWord[] => (tr?.segments ?? []).flatMap((s) => s.words.map((w) => ({ id: w.id, text: w.text, start: w.start, end: T.add(w.start, w.duration), timing: s.timing })));
const phrasesOf = (tr: Transcript | undefined) => (tr?.segments ?? []).map((s) => ({ start: s.start, end: T.add(s.start, s.duration), timing: s.timing }));

/** Snap one pick to the transcript (outward), or refuse it in 'exact' mode; warnings are pushed. */
function snapPick(i: number, pick: ShortPick, tr: Transcript | undefined, snap: 'words' | 'exact', duration: T.RationalTime, warn: (c: PlanWarningCode, m: string, d: Record<string, unknown>) => void): Span {
  const words = wordsOf(tr).filter((w) => w.timing === 'word');
  const phrases = phrasesOf(tr).filter((p) => p.timing !== 'word');
  const wordEdges = words.flatMap((w) => [w.start, w.end]);
  const inPhrase = (t: T.RationalTime) => phrases.find((p) => T.lte(p.start, t) && T.lte(t, p.end));
  let phraseSnapped = false;
  const edge = (t: T.RationalTime, side: 'start' | 'end'): T.RationalTime => {
    const ph = inPhrase(t);
    // no word timing here: the phrase is the finest unit (and an estimate), so the edge goes out to the phrase edge
    if (ph && !words.some((w) => T.lt(w.start, t) && T.lt(t, w.end))) {
      const to = side === 'start' ? ph.start : ph.end;
      if (!T.eq(to, t)) phraseSnapped = true;
      return to;
    }
    if (!wordEdges.length || wordEdges.some((e) => T.eq(e, t))) return t;
    const before = wordEdges.filter((e) => T.lt(e, t)).reduce<T.RationalTime | null>((m, e) => (m && T.lt(e, m) ? m : e), null);
    const after = wordEdges.filter((e) => T.lt(t, e)).reduce<T.RationalTime | null>((m, e) => (m && T.lt(m, e) ? m : e), null);
    if (snap === 'exact') throw shortsRefusal('offWordBoundary', { pick: i, edge: side, given: t, nearestBefore: before, nearestAfter: after }, i + 1, side);
    // outward: the start goes back to the nearest edge before it, the end forward to the nearest edge after it
    const to = side === 'start' ? before : after;
    return to ?? t;
  };
  const start = T.max(T.ZERO, edge(pick.start, 'start')), end = T.min(duration, edge(pick.end, 'end'));
  const moved = !T.eq(start, pick.start) || !T.eq(end, pick.end);
  if (phraseSnapped) warn('snapped_to_phrase', `pick ${i + 1} has no word timing at an edge; it was widened to the whole phrase (an estimate)`, { pick: i, start, end, given: { start: pick.start, end: pick.end } });
  else if (moved) warn('snapped_to_words', `pick ${i + 1} was widened to word edges (${fmtS(pick.start)}–${fmtS(pick.end)} s → ${fmtS(start)}–${fmtS(end)} s)`, { pick: i, start, end, given: { start: pick.start, end: pick.end } });
  return { start, end };
}

/** The format a short is made at: a profile (generic guides, not platform numbers) or an explicit frame, with the loudness. */
function resolveFormat(body: BuildShortsBody): SequenceFormat {
  let f: SequenceFormat;
  if ('profileId' in body.format && !('width' in body.format)) {
    const p = findProfile(body.format.profileId);
    if (!p) throw shortsRefusal('unknownProfile', { profileId: body.format.profileId }, body.format.profileId);
    f = { width: p.width, height: p.height, fit: p.fit, profileId: p.id, safeArea: { ...p.safeArea } };
  } else f = structuredClone(body.format as SequenceFormat);
  delete f.loudness;
  if (body.loudness === null) f.loudness = null;
  else if (body.loudness !== 'project') f.loudness = { ...body.loudness };
  return f;
}

export function planShorts(doc: ProjectDocument, body: BuildShortsBody, ctx: ShortsPlanContext): ShortsPlan {
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const format = resolveFormat(body);
  const warnings: PlanWarning[] = [];
  const warn = (short: number | null) => (code: PlanWarningCode, message: string, details: Record<string, unknown>) => { warnings.push({ code, message, short, details }); };
  const lookId = body.captions?.lookId ?? null;
  const look = lookId !== null ? findCaptionLook(lookId) : undefined;
  if (lookId !== null && !look) throw shortsRefusal('unknownCaptionLook', { lookId }, lookId);
  for (const id of body.replaceSequenceIds ?? []) {
    const s = sequenceOf(doc, id);
    if (!s) throw shortsRefusal('sequenceNotFound', { sequenceId: id }, id);
    if (id === doc.mainSequenceId || s.origin?.kind !== 'short') throw shortsRefusal('notPlanMade', { sequenceId: id }, id);
  }
  const ops: TemplateStep[] = [];
  const origins: ShortsPlan['origins'] = [];
  const shorts: PlannedShort[] = [];
  const steps: string[] = [];
  const basis = new Set<string>();
  const noScenes = new Set<string>();

  for (const [i, pick] of body.picks.entries()) {
    const w = warn(i);
    const asset = Object.hasOwn(doc.assets, pick.assetId) ? doc.assets[pick.assetId]! : undefined;
    if (!asset) throw shortsRefusal('assetNotFound', { pick: i, assetId: pick.assetId }, pick.assetId);
    if (!asset.video || asset.kind !== 'video') throw shortsRefusal('needsVideo', { pick: i, assetId: asset.id });
    if (T.isNegative(pick.start) || !T.lt(pick.start, pick.end) || T.lt(asset.duration, pick.end)) throw shortsRefusal('pickOutsideFile', { pick: i, start: pick.start, end: pick.end, duration: asset.duration }, i + 1);
    const length = T.toSeconds(T.sub(pick.end, pick.start));
    if (length < SHORTS_CAPS.minSeconds) throw shortsRefusal('pickTooShort', { pick: i, seconds: length }, i + 1, SHORTS_CAPS.minSeconds);
    if (length > SHORTS_CAPS.maxSeconds) throw shortsRefusal('pickTooLong', { pick: i, seconds: length }, i + 1, SHORTS_CAPS.maxSeconds);
    const tr = Object.hasOwn(doc.transcripts ?? {}, asset.id) ? doc.transcripts[asset.id] : undefined;
    const excerpt = snapPick(i, pick, tr, body.snap, asset.duration, w);
    const allWords = wordsOf(tr);
    const inside = allWords.filter((x) => T.lte(excerpt.start, x.start) && T.lte(x.end, excerpt.end));
    const wordTimed = inside.length > 0 && inside.every((x) => x.timing === 'word');
    if (tr) basis.add(wordTimed ? 'transcript with word timing' : 'transcript (phrase timing)');
    const scenes = (Object.hasOwn(doc.analyses ?? {}, asset.id) ? doc.analyses[asset.id]!.scenes?.cuts : undefined) ?? null;
    if (scenes) basis.add('scene cuts (analysis)');
    else if (!noScenes.has(asset.id)) { noScenes.add(asset.id); w('no_scene_cuts', `"${asset.name}" has no scene analysis, so shots inside a short are not split at cuts`, { assetId: asset.id }); }
    const sceneCuts = scenes ?? [];

    // ---- removals ----
    const keep = sec(PAUSE_KEEP_SECONDS);
    const minPause = sec(body.tighten.minPauseSeconds);
    const candidates: (Span & { kind: 'pause' | 'filler' })[] = [];
    if (body.tighten.pauses) {
      if (wordTimed) {
        for (let k = 1; k < inside.length; k++) {
          const a = inside[k - 1]!.end, b = inside[k]!.start;
          if (T.lte(minPause, T.sub(b, a))) candidates.push({ start: T.add(a, keep), end: T.sub(b, keep), kind: 'pause' });
        }
      } else {
        const feat = ctx.features.get(asset.id);
        if (!feat) throw shortsRefusal('needsMeasurement', { pick: i, assetId: asset.id });
        basis.add('audio features (RMS level per 100 ms; not LUFS)');
        const h0 = Math.max(0, Math.ceil(T.toSeconds(excerpt.start) * 10)), h1 = Math.min(feat.hops, Math.floor(T.toSeconds(excerpt.end) * 10));
        for (let h = h0; h < h1; ) {
          if (!(feat.rmsDb[h]! < SHORTS_SILENCE_DB)) { h++; continue; }
          let e = h;
          while (e < h1 && feat.rmsDb[e]! < SHORTS_SILENCE_DB) e++;
          const s = T.rt(h, 10), en = T.rt(e, 10);
          if (T.lte(minPause, T.sub(en, s))) candidates.push({ start: T.add(s, keep), end: T.sub(en, keep), kind: 'pause' });
          h = e;
        }
      }
    }
    if (body.tighten.fillers && tr) {
      const fillers = findFillers(tr).candidates.filter((f) => T.lte(excerpt.start, f.start) && T.lte(f.end, excerpt.end));
      for (const f of fillers) {
        const k = inside.findIndex((x) => x.id === f.wordIds[0]);
        if (k < 0) continue;
        const prev = inside[k - 1], next = inside[k + 1];
        // cut at the middle of the gaps on either side (the excerpt edge when the filler opens or closes it)
        candidates.push({ start: prev ? mid(prev.end, f.start) : excerpt.start, end: next ? mid(f.end, next.start) : excerpt.end, kind: 'filler' });
      }
    }
    candidates.sort((a, b) => T.cmp(a.start, b.start));
    const accepted: Span[] = [];
    let spans: Span[] = [{ ...excerpt }];
    let lay = layout(asset, spans, sceneCuts, rate);
    if (lay.pieces.length > SHORTS_CAPS.maxPiecesPerShort)
      throw new ShortsError('plan_too_large', `short ${i + 1} would be cut into ${lay.pieces.length} pieces at the scene cuts of its excerpt; at most ${SHORTS_CAPS.maxPiecesPerShort} fit in one short`, { pick: i, pieces: lay.pieces.length, maxPieces: SHORTS_CAPS.maxPiecesPerShort }, 'Pick a shorter excerpt.');
    for (const r of candidates) {
      if (T.lt(T.sub(r.end, r.start), T.frameTime(1, rate))) { w('removal_skipped_too_tight', `a ${r.kind} at ${fmtS(r.start)} s in pick ${i + 1} is too short to cut out (under one frame)`, { pick: i, kind: r.kind, start: r.start, end: r.end }); continue; }
      const nextSpans = subtract(excerpt, [...accepted, r]);
      const next = layout(asset, nextSpans, sceneCuts, rate);
      if (!flashSafe(next, gap)) { w('removal_skipped_flash_gap', `a ${r.kind} at ${fmtS(r.start)} s in pick ${i + 1} is kept: cutting it out would put two picture cuts closer than ${gap} frames`, { pick: i, kind: r.kind, start: r.start, end: r.end, gapFrames: gap }); continue; }
      if (next.pieces.length > SHORTS_CAPS.maxPiecesPerShort) { w('removal_skipped_too_tight', `a ${r.kind} at ${fmtS(r.start)} s in pick ${i + 1} is kept: the short would have more than ${SHORTS_CAPS.maxPiecesPerShort} pieces`, { pick: i, kind: r.kind, start: r.start, end: r.end, maxPieces: SHORTS_CAPS.maxPiecesPerShort }); continue; }
      accepted.push(r);
      spans = nextSpans;
      lay = next;
    }

    // ---- reframe source ----
    const choice = body.reframe;
    const source: 'track' | 'centre' | 'backdrop' = choice.source === 'auto' ? (choice.motionTrackId !== undefined ? 'track' : 'centre') : choice.source;
    let mt: MotionTrack | undefined;
    if (source === 'track') {
      const id = choice.motionTrackId;
      mt = id !== undefined && Object.hasOwn(doc.motionTracks ?? {}, id) ? doc.motionTracks[id] : undefined;
      if (!mt) throw shortsRefusal('motionTrackNotFound', { pick: i, motionTrackId: id ?? null }, id ?? '(none)');
      if (mt.assetId !== asset.id) throw shortsRefusal('motionTrackOtherFile', { pick: i, motionTrackId: mt.id, assetId: asset.id }, mt.id);
      basis.add(`motion track "${mt.name}"`);
    }
    const src = { width: asset.video.width, height: asset.video.height };
    const frame = { width: format.width, height: format.height };

    // ---- steps ----
    const before = ops.length;
    const s = `s${i}`;
    const name = pick.name ?? `Short ${i + 1}`;
    ops.push({ op: 'add_sequence', args: { name, format, tracks: 'standard' }, bind: s });
    const seqRef = { $ref: s, out: 'sequenceId' }, v1 = { $ref: s, out: 'videoTrackId' }, a1 = { $ref: s, out: 'audioTrackId' }, t1 = { $ref: s, out: 'textTrackId' };
    const fg = source === 'backdrop' ? `v${i}` : null;
    if (fg) ops.push({ op: 'add_track', args: { sequenceId: seqRef, kind: 'video' }, bind: fg });
    const hasAudio = !!asset.audio;
    if (!hasAudio) w('no_audio', `"${asset.name}" has no sound, so short ${i + 1} is silent`, { assetId: asset.id });
    let keys = 0, held = 0, epsilon = 0;
    const bScale = backdropScale(frame, src);
    for (const [j, p] of lay.pieces.entries()) {
      const bind = `p${i}_${j}`;
      const timing = { start: T.frameTime(p.start, rate), sourceIn: p.sourceIn, duration: T.frameTime(p.frames, rate) };
      ops.push({ op: 'add_clip', args: { sequenceId: seqRef, assetId: asset.id, trackId: fg ? { $ref: fg, out: 'trackId' } : v1, ...(hasAudio ? { audioTrackId: a1 } : {}), ...timing }, bind });
      if (source === 'backdrop') {
        const copy = `b${i}_${j}`;
        ops.push({ op: 'add_clip', args: { sequenceId: seqRef, assetId: asset.id, trackId: v1, withLinkedAudio: false, ...timing }, bind: copy });
        ops.push({ op: 'add_effect', args: { clipId: { $ref: copy }, type: BACKDROP.effect, params: { radius: BACKDROP.blurRadius } } });
        ops.push({ op: 'set_clip_transform', args: { clipId: { $ref: copy }, transform: { opacity: BACKDROP.opacity } } });
        ops.push({ op: 'set_clip_transform', args: { clipId: { $ref: bind }, transform: { scale: bScale } } });
      } else {
        const samples = mt
          ? trackSamples({ duration: asset.duration, video: asset.video }, { type: 'media', ...timing } as MediaClip, mt, rate)
          : Array.from({ length: p.frames }, () => ({ u: 0.5, conf: 1 }));
        const fitRatio = format.fit === 'cover' ? 1 : fitScale(frame.width, frame.height, src.width, src.height, 'contain') / fitScale(frame.width, frame.height, src.width, src.height, 'cover');
        const r = planReframe({ frame, source: src, framing: choice.framing * fitRatio, rate, samples });
        held += r.heldFrames; epsilon = Math.max(epsilon, r.epsilon);
        if (r.keys) { keys += r.keys.length; ops.push({ op: 'replace_clip_keyframes', args: { clipId: { $ref: bind }, property: 'x', keys: r.keys } }); }
        const transform: Record<string, number> = {};
        if (!r.keys && r.x !== 0) transform.x = r.x;
        if (choice.framing !== 1) transform.scale = choice.framing;
        if (Object.keys(transform).length) ops.push({ op: 'set_clip_transform', args: { clipId: { $ref: bind }, transform } });
      }
      if (hasAudio && (p.joinBefore || p.joinAfter)) ops.push({ op: 'set_clip_fades', args: { clipId: { $ref: bind, out: 'audioClipId' }, ...(p.joinBefore ? { fadeIn: { ...JOIN_FADE } } : {}), ...(p.joinAfter ? { fadeOut: { ...JOIN_FADE } } : {}) } });
    }
    if (mt && lay.frames > 0 && held * 2 > lay.frames) w('track_mostly_lost', `the subject is lost in ${held} of ${lay.frames} frames of short ${i + 1}; the camera holds there`, { heldFrames: held, frames: lay.frames, motionTrackId: mt.id });
    // the honest 'upscaled' warning, as preflight computes it: fit factor × scale above 1.5
    const enlarge = fitScale(frame.width, frame.height, src.width, src.height, format.fit) * (source === 'backdrop' ? bScale : choice.framing);
    if (enlarge > 1.5) w('upscaled', `"${asset.name}" (${src.width}×${src.height}) is shown ${enlarge.toFixed(2)}× larger than its own pixels in short ${i + 1} (${frame.width}×${frame.height}) and will look soft`, { enlarge: Number(enlarge.toFixed(4)), source: src, frame });
    if (body.captions) {
      const c = `c${i}`;
      ops.push({ op: 'add_caption_track', args: { sequenceId: seqRef, mode: 'transcript', linkedTrackId: hasAudio ? a1 : (fg ? { $ref: fg, out: 'trackId' } : v1) }, bind: c });
      if (lookId !== null) {
        ops.push({ op: 'apply_caption_look', args: { sequenceId: seqRef, trackId: { $ref: c, out: 'trackId' }, lookId } });
        if (look!.needsWordTiming && !wordTimed) w('look_needs_word_timing', `the caption look ${lookId} follows the spoken word, which short ${i + 1} has no word timing for`, { lookId });
      }
      if (format.safeArea) ops.push({ op: 'set_caption_style', args: { sequenceId: seqRef, trackId: { $ref: c, out: 'trackId' }, style: { marginFrac: Math.min(0.45, Math.max(DEFAULT_CAPTION_STYLE.marginFrac, format.safeArea.bottom + 0.02)) } } });
    }
    if (pick.title) {
      if (pick.title.origin === 'quote' && !isVerbatim(pick.title.text, inside)) throw shortsRefusal('notVerbatim', { pick: i, title: pick.title.text }, i + 1);
      if (pick.title.origin === 'agent') w('title_agent_text', `the title of short ${i + 1} was written by an agent; review it`, { title: pick.title.text });
      const top = format.safeArea?.top ?? 0.05;
      ops.push({
        op: 'add_text',
        args: { sequenceId: seqRef, trackId: t1, text: pick.title.text, start: T.ZERO, duration: T.frameTime(Math.max(1, Math.min(lay.frames, T.frameIndexAt(T.rt(SHORTS_TITLE.seconds, 1), rate))), rate), transform: { y: Number((-0.5 + top + 0.1).toFixed(4)) } },
        bind: `t${i}`,
      });
      ops.push({ op: 'apply_text_preset', args: { clipId: { $ref: `t${i}` }, presetId: SHORTS_TITLE.presetId } });
    }

    // ---- measured provenance: score and reasons only from the measured candidate ----
    const cand = pick.candidateId !== undefined ? ctx.candidates.get(pick.candidateId) : undefined;
    const measured = cand && cand.assetId === asset.id ? cand : undefined;
    const origin: SequenceOrigin = {
      kind: 'short', assetId: asset.id, candidateId: measured ? measured.id : null,
      excerpt: { start: excerpt.start, end: excerpt.end }, kept: spans.map((x) => ({ start: x.start, end: x.end })),
      score: measured ? Math.max(0, Math.min(100, Math.round(measured.score))) : null,
      reasons: measured ? (measured.reasons.slice(0, 12) as ShortReason[]) : [],
      reframe: source, motionTrackId: mt?.id ?? null, method: measured ? SHORTS_RANK_METHOD : SHORTS_PICK_METHOD, createdAt: ctx.createdAt,
    };
    origins.push({ sequence: { $ref: s, out: 'sequenceId' }, origin });
    const keptSeconds = spans.reduce((n, x) => n + T.toSeconds(T.sub(x.end, x.start)), 0);
    const planned: PlannedShort = {
      name, assetId: asset.id, excerpt: origin.excerpt, kept: origin.kept,
      pieces: lay.pieces.length, frames: lay.frames, seconds: Number(((lay.frames * rate.den) / rate.num).toFixed(3)),
      removedSeconds: Number((T.toSeconds(T.sub(excerpt.end, excerpt.start)) - keptSeconds).toFixed(3)), cutsAdded: spans.length - 1,
      reframe: { source, keys, shots: lay.pieces.length, heldFrames: held, epsilon },
      operations: ops.length - before,
    };
    shorts.push(planned);
    steps.push(`${name}: ${fmtS(excerpt.start)}–${fmtS(excerpt.end)} s of "${asset.name}", ${planned.pieces} piece(s), ${accepted.length} removal(s), reframe ${source}`.slice(0, 400));
  }
  if (ops.length > SHORTS_CAPS.maxOps) throw shortsRefusal('planTooLarge', { operations: ops.length, max: SHORTS_CAPS.maxOps }, ops.length);
  if (body.replaceSequenceIds?.length) steps.push(`Replaces ${body.replaceSequenceIds.length} short(s) made before, in the same step`);
  return { steps: steps.slice(0, 50), basis: [...basis], ops, origins, shorts, warnings };
}
