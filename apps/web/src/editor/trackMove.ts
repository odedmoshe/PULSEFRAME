/**
 * Dragging a clip onto another track of the same kind (wave 8D integration; P5 left it out because the drag was another
 * package's file). Pure rules, no DOM: which track a move lands on, why a track is refused, and the ONE op it commits.
 * The op is the existing registered `move_clip` with its `trackId` (packages/core/src/ops.ts), which refuses a locked track
 * and a track of another kind by itself; the editor refuses first, in words, so nothing is sent that would be refused.
 */
import type * as T from '@pulseframe/time';
import type { Lang } from '@pulseframe/i18n';

export interface MoveTrack { id: string; kind: string; locked?: boolean; name: string }
export type TrackMoveRefusal = 'locked' | 'kind';
export interface TrackMoveTarget { trackId: string; refusal: TrackMoveRefusal | null }

/**
 * Where a moved clip goes: the track under the pointer when it is another track (refused when it is locked or of another
 * kind: adjustment clips live only on adjustment tracks, so the kind rule covers them), else the clip's own track.
 */
export function trackMoveTarget(from: MoveTrack, over: MoveTrack | null): TrackMoveTarget {
  if (!over || over.id === from.id) return { trackId: from.id, refusal: null };
  if (over.kind !== from.kind) return { trackId: over.id, refusal: 'kind' };
  if (over.locked) return { trackId: over.id, refusal: 'locked' };
  return { trackId: over.id, refusal: null };
}

/** The one op of a move: `move_clip`, with `trackId` only when the clip changes track (a move along its own track is unchanged). */
export function moveClipOp(clipId: string, start: T.RationalTime, fromTrackId: string, toTrackId: string) {
  return { op: 'move_clip', args: { clipId, start, ...(toTrackId !== fromTrackId ? { trackId: toTrackId } : {}) } } as const;
}

const KIND_WORD: Record<Lang, Record<string, string>> = {
  he: { video: 'וידאו', audio: 'סאונד', text: 'טקסט', caption: 'כתוביות', adjustment: 'התאמה' },
  en: { video: 'video', audio: 'sound', text: 'text', caption: 'captions', adjustment: 'adjustment' },
};
export const TRACK_MOVE_STRINGS = {
  he: {
    locked: (track: string) => `הרצועה ${track} נעולה: בטלו את הנעילה בראש הרצועה, או גררו לרצועה אחרת`,
    kind: (clipKind: string) => `קליפ ${KIND_WORD.he[clipKind] ?? clipKind} נכנס רק לרצועת ${KIND_WORD.he[clipKind] ?? clipKind}: גררו אל רצועה מאותו סוג`,
  },
  en: {
    locked: (track: string) => `Track ${track} is locked: unlock it at the head of the track, or drag to another track`,
    kind: (clipKind: string) => `A ${KIND_WORD.en[clipKind] ?? clipKind} clip goes only on a ${KIND_WORD.en[clipKind] ?? clipKind} track: drag it to a track of the same kind`,
  },
} as const;

/** The refusal in words (why, and what to do instead). */
export function trackMoveRefusalText(lang: Lang, refusal: TrackMoveRefusal, from: MoveTrack, over: MoveTrack): string {
  const S = TRACK_MOVE_STRINGS[lang];
  // the track's name isolated, so «A1» stays «A1» inside a Hebrew sentence
  return refusal === 'locked' ? S.locked(`\u2068${over.name}\u2069`) : S.kind(from.kind);
}
