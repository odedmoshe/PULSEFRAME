/**
 * «ציור חי» — a live drawing (wave 8 ink track, version 1 after the verifier's cuts; .artifacts/wave8/ink-plan.md as corrected by
 * ink-verify.md and the lead's Batch B decision). A drawing is the payload kind `ink` of the drawn clip kind (drawn.ts): this file
 * is its contract and registers it on the carrier (registerDrawnKind, at import, from index.ts).
 *
 * Version 1: drawn on a paused frame only; three brushes (marker «טוש», highlighter «מדגש», neon «ניאון»; no chalk); a fixed width
 * per stroke (no pressure); no wiggle; no eraser and no re-opening of the strokes (edit_ink changes play mode, speed and the fade
 * only); played «כמו שצויר» at 1× or «הכול מיד».
 *
 * THE STORED FORM (lead pre-pass decision, by the verifier's numbers, C5):
 * - A stroke is `{ brush, color, width, at, n, pts }`. `pts` packs its n points as 6 bytes each, little-endian: x int16, y int16
 *   (absolute, in INK_UNIT of the frame HEIGHT around the clip's anchor: never deltas, which overflow int16, C5b), dt uint16 (ms
 *   since the previous point; the first point's dt is 0, its time is `at`). Written in base64url without padding.
 * - 6 bytes are exactly 8 characters, so `pts.length === 8·n` and no character carries spare bits: every string of that length
 *   over the alphabet decodes to exactly one byte string and encodes back to itself. The packing is canonical by construction
 *   (C5c) and validation never decodes: one length test and one regex per stroke, plus the first point's dt read from 4 characters.
 *   (Pressure, a 4th channel, was cut; 8 bytes a point would leave 2 spare bits in the last character of every 3rd point.)
 * - Why packed and not plain integer arrays: at the caps, packed is 8 characters a point (MAX_CLIP_POINTS → 64 000 characters of
 *   points, the document cap → 192 000); plain arrays cost up to 20 characters a point ("-32767," twice and a 5-digit time,
 *   ink-verify C10), so 160 000 a clip and 480 000 a document, and zod would check up to 72 000 numbers on each parse. The op
 *   arguments stay readable arrays (InkStrokeInSchema): the op log keeps them beside the packed state (ink-verify C10).
 * - Coordinates are integers in 1/10 000 of the frame height, relative to the clip's anchor (frame centre + transform x/y), so a
 *   move, scale, rotation, keyframes, follow and another format treat a drawing like a title. add_ink puts the anchor at the
 *   centre of the strokes' bounding box.
 * - Colours are canonical upper-case `#RRGGBB` (the op upper-cases its input); speeds are an enum (C5: one spelling per speed).
 * - Strokes have no ids in version 1 (nothing addresses one stroke: no eraser, no re-opening). A later version adds them as an
 *   optional field.
 *
 * Limits: per stroke (MAX_STROKE_POINTS) and per clip (MAX_CLIP_STROKES, MAX_CLIP_POINTS, INK_MAX_CHARS) in the schema; the
 * document cap (MAX_DOC_POINTS) only in add_ink (C6: a split or duplicate near the cap must not fail validation; a split stores
 * the strokes twice, 6 bytes a point a copy). inkDocumentPoints is a report, not a rule.
 *
 * Time (C4, C8): the drawing shown at clip-local time t is D(t) = (offset + t + 1/fps) · 1000 · speed ms, floored to whole ms;
 * frame 0 already shows the first frame's worth (the entrance convention of textAnimation.ts). A split right half and a
 * trim-start move `offset` by the delta (shift), so the picture continues; a start moved left gives a negative offset (the
 * drawing starts later), never clamped. With play 'all' everything is shown from the first frame.
 *
 * What is a heuristic, each a fixed constant (INK_METHOD): the 500 ms gap cap between strokes at capture, the simplification
 * tolerance, the widths of thin/medium/thick, the neon glow numbers. None is a measurement.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { drawnKind, registerDrawnKind, type DrawnBox, type DrawnKindDef, type DrawnPayload } from './drawn.ts';
import { RationalTimeSchema } from './keyframe.ts';
import type { OpErrorCode } from './ops.ts';
import { OpError } from './ops.ts';
import type { ProjectDocument } from './schema.ts';

export const INK_KIND = 'ink' as const;
export const INK_METHOD = 'ink-v1';
/** Units per frame HEIGHT (the unit of title sizes). */
export const INK_UNIT = 10_000;
export const INK_BRUSHES = ['marker', 'highlighter', 'neon'] as const;
export type InkBrush = (typeof INK_BRUSHES)[number];
export const INK_PLAYS = ['drawn', 'all'] as const;
export type InkPlay = (typeof INK_PLAYS)[number];
/** Speeds of «כמו שצויר» (version 1: 1× only; «הכול מיד» is play 'all'). An enum, so each speed has one spelling (C5). */
export const INK_SPEEDS = ['1'] as const;
export type InkSpeed = (typeof INK_SPEEDS)[number];

