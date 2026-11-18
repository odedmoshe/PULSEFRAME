/**
 * The ONE flash rule of perform mode (ADR-0025; ADR-0009 decision 1 and its 2026-11-18 amendment). Lead-built. Used by the
 * planner (moves.ts, W1: it holds a hit `flash_limit` instead of planning it) AND by the op apply_take (takeOps.ts), which
 * re-checks the result and refuses rather than trusting the plan.
 *
 * What changes light (one source of truth, wave5-decisions.md): an effect changes light unless EVERY numeric parameter it has may
 * follow the beat (effects.ts modulatableParams — the classification the curve rule, keyframeChannels.ts isLightChannel, and the
 * beat modulators already use; default-deny, so an effect added later changes light until someone lists it in MODULATABLE). The
 * rule reads that classification through a FlashTable FROZEN per version of apply_take (FLASH_TABLE_V1), not live, so a
 * stored take replays to the same answer; a reclassification ships as a new apply_take version. The
 * strobe (light.strobe) and the light transitions (TransitionDef.light) are the light the flash schedule owns
 * (packages/engine/src/strobeSchedule.ts); this module reads the document only (core cannot import the engine).
 *
 * The rule, for the sequence the take was performed on, after the take's steps ran:
 * 1. LIGHT RANGES claim their frames first: every clip with an enabled light.strobe (any clip type, adjustments included, old
 *    or made by the take) over the frames it is drawn on, and every media clip with a light transition over the transition's
 *    frames; each widened by flashGapFrames on both sides.
 * 2. CHANGES OF LIGHT ("colour starts") are the first frames of: every adjustment clip whose enabled effects change light (old or
 *    new), and every picture or title clip the take made (a sticker or title appearing is a change of light too).
 * 3. Every change of light the TAKE made must be at least flashGapFrames after and before every other change of light (old or
 *    new), and outside every widened light range. Pairs of old clips are not judged here (they are the owner's own edit; the
 *    export's flash check reads them).
 * 4. Every picture, title or light-changing adjustment the take made lasts at least flashGapFrames (a third of a second and one
 *    frame), so it cannot switch on and off faster than three times a second.
 * Sound clips and moves that change no light (a blur hit, a pixelate hit, the zoom punch's keys) are not limited.
 */
import * as T from '@pulseframe/time';
import type { Clip, ProjectDocument } from './schema.ts';
import { animatableParams, EFFECTS, findEffect, modulatableParams, TRANSITIONS } from './effects.ts';
import { flashGapFrames } from './flashSafety.ts';

/**
 * The tables the rule reads, FROZEN per version of apply_take (a stored take must replay to the same answer whatever later
 * releases do to MODULATABLE, the effect parameter schemas or the transition catalogue). A reclassification ships as a new
 * version of apply_take with a new table; the version-1 literal is never edited (performContracts.test.ts pins it and checks it
 * against liveFlashTable, which is only how a new version's table is worked out).
 * - neutralEffects: the effect types that change no light (every numeric parameter may follow the beat). Every other type,
 *   unknown types included, changes light; light.strobe is light.
 * - lightTransitions: the transition types whose frames are light (TransitionDef.light).
 */
export interface FlashTable { readonly version: number; readonly neutralEffects: readonly string[]; readonly lightTransitions: readonly string[] }
export const FLASH_TABLE_V1: FlashTable = Object.freeze({
  version: 1,
  neutralEffects: Object.freeze(['blur.gaussian', 'distort.fisheye', 'stylize.pixelate']),
  lightTransitions: Object.freeze(['film-burn', 'light-leak']),
});
/** The table the current catalogue gives (the derivation; never read by apply_take). */
export function liveFlashTable(version: number): FlashTable {
  return { version, neutralEffects: EFFECTS.map((e) => e.id).filter((id) => !effectChangesLight(id)).sort(), lightTransitions: TRANSITIONS.filter((t) => t.light).map((t) => t.id).sort() };
}

/** Whether an effect type changes light by the LIVE catalogue (see the header); the derivation of a new FlashTable. Unknown types change light. */
export function effectChangesLight(type: string): boolean {
  if (type === 'light.strobe' || !findEffect(type)) return true;
  const mod = modulatableParams(type);
  return mod.length === 0 || animatableParams(type).some((p) => !mod.includes(p));
}
/** Whether an effect type changes light by a frozen table (what the rule reads). */
export const effectChangesLightIn = (table: FlashTable, type: string): boolean => type === 'light.strobe' || !table.neutralEffects.includes(type);
/** The effect types that change no light under version 1 (the frozen list). */
export const FLASH_NEUTRAL_EFFECTS: readonly string[] = FLASH_TABLE_V1.neutralEffects;
export type FlashClass = 'none' | 'colour' | 'light';
/** The class of a set of effects (an adjustment's, or a pad's): 'light' with an enabled strobe, else 'colour' when any enabled effect changes light, else 'none'. */
export function flashClassOf(effects: readonly { type: string; enabled?: boolean }[], table: FlashTable = FLASH_TABLE_V1): FlashClass {
  const on = effects.filter((e) => e.enabled !== false);
  if (on.some((e) => e.type === 'light.strobe')) return 'light';
  return on.some((e) => effectChangesLightIn(table, e.type)) ? 'colour' : 'none';
}

const firstFrameAt = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };
const framesOf = (c: Clip, rate: T.Rate) => { const from = firstFrameAt(c.start, rate); return { from, to: firstFrameAt(T.add(c.start, c.duration), rate) }; };

