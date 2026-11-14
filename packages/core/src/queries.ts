import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import { clipEnd, sequenceDuration } from './validate.ts';

const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));

/** Compact, agent-readable overview. Exact times are included alongside readable seconds. */
export function summarize(doc: ProjectDocument) {
  const seq = doc.sequences[doc.mainSequenceId]!;
  const duration = sequenceDuration(doc);
  return {
    id: doc.id,
    name: doc.name,
    settings: doc.settings,
    duration,
    durationSeconds: sec(duration),
    frameCount: T.frameCount(duration, doc.settings.frameRate),
    assets: Object.values(doc.assets).map((a) => ({ id: a.id, kind: a.kind, name: a.name, duration: a.duration, durationSeconds: sec(a.duration), hasAudio: !!a.audio, video: a.video && { width: a.video.width, height: a.video.height, frameRate: a.video.frameRate } })),
    tracks: seq.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, locked: t.locked, clipCount: t.clips.length })),
  };
}

export function timeline(doc: ProjectDocument, sequenceId = doc.mainSequenceId) {
  const seq = doc.sequences[sequenceId];
  if (!seq) return null;
  return {
    sequenceId: seq.id,
    frameRate: doc.settings.frameRate,
    duration: sequenceDuration(doc, sequenceId),
    tracks: seq.tracks.map((t) => ({
      id: t.id, kind: t.kind, name: t.name, locked: t.locked,
      clips: t.clips.map((c) => ({
        id: c.id, type: c.type, start: c.start, duration: c.duration, end: clipEnd(c),
        startSeconds: sec(c.start), endSeconds: sec(clipEnd(c)),
        ...(c.type === 'media' ? { assetId: c.assetId, sourceIn: c.sourceIn, gain: c.gain, linkGroupId: c.linkGroupId } : { text: c.text, style: c.style }),
        transform: c.transform,
      })),
    })),
  };
}
