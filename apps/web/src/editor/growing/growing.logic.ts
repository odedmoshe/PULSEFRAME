/**
 * «גדלים מול העיניים» — the dialog's pure logic (wave 8 growing, W3). No React, no browser API, no storage: a test reads this file and
 * the other files of the folder and refuses any storage or network path other than the two api calls (verifier C8).
 *
 * COORDINATES (C4): an eye point is (u, v) of the picture AS SHOWN, canvas px / canvas size, on the one-clip document of
 * sourceDocument.ts (the frame is the file's own shown shape, rounded to even numbers). THE MARKS live in the dialog's React state
 * only; what leaves it is built here (buildParams) for the plan / apply / rebuild request and nothing else.
 */
import * as T from '@pulseframe/time';
import {
  applyTransaction, compareWall, flashGapFrames, growingRunPicked, GROWING, GROWING_RUN_RECIPE_ID, GROWING_TEMPLATE_ID, GROWING_VERSION, removedByHand, shownCapture,
  sourceFrameOfTime, sourceTimeOfFrame,
  type Asset, type EyePoint, type GrowingParams, type GrowingPick, type GrowingPicked, type GrowingPlan, type PlanGrowing, type ProjectDocument, type RecipeRun,
  type ShownSize, type SuggestEyeOrder,
} from '@pulseframe/core';
import { translateRefusal } from '@pulseframe/i18n';

export type Lang = 'he' | 'en';

// ---------- pixels and (u, v) of the shown picture ----------
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Canvas pixel → (u, v) of the shown picture (clamped to the picture). */
export function pixelToUv(px: number, py: number, canvasW: number, canvasH: number): EyePoint { return { u: clamp01(px / canvasW), v: clamp01(py / canvasH) }; }
/** (u, v) → canvas pixel (the inverse; not rounded). */
export function uvToPixel(p: EyePoint, canvasW: number, canvasH: number): { px: number; py: number } { return { px: p.u * canvasW, py: p.v * canvasH }; }
/** A pointer position over the drawn canvas (its client rectangle) → (u, v). A zero-sized rectangle gives null. */
export function uvFromClient(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): EyePoint | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return pixelToUv(clientX - rect.left, clientY - rect.top, rect.width, rect.height);
}
/** The picture as shown: the size ingest recorded after EXIF orientation (image) or the video's own size. null: the file has no picture. */
export function shownSizeOf(asset: Pick<Asset, 'kind' | 'image' | 'video'>): ShownSize | null {
  const s = asset.video ?? (asset.kind === 'image' ? asset.image : undefined);
  return s ? { width: s.width, height: s.height } : null;
}
/** The cross-hair moved by arrow keys: one picture pixel, ten with Shift; clamped to the picture. null when the key is not an arrow. */
export function moveCrosshair(p: EyePoint, key: string, shift: boolean, shown: ShownSize): EyePoint | null {
  const n = shift ? 10 : 1;
  const d = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : key === 'ArrowDown' ? [0, 1] : null;
  if (!d) return null;
  return { u: clamp01(p.u + (d[0]! * n) / shown.width), v: clamp01(p.v + (d[1]! * n) / shown.height) };
}
/** The two eyes at least GROWING.minEyeShownPx apart on the picture as shown (the planner's rule, checked early so the owner is told at the click). */
export function eyesFarEnough(a: EyePoint, b: EyePoint, shown: ShownSize): boolean {
  return Math.hypot((a.u - b.u) * shown.width, (a.v - b.v) * shown.height) >= GROWING.minEyeShownPx;
}
/** The point as picture pixels, for words ("x 1512, y 2016"). */
export const shownPixels = (p: EyePoint, shown: ShownSize) => ({ x: Math.round(p.u * shown.width), y: Math.round(p.v * shown.height) });

// ---------- the library list ----------
export interface Candidate { assetId: string; name: string; kind: 'image' | 'video'; /** Wall-clock capture as the life line shows it, or null (undated). */ wall: string | null; shown: ShownSize }
/** Library stills and videos in capture order (shownCapture, compareWall); undated ones after, by name. */
export function listCandidates(doc: ProjectDocument): Candidate[] {
  const out: Candidate[] = [];
  for (const a of Object.values(doc.assets)) {
    const shown = shownSizeOf(a);
    if (!shown || (a.kind !== 'image' && a.kind !== 'video')) continue;
    out.push({ assetId: a.id, name: a.name, kind: a.kind, wall: shownCapture(doc, a.id)?.wall ?? null, shown });
  }
  return out.sort((x, y) => (x.wall && y.wall ? compareWall(x.wall, y.wall) || x.name.localeCompare(y.name) : x.wall ? -1 : y.wall ? 1 : x.name.localeCompare(y.name)) || x.assetId.localeCompare(y.assetId));
}
/** The date as words: «2019-05-04», or the sentence for undated (the caller passes it). */
export const dateWords = (wall: string | null, undated: string): string => (wall ? wall.slice(0, 10) : undated);
/** Alt+↑ / Alt+↓: an UNDATED item swaps with its neighbour in the list; a dated item never moves by hand (capture order decides). */
export function moveUndated(order: readonly string[], cands: Readonly<Record<string, Candidate>>, id: string, d: -1 | 1): string[] {
  const i = order.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= order.length || cands[id]?.wall) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}
