/**
 * «מה יש בקליפ» — the pure functions (wave 8 `understand`; contract in understandContract.ts). LEAD PRE-PASS: signatures with stubs
 * that throw UnderstandNotBuilt (routes answer 501). BUILDER W1 (opus) owns this file and writes the bodies (plan §3.3 as corrected
 * by understand-verify.md C2, C5, C9, C10, C12). Integer and string operations only (like footageSearch.ts); same output in Node and
 * Chromium (a parity test for understandSpans and searchNotes, never for producerId: C13).
 */
import type * as T from '@pulseframe/time';
import type { Moment } from './footageSearchContract.ts';
import type { ProjectDocument } from './schema.ts';
import { UnderstandNotBuilt, type AssetUnderstandState, type FootageNotesData, type NotesPage, type NotesPointer, type NotesQuery, type ShotsPage, type ShotsQuery, type SpanPlan } from './understandContract.ts';

/**
 * Spans of a file (C5): shots are [0,c1),[c1,c2),…,[ck,frameCount) on CUT FRAMES (sourceFrameOfTime of the stored cut times, C2);
 * consecutive shots shorter than minSpanSeconds·rate frames are joined into one span that keeps the first and last shot index;
 * a (joined) shot of L frames with D = ceil(density·rate) is cut into n = ceil(L/D) spans of near-equal integer length (the first
 * L mod n one frame longer); `framesPerSpan` keys evenly inside each span (1 = the middle: start + floor((end−start)/2)), ascending,
 * distinct. A photo (rate null) is one span [0,1), key 0. Capped at maxSpansPerFile: density doubles until it fits; `truncated` only
 * if 30 s still does not fit.
 */
export function understandSpans(_cutFrames: readonly number[], _frameCount: number, _rate: { num: number; den: number } | null, _opts: { densitySeconds: number; minSpanSeconds: number; framesPerSpan: number }): { spans: SpanPlan[]; truncated: boolean } {
  throw new UnderstandNotBuilt('understandSpans');
}
/** 'sha256:' + sha256 of the cut frames joined by ',' (ascending). Pure; the hash is computed with sha256.ts sha256Hex. */
export function cutsDigest(_cutFrames: readonly number[]): string {
  throw new UnderstandNotBuilt('cutsDigest');
}
/** The notes pointer that applies to an asset: its own, or the nearest time-preserving source's (timeLineage, as sceneCutsFor), with the lineage offset. */
export function notesFor(_doc: ProjectDocument, _assetId: string): { pointer: NotesPointer; assetId: string; offset: T.RationalTime } | null {
  throw new UnderstandNotBuilt('notesFor');
}
/**
 * The search section «לפי מה שתואר» (plan §3.3 + C9): the tokens and AND semantics of searchFootage; every non-date token must match a
 * word form (footageQueryForms) of the span's captions (he+en), tags, on-screen text, or the file's name or event; a YEAR token matches
 * the capture date OR a whole on-screen word (so «2025» on screen is found, decision 6). Sources: `seen` when a caption/tag word matched,
 * `onscreen` when an on-screen word did. Times exact (sourceTimeOfFrame); snippet = the caption in `lang` (≤ snippetChars); `by` = the
 * model. Moments of one span merge; order as searchFootage; no score. `notes` is keyed by asset id (the pointer's data, read by the server).
 */
export function searchNotes(_doc: ProjectDocument, _notes: ReadonlyMap<string, FootageNotesData>, _query: string, _opts: { lang: 'he' | 'en'; limit: number }): Moment[] {
  throw new UnderstandNotBuilt('searchNotes');
}
/** One page of an asset's notes (describe_clip and GET …/notes; C10): source frames, ONE caption language, said only with withSaid, ended early at pageBytes with `next`. */
export function notesPage(_doc: ProjectDocument, _assetId: string, _data: FootageNotesData | null, _q: NotesQuery & { defaultLang: 'he' | 'en' }): NotesPage {
  throw new UnderstandNotBuilt('notesPage');
}
/** One page of an asset's shots (get_shots; C10): each shot with its first caption (≤ shotCaptionChars) when notes exist. */
export function shotsPage(_doc: ProjectDocument, _assetId: string, _data: FootageNotesData | null, _q: ShotsQuery): ShotsPage {
  throw new UnderstandNotBuilt('shotsPage');
}
/** The computed state of an asset (understandContract ASSET_UNDERSTAND_STATES). `currentProducer` null = no describer; `describing` = a job holds it now. */
export function understandStateOf(_doc: ProjectDocument, _assetId: string, _data: FootageNotesData | null, _currentProducer: string | null, _describing: boolean): AssetUnderstandState {
  throw new UnderstandNotBuilt('understandStateOf');
}
