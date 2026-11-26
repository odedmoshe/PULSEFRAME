/**
 * «שמירת הסרט כתבנית» — saving a film the owner edited as a template, with its rhythm (wave 8 owntemplate;
 * .artifacts/wave8/owntemplate-plan.md, owntemplate-verify.md C1–C12, decisions.md "Batch C … owntemplate"). LEAD PRE-PASS contract.
 *
 * What it is: a pure capture (ownTemplate.ts) reads the main sequence as it is now and builds a TemplateDef by WHITELIST
 * (ownTemplateKeys.ts: every key of the clip, title, effect, transition and track schemas is classified kept or not kept, and a new
 * key fails the test until classified). The definition is stored in the owner's machine file `<dataDir>/own-templates.json`
 * (apps/server/src/ownTemplates.ts), never in a project; it is applied through the EXISTING internal op apply_template like any
 * template, so no new op, no document field and no schema version. Not an op: saving or deleting changes no project.
 *
 * The rules this contract fixes (each is a verifier correction):
 * - Owner's own session only to preview, save or delete (403 owner_required); agents may list and apply in edit mode; the words of
 *   a template saved with «להשאיר את הטקסט» reach only the owner's own session (ownSummaryForReader, C2h).
 * - Preview and save both carry expectedRevision; save captures again and answers 409 stale_revision when the project moved; the
 *   «מה נשמר» counts are computed from the saved definition itself; every clip of the main sequence lands in exactly one of kept /
 *   not kept (partitionProblems, C6).
 * - The ops the definition would emit are counted at save: 409 too_many_operations with the numbers (C8).
 * - The id prefix tpl.own- is reserved; a missing own template answers 404 «התבנית הזו לא שמורה במחשב הזה…» (C10).
 * - Times only through the exact-time functions (C12); the first picture starts at the anchor and the music is shifted (C3).
 * CUT in version 1 (never stubbed): camera-move recognition (reported camera_move), title effects and motion (title_effects,
 * title_motion), graphic elements and sound effects (element, sfx), rename, the Hebrew-date deny pattern, the transition seed
 * (transition_seed), export / import of a template file.
 */
import { z } from 'zod';
import { TEMPLATE_GENRES, type TemplateSummary } from './templateContract.ts';
import type { ProjectDocument } from './schema.ts';

/** False until the builders land: every new route answers 501 own_template_not_built after the owner check; the planner refuses an own definition. */
export const OWN_TEMPLATE_BUILT: boolean = false;

// ---------- limits ----------
export const OWN_TEMPLATE_STORE = {
  /** In the data directory; backed up by backup.ts (step 3b, copied every time; C1); never in a project or an archive. */
  file: 'own-templates.json',
  /** Templates the file holds (the 51st save: 409 too_many_templates). */
  templates: 50,
  /** Bytes of one stored entry (canonical JSON of its def). */
  entryBytes: 256 * 1024,
} as const;

// ---------- refusals (English is the API's; the Hebrew, each with the next step, is packages/i18n/src/owntemplate.ts HE_OWNTEMPLATE) ----------
interface Refusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): Refusal<A> => ({ status, code, message, hint });
export const OWN_TEMPLATE_REFUSALS = {
  ownerRequired: r(403, 'owner_required', () => 'only the owner of this computer can save templates from their films', 'Open the editor from the owner link (start-pulseframe.cmd prints it) and save the template there.'),
  notBuilt: r(501, 'own_template_not_built', (part: string) => `saving a film as a template is not built in this build yet (${part})`, 'Nothing to do now; it comes with a later build.'),
  nothingToSave: r(409, 'nothing_to_save', () => 'there are no shots to save: add pictures or videos to the picture track', 'Add pictures or videos to the picture track of the main sequence, then save again.'),
  tooManySlots: r(409, 'too_many_slots', (n: number, max: number) => `the film has ${n} shots; a template holds at most ${max}`, 'Save a shorter film, or join some shots first.'),
  tooManyTemplates: r(409, 'too_many_templates', (max: number) => `${max} templates are saved already; delete one first`, 'Delete a template you no longer use from «התבניות שלכם», then save again.'),
  alreadySaved: r(409, 'already_saved', (name: string) => `this template is already saved as “${name}”`, 'Nothing to do: the saved template is in «התבניות שלכם».'),
  tooManyOperations: r(409, 'too_many_operations', (ops: number, max: number) => `this template would need ${ops} operations to apply; at most ${max} fit in one step`, 'Save a film with fewer shots, titles or effects.'),
  entryTooLarge: r(409, 'own_template_too_large', (bytes: number, max: number) => `this template would take ${bytes} bytes; at most ${max} are kept for one template`, 'Save a film with fewer shots or titles.'),
  staleRevision: r(409, 'stale_revision', (expected: number, now: number) => `the project changed since the preview (revision ${expected}, now ${now})`, 'Look at the lists again (they were made anew) and save again.'),
  privacyScanFailed: r(500, 'privacy_scan_failed', (path: string) => `the template was not saved: it holds a field it must not (${path}); this is our fault, not yours`, 'Nothing was saved. Report the path shown; the rest of the film is unchanged.'),
  notOnThisComputer: r(404, 'not_found', (templateId: string) => `the template "${templateId}" is not saved on this computer; undo still works and every clip stays editable`, 'Undo still works and every clip stays editable.'),
} as const;
export type OwnTemplateRefusalKey = keyof typeof OWN_TEMPLATE_REFUSALS;
export class OwnTemplateRefusal extends Error {
  constructor(public status: number, public code: string, message: string, public hint: string, public details: Record<string, unknown> = {}) { super(message); }
}
export function ownTemplateRefusal<K extends OwnTemplateRefusalKey>(key: K, ...args: Parameters<(typeof OWN_TEMPLATE_REFUSALS)[K]['message']>): OwnTemplateRefusal {
  const x = OWN_TEMPLATE_REFUSALS[key] as Refusal<unknown[]>;
  return new OwnTemplateRefusal(x.status, x.code, x.message(...args), x.hint, { refusal: key });
}
/** The typed not-built refusal every stub throws (`part` names the stub: capture, scan, schematic, plan, timeAt, opCount, store, gallery). */
export const ownTemplateNotBuilt = (part: string): OwnTemplateRefusal => ownTemplateRefusal('notBuilt', part);

