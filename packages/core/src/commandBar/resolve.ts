/**
 * Target words of the command bar (ADR-0027, plan §4.4 "Target words"), resolved on ctx.doc (the active sequence's
 * projection). Locked tracks are never targets; what was left out because it is locked is reported. Pure.
 *
 * - «הקליפ / הקליפ הזה / הנבחר»: exactly one selected clip; none → refused nothing_selected, offering the clip at the
 *   playhead; two or more → ambiguous («נבחרו 3 קליפים — לכולם?»).
 * - «הקליפים / כל הקליפים»: every selected clip, or every clip on unlocked tracks when nothing is selected.
 * - «המוזיקה»: the audio track whose trackRole is 'music'; none → refused no_music_track with the audio tracks as choices;
 *   two or more → ambiguous.
 * - «הכותרת»: the selected text clip, else the only text clip on an unlocked track; none → refused no_title (locked when the
 *   only titles are on locked tracks); two or more → ambiguous, each title a choice.
 * - The split rule (plan §4.4 row 1): the selected clip when the frame is strictly inside it, else the one clip strictly
 *   under the frame on an unlocked track; several → choices plus «כל הקליפים בסמן».
 */
import * as T from '@pulseframe/time';
import type { BarContext, BarNote, BarRefusalCode } from '../commandBarContract.ts';
import { trackRole } from '../editHelpers.ts';
import type { Clip, ProjectDocument, Track } from '../schema.ts';
import { clipEnd } from '../validate.ts';

export interface Found { clip: Clip; track: Track }
export interface Option<T> { items: T[]; he: string; en: string }
export type Resolved<T> =
  | { kind: 'ok'; items: T[]; notes: BarNote[] }
  | { kind: 'refused'; code: BarRefusalCode; options: Option<T>[]; notes: BarNote[] }
  | { kind: 'ambiguous'; options: Option<T>[]; question: { he: string; en: string }; notes: BarNote[] };

/** What a clip is called in the preview: the file's name, the title's words or the adjustment's label (owner's browser only). */
export function clipName(doc: ProjectDocument, c: Clip): string {
  const name = c.type === 'media' ? doc.assets[c.assetId]?.name : c.type === 'adjustment' ? c.label : c.type === 'text' ? c.text : undefined;
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}
export const tracksOf = (doc: ProjectDocument): Track[] => doc.sequences[doc.mainSequenceId]?.tracks ?? [];
export function findIn(doc: ProjectDocument, id: string): Found | null {
  for (const track of tracksOf(doc)) for (const clip of track.clips) if (clip.id === id) return { clip, track };
  return null;
}
const linkOf = (c: Clip) => (c.type === 'media' ? c.linkGroupId ?? null : null);
/** One per link group (a linked picture and its sound are one target; the first in track order stands for both). */
function oncePerLink(list: Found[]): Found[] {
  const seen = new Set<string>();
  return list.filter((f) => { const g = linkOf(f.clip); if (!g) return true; if (seen.has(g)) return false; seen.add(g); return true; });
}
const lockedNote = (doc: ProjectDocument, locked: Found[]): BarNote[] => (locked.length ? [{ code: 'skipped_locked', data: { clips: locked.map((f) => ({ clipId: f.clip.id, name: clipName(doc, f.clip) })) } }] : []);
export const clipOption = (doc: ProjectDocument, f: Found): Option<Found> => { const n = clipName(doc, f.clip); return { items: [f], he: n ? `הקליפ «${n}»` : 'הקליפ', en: n ? `Clip “${n}”` : 'The clip' }; };

