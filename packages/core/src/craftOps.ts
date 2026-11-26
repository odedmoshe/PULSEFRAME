/**
 * The craft ops (wave 7 craft track; craft-decisions.md §4). Registered on import of this module (index.ts exports it). The lead's
 * pre-pass fixes names, versions, argument schemas and outputs (craftContract.ts); the apply bodies are W1's (craft.test.ts).
 *
 * RULES OF THE BODIES (craft-plan.md "Corrected" C1, C3, C4)
 * - ripple_trim: by = new length − old length of the named clip. by > 0 (end edge, longer): shiftClips first, then trim_clip
 *   through the registry; by < 0: trim_clip, then shiftClips; by = 0: rippleNoChange. Start edge only later than the clip's start
 *   (rippleStartLonger); the trimmed clip is in the moving set. Closing track = the named clip's track only; linked clips follow
 *   their partner (shiftClips). Words: RIPPLE_TRIM_WORDS. Output RippleTrimOutput.
 * - paste_attributes: pasteAttributes.ts applyAttributes (its own header states the rules).
 * - replace_text: each edit's place must hold exactly `was` (replaceChanged) and be named once (replaceTwice); limits by
 *   carrierLimit (replaceTooLong); empty → replaceEmpty; a title's {…} field tokens unchanged (replaceFields). title → update_text;
 *   cue → its own body (same word count: words renamed in place; else words dropped and listed); phrase → correct_transcript;
 *   override → set_variant_override; variantPhrase → set_variant_phrase_text (a reviewed translation is listed in reviewAgain).
 *   Every edit is checked before anything is written (the order of the refusals is: twice, missing, changed, empty, too long,
 *   fields), so a refusal names the first bad edit and the draft is never half-written (the transaction is all or nothing anyway).
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, findClip, getOp, mustClip, OpError, refuseDrawnText, refuseInheritedIds, shiftClips, type OpContext, type OpResult, type ShiftEntry } from './ops.ts';
import type { ProjectDocument, Track } from './schema.ts';
import {
  carrierLimit, craftRefusal, PasteAttributesArgsSchema, ReplaceTextArgsSchema, RIPPLE_TRIM_WORDS, RippleTrimArgsSchema,
  type ReplaceTextArgs, type ReplaceTextOutput, type RippleTrimOutput, type TextCarrier,
} from './craftContract.ts';
import { applyAttributes } from './pasteAttributes.ts';
import { clipEnd } from './validate.ts';
import { parseFields, serialiseToken } from './fields.ts';

/** Run a registered public op on the draft, as apply_recipe runs its steps (its arguments parsed by its own schema). */
function runOp(d: ProjectDocument, ctx: OpContext, op: string, args: unknown): OpResult {
  const def = getOp(op)!;
  const parsed = def.args.safeParse(args);
  if (!parsed.success) throw new OpError('invalid_args', `${op}: ${z.prettifyError(parsed.error)}`, { op });
  refuseInheritedIds(parsed.data, op, '', def.checksOwnIds);
  return def.apply(d, parsed.data, ctx);
}

// ---------------------------------------------------------------- ripple_trim
/**
 * The shift of one ripple trim on the closing track: every clip whose start is at or after `edge` moves `earlier` (negative:
 * later); every other clip of the track is listed with 0 so shiftClips knows it stays. Exact: one rational per clip, no rounding.
 */
export function trimShift(track: Track, edge: T.RationalTime, earlier: T.RationalTime): Map<string, ShiftEntry> {
  const shift = new Map<string, ShiftEntry>();
  for (const clip of track.clips) shift.set(clip.id, { track, clip, by: T.lte(edge, clip.start) ? earlier : T.ZERO });
  return shift;
}
/** by = new length − old length of the named clip (start edge: start − to; end edge: to − end). */
export const rippleTrimBy = (edge: 'start' | 'end', start: T.RationalTime, end: T.RationalTime, to: T.RationalTime): T.RationalTime =>
  edge === 'start' ? T.sub(start, to) : T.sub(to, end);