/** A stretch of frames a strobe or light transition lights ([from, to), timeline frames, NOT widened). */
export interface LightRange { clipId: string; from: number; to: number; kind: 'strobe' | 'transition' }
/** A change of light: the first frame of a light-changing adjustment, or of a picture or title the take made. */
export interface LightChange { clipId: string; frame: number; frames: number; kind: 'adjustment' | 'picture' | 'title' }

/** Step 1 of the rule: the light ranges of a sequence. */
export function lightRanges(doc: ProjectDocument, sequenceId = doc.mainSequenceId, table: FlashTable = FLASH_TABLE_V1): LightRange[] {
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  const rate = doc.settings.frameRate, out: LightRange[] = [];
  for (const track of seq?.tracks ?? []) {
    if (track.kind === 'audio') continue;
    for (const c of track.clips) {
      if (c.type === 'caption') continue;
      const { from, to } = framesOf(c, rate);
      if ((c.effects ?? []).some((e) => e.type === 'light.strobe' && e.enabled !== false) && to > from) out.push({ clipId: c.id, from, to, kind: 'strobe' });
      const tr = c.type === 'media' && track.kind === 'video' ? c.transition : undefined;
      if (tr && table.lightTransitions.includes(tr.type)) out.push({ clipId: c.id, from, to: Math.min(to, from + tr.frames), kind: 'transition' });
    }
  }
  return out.sort((a, b) => a.from - b.from || a.to - b.to || (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0));
}

/** Step 2 of the rule: the changes of light of a sequence; `made` names the clips the take made (their pictures and titles count too). */
export function lightChanges(doc: ProjectDocument, made: ReadonlySet<string>, sequenceId = doc.mainSequenceId, table: FlashTable = FLASH_TABLE_V1): LightChange[] {
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  const rate = doc.settings.frameRate, out: LightChange[] = [];
  for (const track of seq?.tracks ?? []) {
    if (track.kind === 'audio') continue;
    for (const c of track.clips) {
      const { from, to } = framesOf(c, rate);
      if (c.type === 'adjustment') { if (flashClassOf(c.effects ?? [], table) === 'colour') out.push({ clipId: c.id, frame: from, frames: to - from, kind: 'adjustment' }); }
      else if (made.has(c.id) && c.type === 'text') out.push({ clipId: c.id, frame: from, frames: to - from, kind: 'title' });
      else if (made.has(c.id) && c.type === 'media' && track.kind === 'video') out.push({ clipId: c.id, frame: from, frames: to - from, kind: 'picture' });
    }
  }
  return out.sort((a, b) => a.frame - b.frame || (a.clipId < b.clipId ? -1 : a.clipId > b.clipId ? 1 : 0));
}

/**
 * Why the take breaks the rule, for the FIRST offending clip it made (in timeline order), or null.
 * - gap: its change of light is `since` frames from another change of light (`other`)
 * - light: its change of light lies inside a widened light range (`other` is the strobe or transition clip; `since` = frames
 *   from the start of that light, negative when before it)
 * - short: it lasts `since` frames, fewer than the gap
 * Also true of a strobe adjustment the take made that sits within the gap of a change of light: the light claims its range first.
 */
export interface FlashBreach { clipId: string; frame: number; since: number; gapFrames: number; why: 'gap' | 'light' | 'short'; other?: string }
export function takeFlashBreach(doc: ProjectDocument, sequenceId: string, madeClipIds: readonly string[], table: FlashTable = FLASH_TABLE_V1): FlashBreach | null {
  const made = new Set(madeClipIds);
  const gap = flashGapFrames(doc.settings.frameRate.num / doc.settings.frameRate.den);
  const changes = lightChanges(doc, made, sequenceId, table), ranges = lightRanges(doc, sequenceId, table);
  const breaches: FlashBreach[] = [];
  for (const c of changes) {
    if (!made.has(c.clipId)) continue;
    if (c.frames < gap) { breaches.push({ clipId: c.clipId, frame: c.frame, since: c.frames, gapFrames: gap, why: 'short' }); continue; }
    const r = ranges.find((x) => x.clipId !== c.clipId && c.frame >= x.from - gap && c.frame < x.to + gap);
    if (r) { breaches.push({ clipId: c.clipId, frame: c.frame, since: c.frame - r.from, gapFrames: gap, why: 'light', other: r.clipId }); continue; }
    let near: LightChange | undefined;
    for (const o of changes) if (o.clipId !== c.clipId && Math.abs(o.frame - c.frame) < gap && (!near || Math.abs(o.frame - c.frame) < Math.abs(near.frame - c.frame))) near = o;
    if (near) breaches.push({ clipId: c.clipId, frame: c.frame, since: Math.abs(c.frame - near.frame), gapFrames: gap, why: 'gap', other: near.clipId });
  }
  // a strobe the take made claims its range: a change of light already in the sequence within it breaks the rule as well
  for (const r of ranges) {
    if (!made.has(r.clipId) || breaches.some((b) => b.clipId === r.clipId)) continue;
    const c = changes.find((x) => x.clipId !== r.clipId && x.frame >= r.from - gap && x.frame < r.to + gap);
    if (c) breaches.push({ clipId: r.clipId, frame: r.from, since: c.frame - r.from, gapFrames: gap, why: 'light', other: c.clipId });
  }
  breaches.sort((a, b) => a.frame - b.frame || (a.clipId < b.clipId ? -1 : 1));
  return breaches[0] ?? null;
}
