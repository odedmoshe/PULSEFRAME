/**
 * Command registry (SPEC §2/§3): one definition drives keyboard shortcuts, the command palette and
 * buttons. Bindings use physical key codes (`KeyS`, `BracketLeft`) so they survive a Hebrew layout,
 * and are remappable; overrides are personal settings in localStorage, never in the project.
 */
import * as T from '@pulseframe/time';
import { effectParamLabel, type Key } from '@pulseframe/i18n';
import { adjustmentRefusal, carriedChannels, CURVES_BUILT, COLOR_LOOKS, copyKeys, curveOps, deleteKeysOps, findClip, findEffect, getOp, keyTimes, moveKeysOps, pasteKeysOps, channelKey, type ChannelRef, type Clip, type CurveHandles, type Easing, type OpCall, type ProjectDocument, type Track, clipEnd } from '@pulseframe/core';
import type { Editor, Notice } from './store.ts';
import { COMMAND_STRINGS } from './commands.strings.ts';
import { cutBefore } from './inspector.model.ts';
import { cutToBeat, rollCut } from './cutActions.ts';
import { arrangeByEvents, canArrange, freezeSelectedTitle, liveTitleId, openPeopleSheet, readCaptureDates } from './lifeline/lifeCommands.ts';
import { sourceFromSelection } from './familyFilm.logic.ts';
import { channelName, clampDelta, remapKeySel } from './keyStrip.math.ts';
import { MULTICAM_ANGLE_COMMANDS, MULTICAM_CUT_COMMANDS, MULTICAM_KEYS } from './multicam.keys.ts';
import { angleForDigit } from './multicamSession.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';

export interface Command {
  id: string;
  label: Key;
  group: 'transport' | 'edit' | 'history' | 'keyframe' | 'view' | 'file';
  /** The words shown for it when the shared dictionary has no entry yet (the palette and the shortcuts list prefer them to `label`). */
  text?: { he: string; en: string };
  /**
   * 'cut': acts only while a cut is chosen (the cut loupe's keys) and takes its keys ahead of the other commands bound to the
   * same chord, which act whenever no cut is chosen (the dispatcher runs the first enabled command of a chord).
   */
  context?: 'cut';
  /** Default bindings, e.g. 'Space', 'Shift+ArrowRight', 'Mod+KeyZ' (Mod = Ctrl or Cmd). */
  keys: string[];
  enabled?(e: Editor): boolean;
  run(e: Editor): void | Promise<unknown>;
}

const sel = (e: Editor) => e.selected?.clip;

// ---------- adjustment layers over the whole edit (ADR-0016) ----------
type AdjustmentClip = Extract<Clip, { type: 'adjustment' }>;
/** End of the edit as add_adjustment's span 'edit' measures it: the end of the last picture or title clip of the main sequence. */
export function editEnd(doc: ProjectDocument): T.RationalTime {
  let end = T.ZERO;
  for (const t of doc.sequences[doc.mainSequenceId]?.tracks ?? []) if (t.kind === 'video' || t.kind === 'text') for (const c of t.clips) end = T.max(end, clipEnd(c));
  return end;
}
/**
 * The adjustment clip that already covers the whole edit (from 0 to at least its end) on a shown, unlocked adjustment track:
 * what "apply to the whole edit" adds to. The topmost such clip when there are several; null when there is none.
 */
export function wholeEditAdjustment(doc: ProjectDocument): { clip: AdjustmentClip; track: Track } | null {
  const end = editEnd(doc);
  if (!T.lt(T.ZERO, end)) return null;
  const tracks = doc.sequences[doc.mainSequenceId]?.tracks ?? [];
  for (const track of [...tracks].reverse()) {
    if (track.kind !== 'adjustment' || track.locked || track.hidden) continue;
    const clip = track.clips.find((c): c is AdjustmentClip => c.type === 'adjustment' && T.eq(c.start, T.ZERO) && !T.lt(clipEnd(c), end));
    if (clip) return { clip, track };
  }
  return null;
}
/** What "apply to the whole edit" adds: an effect (with optional parameters) or one of the named colour looks. */
export type WholeEditPick = { kind: 'effect'; type: string; params?: Record<string, unknown> } | { kind: 'look'; lookId: string };
/**
 * The ops of "apply to the whole edit": on the existing whole-edit adjustment, add_effect or apply_look; otherwise one
 * add_adjustment over the edit carrying the effect (a look is its color.grade parameters). One transaction either way. Null
 * when there is nothing to do: an empty edit, an effect an adjustment refuses (adjustmentRefusal), or an unknown look.
 */
