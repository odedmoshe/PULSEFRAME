/**
 * Applying a speed curve from the inspector, one action at a time. The op keeps the clip's id on the FIRST part of the result,
 * so a second apply with the same clip id (a double-click, or another tile right after) would put a whole new curve inside
 * that first part. This guard takes one action while a commit is on its way, and none while the timeline selection is still
 * exactly the parts the last curve made; choosing a clip (or undoing) lifts it.
 *
 * A curve of ONE part (Smooth ramp, a hand-made curve of two points) leaves the clip whole, with the same id and the same
 * selection as before, so there is no first part to protect and nothing to tell "applied" from "undone" by: it is not held.
 * Another curve on that clip replaces its speed over the same stretch of the source (the op reads the source shown now).
 */
import * as T from '@pulseframe/time';
import { clipEnd, findClip, type Clip, type OpCall, type ProjectDocument, type Track } from '@pulseframe/core';
import { sameIds, singleFlight } from './oneAtATime.ts';

type MediaClip = Extract<Clip, { type: 'media' }>;
/**
 * Why `apply_speed_curve` (packages/core/src/ops.ts) would refuse every curve on this clip, read from the document before
 * anything is sent, so the tiles can be held with a sentence that says what to do. The op stays the authority: this
 * follows its checks, in its order, over the same clips (the clip and, as the inspector always sends, every clip linked
 * to it), and a refusal it still gives is shown as before.
 * - 'freeze' / 'reverse': a freeze frame, or a clip that plays backwards;
 * - 'keyframes': keyframes, volume keys or animated effect parameters;
 * - 'transition': a picture transition at the start of the clip, or at the start of the clip that follows it directly;
 * - 'crossfade': its sound plays on over the next clip on its track, or the previous one over it, as a crossfade
 *   (set_audio_crossfade can remove it);
 * - 'overlap': the same kind of overlap made by hand (not a crossfade).
 * Not covered, because they depend on the curve or on other tracks: keep-pitch sound with a gradual curve, linked clips that
 * differ in place or length, a linked clip on a locked track, a clip too short for the curve.
 */
export type CurveBlock = 'freeze' | 'reverse' | 'keyframes' | 'transition' | 'crossfade' | 'overlap';
export function curveBlocker(doc: ProjectDocument, clipId: string): CurveBlock | null {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media') return null;
  const lead = f.clip;
  const targets: { track: Track; clip: MediaClip }[] = [{ track: f.track, clip: lead }];
  if (lead.linkGroupId) for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips) if (c.type === 'media' && c.id !== lead.id && c.linkGroupId === lead.linkGroupId) targets.push({ track, clip: c });
  for (const { track, clip } of targets) {
    if (clip.freeze) return 'freeze';
    if (clip.reverse) return 'reverse';
    if (clip.keyframes || clip.volume || clip.effects?.some((e) => e.keyframes)) return 'keyframes';
    const next = track.clips[track.clips.indexOf(clip) + 1];
    if (clip.transition || (next && next.type === 'media' && next.transition && T.eq(next.start, clipEnd(clip)))) return 'transition';
    const end = clipEnd(clip);
    const isCrossfade = (earlier: MediaClip, later: Clip) => !!earlier.fadeOut && T.eq(T.sub(clipEnd(earlier), earlier.fadeOut), later.start);
    const into = track.clips.find((o) => o.id !== clip.id && o.type === 'media' && T.lt(clip.start, o.start) && T.lt(o.start, end) && T.lt(end, clipEnd(o)));
    if (into) return isCrossfade(clip, into) ? 'crossfade' : 'overlap';
    const from = track.clips.find((o): o is MediaClip => o.id !== clip.id && o.type === 'media' && T.lt(o.start, clip.start) && T.lt(clip.start, clipEnd(o)) && T.lt(clipEnd(o), end));
    if (from) return isCrossfade(from, clip) ? 'crossfade' : 'overlap';
  }
  return null;
}

export interface CurveHost {
  commit(ops: OpCall[], label?: string): Promise<{ results: { output?: Record<string, any> }[] } | null>;
  select(id: string, mode?: 'replace' | 'toggle'): void;
  /** The timeline selection as it is now. */
  selection(): readonly string[];
  /** Whether the clip is in the document as it is now. */
  hasClip(id: string): boolean;
}
export type CurveOutcome =
  | { kind: 'applied'; partIds: string[] }
  | { kind: 'busy' } // another apply is still on its way: nothing was sent
  | { kind: 'repeat' } // the parts of the curve just applied are still selected: nothing was sent
  | { kind: 'refused' }; // the op was refused or made no parts; the editor reports why

/**
 * How the given clips look now, as one string (a clip that is gone counts as null). The status line under the tiles speaks of
 * the clips a curve made; it is dropped once they no longer look as they did, and kept through edits elsewhere.
 */
export const clipsLook = (clipOf: (id: string) => unknown, ids: readonly string[]) => JSON.stringify(ids.map((id) => clipOf(id) ?? null));

export function curveApplier(host: CurveHost) {
  const flight = singleFlight();
  /** The parts of the last curve applied here, when it made more than one. */
  let lastParts: string[] | null = null;
  /** Some of them have left the document since (an undo, usually). */
  let partsGone = false;
  const selectAll = (ids: readonly string[]) => { host.select(ids[0]!); for (const id of ids.slice(1)) host.select(id, 'toggle'); };
  const repeat = () => !!lastParts && sameIds(host.selection(), lastParts);
  return {
    get busy() { return flight.busy; },
    /** True while a second curve would land on the first part of the curve just applied. */
    repeat,
    async apply(clipId: string, args: Record<string, unknown>, label: string): Promise<CurveOutcome> {
      if (flight.busy) return { kind: 'busy' };
      if (repeat()) return { kind: 'repeat' };
      const done = await flight.run(async (): Promise<CurveOutcome> => {
        const r = await host.commit([{ op: 'apply_speed_curve', args: { clipId, ...args } }], label);
        const ids = (r?.results[0]?.output as { partClipIds?: string[] } | undefined)?.partClipIds;
        if (!ids?.length) return { kind: 'refused' };
        selectAll(ids);
        lastParts = ids.length > 1 ? ids : null;
        partsGone = false;
        return { kind: 'applied', partIds: ids };
      });
      return done.dropped ? { kind: 'busy' } : done.value;
    },
    /**
     * Call when the document has changed. An undo takes the parts away and the editor drops them from the selection; a redo
     * brings them back but selects nothing, which would leave the first part (it kept the clip's id) alone in the inspector
     * with the tiles live. So when the parts return and that first part is all that is selected, they are selected again,
     * as the apply left them. Returns 'gone' or 'back' when that happened, for the status line; otherwise null.
     */
    documentChanged(): 'gone' | 'back' | null {
      if (!lastParts) return null;
      if (!lastParts.every((id) => host.hasClip(id))) { const first = !partsGone; partsGone = true; return first ? 'gone' : null; }
      if (!partsGone) return null;
      partsGone = false;
      if (!sameIds(host.selection(), [lastParts[0]!])) return null;
      selectAll(lastParts);
      return 'back';
    },
  };
}
