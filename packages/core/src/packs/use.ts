/**
 * Using a pack (ADR-0022): the operations that place a pack's title and its look, and the pack as the API lists it. Pure.
 * - A title is ONE add_text (text, place, size, text style, animation, live fields): one transaction, one undo.
 * - A look is ONE add_adjustment over the whole edit (packLookOps adds the move_track that keeps graphic elements above it): one
 *   transaction, one undo. No fade (fades stay a template feature).
 * - A caption look is ONE apply_caption_look {trackId, lookId} (an existing operation; nothing to build here).
 * - A template goes through the template routes; an element or a sound through the existing element and sound routes (the
 *   clip is one undo, the file stays in the library).
 */
import * as T from '@pulseframe/time';
import type { OpCall } from '../ops.ts';
import type { ProjectDocument, Track } from '../schema.ts';
import type { PackFieldKey, PackFieldValues } from '../templateContract.ts';
import { PACK_FIELD_KEYS } from '../templateContract.ts';
import { resolveTitleText, titleFieldUse, type ResolvedTitleText } from '../titleFields.ts';
import { PACK_SOURCE, type PackDef, type PackLook, type PackSummary, type PackTitle } from './contract.ts';

/** The words a pack title becomes for these field values (see titleFields.ts resolveTitleText). */
export const packTitleText = (title: PackTitle, lang: 'he' | 'en', fields: PackFieldValues, dated: boolean): ResolvedTitleText => resolveTitleText(title.text[lang], title.fallback[lang], fields, dated);

export interface PackTitleOptions {
  lang: 'he' | 'en';
  /** Words for the pack fields of the title; a field without one makes the title use its fallback words. */
  fields?: PackFieldValues;
  /** Frame-aligned start on the timeline. */
  start: T.RationalTime;
  /** The project's frame rate (the title's length and animation are whole frames). */
  rate: T.Rate;
  /** A picture with a capture date lies under the title for its whole length, so its live fields will have words; false = the fallback words are used for a title with live fields. */
  dated: boolean;
  /** none = no animation (reduced motion). */
  motion?: 'full' | 'none';
  trackId?: string; sequenceId?: string;
}
/**
 * The ONE operation that places a pack title: add_text with the title's words, place, size, text style, animation and, when
 * its words hold live fields and a dated picture lies under it, live fields on. `words` says which words were used and why.
 */
export function packTitleOp(title: PackTitle, o: PackTitleOptions): { op: OpCall; words: ResolvedTitleText } {
  const words = packTitleText(title, o.lang, o.fields ?? {}, o.dated);
  const fps = o.rate.num / o.rate.den;
  const frames = Math.max(1, Math.round(title.seconds * fps));
  let animation: Record<string, unknown> | undefined;
  if (title.anim && o.motion !== 'none') {
    // frames from seconds, held inside the title, as the template planner does
    const inF = title.anim.in ? Math.min(600, Math.max(1, Math.round(title.anim.inSeconds * fps)), frames) : 0;
    const outF = title.anim.out ? Math.min(600, Math.max(1, Math.round(title.anim.outSeconds * fps)), frames - inF) : 0;
    const inOn = !!title.anim.in && inF >= 1, outOn = !!title.anim.out && outF >= 1;
    if (inOn || outOn || title.anim.loop) animation = { by: title.anim.by, in: inOn ? title.anim.in : null, out: outOn ? title.anim.out : null, loop: title.anim.loop, inFrames: Math.max(1, inF), outFrames: Math.max(1, outF) };
  }
  const args = {
    text: words.text, start: o.start, duration: T.frameTime(frames, o.rate), transform: { x: title.place.x, y: title.place.y },
    ...(title.place.sizeFrac !== undefined ? { style: { sizeFrac: title.place.sizeFrac } } : {}),
    presetId: title.presetId,
    ...(animation ? { animation } : {}),
    ...(words.fields ? { fields: true as const } : {}),
    ...(o.trackId !== undefined ? { trackId: o.trackId } : {}), ...(o.sequenceId !== undefined ? { sequenceId: o.sequenceId } : {}),
  };
  return { op: { op: 'add_text', args }, words };
}
/** The add_adjustment that applies a pack look: an adjustment clip over the whole edit, labelled with the look's name. */
export function packLookOp(look: PackLook, lang: 'he' | 'en', sequenceId?: string): OpCall {
  return { op: 'add_adjustment', args: { span: 'edit', effects: look.effects.map((e) => ({ type: e.type, ...(e.params ? { params: e.params } : {}) })), label: look.name[lang].slice(0, 80), ...(sequenceId !== undefined ? { sequenceId } : {}) } };
}
/** A picture track that holds only graphic elements (pictures made from ELEMENTS: provenance.procedural.id `element.…`). */
const graphicsOnly = (doc: ProjectDocument, t: Track) => t.kind === 'video' && t.clips.length > 0 && t.clips.every((c) => c.type === 'media' && (doc.assets[c.assetId]?.provenance.procedural?.id ?? '').startsWith('element.'));
/**
 * The operations of ONE transaction (one undo) that apply a pack look so that it colours the footage and never the graphics
 * (ADR-0022): packLookOp, then a move_track for each track of graphic elements that would lie under the look, putting it right
 * above the topmost adjustment track (titles stay above). A track that also holds pictures is left where it is: the look colours
 * it, as it colours every picture. The new look's track is found as add_adjustment finds it (ops.ts placeTrack: the first unlocked
 * adjustment track free over the whole edit, else a new one below the first title, caption or sound track).
 */