export function wholeEditOps(doc: ProjectDocument, pick: WholeEditPick): OpCall[] | null {
  if (!T.lt(T.ZERO, editEnd(doc))) return null;
  const on = wholeEditAdjustment(doc);
  if (pick.kind === 'effect') {
    if (adjustmentRefusal(pick.type)) return null;
    const effect = { type: pick.type, ...(pick.params ? { params: pick.params } : {}) };
    return on ? [{ op: 'add_effect', args: { clipId: on.clip.id, ...effect } }] : [{ op: 'add_adjustment', args: { span: 'edit', effects: [effect] } }];
  }
  const look = COLOR_LOOKS.find((l) => l.id === pick.lookId);
  if (!look) return null;
  return on ? [{ op: 'apply_look', args: { clipId: on.clip.id, lookId: look.id } }] : [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grade', params: { ...look.params } }] } }];
}
/**
 * "Cover the whole edit" for an adjustment clip: trim_clip its start to 0 and its end to the end of the edit (the start
 * first, so a clip that lies after the end still has room). Null when it already covers exactly that, the edit is empty
 * or the clip is not an adjustment.
 */
export function coverEditOps(doc: ProjectDocument, clipId: string): OpCall[] | null {
  const f = findClip(doc, clipId);
  const end = editEnd(doc);
  if (!f || f.clip.type !== 'adjustment' || !T.lt(T.ZERO, end)) return null;
  const ops: OpCall[] = [];
  if (!T.eq(f.clip.start, T.ZERO)) ops.push({ op: 'trim_clip', args: { clipId, edge: 'start', to: T.ZERO } });
  if (!T.eq(clipEnd(f.clip), end)) ops.push({ op: 'trim_clip', args: { clipId, edge: 'end', to: end } });
  return ops.length ? ops : null;
}
/** The transform properties a clip's keyframes may use: an adjustment clip has opacity only (ADR-0016). */
export const keyframeProps = (c: Clip, track?: Track): readonly ('x' | 'y' | 'scale' | 'rotation' | 'opacity')[] => {
  // with the clip's track: exactly the transform channels the clip carries (keyEdits.ts carriedChannels, the rule of channelsFor)
  if (track) return carriedChannels(c, track).flatMap((ch) => ('property' in ch ? [ch.property] : []));
  return c.type === 'adjustment' ? ['opacity'] : ['x', 'y', 'scale', 'rotation', 'opacity'];
};
/** Selected clips that still exist, read when the command runs. */
const selectedClips = (e: Editor) => { const doc = e.doc; return doc ? e.getState().selection.map((id) => findClip(doc, id)?.clip).filter((c): c is Clip => !!c) : []; };
/** Slip: the selected clip stays where it is and shows source material `frames` later (or earlier). A refusal (no material that far) is shown like any other. */
const canSlip = (e: Editor) => { const c = sel(e); return !!c && c.type === 'media' && e.getState().selection.length === 1 && e.doc?.assets[c.assetId]?.kind !== 'image'; };
const slip = (frames: number) => (e: Editor) => {
  const c = sel(e);
  if (!c) return;
  const by = T.frameTime(Math.abs(frames), e.rate);
  return e.commit([{ op: 'slip_clip', args: { clipId: c.id, by: frames < 0 ? T.sub(T.ZERO, by) : by } }], 'Slip clip');
};
/** Tracks that can be removed: no clips, not locked, not the speech source of a ducking setting, not followed by a caption track. At least one track of each kind that has clips elsewhere is irrelevant: only empties go. */
const emptyTracks = (e: Editor): string[] => {
  const d = e.doc;
  if (!d) return [];
  const tracks = d.sequences[d.mainSequenceId]!.tracks;
  return tracks.filter((t) => t.clips.length === 0 && !t.locked && !tracks.some((x) => x.id !== t.id && (x.audio?.duck?.sourceTrackIds.includes(t.id) || x.caption?.linkedTrackId === t.id))).map((t) => t.id);
};
/** Where the selected clip's track would go when moved by `by` places in the list, or null when it cannot move. */
const trackMove = (e: Editor, by: number): { trackId: string; toIndex: number } | null => {
  const d = e.doc, s = e.selected;
  if (!d || !s) return null;
  const tracks = d.sequences[d.mainSequenceId]!.tracks;
  const i = tracks.findIndex((t) => t.id === s.track.id), to = i + by;
  return i < 0 || to < 0 || to >= tracks.length ? null : { trackId: s.track.id, toIndex: to };
};
/**
 * The two trims that move the cut at the START of the selected clip by `frames`: the clip before it (ending exactly where this
 * one starts, on the same track) gets longer or shorter by the same amount. Order matters: free the frames first, then take them.
 * Null when there is no such neighbour or a clip would vanish. The server refuses it if either clip lacks the source material.
 */
const rollOps = (e: Editor, frames: number): { op: string; args: unknown }[] | null => {
  const s = e.selected;
  if (!s || e.getState().selection.length !== 1) return null;
  const prev = s.track.clips.find((c) => c.id !== s.clip.id && T.eq(clipEnd(c), s.clip.start));
  if (!prev) return null;
  const cut = T.frameIndexAt(s.clip.start, e.rate) + frames;
  if (cut <= T.frameIndexAt(prev.start, e.rate) || cut >= T.frameIndexAt(clipEnd(s.clip), e.rate)) return null;
  const to = T.frameTime(cut, e.rate);
  const a = { op: 'trim_clip', args: { clipId: s.clip.id, edge: 'start', to } }, b = { op: 'trim_clip', args: { clipId: prev.id, edge: 'end', to } };
  return frames > 0 ? [a, b] : [b, a];
};
/**
 * Slide the selected clip by `frames` between the clip that ends where it starts and the clip that starts where it ends:
 * the clip keeps its length and content, the neighbour ahead of it is trimmed back and the one behind it is extended.
 * Null without both neighbours or when a neighbour would vanish. The server refuses it if the extended neighbour lacks source material.
 */
const slideOps = (e: Editor, frames: number): { op: string; args: unknown }[] | null => {
  const s = e.selected;
  if (!s || e.getState().selection.length !== 1) return null;
  const prev = s.track.clips.find((c) => c.id !== s.clip.id && T.eq(clipEnd(c), s.clip.start));
  const next = s.track.clips.find((c) => c.id !== s.clip.id && T.eq(c.start, clipEnd(s.clip)));
  if (!prev || !next) return null;
  const a = T.frameIndexAt(s.clip.start, e.rate) + frames, b = T.frameIndexAt(clipEnd(s.clip), e.rate) + frames;
  if (a <= T.frameIndexAt(prev.start, e.rate) || b >= T.frameIndexAt(clipEnd(next), e.rate)) return null;
  const trimPrev = { op: 'trim_clip', args: { clipId: prev.id, edge: 'end', to: T.frameTime(a, e.rate) } };
  const trimNext = { op: 'trim_clip', args: { clipId: next.id, edge: 'start', to: T.frameTime(b, e.rate) } };
  const move = { op: 'move_clip', args: { clipId: s.clip.id, start: T.frameTime(a, e.rate) } };
  return frames > 0 ? [trimNext, move, trimPrev] : [trimPrev, move, trimNext]; // make room first, fill the gap last
};
const nudge = (frames: number) => (e: Editor) => {
  const clips = selectedClips(e);
  if (!clips.length) return;
  if (clips.length === 1) {
    // The new start is worked out when the commit runs: a second press before the first has landed must move one more frame, not the same frame again.
    const id = clips[0]!.id;
    return e.commit(() => { const now = e.doc ? findClip(e.doc, id)?.clip : undefined; if (!now) return null; const target = T.frameIndexAt(now.start, e.rate) + frames; return target >= 0 ? [{ op: 'move_clip', args: { clipId: id, start: T.frameTime(target, e.rate) } }] : null; }, 'Nudge clip');
  }
  return e.commit([{ op: 'move_clips', args: { clipIds: clips.map((c) => c.id), delta: T.frameTime(frames, e.rate) } }], 'Nudge clips');
};
// ---------- delete, and ripple delete on the main track (UX_REDESIGN §4.7, §5) ----------
/** The op that stores the project's timeline behaviour (core integrator); ripple delete waits for it to be registered. */
export const BEHAVIOUR_OP = 'set_timeline_behaviour';
/** The project's own editing behaviour (settings.timeline): absent means off, as for every project made before it existed. */
export const timelineBehaviour = (doc: ProjectDocument): { mainMagnet?: boolean; rippleDelete?: boolean } => (doc.settings as { timeline?: { mainMagnet?: boolean; rippleDelete?: boolean } }).timeline ?? {};
/** The main picture track V1: the first video track of the main sequence (the timeline draws it as the magnetic main lane). */
export const mainTrackId = (doc: ProjectDocument): string | null => doc.sequences[doc.mainSequenceId]?.tracks.find((t) => t.kind === 'video')?.id ?? null;
/** Delete closes the gap on V1: the project turned ripple delete on, and this build knows the op that stores it. */
export const rippleDeleteOn = (doc: ProjectDocument): boolean => !!getOp(BEHAVIOUR_OP) && !!timelineBehaviour(doc).rippleDelete;
/**
 * The ops of a delete of `ids`, in one transaction. A linked partner is removed by its clip's own delete, so it is not listed
 * twice. With `ripple`, the clips of V1 that come after a deleted V1 clip move earlier by the length deleted before them
 * (move_clips, their linked sound along with them), the earliest group first so each lands where the space is already free;
 * the other tracks keep their gaps. `moved` counts the V1 clips that move. Null when nothing is selected.
 */
export function deleteOps(doc: ProjectDocument, ids: readonly string[], ripple: boolean): { ops: OpCall[]; moved: number; deleted: number; first: string } | null {
  const seen = new Set<string>();
  const clips = ids.map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f)
    .filter(({ clip: c }) => { const g = c.type === 'media' ? c.linkGroupId : null; if (!g) return true; if (seen.has(g)) return false; seen.add(g); return true; });
  if (!clips.length) return null;
  const ops: OpCall[] = clips.map(({ clip }) => ({ op: 'delete_clip', args: { clipId: clip.id } }));
  const main = mainTrackId(doc);
  const track = main ? doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === main) : undefined;
  if (!ripple || !track || track.locked) return { ops, moved: 0, deleted: clips.length, first: clips[0]!.clip.id };
  // every clip that goes from V1: the selected ones, and the V1 partners of selected clips elsewhere (a delete takes the link along)
  const gone = new Set<string>();
  for (const { clip } of clips) {
    gone.add(clip.id);
    const g = clip.type === 'media' ? clip.linkGroupId : null;
    if (g) for (const c of track.clips) if (c.type === 'media' && c.linkGroupId === g) gone.add(c.id);
  }
  const removed = track.clips.filter((c) => gone.has(c.id));
  if (!removed.length) return { ops, moved: 0, deleted: clips.length, first: clips[0]!.clip.id };
  let moved = 0;
  for (const c of [...track.clips].sort((a, b) => T.cmp(a.start, b.start))) {
    if (gone.has(c.id)) continue;
    if (removed.some((r) => !T.lt(c.start, clipEnd(r)))) moved++;
  }
  // One core op closes the gap (ADR: ripple_delete_clips — exact undo, linked sound moves with its picture, a J-cut that would
  // land before 0 is refused with its own wording). It names the V1 clips; selected clips elsewhere keep their gap (delete_clip).
  const mainIds = removed.map((c) => c.id);
  const elsewhere = clips.filter(({ clip }) => !gone.has(clip.id) && !(clip.type === 'media' && clip.linkGroupId && removed.some((r) => r.type === 'media' && r.linkGroupId === clip.linkGroupId)));
  const rippled: OpCall[] = [...elsewhere.map(({ clip }) => ({ op: 'delete_clip', args: { clipId: clip.id } })), { op: 'ripple_delete_clips', args: { clipIds: mainIds } }];
  return { ops: rippled, moved, deleted: clips.length, first: clips[0]!.clip.id };
}
/**
 * Delete the selection in one transaction (one undo), with an undo toast. `keepGap` (Shift+Delete) never ripples; Delete
 * ripples on V1 when the project has ripple delete on (and this build has the op that stores it). Worked out when the write's
 * turn comes, from the document as it is then.
 */
