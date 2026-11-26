/**
 * Capture (wave 8 owntemplate; plan 3.6 with verifier C2, C5, C9, C13): the main sequence as it is now -> a TemplateDef by
 * WHITELIST (ownTemplateKeys.ts; never by copying and scrubbing) and a report of what was kept and what not, with times.
 * Pure, deterministic, exact (positions as integer ticks or frames, times only through @pulseframe/time; C12).
 * STUBS until BUILDER W1: each throws OwnTemplateRefusal own_template_not_built.
 */
import type { ProjectDocument } from './schema.ts';
import type { TemplateDef, TEMPLATE_GENRES } from './templateContract.ts';
import { ownTemplateNotBuilt, type OwnSchematic, type OwnTemplateReport } from './ownTemplateContract.ts';

export interface CaptureOptions {
  /** The name the owner typed (kept as typed; the deny check on it is a warning, ownTemplateScan.ts). */
  name: string;
  genre: (typeof TEMPLATE_GENRES)[number];
  lang: 'he' | 'en';
  /** «להשאיר את הטקסט»: the titles' own words, person tokens removed, live tokens of FIELD_NAMES only (C2a). */
  keepWords: boolean;
}
/**
 * Throws OwnTemplateRefusal: nothing_to_save, too_many_slots, too_many_operations (C8, counted with ownTemplateOpCount),
 * own_template_too_large. The id is tpl.own- + the first 12 hex of sha256 of the canonical def without id and name.
 * report.clips holds every clip of the main sequence exactly once (partitionProblems, C6).
 */
export function captureOwnTemplate(doc: ProjectDocument, opts: CaptureOptions): { def: TemplateDef; report: OwnTemplateReport } {
  void doc; void opts;
  throw ownTemplateNotBuilt('capture');
}
/** The drawn strip of an own definition (integers only; never a picture). */
export function ownSchematic(def: TemplateDef): OwnSchematic {
  void def;
  throw ownTemplateNotBuilt('schematic');
}
