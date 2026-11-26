/**
 * «הפריים הכי חד» and «שמירת התמונה» (wave 8, track cover, VERSION 1). Lead pre-pass: the shared contract of the sharpest-frame
 * measurement (apps/server/src/stills.ts, stills.math.ts — W1), its ranking (core stillsRank.ts — W1), the full-size still export
 * (core stillDocument.ts, printFit.ts, the `still` branch of apps/server/src/export.ts — W2) and the inspector block
 * (apps/web/src/editor/cover/* — W3). Design: .artifacts/wave8/cover-plan.md, CORRECTED by cover-verify.md (C1–C13 win) and cut by
 * decisions.md "cover": NO cover sequence, NO make_cover, NO new sequence origin, NO contact sheet, NO long-range path, NO capture
 * date, NO EXIF/PNG chunk writer, NO «כמו בסרט» colour. Nothing here enters the project document: measurements live in the
 * derivative of kind 'stills'; a saved picture is an export job's output.
 *
 * WHAT IS MEASURED (verify C1–C4; a heuristic, labelled as one; nobody has looked at the results):
 * - Range: the source frames [from, to) of ONE clip's file (core rangeOfClip) or a typed range, at most STILLS_MAX_RANGE_FRAMES;
 *   longer is refused (stills_range_too_long). Every frame of the range is measured, from the STORED file (never the proxy).
 * - Reader: input seek `-ss S -i <file> -map 0:v:0 -frames:v N -vf scale=W:H:flags=area,format=gray -fps_mode passthrough`, with
 *   S = stillsSeekSeconds(asset, from − 1 when from > 0 else from): half a frame before the first wanted frame, measured from the
 *   file's own start (ffmpeg adds the container start time, Asset.timeOrigin, itself). The exact count is required
 *   (frame_count_mismatch otherwise, as moments' readSampleFrames). Grey at long side STILLS_LONG_SIDE (never enlarged).
 *   Before measuring, moments' grey self-check (white >= 250, black <= 5) must pass (grey_check_failed otherwise).
 * - Per frame (integers): sobel = mean(gx² + gy²) / 16 capped at 65535 (moments.math.ts sharpness); sigma100 = round(100 σ) with
 *   Immerkær's σ = √(π/2) · Σ|I∗N| / (6 (W−2)(H−2)), N = [1 −2 1; −2 4 −2; 1 −2 1]; sharp = noiseCorrected(sobel, sigma100);
 *   motion = round(1000 · mean|g_k − g_{k−1}| / 255) to the PREVIOUS frame only (null for frame 0 of the file); hi / lo = permille
 *   of grey pixels >= STILLS_HI / <= STILLS_LO. A frame's record is a pure function of (file bytes, frame, algo, long side,
 *   ffmpeg build): merging two reads is a union by frame and never changes a stored number (C4).
 * - Cache: derivative (contentHash, 'stills') with meta StillsDerivativeMeta; stillsCacheState decides; a mismatch measures again.
 *
 * RANKING (rankStills, W1): median m of `sharp` over EVERY frame of [from, to); sharpRatioPermille = round(1000 · sharp / max(1, m));
 * candidates are local maxima of `sharp` (strictly above both neighbours inside the range, or equal to the earlier one and above
 * the later one), sorted by sharp desc, then motion asc (null last), then frame asc; greedy pick with at least
 * ceil(STILLS_SEPARATION_SECONDS · rate) frames between picks; at most STILLS_CANDIDATES (fewer is said: «נמצאו {n}»). Nothing is
 * dropped for clipping: a candidate with hi > STILLS_MANY_CLIPPED_PERMILLE carries manyClipped.
 *
 * THE SAVED PICTURE (C5, C7, C8, C10, C11): core stillDocument(asset, frame) — a one-clip document at the file's own width, height
 * and rate, fit contain, default transform, sourceIn = sourceTimeOfFrame — rendered 1:1 through Exporter.renderStill (the same
 * evaluate + compositor as preview and export; never an ffmpeg decode of the source), then ffmpeg `crop=w:h:x:y` on the lossless
 * PNG, then PNG (`-c:v png -map_metadata -1`) or JPEG (`-vf format=yuvj444p -c:v mjpeg -q:v 2 -flags +bitexact -map_metadata -1
 * -frames:v 1`). The output is checked (codec, exact size = crop, no format or stream tags) before success. A side over
 * STILL_MAX_SIDE is refused; above STILL_TRIED_MAX_PIXELS it is labelled as not tried here. Only the owner's own session may ask
 * for `still` (403 owner_required for every other credential); agents read numbers only.
 */
