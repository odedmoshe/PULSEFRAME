/**
 * The picture card's and the export strip's logic (wave 8 booth, builder W2; the components are thin shells over this file, which is
 * what the unit tests cover). No DOM here: everything the browser provides arrives through a port.
 * - The scene is core's boothScene on the two test pictures with their REAL content hashes (sha256 of the bytes the server serves).
 * - Every drawn frame of a playback passes the dialog's ONE FlashGuard.paint (ADR-0009); stills are drawn once, not animated.
 * - Nothing here says good, right, sharp, safe or verified, and no number says two drawings are the same.
 */
import * as T from '@pulseframe/time';
import type { BoothCheckRow, BoothItem, BoothScene, BoothTestPictureRef, ProjectDocument } from '@pulseframe/core';
import type { FlashGuard, FrameImage, RenderGraph } from '@pulseframe/engine';
import { translateRefusal, type Lang } from '@pulseframe/i18n';
import type { BoothAnswerExtras } from './booth.contract.ts';

// ------------------------------------------------------------------------------------------------------------------- adapter facts
export interface AdapterFacts { adapter: string | null; software: boolean | null }
/** The adapter of the row browser-gpu (data.adapter, data.software), or nulls when the row is missing or holds none. */
export function adapterFacts(row: Pick<BoothCheckRow, 'data'> | null | undefined): AdapterFacts {
  const a = row?.data.adapter, s = row?.data.software;
  return { adapter: typeof a === 'string' && a.length > 0 ? a : null, software: typeof s === 'boolean' ? s : null };
}
/** What the card hands the dialog with the answer (BoothAnswerExtras): only what the row really said. */
export function browserExtras(row: Pick<BoothCheckRow, 'data'> | null | undefined): BoothAnswerExtras {
  const f = adapterFacts(row);
  return { ...(f.adapter !== null ? { browserAdapter: f.adapter } : {}), ...(f.software !== null ? { browserSoftware: f.software } : {}) };
}

// ------------------------------------------------------------------------------------------------------------------------- the mode
export type PictureMode =
  /** the row says there is no adapter: only «דלגו» */ | 'needs-gpu'
  /** reduced motion: three stills, no playback, no animation frame */ | 'three-stills'
  /** a still first; «הפעלה» plays the window once */ | 'still';
/** Row states that mean the browser's graphics adapter is there (a software one included: the card says so in words). */
export const GPU_PRESENT_STATES: readonly BoothCheckRow['state'][] = ['ok', 'setup'];
/**
 * Whether the item needs the graphics card and the browser has none. Items that draw on the 2D canvas never need it. A row that has not
 * answered yet (null) is not a verdict: the card tries, and drawing reports an unavailable effect (`drawNeedsGpu`).
 */
export function needsGpuAndHasNone(item: Pick<BoothItem, 'source'>, row: Pick<BoothCheckRow, 'state'> | null | undefined): boolean {
  const gpuItem = item.source === 'gpu-transition' || item.source === 'gpu-effect';
  return gpuItem && !!row && !GPU_PRESENT_STATES.includes(row.state);
}
export function pictureMode(item: Pick<BoothItem, 'source'>, row: Pick<BoothCheckRow, 'state'> | null | undefined, reducedMotion: boolean): PictureMode {
  if (needsGpuAndHasNone(item, row)) return 'needs-gpu';
  return reducedMotion ? 'three-stills' : 'still';
}
/** drawGraph's report said an effect or a picture could not be drawn: the card goes back to its «needs a graphics card» state. */
export const drawNeedsGpu = (r: { missing: readonly string[]; unavailableEffects: readonly string[] }): boolean => r.unavailableEffects.length > 0;
export const drawIncomplete = (r: { missing: readonly string[]; unavailableEffects: readonly string[] }): boolean => r.missing.length > 0 || r.unavailableEffects.length > 0;

// ---------------------------------------------------------------------------------------------------------------------------- frames
/** The frames of the three stills of reduced motion: the first frame of the window, the scene's still, the last frame of the window. */
export function threeStillFrames(scene: Pick<BoothScene, 'still' | 'play'>): [number, number, number] {
  return [scene.play.first, scene.still, scene.play.first + Math.max(0, scene.play.count - 1)];
}
export function playFrames(scene: Pick<BoothScene, 'play'>): number[] {
  return Array.from({ length: Math.max(0, scene.play.count) }, (_, i) => scene.play.first + i);
}
export const frameAt = (doc: ProjectDocument, n: number): T.RationalTime => T.frameTime(n, doc.settings.frameRate);
export const fpsOf = (doc: ProjectDocument): number => doc.settings.frameRate.num / doc.settings.frameRate.den;

