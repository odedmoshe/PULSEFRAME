/**
 * «גדלים מול העיניים»: the pure planner (wave 8 growing, W1). Contract: growingContract.ts (frozen); design growing-plan.md §3.3
 * and §4 as corrected by growing-verify.md (C4, C7, C8, C10, C11, C12, C13).
 *
 * Pure and deterministic: no clock, no random source, no I/O, no locale (names compare by code unit); the document is never
 * mutated. The browser's live preview runs this same function (C13), so the numbers it writes come from the same arithmetic.
 *
 * GEOMETRY (exact arithmetic on two points placed by hand; no face detection):
 * - An eye point (u, v) is on the picture AS SHOWN (C4): asset.image.width/height, or asset.video.width/height for a frame,
 *   which is the size the compositor fits (evaluate.ts sourceWidth/sourceHeight). In fitted pixels about the picture's centre
 *   A = ((u − ½)·pw, (v − ½)·ph), pw = w0·f, ph = h0·f, f = fitScale(W, H, w0, h0, fit).
 * - eyes[0] goes to the left target L = (W/2 − E/2, H/2 + eyeLine·H), eyes[1] to the right target R = (W/2 + E/2, same y),
 *   E = faceSize·W. The planner never swaps (C10); suggestEyeOrder is the dialog's default only.
 * - D = B − A, |D| = Math.sqrt(Dx² + Dy²) (rounded exactly by IEEE 754 in every engine). The rotation that turns D onto +x has
 *   cos = Dx/|D| and sin = −Dy/|D|, so the centre needs no trigonometry: c = L − Rot·(scale·A), scale = E/|D|. atan2 is used
 *   once, for the stored degrees (C11). x = (c.x − W/2)/W, y = (c.y − H/2)/H. Each of x, y, scale, rotation is rounded to 1e-6
 *   once (never accumulated).
 * - Coverage (C11): the picture covers the frame iff the four frame corners map inside [0,1]² (both regions are convex). Growing
 *   the face size by k with the eyes on their targets scales about the target midpoint M, which shows the eye midpoint m (inside
 *   the picture whenever both eyes are). A corner C then maps to m + (src(C) − m)/k: per corner and per coordinate exactly one
 *   linear bound on 1/k is active, 8 in all. The smallest covering k is closed form.
 * - The inverse (C7): eyesFromTransform maps L and R back through frameToSource of the stored transform.
 *
 * TIME (ADR-0003): cut_i = start + i·hold in integer frames, each converted once with frameTime; nothing is accumulated. Every hold
 * is at least flashGapFrames(fps) (ADR-0009 decision 3); a shorter request is refused (hold_too_short), never raised (C12).
 */
import * as T from '@pulseframe/time';
import {
  GROWING, GROWING_DEFAULTS, GROWING_METHOD, GROWING_RECIPE_ID, GROWING_TEMPLATE_ID, GROWING_VERSION, GrowingParamsSchema, growingPickKey, growingRefusal, growingRunRecordParams,
  type EyePoint, type EyesFromTransform, type GrowingExclusion, type GrowingFrame, type GrowingPick, type GrowingPicked, type GrowingPlan, type GrowingPlanContext, type GrowingTarget, type GrowingTransform,
  type GrowingWarning, type GrowingWarningCode, type PlanGrowing, type ResolvedGrowingParams, type ShownSize, type SolveAlignment, type SuggestEyeOrder,
} from './growingContract.ts';
import { fitScale, frameToSource, placed } from './geometry.ts';
import { flashGapFrames } from './flashSafety.ts';
import { sourceTimeOfFrame } from './speed.ts';
import { videoFrames } from './momentsContract.ts';
import { compareWall } from './events.ts';
import { addWallSeconds } from './capture.ts';
import { ageParts } from './ageWords.ts';
import { personOf } from './people.ts';
import { anchorOf } from './templatePlan.ts';
import { TemplateError, type PlannedSlot, type TemplateStep } from './templateContract.ts';
import { clipEnd } from './validate.ts';
import type { Asset, ProjectDocument, Track } from './schema.ts';

type RT = T.RationalTime;
type Ref = { $ref: string; out?: string };

/** Bind names of the two tracks a plan may add (the family film's role names, `familyFilmContract.ts` FILM_BINDS.pictures). */
export const GROWING_BINDS = { pictures: 'pictures-track', captions: 'captions-track' } as const;
/** The text style of a caption (textPresets.ts), its place (y from the frame centre, a fraction of the height). */
export const GROWING_CAPTION = { presetId: 'subtitle-soft', y: 0.4 } as const;
/** Slot key of the caption of a pick: 'c' + the pick key's 12 hex (a BIND_NAME). */
export const growingCaptionKey = (pickKey: string): string => `c${pickKey.slice(1)}`;