const deleteSelected = (keepGap: boolean) => async (e: Editor) => {
  const ids = [...e.getState().selection];
  let said: { moved: number; deleted: number; ripple: boolean; name: string | null } | null = null;
  const r = await e.commit(() => {
    const doc = e.doc;
    if (!doc) return null;
    const ripple = !keepGap && rippleDeleteOn(doc);
    const plan = deleteOps(doc, ids, ripple);
    said = plan ? { moved: plan.moved, deleted: plan.deleted, ripple: ripple && plan.ops.length > plan.deleted, name: plan.deleted === 1 ? deletedName(doc, plan.first) : null } : null;
    return plan?.ops ?? null;
  }, keepGap ? 'Delete, keep the gap' : 'Delete');
  const s = said as { moved: number; deleted: number; ripple: boolean; name: string | null } | null;
  if (r && s) e.notify(deleteNotice(e.getState().lang, s, r.transactionId ?? null));
  return r;
};
/** What a deleted clip is called in its toast: the file's name, the title's words or the adjustment's label; null when it has none. */
function deletedName(doc: ProjectDocument, clipId: string): string | null {
  const c = findClip(doc, clipId)?.clip;
  if (!c) return null;
  const name = c.type === 'media' ? doc.assets[c.assetId]?.name : c.type === 'adjustment' ? c.label : c.type === 'text' ? c.text : undefined;
  const one = name?.replace(/\s+/g, ' ').trim();
  return one ? (one.length > 40 ? `${one.slice(0, 39)}…` : one) : null;
}
/**
 * The undo toast of a delete: it names the clip (or the count) and the transaction it reports, so its button undoes exactly
 * that delete. A commit that made no transaction gets no undo button (an info toast), never one that would undo another edit.
 */
