import { pearlsSummary } from './sourceRanges.ts';
import { sequenceList } from './sequences.ts';
import * as T from '@pulseframe/time';
import type { Asset, MediaClip, ProjectDocument } from './schema.ts';
import { clipEnd, sequenceDuration } from './validate.ts';
import { timelineMarkers } from './cleanup.ts';
import { assetNotices } from './notices.ts';
import { own } from './own.ts';
import { eventDisplayName } from './events.ts';
import { shareable } from './libraryCredits.ts';

const sec = (t: T.RationalTime) => Number(T.toSeconds(t).toFixed(6));

/** How long a clip's sound rings on after its end (an echo or a reverb, ADR-0010) and whether the end of the video cuts it there. */
export interface SoundTail { seconds: number; cut: boolean }
export type SoundTailMeasure = (doc: ProjectDocument, sequenceId: string) => ReadonlyMap<string, SoundTail>;
let tailMeasure: SoundTailMeasure | null = null;
/**
 * How far a sound rings on is decided by the effect kernels and the audio plan (packages/engine: audiofx, audio.ts), which core
 * does not have. The engine connects its measure here when it is loaded (packages/engine/src/evaluate.ts), so every process that
 * plays or exports sound (the server, the editor) reports the planned tails, from the one implementation. Core on its own reports
 * none: soundTails returns null and the outputs say null rather than guess. `null` disconnects (tests).
 */
export function provideSoundTails(measure: SoundTailMeasure | null): void { tailMeasure = measure; }
/** The planned tails of a sequence's sound clips with effects, by clip id; null without an engine, or for a document the plan cannot read (an invalid draft). */
export function soundTails(doc: ProjectDocument, sequenceId = doc.mainSequenceId): ReadonlyMap<string, SoundTail> | null {
  if (!tailMeasure) return null;
  try { return tailMeasure(doc, sequenceId); } catch { return null; }
}
/** What an agent needs to know about a sound clip that the picture fields do not say (fades, direction, pitch, volume keys, sound effects and their tail). */
function soundFields(c: MediaClip, tails: ReadonlyMap<string, SoundTail> | null) {
  const tail = tails?.get(c.id);
  return {
    fadeIn: c.fadeIn ?? null, fadeOut: c.fadeOut ?? null, fadeInSeconds: c.fadeIn ? sec(c.fadeIn) : 0, fadeOutSeconds: c.fadeOut ? sec(c.fadeOut) : 0,
    reverse: !!c.reverse, keepPitch: !!c.keepPitch, volumeKeys: c.volume?.length ?? 0,
    audioFx: (c.audioFx ?? []).map((f) => ({ id: f.id, type: f.type, enabled: f.enabled, params: f.params })),
    tailSeconds: tails ? Number((tail?.seconds ?? 0).toFixed(3)) : null, ...(tail?.cut ? { tailCutAtEnd: true } : {}),
  };
}