import { z } from 'zod';
import type * as T from '@pulseframe/time';
import type { Asset } from './schema.ts';
import { startOffsetFrames } from './speed.ts';

// ---------- flags (flipped at integration) ----------
/** True once W1 has built the measurement job, the ranking and the routes' bodies (flipped at the wave 8 cover integration). */
export const STILLS_MEASURE_BUILT = true;
/** True once W2 has built stillDocument, printFit and the `still` branch of the export (flipped at the wave 8 cover integration). */
export const STILL_EXPORT_BUILT = true;

// ---------- the measurement ----------
/** The measurement rules' version (part of the cache key). */
export const STILLS_ALGO = 1 as const;
export const STILLS_JOB_TYPE = 'stills' as const;
export const STILLS_DERIVATIVE_KIND = 'stills' as const;
/** Grey is read at this long side (flags=area), never enlarged (C3a). 1920 only if a proof shows 960 misses a 1-px blur step. */
export const STILLS_LONG_SIDE = 960;
/** A range longer than this is refused (C2): 20 s at 30 fps, 10 s at 60 fps. */
export const STILLS_MAX_RANGE_FRAMES = 600;
export const STILLS_CANDIDATES = 3;
/** Candidates are at least this far apart (rounded up to whole frames of the file's own rate). */
export const STILLS_SEPARATION_SECONDS = 1;
/** Grey levels counted as clipped white / crushed black (full-range grey, as moments' self-check requires). */
export const STILLS_HI = 250;
export const STILLS_LO = 5;
/** A candidate with more clipped white than this (permille) carries «הרבה לבן שרוף». */
export const STILLS_MANY_CLIPPED_PERMILLE = 50;
/** Jobs: at most this many open per server (429 busy) and one per project (409 stills_in_progress). */
export const STILLS_MAX_OPEN_JOBS = 3;
/** The white-noise share of the Sobel energy: E[gx² + gy²] / 16 = 24σ² / 16 = (3/2)σ² (C3c). */
export const STILLS_NOISE_FACTOR = { num: 3, den: 2 } as const;
/** Immerkær's 3×3 noise kernel, row by row (C3b). */
export const STILLS_NOISE_KERNEL = [1, -2, 1, -2, 4, -2, 1, -2, 1] as const;

/** Stored in the data file and in every answer. */
export const STILLS_METHOD = 'stills 1: every frame of one range of the stored file, grey at long side 960; Sobel gradient energy minus a noise term (Immerkaer sigma, 1.5 sigma^2), relative to the range median; mean absolute difference to the previous frame; share of grey >= 250 and <= 5; heuristic; no model; faces not used' as const;
/** Shown under «איך זה נמדד» (English; the Hebrew is i18n cover.methodLong). States the limits (C3, C12). */
export const STILLS_METHOD_LONG = 'Every frame of the chosen stretch is read from the stored file (not the editing copy), in grey at a long side of 960 pixels. Sharpness is the gradient energy (Sobel) minus an estimate of the sensor noise (Immerkaer\'s method, 1.5 sigma squared), compared with the median of the stretch. Movement is the mean difference to the previous frame; clipped white and crushed black are the shares of grey at or above 250 and at or below 5. Rules, no model; faces are not used. Limits: the noise estimate also counts fine texture; the numbers compare frames of one clip only (same scene, same camera), never two clips; key frames of a compressed file often measure sharper than their neighbours and this is not corrected; thresholds were set on synthetic test videos only; nobody has checked the results by eye.' as const;
export const STILLS_LABEL = {
  he: 'היוריסטיקה: מדידה של חדות, רעש, תזוזה ואזורים שרופים. בלי בינה מלאכותית ובלי זיהוי פנים. לא נבדק בעין',
  en: 'Heuristic: measured sharpness, noise, movement and clipped areas. No AI model, no face detection. Not checked by eye',
} as const;

