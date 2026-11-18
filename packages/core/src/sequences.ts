/**
 * Sequences of one project as outputs (ADR-0018 shorts). A project may hold extra sequences (a short is one) besides its main
 * edit. Every route that renders, measures or checks a non-main sequence reaches it ONLY through projectOutput: the projected
 * document has that sequence alone, made the main one, with its own frame, fit and loudness and only its markers. The
 * evaluator and the compositor never learn about sequences (ADR-0005: preview, /frame, stills and export share one path).
 *
 * A projection is a view to render, measure or read from. It is never committed to and never written back: operations run on
 * the stored document, naming the sequence by `sequenceId`.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, SafeArea, Sequence, SequenceFormat, SequenceOrigin } from './schema.ts';
import { projectVariant } from './variants.ts';
import { sequenceDuration } from './validate.ts';

/** What to render: a sequence (default the main one), then a linked format variant over it (default none). */
export interface OutputTarget { sequenceId?: string; variantId?: string }
/** A target that names no sequence or variant of this project. Servers answer it 404 not_found. */
export class OutputTargetError extends Error {
  constructor(readonly code: 'sequence_not_found' | 'variant_not_found', message: string, readonly details: Record<string, unknown>) { super(message); }
}
/** The stored sequence by own property (an id such as "constructor" finds nothing), or undefined. */
export const sequenceOf = (doc: ProjectDocument, sequenceId: string): Sequence | undefined => (Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined);
/** True for a sequence that is not the main edit and has its own frame. */
export const hasOwnFormat = (doc: ProjectDocument, sequenceId: string): boolean => sequenceId !== doc.mainSequenceId && !!sequenceOf(doc, sequenceId)?.format;

/**
 * The frame a sequence renders at: its own format, or the project's settings for the main sequence (and for a sequence
 * without a format). Ops that place pictures (apply_layout) and the planners use it instead of reading d.settings.
 */
export function frameOf(doc: ProjectDocument, sequenceId: string = doc.mainSequenceId): { width: number; height: number; fit: 'contain' | 'cover' } {
  const f = sequenceId === doc.mainSequenceId ? undefined : sequenceOf(doc, sequenceId)?.format;
  return f ? { width: f.width, height: f.height, fit: f.fit } : { width: doc.settings.width, height: doc.settings.height, fit: doc.settings.fit ?? 'contain' };
}

/**
 * The document that renders `sequenceId`: that sequence alone, made the main one, with its own frame, fit and loudness and
 * only its markers. The SAME object for a single-sequence project, so nothing changes for projects without shorts. Keeping
 * one sequence keeps export snapshots small and stops usesGpuEffects (apps/server/src/export.ts) asking for a GPU because
 * of another sequence. The projected sequence carries no `format` and no `origin` (it is the main one there, and the main
 * sequence never has them); read those from the stored document. Throws OutputTargetError for an unknown id.
 */
export function projectSequence(doc: ProjectDocument, sequenceId: string = doc.mainSequenceId): ProjectDocument {
  const seq = sequenceOf(doc, sequenceId);
  if (!seq) throw new OutputTargetError('sequence_not_found', `sequence ${sequenceId} not found`, { sequenceId, available: Object.keys(doc.sequences) });
  if (Object.keys(doc.sequences).length === 1) return doc;
  const settings = { ...doc.settings };
  const f = sequenceId === doc.mainSequenceId ? undefined : seq.format;
  if (f) {
    settings.width = f.width;
    settings.height = f.height;
    settings.fit = f.fit;
    if (f.loudness === null) delete settings.loudness;
    else if (f.loudness) settings.loudness = { ...f.loudness };
  }
  const { format: _format, origin: _origin, ...own } = seq;
  const markers = Object.fromEntries(Object.entries(doc.markers ?? {}).filter(([, m]) => m.sequenceId === sequenceId));
  return { ...doc, settings, sequences: { [sequenceId]: own }, mainSequenceId: sequenceId, markers };
}

/** Sequence, then linked format. The ONLY way any route reaches a non-main sequence (ADR-0005). Throws OutputTargetError. */
export function projectOutput(doc: ProjectDocument, t: OutputTarget = {}): ProjectDocument {
  const s = projectSequence(doc, t.sequenceId ?? doc.mainSequenceId);
  if (t.variantId === undefined) return s;
  if (!Object.hasOwn(doc.variants ?? {}, t.variantId)) throw new OutputTargetError('variant_not_found', `format variant ${t.variantId} not found`, { variantId: t.variantId, available: Object.keys(doc.variants ?? {}) });
  return projectVariant(s, t.variantId);
}

/** The safe-area guides of an output: the variant's, else the sequence format's; null for the main edit without a variant. */
export function outputSafeArea(doc: ProjectDocument, t: OutputTarget = {}): SafeArea | null {
  if (t.variantId !== undefined) return Object.hasOwn(doc.variants ?? {}, t.variantId) ? doc.variants[t.variantId]!.safeArea ?? null : null;
  const id = t.sequenceId ?? doc.mainSequenceId;
  return id === doc.mainSequenceId ? null : sequenceOf(doc, id)?.format?.safeArea ?? null;
}

/** Notes about an output target that the caller should pass on (preflight, plan views). */
export const OUTPUT_WARNINGS = ['variant_over_sequence_format'] as const;
export type OutputWarning = (typeof OUTPUT_WARNINGS)[number];
/** variant_over_sequence_format: a linked format applied over a sequence that has its own frame replaces that frame. */
export const outputWarnings = (doc: ProjectDocument, t: OutputTarget = {}): OutputWarning[] =>
  t.variantId !== undefined && t.sequenceId !== undefined && hasOwnFormat(doc, t.sequenceId) ? ['variant_over_sequence_format'] : [];

/** One row of list_sequences / the editor's sequence switcher. `origin` is the kind only; the measured provenance stays in the document. */
export interface SequenceSummary {
  id: string; name: string; main: boolean;
  format: SequenceFormat | null; origin: SequenceOrigin['kind'] | null;
  duration: T.RationalTime; durationSeconds: number; frames: number; tracks: number; clips: number;
}
/** Main first, then the others in document order. frames = T.frameCount(sequenceDuration(doc, id), doc.settings.frameRate). */
export function sequenceList(doc: ProjectDocument): SequenceSummary[] {
  const ids = [doc.mainSequenceId, ...Object.keys(doc.sequences).filter((id) => id !== doc.mainSequenceId)];
  return ids.flatMap((id) => {
    const s = sequenceOf(doc, id);
    if (!s) return [];
    const duration = sequenceDuration(doc, id);
    return [{
      id, name: s.name, main: id === doc.mainSequenceId, format: s.format ?? null, origin: s.origin?.kind ?? null,
      duration, durationSeconds: Number(T.toSeconds(duration).toFixed(3)), frames: T.frameCount(duration, doc.settings.frameRate),
      tracks: s.tracks.length, clips: s.tracks.reduce((n, t) => n + t.clips.length, 0),
    }];
  });
}
