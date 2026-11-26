/**
 * What the «הפריים הכי חד» block and the «שמירת התמונה» dialog show and do, as pure functions (wave 8 cover, version 1). The components
 * only draw what these return. Nothing here measures anything: the numbers are the server's (core stillsContract.ts SharpAnswer),
 * every one of them is shown with its words, and nothing is called good, right, sharp or safe: a heuristic stays a heuristic.
 * The paper maths (printFit, defaultCrop, snapCrop) are core's; they are passed in as `CropMath` so a test can give a labelled
 * stand-in while the real bodies were not yet in this worktree. All sizes are integers; all times are rationals.
 */
import * as T from '@pulseframe/time';
import {
  defaultCrop, isMovingPicture, PAPER_IDS, printFit, snapCrop, sourceTimeOfFrame, STILL_MAX_SIDE, STILL_TRIED_MAX_PIXELS, STILLS_REFUSALS, videoFrames,
  type Asset, type Orientation, type PaperId, type SharpAnswer, type StillCrop, type StillExport, type StillMeasure, type StillOutput,
} from '@pulseframe/core';

// ---------- number words ----------
/** Hundredths as text: 131 → "1.31". */
export const hundredthsText = (h: number): string => `${Math.floor(h / 100)}.${String(h % 100).padStart(2, '0')}`;
/** A ratio in permille as ×r.rr's number: 1310 → "1.31" (rounded half up to the hundredth, integers only). */
export const ratioText = (permille: number): string => hundredthsText(Math.round(permille / 10));
/** σ × 100 as text: 600 → "6.00". */
export const sigmaText = (sigma100: number): string => hundredthsText(sigma100);
/** Permille as a percent with one decimal: 125 → "12.5". */
export const percentText = (permille: number): string => `${Math.floor(permille / 10)}.${permille % 10}`;
/** A frame rate as a number: 60/1 → "60", 60000/1001 → "59.94", 30000/1001 → "29.97". */
export function fpsText(rate: { num: number; den: number }): string {
  const h = Math.round((rate.num * 100) / rate.den);
  return `${Math.floor(h / 100)}${h % 100 === 0 ? '' : `.${String(h % 100).padStart(2, '0').replace(/0$/, '')}`}`;
}
/** Whether two frame rates differ (exact, by cross multiplication). */
export const ratesDiffer = (a: { num: number; den: number }, b: { num: number; den: number }): boolean => a.num * b.den !== b.num * a.den;

// ---------- the file ----------
export type BlockKind = 'video' | 'picture' | 'none';
/** What the block is for: a moving picture is measured, a picture file only saved, anything else has no block content. */
export function blockKind(asset: Pick<Asset, 'kind' | 'video' | 'image'> | undefined): BlockKind {
  if (!asset) return 'none';
  if (isMovingPicture(asset)) return 'video';
  return asset.kind === 'image' && (asset.image || asset.video) ? 'picture' : 'none';
}
/** The stored picture's own size (what the still is drawn at, 1:1). */
export function pictureSize(asset: Pick<Asset, 'video' | 'image'>): { width: number; height: number } | null {
  const s = asset.image ?? asset.video;
  return s ? { width: s.width, height: s.height } : null;
}
/** The file's own rate (a picture file: 30/1, as stillDocument draws it). */
export const fileRate = (asset: Pick<Asset, 'video'>): { num: number; den: number } => asset.video?.frameRate ?? { num: 30, den: 1 };
/** Source frames of the file's video stream (1 for a picture). */
export const fileFrames = (asset: Pick<Asset, 'duration' | 'video'>): number => videoFrames(asset) ?? 1;
/** The time of a source frame on the file's own clock, as the timecode of the file's own rate (sourceTimeOfFrame: the ONE conversion). */
export function frameTimecode(asset: Pick<Asset, 'video'>, frame: number): string {
  if (!asset.video) return T.toTimecode(T.ZERO, { num: 30, den: 1 });
  return T.toTimecode(sourceTimeOfFrame(asset, frame), asset.video.frameRate);
}