/** Points of one stroke after simplification (the editor splits a longer stroke into several). */
export const MAX_STROKE_POINTS = 2_000;
/** Raw points of one stroke the editor keeps before simplifying (C11: bounds the O(n²) worst case at pen-up). */
export const MAX_RAW_STROKE_POINTS = 4_000;
export const MAX_CLIP_STROKES = 200;
export const MAX_CLIP_POINTS = 8_000;
/** Summed over every drawing of every sequence; enforced by add_ink only (C6). */
export const MAX_DOC_POINTS = 24_000;
/** ms from the drawing's start to a stroke's first point, and to its last point. */
export const MAX_DRAW_MS = 600_000;
/** ms between two points of one stroke (uint16). */
export const MAX_POINT_GAP_MS = 65_535;
/** int16 bound of a coordinate around the anchor (3.28 frame heights). */
export const INK_COORD_MAX = 32_767;
/** Stroke width in INK_UNIT of the frame height: 0.1 % … 8 %. */
export const INK_WIDTH_MIN = 10, INK_WIDTH_MAX = 800;
/** Heuristics of capture (the editor): pauses between strokes are capped; simplification tolerance (0.06 % of the frame height). */
export const INK_GAP_CAP_MS = 500;
export const INK_SIMPLIFY_EPS = 6;
/** The toolbar's «דק / בינוני / עבה» per brush, in INK_UNIT (heuristic constants; the stored width is the width drawn). */
export const INK_WIDTHS: Readonly<Record<InkBrush, readonly [number, number, number]>> = {
  marker: [40, 80, 160],
  highlighter: [120, 240, 400],
  neon: [40, 80, 160],
};
/** The length a drawing's clip gets beyond its drawing time when add_ink is not given a duration. */
export const INK_HOLD_MS = 2_000;
/** Characters a packed point takes. */
export const PACKED_POINT_CHARS = 8;
const PTS_RE = /^[A-Za-z0-9_-]*$/;
/** Longest JSON of one stroke without its points: `{"brush":"highlighter","color":"#000000","width":800,"at":600000,"n":2000,"pts":""}` and a comma. */
export const INK_STROKE_OVERHEAD_MAX = 84;
/** Longest JSON of the payload without its strokes, with an offset of a 16-digit value and a 16-digit timescale (the time package's fast path is 15 digits; longer offsets only arise from sums of unusual rates and are then refused as too large). */
export const INK_HEADER_MAX = 128;
/** The payload's JSON at the clip caps (DrawnKindDef.limits.maxChars). */
export const INK_MAX_CHARS = INK_HEADER_MAX + MAX_CLIP_STROKES * INK_STROKE_OVERHEAD_MAX + PACKED_POINT_CHARS * MAX_CLIP_POINTS;

