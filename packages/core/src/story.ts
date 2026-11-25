/**
 * «ספרו מה היה» — the story planner (W1; contract storyContract.ts, rules in its header and in .artifacts/wave7/story-decisions.md).
 * Pure and deterministic: no clock, no random source, no I/O; the document is never mutated. Heuristic where it says so (the voice
 * measurement, the pause and even cuts, the source window of a video); the owner's taps are taken as they are.
 *
 * HOW A STORY IS PLANNED
 * 1. Parameters are parsed (StoryParamsSchema) and resolved with STORY_DEFAULTS. The narration must be a sound file of the project,
 *    at most STORY.maxNarrationMs long. A first build places it whole at `at` (frame-aligned; its length is the longest whole number
 *    of frames inside the file, given explicitly). On regeneration (ctx.narrationClipId) it is read as it lies: deleted → blocking
 *    narration_removed; reversed, ramped, frozen or at another speed → blocking kept_narration_not_followable.
 *    S = its first frame, E = the frame after its last. Source milliseconds map to the timeline through the clip as it lies, with ONE
 *    T.nearestFrameIndex: frame(ms) = nf(start + ms/1000 − sourceIn).
 * 2. Candidates in the given order (duplicates once), with the film's exclusions: not in the project or no picture (no_picture),
 *    picks.exclude (excluded_by_you), the file of a picture kept by hand (kept_by_hand), the file of a pick deleted by hand
 *    (removed_by_hand), a video whose capacity is under flashGapFrames (too_short, C13).
 * 3. Cuts (C1). The first candidate starts at S ('first'). On a first build the sorted, de-duplicated taps start pictures 2, 3, …:
 *    a tap outside the narration's source range is held outside_narration; one with no picture left is held no_picture_left; one
 *    less than flashGapFrames after the cut before (or after S, or before E) is held too_close; one inside a picture kept by hand is
 *    held kept_by_hand. On a regeneration every candidate with a recorded cut (ctx.picked) takes it again (the narration may have
 *    moved: the cut follows it); a recorded cut that no longer fits (outside the narration, out of order or under the gap) is
 *    resolved again. Every run of candidates without a cut shares the stretch from the cut before it to the next cut (or E):
 *    n parts with ideal boundaries a + round(k·L/n), each moved to the nearest unused voice onset within
 *    min(L/(3n), STORY.pauseReachMs) ('pause', when the gap allows it) else kept ('even'). Parts shorter than STORY.minAutoMs leave
 *    the last candidates of the run out (no_room, named).
 * 4. Layout. Picture i spans [cut_i, cut_{i+1}) (the last to E). Around pictures kept by hand (C2): a picture that would run into one
 *    ends at its start; a picture whose cut lies inside one starts at its end; the first picture after a kept clip (or after S)
 *    starts where it ends, earlier or later than its own cut (warning filled_next_to_kept with the seconds). A video shorter than
 *    its span plays whole and the next picture starts at its end (clip_ended_early) — that boundary is a cut, and because every
 *    video holds at least flashGapFrames it obeys the gap. A picture left shorter than the gap next to a kept clip is left out
 *    (no_room) and its neighbour runs over its frames (ADR-0009). Lengths are differences of snapped boundaries (ADR-0003).
 * 5. Keys: the run's own key for a pick it recorded, else filmPickKey with the next free ordinal (never a key a kept or deleted slot
 *    holds). Videos show the film's source window (familyFilm.ts filmSourceWindow).
 * 6. Ops, in an order that keeps the sound clips' ids the same whatever the pictures (storyLiveDocument): tracks; the narration
 *    (bind 'narration', slot kind 'sound', explicit length); the music (add_clip with explicit length, fit_music to E + tailMs,
 *    set_ducking 12 dB under the voice track); the pictures (linked own sound on the own-sound track when ownSound is 'under', with
 *    fades); Ken Burns on stills (motion 'full'); the own-sound level (STORY.ownGainUnder: the narration leads, music or not); the
 *    opening title over the first pictures. On a reused track a level or ducking is set again only when the mix changes, so a level
 *    set by hand survives.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, findClip, OpError } from './ops.ts';
import type { Asset, ProjectDocument, Track } from './schema.ts';
import { clipEnd } from './validate.ts';
import { flashGapFrames } from './flashSafety.ts';
import { findTextPreset } from './textPresets.ts';
import { isFreeze, isRamped, sourceTimeOfFrame, speedOf } from './speed.ts';
import { anchorOf } from './templatePlan.ts';
import { TemplateError, type PlannedSlot, type TemplateStep } from './templateContract.ts';
import { FILM, FILM_PICK_KEY, type FilmText } from './familyFilmContract.ts';
import { filmCapacityOf, filmMomentsOf, filmPickKey, filmSourceWindow } from './familyFilm.ts';
import { MOMENTS_ALGO } from './momentsContract.ts';
import {
  STORY, STORY_BINDS, STORY_BLOCKING_TEXT, STORY_DEFAULTS, STORY_DRAFT_LABEL, STORY_METHOD, STORY_RECIPE_ID, STORY_TEMPLATE_ID, STORY_VERSION, StoryError, StoryParamsSchema, VOICE_LABEL, VOICE_RATE,
  storyMix, storyRefusal, storyRunRecordParams, voiceOnsets,
  type PlanStory, type ResolvedStoryParams, type StoryBlockingCode, type StoryChip, type StoryCutHow, type StoryExclusion, type StoryPick, type StoryPicked, type StoryPlan, type StoryPlanContext, type StoryWarning, type StoryWarningCode,
} from './storyContract.ts';

type RT = T.RationalTime;
type Ref = { $ref: string; out?: string };

/** True once the planner below is built (W1 flips it). */
export const STORY_PLANNER_BUILT: boolean = true;

const DEFAULT_TITLE = { he: 'הסיפור שלנו', en: 'Our story' } as const;
const TITLE_LOOK = 'title-card', STILL_MOTION = 'motion.move.ken-burns-in';
const MAX_ITEM_CHARS = STORY.maxStepChars;
/** The fixed idSeed of the live picture (storyLiveDocument): the same ops give the same ids on every call. */
export const STORY_LIVE_SEED = 'story_live_';

