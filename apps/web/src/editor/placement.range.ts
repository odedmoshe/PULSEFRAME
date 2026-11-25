/**
 * The three placements of a marked stretch of a library file on the timeline — add at the end, ripple insert at the playhead,
 * overwrite at the playhead — as ONE pure builder (inputs → `OpCall[]`), so the source viewer and the pearls list make exactly the
 * same operations (wave 7 pearls track, decision C19: proof:phase3 stays 53/53). No editor state and no DOM: the caller resolves the
 * tracks (the chosen target, else automatic) and the times, and commits the result as ONE `editor.commit` (one undo step).
 *
 * The operations are byte for byte those the viewer made before this file existed:
 *  - add:       add_clip at the append point;
 *  - insert:    insert_gap of the stretch's length at the playhead, then add_clip there (a ripple insert);
 *  - overwrite: cut_range of the same length on the target picture and sound tracks (nothing moves), then add_clip.
 * `range` null places the whole file (add_clip names no sourceIn and no duration).
 */
import * as T from '@pulseframe/time';
import type { OpCall } from '@pulseframe/core';

export type PlacementMode = 'add' | 'insert' | 'overwrite';

export interface RangePlacement {
  mode: PlacementMode;
  assetId: string;
  /** the stretch in the file's own time; null = the whole file */
  range: { sourceIn: T.RationalTime; duration: T.RationalTime } | null;
  /** length used to open or clear room when `range` is null (insert / overwrite of a whole file); ignored otherwise */
  wholeDuration?: T.RationalTime;
  /** add: the append point; insert / overwrite: the timeline playhead */
  at: T.RationalTime;
  /** the track ids named in add_clip: the picture track (or the sound track of a sound-only file) and the linked sound's track */
  trackId?: string; audioTrackId?: string;
  /** overwrite: the tracks to clear (the picture and sound target tracks, already resolved) */
  clearTrackIds?: readonly string[];
}

/** The operations of one placement, in order. Throws nothing; an empty stretch yields no operations. */
export function placementOps(p: RangePlacement): OpCall[] {
  const length = p.range ? p.range.duration : p.wholeDuration;
  const clip: OpCall = {
    op: 'add_clip',
    args: {
      assetId: p.assetId, start: p.at,
      ...(p.range ? { sourceIn: p.range.sourceIn, duration: p.range.duration } : {}),
      ...(p.trackId ? { trackId: p.trackId } : {}), ...(p.audioTrackId ? { audioTrackId: p.audioTrackId } : {}),
    },
  };
  if (p.mode === 'add') return [clip];
  if (!length || T.cmp(length, T.ZERO) <= 0) return [];
  if (p.mode === 'insert') return [{ op: 'insert_gap', args: { at: p.at, duration: length } }, clip];
  const clear = p.clearTrackIds ?? [];
  return [...(clear.length ? [{ op: 'cut_range', args: { start: p.at, end: T.add(p.at, length), ripple: false, trackIds: [...clear] } } as OpCall] : []), clip];
}

/** The undo label of a placement (the history line, English; the interface words it through the operation names). */
export const placementLabel = (mode: PlacementMode): string => (mode === 'add' ? 'Add clip' : mode === 'insert' ? 'Insert clip' : 'Overwrite with clip');