export function deleteNotice(lang: 'he' | 'en', s: { moved: number; deleted: number; ripple: boolean; name: string | null }, transactionId: string | null): Notice {
  const S = COMMAND_STRINGS[lang];
  return { kind: transactionId ? 'undo' : 'info', title: S.deleted(s.deleted, s.name), ...(s.ripple ? { body: S.rippled(s.moved) } : {}), ...(transactionId ? { undoes: transactionId } : {}) };
}
/** Roll the chosen cut by `frames` (the cut loupe's keys; the same two trims as the inspector's roll buttons, cutActions.ts). */
const cutChosen = (e: Editor) => { const id = e.getState().cutClipId, d = e.doc; return !!id && !!d && !!cutBefore(d, id); };
const rollChosen = (frames: number) => (e: Editor) => { const id = e.getState().cutClipId; return id ? rollCut(e, id, frames) : undefined; };
const step = (frames: number) => (e: Editor) => e.seek(e.frame + frames);
/** Add keyframes for position, scale, rotation and opacity at the playhead with the values currently shown. */
const addKeyframe = (e: Editor) => {
  const c = sel(e);
  if (!c) return;
  // the master clip's own values (keyframes live on the master, so a viewed format's override never enters them); for a clip
  // that follows a motion track (ADR-0015) these are its offset from the tracked point
  const now = e.transformNow(c);
  const time = T.sub(e.playhead, c.start);
  return e.commit(keyframeProps(c, e.selected?.track).map((property) => ({ op: 'set_keyframe', args: { clipId: c.id, property, time, value: now[property] } })), 'Add keyframe');
};
const removeKeyframe = (e: Editor) => {
  const c = sel(e);
  if (!c?.keyframes) return;
  const time = T.sub(e.playhead, c.start);
  const ops = keyframeProps(c).filter((p) => c.keyframes?.[p]?.some((k) => T.eq(k.time, time))).map((property) => ({ op: 'delete_keyframe', args: { clipId: c.id, property, time } }));
  return ops.length ? e.commit(ops, 'Remove keyframe') : undefined;
};
/** Jump to the previous/next keyframe of the selected clip. */
const hasAnyKey = (c: Clip | undefined) => !!c && c.type !== 'caption' && (!!c.keyframes || (c.effects ?? []).some((x) => Object.keys(x.keyframes ?? {}).length > 0));
const gotoKeyframe = (dir: 1 | -1) => (e: Editor) => {
  const c = sel(e);
  if (!c || !hasAnyKey(c)) return;
  const tr = e.selected?.track;
  // transform and effect keys alike (keyEdits.ts keyTimes)
  const frames = tr ? keyTimes(c, tr, e.rate).map((k) => T.frameIndexAt(c.start, e.rate) + k.frame) : [...new Set(Object.values(c.keyframes ?? {}).flatMap((ks) => (ks ?? []).map((k) => T.frameIndexAt(T.add(c.start, k.time), e.rate))))].sort((a, b) => a - b);
  const next = dir > 0 ? frames.find((f) => f > e.frame) : [...frames].reverse().find((f) => f < e.frame);
  if (next !== undefined) e.seek(next);
};
// ---------- selected keys: curve, delete, nudge, copy, paste (ADR-0019; the keyframe strip, the picker and the commands share them) ----------
/** The key selection counts only while its clip is the one selected clip: keys never outlive the clip selection as a hidden edit target. */
const keysOnSelection = (e: Editor) => { const ks = e.getState().keySel, s = e.getState().selection; return !!ks && s.length === 1 && s[0] === ks.clipId; };
/** The clip the key selection belongs to, with its track, read from the live document; null when it is gone or the track is locked or a format is viewed. */
export const keyTarget = (e: Editor): { clip: Clip; track: Track; sel: NonNullable<ReturnType<Editor['getState']>['keySel']> } | null => {
  const ks = e.getState().keySel, doc = e.doc;
  if (!ks || !doc || e.getState().viewVariantId || !keysOnSelection(e)) return null;
  const f = findClip(doc, ks.clipId);
  return f && !f.track.locked ? { clip: f.clip, track: f.track, sel: ks } : null;
};
/** Set one curve on the selected keys (the segment after each key, or `side`): one transaction. S and L (smooth, straight) pass 'both': a key is smoothed or straightened on both of its sides, as on a path vertex (keyframes-plan §5, P3). */
export const curveSelected = (e: Editor, easing: Easing, bezier?: CurveHandles, side: 'after' | 'before' | 'both' = 'after') =>
  e.commit(() => { const t = keyTarget(e); return t ? curveOps(t.clip, e.rate, t.sel.keys, side, easing, bezier) : null; }, 'Keyframe curve');
export const deleteSelectedKeys = (e: Editor) => e.commit(() => { const t = keyTarget(e); return t ? deleteKeysOps(t.clip, e.rate, t.sel.keys) : null; }, 'Remove keyframes');
/** Move the selected keys by whole frames (a keyboard nudge, or the strip's release); the selection follows the keys. A refusal is said, not silent. */
export const nudgeSelectedKeys = (e: Editor, frames: number) => e.commit(() => {
  const t = keyTarget(e);
  if (!t) return null;
  const r = moveKeysOps(t.clip, t.track, e.rate, t.sel.keys, frames);
  if ('refused' in r) { e.notify({ kind: 'info', title: e.t('keys.crosses') }); return null; }
  if (!r.ops.length) return null;
  const count = T.frameIndexAt(t.clip.duration, e.rate);
  e.setKeySel(remapKeySel(t.sel, clampDelta(frames, t.sel.keys.map((k) => k.frame), count), count));
  return r.ops;
}, 'Move keyframes');
export const copySelectedKeys = (e: Editor) => {
  const ks = e.getState().keySel, doc = e.doc;
  const clip = ks && doc && keysOnSelection(e) ? findClip(doc, ks.clipId)?.clip : undefined;
  if (!ks || !clip) return;
  const cb = copyKeys(clip, e.rate, ks.keys);
  if (!cb.entries.length) return;
  e.setKeyClipboard(cb);
  e.notify({ kind: 'info', title: e.t('keys.copied') });
};
/** A skipped channel named for a person: the clipboard knows the effect type, the target clip may not have the effect. */
const skippedName = (cb: NonNullable<ReturnType<Editor['getState']>['keyClipboard']>, ch: ChannelRef, t: (k: Key) => string, lang: 'he' | 'en'): string => {
  if ('property' in ch) return channelName({} as Clip, ch, t, lang);
  const type = cb.entries.find((x) => channelKey(x.channel) === channelKey(ch))?.effectType;
  const def = type ? findEffect(type) : undefined;
  return `${def ? def.name[lang] : ch.effectId} · ${effectParamLabel(ch.param, lang, type)}`;
};
/** Paste the copied keys at the playhead of the selected clip. Channels the clip cannot take are skipped and named in a notice. */
export const pasteKeys = (e: Editor) => {
  const cb = e.getState().keyClipboard, s = e.selected;
  if (!cb || !s) return;
  const id = s.clip.id;
  let skipped: ChannelRef[] = [];
  const r = e.commit(() => {
    const f = e.doc ? findClip(e.doc, id) : undefined;
    if (!f || f.track.locked) return null;
    const at = Math.max(0, T.frameIndexAt(e.playhead, e.rate) - T.frameIndexAt(f.clip.start, e.rate));
    const out = pasteKeysOps(f.clip, f.track, e.rate, cb, at);
    skipped = out.skipped;
    return out.ops;
  }, 'Paste keyframes');
  return r.then((res) => { if (skipped.length) e.notify({ kind: 'info', title: `${e.t('keys.pasteSkipped')} ${skipped.map((ch) => skippedName(cb, ch, e.t, e.getState().lang)).join(', ')}` }); return res; });
};
const canEditKeys = (e: Editor) => keyTarget(e) !== null && keyTarget(e)!.sel.keys.length > 0;