// ---------- packing (complete: this IS the stored form) ----------
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) INDEX[ALPHABET.charCodeAt(i)] = i;
const enc6 = (b0: number, b1: number, b2: number) => ALPHABET[b0 >> 2]! + ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]! + ALPHABET[((b1 & 15) << 2) | (b2 >> 6)]! + ALPHABET[b2 & 63]!;
function dec4(s: string, i: number, out: number[]): void {
  const a = INDEX[s.charCodeAt(i)]!, b = INDEX[s.charCodeAt(i + 1)]!, c = INDEX[s.charCodeAt(i + 2)]!, d = INDEX[s.charCodeAt(i + 3)]!;
  out.push((a << 2) | (b >> 4), ((b & 15) << 4) | (c >> 2), ((c & 3) << 6) | d);
}
/** The decoded points of one stroke: x, y around the anchor (INK_UNIT), t in ms since the stroke's first point (absolute within the stroke, non-decreasing). */
export interface InkPoints { x: number[]; y: number[]; t: number[] }
/**
 * Packs points (x, y in int16; t from 0, non-decreasing, each step at most MAX_POINT_GAP_MS). Throws a RangeError on a value outside
 * those bounds: callers check first (add_ink refuses with its own wording).
 */
export function packInkPoints(p: InkPoints): string {
  const n = p.x.length;
  if (p.y.length !== n || p.t.length !== n || n === 0) throw new RangeError('x, y and t must have the same, non-zero length');
  let s = '';
  for (let j = 0; j < n; j++) {
    const x = p.x[j]!, y = p.y[j]!, dt = j === 0 ? p.t[0]! : p.t[j]! - p.t[j - 1]!;
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > INK_COORD_MAX || Math.abs(y) > INK_COORD_MAX) throw new RangeError(`point ${j} is outside ±${INK_COORD_MAX}`);
    if (!Number.isInteger(dt) || dt < 0 || dt > MAX_POINT_GAP_MS || (j === 0 && dt !== 0)) throw new RangeError(`point ${j}: time step ${dt} is outside 0…${MAX_POINT_GAP_MS} (the first is 0)`);
    const ux = x & 0xffff, uy = y & 0xffff;
    s += enc6(ux & 255, ux >> 8, uy & 255) + enc6(uy >> 8, dt & 255, dt >> 8);
  }
  return s;
}
/** Unpacks a stroke's `pts` (any string the schema accepts). */
export function unpackInkPoints(pts: string): InkPoints {
  const x: number[] = [], y: number[] = [], t: number[] = [];
  const b: number[] = [];
  let time = 0;
  for (let i = 0; i < pts.length; i += 8) {
    b.length = 0;
    dec4(pts, i, b); dec4(pts, i + 4, b);
    const ux = b[0]! | (b[1]! << 8), uy = b[2]! | (b[3]! << 8), dt = b[4]! | (b[5]! << 8);
    x.push(ux >= 0x8000 ? ux - 0x10000 : ux); y.push(uy >= 0x8000 ? uy - 0x10000 : uy);
    time += dt; t.push(time);
  }
  return { x, y, t };
}
/** The first point's time step, read from characters 4…7 only (canonical form: it is 0). */
const firstDt = (pts: string): number => { const b: number[] = []; dec4(pts, 4, b); return b[1]! | (b[2]! << 8); };

