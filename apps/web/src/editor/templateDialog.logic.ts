/**
 * What the Templates drawer and the template dialog decide (ADR-0016), kept apart from the components so it can be tested
 * without a browser: the media order, the text counters, the request parameters, the plan as rows, alternatives, shuffle and
 * tempo. Plus the small REST client of the template routes (W3's contract, templateContract.ts): plan is read-only, apply and
 * regenerate are ONE transaction each on the server; nothing here keeps project state.
 */
import * as T from '@pulseframe/time';
import type { Asset, ProjectDocument, TemplateApplyResult, TemplateInput, TemplatePlanView, TemplateRegenerateResult, TemplateSummary, TemplateWarning } from '@pulseframe/core';
import { ApiFailure } from '../api.ts';

// ---------- media ----------
/** One library picture or video in the template's order; `included` = it goes into the template. */
export interface MediaItem { assetId: string; included: boolean }
/** Library entries that can fill a picture slot: a still picture or a video (never a colour table or sound only). */
export const pictureAssets = (doc: ProjectDocument): Asset[] => Object.values(doc.assets).filter((a) => a.kind !== 'lut' && (!!a.video || !!a.image));
/** The starting order: the library's, everything included. */
export const initialMedia = (doc: ProjectDocument): MediaItem[] => pictureAssets(doc).map((a) => ({ assetId: a.id, included: true }));
/** The order kept across library changes: files that are gone leave, new ones (imported in the dialog) join at the end, included. */
export function syncMedia(items: readonly MediaItem[], doc: ProjectDocument): MediaItem[] {
  const ids = new Set(pictureAssets(doc).map((a) => a.id));
  const kept = items.filter((m) => ids.has(m.assetId));
  const known = new Set(kept.map((m) => m.assetId));
  const added = pictureAssets(doc).filter((a) => !known.has(a.id)).map((a) => ({ assetId: a.id, included: true }));
  return added.length || kept.length !== items.length ? [...kept, ...added] : (items as MediaItem[]);
}
/** The list with the item at `index` moved `by` places (−1 earlier, +1 later); unchanged at either end. */
export function moveItem<X>(list: readonly X[], index: number, by: -1 | 1): X[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const out = [...list];
  [out[index], out[to]] = [out[to]!, out[index]!];
  return out;
}
export const toggleItem = (list: readonly MediaItem[], assetId: string): MediaItem[] => list.map((m) => (m.assetId === assetId ? { ...m, included: !m.included } : m));

// ---------- music ----------
/** Sound files of the project that can carry a template: files of kind audio (a video's own sound is not offered as music). */
export const musicAssets = (doc: ProjectDocument): Asset[] => Object.values(doc.assets).filter((a) => a.kind === 'audio' && !!a.audio);
/** Whether the beat of a sound file has been measured, and what was found. */
export function beatState(doc: ProjectDocument, assetId: string): { measured: boolean; count: number; bpm: number | null } {
  const b = doc.analyses?.[assetId]?.beats;
  return b ? { measured: true, count: b.beats.length, bpm: b.bpm } : { measured: false, count: 0, bpm: null };
}
/** The music chosen when the dialog opens: none for a template without music; else the first sound file with a measured beat, else the first sound file (or none). */
export function defaultMusic(doc: ProjectDocument, need: TemplateSummary['needs']['music']): string {
  if (need === 'none') return '';
  const all = musicAssets(doc);
  return (all.find((a) => beatState(doc, a.id).measured) ?? all[0])?.id ?? '';
}

// ---------- texts ----------
/** Characters as the person sees them counted: code points (a Hebrew letter with its vowel points counts each mark). */
export const charCount = (text: string) => Array.from(text).length;
/** The counter of a text field: how many are used, how many are left (never below 0) and whether it is over the template's room. */
export function counter(text: string, max: number): { used: number; max: number; left: number; over: boolean } {
  const used = charCount(text);
  return { used, max, left: Math.max(0, max - used), over: used > max };
}

// ---------- parameters ----------
export interface DialogChoices {
  media: readonly MediaItem[];
  /** '' = no music. */
  music: string;
  /** By text key; empty or blank = the template's sample text. */
  texts: Readonly<Record<string, string>>;
  motionNone: boolean;
  lang: 'he' | 'en';
  /** Parameters taken from a chosen alternative (tempo, order, seed …), over the ones above. */
  extra?: Partial<TemplateInput>;
}
/** The template input the dialog sends (TemplateInputSchema): media in order, music or null, the typed texts, motion and language. */
export function buildParams(c: DialogChoices): Partial<TemplateInput> & Pick<TemplateInput, 'media' | 'musicAssetId' | 'texts' | 'lang' | 'motion'> {
  const texts: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.texts)) if (v.trim()) texts[k] = v;
  return mergeAlternative({ media: c.media.filter((m) => m.included).map((m) => m.assetId), musicAssetId: c.music || null, texts, lang: c.lang, motion: c.motionNone ? 'none' : 'full' }, { params: c.extra ?? {} }) as ReturnType<typeof buildParams>;
}
/**
 * The parameters with an alternative's taken over: its fields replace the current ones, except `texts`, whose keys are
 * merged (an alternative never drops a text the person typed). The input objects are not changed.
 */