/** User markers of the main sequence as frame numbers, ascending. */
export const markerFrames = (e: Editor) => {
  const doc = e.doc;
  if (!doc) return [];
  return Object.values(doc.markers ?? {}).filter((m) => m.sequenceId === doc.mainSequenceId).map((m) => T.frameIndexAt(m.time, e.rate)).sort((a, b) => a - b);
};
const gotoMarker = (dir: 1 | -1) => (e: Editor) => {
  const frames = markerFrames(e);
  const next = dir > 0 ? frames.find((f) => f > e.frame) : [...frames].reverse().find((f) => f < e.frame);
  if (next !== undefined) e.seek(next);
};
const selectAdjacent = (dir: 1 | -1) => (e: Editor) => {
  const doc = e.doc;
  if (!doc) return;
  const all = [...doc.sequences[doc.mainSequenceId]!.tracks].reverse().flatMap((t) => t.clips.map((c) => c.id));
  if (!all.length) return;
  const i = all.indexOf(e.getState().selection[0] ?? '');
  e.select(all[(i + dir + all.length) % all.length]!);
};


// ---------- multicam (ADR-0020): digits switch angles on the program the video target track holds ----------
/** The angle a multicam digit names in the group of the program, or null (no program on the video target track, or no such angle). */
export function multicamAngleFor(e: Editor, digit: number): { groupId: string; angleId: string } | null {
  const prog = e.multicamProgram(), d = e.doc;
  const g = prog && d ? d.multicam?.[prog.groupId] : undefined;
  const a = g ? angleForDigit(g, digit) : null;
  return prog && a ? { groupId: prog.groupId, angleId: a.id } : null;
}
const mcText = (f: (S: (typeof MULTICAM_STRINGS)['he']) => string) => ({ he: f(MULTICAM_STRINGS.he), en: f(MULTICAM_STRINGS.en) });
/** The multicam commands, with exactly the ids and keys of multicam.keys.ts. */
export const MULTICAM_COMMANDS: Command[] = [
  ...MULTICAM_ANGLE_COMMANDS.map((id, i): Command => ({ id, label: 'multicam.title', text: mcText((S) => S.angleCmd(i + 1)), group: 'edit', keys: [...(MULTICAM_KEYS[id] ?? [])], enabled: (e) => !!multicamAngleFor(e, i + 1), run: (e) => { const a = multicamAngleFor(e, i + 1); if (a) return e.switchAngle(a.angleId); } })),
  { id: 'multicam.wide', label: 'multicam.wide', text: mcText((S) => S.wideCmd), group: 'edit', keys: [...(MULTICAM_KEYS['multicam.wide'] ?? [])], enabled: (e) => !!multicamAngleFor(e, 0), run: (e) => { const a = multicamAngleFor(e, 0); if (a) return e.switchAngle(a.angleId); } },
  ...MULTICAM_CUT_COMMANDS.map((id, i): Command => ({ id, label: 'multicam.title', text: mcText((S) => S.cutAt(i + 1)), group: 'edit', keys: [], enabled: (e) => !e.recordingSwitches && !!multicamAngleFor(e, i + 1), run: (e) => { const a = multicamAngleFor(e, i + 1); if (a) return e.switchAngle(a.angleId, true); } })),
  { id: 'multicam.cutWide', label: 'multicam.wide', text: mcText((S) => S.cutAt(0)), group: 'edit', keys: [], enabled: (e) => !e.recordingSwitches && !!multicamAngleFor(e, 0), run: (e) => { const a = multicamAngleFor(e, 0); if (a) return e.switchAngle(a.angleId, true); } },
  { id: 'multicam.record', label: 'multicam.record', group: 'edit', keys: [], enabled: (e) => e.recordingSwitches || !!e.multicamProgram(), run: (e) => (e.recordingSwitches ? e.stopRecording() : e.startRecording()) },
  { id: 'multicam.discard', label: 'multicam.recordStop', text: mcText((S) => S.discardCmd), group: 'edit', keys: [...(MULTICAM_KEYS['multicam.discard'] ?? [])], enabled: (e) => e.recordingSwitches, run: (e) => e.discardRecording() },
];