// ---------- the stored payload ----------
export const InkStrokeSchema = z.object({
  brush: z.enum(INK_BRUSHES),
  color: z.string().regex(/^#[0-9A-F]{6}$/).describe('Upper-case #RRGGBB'),
  width: z.number().int().min(INK_WIDTH_MIN).max(INK_WIDTH_MAX).describe('Line width in 1/10 000 of the frame height'),
  at: z.number().int().min(0).max(MAX_DRAW_MS).describe('ms from the start of the drawing to this stroke\'s first point'),
  n: z.number().int().min(1).max(MAX_STROKE_POINTS),
  pts: z.string().max(PACKED_POINT_CHARS * MAX_STROKE_POINTS).regex(PTS_RE).describe('The points, packed (inkContract.ts); agents read get_timeline\'s summary instead'),
}).strict().superRefine((s, ctx) => {
  if (s.pts.length !== PACKED_POINT_CHARS * s.n) ctx.addIssue({ code: 'custom', path: ['pts'], message: `ink stroke: ${s.pts.length} characters for ${s.n} points; exactly ${PACKED_POINT_CHARS} a point` });
  else if (firstDt(s.pts) !== 0) ctx.addIssue({ code: 'custom', path: ['pts'], message: 'ink stroke: the first point\'s time step is not 0 (not the canonical form)' });
});
export const InkPayloadSchema = z.object({
  kind: z.literal(INK_KIND),
  v: z.literal(1),
  play: z.enum(INK_PLAYS).describe('drawn: draws itself on as it was drawn; all: everything from the first frame'),
  speed: z.enum(INK_SPEEDS),
  /** Drawing time already played at the clip's start (split right halves and trim-start move it; negative = starts later). Absent = 0. */
  offset: RationalTimeSchema.optional(),
  strokes: z.array(InkStrokeSchema).min(1).max(MAX_CLIP_STROKES),
}).strict().superRefine((p, ctx) => {
  const points = p.strokes.reduce((s, k) => s + k.n, 0);
  if (points > MAX_CLIP_POINTS) ctx.addIssue({ code: 'custom', path: ['strokes'], message: `ink: ${points} points in one drawing; at most ${MAX_CLIP_POINTS}` });
  if (p.offset && T.isZero(p.offset)) ctx.addIssue({ code: 'custom', path: ['offset'], message: 'ink: a zero offset is stored as no offset (canonical form)' });
});
export type InkStroke = z.infer<typeof InkStrokeSchema>;
export type InkPayload = z.infer<typeof InkPayloadSchema> & DrawnPayload;
export const isInkPayload = (p: DrawnPayload | null | undefined): p is InkPayload => p?.kind === INK_KIND;

// ---------- the op arguments (readable arrays, for agents and the editor) ----------
export const InkStrokeInSchema = z.object({
  brush: z.enum(INK_BRUSHES),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  width: z.number().int().min(INK_WIDTH_MIN).max(INK_WIDTH_MAX).describe('1/10 000 of the frame height'),
  at: z.number().int().min(0).max(MAX_DRAW_MS).describe('ms from the start of the drawing to the first point'),
  x: z.array(z.number().int()).min(1).max(MAX_STROKE_POINTS).describe('1/10 000 of the frame HEIGHT, from the frame centre, positive to the right'),
  y: z.array(z.number().int()).min(1).max(MAX_STROKE_POINTS).describe('1/10 000 of the frame height, from the frame centre, positive downwards'),
  t: z.array(z.number().int()).min(1).max(MAX_STROKE_POINTS).describe('ms since this stroke\'s first point: starts at 0, never goes back, steps of at most 65 535'),
}).strict();
export type InkStrokeIn = z.infer<typeof InkStrokeInSchema>;

// ---------- refusals (Hebrew: i18n ink.ts HE_INK, each with the next step) ----------
export interface InkRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string): InkRefusalRow<A> => ({ code, message, hint });
/** Every refusal of add_ink and edit_ink (existing OpError codes; `details.ink` names the row). */
export const INK_REFUSALS = {
  lengths: refusal('invalid_args', (i: number) => `ink stroke ${i}: x, y and t have different lengths`, 'Give one x, one y and one t for every point.'),
  time: refusal('invalid_args', (i: number) => `ink stroke ${i}: t must start at 0 and never go back`, 'Give each point\'s ms since the stroke\'s first point, in order.'),
  gap: refusal('out_of_bounds', (i: number, ms: number) => `ink stroke ${i}: ${ms} ms between two points; at most ${MAX_POINT_GAP_MS}`, 'Start a new stroke after a long pause.'),
  coord: refusal('out_of_bounds', (i: number, v: number) => `ink stroke ${i}: a point lies ${v} units from the frame centre; at most ${INK_COORD_MAX}`, 'Keep the points within about three frame heights of the centre.'),
  span: refusal('out_of_bounds', (v: number) => `the drawing spans ${v} units; at most ${INK_COORD_MAX} on each axis`, 'Draw it as two drawings.'),
  long: refusal('out_of_bounds', (i: number, ms: number) => `ink stroke ${i} ends at ${ms} ms; a drawing lasts at most ${MAX_DRAW_MS} ms`, 'Draw a shorter drawing, or split it into two.'),
  strokeTooLong: refusal('out_of_bounds', (i: number, n: number) => `ink stroke ${i} has ${n} points; at most ${MAX_STROKE_POINTS} in one stroke`, 'Split it into shorter strokes (the editor does this while drawing).'),
  tooManyStrokes: refusal('out_of_bounds', (n: number) => `the drawing has ${n} strokes; at most ${MAX_CLIP_STROKES}`, 'Draw it as two drawings.'),
  tooLarge: refusal('out_of_bounds', (n: number) => `the drawing has ${n} points; at most ${MAX_CLIP_POINTS} in one drawing`, 'Draw it as two drawings, or with fewer strokes.'),
  documentFull: refusal('out_of_bounds', (n: number, adding: number) => `the project already holds ${n} of ${MAX_DOC_POINTS} drawing points; this drawing adds ${adding}`, 'Delete an old drawing, or draw this one with fewer strokes.'),
  notInk: refusal('incompatible', (clipId: string) => `clip ${clipId} is not a drawing`, 'Choose a drawing (a clip made with add_ink); get_timeline lists them.'),
  nothing: refusal('invalid_args', () => 'edit_ink: nothing to change', 'Give play, speed or fadeOut.'),
} as const;
export type InkRefusalKey = keyof typeof INK_REFUSALS;
export function inkRefusal<K extends InkRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof INK_REFUSALS)[K]['message']>): OpError {
  const r = INK_REFUSALS[key] as InkRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), { ink: key, ...details }, r.hint);
}
/** Thrown by a pure function of this track that is not built yet (the stubs below). */
export class InkNotBuiltError extends Error {
  readonly code = 'ink_not_built';
  constructor(readonly fn: string) { super(`${fn}: the live drawing is not built in this build yet`); }
}