const Id = z.string().min(1).max(64);
const Frame = z.number().int().min(0).max(100_000_000);
/**
 * POST /api/v1/projects/:id/stills and MCP find_sharp_frames. Either `clipId` (the source frames that clip shows, rangeOfClip) or
 * both `from` and `to` (source frames of the file's video stream, half-open). `assetId` names the file either way (a clip of
 * another file is refused).
 */
export const FindSharpBodySchema = z.object({ assetId: Id, clipId: Id.optional(), from: Frame.optional(), to: Frame.optional() }).strict()
  .refine((b) => (b.clipId !== undefined) !== (b.from !== undefined || b.to !== undefined), { message: 'give either clipId or both from and to' })
  .refine((b) => (b.from === undefined) === (b.to === undefined), { message: 'give both from and to' });
export type FindSharpBody = z.infer<typeof FindSharpBodySchema>;
/** GET /api/v1/projects/:id/stills?assetId&from&to and MCP read_sharp_frames: what is stored for the range, measured or not. */
export const ReadSharpQuerySchema = z.object({ assetId: Id, from: z.coerce.number().int().min(0).max(100_000_000), to: z.coerce.number().int().min(1).max(100_000_000) }).strict();
export type ReadSharpQuery = z.infer<typeof ReadSharpQuerySchema>;

/** One measured frame (integers). A pure function of (file bytes, frame, algo, long side, ffmpeg build). */
export interface StillMeasure {
  /** source frame of the file's video stream (as sourceTimeOfFrame counts it) */
  frame: number;
  /** raw Sobel energy at STILLS_LONG_SIDE: mean(gx² + gy²) / 16, capped at 65535 */
  sobel: number;
  /** Immerkær's noise σ × 100, rounded */
  sigma100: number;
  /** noiseCorrected(sobel, sigma100) — what is ranked */
  sharp: number;
  /** permille, mean |difference| to the previous frame of the file; null for frame 0 */
  motion: number | null;
  /** permille of grey pixels >= STILLS_HI */
  hi: number;
  /** permille of grey pixels <= STILLS_LO */
  lo: number;
}
/** The data file (derivative kind 'stills', application/json, compact, no clock inside). */
export interface StillsData {
  algo: typeof STILLS_ALGO; method: string; longSide: number;
  /** ffmpeg's first version line (tracking.ts ffmpegVersionLine): which build made the numbers (C12) */
  ffmpeg: string;
  asset: { contentHash: string; frames: number; rate: T.Rate; width: number; height: number; startOffsetFrames: number };
  /** the grey size actually read */
  grey: { width: number; height: number };
  /** ascending, unique by frame */
  measured: StillMeasure[];
  /** one row per read: the frames delivered [from, to) and the SHA-256 (hex) of their grey bytes */
  reads: { from: number; to: number; digest: string }[];
}
/** meta of the derivative row of kind 'stills' (apps/server/src/derive.ts Derivatives.put). */
export interface StillsDerivativeMeta { algo: typeof STILLS_ALGO; longSide: number; ffmpeg: string; frames: number }
/** Whether a stored data file can be merged into (hit) or must be measured again from nothing (miss): same algo, long side and ffmpeg build. */
export function stillsCacheState(meta: Partial<StillsDerivativeMeta> | null | undefined, ffmpegLine: string): 'hit' | 'miss' {
  return meta && meta.algo === STILLS_ALGO && meta.longSide === STILLS_LONG_SIDE && meta.ffmpeg === ffmpegLine ? 'hit' : 'miss';
}
/** sharp = max(0, sobel − round(1.5 σ²)), with σ = sigma100 / 100 (C3c). Integers only. */
export function noiseCorrected(sobel: number, sigma100: number): number {
  const noise = Math.round((STILLS_NOISE_FACTOR.num * sigma100 * sigma100) / (STILLS_NOISE_FACTOR.den * 10_000));
  return Math.max(0, sobel - noise);
}
/**
 * The input-seek position of a read whose first delivered frame is `frame` (C1): (frame + startOffsetFrames − ½) / rate seconds,
 * from the file's own start, written with exactly 6 decimals (rounded half up from the exact rational; never below 0). ffmpeg's
 * accurate input seek then delivers the first frame presented at or after it.
 */