// ---------- what is kept and what is not (the report; words in i18n owntemplate.kept.* / owntemplate.notKept.*) ----------
/** What a definition carries, counted from the saved def itself (C6). */
export const OWN_KEPT_KINDS = ['shots', 'titles', 'looks', 'transitions', 'shot_effects', 'music_style', 'title_words'] as const;
export type OwnKeptKind = (typeof OWN_KEPT_KINDS)[number];
/**
 * Every reason something of the film is not in the template (plan §2 and 3.6, verifier C2, C5, C9, C13, the cut list). Each shows
 * in «מה לא נשמר» with its count and times. `gap_closed`, `title_place`, `font_family`, `cut_rounded`, `outside_beats` and `cuts_close`
 * are changes made while keeping something; every other code means the thing was left out.
 */
export const OWN_NOT_KEPT_CODES = [
  // pictures and their placement
  'gap_closed', 'transform', 'camera_move', 'blend', 'follow', 'source_window', 'speed', 'freeze', 'reverse', 'mask', 'redact', 'multicam', 'stabilise', 'impact', 'depth', 'subject', 'other_pictures', 'drawn',
  // effects and transitions
  'lut', 'effect_text_param', 'effect_keyframes', 'effect_modulate', 'effect_disabled', 'curves', 'transition_seed',
  // titles
  'person_field', 'credits_card', 'title_effects', 'title_motion', 'title_transform', 'title_place', 'font_family', 'behind', 'captions', 'caption_style',
  // looks
  'opacity_keys', 'look_mask',
  // sound
  'own_sound', 'music_file', 'recorded_music', 'element', 'sfx',
  // rhythm
  'cuts_close', 'cut_rounded', 'outside_beats',
  // the rest of the project
  'other_sequences',
] as const;
export type OwnNotKeptCode = (typeof OWN_NOT_KEPT_CODES)[number];
/** Why a film is saved in frames instead of beats (plan 3.6 step 2). */
export const OWN_AXIS_REASONS = ['music_none', 'music_many', 'music_speed'] as const;
export interface OwnNotKeptRow { code: OwnNotKeptCode; count: number; /** Timeline frames of the main sequence where it is (at most 20, ascending). */ atFrames: number[] }
/** Where each clip of the main sequence went: exactly one entry per clip id (partitionProblems). */
export type OwnClipVerdict = { clipId: string; kept: true; as: 'slot' | 'title' | 'look'; key: string } | { clipId: string; kept: false; code: OwnNotKeptCode };
export interface OwnTemplateReport {
  kept: { kind: OwnKeptKind; count: number }[];
  notKept: OwnNotKeptRow[];
  clips: OwnClipVerdict[];
  axis: 'beats' | 'frames'; axisReason: (typeof OWN_AXIS_REASONS)[number] | null;
  /** Cuts of the film closer than the flash gap (C5): the dialog never promises "the same cuts" for them. */
  cutsClose: { atFrames: number[]; gapFrames: number } | null;
  /** The ops the definition would emit on a plan of its own media count, and the most one step holds (C8). */
  operations: { count: number; max: number };
}
/**
 * The problems of a report against the document it was made from (C6): every clip id of the main sequence appears exactly once in
 * `clips`, nothing else appears, and every kept verdict is counted. [] = the partition holds. Complete in the pre-pass.
 */