/** Clips at `frame`: strictly inside (start < t < end) or covering (start ≤ t < end), split into unlocked and locked. */
export function clipsAt(doc: ProjectDocument, frame: number, pred: (f: Found) => boolean, strict: boolean): { open: Found[]; locked: Found[] } {
  const t = T.frameTime(frame, doc.settings.frameRate);
  const open: Found[] = [], locked: Found[] = [];
  for (const track of tracksOf(doc)) for (const clip of track.clips) {
    const inside = strict ? T.lt(clip.start, t) && T.lt(t, clipEnd(clip)) : T.lte(clip.start, t) && T.lt(t, clipEnd(clip));
    if (!inside || !pred({ clip, track })) continue;
    (track.locked ? locked : open).push({ clip, track });
  }
  return { open: oncePerLink(open), locked };
}
export function selectedClips(ctx: BarContext, pred: (f: Found) => boolean): { open: Found[]; locked: Found[] } {
  const open: Found[] = [], locked: Found[] = [];
  for (const id of ctx.selection) { const f = findIn(ctx.doc, id); if (f && pred(f)) (f.track.locked ? locked : open).push(f); }
  return { open: oncePerLink(open), locked };
}

/** The split rule (plan §4.4 row 1). */
export function resolveSplit(ctx: BarContext, frame: number): Resolved<Found> {
  const doc = ctx.doc, any = () => true;
  const sel = selectedClips(ctx, any);
  const t = T.frameTime(frame, doc.settings.frameRate);
  const selInside = sel.open.filter((f) => T.lt(f.clip.start, t) && T.lt(t, clipEnd(f.clip)));
  const under = selInside.length ? { open: selInside, locked: [] as Found[] } : clipsAt(doc, frame, any, true);
  const notes = lockedNote(doc, under.locked);
  if (under.open.length === 1) return { kind: 'ok', items: under.open, notes };
  if (!under.open.length) return { kind: 'refused', code: under.locked.length ? 'locked' : 'no_clip_here', options: [], notes };
  return {
    kind: 'ambiguous', notes,
    options: [...under.open.map((f) => clipOption(doc, f)), { items: under.open, he: 'כל הקליפים בסמן', en: 'All clips at the playhead' }],
    question: { he: `יש ${under.open.length} קליפים בסמן — איזה?`, en: `${under.open.length} clips are at the playhead — which one?` },
  };
}

/**
 * «הקליפ» (word 'one') or «הקליפים» (word 'many'); with no word, an op that takes one clip reads it as 'one' and the delete
 * as the selection. `atFrame` is where the clip offered for an empty selection is looked for (covering, not strict).
 */
export function resolveClips(ctx: BarContext, word: 'one' | 'many' | 'title' | null, pred: (f: Found) => boolean, opts: { allowMany: boolean; atFrame: number; selectionAsMany?: boolean }): Resolved<Found> {
  if (word === 'title') return resolveTitle(ctx, pred);
  const doc = ctx.doc;
  const sel = selectedClips(ctx, pred);
  const notes = lockedNote(doc, sel.locked);
  const many = word === 'many' || (word === null && !!opts.selectionAsMany);
  if (many && opts.allowMany) {
    if (sel.open.length) return { kind: 'ok', items: sel.open, notes };
    if (word === 'many' && !ctx.selection.length) {
      const all: Found[] = [], locked: Found[] = [];
      for (const track of tracksOf(doc)) for (const clip of track.clips) if (pred({ clip, track })) (track.locked ? locked : all).push({ clip, track });
      const once = oncePerLink(all);
      if (once.length) return { kind: 'ok', items: once, notes: lockedNote(doc, locked) };
    }
  } else if (sel.open.length === 1) return { kind: 'ok', items: sel.open, notes };
  if (!sel.open.length) {
    const here = clipsAt(doc, opts.atFrame, pred, false);
    return { kind: 'refused', code: sel.locked.length ? 'locked' : 'nothing_selected', options: here.open.slice(0, 8).map((f) => clipOption(doc, f)), notes };
  }
  const n = sel.open.length;
  return {
    kind: 'ambiguous', notes,
    options: [...(opts.allowMany ? [{ items: sel.open, he: `כל ${n} הקליפים`, en: `All ${n} clips` }] : []), ...sel.open.slice(0, 8).map((f) => clipOption(doc, f))],
    question: { he: `נבחרו ${n} קליפים — לכולם?`, en: `${n} clips are selected — all of them?` },
  };
}