// ---------- the numbers of one frame ----------
/** The record of `frame` in the answer (ascending, unique by frame), or null: «לא נמדד». */
export function recordOf(answer: Pick<SharpAnswer, 'frames'> | null, frame: number): StillMeasure | null {
  if (!answer) return null;
  let lo = 0, hi = answer.frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, f = answer.frames[mid]!.frame;
    if (f === frame) return answer.frames[mid]!;
    if (f < frame) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}
export interface FrameNumbers {
  frame: number;
  /** false: the frame has no record (every number is then absent and the block says «לא נמדד») */
  measured: boolean;
  /** permille of the median of the stretch; null when the stretch has no median yet */
  ratioPermille: number | null;
  sharp: number | null; sigma100: number | null;
  /** permille; null for frame 0 of the file (no previous frame), undefined when not measured */
  motion: number | null | undefined;
  hi: number | null; lo: number | null;
  /** hi above the server's limit: «הרבה לבן שרוף» */
  manyClipped: boolean;
  firstFrame: boolean;
}
/** The numbers shown for `frame`: the candidate's own when it is one, else the stored record against the same median. */
export function frameNumbers(answer: SharpAnswer | null, frame: number): FrameNumbers {
  const cand = answer?.candidates.find((c) => c.frame === frame);
  const rec = recordOf(answer, frame);
  if (!answer || (!rec && !cand)) return { frame, measured: false, ratioPermille: null, sharp: null, sigma100: null, motion: undefined, hi: null, lo: null, manyClipped: false, firstFrame: false };
  const sharp = cand?.sharp ?? rec!.sharp;
  const ratio = cand ? cand.sharpRatioPermille : answer.median !== null ? Math.round((1000 * sharp) / Math.max(1, answer.median)) : null;
  const motion = cand ? cand.motion : rec!.motion;
  const hi = cand?.hi ?? rec!.hi;
  return {
    frame, measured: true, ratioPermille: ratio, sharp, sigma100: cand?.sigma100 ?? rec!.sigma100, motion, hi, lo: cand?.lo ?? rec!.lo,
    manyClipped: cand ? cand.manyClipped : hi > MANY_CLIPPED_PERMILLE, firstFrame: motion === null,
  };
}
/** The same limit as core STILLS_MANY_CLIPPED_PERMILLE (a frame stepped to has no `manyClipped` of its own). */
export const MANY_CLIPPED_PERMILLE = 50;

// ---------- stepping ----------
/** Source frames in one second of the file (Shift with an arrow). */
export const framesPerSecond = (asset: Pick<Asset, 'video'>): number => { const r = fileRate(asset); return Math.max(1, Math.round(r.num / r.den)); };
/**
 * The frame an arrow key goes to: ← one source frame earlier, → one later (as the transport does: the timeline is left to right in
 * both languages), Shift one second; kept inside the file. null for any other key.
 */
export function steppedFrame(frame: number, key: string, shift: boolean, asset: Pick<Asset, 'duration' | 'video'>): number | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const by = (shift ? framesPerSecond(asset) : 1) * (key === 'ArrowLeft' ? -1 : 1);
  return Math.max(0, Math.min(frame + by, fileFrames(asset) - 1));
}
/** The arrow that goes later in time (said in the key hint, both languages). */
export const LATER_ARROW = '→';

// ---------- the measurement job ----------
export const OPEN_JOB = new Set(['queued', 'running', 'cancel-requested']);
export const POLL_MS = 500;
/** "measuring sharpness 3/12" (keeping its count) → { done, total, percent } or null. */
export function stillsProgress(stage: string | null | undefined): { done: number; total: number; percent: number } | null {
  const m = /^measuring sharpness (\d+)\/(\d+)$/.exec(stage ?? '');
  if (!m) return null;
  const done = Number(m[1]), total = Number(m[2]);
  return total > 0 ? { done, total, percent: Math.max(0, Math.min(100, Math.floor((100 * done) / total))) } : null;
}
export type Settled =
  | { kind: 'open' }
  | { kind: 'done'; answer: SharpAnswer }
  | { kind: 'canceled' }
  | { kind: 'failed'; code: string; message: string };