const own = <V>(rec: Readonly<Record<string, V>> | undefined | null, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
const isPicture = (a: Asset) => (!!a.video && a.kind !== 'image') || (a.kind === 'image' && !!a.image);
const isStill = (a: Asset) => a.kind === 'image';
const hasSound = (a: Asset) => !isStill(a) && !!a.audio;
const clipText = (s: string) => (s.length > MAX_ITEM_CHARS ? `${s.slice(0, MAX_ITEM_CHARS - 1)}…` : s);
const quote = (s: string) => (s.length > 60 ? `${s.slice(0, 59)}…` : s);
/** round(a / b) for non-negative integers a, b > 0, exactly. */
const roundDivInt = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));
/** Whole milliseconds of a non-negative rational time, rounded to nearest (exact, in BigInt). */
function msOf(t: RT): number {
  const n = T.normalize(t);
  const v = BigInt(n.value) * 1000n, d = BigInt(n.timescale);
  return Number(v >= 0n ? (2n * v + d) / (2n * d) : -((-2n * v + d) / (2n * d)));
}
/** At most `max` lines in their order: every line of `must` is kept, the others in order while room is left. */
function capKeeping(lines: readonly string[], must: readonly string[], max: number): string[] {
  if (lines.length <= max) return [...lines];
  const keep = new Set(must);
  let room = max - lines.filter((x) => keep.has(x)).length;
  return lines.filter((x) => keep.has(x) || room-- > 0);
}

interface Cand {
  asset: Asset; given: number; capacity: number;
  rec: ReturnType<typeof filmMomentsOf>; windowIndex: number | null; chosen: boolean;
  record: StoryPicked | null;
}
interface Cut { frame: number; ms: number | null; how: StoryCutHow }
interface Span { c: Cand; cut: Cut; s: number; e: number; endedEarly?: number; filled?: number }