// ------------------------------------------------------------------------------------------------------------------ the test pictures
export async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `sha256:${Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
export interface LoadedPicture { ref: BoothTestPictureRef; blob: Blob }
/** Fetches a test picture and takes its real hash and size from the bytes; any answer that is not ok is a thrown, named failure. */
export async function loadTestPicture(fetcher: (url: string, init?: RequestInit) => Promise<Response>, url: string, signal?: AbortSignal): Promise<LoadedPicture> {
  const r = await fetcher(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
  if (!r.ok) throw new Error(`test picture: HTTP ${r.status}`);
  const bytes = await r.arrayBuffer();
  return { ref: { contentHash: await sha256Of(bytes), byteSize: bytes.byteLength }, blob: new Blob([bytes], { type: r.headers.get('content-type') ?? 'image/png' }) };
}
/** The frame provider of drawGraph: an asset id → its content hash → the decoded test picture (null when the card has none for it). */
export function pictureProvider(doc: ProjectDocument, bitmaps: ReadonlyMap<string, CanvasImageSource>): (l: { assetId: string }) => Promise<FrameImage | null> {
  return async (l) => {
    const hash = doc.assets[l.assetId]?.contentHash;
    const bm = hash ? bitmaps.get(hash) : undefined;
    return bm ? { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bm, dx, dy, dw, dh) } : null;
  };
}

// ---------------------------------------------------------------------------------------------------------------------------- playback
export interface PlayPorts {
  guard: Pick<FlashGuard, 'paint'>;
  graph(n: number): RenderGraph;
  /** draws off screen, resolves with what drawing reported */ draw(g: RenderGraph): Promise<{ missing?: readonly string[]; unavailableEffects?: readonly string[] }>;
  copy(): void;
  now(): number;
  sleep(seconds: number): Promise<void>;
  nextFrame?(run: () => void): void;
  fps: number;
  /** checked before every frame: a stopped, closed or hidden card ends the playback at once */ stopped(): boolean;
}
/**
 * Plays the frames once, in order, at the project's own pace, EVERY frame through `guard.paint` (decided before the draw, timed from the
 * copy). A frame that is late is not skipped: the playback is sequential, so the guard sees each frame. Returns how many were painted.
 */
export async function playWindow(frames: readonly number[], p: PlayPorts): Promise<{ painted: number; stoppedEarly: boolean }> {
  const t0 = p.now();
  let painted = 0;
  for (let i = 0; i < frames.length; i++) {
    if (p.stopped()) return { painted, stoppedEarly: true };
    const wait = t0 + i / p.fps - p.now();
    if (wait > 0) await p.sleep(wait);
    if (p.stopped()) return { painted, stoppedEarly: true };
    await p.guard.paint(p.graph(frames[i]!), { now: p.now, draw: p.draw, copy: p.copy, sleep: p.sleep, ...(p.nextFrame ? { nextFrame: p.nextFrame } : {}) });
    painted++;
  }
  return { painted, stoppedEarly: false };
}

// ---------------------------------------------------------------------------------------------------------------------------- words
/** The accessible description of a picture card's canvas (role="img"): what it shows, in the card's language; no verdict. */
export function pictureDescription(item: Pick<BoothItem, 'title' | 'what'>, lang: Lang, still: 'first' | 'mid' | 'last' | 'single' = 'single'): string {
  const part = { he: { first: 'תחילת המעבר', mid: 'אמצע המעבר', last: 'סוף המעבר', single: 'תמונה אחת מהבדיקה' }, en: { first: 'start of the window', mid: 'middle of the window', last: 'end of the window', single: 'one picture of the check' } }[lang][still];
  return lang === 'he'
    ? `${item.title.he}: ${part}. ציור של הדפדפן הזה על שתי תמונות הבדיקה: חץ ופינה חתוכה.`
    : `${item.title.en}: ${part}. This browser's drawing on the two test pictures: an arrow and a cut corner.`;
}

// ------------------------------------------------------------------------------------------------------------------------- export strip
/** The items of the strip: only the first-sitting transitions flagged exportStrip, in the order the dialog gave them. */
export const stripItems = <V extends { item: Pick<BoothItem, 'exportStrip'> }>(views: readonly V[]): V[] => views.filter((v) => v.item.exportStrip);
export type StripGate = 'ready' | 'needs-row';
/** The strip opens only after the row export-gpu answered (any state but «skipped»: a row that did not run is not an answer). */
export function stripGate(exportGpu: Pick<BoothCheckRow, 'state'> | null | undefined): StripGate {
  return exportGpu && exportGpu.state !== 'skipped' ? 'ready' : 'needs-row';
}
export interface ExportStillFacts { adapter: string | null; software: boolean | null }
const ASCII = /^[\x20-\x7e]*$/;
/** x-pf-adapter (printable ASCII, at most 200 characters) and x-pf-software (0 or 1) of an export still; anything else is "not told". */
export function exportStillFacts(h: { get(name: string): string | null }, maxChars = 200): ExportStillFacts {
  const a = h.get('x-pf-adapter'), s = h.get('x-pf-software');
  return { adapter: a && ASCII.test(a) ? a.slice(0, maxChars) : null, software: s === '1' ? true : s === '0' ? false : null };
}
export function exportExtras(f: ExportStillFacts): BoothAnswerExtras {
  return { ...(f.adapter !== null ? { exportAdapter: f.adapter } : {}), ...(f.software !== null ? { exportSoftware: f.software } : {}) };
}
export type StripOutcome = { ok: true; blob: Blob; facts: ExportStillFacts } | { ok: false; busy: boolean; words: string };
/** One export still: a 409 booth_busy and every other refusal in words (the server's own sentence through translateRefusal), never a code. */
export async function fetchExportStill(fetcher: (url: string, init?: RequestInit) => Promise<Response>, url: string, lang: Lang, fallbacks: { busy: string; other: string }, signal?: AbortSignal): Promise<StripOutcome> {
  let r: Response;
  try { r = await fetcher(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) }); } catch { return { ok: false, busy: false, words: fallbacks.other }; }
  if (r.ok) {
    const blob = await r.blob();
    return { ok: true, blob, facts: exportStillFacts(r.headers) };
  }
  let message = '', code = '';
  try { const j = (await r.json()) as { error?: { code?: string; message?: string } }; message = j.error?.message ?? ''; code = j.error?.code ?? ''; } catch { /* a refusal without a body */ }
  const busy = r.status === 409 || code === 'booth_busy';
  return { ok: false, busy, words: (message && translateRefusal(lang, message)) || (busy ? fallbacks.busy : fallbacks.other) };
}
