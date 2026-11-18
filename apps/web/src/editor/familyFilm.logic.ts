/**
 * Pure logic of the family film UI (ADR-0026): everything testable without a DOM — the dialog's choices and the parameters they
 * make, the plan rows, the window cycle and the pick edits («רגע אחר», «קליפ אחר», «הוצאה מהסרט», «הכנסה»), the reason,
 * exclusion and warning wording, the measure/plan state machine, the sprite tile of a source frame and the strip geometry.
 *
 * LEAD STUBS, final signatures. W3 owns the bodies and familyFilm.logic.test.ts. Until then each refuses; nothing is shown.
 * Rules the bodies follow (contracts and the verifier's corrections):
 * - Frame to time only through core sourceTimeOfFrame / sourceFrameOfTime; numbers and timecodes are shown LTR in <bdi>.
 * - «הכנסה» = picks.include (or removal from exclude); «קליפ אחר» = exclude the current asset and include the chosen one; a
 *   too_short exclusion offers no «הכנסה». More than MAX_FILM_ASSETS chosen: the next step is disabled with a Hebrew message
 *   that names the limit.
 * - The state machine measures each asset at most once per dialog session; a skipped, failed or canceled asset is planned as
 *   «לא נמדד» (it is not measured again), so plan → measure → plan always ends. A refusal (403, 409 film_blocked, 501) ends in
 *   'refused' with its code; a stale revision on apply plans again.
 * - Without music the 'under' option reads «הקול המקורי בעוצמה מלאה»; the row thumbnail is the nearest sprite tile and may be
 *   off the chosen moment (said so in the row's title).
 */
import { MOMENTS_MAX_ASSETS, type FamilyFilmParams, type FamilyFilmPlanView, type FilmExclusion, type FilmReason, type FilmWarning, type MomentsData, type ProjectDocument } from '@pulseframe/core';
import type { FilmSource } from './store.ts';

/** The most files a film is made from (core MOMENTS_MAX_ASSETS). */
export const MAX_FILM_ASSETS = MOMENTS_MAX_ASSETS;
/** The JobRow updates at most this often (ms). */
export const FILM_PROGRESS_EVERY_MS = 500;

/** What the dialog's three steps hold. */
export interface FilmChoices {
  assetIds: string[]; event: FamilyFilmParams['event'];
  targetSeconds: 30 | 60 | 90; musicAssetId: string | null;
  ownSound: 'under' | 'lead' | 'mute'; order: 'capture' | 'given' | 'arc';
  openingText?: string;
  picks: { exclude: string[]; include: string[]; window: Record<string, number> };
  lang: 'he' | 'en';
}
/** The dialog's first choices for a source: everything chosen, 60 s, capture order, own sound under the music, no music picked yet. */
export function defaultChoices(source: FilmSource, lang: 'he' | 'en'): FilmChoices {
  void source; void lang;
  throw new Error('defaultChoices: not built yet (family film W3)');
}
/** The parameters of the plan and apply calls (FamilyFilmParamsSchema accepts them; ids keep their order). */
export function buildParams(c: FilmChoices): FamilyFilmParams {
  void c;
  throw new Error('buildParams: not built yet (family film W3)');
}
/** The choices a run's parameters stand for (the bar's «אורך אחר» and FilmWhy after a reload); buildParams(choicesOf(p)) equals p up to defaults. */
export function choicesOf(params: FamilyFilmParams): FilmChoices {
  void params;
  throw new Error('choicesOf: not built yet (family film W3)');
}

/** One row of «התוכנית», in film order. */
export interface FilmPlanRow {
  key: string; assetId: string; name: string; order: number;
  /** capture wall clock or null; seconds of the slot on the project's rate; span words («2 תיבות») or null next to a kept clip */
  captureAt: string | null; seconds: number; span: string | null;
  reasons: FilmReason[]; windowIndex: number | null; windowsAvailable: number;
  canSwapWindow: boolean; still: boolean;
}
export function planRows(view: FamilyFilmPlanView, doc: ProjectDocument, lang: 'he' | 'en'): FilmPlanRow[] {
  void view; void doc; void lang;
  throw new Error('planRows: not built yet (family film W3)');
}