export function stillsSeekSeconds(asset: { video?: { frameRate: T.Rate; startTime?: T.RationalTime } | null }, frame: number): string {
  if (!asset.video) throw new RangeError('stillsSeekSeconds: the asset has no video stream');
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError(`stillsSeekSeconds: ${frame} is not a source frame`);
  const { num, den } = asset.video.frameRate;
  const k = BigInt(frame + startOffsetFrames(asset.video));
  if (k === 0n) return '0.000000';
  // seconds = (2k − 1) · den / (2 · num); in microseconds, rounded half up
  const n = (2n * k - 1n) * BigInt(den) * 1_000_000n, d = 2n * BigInt(num);
  const us = (2n * n + d) / (2n * d);
  const s = us / 1_000_000n, frac = (us % 1_000_000n).toString().padStart(6, '0');
  return `${s}.${frac}`;
}

/** A candidate frame with its numbers. `time` is on the file's own clock (sourceTimeOfFrame). */
export interface SharpCandidate {
  frame: number; time: T.RationalTime;
  sharp: number; sobel: number; sigma100: number;
  /** round(1000 · sharp / max(1, median)) */
  sharpRatioPermille: number;
  motion: number | null; hi: number; lo: number;
  manyClipped: boolean;
}
/** What rankStills returns for a range. */
export interface StillsRanking { median: number | null; candidates: SharpCandidate[] }
/** The picture a still would be taken from (C7): the stored file's size and rate, and why it was converted at import, if it was. */
export interface StillSource { width: number; height: number; rate: T.Rate | null; conformed: NonNullable<Asset['conform']>['reasons'] | null }
/** The answer of GET …/stills, of POST …/stills when cached, of a finished job (output.answer) and of both MCP tools. Numbers only. */
export interface SharpAnswer {
  assetId: string; from: number; to: number;
  /** frames of [from, to) that have a record */
  measuredFrames: number;
  /** every frame of [from, to) has a record (then median and candidates are over the whole range) */
  complete: boolean;
  median: number | null;
  /** at most STILLS_CANDIDATES; empty while not complete */
  candidates: SharpCandidate[];
  /** every stored record of [from, to), ascending (for one-frame stepping with numbers; a frame missing here is «לא נמדד») */
  frames: StillMeasure[];
  source: StillSource;
  method: string; label: { he: string; en: string }; heuristic: true;
}
/** POST …/stills: a job, or the stored answer when every frame of the range is already measured. */
export type FindSharpResult = { jobId: string; status: string } | { cached: true; answer: SharpAnswer };
export interface StillsJobInput { assetId: string; from: number; to: number; clipId: string | null }
export interface StillsJobOutput { answer: SharpAnswer; read: number; reused: number; wallSeconds: number }
/** The job's stage text (i18n effectParams.ts STAGE_WORDS 'measuring sharpness'); keeps its count. */
export const stillsStage = (done: number, total: number) => `measuring sharpness ${done}/${total}`;

// ---------- the saved picture (export option `still`) ----------
/** A side longer than this is refused (C8: the frame cap, schema.ts). */
export const STILL_MAX_SIDE = 8192;
/** A side shorter than this is refused: a still's document is the file's own size, and the schema's frame is at least 16 px a side. */
export const STILL_MIN_SIDE = 16;
/** Pictures over this many pixels have not been tried here (C8: 3000×2000 is proven); the answer says so. */
export const STILL_TRIED_MAX_PIXELS = 24_000_000;
export const STILL_FORMATS = ['png', 'jpeg'] as const;
export const PAPER_IDS = ['10x15', '13x18', 'a4'] as const;
export type PaperId = (typeof PAPER_IDS)[number];
export const ORIENTATIONS = ['portrait', 'landscape'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];
export const StillCropSchema = z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(16).max(STILL_MAX_SIDE), h: z.number().int().min(16).max(STILL_MAX_SIDE) }).strict();
export type StillCrop = z.infer<typeof StillCropSchema>;
/**
 * The export option `still` (with format 'png' or 'jpeg'): one source frame of one file at the stored file's own pixels, the whole
 * frame or a crop in source pixels. `paper` + `orientation` (both or neither) record the paper the crop was shaped for; the crop
 * must then have the paper's shape within one pixel (printFit.ts). Owner's own session only.
 */