/** Pure. Plans a story on `doc` (the document as it will be once the run's untouched clips are gone, on regeneration). Throws StoryError. */
export const planStory: PlanStory = (doc: ProjectDocument, params: unknown, ctx: StoryPlanContext): StoryPlan => {
  // ===== 1. parameters and the narration =====
  const parsed = StoryParamsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw storyRefusal('badParams', issue ? `${issue.path.join('.') || 'params'}: ${issue.message}` : 'invalid');
  }
  const p0 = parsed.data;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) throw storyRefusal('badParams', 'the project has no main sequence');
  const nAsset = own(doc.assets, p0.narrationAssetId);
  if (!nAsset) throw storyRefusal('narrationMissing');
  if (nAsset.kind !== 'audio' || !nAsset.audio) throw storyRefusal('narrationNotSound');
  if (T.lt(T.rt(STORY.maxNarrationMs, 1000), nAsset.duration)) throw storyRefusal('narrationTooLong');
  let at: RT;
  try { at = anchorOf(doc, p0.at); } catch (e) { if (e instanceof TemplateError) throw storyRefusal('badParams', `at: ${e.message}`); throw e; }
  const nf = (t: RT) => T.nearestFrameIndex(t, rate);
  const ft = (f: number) => T.frameTime(f, rate);
  const msF = (ms: number) => nf(T.rt(ms, 1000));
  const secs = (f: number) => Math.round((f / fps) * 100) / 100;
  const P: ResolvedStoryParams = {
    narrationAssetId: p0.narrationAssetId, assetIds: [...p0.assetIds], cutsMs: [...new Set(p0.cutsMs ?? [])].sort((a, b) => a - b),
    musicAssetId: p0.musicAssetId ?? null, ownSound: p0.ownSound ?? STORY_DEFAULTS.ownSound, openingTitle: p0.openingTitle ?? STORY_DEFAULTS.openingTitle,
    lang: p0.lang ?? STORY_DEFAULTS.lang, motion: p0.motion ?? STORY_DEFAULTS.motion,
    ...(p0.event !== undefined ? { event: p0.event } : {}), ...(p0.openingText !== undefined ? { openingText: p0.openingText } : {}),
    at, picks: { exclude: [...(p0.picks?.exclude ?? [])], window: Object.fromEntries(Object.entries(p0.picks?.window ?? {})) },
  };
  const lang = P.lang;
  const warnings: StoryWarning[] = [], blocking: StoryWarning[] = [], steps: string[] = [], basis: string[] = [];
  const warn = (code: StoryWarningCode, message: string, details: Record<string, unknown> = {}) => warnings.push({ code, message: clipText(message), details });
  const excluded: StoryExclusion[] = [];
  const exclude = (assetId: string, code: StoryExclusion['code'], details: Record<string, unknown> = {}) => excluded.push({ assetId, code, details });
  const required = [clipText(`${STORY_METHOD}: ${STORY_DRAFT_LABEL.en}`)];

  // the narration clip: placed whole (first build) or read as it lies (regeneration; it is never made again)
  let narr: { start: RT; sourceIn: RT; duration: RT; trackId: string | null; assetId: string };
  const block = (code: StoryBlockingCode, details: Record<string, unknown>) => blocking.push({ code, message: STORY_BLOCKING_TEXT[code], details });
  if (ctx.narrationClipId !== undefined) {
    const f = findClip(doc, ctx.narrationClipId);
    const c = f?.clip;
    const sp = c ? speedOf(c) : null;
    if (!f || !c) block('narration_removed', { clipId: ctx.narrationClipId });
    else if (c.type !== 'media' || c.reverse || isRamped(c) || isFreeze(c) || !sp || sp.num !== sp.den) block('kept_narration_not_followable', { clipId: c.id });
    if (blocking.length || !f || !c || c.type !== 'media') return blockedPlan(P, blocking, required, doc);
    narr = { start: c.start, sourceIn: c.sourceIn, duration: c.duration, trackId: f.track.id, assetId: c.assetId };
  } else {
    const frames = T.frameCount(nAsset.duration, rate);
    narr = { start: at, sourceIn: T.ZERO, duration: ft(frames), trackId: null, assetId: nAsset.id };
  }
  const S = nf(narr.start), E = nf(T.add(narr.start, narr.duration));
  if (E - S < 2 * gap) throw storyRefusal('nothingToShow');
  const srcEnd = T.add(narr.sourceIn, narr.duration);
  const inNarr = (ms: number) => { const t = T.rt(ms, 1000); return !T.lt(t, narr.sourceIn) && T.lt(t, srcEnd); };
  const frameOfMs = (ms: number) => nf(T.sub(T.add(narr.start, T.rt(ms, 1000)), narr.sourceIn));
  const msOfFrame = (f: number) => msOf(T.sub(T.add(ft(f), narr.sourceIn), narr.start));

  // the voice measurement: onsets (starts of the measured ranges) as timeline frames inside the narration
  const voice = ctx.voiceState === 'measured' ? ctx.voice : null;
  const onsetSamples = voiceOnsets(voice);
  const onsetsMs = onsetSamples.map((s) => Math.floor(s / (VOICE_RATE / 1000)));
  const onsetFrames = [...new Set(onsetSamples.flatMap((s) => {
    const t = T.rt(s, VOICE_RATE);
    if (T.lt(t, narr.sourceIn) || !T.lt(t, srcEnd)) return [];
    const f = nf(T.sub(T.add(narr.start, t), narr.sourceIn));
    return f > S && f < E ? [f] : [];
  }))].sort((a, b) => a - b);
  if (ctx.voiceState === 'pending') warn('voice_pending', 'the sound picture of the narration was not ready yet, so the cuts without a tap are spread evenly; plan again in a moment to use its pauses', {});
  else if (ctx.voiceState === 'no_sound') warn('voice_no_sound', 'no sound could be read from the narration, so the cuts without a tap are spread evenly', {});
  else if (voice?.flat) warn('voice_flat', `the narration's level hardly changes (background ${(voice.noiseDb10 / 10).toFixed(1)} dB, voice ${(voice.voiceDb10 / 10).toFixed(1)} dB), so no pauses were found and the cuts without a tap are spread evenly`, { noiseDb10: voice.noiseDb10, voiceDb10: voice.voiceDb10 });
  required.push(clipText(voice
    ? `${VOICE_LABEL.en}: background ${(voice.noiseDb10 / 10).toFixed(1)} dB, voice ${(voice.voiceDb10 / 10).toFixed(1)} dB; ${voice.flat ? 'no usable contrast' : `${onsetFrames.length} place(s) where the voice starts after a pause`}`
    : `${VOICE_LABEL.en}: not measured (${ctx.voiceState === 'pending' ? 'the waveform is not ready yet' : 'no sound to measure'})`));

  // ===== regeneration: what was kept and deleted by hand =====
  const kept = (ctx.kept ?? []).filter((k) => k.clipId !== ctx.narrationClipId);
  const keptPictures = kept.filter((k) => k.kind === 'picture' && k.endFrame > k.startFrame).map((k) => ({ s: k.startFrame, e: k.endFrame, k })).sort((a, b) => a.s - b.s || a.e - b.e);
  const keptAssets = new Set(keptPictures.flatMap((k) => (k.k.assetId ? [k.k.assetId] : [])));
  const keptKeySet = new Set(ctx.keptKeys ?? []);
  const keptTitle = kept.some((k) => k.kind === 'text' && k.key === STORY_BINDS.title);
  const keptMusic = kept.some((k) => k.kind === 'music');
  if (kept.length) warn('kept_by_hand', `${kept.length} clip(s) of the last story were edited by hand and are kept exactly as they are`, { clipIds: kept.map((k) => k.clipId) });
  const movedBack = [...new Set(ctx.movedKeys ?? [])].sort();
  if (movedBack.length) warn('moved_back', `${movedBack.length} picture(s) of the last story had only been moved in time; they go back to their recorded cuts`, { keys: movedBack });
  const removedKeys = new Set((ctx.removedKeys ?? []).filter((k) => !keptKeySet.has(k) && k !== STORY_BINDS.narration));
  const removedTitle = removedKeys.has(STORY_BINDS.title), removedMusic = removedKeys.has(STORY_BINDS.music) && !keptMusic;
  const records = new Map<string, StoryPicked>();
  for (const r of [...(ctx.removedPicks ?? []), ...(ctx.picked ?? [])]) records.set(r.key, r);
  const removedFiles = new Set<string>();
  for (const k of removedKeys) { const r = records.get(k); if (r) removedFiles.add(r.assetId); }
  // a removed pick key no record explains: a pick key is a hash of (file, ordinal), so the file is found by its hash
  const unexplained = [...removedKeys].filter((k) => FILM_PICK_KEY.test(k) && !records.has(k));
  if (unexplained.length) for (const id of new Set(P.assetIds)) for (let o = 0; o < keptKeySet.size + removedKeys.size + 2; o++) if (unexplained.includes(filmPickKey(id, o))) { removedFiles.add(id); break; }
  // a picture kept by hand keeps its pick: its file is not placed again, also when the clip now shows another file (replaced by hand)
  for (const k of keptKeySet) { const r = records.get(k); if (r) keptAssets.add(r.assetId); }
  const regenerating = ctx.picked !== undefined;

  // ===== 2. candidates =====
  const excludeSet = new Set(P.picks.exclude), seen = new Set<string>(), usedRecords = new Set<string>();
  const cands: Cand[] = [];
  for (const [given, id] of P.assetIds.entries()) {
    if (seen.has(id)) continue;
    seen.add(id);
    const a = own(doc.assets, id);
    if (!a) { exclude(id, 'no_picture', { reason: 'not in this project' }); continue; }
    if (!isPicture(a)) { exclude(id, 'no_picture', { kind: a.kind }); continue; }
    if (excludeSet.has(id)) { exclude(id, 'excluded_by_you'); continue; }
    if (keptAssets.has(id)) { exclude(id, 'kept_by_hand'); continue; }
    if (removedFiles.has(id)) { exclude(id, 'removed_by_hand'); continue; }
    const capacity = filmCapacityOf(a, rate);
    if (capacity < gap) { exclude(id, 'too_short', { seconds: secs(capacity), shortestSeconds: secs(gap) }); continue; }
    const rec = filmMomentsOf(doc, id);
    const ws = rec && rec.algo === MOMENTS_ALGO && !rec.flat ? rec.windows : [];
    const wanted = own(P.picks.window, id);
    const chosen = wanted !== undefined && wanted < ws.length;
    const record = [...records.values()].find((r) => r.assetId === id && !usedRecords.has(r.key) && !keptKeySet.has(r.key) && !removedKeys.has(r.key)) ?? null;
    if (record) usedRecords.add(record.key);
    cands.push({ asset: a, given, capacity, rec, windowIndex: ws.length ? (chosen ? wanted! : 0) : null, chosen, record });
  }
  if (!cands.length && !keptPictures.length) throw storyRefusal('nothingToShow');

  // ===== 3. cuts =====
  const cutOf: (Cut | null)[] = cands.map(() => null);
  const chips: StoryChip[] = [];
  const insideKept = (f: number) => keptPictures.some((k) => k.s <= f && f < k.e);
  if (!regenerating) {
    if (cands.length) cutOf[0] = { frame: S, ms: null, how: 'first' };
    let next = 1, prev = S;
    for (const [index, ms] of P.cutsMs.entries()) {
      if (!inNarr(ms)) { chips.push({ index, cutMs: ms, state: 'held', reason: 'outside_narration' }); continue; }
      const frame = frameOfMs(ms);
      if (next >= cands.length) { chips.push({ index, cutMs: ms, state: 'held', reason: 'no_picture_left', frame }); continue; }
      if (frame - prev < gap || E - frame < gap) { chips.push({ index, cutMs: ms, state: 'held', reason: 'too_close', frame }); continue; }
      if (insideKept(frame)) { chips.push({ index, cutMs: ms, state: 'held', reason: 'kept_by_hand', frame }); continue; }
      cutOf[next++] = { frame, ms, how: 'tap' };
      prev = frame;
      chips.push({ index, cutMs: ms, state: 'kept', frame });
    }
  } else {
    // every surviving pick takes its recorded cut again, in show order and at least the gap apart; others are resolved below
    let prev: number | null = null;
    for (const [i, c] of cands.entries()) {
      const r = c.record;
      if (!r) continue;
      if (r.cutMs === null) { if (prev === null) { cutOf[i] = { frame: S, ms: null, how: r.how }; prev = S; } continue; }
      if (!inNarr(r.cutMs)) continue;
      const frame = frameOfMs(r.cutMs);
      if (frame < (prev ?? S) + gap || E - frame < gap) continue;
      cutOf[i] = { frame, ms: r.cutMs, how: r.how };
      prev = frame;
    }
  }
  // runs of candidates without a cut: pause cuts, else even cuts; parts under STORY.minAutoMs leave the last ones out
  const minAutoF = msF(STORY.minAutoMs), reachMax = msF(STORY.pauseReachMs);
  const usedOnsets = new Set(cutOf.flatMap((c) => (c ? [c.frame] : [])));
  const dropped = new Set<number>();
  let pauseCount = 0, evenCount = 0;
  for (let i = 0; i < cands.length;) {
    if (cutOf[i]) { i++; continue; }
    if (i === 0) { cutOf[0] = { frame: S, ms: null, how: 'first' }; i = 1; continue; }
    let j = i;
    while (j < cands.length && !cutOf[j]) j++;
    const a = cutOf[i - 1]!.frame, b = j < cands.length ? cutOf[j]!.frame : E, L = b - a;
    let parts = j - i + 1;
    while (parts > 1 && L < minAutoF * parts) parts--;
    const reach = Math.min(Math.floor(L / (3 * parts)), reachMax);
    let prev = a;
    for (let k = 1; k <= j - i; k++) {
      const idx = i + k - 1;
      if (k >= parts) { dropped.add(idx); exclude(cands[idx]!.asset.id, 'no_room', { reason: `the stretch left for it is shorter than ${STORY.minAutoMs / 1000} s a picture` }); continue; }
      const ideal = a + roundDivInt(k * L, parts);
      let best: number | null = null;
      for (const o of onsetFrames) {
        if (usedOnsets.has(o) || Math.abs(o - ideal) > reach || o - prev < gap || b - o < gap) continue;
        if (best === null || Math.abs(o - ideal) < Math.abs(best - ideal)) best = o;
      }
      const frame = best ?? ideal;
      if (best !== null) { usedOnsets.add(best); pauseCount++; } else evenCount++;
      cutOf[idx] = { frame, ms: msOfFrame(frame), how: best !== null ? 'pause' : 'even' };
      prev = frame;
    }
    i = j;
  }
  if (pauseCount + evenCount) warn('auto_cuts', `${pauseCount + evenCount} picture(s) had no tap: ${pauseCount} cut at a pause in the voice, ${evenCount} spread evenly (heuristic)`, { pause: pauseCount, even: evenCount });

  // ===== 4. layout around the kept pictures =====
  const live = cands.flatMap((c, i) => (dropped.has(i) ? [] : [{ c, cut: cutOf[i]! }]));
  let spans: Span[] = live.map((x, i) => ({ c: x.c, cut: x.cut, s: x.cut.frame, e: live[i + 1]?.cut.frame ?? E }));
  const obstacles = keptPictures.map((k) => ({ s: k.s, e: k.e }));
  const lost = (sp: Span, reason: string) => exclude(sp.c.asset.id, 'no_room', { reason });
  spans = spans.filter((sp) => {
    for (let moved = true; moved;) { moved = false; for (const o of obstacles) if (o.s <= sp.s && sp.s < o.e) { sp.s = o.e; moved = true; } }
    for (const o of obstacles) if (sp.s < o.s && o.s < sp.e) sp.e = o.s;
    if (sp.e > sp.s) return true;
    lost(sp, 'its place is taken by a clip kept by hand');
    return false;
  });
  // fill: the first picture after S or after a kept clip starts where that ends; a hole between two pictures goes to the one before
  const fillSweep = () => {
    const items = [...spans.map((sp) => ({ s: sp.s, e: sp.e, sp })), ...obstacles.map((o) => ({ s: o.s, e: o.e, sp: null as Span | null }))].sort((x, y) => x.s - y.s || (x.sp ? 1 : 0) - (y.sp ? 1 : 0));
    let cursor = S, prevPic: Span | null = null;
    for (const it of items) {
      if (it.sp) {
        if (it.sp.s > cursor) {
          if (prevPic && prevPic.e === cursor && (isStill(prevPic.c.asset) || it.sp.s - prevPic.s <= prevPic.c.capacity)) prevPic.e = it.sp.s;
          else it.sp.s = cursor;
        }
        cursor = Math.max(cursor, it.sp.e);
        prevPic = it.sp;
      } else { cursor = Math.max(cursor, it.e); prevPic = null; }
    }
  };
  fillSweep();
  for (const sp of spans) if (sp.s !== sp.cut.frame && obstacles.some((o) => o.e === sp.s)) sp.filled = sp.s - sp.cut.frame;
  // a video shorter than its span plays whole; the next picture starts at its end (a cut that obeys the gap: capacity >= gap)
  spans.sort((x, y) => x.s - y.s);
  for (const [i, sp] of spans.entries()) {
    if (sp.e - sp.s <= sp.c.capacity) continue;
    const end = sp.s + sp.c.capacity;
    const next = spans[i + 1];
    if (next && next.s === sp.e) next.s = end;
    sp.endedEarly = sp.e - end;
    sp.e = end;
  }
  // flash safety next to kept clips: a picture shorter than the gap is left out and a neighbour runs over its frames (ADR-0009)
  for (let i = 0; i < spans.length; i++) {
    const sp = spans[i]!;
    if (sp.e - sp.s >= gap) continue;
    const prev = spans[i - 1], next = spans[i + 1];
    if (prev && prev.e === sp.s && (isStill(prev.c.asset) || sp.e - prev.s <= prev.c.capacity)) prev.e = sp.e;
    else if (next && next.s === sp.e && (isStill(next.c.asset) || next.e - sp.s <= next.c.capacity)) next.s = sp.s;
    lost(sp, 'it would show for less than the flash gap next to a clip kept by hand');
    spans.splice(i--, 1);
  }
  if (!spans.length && !keptPictures.length) throw storyRefusal('nothingToShow');

  // ===== 5. keys and source windows =====
  const usedKeys = new Set([...keptKeySet, ...removedKeys]);
  const picks: StoryPick[] = [];
  const ownOn = P.ownSound === 'under';
  for (const [order, sp] of spans.entries()) {
    let key = sp.c.record && !usedKeys.has(sp.c.record.key) ? sp.c.record.key : null;
    for (let ord = 0; key === null; ord++) if (!usedKeys.has(filmPickKey(sp.c.asset.id, ord))) key = filmPickKey(sp.c.asset.id, ord);
    usedKeys.add(key);
    const frames = sp.e - sp.s;
    const w = filmSourceWindow(sp.c.asset, sp.c.rec, sp.c.windowIndex, frames, rate, { chosenByYou: sp.c.chosen });
    picks.push({
      key, assetId: sp.c.asset.id, cutMs: sp.cut.ms, how: sp.cut.how, order, startFrame: sp.s, frames,
      sourceInFrame: w.sourceInFrame, sourceFrames: w.sourceFrames, kind: w.kind, windowIndex: w.windowIndex, reasons: w.reasons,
      ...(sp.endedEarly ? { endedEarly: true as const } : {}), ownSound: ownOn && hasSound(sp.c.asset),
    });
  }
  // chips of a regeneration: a tap is kept when a pick still starts on it
  if (regenerating) for (const [index, ms] of P.cutsMs.entries()) {
    if (!inNarr(ms)) { chips.push({ index, cutMs: ms, state: 'held', reason: 'outside_narration' }); continue; }
    const frame = frameOfMs(ms);
    const pick = picks.find((k) => k.how === 'tap' && k.cutMs === ms);
    if (pick) chips.push({ index, cutMs: ms, state: 'kept', frame });
    else chips.push({ index, cutMs: ms, state: 'held', reason: insideKept(frame) ? 'kept_by_hand' : 'no_picture_left', frame });
  }
  const ended = spans.filter((sp) => sp.endedEarly);
  if (ended.length) warn('clip_ended_early', `${ended.length} video(s) are shorter than their part of the story: each plays whole and the next picture starts when it ends (${ended.map((sp) => `"${quote(sp.c.asset.name)}" ${secs(sp.endedEarly!)} s early`).join(', ')})`, { items: ended.map((sp) => ({ assetId: sp.c.asset.id, seconds: secs(sp.endedEarly!), frames: sp.endedEarly })) });
  const filled = spans.filter((sp) => sp.filled);
  if (filled.length) warn('filled_next_to_kept', `${filled.length} picture(s) next to clips kept by hand start where those end, so no frame is left without a picture (${filled.map((sp) => `"${quote(sp.c.asset.name)}" ${secs(Math.abs(sp.filled!))} s ${sp.filled! < 0 ? 'earlier' : 'later'}`).join(', ')})`, { items: filled.map((sp) => ({ assetId: sp.c.asset.id, seconds: secs(sp.filled!) })) });
  const needsMeasurement = [...new Set(spans.filter((sp) => !isStill(sp.c.asset) && !(sp.c.rec && sp.c.rec.algo === MOMENTS_ALGO)).map((sp) => sp.c.asset.id))];
  if (needsMeasurement.length) warn('not_measured', `${needsMeasurement.length} video(s) have no measured moments yet; the middle of each is used until they are measured`, { assetIds: needsMeasurement });
  const shapes = new Set(spans.map((sp) => { const a = sp.c.asset; const rot = a.video?.rotation === 90 || a.video?.rotation === 270; const w0 = a.video?.width ?? a.image?.width ?? 1, h0 = a.video?.height ?? a.image?.height ?? 1; const [w, h] = rot ? [h0, w0] : [w0, h0]; return h > w * 1.1 ? 'tall' : w > h * 1.1 ? 'wide' : 'square'; }));
  if (shapes.has('tall') && shapes.has('wide')) warn('mixed_orientation', 'the story mixes upright and wide pictures; some will show with bars or cropped', { shapes: [...shapes].sort() });
  if (removedKeys.size) {
    const names = [...removedFiles].map((id) => `"${quote(own(doc.assets, id)?.name ?? id)}"`);
    if (removedTitle) names.push('the opening title');
    if (removedMusic) names.push('the music');
    warn('removed_by_hand', `left out because they were deleted by hand: ${names.join(', ') || `${removedKeys.size} part(s)`}; rebuild with restoreRemoved to make them again (each picture at its own cut)`, { keys: [...removedKeys].sort(), assetIds: [...removedFiles].sort() });
  }

  // ===== 6. tracks =====
  const ops: TemplateStep[] = [];
  const plannedSlots: PlannedSlot[] = [];
  const ref = (bind: string, out?: string): Ref => (out ? { $ref: bind, out } : { $ref: bind });
  const trackById = (id: string | undefined) => (id ? seq.tracks.find((t) => t.id === id) : undefined);
  const free = (t: Track, ranges: readonly [number, number][]) => ranges.every(([s, e]) => !t.clips.some((c) => nf(c.start) < e && s < nf(clipEnd(c))));
  type TrackUse = { arg: string | Ref; status: 'reused' | 'empty' | 'new'; name: string };
  const taken = new Set<string>();
  if (narr.trackId) taken.add(narr.trackId);
  const chooseTrack = (kind: 'video' | 'audio', reuse: string | undefined, bind: string, ranges: readonly [number, number][]): TrackUse => {
    const r = trackById(reuse);
    if (r && r.kind === kind && !r.locked && !(kind === 'video' ? r.hidden : r.muted) && !taken.has(r.id) && free(r, ranges)) { taken.add(r.id); return { arg: r.id, status: 'reused', name: r.name }; }
    const e = seq.tracks.find((t) => t.kind === kind && !t.locked && !t.hidden && !t.muted && t.clips.length === 0 && !t.audio && !taken.has(t.id));
    if (e) { taken.add(e.id); return { arg: e.id, status: 'empty', name: e.name }; }
    ops.push({ op: 'add_track', args: { kind }, bind });
    return { arg: ref(bind, 'trackId'), status: 'new', name: kind === 'video' ? 'a new picture track' : 'a new sound track' };
  };
  const pictures = picks.length ? chooseTrack('video', ctx.reuseTracks?.pictures, STORY_BINDS.pictures, picks.map((k) => [k.startFrame, k.startFrame + k.frames] as [number, number])) : null;
  const narrationNew = ctx.narrationClipId === undefined;
  const voiceTrack: TrackUse = narrationNew ? chooseTrack('audio', ctx.reuseTracks?.voiceTrack, STORY_BINDS.voiceTrack, [[S, E]]) : { arg: narr.trackId!, status: 'reused', name: trackById(narr.trackId!)?.name ?? '' };
  const sounding = picks.filter((k) => k.ownSound);
  const ownTrack = sounding.length ? chooseTrack('audio', ctx.reuseTracks?.ownSound, STORY_BINDS.ownSound, sounding.map((k) => [k.startFrame, k.startFrame + k.frames] as [number, number])) : null;
  let musicAsset: Asset | null = null;
  if (P.musicAssetId !== null) {
    const m = own(doc.assets, P.musicAssetId);
    if (!m || m.kind !== 'audio' || !m.audio) throw storyRefusal('badParams', 'musicAssetId: not a sound file of this project');
    musicAsset = m;
  }
  const tailF = msF(STORY.tailMs);
  const placeMusic = !!musicAsset && !keptMusic && !removedMusic;
  const musicTrack = placeMusic ? chooseTrack('audio', ctx.reuseTracks?.musicTrack, STORY_BINDS.musicTrack, [[S, E + tailF]]) : null;

  // ===== the narration =====
  if (narrationNew) {
    ops.push({ op: 'add_clip', args: { assetId: narr.assetId, trackId: voiceTrack.arg, start: narr.start, sourceIn: narr.sourceIn, duration: narr.duration, withLinkedAudio: false }, bind: STORY_BINDS.narration });
    plannedSlots.push({ key: STORY_BINDS.narration, kind: 'sound', clipId: ref(STORY_BINDS.narration) });
    steps.push(clipText(`Place the narration "${quote(nAsset.name)}" (${secs(E - S)} s) on ${voiceTrack.status === 'new' ? voiceTrack.name : `track ${voiceTrack.name}`}`));
  } else steps.push(clipText(`Keep the narration where it lies (${secs(S)}–${secs(E)} s); the pictures follow it`));

  // ===== the music: ducked under the voice track for the whole narration =====
  const mix = storyMix(P.ownSound, placeMusic || keptMusic);
  const prevKnown = ctx.previousOwnSound !== undefined;
  const prevMix = prevKnown ? storyMix(ctx.previousOwnSound!, ctx.previousMusic ?? false) : { ownGain: 1, duckDb: null };
  if (placeMusic && musicAsset && musicTrack) {
    const want = E + tailF - S, have = T.frameCount(musicAsset.duration, rate);
    ops.push({ op: 'add_clip', args: { assetId: musicAsset.id, trackId: musicTrack.arg, start: narr.start, sourceIn: T.ZERO, duration: ft(Math.min(want, have)), withLinkedAudio: false }, bind: STORY_BINDS.music });
    ops.push({ op: 'fit_music', args: { clipId: ref(STORY_BINDS.music), to: ft(E + tailF) } });
    plannedSlots.push({ key: STORY_BINDS.music, kind: 'music', clipId: ref(STORY_BINDS.music) });
    const was = musicTrack.status === 'reused' && prevKnown ? prevMix.duckDb : null;
    const duck = musicTrack.status === 'reused' ? trackById(musicTrack.arg as string)?.audio?.duck : null;
    const sameDuck = !!duck && typeof voiceTrack.arg === 'string' && duck.sourceTrackIds.includes(voiceTrack.arg) && was === mix.duckDb;
    if (!sameDuck) ops.push({ op: 'set_ducking', args: { trackId: musicTrack.arg, sourceTrackIds: [voiceTrack.arg], reductionDb: STORY.duckDb, attackMs: STORY.duckAttackMs, releaseMs: STORY.duckReleaseMs } });
    if (have < want) warn('music_short', `the music "${quote(musicAsset.name)}" is ${secs(want - have)} s shorter than the narration and its ${STORY.tailMs / 1000} s tail; it ends before the story does (it is not looped)`, { seconds: secs(want - have), musicSeconds: secs(have), neededSeconds: secs(want) });
    steps.push(clipText(`Place the music "${quote(musicAsset.name)}" under the narration, ${STORY.duckDb} dB lower while the narration plays, ending ${STORY.tailMs / 1000} s after it`));
  } else if (keptMusic) steps.push('Keep the music edited by hand');
  else if (removedMusic) steps.push('Leave out the music: it was deleted by hand');

  // ===== the pictures =====
  const fadeF = msF(STORY.fadeMs);
  for (const k of picks) {
    const a = own(doc.assets, k.assetId)!;
    ops.push({ op: 'add_clip', args: {
      assetId: a.id, trackId: pictures!.arg, start: ft(k.startFrame), duration: ft(k.frames),
      ...(k.sourceInFrame !== null ? { sourceIn: sourceTimeOfFrame(a, k.sourceInFrame) } : {}),
      withLinkedAudio: k.ownSound, ...(k.ownSound && ownTrack ? { audioTrackId: ownTrack.arg } : {}),
    }, bind: k.key });
    plannedSlots.push({ key: k.key, kind: 'picture', clipId: ref(k.key), accept: isStill(a) ? 'image' : 'video' });
  }
  for (const k of sounding) {
    const f = Math.min(fadeF, Math.floor(k.frames / 2));
    if (f >= 1) ops.push({ op: 'set_clip_fades', args: { clipId: ref(k.key, 'audioClipId'), fadeIn: ft(f), fadeOut: ft(f) } });
  }
  const stills = P.motion === 'full' ? picks.filter((k) => k.kind === 'still' && k.frames >= 2) : [];
  for (const k of stills) ops.push({ op: 'apply_motion_preset', args: { clipId: ref(k.key), presetId: STILL_MOTION } });
  const counts = { tap: picks.filter((k) => k.how === 'tap').length, pause: picks.filter((k) => k.how === 'pause').length, even: picks.filter((k) => k.how === 'even').length };
  if (picks.length) steps.push(clipText(`Place ${picks.length} picture(s) on ${pictures!.status === 'new' ? pictures!.name : `track ${pictures!.name}`}: ${counts.tap} on your taps${counts.pause ? `, ${counts.pause} at pauses in the voice` : ''}${counts.even ? `, ${counts.even} spread evenly` : ''}`));
  if (stills.length) steps.push(`Give ${stills.length} photo(s) a slow zoom in (Ken Burns)`);
  else if (P.motion === 'none' && picks.some((k) => k.kind === 'still')) steps.push('No camera moves on the photos (reduced motion)');

  // ===== the clips' own sound: under the narration, music or not (the story's own rule) =====
  if (ownTrack) {
    const was = ownTrack.status === 'reused' && prevKnown ? prevMix.ownGain : 1;
    if (mix.ownGain !== was) ops.push({ op: 'set_track_audio', args: { trackId: ownTrack.arg, gain: mix.ownGain } });
    steps.push(clipText(`Keep the videos' own sound on ${ownTrack.status === 'new' ? ownTrack.name : `track ${ownTrack.name}`}, ${Math.round(-20 * Math.log10(mix.ownGain))} dB under the narration, with ${STORY.fadeMs / 1000} s fades`));
  } else if (P.ownSound === 'mute') steps.push('Leave the videos\' own sound out (muted)');
  basis.push(P.ownSound === 'under' ? `the videos' own sound plays ${Math.round(-20 * Math.log10(STORY.ownGainUnder))} dB under the narration whether or not there is music (the story's own rule: the narration leads)` : 'the videos\' own sound is left out');

  // ===== the opening title =====
  const allPictures = [...picks.map((k) => [k.startFrame, k.startFrame + k.frames] as const), ...keptPictures.map((k) => [k.s, k.e] as const)].sort((a, b) => a[0] - b[0]);
  const picturesStart = allPictures.length ? allPictures[0]![0] : S;
  const picturesEnd = allPictures.reduce((x, r) => Math.max(x, r[1]), S);
  if (P.openingTitle && !keptTitle && !removedTitle && picturesEnd > picturesStart) {
    const title: FilmText = ctx.title ?? { text: P.openingText ?? P.event?.name ?? DEFAULT_TITLE[lang], resolved: null, live: false };
    if (!title.live && P.openingText === undefined) warn('title_resolved_static', ctx.title ? 'the opening title is fixed text: not every picture has a capture date to show' : 'the opening title is fixed text: no live title was given', {});
    const minTitle = nf(T.rt(2, 1));
    const ends = allPictures.map((r) => r[1]).filter((e) => e - picturesStart >= minTitle);
    const titleEnd = ends.length ? Math.min(...ends) : picturesEnd;
    let look = TITLE_LOOK;
    if (ctx.titleLookId !== undefined) { if (findTextPreset(ctx.titleLookId)) look = ctx.titleLookId; else basis.push(clipText(`the title look "${quote(ctx.titleLookId)}" is not in this build; the ${TITLE_LOOK} look is used`)); }
    ops.push({ op: 'add_text', args: { text: title.text, start: ft(picturesStart), duration: ft(titleEnd - picturesStart), transform: { x: 0, y: FILM.titleY }, ...(title.live ? { fields: true } : {}) }, bind: STORY_BINDS.title });
    ops.push({ op: 'apply_text_preset', args: { clipId: ref(STORY_BINDS.title), presetId: look } });
    const frames = titleEnd - picturesStart;
    const af = Math.max(1, Math.min(msF(500), Math.floor(frames / 3)));
    if (P.motion === 'full' && 2 * af <= frames) ops.push({ op: 'set_text_animation', args: { clipId: ref(STORY_BINDS.title), animation: { by: 'word', in: 'fade', out: 'fade', loop: null, inFrames: af, outFrames: af } } });
    plannedSlots.push({ key: STORY_BINDS.title, kind: 'text', clipId: ref(STORY_BINDS.title) });
    steps.push(clipText(`Add the opening title "${quote(title.text)}" over the first ${secs(frames)} s${title.live ? ' (live fields)' : ''}${P.motion === 'full' ? ', fading in and out' : ' without animation (reduced motion)'}`));
  } else if (keptTitle) steps.push('Keep the opening title edited by hand');
  else if (removedTitle && P.openingTitle) steps.push('Leave out the opening title: it was deleted by hand');

  // ===== what the plan predicts =====
  const bounds = new Set<number>();
  for (const [s, e] of allPictures) { bounds.add(s); bounds.add(e); }
  const cuts = [...bounds].filter((f) => f > picturesStart && f < E).sort((a, b) => a - b);
  let covered = 0, reach = picturesStart;
  for (const [s, e] of allPictures) { const e2 = Math.min(e, E); if (e2 <= reach) continue; covered += e2 - Math.max(s, reach); reach = e2; }
  const gapFrames = Math.max(0, E - picturesStart - covered);
  if (picturesEnd < E) warn('pictures_end_before_voice', `the pictures end ${secs(E - picturesEnd)} s before the narration does (the last video is shorter than its part)`, { frames: E - picturesEnd, seconds: secs(E - picturesEnd) });
  if (kept.length) basis.push(`${kept.length} clip(s) edited by hand are kept; the new pictures are laid around ${keptPictures.length} kept picture(s)`);
  basis.push(...required, `${P.assetIds.length} chosen file(s), ${picks.length} picture(s) in the story; ${rate.num}/${rate.den} frames a second; cuts at least ${gap} frames apart (flash safety)`);
  if (ops.length > STORY.maxOps) throw storyRefusal('badParams', `this story would need ${ops.length} operations; at most ${STORY.maxOps} fit in one step`);

  const alternatives: StoryPlan['alternatives'] = [
    P.ownSound === 'under' ? { label: 'Leave the videos\' own sound out', params: { ownSound: 'mute' as const } } : { label: 'The videos\' own sound 12 dB under the narration', params: { ownSound: 'under' as const } },
    P.motion === 'full' ? { label: 'No camera moves or animated titles (reduced motion)', params: { motion: 'none' as const } } : { label: 'With camera moves and animated titles', params: { motion: 'full' as const } },
    ...(P.musicAssetId !== null ? [{ label: 'Without music', params: { musicAssetId: null } }] : []),
    ...(removedKeys.size ? [{ label: `Restore the ${removedKeys.size} part(s) deleted by hand`, params: {}, restoreRemoved: true as const }] : []),
  ];
  return {
    recipeId: STORY_RECIPE_ID, templateId: STORY_TEMPLATE_ID, version: STORY_VERSION, params: P,
    steps: steps.slice(0, STORY.maxSteps).map(clipText), basis: capKeeping(basis.map(clipText), required, STORY.maxSteps), warnings, blocking, alternatives,
    picks, excluded, chips, ops, slots: plannedSlots,
    predicted: { startFrame: S, endFrame: E, cuts, tapCuts: counts.tap, pauseCuts: counts.pause, evenCuts: counts.even, gapFrames, seconds: secs(E - S) },
    narration: { seconds: Math.round(T.toSeconds(narr.duration) * 100) / 100, onsetsMs, measured: !!voice },
    method: STORY_METHOD,
  };
};