// ---------- reading a payload (complete) ----------
/** Points of one drawing (a sum of integers; nothing is decoded). */
export const inkPoints = (p: InkPayload): number => p.strokes.reduce((s, k) => s + k.n, 0);
/** Every drawing point of the document, over every sequence (a report for add_ink's cap and for agents; not a validation rule, C6). */
export function inkDocumentPoints(doc: ProjectDocument): number {
  let n = 0;
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.type === 'drawn' && isInkPayload(c.drawn)) n += inkPoints(c.drawn);
  return n;
}
/** ms from the drawing's start to its last point (decodes every stroke). */
export function inkDrawMs(p: InkPayload): number {
  let end = 0;
  for (const s of p.strokes) { const t = unpackInkPoints(s.pts).t; end = Math.max(end, s.at + t[t.length - 1]!); }
  return end;
}
/** Bounding box of the strokes' ink (points widened by half the stroke width), around the anchor, in INK_UNIT. */
export function inkBoxUnits(p: InkPayload): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of p.strokes) {
    const pt = unpackInkPoints(s.pts), h = s.width / 2;
    for (let j = 0; j < s.n; j++) { x0 = Math.min(x0, pt.x[j]! - h); x1 = Math.max(x1, pt.x[j]! + h); y0 = Math.min(y0, pt.y[j]! - h); y1 = Math.max(y1, pt.y[j]! + h); }
  }
  return { x0, y0, x1, y1 };
}
/** DrawnKindDef.box: the ink box in fractions of the frame height. */
export function inkBox(p: InkPayload): DrawnBox {
  const b = inkBoxUnits(p);
  return { x: b.x0 / INK_UNIT, y: b.y0 / INK_UNIT, w: (b.x1 - b.x0) / INK_UNIT, h: (b.y1 - b.y0) / INK_UNIT };
}
/** What agents see (get_timeline, describe_moment, the assistant): counts and the box only, never a stroke's points. */
export function inkSummary(p: InkPayload): Record<string, unknown> {
  const brushes: Record<string, number> = {};
  for (const s of p.strokes) brushes[s.brush] = (brushes[s.brush] ?? 0) + 1;
  return { strokes: p.strokes.length, points: inkPoints(p), brushes, drawMs: inkDrawMs(p), box: inkBox(p), play: p.play, speed: p.speed };
}
/** DrawnKindDef.shift: the drawing time at the clip's start moves with the start (split right half, trim-start). */
export function inkShift(p: InkPayload, s: { delta: T.RationalTime }): InkPayload {
  const offset = T.add(p.offset ?? T.ZERO, s.delta);
  const { offset: _old, ...rest } = p;
  void _old;
  return (T.isZero(offset) ? rest : { ...rest, offset }) as InkPayload;
}