export const isTitle = (f: Found) => f.clip.type === 'text';
/** «הכותרת» (plan §4.4): the selected text clip, or the only text clip. `pred` narrows further (the op's own kind of clip). */
export function resolveTitle(ctx: BarContext, pred: (f: Found) => boolean = () => true): Resolved<Found> {
  const doc = ctx.doc;
  const want = (f: Found) => isTitle(f) && pred(f);
  const sel = selectedClips(ctx, want);
  if (sel.open.length === 1) return { kind: 'ok', items: sel.open, notes: lockedNote(doc, sel.locked) };
  const pool = sel.open.length ? sel : (() => {
    const open: Found[] = [], locked: Found[] = [];
    for (const track of tracksOf(doc)) for (const clip of track.clips) if (want({ clip, track })) (track.locked ? locked : open).push({ clip, track });
    return { open, locked };
  })();
  const notes = lockedNote(doc, pool.locked);
  if (pool.open.length === 1) return { kind: 'ok', items: pool.open, notes };
  if (!pool.open.length) return { kind: 'refused', code: pool.locked.length ? 'locked' : 'no_title', options: [], notes };
  const n = pool.open.length;
  return {
    kind: 'ambiguous', notes,
    options: pool.open.slice(0, 8).map((f) => { const name = clipName(doc, f.clip); return { items: [f], he: name ? `הכותרת «${name}»` : 'הכותרת', en: name ? `Title “${name}”` : 'The title' }; }),
    question: sel.open.length ? { he: `נבחרו ${n} כותרות — איזו?`, en: `${n} titles are selected — which one?` } : { he: `יש ${n} כותרות — איזו?`, en: `There are ${n} titles — which one?` },
  };
}

export const trackOption = (t: Track): Option<Track> => ({ items: [t], he: `רצועה «${t.name}»`, en: `Track “${t.name}”` });
/** «המוזיקה»: the one audio track whose trackRole is 'music' (unlocked). */
export function resolveMusic(ctx: BarContext): Resolved<Track> {
  const doc = ctx.doc;
  const audio = tracksOf(doc).filter((t) => t.kind === 'audio');
  const music = audio.filter((t) => trackRole(doc, t) === 'music');
  const open = music.filter((t) => !t.locked), locked = music.filter((t) => t.locked);
  const notes: BarNote[] = locked.length ? [{ code: 'skipped_locked', data: { tracks: locked.map((t) => ({ trackId: t.id, name: t.name })) } }] : [];
  if (open.length === 1) return { kind: 'ok', items: open, notes };
  if (!open.length) return { kind: 'refused', code: locked.length ? 'locked' : 'no_music_track', options: audio.filter((t) => !t.locked).map(trackOption), notes };
  return { kind: 'ambiguous', notes, options: open.map(trackOption), question: { he: `יש ${open.length} רצועות מוזיקה — איזו?`, en: `${open.length} music tracks — which one?` } };
}

/** The sound clip of a clip: itself on an audio track, or its linked sound when it is a picture. */
export function soundClipOf(doc: ProjectDocument, f: Found): Found | null {
  if (f.track.kind === 'audio' && f.clip.type === 'media') return f;
  const g = linkOf(f.clip);
  if (!g) return null;
  for (const track of tracksOf(doc)) if (track.kind === 'audio') for (const clip of track.clips) if (linkOf(clip) === g) return { clip, track };
  return null;
}
export const isPicture = (f: Found) => (f.track.kind === 'video' && f.clip.type === 'media') || f.clip.type === 'text';
export const isVideoClip = (doc: ProjectDocument) => (f: Found) => f.track.kind === 'video' && f.clip.type === 'media' && !!doc.assets[f.clip.assetId]?.video && doc.assets[f.clip.assetId]?.kind === 'video';
export const isMedia = (f: Found) => f.clip.type === 'media';