export const COMMANDS: Command[] = [
  { id: 'transport.toggle', label: 'cmd.playPause', group: 'transport', keys: ['Space'], run: (e) => (e.player?.playing ? e.player.pause() : e.player?.play()) },
  // Shuttle: L forwards (play, then 2×, 4×, 8×), J backwards (1×, 2×, 4×, 8×). Faster than 1× and backwards are silent. Space stops.
  { id: 'transport.shuttleForward', label: 'cmd.shuttleForward', group: 'transport', keys: ['KeyL'], enabled: (e) => (e.player?.frameCount ?? 0) > 0, run: (e) => { const p = e.player; if (!p) return; const r = p.playing ? (p.shuttleRate || 1) : 0; p.shuttle(r > 0 ? Math.min(8, r * 2) : 1); } },
  { id: 'transport.shuttleBack', label: 'cmd.shuttleBack', group: 'transport', keys: ['KeyJ'], enabled: (e) => (e.player?.frameCount ?? 0) > 0, run: (e) => { const p = e.player; if (!p) return; const r = p.playing ? (p.shuttleRate || 1) : 0; p.shuttle(r < 0 ? Math.max(-8, r * 2) : -1); } },
  { id: 'transport.loop', label: 'cmd.loop', group: 'transport', keys: ['Shift+KeyL'], run: (e) => e.toggleLoop() },
  { id: 'transport.prevFrame', label: 'frame.prev', group: 'transport', keys: ['ArrowLeft'], run: step(-1) },
  { id: 'transport.nextFrame', label: 'frame.next', group: 'transport', keys: ['ArrowRight'], run: step(1) },
  { id: 'transport.back10', label: 'cmd.back10', group: 'transport', keys: ['Shift+ArrowLeft'], run: step(-10) },
  { id: 'transport.forward10', label: 'cmd.forward10', group: 'transport', keys: ['Shift+ArrowRight'], run: step(10) },
  { id: 'transport.start', label: 'cmd.goStart', group: 'transport', keys: ['Home'], run: (e) => e.seek(0) },
  { id: 'transport.end', label: 'cmd.goEnd', group: 'transport', keys: ['End'], run: (e) => e.seek((e.player?.frameCount ?? 1) - 1) },
  { id: 'marker.add', label: 'marker.add', group: 'edit', keys: ['KeyM'], enabled: (e) => !!e.doc && !markerFrames(e).includes(e.frame), run: (e) => e.commit([{ op: 'add_marker', args: { time: e.playhead } }], 'Add marker') },
  { id: 'marker.next', label: 'marker.next', group: 'transport', keys: ['Shift+KeyM'], enabled: (e) => markerFrames(e).some((f) => f > e.frame), run: gotoMarker(1) },
  { id: 'marker.prev', label: 'marker.prev', group: 'transport', keys: ['Alt+KeyM'], enabled: (e) => markerFrames(e).some((f) => f < e.frame), run: gotoMarker(-1) },
  { id: 'edit.split', label: 'split', group: 'edit', keys: ['KeyS'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'split_clip', args: { clipId: sel(e)!.id, at: e.playhead } }], 'Split') },
  { id: 'edit.delete', label: 'delete', group: 'edit', keys: ['Delete', 'Backspace'], enabled: (e) => !!sel(e), run: deleteSelected(false) },
  { id: 'edit.deleteKeepGap', label: 'delete', text: { he: COMMAND_STRINGS.he.deleteKeepGap, en: COMMAND_STRINGS.en.deleteKeepGap }, group: 'edit', keys: ['Shift+Delete', 'Shift+Backspace'], enabled: (e) => !!sel(e), run: deleteSelected(true) },
  { id: 'edit.cut', label: 'cmd.cut', group: 'edit', keys: ['Mod+KeyX'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.cutSelection() },
  { id: 'edit.copy', label: 'cmd.copy', group: 'edit', keys: ['Mod+KeyC'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.copySelection() },
  { id: 'edit.paste', label: 'cmd.paste', group: 'edit', keys: ['Mod+KeyV'], enabled: (e) => e.clipboardLive.length > 0, run: (e) => e.pasteClipboard() },
  { id: 'edit.duplicate', label: 'cmd.duplicate', group: 'edit', keys: ['Mod+KeyD'], enabled: (e) => e.getState().selection.length > 0, run: (e) => e.duplicateSelection() },
  { id: 'edit.trimStart', label: 'trim.start', group: 'edit', keys: ['BracketLeft'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'trim_clip', args: { clipId: sel(e)!.id, edge: 'start', to: e.playhead } }], 'Trim') },
  { id: 'edit.trimEnd', label: 'trim.end', group: 'edit', keys: ['BracketRight'], enabled: (e) => e.playheadInsideSelection, run: (e) => e.commit([{ op: 'trim_clip', args: { clipId: sel(e)!.id, edge: 'end', to: e.playhead } }], 'Trim') },
  { id: 'edit.nudgeLeft', label: 'cmd.nudgeLeft', group: 'edit', keys: ['Alt+ArrowLeft'], enabled: (e) => !!sel(e), run: nudge(-1) },
  { id: 'edit.nudgeRight', label: 'cmd.nudgeRight', group: 'edit', keys: ['Alt+ArrowRight'], enabled: (e) => !!sel(e), run: nudge(1) },
  { id: 'edit.nudgeLeft10', label: 'cmd.nudgeLeft10', group: 'edit', keys: ['Alt+Shift+ArrowLeft'], enabled: (e) => !!sel(e), run: nudge(-10) },
  { id: 'edit.nudgeRight10', label: 'cmd.nudgeRight10', group: 'edit', keys: ['Alt+Shift+ArrowRight'], enabled: (e) => !!sel(e), run: nudge(10) },
  // Roll: move the cut between the selected clip and the clip before it, without moving anything else (one transaction of two trims).
  { id: 'edit.rollLater', label: 'cmd.rollLater', group: 'edit', keys: ['Mod+BracketRight'], enabled: (e) => !!rollOps(e, 1), run: (e) => e.commit(() => rollOps(e, 1), 'Roll cut') }, // computed when the commit runs, so repeated presses each move one more frame
  { id: 'edit.rollEarlier', label: 'cmd.rollEarlier', group: 'edit', keys: ['Mod+BracketLeft'], enabled: (e) => !!rollOps(e, -1), run: (e) => e.commit(() => rollOps(e, -1), 'Roll cut') }, // computed when the commit runs, so repeated presses each move one more frame
  // Slide: move the selected clip between its two neighbours; the one it moves towards gets shorter, the one it leaves gets longer (three steps, one transaction).
  { id: 'edit.slideLater', label: 'cmd.slideLater', group: 'edit', keys: ['Mod+Shift+BracketRight'], enabled: (e) => !!slideOps(e, 1), run: (e) => e.commit(() => slideOps(e, 1), 'Slide clip') },
  { id: 'edit.slideEarlier', label: 'cmd.slideEarlier', group: 'edit', keys: ['Mod+Shift+BracketLeft'], enabled: (e) => !!slideOps(e, -1), run: (e) => e.commit(() => slideOps(e, -1), 'Slide clip') },
  { id: 'edit.slipLater', label: 'cmd.slipLater', group: 'edit', keys: ['Mod+Alt+ArrowRight'], enabled: canSlip, run: slip(1) },
  { id: 'edit.slipEarlier', label: 'cmd.slipEarlier', group: 'edit', keys: ['Mod+Alt+ArrowLeft'], enabled: canSlip, run: slip(-1) },
  { id: 'edit.slipLater10', label: 'cmd.slipLater10', group: 'edit', keys: ['Mod+Alt+Shift+ArrowRight'], enabled: canSlip, run: slip(10) },
  { id: 'edit.slipEarlier10', label: 'cmd.slipEarlier10', group: 'edit', keys: ['Mod+Alt+Shift+ArrowLeft'], enabled: canSlip, run: slip(-10) },
  // The timeline lists tracks top-down in reverse list order (the last track is drawn on top and shown first), so "up" on screen is a higher index.
  { id: 'track.moveUp', label: 'cmd.trackUp', group: 'edit', keys: [], enabled: (e) => trackMove(e, 1) !== null, run: (e) => e.commit(() => { const m = trackMove(e, 1); return m ? [{ op: 'move_track', args: m }] : null; }, 'Move track') },
  { id: 'track.moveDown', label: 'cmd.trackDown', group: 'edit', keys: [], enabled: (e) => trackMove(e, -1) !== null, run: (e) => e.commit(() => { const m = trackMove(e, -1); return m ? [{ op: 'move_track', args: m }] : null; }, 'Move track') },
  { id: 'edit.link', label: 'cmd.linkClips', group: 'edit', keys: [], enabled: (e) => e.getState().selection.length >= 2, run: (e) => e.commit([{ op: 'link_clips', args: { clipIds: e.getState().selection } }], 'Link clips') },
  { id: 'track.removeEmpty', label: 'cmd.removeEmptyTracks', group: 'edit', keys: [], enabled: (e) => emptyTracks(e).length > 0, run: (e) => e.commit(emptyTracks(e).map((id) => ({ op: 'remove_track', args: { trackId: id } })), 'Remove empty tracks') },
  { id: 'edit.closeGaps', label: 'cmd.closeGaps', group: 'edit', keys: [], enabled: (e) => !!e.doc, run: (e) => e.commit([{ op: 'close_gaps', args: {} }], 'Close gaps') },
  { id: 'edit.selectAll', label: 'cmd.selectAll', group: 'edit', keys: ['Mod+KeyA'], enabled: (e) => !!e.doc, run: (e) => e.selectAll() },
  { id: 'edit.selectNext', label: 'cmd.selectNext', group: 'edit', keys: ['Alt+ArrowDown'], run: selectAdjacent(1) },
  { id: 'edit.selectPrev', label: 'cmd.selectPrev', group: 'edit', keys: ['Alt+ArrowUp'], run: selectAdjacent(-1) },
  { id: 'edit.deselect', label: 'cmd.deselect', group: 'edit', keys: ['Escape'], enabled: (e) => !e.recordingSwitches && (!!sel(e) || e.getState().cutPending.length > 0) && !e.getState().paletteOpen, run: (e) => { e.clearCut(); e.select(null); } },
  { id: 'edit.addText', label: 'text.add', group: 'edit', keys: ['KeyT'], run: (e) => e.addText() },
  // An adjustment layer over the whole edit (ADR-0016): empty until an effect is added to it in the Look panel (it is selected).
  { id: 'edit.addAdjustment', label: 'cmd.addAdjustment', group: 'edit', keys: [], enabled: (e) => !!e.doc && T.lt(T.ZERO, editEnd(e.doc)), run: (e) => e.addWholeEditAdjustment() },
  { id: 'view.openTemplates', label: 'cmd.openTemplates', group: 'view', keys: [], enabled: (e) => !!e.doc, run: (e) => e.openTemplates() },
  // the family film (ADR-0026): the dialog on the selected clips' files, else the library's pictures and videos (FamilyFilmEntry's rule)
  { id: 'view.openFamilyFilm', label: 'cmd.openFamilyFilm', group: 'view', keys: [], enabled: (e) => !!e.doc && sourceFromSelection(e.doc, e.getState().selection).assetIds.length > 0, run: (e) => { if (e.doc) e.openFilm(sourceFromSelection(e.doc, e.getState().selection)); } },
  // life line (ADR-0021): arrange the library by events, read capture dates, make the selected title plain text, the people sheet
  { id: 'life.arrangeEvents', label: 'cmd.arrangeEvents', group: 'edit', keys: [], enabled: canArrange, run: (e) => arrangeByEvents(e) },
  { id: 'life.readDates', label: 'cmd.readCaptureDates', group: 'edit', keys: [], enabled: (e) => !!e.doc, run: (e) => readCaptureDates(e) },
  { id: 'life.freezeFields', label: 'cmd.freezeFields', group: 'edit', keys: [], enabled: (e) => liveTitleId(e) !== null, run: (e) => freezeSelectedTitle(e) },
  { id: 'life.people', label: 'cmd.people', group: 'edit', keys: [], enabled: (e) => !!e.doc, run: () => openPeopleSheet() },
  // K stops playback or a shuttle (the J K L convention); when nothing is playing it adds a keyframe.
  { id: 'keyframe.add', label: 'cmd.keyframeAddOrStop', group: 'keyframe', keys: ['KeyK'], enabled: (e) => !!e.player?.playing || (!e.selectionLocked && e.playheadOnSelection), run: (e) => (e.player?.playing ? e.player.pause() : addKeyframe(e)) }, // stopping is allowed whatever is selected; adding a key is not on a locked track
  { id: 'keyframe.remove', label: 'cmd.keyframeRemove', group: 'keyframe', keys: ['Shift+KeyK'], enabled: (e) => e.playheadOnSelection && !!sel(e)?.keyframes, run: removeKeyframe },
  // While a cut is chosen (the loupe shows it), , and . roll it a frame (Shift: five) and Shift+B moves it to the nearest beat,
  // ahead of the keyframe steps that share , and . (the dispatcher runs the first enabled command of a chord).
  { id: 'cut.rollEarlier', label: 'cmd.rollEarlier', context: 'cut', group: 'edit', keys: ['Comma'], enabled: cutChosen, run: rollChosen(-1) },
  { id: 'cut.rollLater', label: 'cmd.rollLater', context: 'cut', group: 'edit', keys: ['Period'], enabled: cutChosen, run: rollChosen(1) },
  { id: 'cut.rollEarlier5', label: 'cmd.rollEarlier', text: { he: COMMAND_STRINGS.he.cutRollEarlier5, en: COMMAND_STRINGS.en.cutRollEarlier5 }, context: 'cut', group: 'edit', keys: ['Shift+Comma'], enabled: cutChosen, run: rollChosen(-5) },
  { id: 'cut.rollLater5', label: 'cmd.rollLater', text: { he: COMMAND_STRINGS.he.cutRollLater5, en: COMMAND_STRINGS.en.cutRollLater5 }, context: 'cut', group: 'edit', keys: ['Shift+Period'], enabled: cutChosen, run: rollChosen(5) },
  { id: 'cut.toBeat', label: 'cmd.rollLater', text: { he: COMMAND_STRINGS.he.cutToBeat, en: COMMAND_STRINGS.en.cutToBeat }, context: 'cut', group: 'edit', keys: ['Shift+KeyB'], enabled: (e) => cutChosen(e) && !!cutToBeat(e, e.getState().cutClipId!), run: (e) => { const id = e.getState().cutClipId; const f = id ? cutToBeat(e, id) : null; return id && f ? rollCut(e, id, f) : undefined; } },
  { id: 'keyframe.prev', label: 'cmd.keyframePrev', group: 'keyframe', keys: ['Comma'], enabled: (e) => hasAnyKey(sel(e)), run: gotoKeyframe(-1) },
  { id: 'keyframe.next', label: 'cmd.keyframeNext', group: 'keyframe', keys: ['Period'], enabled: (e) => hasAnyKey(sel(e)), run: gotoKeyframe(1) },
  // keyframe curves and strip (ADR-0019). Only focus has a default chord; the rest are remappable and in the palette.
  { id: 'keyframe.focus', label: 'cmd.keyframeFocus', group: 'keyframe', keys: ['Alt+KeyK'], enabled: (e) => hasAnyKey(sel(e)), run: () => document.querySelector<HTMLElement>('[data-testid=key-strip-key]')?.focus() },
  { id: 'keyframe.smooth', label: 'cmd.keyframeSmooth', group: 'keyframe', keys: [], enabled: (e) => CURVES_BUILT && canEditKeys(e), run: (e) => curveSelected(e, 'smooth', undefined, 'both') },
  { id: 'keyframe.linear', label: 'cmd.keyframeLinear', group: 'keyframe', keys: [], enabled: canEditKeys, run: (e) => curveSelected(e, 'linear', undefined, 'both') },
  { id: 'keyframe.curve', label: 'cmd.keyframeCurve', group: 'keyframe', keys: [], enabled: canEditKeys, run: (e) => { const ks = e.getState().keySel; if (keysOnSelection(e) && ks?.keys.length) e.openCurvePicker(ks.clipId, ks.keys[0]!.frame, ks.keys.filter((k) => k.frame === ks.keys[0]!.frame).map((k) => k.channel)); } },
  { id: 'keyframe.copy', label: 'cmd.keyframeCopy', group: 'keyframe', keys: [], enabled: (e) => keysOnSelection(e) && !!e.getState().keySel?.keys.length, run: copySelectedKeys },
  { id: 'keyframe.paste', label: 'cmd.keyframePaste', group: 'keyframe', keys: [], enabled: (e) => !!e.getState().keyClipboard && !e.selectionLocked && !e.getState().viewVariantId && e.playheadOnSelection, run: pasteKeys },
  { id: 'view.motionPath', label: 'cmd.motionPath', group: 'view', keys: [], run: (e) => e.setPathOn(!e.getState().pathOn) },
  { id: 'history.undo', label: 'undo', group: 'history', keys: ['Mod+KeyZ'], run: (e) => e.history('undo') },
  { id: 'history.redo', label: 'redo', group: 'history', keys: ['Mod+Shift+KeyZ', 'Mod+KeyY'], run: (e) => e.history('redo') },
  // Export always opens the export sheet (owner decision): the sheet starts the export (ExportSheet.tsx).
  // the import queue and the phone drop (ADR-0023): a folder (webkitdirectory, ImportHosts.tsx FolderPicker); the phone drop dialog (the owner's own session)
  { id: 'file.importFolder', label: 'cmd.importFolder', group: 'file', keys: [], enabled: (e) => !!e.doc, run: () => document.querySelector<HTMLInputElement>('[data-testid=folder-input]')?.click() },
  { id: 'file.phoneDrop', label: 'cmd.phoneDrop', group: 'file', keys: [], enabled: (e) => !!e.doc && e.getState().actor === 'user:local', run: (e) => e.openPhoneDrop() },
  { id: 'file.export', label: 'export', text: { he: COMMAND_STRINGS.he.exportOpen, en: COMMAND_STRINGS.en.exportOpen }, group: 'file', keys: ['Mod+KeyE'], enabled: (e) => !!e.doc && (e.player?.frameCount ?? 0) > 0, run: (e) => e.openExportSheet() },
  { id: 'view.palette', label: 'cmd.palette', group: 'view', keys: ['Mod+KeyK'], run: (e) => e.set({ paletteOpen: !e.getState().paletteOpen }) },
  { id: 'view.language', label: 'lang.label', group: 'view', keys: [], run: (e) => e.setLang(e.getState().lang === 'he' ? 'en' : 'he') },
  { id: 'view.zoomIn', label: 'cmd.zoomIn', group: 'view', keys: ['Equal'], run: (e) => e.set({ pxPerSecond: Math.min(720, e.getState().pxPerSecond * 1.5) }) },
  { id: 'view.zoomOut', label: 'cmd.zoomOut', group: 'view', keys: ['Minus'], run: (e) => e.set({ pxPerSecond: Math.max(10, e.getState().pxPerSecond / 1.5) }) },
  ...MULTICAM_COMMANDS,
];