/** An asset's library part of the summary: its licence, its credit (verbatim, or null), and the marks that bind its use. */
function libraryPart(a: Asset) {
  const r = a.provenance.library!;
  return { itemId: r.itemId, title: r.title, licenceId: r.licence.id, credit: r.credit?.text ?? null, creditPlacement: r.credit?.placement ?? null, nonCommercial: r.flags.nonCommercial === true, shareable: shareable(a), people: r.flags.people === true };
}

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
    assets: Object.values(doc.assets).map((a) => ({ id: a.id, kind: a.kind, name: a.name, duration: a.duration, durationSeconds: sec(a.duration), hasAudio: !!a.audio, video: a.video && { width: a.video.width, height: a.video.height, frameRate: a.video.frameRate }, ...(a.lut ? { lut: a.lut } : {}),
      // life line (ADR-0021): the file's own capture date; `circa` = an estimate (a file-name date)
      ...(a.capture ? { capture: { at: a.capture.at, source: a.capture.source, circa: a.capture.circa === true } } : {}), notices: assetNotices(a),
      // the content library (wave 7): the licence record of a file copied from the owner's library folder, and what it demands
      ...(a.provenance.library ? { library: libraryPart(a) } : {}) })),
    tracks: seq.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, locked: t.locked, muted: t.muted, clipCount: t.clips.length, ...(t.caption ? { caption: { mode: t.caption.mode, linkedTrackId: t.caption.linkedTrackId, preset: t.caption.style.preset } } : {}) })),
    // shorts (ADR-0018): every sequence of the project, the main edit first; `tracks` above are the main edit's
    sequences: sequenceList(doc),
    recipeRuns: Object.values(doc.recipeRuns ?? {}).map((r) => ({ id: r.id, recipeId: r.recipeId, created: r.createdIds.length, steps: r.steps })),
    variants: Object.values(doc.variants ?? {}).map((v) => ({ id: v.id, name: v.name, width: v.width, height: v.height, fit: v.fit, safeArea: v.safeArea, captionStyle: v.captionStyle ?? null, overrides: Object.keys(v.overrides).length })),
    // the STORED records, one per measured file, on purpose not by lineage (lineage.ts): this lists what exists to be read or
    // corrected (get_analysis, edit_analysis). A copy that follows its source's record has no entry (pinned in beatLineage.test.ts)
    analyses: Object.values(doc.analyses ?? {}).map((a) => ({ assetId: a.assetId, sceneCuts: a.scenes?.cuts.length ?? null, beats: a.beats?.beats.length ?? null, bpm: a.beats?.bpm ?? null, bars: a.beats?.downbeats?.length ?? null, meter: a.beats?.meter ?? null })),
    transcripts: Object.values(doc.transcripts ?? {}).map((t) => ({ assetId: t.assetId, language: t.language, origin: t.origin.kind, phrases: t.segments.length, words: t.segments.reduce((n, s) => n + s.words.length, 0), wordTimed: t.segments.every((s) => s.timing === 'word') })),
    // life line (ADR-0021): `name` is what a person typed ('' = none); `shownAs` is the name the library shows (typed, or derived from a holiday), '' = shown by its date
    // people (ADR-0021, people section): the id and the name, for every reader. A summary never holds a birth date or the word choice;
    // the editor reads those from the document, which the server hands to the owner and to credentials granted them.
    people: Object.values(doc.people ?? {}).map((p) => ({ id: p.id, name: p.name })),
    // marked ranges («פנינים», wave 7): counts only, and only when the project has any (no label ever: labels are family notes)
    ...(doc.sourceRanges ? { pearls: pearlsSummary(doc) } : {}),
    events: Object.values(doc.events ?? {}).map((e) => { const shown = eventDisplayName(doc, e, 'en'); return { id: e.id, name: e.name, shownAs: shown.name, nameKind: shown.kind, files: e.assetIds.length, afterSunset: e.afterSunset, edited: e.origin.edited }; }),
  };
}

export function timeline(doc: ProjectDocument, sequenceId = doc.mainSequenceId) {
  const seq = own(doc.sequences, sequenceId);
  if (!seq) return null;
  const tails = soundTails(doc, seq.id);
  return {
    sequenceId: seq.id,
    frameRate: doc.settings.frameRate,
    duration: sequenceDuration(doc, sequenceId),
    markers: (() => { const m = timelineMarkers(doc); return { user: Object.values(doc.markers ?? {}).filter((k) => k.sequenceId === seq.id).sort((x, y) => T.cmp(x.time, y.time)).map((k) => ({ id: k.id, time: k.time, seconds: sec(k.time), label: k.label, color: k.color })), beatSeconds: m.beats.slice(0, 2000).map(sec), sceneCutSeconds: m.sceneCuts.slice(0, 2000).map(sec), note: 'Derived from analysis data through the current clips; snap edits to these with frame-aligned times.' }; })(),
    tracks: seq.tracks.map((t) => ({
      id: t.id, kind: t.kind, name: t.name, locked: t.locked, muted: t.muted, ...(t.audio ? { audio: t.audio } : {}), ...(t.caption ? { caption: t.caption } : {}),
      clips: t.clips.map((c) => ({
        id: c.id, type: c.type, start: c.start, duration: c.duration, end: clipEnd(c),
        startSeconds: sec(c.start), endSeconds: sec(clipEnd(c)),
        ...(c.type === 'media' ? { assetId: c.assetId, sourceIn: c.sourceIn, gain: c.gain, linkGroupId: c.linkGroupId, ...(c.speed ? { speed: c.speed.num / c.speed.den } : {}), ...(t.kind === 'audio' ? soundFields(c, tails) : {}) } : c.type === 'text' ? { text: c.text, style: c.style, ...(c.fields ? { fields: true as const } : {}) } : c.type === 'caption' ? { text: c.text } : { ...(c.label ? { label: c.label } : {}) }),
        transform: c.transform,
      })),
    })),
  };
}

/** A transcript in agent-readable form: phrase and word ids (for correct_transcript / delete_transcript_range) with source times. */
export function transcriptView(doc: ProjectDocument, assetId: string) {
  const t = own(doc.transcripts, assetId);
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
