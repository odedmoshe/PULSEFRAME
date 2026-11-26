/**
 * Pure logic of the «תמונה חיה» block and the depth dialog (wave 8 living track). No DOM, no network: the components are thin.
 * Numbers shown are the contract's (livingMaxAmount, depth limits); nothing is judged here.
 */
import * as T from '@pulseframe/time';
import {
  depthNumbers, findClip, livingEffectOf, livingLongEnough, livingMaxAmount, livingUnavailable,
  LIVING_DEFAULTS, LIVING_MOVES, LIVING_RAMP_START, MAX_DEPTH_NUMBERS, MAX_DEPTH_STROKES, MAX_STROKE_NUMBERS,
  type ClipDepth, type DepthGrid, type DepthStroke, type LivingCurve, type LivingMove, type LivingUnavailable, type MediaClip, type OpCall, type ProjectDocument,
} from '@pulseframe/core';

export type LivingKind = 'offer' | 'on' | 'not-offered';
export interface LivingView {
  kind: LivingKind;
  /** why nothing is offered */
  reason: 'video' | 'rotated' | null;
  tooShort: boolean;
  move: LivingMove;
  amount: number;
  curve: LivingCurve;
  frames: number;
  /** livingMaxAmount for the clip and the move shown */
  maxAmount: number;
  /** the slider's max is below 1: the capped line is shown */
  capped: boolean;
  depth: ClipDepth | null;
  strokes: number;
  unavailable: LivingUnavailable | null;
  /** the clip outlasts the last travel key */
  refit: boolean;
  /** the picture as shown (asset image size) */
  shown: { width: number; height: number } | null;
}

const CURVES: readonly string[] = ['ease-in-out', 'linear', 'gentle'];
export const floor2 = (x: number): number => Math.floor(x * 100 + 1e-9) / 100;

export function livingView(doc: ProjectDocument, clipIn: MediaClip): LivingView {
  const clip = (findClip(doc, clipIn.id)?.clip as MediaClip | undefined) ?? clipIn;
  const asset = doc.assets[clip.assetId];
  const rate = doc.settings.frameRate;
  const frames = T.frameIndexAt(clip.duration, rate);
  const fx = livingEffectOf(clip);
  const move: LivingMove = fx && (LIVING_MOVES as readonly unknown[]).includes(fx.params.move) ? (fx.params.move as LivingMove) : LIVING_DEFAULTS.move;
  const keys = fx?.keyframes?.travel ?? [];
  const first = keys[0]?.easing;
  const curve: LivingCurve = typeof first === 'string' && CURVES.includes(first) ? (first as LivingCurve) : LIVING_DEFAULTS.curve;
  const maxAmount = livingMaxAmount(frames, rate, move, curve);
  const amount = fx && typeof fx.params.amount === 'number' ? fx.params.amount : Math.min(LIVING_DEFAULTS.amount, maxAmount);
  const rotated = clip.transform.rotation !== 0 || (clip.keyframes?.rotation?.length ?? 0) > 0;
  const video = !asset || asset.kind !== 'image';
  const last = keys.length ? keys[keys.length - 1]!.time : null;
  const lastFrame = last ? T.frameIndexAt(last, rate) : null;
  const kind: LivingKind = fx ? 'on' : video || rotated ? 'not-offered' : 'offer';
  return {
    kind, reason: kind === 'not-offered' ? (video ? 'video' : 'rotated') : null,
    tooShort: !livingLongEnough(frames, rate), move, amount, curve, frames, maxAmount, capped: maxAmount < 1,
    depth: clip.depth ?? null, strokes: clip.depth?.strokes.length ?? 0,
    unavailable: livingUnavailable(clip), refit: fx !== undefined && lastFrame !== null && lastFrame < frames - 1,
    shown: asset?.image ? { width: asset.image.width, height: asset.image.height } : null,
  };
}

/** livingMaxAmount for the clip with another move (the keys and curve stay). */
export const maxFor = (doc: ProjectDocument, view: LivingView, move: LivingMove): number => livingMaxAmount(view.frames, doc.settings.frameRate, move, view.curve);

/** The amount a first apply or a move change writes: the default or the current amount, never above the cap (hundredths, rounded down). */
export const amountFor = (wanted: number, max: number): number => Math.max(0, Math.min(floor2(wanted), max));

// ---------------------------------------------------------------- ops
export const applyOp = (clipId: string, depth: ClipDepth, move: LivingMove, amount: number): OpCall => ({ op: 'set_living_picture', args: { clipId, depth, move, amount } });
export const changeOp = (clipId: string, move: LivingMove, amount: number): OpCall => ({ op: 'set_living_picture', args: { clipId, move, amount } });
export const removeOp = (clipId: string): OpCall => ({ op: 'set_living_picture', args: { clipId, remove: true } });
export const depthOp = (clipId: string, depth: ClipDepth): OpCall => ({ op: 'set_clip_depth', args: { clipId, depth } });
/** What «שמירה» commits: one op carrying the depth when the clip has no living picture yet, else the depth alone. */
export const saveOp = (view: LivingView, clipId: string, depth: ClipDepth): OpCall =>
  view.kind === 'on' ? depthOp(clipId, depth) : applyOp(clipId, depth, view.move, amountFor(LIVING_DEFAULTS.amount, view.maxAmount));