/**
 * The list after the library changed while the dialog is open (files still coming in from the start hub's card, a file deleted):
 * files that left are dropped, the order of those that stay is kept (an undated one moved by hand stays where it was put), and a new
 * file goes right after the nearest file before it in capture order (or first). The same array when nothing changed.
 */
export function mergeOrder(order: readonly string[], cands: readonly Candidate[]): readonly string[] {
  const ids = cands.map((c) => c.assetId), have = new Set(ids);
  const out = order.filter((id) => have.has(id));
  const fresh = ids.filter((id) => !out.includes(id));
  if (!fresh.length && out.length === order.length) return order;
  for (const id of fresh) {
    let at = 0;
    for (let k = ids.indexOf(id) - 1; k >= 0; k--) { const i = out.indexOf(ids[k]!); if (i >= 0) { at = i + 1; break; } }
    out.splice(at, 0, id);
  }
  return out;
}
/** The key of a pick in the dialog's maps. */
export const pickId = (assetId: string, frame: number | null) => `${assetId}:${frame === null ? 'still' : frame}`;

// ---------- the marks of one picture (memory only) ----------
export interface Mark {
  /** The source frame of a video (chosen first), null for a still. */
  frame: number | null;
  /** The points in click order (at most two). */
  clicks: EyePoint[];
  /** [first eye, second eye] once two clicks are placed: the suggested order of suggestEyeOrder, or as swapped by S. */
  eyes: [EyePoint, EyePoint] | null;
}
export const emptyMark = (frame: number | null): Mark => ({ frame, clicks: [], eyes: null });
export type MarkWords = 'none' | 'one' | 'done';
export const markWords = (m: Mark | undefined): MarkWords => (m?.eyes ? 'done' : m && m.clicks.length ? 'one' : 'none');
export type PlaceResult = { mark: Mark; refused: null | 'too_close' };
/**
 * A point placed (click, or Enter on the cross-hair). The first and second points are the two eyes; the order of the pair is the
 * suggestion of `order` (core suggestEyeOrder; when it is not available the click order stays: C10). A third placement starts over.
 */
export function placePoint(m: Mark, p: EyePoint, shown: ShownSize, order: SuggestEyeOrder | null): PlaceResult {
  if (m.eyes || m.clicks.length >= 2) return { mark: { ...m, clicks: [p], eyes: null }, refused: null };
  if (m.clicks.length === 0) return { mark: { ...m, clicks: [p], eyes: null }, refused: null };
  const a = m.clicks[0]!;
  if (!eyesFarEnough(a, p, shown)) return { mark: m, refused: 'too_close' };
  let eyes: [EyePoint, EyePoint] = [a, p];
  if (order) { try { eyes = order(a, p, shown); } catch { eyes = [a, p]; } }
  return { mark: { ...m, clicks: [a, p], eyes }, refused: null };
}
/** S (C10): the two eyes swap. Nothing to swap before the second point. */
export const swapEyes = (m: Mark): Mark => (m.eyes ? { ...m, eyes: [m.eyes[1], m.eyes[0]] } : m);
/** Backspace: the last placed point is removed (the pair is dissolved, the first stays). */
export const removeLastMark = (m: Mark): Mark => ({ ...m, clicks: m.clicks.slice(0, -1), eyes: null });
/** «מחקו סימון». */
export const clearMark = (m: Mark): Mark => emptyMark(m.frame);
/** A video's frame changed: the points belong to the frame they were placed on, so they go. */
export const withFrame = (m: Mark, frame: number | null): Mark => (m.frame === frame ? m : emptyMark(frame));
/** The source frame stepped: ←/→ one, Shift ±1 s (the file's frame rate, rounded), clamped to 0..last. */
export function stepFrame(frame: number, key: string, shift: boolean, fps: number, last: number): number | null {
  const d = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
  if (!d) return null;
  return Math.max(0, Math.min(last, frame + d * (shift ? Math.max(1, Math.round(fps)) : 1)));
}
/** The last source frame of a video (frameCount when the file says, else from its length). */
export function lastFrameOf(asset: Pick<Asset, 'video' | 'duration'>): number {
  const v = asset.video;
  if (!v) return 0;
  const n = v.frameCount ?? Math.floor((T.toSeconds(asset.duration) * v.frameRate.num) / v.frameRate.den);
  return Math.max(0, n - 1);
}
/** Project-rate frame of the one-clip document that shows source frame n of a video (the viewer seeks there), and the source frame a project frame shows. */
export function projectFrameOfSource(asset: Pick<Asset, 'video'>, n: number, rate: T.Rate): number { return T.nearestFrameIndex(sourceTimeOfFrame(asset, n), rate); }
export function sourceFrameOfProject(asset: Pick<Asset, 'video'>, pf: number, rate: T.Rate): number { return sourceFrameOfTime(asset, T.frameTime(pf, rate)); }

