/**
 * What is known about a file's beats and scene cuts, apart from React (unit-tested in analysis.logic.test.ts), for the surfaces
 * that ask by file: the analysis panel, the beat card of the inspector, the library card, the music step of the template and film
 * dialogs, the bar.beat readout. One rule, the timeline's (core lineage.ts ownBeats / ownSceneCuts): a file has its own
 * measurements, or those of the nearest time-preserving source it is a copy of, moved exactly onto its own clock (rational time).
 * A copy made without a recorded time mapping (reversed, stretched, generated) has none of its source's: it reads "not measured".
 */
import * as T from '@pulseframe/time';
import { beatNumbers, ownBeats, ownSceneCuts, type OpCall, type ProjectDocument } from '@pulseframe/core';

type Kind = 'scenes' | 'beats';

/** Whether the beat of a sound file is known, how many of the measured beats lie in it, and the measured tempo. */
export function beatFacts(doc: ProjectDocument, assetId: string): { measured: boolean; count: number; bpm: number | null } {
  // core beatNumbers: a source's beats from before the copy begins or after it ends are not beats of the copy
  const n = Object.hasOwn(doc.assets, assetId) ? beatNumbers(doc, assetId) : null;
  return n ? { measured: true, count: n.count, bpm: n.bpm } : { measured: false, count: 0, bpm: null };
}
/** Beats per bar of a file's music by its analysis; null when it has none or the analysis has no bars. */
export const meterOf = (doc: ProjectDocument, assetId: string): number | null => ownBeats(doc, assetId)?.analysis.meter ?? null;
/** The library card's two numbers: the measured tempo (rounded) and the number of shots (scene cuts in the file + 1); null = not measured. */
export function libraryFacts(doc: ProjectDocument, assetId: string): { bpm: number | null; shots: number | null } {
  const bpm = ownBeats(doc, assetId)?.analysis.bpm, scenes = ownSceneCuts(doc, assetId);
  return { bpm: bpm ? Math.round(bpm) : null, shots: scenes ? scenes.cuts.length + 1 : null };
}

type Origin = { method: string; edited: boolean };
export interface AnalysisFacts {
  /** Scene cuts of the file on its own clock. `on` is the file whose record they are (the file itself or its time-preserving source). */
  scenes: { cuts: readonly T.RationalTime[]; origin: Origin; on: string } | null;
  beats: { count: number; times: readonly T.RationalTime[]; bpm: number | null; confidence: number | null; bars: number; meter: number | null; origin: Origin; on: string } | null;
  /** The measured source when what is shown was measured on another file than this one; null otherwise. */
  measuredOn: string | null;
}
/** What the analysis panel shows for a file. */
export function analysisFacts(doc: ProjectDocument, assetId: string): AnalysisFacts {
  const s = ownSceneCuts(doc, assetId), n = beatNumbers(doc, assetId), b = n?.own;
  const scenes = s ? { cuts: s.cuts, origin: doc.analyses[s.assetId]!.scenes!.origin, on: s.assetId } : null;
  const beats = n && b ? { count: n.count, times: b.beats, bpm: b.analysis.bpm, confidence: b.analysis.confidence, bars: n.bars, meter: b.analysis.meter ?? null, origin: b.analysis.origin, on: b.assetId } : null;
  return { scenes, beats, measuredOn: [scenes?.on, beats?.on].find((id) => id !== undefined && id !== assetId) ?? null };
}

/** Nearest time of `list` to `t` (exact rational compare), or null when the list is empty. */
export function nearest(list: readonly T.RationalTime[], t: T.RationalTime): T.RationalTime | null {
  let best: T.RationalTime | null = null;
  let bestD: T.RationalTime | null = null;
  for (const x of list) {
    const d = T.cmp(x, t) < 0 ? T.sub(t, x) : T.sub(x, t);
    if (bestD === null || T.lt(d, bestD)) { best = x; bestD = d; }
  }
  return best;
}
/**
 * The edit_analysis call that adds a beat or cut at `at`, or removes the nearest one to it, where `at` is a time of the file
 * `assetId` (the clip's source time at the playhead). The correction goes to the record that is shown: the file's own, or the
 * measured source's when the file is a time-preserving copy of it, at the same moment on the source's clock (at + the lineage
 * offset, exact). So a correction made on a cleaned-up copy corrects the music itself and every copy that follows it, and never
 * starts a second, one-beat record on the copy that would hide the measured one. A file with no record by lineage (also a copy
 * without a recorded time mapping) gets its own record. null: nothing to remove.
 */
export function analysisEdit(doc: ProjectDocument, assetId: string, kind: Kind, action: 'add' | 'remove', at: T.RationalTime): OpCall | null {
  const found = kind === 'scenes' ? ownSceneCuts(doc, assetId) : ownBeats(doc, assetId);
  const target = found?.assetId ?? assetId, offset = found?.offset ?? T.ZERO;
  if (action === 'add') return { op: 'edit_analysis', args: { assetId: target, kind, add: [T.add(at, offset)] } };
  const times = !found ? [] : 'cuts' in found ? found.cuts : found.beats;
  const n = nearest(times, at);
  return n ? { op: 'edit_analysis', args: { assetId: target, kind, remove: [T.add(n, offset)] } } : null;
}
