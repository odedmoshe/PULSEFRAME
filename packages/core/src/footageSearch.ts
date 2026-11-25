/**
 * «חיפוש בצילומים» — the pure functions (wave 7 search track; .artifacts/wave7/search-decisions.md §4). BUILDER A owns this file; the
 * signatures are the lead's. Until built every function throws FootageSearchNotBuilt: never a made-up value.
 *
 * RULES OF THE BODIES
 * - Integer and string operations only; no Intl, no localeCompare, no locale, no float time: the editor (Chromium) and the server
 *   (Node) give byte-identical answers (proof S3). Times are exact rationals from @pulseframe/time.
 * - Text keys through core searchKey (librarySearch.ts, shared with the library track; NFKD, points dropped, final letters as
 *   regular). footageQueryForms adds this track's prefix rule: the token, and the token without up to two leading letters of
 *   ו ה ב ל מ ש כ while at least two letters remain («בנרות» → «נרות»). A HEURISTIC, labelled as one.
 * - AND semantics: every non-date token prefix-matches a word of the item, of its file's name or of its file's event name (and, for
 *   the owner, a pearl's name or a tagged person's name); every date token matches its file's capture date (year, Gregorian or
 *   Hebrew month, Hebrew year, holiday family through capture.ts and hebrewCalendar.ts).
 * - reader 'agent' NEVER reads a pearl's label, a range's people or a person at all (decisions §2: fail-closed whatever the grant);
 *   the server also hands it the reader document. reader 'owner' reads them.
 * - Transcript hits carry the exact rational span of the words (first word start to last word end), followed to copies with
 *   lineage transcriptFor. Pearl hits carry the pearl's span; other hits are whole files (start/end null).
 * - Order: spans before whole files, then capture time, then name (code-point order), then start, ties by asset id.
 */
import type { ProjectDocument } from './schema.ts';
import { FootageSearchNotBuilt, type Moment } from './footageSearchContract.ts';

/** True once builder A has built the functions of this file. */
export const FOOTAGE_SEARCH_BUILT = false;

/** The forms a query token is matched by (searchKey'd token first; heuristic prefix forms after). */
export function footageQueryForms(token: string): string[] {
  void token;
  throw new FootageSearchNotBuilt('footageQueryForms');
}

/** A query split into date tokens (years, months, Hebrew years, holiday families) and word tokens (each with its forms). */
export interface ParsedFootageQuery {
  words: { token: string; forms: string[] }[];
  dates: ({ kind: 'year'; year: number } | { kind: 'month'; month: number } | { kind: 'hebrewYear'; year: number } | { kind: 'hebrewMonth'; month: number } | { kind: 'holiday'; family: string })[];
}
export function parseFootageQuery(query: string): ParsedFootageQuery {
  void query;
  throw new FootageSearchNotBuilt('parseFootageQuery');
}

export interface FootageSearchOptions {
  /** who the answer is for: 'agent' never reads pearl names, tags or people */
  reader: 'owner' | 'agent';
  /** moments at most (FOOTAGE_LIMITS.defaultResults when absent) */
  limit?: number;
}
/** The no-model section of an answer, on the document the caller may read. An empty list is an honest "nothing found". */
export function searchFootage(doc: ProjectDocument, query: string, opts: FootageSearchOptions): Moment[] {
  void doc; void query; void opts;
  throw new FootageSearchNotBuilt('searchFootage');
}

/** The source frame indices sampled from a video: k_s = ceil(s · rate) for s = 0, 1, 2, … while k_s < frameCount (exact). */
export function sampleFrameTargets(rate: { num: number; den: number }, frameCount: number): number[] {
  void rate; void frameCount;
  throw new FootageSearchNotBuilt('sampleFrameTargets');
}

/** int8 quantisation of a unit vector: scale = max|v| / 127, q = round half away from zero of v / scale (written out, not Math.round). */
export function quantiseInt8(v: Float32Array): { scale: number; q: Int8Array } {
  void v;
  throw new FootageSearchNotBuilt('quantiseInt8');
}
/** The integer dot product of two int8 vectors of the same length (exact in a JS number for 768 dims). */
export function int8Dot(a: Int8Array, b: Int8Array): number {
  void a; void b;
  throw new FootageSearchNotBuilt('int8Dot');
}

/** A scored frame of the picture index (relevance = the model's own sigmoid, already above PICTURE_MIN_RELEVANCE). */
export interface PictureHit { assetId: string; frame: number; relevance: number }
/**
 * Moments from scored frames: the best FOOTAGE_LIMITS.topFrames; frames of one file closer than mergeGapSeconds merged; span =
 * [first − pad, last + pad] clamped to [0, duration] and snapped OUTWARD to project frames of `projectRate`; `frame` = the best frame;
 * at most `limit` by best relevance, ties by (assetId, start). sources ['picture'].
 */
export function mergePictureHits(doc: ProjectDocument, hits: readonly PictureHit[], projectRate: { num: number; den: number }, limit: number): Moment[] {
  void doc; void hits; void projectRate; void limit;
  throw new FootageSearchNotBuilt('mergePictureHits');
}
