/**
 * Pure logic of the family film UI (ADR-0026): everything testable without a DOM — the dialog's choices and the parameters they
 * make, the plan rows, the window cycle and the pick edits («רגע אחר», «קליפ אחר», «הוצאה מהסרט», «הכנסה»), the reason,
 * exclusion and warning wording, the measure/plan state machine, the measurement poller, the sprite tile of a source frame, the
 * strip geometry, and the document-side helpers of the film bar and the inspector's «למה» (runs, slots, reasons now, swaps).
 *
 * Rules:
 * - Frame to time only through core sourceTimeOfFrame / sourceFrameOfTime; numbers and timecodes are shown LTR in <bdi>.
 * - «הכנסה» = picks.include (or removal from exclude); «קליפ אחר» = exclude the current asset and include the chosen one; a
 *   too_short / no_picture / kept_by_hand exclusion offers no «הכנסה». More than MAX_FILM_ASSETS chosen: the next step is disabled.
 * - The state machine measures each asset at most once per dialog session; a skipped, failed or canceled asset is planned as
 *   «לא נמדד» (it is not measured again), so plan → measure → plan always ends.
 * - Faces are not used (no approved model); every choice is explained and labelled heuristic (familyFilm.strings.ts).
 */
import * as T from '@pulseframe/time';
import {
  FAMILY_FILM_RUN_RECIPE_ID, FILM_DEFAULTS, MOMENTS_MAX_ASSETS, MOMENTS_MAX_WINDOWS, filmReasonsFor, filmRunParams, filmRunPicked, fingerprint, findClip, sourceFrameOfTime, sourceTimeOfFrame, toSourceSpan, videoFrames,
  type Asset, type FamilyFilmParams, type FamilyFilmPlanView, type FilmExclusion, type FilmMomentsRecord, type FilmPick, type FilmPicked, type FilmReason, type FilmWarning, type MediaClip, type MomentsData, type OpCall, type ProjectDocument, type RecipeRun, type SlotRecord, type StartMomentsBody,
} from '@pulseframe/core';
import { ApiFailure, type RevisionEvent } from '../api.ts';
import type { FilmSource } from './store.ts';
import { familyFilmStrings } from './familyFilm.strings.ts';
import { templateRefusal } from './templateRefusals.ts';

type Lang = 'he' | 'en';
/** The most files a film is made from (core MOMENTS_MAX_ASSETS). */
export const MAX_FILM_ASSETS = MOMENTS_MAX_ASSETS;
/** The JobRow updates at most this often (ms). */
export const FILM_PROGRESS_EVERY_MS = 500;
export const FILM_LENGTHS = [30, 60, 90] as const;

/** What the dialog's three steps hold. */
export interface FilmChoices {
  assetIds: string[]; event: FamilyFilmParams['event'];
  targetSeconds: 30 | 60 | 90; musicAssetId: string | null;
  ownSound: 'under' | 'lead' | 'mute'; order: 'capture' | 'given' | 'arc';
  openingText?: string;
  picks: { exclude: string[]; include: string[]; window: Record<string, number> };
  lang: Lang;
}
/** The dialog's first choices for a source: everything chosen, 60 s, capture order, own sound under the music, no music picked yet. */
export function defaultChoices(source: FilmSource, lang: Lang): FilmChoices {
  return {
    assetIds: [...new Set(source.assetIds)], event: source.event ?? null, targetSeconds: FILM_DEFAULTS.targetSeconds, musicAssetId: null,
    ownSound: FILM_DEFAULTS.ownSound, order: FILM_DEFAULTS.order, picks: { exclude: [], include: [], window: {} }, lang,
  };
}
const uniq = (l: readonly string[]) => [...new Set(l)];
/** A record with `id` set, built so an id like "__proto__" is an own property, never the prototype. */
const withKey = (rec: Readonly<Record<string, number>>, id: string, v: number): Record<string, number> => Object.fromEntries([...Object.entries(rec).filter(([k]) => k !== id), [id, v]]);
const withoutKey = (rec: Readonly<Record<string, number>>, id: string): Record<string, number> => Object.fromEntries(Object.entries(rec).filter(([k]) => k !== id));
/** The parameters of the plan and apply calls (FamilyFilmParamsSchema accepts them; ids keep their order). */
export function buildParams(c: FilmChoices): FamilyFilmParams {
  const exclude = uniq(c.picks.exclude), include = uniq(c.picks.include).filter((id) => !exclude.includes(id));
  const window = Object.fromEntries(Object.entries(c.picks.window).filter(([, v]) => Number.isInteger(v) && v >= 0 && v < MOMENTS_MAX_WINDOWS));
  const text = c.openingText?.trim();
  const picks = exclude.length || include.length || Object.keys(window).length ? { ...(exclude.length ? { exclude } : {}), ...(include.length ? { include } : {}), ...(Object.keys(window).length ? { window } : {}) } : undefined;
  return {
    assetIds: uniq(c.assetIds), ...(c.event ? { event: c.event } : {}), targetSeconds: c.targetSeconds,
    ...(c.musicAssetId ? { musicAssetId: c.musicAssetId } : {}), order: c.order, ownSound: c.ownSound, ...(text ? { openingText: text } : {}),
    ...(picks ? { picks } : {}), lang: c.lang,
  };
}
/** The choices a run's parameters stand for (the bar's «אורך אחר» and FilmWhy after a reload); buildParams(choicesOf(p)) equals p up to defaults. */
export function choicesOf(params: FamilyFilmParams): FilmChoices {
  return {
    assetIds: [...params.assetIds], event: params.event ?? null, targetSeconds: params.targetSeconds ?? FILM_DEFAULTS.targetSeconds, musicAssetId: params.musicAssetId ?? null,
    ownSound: params.ownSound ?? FILM_DEFAULTS.ownSound, order: params.order ?? FILM_DEFAULTS.order, ...(params.openingText ? { openingText: params.openingText } : {}),
    picks: { exclude: [...(params.picks?.exclude ?? [])], include: [...(params.picks?.include ?? [])], window: { ...(params.picks?.window ?? {}) } }, lang: params.lang ?? FILM_DEFAULTS.lang,
  };
}