// ---------- the play rule (complete: exact, integer ms) ----------
/** Speed as num/den. */
export const inkSpeedRate = (speed: InkSpeed): { num: number; den: number } => ({ '1': { num: 1, den: 1 } })[speed];
/**
 * The drawing time shown at clip-local time `clipTime` (exact, any sub-frame time a tap or the shutter asks for), in whole ms:
 * floor((offset + clipTime + 1/fps) · 1000 · speed). Infinity for play 'all'. May be negative (a negative offset).
 */
export function inkDrawnMs(p: InkPayload, clipTime: T.RationalTime, fps: T.Rate): number {
  if (p.play === 'all') return Infinity;
  const sp = inkSpeedRate(p.speed);
  const t = T.add(T.add(p.offset ?? T.ZERO, clipTime), T.frameTime(1, fps));
  return T.frameIndexAt(t, { num: 1000 * sp.num, den: sp.den });
}
/**
 * How much of one stroke is drawn at drawing time `drawnMs`: `points` = how many of its points are reached (at + t[j] ≤ drawnMs,
 * integer compares), and `frac` ∈ [0, 1) of the segment from point `points − 1` toward point `points` (one IEEE division of
 * exact integers; 0 when every point or none is reached). The painter draws the polyline of the first `points` points and then
 * `frac` of the next segment; `points === 0` draws nothing.
 */
export function inkStrokeProgress(at: number, t: readonly number[], drawnMs: number): { points: number; frac: number } {
  const n = t.length;
  if (drawnMs === Infinity) return { points: n, frac: 0 };
  let lo = 0, hi = n; // count of j with at + t[j] <= drawnMs (t non-decreasing)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (at + t[mid]! <= drawnMs) lo = mid + 1; else hi = mid; }
  const points = lo;
  if (points === 0 || points === n) return { points, frac: 0 };
  const a = at + t[points - 1]!, b = at + t[points]!;
  return { points, frac: (drawnMs - a) / (b - a) };
}

// ---------- capture helpers: simplifyInkStroke lives in inkSimplify.ts (W1's) ----------

// ---------- registration on the carrier ----------
export const INK_KIND_DEF: DrawnKindDef<InkPayload> = {
  kind: INK_KIND,
  name: { he: 'ציור', en: 'Drawing' },
  schema: InkPayloadSchema as unknown as z.ZodType<InkPayload>,
  limits: { maxChars: INK_MAX_CHARS },
  shift: inkShift,
  summary: inkSummary,
  box: inkBox,
};
if (!drawnKind(INK_KIND)) registerDrawnKind(INK_KIND_DEF);