export function packLookOps(look: PackLook, lang: 'he' | 'en', doc: ProjectDocument, sequenceId?: string): OpCall[] {
  const first = packLookOp(look, lang, sequenceId);
  const seq = doc.sequences[sequenceId ?? doc.mainSequenceId];
  if (!seq) return [first];
  let end: T.RationalTime = T.ZERO;
  for (const t of seq.tracks) if (t.kind === 'video' || t.kind === 'text') for (const c of t.clips) end = T.max(end, T.add(c.start, c.duration));
  type Sim = { id: string | null; kind: Track['kind']; graphics: boolean };
  const list: Sim[] = seq.tracks.map((t) => ({ id: t.id, kind: t.kind, graphics: graphicsOnly(doc, t) }));
  const free = seq.tracks.find((t) => t.kind === 'adjustment' && !t.locked && !t.clips.some((c) => T.lt(c.start, end) && T.lt(T.ZERO, T.add(c.start, c.duration))));
  if (!free) { const i = list.findIndex((t) => t.kind === 'text' || t.kind === 'caption' || t.kind === 'audio'); list.splice(i < 0 ? list.length : i, 0, { id: null, kind: 'adjustment', graphics: false }); }
  const ops: OpCall[] = [first];
  for (;;) {
    let top = -1;
    list.forEach((t, i) => { if (t.kind === 'adjustment') top = i; });
    const from = list.findIndex((t, i) => t.graphics && i < top);
    if (from < 0) break;
    const [moved] = list.splice(from, 1);
    list.splice(top, 0, moved!); // after the removal the topmost look is at top - 1: the graphics go right above it
    ops.push({ op: 'move_track', args: { trackId: moved!.id!, toIndex: top, ...(sequenceId !== undefined ? { sequenceId } : {}) } });
  }
  return ops;
}

/** The pack as the API lists it (GET /api/v1/packs, catalog().packs). */
export function summarizePack(p: PackDef): PackSummary {
  const texts = [...p.titles.flatMap((t) => [t.text.he, t.text.en]), ...p.templates.flatMap((t) => t.texts.flatMap((x) => [x.default.he, x.default.en]))];
  const uses = texts.map((t) => titleFieldUse(t, { counter: true }));
  const asked = new Set<PackFieldKey>(uses.flatMap((u) => u.pack));
  return {
    id: p.id, version: p.version, name: p.name, hint: p.hint, palette: [...p.palette], occasion: p.occasion,
    templateIds: [...p.templates.map((t) => t.id), ...p.templateIds], elementIds: [...p.elementIds], coverElementIds: [...p.coverElementIds],
    looks: p.looks.map((l) => ({ ...l, effects: l.effects.map((e) => ({ ...e })) })), captionLookIds: p.captionLooks.map((l) => l.id), textPresetIds: p.textPresets.map((x) => x.id),
    titles: p.titles.map((t) => ({ ...t })), sfxIds: [...p.sfxIds], musicStyleIds: [...p.musicStyleIds],
    fields: PACK_FIELD_KEYS.filter((k) => asked.has(k)), liveFields: uses.some((u) => u.live), source: PACK_SOURCE,
  };
}