// ---------- the pick edits (each returns new params; the dialog plans again) ----------
/** The next candidate window, wrapping over windowsAvailable; null when there is no other. */
export function nextWindow(current: number | null, available: number): number | null {
  void current; void available;
  throw new Error('nextWindow: not built yet (family film W3)');
}
export function withNextWindow(params: FamilyFilmParams, assetId: string, current: number | null, available: number): FamilyFilmParams {
  void params; void assetId; void current; void available;
  throw new Error('withNextWindow: not built yet (family film W3)');
}
export function withOtherClip(params: FamilyFilmParams, fromAssetId: string, toAssetId: string): FamilyFilmParams {
  void params; void fromAssetId; void toAssetId;
  throw new Error('withOtherClip: not built yet (family film W3)');
}
export function withRemoved(params: FamilyFilmParams, assetId: string): FamilyFilmParams {
  void params; void assetId;
  throw new Error('withRemoved: not built yet (family film W3)');
}
/** «הכנסה»; null for an exclusion that cannot be brought back (too_short, no_picture). */
export function withIncluded(params: FamilyFilmParams, exclusion: FilmExclusion): FamilyFilmParams | null {
  void params; void exclusion;
  throw new Error('withIncluded: not built yet (family film W3)');
}

// ---------- wording (from familyFilm.strings.ts) ----------
/** «תנועה בתוך התמונה בשניות 4–7», «פרץ קול בשנייה 5.2», «קול חזק מהרגיל בקליפ (+9 dB)», «לא נמדד: נבחר אמצע הקליפ». */
export function reasonText(reason: FilmReason, lang: 'he' | 'en'): string {
  void reason; void lang;
  throw new Error('reasonText: not built yet (family film W3)');
}
export function exclusionText(e: FilmExclusion, lang: 'he' | 'en'): string {
  void e; void lang;
  throw new Error('exclusionText: not built yet (family film W3)');
}
export function warningText(w: FilmWarning, lang: 'he' | 'en'): string {
  void w; void lang;
  throw new Error('warningText: not built yet (family film W3)');
}

// ---------- the measure / plan state machine ----------
export type FilmFlowState =
  | { phase: 'idle' }
  | { phase: 'planning'; measured: readonly string[] }
  | { phase: 'measuring'; jobId: string | null; done: number; total: number; measured: readonly string[] }
  | { phase: 'ready'; view: FamilyFilmPlanView; measured: readonly string[] }
  | { phase: 'applying'; view: FamilyFilmPlanView; measured: readonly string[] }
  | { phase: 'refused'; code: string; message: string; measured: readonly string[] };
export type FilmFlowEvent =
  | { type: 'enter-plan' } | { type: 'params-changed' }
  | { type: 'planned'; view: FamilyFilmPlanView }
  | { type: 'measure-started'; jobId: string; total: number } | { type: 'measure-cached' }
  | { type: 'measure-progress'; done: number; total: number }
  | { type: 'measure-finished'; ok: boolean } | { type: 'measure-canceled' }
  | { type: 'apply' } | { type: 'applied' }
  | { type: 'refused'; status: number; code: string; message: string };
/** What the dialog does next: ask for a plan, start a measurement of these files, cancel a job, apply, or nothing. */
export type FilmFlowEffect = { kind: 'plan' } | { kind: 'measure'; assetIds: string[] } | { kind: 'cancel'; jobId: string } | { kind: 'apply'; revision: number } | { kind: 'close' } | null;
export function filmFlow(state: FilmFlowState, event: FilmFlowEvent): { state: FilmFlowState; effect: FilmFlowEffect } {
  void state; void event;
  throw new Error('filmFlow: not built yet (family film W3)');
}

// ---------- pictures ----------
/** The thumbnail sprite tile nearest a source frame (the sprite holds at most 60 tiles per file: derive.ts). */
export function spriteTileIndex(sourceFrame: number, frames: number, tiles: number): number {
  void sourceFrame; void frames; void tiles;
  throw new Error('spriteTileIndex: not built yet (family film W3)');
}
/** The strip of measured motion and sound (MomentsStrip): two polyline paths and the chosen window, in a width x height box, left to right in time. */
export interface StripGeometry { inner: string; level: string; window: { x: number; width: number; peakX: number } | null }
export function stripGeometry(data: MomentsData, window: { fromFrame: number; toFrame: number; peakFrame: number } | null, width: number, height: number): StripGeometry {
  void data; void window; void width; void height;
  throw new Error('stripGeometry: not built yet (family film W3)');
}