export const StillExportSchema = z.object({
  assetId: Id,
  /** source frame of the file's video stream; 0 for a picture file */
  sourceFrame: Frame,
  crop: StillCropSchema.optional(),
  paper: z.enum(PAPER_IDS).optional(),
  orientation: z.enum(ORIENTATIONS).optional(),
}).strict().refine((s) => (s.paper === undefined) === (s.orientation === undefined), { message: 'give paper and orientation together' });
export type StillExport = z.infer<typeof StillExportSchema>;
/** The export options a `still` may not be combined with (still_options). */
export const STILL_EXCLUSIVE_OPTIONS = ['frame', 'range', 'sequenceId', 'variantId', 'sizeFit', 'mode', 'selfCheck'] as const;
/** On the finished export job: output.still. */
export interface StillOutput {
  format: (typeof STILL_FORMATS)[number];
  width: number; height: number;
  crop: StillCrop;
  source: StillSource;
  /** with a paper: its pixels per inch (printFit) and the rule-of-thumb tier */
  print: { paper: PaperId; orientation: Orientation; ppi: number; tier: string } | null;
  /** over STILL_TRIED_MAX_PIXELS: not tried here */
  untriedSize: boolean;
  /** the file name offered: `{asset name} · {frame time}` (no date, decision 3) */
  fileName: string;
}