/** A plan that cannot be applied (blocking): nothing to place, the reason in `blocking`. */
function blockedPlan(P: ResolvedStoryParams, blocking: StoryWarning[], required: string[], doc: ProjectDocument): StoryPlan {
  return {
    recipeId: STORY_RECIPE_ID, templateId: STORY_TEMPLATE_ID, version: STORY_VERSION, params: P,
    steps: [], basis: [...required, `${doc.settings.frameRate.num}/${doc.settings.frameRate.den} frames a second; nothing can be placed while the narration cannot be followed`], warnings: [], blocking, alternatives: [],
    picks: [], excluded: [], chips: [], ops: [], slots: [],
    predicted: { startFrame: 0, endFrame: 0, cuts: [], tapCuts: 0, pauseCuts: 0, evenCuts: 0, gapFrames: 0, seconds: 0 },
    narration: { seconds: 0, onsetsMs: [], measured: false },
    method: STORY_METHOD,
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/**
 * The picture while tapping (C3, C8): planStory with the taps so far (`tapsMs`, narration source ms), own sound muted, applied in
 * memory as one apply_template with a fixed idSeed, so the narration and music clips keep their ids and the sound plan never changes
 * between calls. A tap the plan holds (too_close, …) changes nothing: the document is the one planned from the kept taps only.
 * Null when the plan refuses or blocks (the view shows the base ghost).
 */
export function storyLiveDocument(base: ProjectDocument, params: unknown, ctx: StoryPlanContext, tapsMs: readonly number[]): ProjectDocument | null {
  const p = isObject(params) ? params : {};
  const taps = [...new Set(tapsMs.filter((ms) => Number.isInteger(ms) && ms >= 0 && ms <= STORY.maxNarrationMs))].sort((a, b) => a - b).slice(0, STORY.maxCuts);
  const plan = (cutsMs: number[]): StoryPlan | null => {
    try { return planStory(base, { ...p, cutsMs, ownSound: 'mute' }, ctx); } catch (e) { if (e instanceof StoryError) return null; throw e; }
  };
  let pl = plan(taps);
  if (!pl || pl.blocking.length) return null;
  const keptTaps = pl.chips.filter((c) => c.state === 'kept').map((c) => c.cutMs);
  if (keptTaps.length !== taps.length) pl = plan(keptTaps);
  if (!pl || pl.blocking.length) return null;
  try {
    return applyTransaction(base, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(pl, []), steps: pl.steps, ops: pl.ops, slots: pl.slots, recordRanges: true } }], { idSeed: STORY_LIVE_SEED, actor: 'story:live', allowInternal: true }).doc;
  } catch (e) { if (e instanceof OpError) return null; throw e; }
}