/** Canonical chord for an event: modifiers in fixed order + physical key code. */
export function chordOf(ev: { code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string {
  return `${ev.ctrlKey || ev.metaKey ? 'Mod+' : ''}${ev.altKey ? 'Alt+' : ''}${ev.shiftKey ? 'Shift+' : ''}${ev.code}`;
}
const STORAGE = 'pf.keymap.v1';
export class Keymap {
  private overrides: Record<string, string[]>;
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage) {
    let o: unknown = null;
    try { o = JSON.parse(this.storage?.getItem(STORAGE) ?? 'null'); } catch { /* corrupt setting: fall back to defaults */ }
    this.overrides = o && typeof o === 'object' ? (o as Record<string, string[]>) : {};
  }
  keysFor(id: string): string[] { return this.overrides[id] ?? COMMANDS.find((c) => c.id === id)?.keys ?? []; }
  /** Command bound to a chord, if any (the first in the registry when several are). */
  lookup(chord: string): Command | undefined { return COMMANDS.find((c) => this.keysFor(c.id).includes(chord)); }
  /** Every command bound to a chord, in registry order: the dispatcher runs the first one that is enabled (the cut's keys before the keyframe steps). */
  lookupAll(chord: string): Command[] { return COMMANDS.filter((c) => this.keysFor(c.id).includes(chord)); }
  /** Rebind. A chord can belong to one command only: it is removed from any other command. Returns the commands that lost it. */
  bind(id: string, keys: string[]): string[] {
    const displaced: string[] = [];
    for (const c of COMMANDS) {
      if (c.id === id) continue;
      const cur = this.keysFor(c.id);
      const kept = cur.filter((k) => !keys.includes(k));
      if (kept.length !== cur.length) { this.overrides[c.id] = kept; displaced.push(c.id); }
    }
    this.overrides[id] = keys;
    this.storage?.setItem(STORAGE, JSON.stringify(this.overrides));
    return displaced;
  }
  reset() { this.overrides = {}; this.storage?.removeItem(STORAGE); }
  isCustom(id: string) { return id in this.overrides; }
}
/** Readable label for a chord, e.g. 'Mod+Shift+KeyZ' → 'Ctrl+Shift+Z'. Key names stay Latin in both languages. */
export function chordLabel(chord: string, mac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)): string {
  return chord.split('+').map((p) => (p === 'Mod' ? (mac ? '⌘' : 'Ctrl') : p.replace(/^Key|^Digit/, '').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Comma', ',').replace('Period', '.').replace('Equal', '=').replace('Minus', '-').replace('Backspace', '⌫').replace('Delete', 'Del').replace('Escape', 'Esc'))).join('+');
}

// Commands that change the selected clips do nothing while a selected clip is on a locked track.
const CHANGES_SELECTION = new Set(['edit.rollLater', 'edit.rollEarlier', 'edit.slideLater', 'edit.slideEarlier', 'edit.split', 'edit.delete', 'edit.deleteKeepGap', 'cut.rollEarlier', 'cut.rollLater', 'cut.rollEarlier5', 'cut.rollLater5', 'cut.toBeat', 'edit.cut', 'edit.duplicate', 'edit.trimStart', 'edit.trimEnd', 'edit.nudgeLeft', 'edit.nudgeRight', 'edit.nudgeLeft10', 'edit.nudgeRight10', 'edit.slipLater', 'edit.slipEarlier', 'edit.slipLater10', 'edit.slipEarlier10', 'keyframe.remove']);
for (const c of COMMANDS) if (CHANGES_SELECTION.has(c.id)) { const was = c.enabled; c.enabled = (e) => !e.selectionLocked && (!was || was(e)); }