export function mergeAlternative<P extends Partial<TemplateInput>>(params: P, alt: { params: Partial<TemplateInput> }): P {
  const out = { ...params, ...alt.params } as P;
  if (params.texts || alt.params.texts) out.texts = { ...(params.texts ?? {}), ...(alt.params.texts ?? {}) };
  return out;
}

// ---------- the plan as rows ----------
export interface PlanRows {
  summary: { operations: number; seconds: number; clock: string; slots: number };
  steps: string[];
  basis: string[];
  warnings: { code: TemplateWarning['code']; message: string }[];
  blocking: { code: TemplateWarning['code']; message: string }[];
  alternatives: { index: number; label: string; params: Partial<TemplateInput> }[];
  canApply: boolean;
}
/** m:ss (m:ss.s when not whole) of a length in seconds, to a tenth. */
export const clock = (seconds: number) => { const s = Math.round(Math.max(0, seconds) * 10) / 10; const m = Math.floor(s / 60); const r = Math.round((s - m * 60) * 10) / 10; return `${m}:${r < 10 ? '0' : ''}${Number.isInteger(r) ? r : r.toFixed(1)}`; };
/** What the plan step shows, from the server's plan view; `rate` is the project's frame rate (the predicted frames are in it). */
export function planRows(view: TemplatePlanView, rate: T.Rate): PlanRows {
  const frames = Math.max(0, view.predicted.endFrame - view.predicted.startFrame);
  const seconds = T.toSeconds(T.frameTime(frames, rate));
  return {
    summary: { operations: view.operations, seconds, clock: clock(seconds), slots: view.predicted.slots.length },
    steps: [...view.steps],
    basis: [...view.basis],
    warnings: view.warnings.map((w) => ({ code: w.code, message: w.message })),
    blocking: view.blocking.map((w) => ({ code: w.code, message: w.message })),
    alternatives: view.alternatives.map((a, index) => ({ index, label: a.label, params: a.params })),
    canApply: view.blocking.length === 0,
  };
}

// ---------- after apply ----------
/** Shuffle (the post-apply bar): the next seed, in shuffled order. Only what changes is sent to regenerate. */
export const shuffleParams = (params: Partial<TemplateInput>): Partial<TemplateInput> => ({ seed: (typeof params.seed === 'number' ? params.seed : 1) + 1, order: 'shuffle' });
const TEMPOS = ['normal', 'double', 'half'] as const;
/**
 * "Another tempo": the first of the plan's alternatives that sets a tempo other than the current one; without one, the next
 * of normal → double → half → normal.
 */
export function nextTempo(params: Partial<TemplateInput>, alternatives: readonly { params: Partial<TemplateInput> }[]): Pick<TemplateInput, 'tempo'> {
  const now = params.tempo ?? 'normal';
  const alt = alternatives.find((a) => a.params.tempo && a.params.tempo !== now);
  if (alt?.params.tempo) return { tempo: alt.params.tempo };
  return { tempo: TEMPOS[(TEMPOS.indexOf(now) + 1) % TEMPOS.length]! };
}

// ---------- the drawer ----------
/** The cards to show: all of them when no kind is chosen, else those of the chosen kinds (the chips are toggles). */
export const filterByGenre = (list: readonly TemplateSummary[], genres: readonly string[]) => (genres.length ? list.filter((s) => genres.includes(s.genre)) : [...list]);
/** A chip pressed again is let go. */
export const toggleGenre = (genres: readonly string[], g: string) => (genres.includes(g) ? genres.filter((x) => x !== g) : [...genres, g]);

// ---------- REST (templateContract.ts; apps/server/src/templates.ts) ----------
async function call<R>(path: string, body?: unknown): Promise<R> {
  const r = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = r.headers.get('content-type')?.includes('json') ? await r.json() : undefined;
  if (!r.ok) throw new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, data?.error?.details, data?.error?.hint);
  return data as R;
}
const seg = encodeURIComponent;
export const templateApi = {
  list: () => call<{ templates: TemplateSummary[] }>('/templates'),
  plan: (projectId: string, templateId: string, params: Partial<TemplateInput>) => call<TemplatePlanView>(`/projects/${seg(projectId)}/templates/${seg(templateId)}/plan`, { params }),
  apply: (projectId: string, templateId: string, params: Partial<TemplateInput>, expectedRevision: number) => call<TemplateApplyResult>(`/projects/${seg(projectId)}/templates/${seg(templateId)}/apply`, { params, expectedRevision }),
  regenerate: (projectId: string, runId: string, params: Partial<TemplateInput>) => call<TemplateRegenerateResult>(`/projects/${seg(projectId)}/template-runs/${seg(runId)}/regenerate`, { params }),
};