export const startDepth = (view: LivingView): ClipDepth => view.depth ?? LIVING_RAMP_START;

/** `replacedMotion` of a set_living_picture output: true when the op replaced a move. */
export function replacedAny(output: unknown): boolean {
  const r = (output as { replacedMotion?: unknown } | undefined)?.replacedMotion;
  return Array.isArray(r) && r.length > 0;
}

// ---------------------------------------------------------------- the move chips (a radio group)
/** The move after an arrow key; chips are in LIVING_MOVES order in the DOM, so in RTL the right arrow is the earlier one. */
export function moveAfterKey(key: string, lang: 'he' | 'en', current: LivingMove): LivingMove | null {
  const rtl = lang === 'he';
  const step = key === 'ArrowRight' ? (rtl ? -1 : 1) : key === 'ArrowLeft' ? (rtl ? 1 : -1) : key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  const i = LIVING_MOVES.indexOf(current) + step;
  return LIVING_MOVES[(i + LIVING_MOVES.length) % LIVING_MOVES.length] ?? null;
}

// ---------------------------------------------------------------- the depth dialog
export const HORIZON_STEP = 10; // 1/100 of the height in 1/1000 units
export const clampHorizon = (h: number): number => Math.max(0, Math.min(999, Math.round(h)));
export function horizonAfterKey(key: string, h: number): number | null {
  const d = key === 'ArrowUp' || key === 'ArrowLeft' ? -HORIZON_STEP : key === 'ArrowDown' || key === 'ArrowRight' ? HORIZON_STEP : key === 'Home' ? -1000 : key === 'End' ? 1000 : 0;
  return d ? clampHorizon(h + d) : null;
}
export const setHorizon = (d: ClipDepth, h: number): ClipDepth => ({ ...d, base: { kind: 'ramp', horizon: clampHorizon(h) } });
export const setFlat = (d: ClipDepth): ClipDepth => ({ ...d, base: { kind: 'flat' } });
export const horizonOf = (d: ClipDepth): number | null => (d.base.kind === 'ramp' ? d.base.horizon : null);
/** A point of the pointer on the canvas box, in 1/1000 of the picture. */
export function toUnits(px: number, py: number, box: { left: number; top: number; width: number; height: number }): [number, number] {
  const c = (v: number) => Math.max(0, Math.min(1000, Math.round(v)));
  return [c(((px - box.left) / Math.max(1, box.width)) * 1000), c(((py - box.top) / Math.max(1, box.height)) * 1000)];
}
/** A new stroke can start: fewer than the most strokes and room for its numbers. */
export const canAddStroke = (d: ClipDepth): boolean => d.strokes.length < MAX_DEPTH_STROKES && depthNumbers(d) + 2 <= MAX_DEPTH_NUMBERS;
/** A point can join the stroke being drawn (per stroke and whole-record limits). Points closer than 2 units to the last are dropped. */
export function extendStroke(d: ClipDepth, s: DepthStroke, x: number, y: number): DepthStroke {
  const n = s.pts.length;
  if (n >= MAX_STROKE_NUMBERS || depthNumbers(d) + n + 2 > MAX_DEPTH_NUMBERS) return s;
  if (Math.abs(s.pts[n - 2]! - x) < 2 && Math.abs(s.pts[n - 1]! - y) < 2) return s;
  return { ...s, pts: [...s.pts, x, y] };
}
export const newStroke = (layer: 'near' | 'far', size: number, x: number, y: number): DepthStroke => ({ layer, size: Math.max(5, Math.min(300, Math.round(size))), pts: [x, y] });
export const addStroke = (d: ClipDepth, s: DepthStroke): ClipDepth => (d.strokes.length < MAX_DEPTH_STROKES ? { ...d, strokes: [...d.strokes, s] } : d);
export const popStroke = (d: ClipDepth): ClipDepth => ({ ...d, strokes: d.strokes.slice(0, -1) });
export const clearStrokes = (d: ClipDepth): ClipDepth => ({ ...d, strokes: [] });
export const atLimit = (d: ClipDepth): boolean => !canAddStroke(d);

/** RGBA bytes of the overlay: light = near, dark = far, opaque (the canvas draws it at 50%). */
export function overlayPixels(grid: DepthGrid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);
  for (let i = 0; i < grid.width * grid.height; i++) { const v = grid.data[i]!; out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255; }
  return out;
}