// ---------- sources and library lists ----------
export const isPictureAsset = (a: Asset | undefined): a is Asset => !!a && a.kind !== 'lut' && a.kind !== 'audio' && (!!a.video || !!a.image);
/** The files the dialog opens with when the entry has no source: the pictures and videos of the selected clips, else the whole library. */
export function sourceFromSelection(doc: ProjectDocument, selection: readonly string[]): FilmSource {
  const ids: string[] = [];
  for (const id of selection) { const f = findClip(doc, id); if (f && f.clip.type === 'media' && isPictureAsset(doc.assets[f.clip.assetId]) && !ids.includes(f.clip.assetId)) ids.push(f.clip.assetId); }
  return { assetIds: ids.length ? ids : Object.values(doc.assets).filter(isPictureAsset).map((a) => a.id), event: null };
}
/** Sound files that can be the film's music (a video's own sound is not offered). */
export const musicChoices = (doc: ProjectDocument): Asset[] => Object.values(doc.assets).filter((a) => a.kind === 'audio' && !!a.audio);
export function beatInfo(doc: ProjectDocument, assetId: string): { measured: boolean; count: number; bpm: number | null } {
  const b = doc.analyses?.[assetId]?.beats;
  return b ? { measured: true, count: b.beats.length, bpm: b.bpm } : { measured: false, count: 0, bpm: null };
}
/** Seconds of the chosen videos (stills add nothing), for the count line. */
export const videoSeconds = (doc: ProjectDocument, ids: readonly string[]): number => ids.reduce((s, id) => { const a = doc.assets[id]; return a?.video && a.kind !== 'image' ? s + T.toSeconds(a.duration) : s; }, 0);
export const tooManyChosen = (c: Pick<FilmChoices, 'assetIds'>): boolean => c.assetIds.length > MAX_FILM_ASSETS;
/** Why the next step cannot be taken now, or null. */
export function nextBlocked(c: Pick<FilmChoices, 'assetIds'>, lang: Lang): string | null {
  const S = familyFilmStrings(lang);
  return c.assetIds.length === 0 ? S.nothingChosen : tooManyChosen(c) ? S.tooMany(MAX_FILM_ASSETS) : null;
}
export function formatDuration(seconds: number): string { const t = Math.max(0, Math.round(seconds)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
/** 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss' as «15.3.2024 · 17:30» (he) or «2024-03-15 17:30» (en); anything else as it is. */
export function formatCapture(wall: string | null, lang: Lang): string | null {
  if (!wall) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(wall);
  if (!m) return wall;
  const time = m[4] ? `${m[4]}:${m[5]}` : null;
  return lang === 'he' ? `${Number(m[3])}.${Number(m[2])}.${m[1]}${time ? ` · ${time}` : ''}` : `${m[1]}-${m[2]}-${m[3]}${time ? ` ${time}` : ''}`;
}

// ---------- plan rows ----------
/** One row of «התוכנית», in film order. */
export interface FilmPlanRow {
  key: string; assetId: string; name: string; order: number;
  /** capture wall clock or null; seconds of the slot on the project's rate; span words («2 תיבות») or null next to a kept clip */
  captureAt: string | null; seconds: number; span: string | null;
  reasons: FilmReason[]; windowIndex: number | null; windowsAvailable: number;
  canSwapWindow: boolean; still: boolean;
  sourceInFrame: number | null; sourceFrames: number | null;
}
export function planRows(view: FamilyFilmPlanView, doc: ProjectDocument, lang: Lang): FilmPlanRow[] {
  const S = familyFilmStrings(lang), rate = doc.settings.frameRate;
  return [...view.picks].sort((a, b) => a.startFrame - b.startFrame).map((p) => ({
    key: p.key, assetId: p.assetId, name: doc.assets[p.assetId]?.name ?? p.assetId, order: p.order, captureAt: p.captureAt,
    seconds: (p.frames * rate.den) / rate.num,
    span: p.span ? (p.span.unit === 'bar' ? S.spanBars(p.span.count) : S.spanBeats(p.span.count)) : null,
    reasons: p.reasons, windowIndex: p.windowIndex, windowsAvailable: p.windowsAvailable,
    canSwapWindow: p.kind !== 'still' && nextWindow(p.windowIndex, p.windowsAvailable) !== null, still: p.kind === 'still',
    sourceInFrame: p.sourceInFrame, sourceFrames: p.sourceFrames,
  }));
}
export const reasonLine = (reasons: readonly FilmReason[], lang: Lang): string => reasons.map((r) => reasonText(r, lang)).join(' · ');

// ---------- the pick edits (each returns new params; the dialog plans again) ----------
/** The next candidate window, wrapping over windowsAvailable; null when there is no other. */
export function nextWindow(current: number | null, available: number): number | null {
  if (!Number.isInteger(available) || available <= 0) return null;
  if (current === null) return 0;
  const next = (current + 1) % available;
  return next === current ? null : next;
}
const picksOf = (p: FamilyFilmParams) => ({ exclude: [...(p.picks?.exclude ?? [])], include: [...(p.picks?.include ?? [])], window: { ...(p.picks?.window ?? {}) } });
const withPicks = (p: FamilyFilmParams, picks: { exclude: string[]; include: string[]; window: Record<string, number> }): FamilyFilmParams => {
  const { picks: _old, ...rest } = p;
  const out = { ...(picks.exclude.length ? { exclude: picks.exclude } : {}), ...(picks.include.length ? { include: picks.include } : {}), ...(Object.keys(picks.window).length ? { window: picks.window } : {}) };
  return Object.keys(out).length ? { ...rest, picks: out } : rest;
};
export function withNextWindow(params: FamilyFilmParams, assetId: string, current: number | null, available: number): FamilyFilmParams {
  const next = nextWindow(current, available);
  if (next === null) return params;
  const k = picksOf(params);
  return withPicks(params, { ...k, window: withKey(k.window, assetId, next) });
}
export function withOtherClip(params: FamilyFilmParams, fromAssetId: string, toAssetId: string): FamilyFilmParams {
  if (fromAssetId === toAssetId) return params;
  const k = picksOf(params);
  const assetIds = params.assetIds.includes(toAssetId) ? params.assetIds : [...params.assetIds, toAssetId];
  if (assetIds.length > MAX_FILM_ASSETS) return params;
  const next = withPicks({ ...params, assetIds }, {
    exclude: uniq([...k.exclude.filter((id) => id !== toAssetId), fromAssetId]), include: uniq([...k.include.filter((id) => id !== fromAssetId), toAssetId]),
    window: withoutKey(withoutKey(k.window, fromAssetId), toAssetId),
  });
  return next;
}
export function withRemoved(params: FamilyFilmParams, assetId: string): FamilyFilmParams {
  const k = picksOf(params);
  return withPicks(params, { exclude: uniq([...k.exclude, assetId]), include: k.include.filter((id) => id !== assetId), window: withoutKey(k.window, assetId) });
}
/** «הכנסה»; null for an exclusion that cannot be brought back (too_short, no_picture, kept_by_hand). */
export function withIncluded(params: FamilyFilmParams, exclusion: FilmExclusion): FamilyFilmParams | null {
  const k = picksOf(params);
  if (exclusion.code === 'excluded_by_you') return withPicks(params, { ...k, exclude: k.exclude.filter((id) => id !== exclusion.assetId) });
  if (exclusion.code === 'no_room') return withPicks(params, { ...k, exclude: k.exclude.filter((id) => id !== exclusion.assetId), include: uniq([...k.include, exclusion.assetId]) });
  return null;
}
/** The excluded clips offered by «קליפ אחר» in the dialog: the plan's exclusions that can come back, then the other chosen files not in the film. */
export function otherClipChoices(view: FamilyFilmPlanView, doc: ProjectDocument, currentAssetId: string): { assetId: string; name: string }[] {
  const used = new Set(view.picks.map((p) => p.assetId));
  const ids = uniq([...view.excluded.filter((e) => e.code === 'no_room' || e.code === 'excluded_by_you').map((e) => e.assetId), ...view.params.assetIds]);
  return ids.filter((id) => id !== currentAssetId && !used.has(id) && isPictureAsset(doc.assets[id])).map((id) => ({ assetId: id, name: doc.assets[id]!.name }));
}

// ---------- wording (from familyFilm.strings.ts) ----------
/** «תנועה בתוך התמונה בשניות 4–7», «פרץ קול בשנייה 5.2», «קול חזק מהרגיל בקליפ (+9 dB)», «לא נמדד». */
export function reasonText(reason: FilmReason, lang: Lang): string { return familyFilmStrings(lang).reason(reason); }
export function exclusionText(e: FilmExclusion, lang: Lang): string { return familyFilmStrings(lang).exclusion(e); }
export function warningText(w: FilmWarning, lang: Lang): string { return familyFilmStrings(lang).warning(w); }

/** A failed call as the dialog shows it: the status, the code and the message in the interface language (templateRefusals.ts: the common table, then the headline of the code). */
export interface FilmFailure { status: number; code: string; message: string }
export function filmFailure(lang: Lang, e: unknown): FilmFailure {
  const f = templateRefusal(lang, e);
  // in Hebrew a hint that has no Hebrew wording is left out rather than shown in the server's English
  const hint = f.hint && !(lang === 'he' && e instanceof ApiFailure && f.hint === e.hint) ? f.hint : null;
  // «headline: headline detail» (the server's message already opens with the headline) is said once
  const cut = f.message.indexOf(': ');
  const head = cut > 0 ? f.message.slice(0, cut) : '';
  const said = head && f.message.slice(cut + 2).startsWith(head) ? f.message.slice(cut + 2) : f.message;
  return { status: e instanceof ApiFailure ? e.status : 0, code: f.code ?? 'error', message: hint ? `${said} ${hint}` : said };
}

// ---------- the measure / plan state machine ----------
export interface FilmNote { code: string; message: string }
export type FilmFlowState =
  | { phase: 'idle' }
  /** `note`: the measurement was refused, the film is planned without it (unmeasured clips enter from the middle) */
  | { phase: 'planning'; measured: readonly string[]; note?: FilmNote }
  | { phase: 'measuring'; jobId: string | null; done: number; total: number; measured: readonly string[] }
  | { phase: 'ready'; view: FamilyFilmPlanView; measured: readonly string[]; note?: FilmNote }
  | { phase: 'applying'; view: FamilyFilmPlanView; measured: readonly string[] }
  /** `at` is the step that was refused: the plan call, the measurement or the apply call (the message is shown next to its control). */
  | { phase: 'refused'; code: string; message: string; at: 'plan' | 'measure' | 'apply'; measured: readonly string[] };
export type FilmFlowEvent =
  | { type: 'enter-plan' } | { type: 'params-changed' } | { type: 'retry' }
  | { type: 'planned'; view: FamilyFilmPlanView }
  | { type: 'measure-started'; jobId: string; total: number } | { type: 'measure-cached' }
  | { type: 'measure-progress'; done: number; total: number } | { type: 'cancel' }
  | { type: 'measure-finished'; ok: boolean } | { type: 'measure-canceled' }
  | { type: 'apply' } | { type: 'applied' }
  | { type: 'refused'; status: number; code: string; message: string };
/** What the dialog does next: ask for a plan, start a measurement of these files, cancel a job, apply, close, or nothing. */
export type FilmFlowEffect = { kind: 'plan' } | { kind: 'measure'; assetIds: string[] } | { kind: 'cancel'; jobId: string } | { kind: 'apply'; revision: number } | { kind: 'close' } | null;
const measuredOf = (s: FilmFlowState): readonly string[] => ('measured' in s ? s.measured : []);
const plan = (s: FilmFlowState): { state: FilmFlowState; effect: FilmFlowEffect } => ({ state: { phase: 'planning', measured: measuredOf(s) }, effect: { kind: 'plan' } });
export function filmFlow(state: FilmFlowState, event: FilmFlowEvent): { state: FilmFlowState; effect: FilmFlowEffect } {
  const same = { state, effect: null as FilmFlowEffect };
  switch (event.type) {
    case 'retry': return state.phase === 'refused' ? plan(state) : same;
    case 'enter-plan': case 'params-changed': return state.phase === 'applying' || state.phase === 'measuring' ? same : plan(state);
    case 'planned': {
      if (state.phase === 'ready') return { state: { phase: 'ready', view: event.view, measured: state.measured, ...(state.note ? { note: state.note } : {}) }, effect: null };
      if (state.phase !== 'planning') return same;
      const todo = event.view.needsMeasurement.filter((id) => !state.measured.includes(id));
      if (todo.length) return { state: { phase: 'measuring', jobId: null, done: 0, total: todo.length, measured: [...state.measured, ...todo] }, effect: { kind: 'measure', assetIds: todo } };
      return { state: { phase: 'ready', view: event.view, measured: state.measured, ...(state.note ? { note: state.note } : {}) }, effect: null };
    }
    case 'measure-started':
      if (state.phase === 'measuring') return { state: { ...state, jobId: event.jobId, total: event.total }, effect: null };
      return { state, effect: { kind: 'cancel', jobId: event.jobId } };
    case 'measure-progress': return state.phase === 'measuring' ? { state: { ...state, done: Math.min(event.done, event.total), total: event.total }, effect: null } : same;
    case 'cancel': return state.phase === 'measuring' && state.jobId ? { state, effect: { kind: 'cancel', jobId: state.jobId } } : same;
    case 'measure-cached': case 'measure-finished': case 'measure-canceled': return state.phase === 'measuring' ? plan(state) : same;
    case 'apply': return state.phase === 'ready' ? { state: { phase: 'applying', view: state.view, measured: state.measured }, effect: { kind: 'apply', revision: state.view.revision } } : same;
    case 'applied': return state.phase === 'applying' ? { state: { phase: 'idle' }, effect: { kind: 'close' } } : same;
    case 'refused': {
      // the project changed since the plan: plan again (only after an apply, so a server that always says so cannot loop)
      if (state.phase === 'applying' && (event.code === 'stale_revision' || event.code === 'conflict')) return plan(state);
      // the measurement itself was refused (nothing started): the film is still planned, without it, and the refusal is shown beside the plan
      if (state.phase === 'measuring' && !state.jobId) return { state: { phase: 'planning', measured: state.measured, note: { code: event.code, message: event.message } }, effect: { kind: 'plan' } };
      const at = state.phase === 'applying' ? 'apply' : state.phase === 'measuring' ? 'measure' : 'plan';
      return { state: { phase: 'refused', code: event.code, message: event.message, at, measured: measuredOf(state) }, effect: state.phase === 'measuring' && state.jobId ? { kind: 'cancel', jobId: state.jobId } : null };
    }
  }
}
/** A progress update may redraw only this often (FILM_PROGRESS_EVERY_MS). */
export const progressDue = (lastMs: number | null, nowMs: number): boolean => lastMs === null || nowMs - lastMs >= FILM_PROGRESS_EVERY_MS;

// ---------- the measurement poller (the dialog's step 3 and the inspector's offer) ----------
export interface MeasureDeps {
  start(body: StartMomentsBody): Promise<{ jobId: string; status: string } | { cached: true; revision: number }>;
  job(jobId: string): Promise<{ status: string; stage?: string | null }>;
  sleep(ms: number): Promise<void>;
}
/** 'measuring moments 3/10' → { done: 3, total: 10 }. */
export function parseStage(stage: string | null | undefined): { done: number; total: number } | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(stage ?? '');
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null;
}
/** Start the measurement and wait for it. Throws what the start call throws (a refusal); the job's own end is the return value. */
export async function runMeasurement(deps: MeasureDeps, assetIds: readonly string[], hooks: { onJob?: (jobId: string, total: number) => void; onProgress?: (done: number, total: number) => void; stopped?: () => boolean } = {}): Promise<'cached' | 'succeeded' | 'failed' | 'canceled'> {
  const r = await deps.start({ assetIds: [...assetIds] });
  if ('cached' in r) return 'cached';
  hooks.onJob?.(r.jobId, assetIds.length);
  for (;;) {
    if (hooks.stopped?.()) return 'canceled';
    const j = await deps.job(r.jobId);
    if (j.status === 'succeeded') return 'succeeded';
    if (j.status === 'failed') return 'failed';
    if (j.status === 'canceled') return 'canceled';
    const p = parseStage(j.stage);
    if (p) hooks.onProgress?.(p.done, p.total);
    await deps.sleep(FILM_PROGRESS_EVERY_MS);
  }
}

// ---------- pictures ----------
/** The thumbnail sprite tile nearest a source frame (the sprite holds at most 60 tiles per file, evenly spaced: derive.ts). */
export function spriteTileIndex(sourceFrame: number, frames: number, tiles: number): number {
  if (tiles <= 1 || frames <= 0) return 0;
  return Math.min(tiles - 1, Math.max(0, Math.floor((sourceFrame * tiles) / frames)));
}
/** CSS of tile `index` of a sprite with `columns` x `rows` tiles. */
export function spriteStyle(columns: number, rows: number, index: number): { backgroundSize: string; backgroundPosition: string } {
  const col = index % columns, row = Math.floor(index / columns);
  return { backgroundSize: `${columns * 100}% ${rows * 100}%`, backgroundPosition: `${columns > 1 ? (col / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%` };
}
/** The strip of measured motion and sound (MomentsStrip): two polyline paths and the chosen window, in a width x height box, left to right in time. */
export interface StripGeometry { inner: string; level: string; window: { x: number; width: number; peakX: number } | null }
const MAX_POINTS = 120;
const r1 = (x: number) => Math.round(x * 10) / 10;
export function stripGeometry(data: MomentsData, window: { fromFrame: number; toFrame: number; peakFrame: number } | null, width: number, height: number): StripGeometry {
  const rate = data.asset.rate;
  const like = { video: { frameRate: rate, startTime: data.asset.startOffsetFrames ? T.frameTime(data.asset.startOffsetFrames, rate) : undefined } };
  const secOf = (frame: number) => T.toSeconds(sourceTimeOfFrame(like, Math.max(0, Math.round(frame))));
  const total = Math.max(secOf(data.asset.frames), 0.1);
  const x = (t: number) => r1(Math.min(width, Math.max(0, (t / total) * width)));
  const line = (pts: { t: number; v: number }[], top: number): string => {
    const stride = Math.max(1, Math.ceil(pts.length / MAX_POINTS));
    const kept = pts.filter((_, i) => i % stride === 0);
    return kept.map((p, i) => `${i ? 'L' : 'M'}${x(p.t)} ${r1(height - Math.min(1, Math.max(0, p.v)) * (height - top) - top / 2)}`).join('');
  };
  let inner = '', level = '';
  const pic = data.picture;
  if (pic && pic.count > 0) {
    const peak = Math.max(100, ...pic.inner.slice(0, pic.count));
    inner = line(pic.inner.slice(0, pic.count).map((v, k) => ({ t: secOf(k * pic.step), v: v / peak })), 2);
  }
  const snd = data.sound;
  if (snd && snd.count > 0) level = line(snd.level.slice(0, snd.count).map((v, h) => ({ t: (h * snd.hopMs) / 1000, v: (Math.max(-600, v) + 600) / 600 })), 2);
  const win = window ? { x: x(secOf(window.fromFrame)), width: Math.max(1, r1(x(secOf(window.toFrame)) - x(secOf(window.fromFrame)))), peakX: x(secOf(window.peakFrame)) } : null;
  return { inner, level, window: win };
}

// ---------- the document's film runs (the bar and the inspector section) ----------
export interface FilmRunView { run: RecipeRun; params: FamilyFilmParams | null; picked: FilmPicked[] }
const toView = (run: RecipeRun): FilmRunView => ({ run, params: filmRunParams(run.params) as FamilyFilmParams, picked: filmRunPicked(run.params) });
/** The film runs of the document, oldest first. */
export const filmRunsOf = (doc: ProjectDocument): FilmRunView[] => Object.values(doc.recipeRuns ?? {}).filter((r) => r.recipeId === FAMILY_FILM_RUN_RECIPE_ID).map(toView);
/** The run the bar shows: the named one (when it is still in the document), else the newest. */
export function currentFilmRun(doc: ProjectDocument, runId: string | null | undefined): FilmRunView | null {
  const all = filmRunsOf(doc);
  return (runId ? all.find((r) => r.run.id === runId) : undefined) ?? all[all.length - 1] ?? null;
}
/** The film run and slot a clip belongs to, or null. */
export function slotOfClip(doc: ProjectDocument, clipId: string): { view: FilmRunView; slot: SlotRecord } | null {
  for (const view of filmRunsOf(doc)) { const slot = view.run.slots?.find((s) => s.clipId === clipId && s.kind === 'picture'); if (slot) return { view, slot }; }
  return null;
}
/** The measured record of an asset, as filmReasonsFor reads it. */
export const momentsRecord = (doc: ProjectDocument, assetId: string): FilmMomentsRecord | null => {
  const m = doc.analyses?.[assetId]?.moments;
  return m ? { algo: m.algo, flat: m.flat, file: m.file, windows: m.windows } : null;
};
export const windowCount = (doc: ProjectDocument, assetId: string): number => momentsRecord(doc, assetId)?.windows.length ?? 0;
const mediaOf = (doc: ProjectDocument, clipId: string): { clip: MediaClip; asset: Asset } | null => {
  const f = findClip(doc, clipId);
  if (!f || f.clip.type !== 'media') return null;
  const asset = doc.assets[f.clip.assetId];
  return asset ? { clip: f.clip, asset } : null;
};
/** Source frames a clip reads (its stretch of source at the asset's rate), or null for a clip without a moving picture. */
function readFrames(clip: MediaClip, asset: Asset): { from: number; count: number } | null {
  if (asset.kind === 'image' || !asset.video) return null;
  return { from: sourceFrameOfTime(asset, clip.sourceIn), count: Math.max(1, T.nearestFrameIndex(toSourceSpan(clip, clip.duration), asset.video.frameRate)) };
}
/** The window of a record the clip overlaps most (lowest index on ties), or null. */
export function currentWindowIndex(record: FilmMomentsRecord | null, from: number, count: number): number | null {
  if (!record) return null;
  let best: number | null = null, most = 0;
  record.windows.forEach((w, i) => { const o = Math.min(from + count, w.toFrame) - Math.max(from, w.fromFrame); if (o > most) { most = o; best = i; } });
  return best;
}
/** The reason of a film clip computed from the clip as it is NOW, and whether it was edited by hand (its fingerprint differs from the run's). */
export interface ClipWhy { reasons: FilmReason[]; edited: boolean; measured: boolean; assetId: string; asset: Asset; clipId: string; windowIndex: number | null; windows: number; still: boolean }
export function clipWhy(doc: ProjectDocument, view: FilmRunView, slot: SlotRecord): ClipWhy | null {
  const m = mediaOf(doc, slot.clipId);
  if (!m) return null;
  const read = readFrames(m.clip, m.asset), record = momentsRecord(doc, m.asset.id);
  const edited = fingerprint(m.clip) !== view.run.fingerprints?.[slot.clipId];
  const reasons = read ? filmReasonsFor(m.asset, record, read.from, read.count) : filmReasonsFor(m.asset, null, 0, 0);
  return { reasons, edited, measured: !read || !!record, assetId: m.asset.id, asset: m.asset, clipId: slot.clipId, windowIndex: read ? currentWindowIndex(record, read.from, read.count) : null, windows: record?.windows.length ?? 0, still: !read };
}

// ---------- swaps in the timeline: ONE replace_clip_media each ----------
/** The sourceIn (asset time) that puts a clip of `count` source frames on the window, centred on its peak; clamped to the clean stretch when it fits there. */
export function windowSourceIn(asset: Asset, clip: MediaClip, w: { fromFrame: number; toFrame: number; peakFrame: number } | null): T.RationalTime | null {
  const total = videoFrames(asset);
  if (!asset.video || total === null) return null;
  const rate = asset.video.frameRate, need = toSourceSpan(clip, clip.duration);
  if (T.lt(asset.duration, need)) return null;
  const count = Math.max(1, T.nearestFrameIndex(need, rate));
  let start = w ? w.peakFrame - Math.floor(count / 2) : 0;
  if (w && w.toFrame - w.fromFrame >= count) start = Math.min(Math.max(start, w.fromFrame), w.toFrame - count);
  start = Math.max(0, Math.min(start, total - count));
  const fits = (s: number) => T.lte(T.add(sourceTimeOfFrame(asset, s), need), asset.duration);
  while (start > 0 && !fits(start)) start--;
  return fits(start) ? sourceTimeOfFrame(asset, start) : null;
}
/** «רגע אחר» of a clip: the next measured window of its own file, or null when there is none. */
export function swapWindowOp(doc: ProjectDocument, clipId: string): OpCall | null {
  const m = mediaOf(doc, clipId);
  if (!m) return null;
  const record = momentsRecord(doc, m.asset.id), read = readFrames(m.clip, m.asset);
  if (!record || !read || record.windows.length === 0) return null;
  const next = nextWindow(currentWindowIndex(record, read.from, read.count), record.windows.length);
  if (next === null) return null;
  const sourceIn = windowSourceIn(m.asset, m.clip, record.windows[next]!);
  if (!sourceIn || T.eq(sourceIn, m.clip.sourceIn)) return null;
  return { op: 'replace_clip_media', args: { clipId, assetId: m.asset.id, sourceIn } };
}
/** Files that can take the place of a clip: long enough, with sound when a linked partner needs it; the ones the film does not use first. */
export function replacementCandidates(doc: ProjectDocument, clipId: string, usedAssetIds: readonly string[]): Asset[] {
  const m = mediaOf(doc, clipId);
  if (!m) return [];
  const needSound = !!m.clip.linkGroupId && Object.values(doc.sequences).some((s) => s.tracks.some((t) => t.clips.some((c) => c.id !== clipId && c.type === 'media' && c.linkGroupId === m.clip.linkGroupId)));
  const need = toSourceSpan(m.clip, m.clip.duration);
  const ok = (a: Asset) => a.id !== m.asset.id && isPictureAsset(a) && (!needSound || !!a.audio) && (a.kind === 'image' ? !m.clip.reverse && !m.clip.freeze && !m.clip.speedEnd : T.lte(need, a.duration));
  const all = Object.values(doc.assets).filter(ok);
  return [...all.filter((a) => !usedAssetIds.includes(a.id)), ...all.filter((a) => usedAssetIds.includes(a.id))];
}
/** «קליפ אחר» of a clip: another file at its first measured window (else its start), fitted to the clip's length. */
export function swapClipOp(doc: ProjectDocument, clipId: string, toAssetId: string): OpCall | null {
  const m = mediaOf(doc, clipId), to = doc.assets[toAssetId];
  if (!m || !to || !replacementCandidates(doc, clipId, []).some((a) => a.id === toAssetId)) return null;
  if (to.kind === 'image') return { op: 'replace_clip_media', args: { clipId, assetId: toAssetId } };
  const sourceIn = windowSourceIn(to, m.clip, momentsRecord(doc, toAssetId)?.windows[0] ?? null);
  return sourceIn ? { op: 'replace_clip_media', args: { clipId, assetId: toAssetId, sourceIn } } : null;
}

// ---------- the bar's changes ----------
/** «רגעים אחרים»: every measured pick takes its next window; null when no file has another. */
export function otherMomentsParams(params: FamilyFilmParams, picked: readonly FilmPicked[], doc: ProjectDocument): FamilyFilmParams | null {
  let out = params, changed = false;
  for (const p of picked) {
    const available = windowCount(doc, p.assetId), next = nextWindow(p.windowIndex, available);
    if (p.kind === 'still' || next === null || (p.windowIndex === null && available === 0)) continue;
    out = withNextWindow(out, p.assetId, p.windowIndex, available); changed = true;
  }
  return changed ? out : null;
}
export const otherLengths = (current: number | undefined): (30 | 60 | 90)[] => FILM_LENGTHS.filter((s) => s !== (current ?? FILM_DEFAULTS.targetSeconds));
/** The transaction of the film's apply, from the activity list (newest first): the newest apply_template that touched the run's clips. */
/** Undo of the film is offered only when its transaction is still in the activity list (the newest 50 events); the editor's newest edit is never undone in its place. */
export function findFilmTransaction(activity: readonly RevisionEvent[], createdIds: readonly string[]): string | null {
  const ids = new Set(createdIds);
  return activity.find((e) => e.ops?.includes('apply_template') && e.affectedIds.some((id) => ids.has(id)))?.transactionId ?? null;
}