/** Rounded once to 1e-6; −0 written as 0. */
const round6 = (v: number): number => { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; };
const own = <V>(rec: Readonly<Record<string, V>> | undefined | null, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
/** Code-unit order (no locale: the same in every engine). */
const byCode = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const isStillAsset = (a: Asset): boolean => a.kind === 'image';
const hasPicture = (a: Asset): boolean => (a.kind === 'image' && !!a.image) || (a.kind === 'video' && !!a.video);
/** The size a picture is shown at (C4): what ingest recorded after EXIF orientation, and what the compositor fits. */
export const shownSizeOf = (a: Asset): ShownSize | null => (a.kind === 'image' && a.image ? { width: a.image.width, height: a.image.height } : a.kind === 'video' && a.video ? { width: a.video.width, height: a.video.height } : null);
/** The frame a document places pictures in. */
export const growingFrameOf = (doc: ProjectDocument): GrowingFrame => ({ width: doc.settings.width, height: doc.settings.height, fit: doc.settings.fit ?? 'contain' });

// ---------- the solve ----------
interface Solved {
  /** Unrounded: cos and sin of the rotation (from D, no trigonometry), the scale, the centre in frame px. */
  c: number; s: number; scale: number; cx: number; cy: number;
  /** Fitted picture size in frame px before the scale. */
  pw: number; ph: number; f: number;
  /** Distance of the two points on the picture as shown, in shown px. */
  shownDistance: number;
}
function solveRaw(eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget): Solved {
  const W = frame.width, H = frame.height;
  const f = fitScale(W, H, shown.width, shown.height, frame.fit);
  const pw = shown.width * f, ph = shown.height * f;
  const ax = (eyes[0].u - 0.5) * pw, ay = (eyes[0].v - 0.5) * ph;
  const bx = (eyes[1].u - 0.5) * pw, by = (eyes[1].v - 0.5) * ph;
  const dx = bx - ax, dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const E = target.faceSize * W;
  const c = len > 0 ? dx / len : 1, s = len > 0 ? -dy / len : 0;
  const scale = len > 0 ? E / len : Infinity;
  const Lx = W / 2 - E / 2, Ly = H / 2 + target.eyeLine * H;
  const cx = Lx - scale * (c * ax - s * ay), cy = Ly - scale * (s * ax + c * ay);
  const sdx = (eyes[1].u - eyes[0].u) * shown.width, sdy = (eyes[1].v - eyes[0].v) * shown.height;
  return { c, s, scale, cx, cy, pw, ph, f, shownDistance: Math.sqrt(sdx * sdx + sdy * sdy) };
}
const transformOf = (r: Solved, frame: GrowingFrame): GrowingTransform => ({
  x: round6((r.cx - frame.width / 2) / frame.width), y: round6((r.cy - frame.height / 2) / frame.height),
  scale: round6(r.scale), rotation: round6((Math.atan2(r.s, r.c) * 180) / Math.PI),
});
const transformInBounds = (t: GrowingTransform): boolean => Number.isFinite(t.scale) && t.scale >= 0.01 && t.scale <= 20 && Math.abs(t.x) <= 4 && Math.abs(t.y) <= 4 && Number.isFinite(t.x) && Number.isFinite(t.y) && Math.abs(t.rotation) <= 3600;

/** The solve before its one rounding (tests and the inverse's tolerance): the exact formula of §4.3. */
export function growingSolveExact(eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget): GrowingTransform {
  const r = solveRaw(eyes, shown, frame, target);
  return { x: (r.cx - frame.width / 2) / frame.width, y: (r.cy - frame.height / 2) / frame.height, scale: r.scale, rotation: (Math.atan2(r.s, r.c) * 180) / Math.PI };
}
/** Plan §4.1–4.4 with C10, C11: the similarity transform for one pick (no swap; centre without trigonometry). */
export const solveAlignment: SolveAlignment = (eyes, shown, frame, target) => {
  const r = solveRaw(eyes, shown, frame, target);
  const transform = transformOf(r, frame);
  return { transform, magnification: r.scale * r.f, inBounds: transformInBounds(transform) };
};

/**
 * C7/C8: the exact inverse of solveAlignment, used by the rebuild for untouched picks and by the dialog to place computed points.
 * Refuses (GrowingError needs_marks wording, code invalid_args) when the transform cannot be one the planner wrote for two eye
 * points: a target falls off the picture, or the two points come out closer than GROWING.minEyeShownPx. A transform changed by
 * hand that still lands both targets on the picture gives other points back; telling such a clip apart is the rebuild's job
 * (the server's fingerprint test, runHandEdits), not something a transform alone can show. No point value is put in the error.
 */
/**
 * The stated tolerance of the inverse (a share of the picture's width and height): how far the ONE rounding of the stored transform
 * to 1e-6 can move a point given back. x and y move the picture by up to ½·1e-6 of the frame; the scale moves a point r fitted px from
 * the picture centre by ½·1e-6·r; the rotation by ½·1e-6° at r·scale. Divided by frame px per unit of the picture (scale·pw, scale·ph),
 * with r the half diagonal. About 2e-5 for a 4000×3000 photo at 1080p and face size 14%; larger for tiny scales. Pure.
 */
export function growingInverseTolerance(transform: GrowingTransform, shown: ShownSize, frame: GrowingFrame): { u: number; v: number } {
  const f = fitScale(frame.width, frame.height, shown.width, shown.height, frame.fit);
  const pw = shown.width * f, ph = shown.height * f, r = Math.sqrt(pw * pw + ph * ph) / 2;
  const px = 0.5e-6 * (frame.width + frame.height) + 0.5e-6 * r * (1 + (Math.PI / 180) * transform.scale) + 1e-9 * (frame.width + frame.height);
  return { u: px / (transform.scale * pw) + 1e-12, v: px / (transform.scale * ph) + 1e-12 };
}
/**
 * C7/C8: the exact inverse of solveAlignment, used by the rebuild for untouched picks and by the dialog to place computed points.
 * A point given back up to growingInverseTolerance outside the picture (an eye marked on its very edge) is put back on the edge.
 * Refuses (the needs_marks wording, code invalid_args) when the transform cannot be one the planner wrote for two eye points: a
 * target falls further off the picture, or the two points come out closer than GROWING.minEyeShownPx. A transform changed by hand
 * that still lands both targets on the picture gives other points back: telling such a clip apart is the rebuild's job (the
 * server's fingerprint test, runHandEdits), not something a transform alone can show. No point value is put in the refusal.
 */
export const eyesFromTransform: EyesFromTransform = (transform, shown, frame, target) => {
  const W = frame.width, H = frame.height, E = target.faceSize * W;
  const p = placed(W, H, frame.fit, shown.width, shown.height, transform);
  const y = H / 2 + target.eyeLine * H;
  const a = frameToSource(p, W / 2 - E / 2, y), b = frameToSource(p, W / 2 + E / 2, y);
  const pts = [a, b], tol = growingInverseTolerance(transform, shown, frame);
  if (!pts.every((q) => Number.isFinite(q.u) && Number.isFinite(q.v)) || pts.some((q) => q.u < -tol.u || q.u > 1 + tol.u || q.v < -tol.v || q.v > 1 + tol.v)) {
    throw growingRefusal('needsMarks', { reason: 'transform_off_picture' });
  }
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const out: [EyePoint, EyePoint] = [{ u: clamp(a.u), v: clamp(a.v) }, { u: clamp(b.u), v: clamp(b.v) }];
  const dx = (out[1].u - out[0].u) * shown.width, dy = (out[1].v - out[0].v) * shown.height;
  if (Math.sqrt(dx * dx + dy * dy) < GROWING.minEyeShownPx) throw growingRefusal('needsMarks', { reason: 'points_too_close' });
  return out;
};

/**
 * C10: the default order of two clicks (the swap rule as a default only, heuristic: assumes the face is not upside down). The
 * angle of b − a in shown pixels exceeds 90° in magnitude exactly when its horizontal part is negative, so no trigonometry is
 * needed; at exactly ±90° (one point straight above the other: a baby lying down) the clicks are kept as given.
 */
export const suggestEyeOrder: SuggestEyeOrder = (a, b, shown) => ((b.u - a.u) * shown.width < 0 ? [b, a] : [a, b]);

// ---------- coverage (C11) ----------
/**
 * The factor k by which the face size must grow (eyes on their targets) so that the picture covers every frame corner; ≤ 1 when it
 * already does, Infinity when no size can (the eye midpoint on the picture's edge). Closed form: 8 linear bounds on 1/k.
 */
export function growingCoverFactor(eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget): number {
  const r = solveRaw(eyes, shown, frame, target);
  const mu = (eyes[0].u + eyes[1].u) / 2, mv = (eyes[0].v + eyes[1].v) / 2;
  if (!(mu >= 0 && mu <= 1 && mv >= 0 && mv <= 1) || !Number.isFinite(r.scale)) return Infinity;
  let t = Infinity;
  for (const [px, py] of [[0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height]] as const) {
    const q = toSource(r, px, py);
    for (const [d, m] of [[q.u - mu, mu], [q.v - mv, mv]] as const) {
      if (d > 0) t = Math.min(t, (1 - m) / d);
      else if (d < 0) t = Math.min(t, m / -d);
    }
  }
  return t <= 0 ? Infinity : 1 / t;
}
/** Frame px → normalised point of the picture, with the unrounded solve (cos/sin from D). */
function toSource(r: Solved, px: number, py: number): { u: number; v: number } {
  const dx = px - r.cx, dy = py - r.cy;
  return { u: (r.c * dx + r.s * dy) / (r.scale * r.pw) + 0.5, v: (-r.s * dx + r.c * dy) / (r.scale * r.ph) + 0.5 };
}
/** Share (0..1) of the GROWING.coverageGrid frame points (cell centres) the picture does not cover: a measurement. */
export function growingUncoveredShare(eyes: readonly [EyePoint, EyePoint], shown: ShownSize, frame: GrowingFrame, target: GrowingTarget): number {
  const r = solveRaw(eyes, shown, frame, target);
  const { cols, rows } = GROWING.coverageGrid;
  let out = 0;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = toSource(r, ((i + 0.5) / cols) * frame.width, ((j + 0.5) / rows) * frame.height);
    if (!(q.u >= 0 && q.u <= 1 && q.v >= 0 && q.v <= 1)) out++;
  }
  return round6(out / (cols * rows));
}

