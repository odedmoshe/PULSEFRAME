/**
 * The privacy scan of an own definition (wave 8 owntemplate; plan 3.7 with verifier C2f): a second, independent net after the
 * whitelist. Allow-list over every string leaf but `name` (and the kept words): the id, item keys (OWN_KEY.pattern), registry ids,
 * enum members of effect params, #RRGGBB colours, the fixed words of ownTemplate.strings.ts. Deny cross-check (with `doc`) only on
 * the free-text leaves (`name`, and the kept words): asset ids, names and stems (>= 3 characters), the project name, people names,
 * title / caption / transcript words (>= 3 letters), the ISO and d.m.y date shapes (the Hebrew-date pattern is CUT). On `name` a
 * finding is a warning; on kept words it is a list in the dialog; elsewhere any finding refuses the save (fail closed, path only).
 * STUB until BUILDER W1.
 */
import type { ProjectDocument } from './schema.ts';
import type { TemplateDef } from './templateContract.ts';
import { ownTemplateNotBuilt, type OwnScanFinding } from './ownTemplateContract.ts';

export interface OwnScanResult { ok: boolean; findings: OwnScanFinding[]; /** Words of the film found in the name (warnings, owner only). */ nameWarnings: string[]; /** Words of the film found in kept words (the dialog's list). */ keptWordMatches: string[] }
export function scanOwnTemplate(def: TemplateDef, o: { keepWords: boolean }, doc?: ProjectDocument): OwnScanResult {
  void def; void o; void doc;
  throw ownTemplateNotBuilt('scan');
}