/** What a polled measurement job says now. A finished job without a valid answer is a failure, never a made-up result. */
export function settledOf(job: { status: string; output?: unknown; error?: { code?: string; message?: string } | null }): Settled {
  if (OPEN_JOB.has(job.status)) return { kind: 'open' };
  if (job.status === 'succeeded') {
    const a = (job.output as { answer?: SharpAnswer } | null)?.answer;
    return a && Array.isArray(a.frames) && Array.isArray(a.candidates) ? { kind: 'done', answer: a } : { kind: 'failed', code: 'failed', message: 'the measurement finished without an answer' };
  }
  if (job.status === 'canceled') return { kind: 'canceled' };
  return { kind: 'failed', code: job.error?.code ?? 'failed', message: job.error?.message ?? job.status };
}
/** The run of a clip survives the block being closed and opened again (the inspector remounts it): clip id → job id. */
const runs = new Map<string, string>();
export const rememberRun = (clipId: string, jobId: string) => void runs.set(clipId, jobId);
export const rememberedRun = (clipId: string): string | undefined => runs.get(clipId);
export const forgetRun = (clipId: string) => void runs.delete(clipId);

export type PanelState = 'idle' | 'measuring' | 'found' | 'refused' | 'picture';
export function panelState(o: { kind: BlockKind; measuring: boolean; refused: boolean; answer: SharpAnswer | null }): PanelState {
  if (o.kind === 'picture') return 'picture';
  if (o.measuring) return 'measuring';
  if (o.refused) return 'refused';
  return o.answer?.complete ? 'found' : 'idle';
}

// ---------- the save dialog ----------
export type Selection = { paper: PaperId | null; orientation: Orientation };
/** The orientation that fits the picture: landscape for a wide or square one. */
export const orientationFor = (size: { width: number; height: number }): Orientation => (size.width >= size.height ? 'landscape' : 'portrait');

/** The paper maths the dialog needs: core's, or a labelled stand-in in a test. */
export interface CropMath {
  printFit: typeof printFit; defaultCrop: typeof defaultCrop; snapCrop: typeof snapCrop;
}
export const CORE_CROP_MATH: CropMath = { printFit, defaultCrop, snapCrop };

export const wholeCrop = (size: { width: number; height: number }): StillCrop => ({ x: 0, y: 0, w: size.width, h: size.height });
/** The crop of a choice: the whole frame, or the largest centred paper-shaped one. */
export function cropOf(sel: Selection, size: { width: number; height: number }, math: CropMath = CORE_CROP_MATH): StillCrop {
  return sel.paper === null ? wholeCrop(size) : math.defaultCrop(size.width, size.height, sel.paper, sel.orientation);
}
/** One arrow press moves 1 % of the picture (Shift 10 %), at least one pixel. */
export const moveStep = (extent: number, big: boolean): number => Math.max(1, Math.round((extent * (big ? 10 : 1)) / 100));
const MOVES: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
/** The crop after an arrow key (moved, then brought back inside the picture and to the paper's shape), or null for another key. */
export function movedCrop(crop: StillCrop, key: string, big: boolean, size: { width: number; height: number }, sel: Selection, math: CropMath = CORE_CROP_MATH): StillCrop | null {
  const d = MOVES[key];
  if (!d || sel.paper === null) return null;
  const next = { ...crop, x: crop.x + d[0] * moveStep(size.width, big), y: crop.y + d[1] * moveStep(size.height, big) };
  return math.snapCrop(next, size.width, size.height, sel.paper, sel.orientation);
}
/** Dragged by (dx, dy) source pixels from where it was when the drag began. */
export function draggedCrop(start: StillCrop, dx: number, dy: number, size: { width: number; height: number }, sel: Selection, math: CropMath = CORE_CROP_MATH): StillCrop {
  if (sel.paper === null) return start;
  return math.snapCrop({ ...start, x: start.x + Math.round(dx), y: start.y + Math.round(dy) }, size.width, size.height, sel.paper, sel.orientation);
}
/** + (sign 1) or − (sign −1): 2 % of the picture's width on the width, the shape kept, the centre kept as far as the picture allows. */
export function resizedCrop(crop: StillCrop, sign: 1 | -1, size: { width: number; height: number }, sel: Selection, math: CropMath = CORE_CROP_MATH): StillCrop {
  if (sel.paper === null) return crop;
  const w = Math.max(16, crop.w + sign * moveStep(size.width, false) * 2);
  const h = Math.max(16, Math.round((w * crop.h) / crop.w));
  const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
  return math.snapCrop({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h }, size.width, size.height, sel.paper, sel.orientation);
}
/** The keys of the crop frame that resize it. */
export const resizeSign = (key: string): 1 | -1 | null => (key === '+' || key === '=' || key === 'Add' ? 1 : key === '-' || key === '_' || key === 'Subtract' ? -1 : null);