// ---------- the plan ----------
interface Checked {
  index: number; key: string; asset: Asset; frame: number | null; eyes: [EyePoint, EyePoint] | null; shown: ShownSize;
  /** Capture moment of the shown picture (life line wall clock), or null. */
  moment: string | null;
  state: 'place' | 'kept' | 'removed' | 'needs_marks';
}
const ZERO_DETAILS = (): Record<string, unknown> => ({});

/** Plan §3.3 and §4 with verifier C10–C12: transforms, order, holds, dissolves, captions, coverage, steps and slots. */
export const planGrowing: PlanGrowing = (doc: ProjectDocument, params: unknown, ctx: GrowingPlanContext): GrowingPlan => {
  // ===== parameters =====
  const parsed = GrowingParamsSchema.safeParse(params ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    if (issue.code === 'too_small' && issue.path.length === 1 && issue.path[0] === 'picks') throw growingRefusal('tooFew', { path: 'picks' });
    const path = issue.path.map(String).join('.') || '(params)';
    throw growingRefusal('badParams', { path }, `${path}: ${issue.message}`);
  }
  const p0 = parsed.data;
  const rate = doc.settings.frameRate, fps = rate.num / rate.den, gap = flashGapFrames(fps);
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) throw growingRefusal('badParams', { path: 'sequence' }, 'the project has no main sequence');
  let at: RT;
  try { at = anchorOf(doc, p0.at); } catch (e) { if (e instanceof TemplateError) throw growingRefusal('badParams', { path: 'at' }, `at: ${e.message}`); throw e; }
  const frame = growingFrameOf(doc);
  const rebuild = ctx.keptKeys !== undefined || ctx.removedKeys !== undefined || ctx.movedKeys !== undefined || ctx.reuseTracks !== undefined;
  const keptKeys = new Set(ctx.keptKeys ?? []);
  const removedKeys = new Set((ctx.removedKeys ?? []).filter((k) => !keptKeys.has(k)));

  // ===== every pick: the file, the frame, the eyes =====
  const checked: Checked[] = [];
  const seen = new Set<string>();
  for (const [index, pk] of p0.picks.entries()) {
    const key = growingPickKey(pk.assetId, pk.frame);
    const at_ = { index, assetId: pk.assetId, frame: pk.frame };
    if (seen.has(key)) throw growingRefusal('duplicatePick', at_);
    seen.add(key);
    const removed = removedKeys.has(key), kept = keptKeys.has(key);
    const asset = own(doc.assets, pk.assetId);
    if (!asset) {
      if (removed) { checked.push({ index, key, asset: null as never, frame: pk.frame, eyes: null, shown: { width: 1, height: 1 }, moment: null, state: 'removed' }); continue; }
      throw growingRefusal('assetMissing', at_);
    }
    if (!hasPicture(asset)) throw growingRefusal('noPicture', at_);
    if (isStillAsset(asset)) { if (pk.frame !== null) throw growingRefusal('frameOnStill', at_); }
    else {
      if (pk.frame === null) throw growingRefusal('noFrame', at_);
      const frames = videoFrames(asset) ?? 0;
      if (pk.frame >= frames || !T.lt(sourceTimeOfFrame(asset, pk.frame), asset.duration)) throw growingRefusal('noSuchFrame', { ...at_, frames });
    }
    const shown = shownSizeOf(asset)!;
    let state: Checked['state'] = removed ? 'removed' : kept ? 'kept' : 'place';
    if (state === 'place' && !pk.eyes) {
      if (!rebuild) throw growingRefusal('needsMarks', at_);
      state = 'needs_marks';
    }
    if (state === 'place' && pk.eyes) {
      const sdx = (pk.eyes[1].u - pk.eyes[0].u) * shown.width, sdy = (pk.eyes[1].v - pk.eyes[0].v) * shown.height;
      if (Math.sqrt(sdx * sdx + sdy * sdy) < GROWING.minEyeShownPx) throw growingRefusal('eyesTooClose', { ...at_, minShownPx: GROWING.minEyeShownPx });
    }
    // the capture moment the caption's fields read: the file's shown capture + whole source seconds of the held frame (fields.ts)
    const wall = own(ctx.capture, pk.assetId) ?? null;
    let moment: string | null = wall;
    if (wall !== null && pk.frame !== null) {
      try { moment = addWallSeconds(wall, T.frameIndexAt(sourceTimeOfFrame(asset, pk.frame), { num: 1, den: 1 })); } catch { moment = null; }
    }
    checked.push({ index, key, asset, frame: pk.frame, eyes: pk.eyes ? [pk.eyes[0], pk.eyes[1]] : null, shown, moment, state });
  }
  const personId = p0.personId ?? null;
  const person = personId !== null ? personOf(doc, personId) : null;
  if (personId !== null && !person) throw growingRefusal('personMissing', { personId });
  const holdFrames = p0.holdFrames ?? Math.max(Math.round(fps * GROWING.defaultHoldSeconds), gap);
  if (holdFrames < gap) throw growingRefusal('holdTooShort', { minFrames: gap, holdFrames, fps: round6(fps) }, gap);
  const caption = p0.caption ?? GROWING_DEFAULTS.caption;
  if (caption?.age && personId === null) throw growingRefusal('badParams', { path: 'personId' }, 'personId: an age caption needs the person whose age it shows');

  const P: ResolvedGrowingParams = {
    picks: p0.picks.map((x) => ({ ...x })), sort: p0.sort ?? GROWING_DEFAULTS.sort, holdFrames, dissolve: p0.dissolve ?? GROWING_DEFAULTS.dissolve,
    faceSize: p0.faceSize ?? GROWING_DEFAULTS.faceSize, eyeLine: p0.eyeLine ?? GROWING_DEFAULTS.eyeLine, fill: 'colour', caption: caption ? { date: caption.date, age: caption.age } : null, personId, at,
  };
  const target: GrowingTarget = { faceSize: P.faceSize, eyeLine: P.eyeLine };
  const warnings: GrowingWarning[] = [], steps: string[] = [], basis: string[] = [];
  const warn = (code: GrowingWarningCode, message: string, details: Record<string, unknown> = ZERO_DETAILS()) => warnings.push({ code, message, details });
  const excluded: GrowingExclusion[] = [];
  const exclude = (c: Checked, code: GrowingExclusion['code'], details: Record<string, unknown> = ZERO_DETAILS()) => excluded.push({ key: c.key, assetId: c.asset ? c.asset.id : P.picks[c.index]!.assetId, frame: c.frame, code, details });

  // ===== order (§4.7) =====
  const live = checked.filter((c) => c.state !== 'removed');
  let ordered: Checked[];
  if (P.sort === 'given') ordered = live;
  else {
    const dated = live.filter((c) => c.moment !== null).sort((a, b) => compareWall(a.moment!, b.moment!) || byCode(a.asset.name, b.asset.name) || (a.frame ?? -1) - (b.frame ?? -1) || a.index - b.index);
    const followers = new Map<number, Checked[]>(); // given index of the pick before (-1 = the start) → undated picks right after it
    for (const [i, c] of live.entries()) if (c.moment === null) { const before = i === 0 ? -1 : live[i - 1]!.index; followers.set(before, [...(followers.get(before) ?? []), c]); }
    ordered = [];
    const emit = (c: Checked) => { ordered.push(c); for (const x of followers.get(c.index) ?? []) emit(x); };
    for (const x of followers.get(-1) ?? []) emit(x);
    for (const c of dated) emit(c);
  }

  // ===== transforms, exclusions (§4.1–4.4) =====
  const solved = new Map<string, { transform: GrowingTransform; magnification: number; k: number; share: number }>();
  for (const c of ordered) {
    if (c.state === 'kept') { exclude(c, 'kept_by_hand'); continue; }
    if (c.state === 'needs_marks') { exclude(c, 'needs_marks'); continue; }
    if (c.state !== 'place') continue;
    const s = solveAlignment(c.eyes!, c.shown, frame, target);
    if (!s.inBounds) { exclude(c, 'outside_transform_range', { scale: s.transform.scale, x: s.transform.x, y: s.transform.y }); continue; }
    solved.set(c.key, { transform: s.transform, magnification: round6(s.magnification), k: growingCoverFactor(c.eyes!, c.shown, frame, target), share: growingUncoveredShare(c.eyes!, c.shown, frame, target) });
  }
  for (const c of checked) if (c.state === 'removed') exclude(c, 'removed_by_hand');
  // the film: placed picks and picks kept by hand keep their places in the order; the rest leave no gap
  const film = ordered.filter((c) => solved.has(c.key) || c.state === 'kept');
  const placedCount = film.filter((c) => solved.has(c.key)).length;
  if (film.length < GROWING.minPictures) throw growingRefusal('tooFew', { inFilm: film.length, excluded: excluded.length });

  // ===== time (§4.8): integer frames, nothing accumulated =====
  const startF = T.frameIndexAt(at, rate);
  const ft = (f: number) => T.frameTime(f, rate);
  const D = P.dissolve === 'none' ? 0 : Math.max(1, Math.min(GROWING.maxDissolveFrames, Math.floor(((P.dissolve === 'short' ? 1 : 2) * holdFrames) / 3)));
  const slotStart = (i: number) => startF + i * holdFrames;
  const endF = slotStart(film.length);

  // ===== captions (§4.6): only fields that will have words =====
  const captions = new Map<string, string>();
  const noCaption = { undated: [] as string[], beforeBirth: [] as string[], noBirth: [] as string[] };
  const reasons = new Map<string, GrowingWarningCode[]>();
  const reason = (key: string, code: GrowingWarningCode) => reasons.set(key, [...(reasons.get(key) ?? []), code]);
  if (P.caption && (P.caption.date || P.caption.age)) {
    for (const c of film) {
      const ck = growingCaptionKey(c.key);
      if (keptKeys.has(ck) || removedKeys.has(ck)) continue;
      if (c.moment === null) { noCaption.undated.push(c.key); reason(c.key, 'undated_no_caption'); continue; }
      const parts: string[] = [];
      if (P.caption.date) parts.push('{date}');
      if (P.caption.age && person) {
        if (person.birthDate === null) { noCaption.noBirth.push(c.key); reason(c.key, 'no_birth_date'); }
        else if (!ageParts(person.birthDate, c.moment.slice(0, 10))) { noCaption.beforeBirth.push(c.key); reason(c.key, 'before_birth'); }
        else parts.push(`{age:${person.id}}`);
      }
      if (parts.length) captions.set(c.key, parts.join(' · '));
    }
  }

  // ===== warnings =====
  const placedChecked = film.filter((c) => solved.has(c.key));
  const enlarged = placedChecked.filter((c) => solved.get(c.key)!.magnification > GROWING.enlargedAbove);
  for (const c of enlarged) reason(c.key, 'enlarged');
  if (enlarged.length) {
    const top = Math.max(...enlarged.map((c) => solved.get(c.key)!.magnification));
    warn('enlarged', `${enlarged.length} picture(s) are enlarged more than ${GROWING.enlargedAbove}× (up to ×${top.toFixed(1)}: frame pixels per picture pixel); they may look soft (heuristic)`, { picks: enlarged.map((c) => ({ key: c.key, magnification: solved.get(c.key)!.magnification })) });
  }
  const uncovered = placedChecked.filter((c) => solved.get(c.key)!.k > 1 + 1e-9);
  for (const c of uncovered) reason(c.key, 'uncovered_corners');
  // suggestedFaceSize: the smallest face size at which every placed pick covers every corner, re-checked against the bounds
  const K = placedChecked.reduce((m, c) => Math.max(m, solved.get(c.key)!.k), 0);
  let suggestedFaceSize: number | null = null;
  if (placedChecked.length && Number.isFinite(K)) {
    const want = Math.max(GROWING.faceSize.min, Math.ceil(P.faceSize * K * 1e6 - 1e-6) / 1e6);
    if (want <= GROWING.faceSize.max && placedChecked.every((c) => solveAlignment(c.eyes!, c.shown, frame, { faceSize: want, eyeLine: P.eyeLine }).inBounds)) suggestedFaceSize = want;
  }
  if (uncovered.length) {
    const worst = Math.max(...uncovered.map((c) => solved.get(c.key)!.share));
    warn('uncovered_corners', `${uncovered.length} picture(s) do not reach every corner of the frame at this face size (up to ${(worst * 100).toFixed(1)}% of the frame, measured on a ${GROWING.coverageGrid.cols}×${GROWING.coverageGrid.rows} grid); the background colour shows there${suggestedFaceSize !== null ? `. A face size of ${(suggestedFaceSize * 100).toFixed(1)}% of the frame width reaches every corner` : ''}`,
      { picks: uncovered.map((c) => ({ key: c.key, uncoveredShare: solved.get(c.key)!.share })), suggestedFaceSize });
    if (suggestedFaceSize === null) {
      const named = [...uncovered].sort((a, b) => solved.get(b.key)!.k - solved.get(a.key)!.k || a.index - b.index).slice(0, 5);
      warn('cannot_cover_all', `no face size up to ${(GROWING.faceSize.max * 100).toFixed(0)}% of the frame width lets every picture reach every corner; the pictures that need the most: ${named.map((c) => `"${quote(c.asset.name)}"${c.frame !== null ? ` frame ${c.frame}` : ''}`).join(', ')}`,
        { keys: named.map((c) => c.key) });
    }
  }
  if (noCaption.undated.length) warn('undated_no_caption', `${noCaption.undated.length} picture(s) have no capture date, so they get no caption (a caption never shows a field without words)`, { keys: noCaption.undated });
  if (noCaption.beforeBirth.length) warn('before_birth', `${noCaption.beforeBirth.length} picture(s) were taken before the birth date, so their caption shows no age`, { keys: noCaption.beforeBirth });
  if (noCaption.noBirth.length) warn('no_birth_date', `the person has no birth date in the people sheet, so ${noCaption.noBirth.length} caption(s) show no age`, { keys: noCaption.noBirth });
  if (Object.keys(doc.variants ?? {}).length) warn('other_formats_not_aligned', 'the eyes line up in this frame only; the linked formats of this project place the pictures in their own frames, where the eyes do not line up', { variants: Object.keys(doc.variants).length });
  const pngLike = placedChecked.filter((c) => c.asset.kind === 'image' && /^image\/(png|webp)$/i.test(c.asset.mimeType));
  for (const c of pngLike) reason(c.key, 'orientation_unverified');
  if (pngLike.length) warn('orientation_unverified', `${pngLike.length} PNG or WebP picture(s): an orientation tag in these files is not checked in this build, so a picture may show turned and its marks would land wrong`, { keys: pngLike.map((c) => c.key) });
  if (ctx.keptKeys?.length) warn('kept_by_hand', `${ctx.keptKeys.length} item(s) of the last film were edited by hand and are kept exactly as they are`, { keys: [...ctx.keptKeys].sort() });
  if (removedKeys.size) warn('removed_by_hand', `${removedKeys.size} item(s) of the last film were deleted by hand and are not made again; a deleted picture needs its eyes marked again to come back`, { keys: [...removedKeys].sort() });
  const movedBack = [...new Set(ctx.movedKeys ?? [])].sort();
  if (movedBack.length) warn('moved_back', `${movedBack.length} picture(s) of the last film had only moved in time; they go back to their places`, { keys: movedBack });
  warn('flash_checked_after_export', `every picture stays at least ${gap} frames (at most three changes a second); whether a change between bright and dark pictures flashes is measured only by the check after export (no flash warning before export in this build)`, { minFrames: gap });

  // ===== ops =====
  const ops: TemplateStep[] = [];
  const slots: PlannedSlot[] = [];
  const ref = (bind: string, out?: string): Ref => (out ? { $ref: bind, out } : { $ref: bind });
  const placedRanges = film.flatMap((c, i) => (solved.has(c.key) ? [[slotStart(i), slotStart(i + 1)] as [number, number]] : []));
  const captionRanges = film.flatMap((c, i) => (captions.has(c.key) ? [[slotStart(i), slotStart(i + 1)] as [number, number]] : []));
  const nf = (t: RT) => T.nearestFrameIndex(t, rate);
  const free = (t: Track, ranges: readonly [number, number][]) => ranges.every(([s, e]) => !t.clips.some((c) => nf(c.start) < e && s < nf(clipEnd(c))));
  const taken = new Set<string>();
  type TrackUse = { arg: string | Ref; status: 'reused' | 'empty' | 'new'; name: string };
  const chooseTrack = (kind: 'video' | 'text', reuse: string | undefined, bind: string, ranges: readonly [number, number][]): TrackUse => {
    const r = reuse ? seq.tracks.find((t) => t.id === reuse) : undefined;
    if (r && r.kind === kind && !r.locked && !r.hidden && !taken.has(r.id) && free(r, ranges)) { taken.add(r.id); return { arg: r.id, status: 'reused', name: r.name }; }
    const e = seq.tracks.find((t) => t.kind === kind && !t.locked && !t.hidden && t.clips.length === 0 && !taken.has(t.id));
    if (e) { taken.add(e.id); return { arg: e.id, status: 'empty', name: e.name }; }
    ops.push({ op: 'add_track', args: { kind }, bind });
    return { arg: ref(bind, 'trackId'), status: 'new', name: kind === 'video' ? 'a new picture track' : 'a new title track' };
  };
  const pictures = placedRanges.length ? chooseTrack('video', ctx.reuseTracks?.pictures, GROWING_BINDS.pictures, placedRanges) : null;
  const captionTrack = captionRanges.length ? chooseTrack('text', ctx.reuseTracks?.captions, GROWING_BINDS.captions, captionRanges) : null;
  const picks: GrowingPick[] = [];
  let firstInFilm = true;
  for (const [i, c] of film.entries()) {
    const s = solved.get(c.key);
    const startI = slotStart(i);
    if (!s) { firstInFilm = false; continue; }
    const freeze = !isStillAsset(c.asset);
    ops.push({ op: 'add_clip', args: freeze
      ? { assetId: c.asset.id, trackId: pictures!.arg, start: ft(startI), duration: ft(holdFrames), sourceIn: sourceTimeOfFrame(c.asset, c.frame!), freeze: true }
      : { assetId: c.asset.id, trackId: pictures!.arg, start: ft(startI), duration: ft(holdFrames), withLinkedAudio: false }, bind: c.key });
    ops.push({ op: 'set_clip_transform', args: { clipId: ref(c.key), transform: { ...s.transform } } });
    const dissolve = firstInFilm ? 0 : D;
    if (dissolve > 0) ops.push({ op: 'set_transition', args: { clipId: ref(c.key), type: 'dissolve', frames: dissolve } });
    slots.push({ key: c.key, kind: 'picture', clipId: ref(c.key), accept: freeze ? 'video' : 'image' });
    picks.push({ key: c.key, assetId: c.asset.id, frame: c.frame, order: i, capture: c.moment, startFrame: startI, frames: holdFrames, dissolveFrames: dissolve, transform: { ...s.transform }, magnification: s.magnification, uncoveredShare: s.share, caption: captions.get(c.key) ?? null, reasons: [...new Set(reasons.get(c.key) ?? [])] });
    firstInFilm = false;
  }
  for (const [i, c] of film.entries()) {
    const text = captions.get(c.key);
    if (!text) continue;
    const ck = growingCaptionKey(c.key);
    ops.push({ op: 'add_text', args: { trackId: captionTrack!.arg, text, start: ft(slotStart(i)), duration: ft(holdFrames), transform: { x: 0, y: GROWING_CAPTION.y }, presetId: GROWING_CAPTION.presetId, fields: true }, bind: ck });
    slots.push({ key: ck, kind: 'text', clipId: ref(ck) });
  }
  if (ops.length > GROWING.maxOps || slots.length > GROWING.maxSlots) throw growingRefusal('badParams', { ops: ops.length, slots: slots.length }, `picks: the plan needs ${ops.length} operations and ${slots.length} slots, more than one step can hold`);

  // ===== steps and basis (words only; never a point) =====
  const secs = (f: number) => `${(f / fps).toFixed(2)} s`;
  if (placedCount) steps.push(`Place ${placedCount} picture(s) on ${pictures!.status === 'new' ? pictures!.name : `track ${pictures!.name}`} from ${secs(startF)}, each held ${holdFrames} frames (${secs(holdFrames)}), ${P.sort === 'capture' ? 'in the order they were taken (undated ones after the picture before them in your list)' : 'in the order chosen'}${film.length > placedCount ? `; ${film.length - placedCount} picture(s) edited by hand keep their places` : ''}`);
  if (placedCount) steps.push(`Turn, size and move each picture so that the two eye points you marked land on the same two points of the frame: ${(P.faceSize * 100).toFixed(1)}% of the frame width apart, the eye line ${Math.abs(P.eyeLine * 100).toFixed(1)}% of the height ${P.eyeLine <= 0 ? 'above' : 'below'} the centre`);
  if (D > 0 && placedCount > 1) steps.push(`Dissolve from one picture to the next over ${D} frames (${secs(D)})`);
  else if (P.dissolve === 'none') steps.push('Cut from one picture to the next without a dissolve');
  if (captions.size) steps.push(`Add a caption with live fields (${[P.caption?.date ? 'the date' : null, captions.size && P.caption?.age && [...captions.values()].some((t) => t.includes('{age:')) ? 'the age' : null].filter(Boolean).join(' and ')}) under ${captions.size} dated picture(s) on ${captionTrack!.status === 'new' ? captionTrack!.name : `track ${captionTrack!.name}`}`);
  basis.push(GROWING_METHOD);
  basis.push('the alignment is exact arithmetic on the two points placed by hand; whether it looks right is only known by looking at it');
  basis.push(`the order follows the capture times the life line shows${P.sort === 'given' ? ' (not used: the order is as chosen)' : ''}; a picture without a date stays after the picture before it in your list`);
  basis.push(`the uncovered share is measured on a ${GROWING.coverageGrid.cols}×${GROWING.coverageGrid.rows} grid of frame points; "enlarged" is a heuristic above ${GROWING.enlargedAbove}× frame pixels per picture pixel`);
  basis.push('the eye points are not stored: the run keeps the pictures, their order and the settings; the pictures\' places in the film give the eye positions back');

  // ===== the record (never a coordinate) =====
  const picked: GrowingPicked[] = film.map((c) => ({ key: c.key, assetId: c.asset.id, frame: c.frame }));
  const removedPicks: GrowingPicked[] = checked.filter((c) => c.state === 'removed').map((c) => ({ key: c.key, assetId: P.picks[c.index]!.assetId, frame: c.frame }));
  const record = growingRunRecordParams(P, picked, removedPicks);

  return {
    recipeId: GROWING_RECIPE_ID, templateId: GROWING_TEMPLATE_ID, version: GROWING_VERSION, params: P, record,
    steps: steps.map(clip400), basis: basis.map(clip400), warnings, picks, excluded, ops, slots, suggestedFaceSize,
    predicted: { startFrame: startF, endFrame: endF, holdFrames, dissolveFrames: D, seconds: Math.round(((endF - startF) / fps) * 100) / 100 },
    method: GROWING_METHOD,
  };
};
const clip400 = (s: string) => (s.length > 400 ? `${s.slice(0, 399)}…` : s);
const quote = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