export function partitionProblems(doc: ProjectDocument, report: Pick<OwnTemplateReport, 'clips'>): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const t of doc.sequences[doc.mainSequenceId]?.tracks ?? []) for (const c of t.clips) ids.add(c.id);
  const seen = new Map<string, number>();
  for (const v of report.clips) seen.set(v.clipId, (seen.get(v.clipId) ?? 0) + 1);
  for (const id of ids) { const n = seen.get(id) ?? 0; if (n !== 1) out.push(`clip ${id} appears ${n} times`); }
  for (const id of seen.keys()) if (!ids.has(id)) out.push(`clip ${id} is not on the main sequence`);
  return out;
}

// ---------- the drawn strip (never a picture of the family) ----------
export interface OwnSchematic {
  unit: 'ticks' | 'frames'; meter: number; lead: number;
  slots: { len: number; accept: 'video' | 'image' | 'any' }[];
  texts: { from: number; to: number }[];
  looks: { from: number; to: number }[];
}
/** TemplateSummary.own for an own template (the gallery and the dialog draw the strip from it; integers only). */
export interface OwnSummaryInfo { madeFrom: 'own-film'; axis: 'beats' | 'frames'; bpm: number | null; schematic: OwnSchematic; keptWords: boolean }
/** An own template's gallery entry: a TemplateSummary with `own`. */
export type OwnTemplateSummary = TemplateSummary & { own: OwnSummaryInfo };

// ---------- wire types of the routes ----------
const Name = z.string().trim().min(1).max(60).regex(/^[^\n\r]*$/);
export const OwnTemplatePreviewBodySchema = z.object({
  lang: z.enum(['he', 'en']),
  /** «להשאיר את הטקסט»: off by default; the words are then in the owner's own file only. */
  keepWords: z.boolean().default(false),
  name: Name.optional(),
  genre: z.enum(TEMPLATE_GENRES).optional(),
  /** The revision the dialog shows; the answer is made against the project as it is and says its revision (C6). */
  expectedRevision: z.number().int().min(0),
}).strict();
export type OwnTemplatePreviewBody = z.infer<typeof OwnTemplatePreviewBodySchema>;
export const OwnTemplateSaveBodySchema = OwnTemplatePreviewBodySchema.extend({ name: Name, genre: z.enum(TEMPLATE_GENRES) }).strict();
export type OwnTemplateSaveBody = z.infer<typeof OwnTemplateSaveBodySchema>;
export interface OwnScanFinding { /** JSON path, never the value. */ path: string; rule: 'not_allowed' | 'matches_document' }
export interface OwnTemplatePreviewAnswer {
  revision: number;
  summary: OwnTemplateSummary;
  report: OwnTemplateReport;
  scan: { ok: boolean; findings: OwnScanFinding[] };
  /** The deny check on the typed name (a warning, never a refusal): words of the film found in it. Owner's own session only. */
  nameWarnings: string[];
}
export interface OwnTemplateSaveAnswer { revision: number; templateId: string; summary: OwnTemplateSummary; report: OwnTemplateReport }
export interface OwnTemplateDeleteAnswer { templateId: string; deleted: true }
/** The store file (apps/server/src/ownTemplates.ts): insertion order, no timestamps (a save date is a family date). */
export const OwnTemplatesFileSchema = z.object({ version: z.literal(1), templates: z.array(z.object({ def: z.unknown() }).strict()).max(OWN_TEMPLATE_STORE.templates) }).strict();
export type OwnTemplatesFile = z.infer<typeof OwnTemplatesFileSchema>;
/**
 * The routes (apps/server/src/ownTemplates.ts; openapi.ts documents each with x-owner-session-only; peopleSurfaces.ts 'owner-only').
 * Rename is cut. No MCP tool: agents reach own templates through GET /api/v1/templates and plan_template / apply_template /
 * regenerate_template (edit mode), like any template.
 */
export const OWN_TEMPLATE_ROUTES = [
  { method: 'POST', path: '/api/v1/projects/:id/own-templates/preview' },
  { method: 'POST', path: '/api/v1/projects/:id/own-templates' },
  { method: 'DELETE', path: '/api/v1/own-templates/:templateId' },
] as const;

// ---------- readers of the gallery (C2h) ----------
/**
 * The gallery entry of an own template as `reader` may see it. For the owner's own session: unchanged. For every other reader (every
 * agent, observer or grant, whatever its project): when the template kept the words (own.keptWords), each text's `default` becomes
 * its role placeholder (ownTemplate.strings.ts placeholders); the name stays (names only, the brief's rule). STUB until W2.
 */
export function ownSummaryForReader(summary: OwnTemplateSummary, reader: { ownerSession: boolean }): OwnTemplateSummary {
  void summary; void reader;
  throw ownTemplateNotBuilt('gallery');
}