export interface PpiRow { paper: PaperId; ppi: number; tier: string }
/** One ppi line per paper for the crop as it is now, in the chosen orientation (printFit: a rule of thumb from the pixel count only). */
export function ppiRows(crop: Pick<StillCrop, 'w' | 'h'>, orientation: Orientation, math: CropMath = CORE_CROP_MATH): PpiRow[] {
  return PAPER_IDS.map((paper) => { const f = math.printFit(crop, paper, orientation); return { paper, ppi: f.ppi, tier: f.tier }; });
}
/** The crop as a share of the picture in percent for drawing the frame over it (exact integers: tenths of a percent). */
export function cropBox(crop: StillCrop, size: { width: number; height: number }): { left: number; top: number; width: number; height: number } {
  const pm = (n: number, d: number) => Math.round((1000 * n) / d) / 10;
  return { left: pm(crop.x, size.width), top: pm(crop.y, size.height), width: pm(crop.w, size.width), height: pm(crop.h, size.height) };
}
/** The export body of the dialog's choice (the whole frame carries no crop and no paper). */
export function stillBody(assetId: string, sourceFrame: number, sel: Selection, crop: StillCrop): StillExport {
  return { assetId, sourceFrame, ...(sel.paper === null ? {} : { crop, paper: sel.paper, orientation: sel.orientation }) };
}
/** A side over STILL_MAX_SIDE: the server refuses; the dialog says so before asking (the refusal's own sentence, then its Hebrew). */
export function tooLargeSentence(size: { width: number; height: number }): string | null {
  return Math.max(size.width, size.height) > STILL_MAX_SIDE ? STILLS_REFUSALS.stillTooLarge.message(size.width, size.height) : null;
}
export interface StillNote { key: string; vars?: Record<string, string | number> }
/** The standing notes under the choices, in order. `reasons` are the import conversions of the stored file (asset.conform). */
export function stillNotes(asset: Pick<Asset, 'conform'>, size: { width: number; height: number }, answer: SharpAnswer | null): StillNote[] {
  const reasons = answer?.source.conformed ?? asset.conform?.reasons ?? null;
  const notes: StillNote[] = [{ key: 'fileSize' }, { key: 'browserReading' }];
  if (reasons?.length) { notes.push({ key: 'conformed', vars: { reasons: reasons.join('|') } }); if (reasons.includes('hdr')) notes.push({ key: 'conformedHdr' }); }
  notes.push({ key: 'ownColours' }, { key: 'noDate' });
  if (size.width * size.height > STILL_TRIED_MAX_PIXELS) notes.push({ key: 'untriedSize' });
  return notes;
}
/** The file name to offer (the server's `output.still.fileName`; the date is never part of it), with the extension of the format. */
export function downloadName(out: Pick<StillOutput, 'fileName' | 'format'>): string {
  const ext = out.format === 'jpeg' ? '.jpg' : '.png';
  return /\.(png|jpe?g)$/i.test(out.fileName) ? out.fileName : `${out.fileName}${ext}`;
}