defineOp({
  name: 'ripple_trim',
  version: 1,
  description: 'Trim one edge of a clip to a frame-aligned time and close up its track (ripple trim; the editor sends it for Q and W). The start edge may only move later (the head of the clip goes and everything after it moves earlier by that much); the end edge may move either way (later clips move by the change). Only the clip\'s own track closes up; a clip linked to one that moves moves with it. Titles, music, captions and markers on other tracks stay where they are. Refused, changing nothing, as trim_clip refuses, and when linked clips would move by different amounts, a linked clip would move before 0, or a moved clip would land on one that stays. trim_clip trims without closing up.',
  args: RippleTrimArgsSchema,
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    const oldStart = f.clip.start, oldEnd = clipEnd(f.clip);
    const by = rippleTrimBy(a.edge, oldStart, oldEnd, a.to);
    if (T.isZero(by)) throw craftRefusal('rippleNoChange', { clipId: f.clip.id });
    if (a.edge === 'start' && !T.isNegative(by)) throw craftRefusal('rippleStartLonger', { clipId: f.clip.id });
    const trimArgs = { clipId: a.clipId, edge: a.edge, to: a.to, ...(a.includeLinked !== undefined ? { includeLinked: a.includeLinked } : {}) };
    // the edge the track closes from: the old end (end edge), the old start (start edge: the trimmed clip moves back to it)
    const edge = a.edge === 'end' ? oldEnd : oldStart;
    // shiftClips' `by` is how much EARLIER a clip goes: −(change of length)
    const earlier = T.sub(T.ZERO, by);
    let trimmed: string[], moved: ShiftEntry[];
    if (T.isNegative(by)) {
      // shorter: trim first, then the later clips (and, for the start edge, the trimmed clip itself) move earlier
      trimmed = runOp(d, ctx, 'trim_clip', trimArgs).affectedIds;
      moved = shiftClips(d, trimShift(f.track, edge, earlier), new Set([f.track]), RIPPLE_TRIM_WORDS);
    } else {
      // longer (end edge only): the later clips move later first, so trim_clip finds the room free
      moved = shiftClips(d, trimShift(f.track, edge, earlier), new Set([f.track]), RIPPLE_TRIM_WORDS);
      trimmed = runOp(d, ctx, 'trim_clip', trimArgs).affectedIds;
    }
    const trimmedSet = new Set(trimmed);
    const movedClipIds = moved.map((m) => m.clip.id).filter((id) => !trimmedSet.has(id));
    const output: RippleTrimOutput = { trimmedClipIds: trimmed, movedClipIds, by };
    return {
      affectedIds: [...new Set([...trimmed, ...movedClipIds])],
      summary: `Ripple-trimmed the ${a.edge} of clip ${f.clip.id}${movedClipIds.length ? `; ${movedClipIds.length} clip(s) moved` : ''}`,
      output: { ...output },
    };
  },
});

// ---------------------------------------------------------------- paste_attributes
defineOp({
  name: 'paste_attributes',
  version: 1,
  description: 'Copy groups of attributes of one clip onto other clips: colour (colour effects), effects (the other effects, blend mode, mask), transform (position, scale, rotation, opacity), animation (transform keys, a title\'s letter animation), sound (gain, fades, volume keys, sound effects), titleStyle (a title\'s style). Each group REPLACES the target\'s, never merges; a group the source has nothing in changes nothing. A pair the target cannot take is left out and listed in output.skipped with the reason; the rest is applied in one step. Refused when nothing could be applied anywhere.',
  args: PasteAttributesArgsSchema,
  apply(d, a, ctx) {
    const out = applyAttributes(d, a, ctx);
    const ids = [...new Set(out.applied.map((r) => r.clipId))];
    return { affectedIds: ids, summary: `Pasted ${out.applied.length} attribute group(s) onto ${ids.length} clip(s)${out.skipped.length ? `; ${out.skipped.length} left out` : ''}`, output: { ...out } };
  },
});

// ---------------------------------------------------------------- replace_text
/** A stable key per place, for replaceTwice and the error details. */
export const carrierKey = (at: TextCarrier): string => {
  switch (at.kind) {
    case 'title': case 'cue': return `${at.kind} ${at.clipId}`;
    case 'phrase': return `phrase ${at.assetId}/${at.segmentId}`;
    case 'override': return `override ${at.variantId}/${at.clipId}`;
    case 'variantPhrase': return `variantPhrase ${at.variantId}/${at.assetId}/${at.segmentId}`;
  }
};
/** The text a place holds now, or null when there is no such place (a format wording that does not exist is not a place). */
export function carrierText(d: ProjectDocument, at: TextCarrier): string | null {
  switch (at.kind) {
    case 'title': case 'cue': {
      const f = findClip(d, at.clipId);
      return f && f.clip.type === (at.kind === 'title' ? 'text' : 'caption') ? (f.clip as { text: string }).text : null;
    }
    case 'phrase': return (Object.hasOwn(d.transcripts, at.assetId) ? d.transcripts[at.assetId]!.segments.find((s) => s.id === at.segmentId)?.text : undefined) ?? null;
    case 'override': {
      const v = Object.hasOwn(d.variants, at.variantId) ? d.variants[at.variantId] : undefined;
      return (v && Object.hasOwn(v.overrides, at.clipId) ? v.overrides[at.clipId]!.text : undefined) ?? null;
    }
    case 'variantPhrase': {
      const v = Object.hasOwn(d.variants, at.variantId) ? d.variants[at.variantId] : undefined;
      if (!v || !Object.hasOwn(d.transcripts, at.assetId) || !d.transcripts[at.assetId]!.segments.some((s) => s.id === at.segmentId)) return null;
      return (v.phraseText && Object.hasOwn(v.phraseText, at.segmentId) ? v.phraseText[at.segmentId] : undefined) ?? null;
    }
  }
}
/** The live fields of a title's text, in order, in their stored form (fields.ts): a replacement must leave this list as it is. */
export const fieldTokens = (text: string): string[] => parseFields(text).flatMap((p) => ('token' in p ? [serialiseToken(p.token)] : []));
/** Words of a caption or phrase, as correct_transcript counts them. */
export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Every check of one edit, before anything is written. */
function checkEdit(d: ProjectDocument, e: ReplaceTextArgs['edits'][number]): void {
  if (e.at.kind === 'title' || e.at.kind === 'cue' || e.at.kind === 'override') refuseDrawnText(findClip(d, e.at.clipId)?.clip); // a drawing has no words (drawn_not_text)
  const where = carrierKey(e.at);
  const now = carrierText(d, e.at);
  if (now === null) throw craftRefusal('replaceMissing', { at: e.at }, where);
  if (now !== e.was) throw craftRefusal('replaceChanged', { at: e.at });
  if (!e.text.trim()) throw craftRefusal('replaceEmpty', { at: e.at });
  const max = carrierLimit(e.at);
  if (e.text.length > max) throw craftRefusal('replaceTooLong', { at: e.at, length: e.text.length, max }, e.text.length, max);
  if (e.at.kind === 'title') {
    const f = findClip(d, e.at.clipId)!;
    if (f.clip.type === 'text' && f.clip.fields && fieldTokens(e.text).join('\u0000') !== fieldTokens(now).join('\u0000')) throw craftRefusal('replaceFields', { at: e.at });
  }
}

