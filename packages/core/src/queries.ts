import * as T from '@pulseframe/time';
import type { ProjectDocument } from './schema.ts';
import { clipEnd, sequenceDuration } from './validate.ts';
import { timelineMarkers } from './cleanup.ts';

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
    tracks: seq.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, locked: t.locked, clipCount: t.clips.length, ...(t.caption ? { caption: { mode: t.caption.mode, linkedTrackId: t.caption.linkedTrackId, preset: t.caption.style.preset } } : {}) })),
    recipeRuns: Object.values(doc.recipeRuns ?? {}).map((r) => ({ id: r.id, recipeId: r.recipeId, created: r.createdIds.length, steps: r.steps })),
    variants: Object.values(doc.variants ?? {}).map((v) => ({ id: v.id, name: v.name, width: v.width, height: v.height, fit: v.fit, safeArea: v.safeArea, overrides: Object.keys(v.overrides).length })),
    analyses: Object.values(doc.analyses ?? {}).map((a) => ({ assetId: a.assetId, sceneCuts: a.scenes?.cuts.length ?? null, beats: a.beats?.beats.length ?? null, bpm: a.beats?.bpm ?? null })),
    transcripts: Object.values(doc.transcripts ?? {}).map((t) => ({ assetId: t.assetId, language: t.language, origin: t.origin.kind, phrases: t.segments.length, words: t.segments.reduce((n, s) => n + s.words.length, 0), wordTimed: t.segments.every((s) => s.timing === 'word') })),
  };
}

export function timeline(doc: ProjectDocument, sequenceId = doc.mainSequenceId) {
  const seq = doc.sequences[sequenceId];
  if (!seq) return null;
  return {
    sequenceId: seq.id,
    frameRate: doc.settings.frameRate,
    duration: sequenceDuration(doc, sequenceId),
    markers: (() => { const m = timelineMarkers(doc); return { user: Object.values(doc.markers ?? {}).filter((k) => k.sequenceId === seq.id).sort((x, y) => T.cmp(x.time, y.time)).map((k) => ({ id: k.id, time: k.time, seconds: sec(k.time), label: k.label, color: k.color })), beatSeconds: m.beats.slice(0, 2000).map(sec), sceneCutSeconds: m.sceneCuts.slice(0, 2000).map(sec), note: 'Derived from analysis data through the current clips; snap edits to these with frame-aligned times.' }; })(),
    tracks: seq.tracks.map((t) => ({
      id: t.id, kind: t.kind, name: t.name, locked: t.locked, ...(t.caption ? { caption: t.caption } : {}),
      clips: t.clips.map((c) => ({
        id: c.id, type: c.type, start: c.start, duration: c.duration, end: clipEnd(c),
        startSeconds: sec(c.start), endSeconds: sec(clipEnd(c)),
        ...(c.type === 'media' ? { assetId: c.assetId, sourceIn: c.sourceIn, gain: c.gain, linkGroupId: c.linkGroupId, ...(c.speed ? { speed: c.speed.num / c.speed.den } : {}) } : c.type === 'text' ? { text: c.text, style: c.style } : { text: c.text }),
        transform: c.transform,
      })),
    })),
  };
}

/** A transcript in agent-readable form: phrase and word ids (for correct_transcript / delete_transcript_range) with source times. */
export function transcriptView(doc: ProjectDocument, assetId: string) {
  const t = doc.transcripts?.[assetId];
  if (!t) return null;
  return {
    assetId, language: t.language, origin: t.origin,
    note: 'Times are in the source media, not the timeline. timing=word is safe for word-precise cuts; segment/approximate is not.',
    segments: t.segments.map((s) => ({
      id: s.id, startSeconds: sec(s.start), endSeconds: sec(T.add(s.start, s.duration)), text: s.text, ...(s.original !== null ? { original: s.original } : {}), speaker: s.speaker, timing: s.timing,
      words: s.words.map((w) => ({ id: w.id, text: w.text, startSeconds: sec(w.start), endSeconds: sec(T.add(w.start, w.duration)), ...(w.confidence !== null ? { confidence: w.confidence } : {}) })),
    })),
  };
}
