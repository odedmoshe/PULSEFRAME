/**
 * Where a library file goes when it is added to the timeline: the arguments of `add_clip`, decided from the document alone.
 * No editor state and no DOM, so the decisions can be tested against the real operation.
 */
import * as T from '@pulseframe/time';
import { clipEnd, type Asset, type Clip, type ProjectDocument } from '@pulseframe/core';

type Span = Pick<Clip, 'start' | 'duration'>;

/** The length `add_clip` gives a clip of this file when none is named: the whole source cut to whole frames (a still picture gets 5 s). */
export function addedClipDuration(asset: Pick<Asset, 'kind' | 'duration'>, rate: T.Rate): T.RationalTime {
  return asset.kind === 'image' ? T.rt(5, 1) : T.frameTime(T.frameCount(asset.duration, rate), rate);
}

/**
 * True when no clip of the track overlaps [start, end). Ranges are half-open, as in the operations: a clip that ends exactly
 * at `start`, or begins exactly at `end`, only touches the range and leaves it free.
 */
export function trackFreeAt(track: { clips: readonly Span[] }, start: T.RationalTime, end: T.RationalTime): boolean {
  return !track.clips.some((c) => T.lt(c.start, end) && T.lt(start, clipEnd(c as Clip)));
}

/**
 * The sound target to name in `add_clip` for a sound that would take [start, start + duration): the target when it is free
 * there, otherwise null. A named sound track is used as given, even on top of another clip (that is how crossfades are
 * made), so an occupied target must not be named: automatic placement then finds a free sound track and never stacks.
 */
export function soundTargetIfFree(doc: ProjectDocument, targetId: string | null, start: T.RationalTime, duration: T.RationalTime): string | null {
  const track = targetId ? doc.sequences[doc.mainSequenceId]?.tracks.find((t) => t.id === targetId) : undefined;
  if (!track || track.kind !== 'audio' || track.locked) return null;
  return trackFreeAt(track, start, T.add(start, duration)) ? track.id : null;
}

const hasPicture = (a: Asset) => !!a.video || a.kind === 'image';

/**
 * The + button of a library card. A picture goes after what is already on the timeline (`appendPoint`), on the picture target;
 * a sound-only file (music, a recording) starts at the playhead. The sound (the file itself, or the linked sound of a picture
 * file) goes to the sound target only while that track is free there.
 */
export function addAssetArgs(doc: ProjectDocument, assetId: string, p: { appendPoint: T.RationalTime; playhead: T.RationalTime; videoTarget: string | null; audioTarget: string | null }): Record<string, unknown> {
  const a = doc.assets[assetId];
  const picture = !!a && hasPicture(a);
  const start = picture ? p.appendPoint : p.playhead;
  const au = a?.audio ? soundTargetIfFree(doc, p.audioTarget, start, addedClipDuration(a, doc.settings.frameRate)) : null;
  const where = picture ? { ...(p.videoTarget ? { trackId: p.videoTarget } : {}), ...(au ? { audioTrackId: au } : {}) } : au ? { trackId: au } : {};
  return { assetId, start, ...where };
}

/**
 * A library file dropped on the timeline at `start`: on the track it was dropped on when the track suits it (a picture file
 * on a picture track, a sound-only file on a sound track), otherwise on the first free track. The linked sound of a picture
 * file goes to the sound target while that track is free there. null: nothing to place (unknown file, or a colour table).
 */
export function dropAssetArgs(doc: ProjectDocument, assetId: string, p: { start: T.RationalTime; trackId: string | null; audioTarget: string | null }): Record<string, unknown> | null {
  const a = doc.assets[assetId];
  if (!a || a.kind === 'lut') return null;
  const picture = hasPicture(a);
  const tr = p.trackId ? doc.sequences[doc.mainSequenceId]?.tracks.find((t) => t.id === p.trackId) : undefined;
  const fits = !!tr && !tr.locked && tr.kind === (picture ? 'video' : 'audio');
  const au = picture && a.audio ? soundTargetIfFree(doc, p.audioTarget, p.start, addedClipDuration(a, doc.settings.frameRate)) : null;
  return { assetId, start: p.start, ...(fits ? { trackId: tr!.id } : {}), ...(au ? { audioTrackId: au } : {}) };
}