defineOp({
  name: 'replace_text',
  version: 1,
  description: 'Replace the whole text of named places (title, caption cue, transcript phrase, a format\'s wording) in one step, as find_text planned them. Each place must still hold `was`, else nothing is written. A caption keeps its word timing when its word count is unchanged; a phrase whose word count changes gets estimated word times; a reviewed translation that is reworded needs review again (all listed in the output).',
  args: ReplaceTextArgsSchema,
  apply(d, a, ctx) {
    const seen = new Set<string>();
    for (const e of a.edits) { const k = carrierKey(e.at); if (seen.has(k)) throw craftRefusal('replaceTwice', { at: e.at }); seen.add(k); }
    for (const e of a.edits) checkEdit(d, e);
    const out: ReplaceTextOutput = { changed: 0, lostWordTiming: [], approximated: [], reviewAgain: [] };
    const affected = new Set<string>();
    const reviewed = (variantId: string) => d.variants[variantId]?.translation?.review === 'reviewed';
    for (const e of a.edits) {
      if (e.text === e.was) continue; // the same text: nothing to write
      const at = e.at;
      let r: OpResult;
      switch (at.kind) {
        case 'title': r = runOp(d, ctx, 'update_text', { clipId: at.clipId, text: e.text }); break;
        case 'cue': {
          // its own body (C4): update_cue would always drop the word timing; same word count → the words are renamed in place
          const { clip } = mustClip(d, at.clipId);
          if (clip.type !== 'caption') throw new OpError('incompatible', `clip ${at.clipId} is not a caption cue`, { clipId: at.clipId });
          const tokens = wordsOf(e.text);
          if (clip.words?.length) {
            if (tokens.length === clip.words.length && tokens.every((t) => t.length <= 200)) clip.words = clip.words.map((w, i) => ({ ...w, text: tokens[i]! }));
            else { delete clip.words; out.lostWordTiming.push(clip.id); }
          }
          clip.text = e.text;
          r = { affectedIds: [clip.id], summary: '' };
          break;
        }
        case 'phrase': {
          const seg = d.transcripts[at.assetId]!.segments.find((s) => s.id === at.segmentId)!;
          const approx = seg.words.length > 0 && wordsOf(e.text).length !== seg.words.length;
          r = runOp(d, ctx, 'correct_transcript', { assetId: at.assetId, segmentId: at.segmentId, text: e.text });
          if (approx) out.approximated.push(at.segmentId);
          break;
        }
        case 'override': {
          const was = reviewed(at.variantId);
          r = runOp(d, ctx, 'set_variant_override', { variantId: at.variantId, clipId: at.clipId, text: e.text });
          if (was && !reviewed(at.variantId) && !out.reviewAgain.includes(at.variantId)) out.reviewAgain.push(at.variantId);
          break;
        }
        case 'variantPhrase': {
          const was = reviewed(at.variantId);
          r = runOp(d, ctx, 'set_variant_phrase_text', { variantId: at.variantId, assetId: at.assetId, segmentId: at.segmentId, text: e.text });
          if (was && !reviewed(at.variantId) && !out.reviewAgain.includes(at.variantId)) out.reviewAgain.push(at.variantId);
          break;
        }
      }
      for (const id of r.affectedIds) affected.add(id);
      out.changed++;
    }
    return { affectedIds: [...affected], summary: `Replaced the text of ${out.changed} place(s)`, output: { ...out } };
  },
});