// ---------- counts and states in words ----------
export type Marks = Readonly<Record<string, Mark>>;
/** «סומנו N מתוך M»: pictures with both eyes among the ticked ones. */
export const markedCount = (ids: readonly string[], marks: Marks): { marked: number; of: number } => ({ marked: ids.filter((id) => marks[id]?.eyes).length, of: ids.length });
/** C8: closing loses marks of pictures not made yet. */
export const closeLosesMarks = (marks: Marks, made: boolean): boolean => !made && Object.values(marks).some((m) => m.clicks.length > 0);

// ---------- settings and the request ----------
export interface Settings {
  /** Seconds as typed; the planner gets frames. */
  holdSeconds: number;
  dissolve: 'none' | 'short' | 'long';
  faceSize: number;
  caption: { date: boolean; age: boolean };
}
export const defaultSettings = (): Settings => ({ holdSeconds: GROWING.defaultHoldSeconds, dissolve: 'short', faceSize: GROWING.faceSize.default, caption: { date: false, age: false } });
export const fpsOf = (doc: Pick<ProjectDocument, 'settings'>): number => doc.settings.frameRate.num / doc.settings.frameRate.den;
export const holdFrames = (seconds: number, fps: number): number => Math.max(1, Math.round(seconds * fps));
/** The hold as it will be (from frames, never from the typed seconds): «1.00». */
export const secondsText = (frames: number, fps: number): string => (frames / fps).toFixed(2);
export const minHoldFrames = (fps: number): number => flashGapFrames(fps);
/** The first person of the people sheet with a birth date, or null (the age caption has no words without one). */
export function agePerson(doc: ProjectDocument): { id: string; name: string } | null {
  for (const p of Object.values(doc.people ?? {})) if (p.birthDate) return { id: p.id, name: p.name };
  return null;
}
export interface PickRef { assetId: string; frame: number | null }
/**
 * The request's params, built once from the marks. `onlyMarked`: the live preview plans just the pictures that have both eyes.
 * Pictures without both eyes are left out of a request (and `blocker` says which one stops «צרו»).
 */
export function buildParams(doc: ProjectDocument, refs: readonly PickRef[], marks: Marks, s: Settings, opts: { personId?: string | null } = {}): GrowingParams | null {
  const picks = refs.flatMap((r) => { const m = marks[pickId(r.assetId, r.frame)]; return m?.eyes ? [{ assetId: r.assetId, frame: r.frame, eyes: [{ ...m.eyes[0] }, { ...m.eyes[1] }] as [EyePoint, EyePoint] }] : []; });
  if (picks.length < GROWING.minPictures) return null;
  const person = opts.personId ?? (s.caption.age ? agePerson(doc)?.id ?? null : null);
  return {
    picks, sort: 'capture', holdFrames: holdFrames(s.holdSeconds, fpsOf(doc)), dissolve: s.dissolve, faceSize: s.faceSize,
    caption: s.caption.date || s.caption.age ? { date: s.caption.date, age: s.caption.age && !!person } : null,
    ...(s.caption.age && person ? { personId: person } : {}),
  };
}
/** Why «צרו» is not allowed yet, as a code the component words; null = allowed (two marked pictures are enough). */
export function createBlocker(refs: readonly PickRef[], marks: Marks): null | 'few' | 'unmarked' {
  const { marked } = markedCount(refs.map((r) => pickId(r.assetId, r.frame)), marks);
  if (marked < GROWING.minPictures) return 'few';
  return marked < refs.length ? 'unmarked' : null;
}