// ---------- refusals ----------
/** One refusal: HTTP status (0 = a job error), code, the English sentence (i18n cover.ts HE_COVER words it) and the way forward. */
export interface StillsRefusalRow<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const row = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): StillsRefusalRow<A> => ({ status, code, message, hint });
export const STILLS_REFUSALS = {
  notBuilt: row(501, 'stills_not_built', () => 'finding the sharpest frame is not built in this version yet', 'Nothing was measured. Step through the frames by hand in the viewer for now.'),
  rangeTooLong: row(422, 'stills_range_too_long', (n: number, max: number) => `too long to measure frame by frame: the stretch has ${n} frames, at most ${max}`, 'Trim the clip, or choose a shorter stretch, of at most 600 frames.'),
  emptyRange: row(422, 'invalid_range', (from: number, to: number) => `the stretch [${from}, ${to}) holds no frame`, 'Choose a stretch whose end comes after its start.'),
  outsideFile: row(422, 'out_of_bounds', (from: number, to: number, frames: number) => `the stretch [${from}, ${to}) is outside the file's ${frames} frames`, 'Choose frames inside the file.'),
  noVideo: row(422, 'no_video', (assetId: string) => `file ${assetId} has no moving picture to measure frame by frame`, 'A picture file has one frame: save it with «שמירת התמונה» instead.'),
  notPictureClip: row(422, 'incompatible', (clipId: string) => `clip ${clipId} does not show a video file`, 'Select one video clip and try again.'),
  otherFile: row(422, 'invalid_request', (clipId: string, assetId: string) => `clip ${clipId} does not show file ${assetId}`, 'Send the file the clip shows, or leave out the clip and give a stretch.'),
  inProgress: row(409, 'stills_in_progress', () => 'the sharpest frame is already being measured in this project', 'Wait for that measurement to finish, or stop it, then try again.'),
  busy: row(429, 'busy', (max: number) => `${max} measurements are already running on this computer`, 'Try again when one of them has finished.'),
  decodeFailed: row(0, 'frame_count_mismatch', (got: number, want: number) => `the file delivered ${got} of the ${want} frames asked for; nothing was saved`, 'The file may be damaged or unusual. Try a shorter stretch, or import the file again.'),
  decodeTimes: row(0, 'frame_count_mismatch', (n: number, earlier: number) => `the file delivered ${n} frames, but not the ${n} frames asked for (their times differ by more than a quarter of a frame, also after reading from ${earlier} s earlier); nothing was saved`, 'The file may be damaged or unusual. Try a shorter stretch, or import the file again.'),
  warming: row(503, 'stills_warming', () => 'the measurement is still starting (the version of ffmpeg is not known yet); nothing was read', 'Try again in a moment.'),
  greyCheck: row(0, 'grey_check_failed', (white: number, black: number) => `this ffmpeg reads grey levels outside the expected range (white ${white}, black ${black}); nothing was measured`, 'Use the ffmpeg that comes with the program, then measure again.'),
  // the saved picture
  stillNotBuilt: row(422, 'still_not_built', () => 'saving a picture from a file is not built in this version yet', 'Export one frame of the film as PNG for now.'),
  stillOptions: row(422, 'still_options', (option: string) => `a picture is saved on its own: ${option} cannot be combined with it`, 'Leave out frame, range, sequence, format variant, target size and the fast export.'),
  stillFormat: row(422, 'still_options', (format: string) => `a picture is saved as PNG or JPEG, not ${format}`, 'Choose PNG or JPEG.'),
  jpegNeedsStill: row(422, 'still_options', () => 'JPEG is only for saving a picture from a file', 'Choose the picture to save, or export the frame as PNG.'),
  stillScale: row(422, 'still_options', () => 'a picture is saved at the stored file\'s own size, so scale cannot be changed', 'Leave out scale.'),
  stillNoPicture: row(422, 'still_no_picture', (assetId: string) => `file ${assetId} has no picture to save`, 'Choose a video or picture file.'),
  stillFrame: row(422, 'out_of_bounds', (frame: number, frames: number) => `frame ${frame} is outside the file's ${frames} frames`, 'Choose a frame inside the file.'),
  stillTooLarge: row(422, 'still_too_large', (w: number, h: number) => `the picture is ${w}x${h}, larger than 8192 pixels on a side; it cannot be saved at full size`, 'Nothing was saved. A frame of the film can still be exported at the film\'s size.'),
  stillTooSmall: row(422, 'still_too_small', (w: number, h: number) => `the picture is ${w}x${h}, smaller than 16 pixels on a side; it cannot be saved as a picture on its own`, 'Nothing was saved. Place it in the film and export a frame of the film instead.'),
  stillCrop: row(422, 'still_options', (w: number, h: number) => `the crop must lie inside the picture of ${w}x${h} pixels and be at least 16 pixels on each side`, 'Move or shrink the frame until it lies inside the picture.'),
  stillPaperShape: row(422, 'still_options', (paper: string, orientation: string) => `the crop does not have the shape of paper ${paper} (${orientation}) within one pixel`, 'Choose the paper again so the frame takes its shape, or save the whole frame.'),
  ownerRequired: row(403, 'owner_required', () => 'saving a full-size picture is for the project owner\'s own session only', 'Agents read the numbers (find_sharp_frames); the owner saves the picture in the editor.'),
  stillBrowserRoute: row(409, 'unsupported_in_browser_export', () => 'the browser export route cannot save a picture from a file', 'Use the server export.'),
  stillTags: row(0, 'still_tags', (tags: string) => `the saved picture carried tags it must not (${tags}); nothing was saved`, 'This is a fault of the program; report it. Try PNG meanwhile.'),
} as const;
export type StillsRefusalKey = keyof typeof STILLS_REFUSALS;
/** A refusal raised by core (rangeOfClip, the still checks); the server turns it into an ApiError with the same status, code and hint. */
export class StillsRefusal extends Error {
  constructor(readonly key: StillsRefusalKey, readonly status: number, readonly code: string, message: string, readonly hint: string, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'StillsRefusal'; }
}
export function stillsRefusal<K extends StillsRefusalKey>(key: K, args: Parameters<(typeof STILLS_REFUSALS)[K]['message']>, details: Record<string, unknown> = {}): StillsRefusal {
  const r = STILLS_REFUSALS[key] as StillsRefusalRow<unknown[]>;
  return new StillsRefusal(key, r.status, r.code, r.message(...(args as unknown[])), r.hint, details);
}