// ---------- the live preview (C13) ----------
/** The capture map the planner takes (the same the server builds). */
export function captureContext(doc: ProjectDocument, ids: readonly string[]): Record<string, string | null> {
  return Object.fromEntries(ids.map((id) => [id, shownCapture(doc, id)?.wall ?? null]));
}
export type PreviewResult = { ok: true; doc: ProjectDocument; plan: GrowingPlan } | { ok: false; message: string };
/**
 * Plan on a COPY of the document and apply the plan's ops as ONE internal apply_template on that copy (fixed idSeed), never saved.
 * `plan` and `apply` are injected: the dialog passes core planGrowing and applyTransaction; the tests pass labelled stand-ins.
 * A planner refusal comes back as its message (the caller words it with refusalWords).
 */
export function buildPreview(doc: ProjectDocument, params: GrowingParams, deps: { plan: PlanGrowing; apply?: typeof applyTransaction }): PreviewResult {
  try {
    const plan = deps.plan(structuredClone(doc), params, { capture: captureContext(doc, params.picks.map((p) => p.assetId)) });
    const apply = deps.apply ?? applyTransaction;
    const r = apply(structuredClone(doc), [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: plan.record, steps: plan.steps, ops: plan.ops, slots: plan.slots } }], { idSeed: 'gprev_', actor: 'growing-preview', allowInternal: true });
    return { ok: true, doc: r.doc, plan };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : String(e) }; }
}
/** A refusal in the interface language: Hebrew through translateRefusal (planner and server), else the sentence as it is. */
export function refusalWords(lang: Lang, message: string): string { return (lang === 'he' ? translateRefusal('he', message) : undefined) ?? message; }
export function failureWords(lang: Lang, e: unknown, notBuilt: string): string {
  const x = e as { code?: string; message?: string };
  if (x?.code === 'growing_not_built' || x?.code === 'not_built') return notBuilt;
  return refusalWords(lang, String(x?.message ?? e));
}

// ---------- the run in the document (the bar) ----------
export interface GrowingRunView { run: RecipeRun; picked: GrowingPicked[]; removedRecorded: GrowingPicked[]; deleted: GrowingPicked[] }
/** The latest growing run; `deleted` = the picks whose clip is gone (and those the record already lists as removed). */
export function currentGrowingRun(doc: ProjectDocument): GrowingRunView | null {
  const runs = Object.values(doc.recipeRuns ?? {}).filter((r) => r.recipeId === GROWING_RUN_RECIPE_ID);
  const run = runs.at(-1);
  if (!run) return null;
  const picked = growingRunPicked(run.params), removedRecorded = growingRunPicked(run.params, 'removed');
  const gone = new Set(removedByHand(doc, run.slots ?? []).map((s) => s.key));
  const deleted = [...picked.filter((p) => gone.has(p.key)), ...removedRecorded.filter((p) => !picked.some((q) => q.key === p.key))];
  return { run, picked, removedRecorded, deleted };
}
/**
 * The rebuild after a deletion: the whole list in the record's order (no eyes), the deleted picks marked again (eyes) AT THEIR
 * PLACE in it (the record lists every pick in show order, those deleted too), so `sort: 'given'` brings a picture back where it was;
 * a deleted pick the record names only as removed comes after.
 */
export function restoreParams(view: GrowingRunView, marks: Marks): GrowingParams | null {
  const isDeleted = (p: GrowingPicked) => view.deleted.some((d) => d.key === p.key);
  const marked = (p: GrowingPicked) => { const m = marks[pickId(p.assetId, p.frame)]; return { assetId: p.assetId, frame: p.frame, ...(m?.eyes ? { eyes: [{ ...m.eyes[0] }, { ...m.eyes[1] }] as [EyePoint, EyePoint] } : {}) }; };
  const picks = [...view.picked.map((p) => (isDeleted(p) ? marked(p) : { assetId: p.assetId, frame: p.frame })), ...view.deleted.filter((d) => !view.picked.some((p) => p.key === d.key)).map(marked)];
  return picks.length >= GROWING.minPictures ? { picks } : null;
}
/** One «למה?» row: the picture, its date, magnification, uncovered share. */
export interface WhyRow { assetId: string; frame: number | null; date: string | null; magnification: number | null; uncoveredPercent: number | null }
export function whyRows(picks: readonly GrowingPick[]): WhyRow[] {
  return picks.map((p) => ({ assetId: p.assetId, frame: p.frame, date: p.capture, magnification: Math.round(p.magnification * 100) / 100, uncoveredPercent: Math.round(p.uncoveredShare * 1000) / 10 }));
}
