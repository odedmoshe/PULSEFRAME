/**
 * Measured moments of a video (wave 5, family film, ADR-0026): the shared contract of the model-free measurement job
 * (apps/server/src/moments.ts, moments.math.ts), the internal op attach_moments (momentsOps.ts), the document field
 * analyses[assetId].moments (schema.ts), the family film planner (familyFilm.ts) and the film UI. Heuristic: measured motion,
 * sharpness, brightness and sound level, and fixed rules. No model; faces are NOT used (no face model is approved).
 *
 * What is measured (the plan's section 4 WITH THE VERIFIER'S CORRECTIONS, which win):
 * - Picture: every S-th source frame (S = momentsStep(rate), about 5 a second) of the editing proxy (frames 1:1 with the
 *   original), grey, long side MOMENTS_LONG_SIDE, read by ffmpeg `select='not(mod(n\,S))'` with `-fps_mode passthrough`, so
 *   picture sample k IS source frame k*S, exactly; its source time is core sourceTimeOfFrame(asset, k*S) (speed.ts), which
 *   counts the picture's start offset. When the file is truncated (longer than MOMENTS_MAX_MEDIA_SECONDS) `trim=end_frame=N`
 *   comes BEFORE select, and the reader requires exactly ceil(min(frames, N)/S) samples, else the asset is skipped as
 *   decode_failed. A start-up self-check reads one white and one black frame and requires grey >= 250 and <= 5.
 * - Per sample: luma = mean grey; sharp = Sobel gradient energy (relative to the file's median only); B = 4x4 box mean;
 *   the best whole-picture shift (dx, dy) in [-shiftSearch, shiftSearch]^2 by SAD of B against the previous B, EVERY shift
 *   compared over the same inner window (margin = shiftSearch), ties to the smallest |d|, then lowest dy, then dx;
 *   inner = that minimum (permille; movement inside the picture), pan = |d| / (long side of B) * samples per second
 *   (permille of the long side per second; camera movement), change = mean |B - previous B| (permille, no shift).
 *   LIMIT (stated in MOMENTS_METHOD_LONG): a camera move faster than shiftSearch box pixels per sample lies outside the
 *   search; it is caught by the border rule below, not measured.
 * - Sound: level 0 of the waveform derivative (int16 min/max pairs per 256 samples at 48 kHz, drawn from the FILE'S OWN start).
 *   Bucket b belongs to hop floor(b * 256 / 4800) (hops of MOMENTS_HOP_MS); hop h is source time [0.1h, 0.1(h+1)) s. Level of a
 *   hop = 20 log10(max(1e-5, mean of its buckets' peaks)) dBFS, stored x 10, floor -1000. Peak level, NOT loudness (LUFS).
 *   A picture sample takes the maximum over the hops its source time [sourceTimeOfFrame(k*S), sourceTimeOfFrame((k+1)*S)) covers.
 * - Gates (g = 0 or 1; MOMENTS_GATES): dark (luma < darkLuma), blown (> blownLuma), whip pan (pan > whipPanPermillePerSecond
 *   OR the best shift lies on the border of the search; widened by one sample each side; W2 adds, as a heuristic beyond this rule:
 *   a nonzero best shift that removes less than a fifth of a clear unshifted difference reaching at least 90 % of the box columns
 *   and rows that have detail — flat bands do not count, so over a still detailed background a moving subject trips it only when
 *   its swept area spans 90 % of both the width and the height), blur (sharp < blurRatio x median),
 *   hard cut (change > cutChangePermille and inner > cutInnerPermille): splits the clean stretch AND gives that sample zero interest.
 * - Ranking quantity (internal; never stored, never shown): z(x) = (x - p20) / (1.4826 * median|x - p20| + madFloorShare of
 *   full scale), clipped to [0, zClip] — centred on the 20th percentile, so a clip lively for most of its length is not "flat";
 *   interest = g * (0.5 z(inner) + 0.5 z(level)) (weight 1 on the one signal present); mean over +-coreSeconds divided by the
 *   FULL window size (edges are not favoured); up to MOMENTS_MAX_WINDOWS peaks by argmax (earliest on ties) with
 *   +-separationSeconds suppression, stopping under minInterest; clean stretch: from the peak while g = 1 and no cut is crossed,
 *   at most maxStretchSeconds each way. No peak = flat: true, windows: [].
 * - Stored: per window measured values only (motion, level above the file's median, sharpness ratio, luma, burstFrame); per file
 *   `file.motion` (median inner, permille) and `file.level` (median level, dBFS x 10). The per-sample series live in the data
 *   file (derivative kind 'moments', MomentsData), never in the document.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import type { Asset } from './schema.ts';

export const MOMENTS_ALGO = 1 as const;
export const MOMENTS_JOB_TYPE = 'moments' as const;
export const MOMENTS_DERIVATIVE_KIND = 'moments' as const;
/** Stored in the document (analyses[id].moments.origin.method): kept short, so a full record fits MOMENTS_RECORD_BUDGET_BYTES. */
export const MOMENTS_METHOD = 'moments 1: measured motion, sharpness, brightness, sound level; heuristic; no model' as const;
/** Stored in the data file and shown in the UI. */
export const MOMENTS_METHOD_LONG = 'Picture: every S-th frame of the editing proxy (about 5 a second), grey, long side 320: brightness, sharpness (gradient energy, relative to the file), the change left after the best whole-picture shift within 12 box pixels (movement inside the picture) and that shift (camera movement); a faster camera move lies outside the search and is gated as a whip pan, not measured. Sound: waveform peaks per 100 ms (peak level relative to the file, not LUFS). Rules, no model; faces are not used; thresholds tuned on synthetic fixtures only.' as const;
export const MOMENTS_LABEL = { he: 'היוריסטיקה: מדידות של תנועה, חדות, בהירות ועוצמת קול. בלי בינה מלאכותית', en: 'Heuristic: measured motion, sharpness, brightness and sound level. No AI model' } as const;
export const MOMENTS_SAMPLES_PER_SECOND = 5;
export const MOMENTS_LONG_SIDE = 320;
export const MOMENTS_HOP_MS = 100;
/** Waveform level-0 bucket size (apps/server/src/derive.ts BUCKET_SIZES[0]) and rate: bucket b belongs to hop floor(b * 256 / 4800). */
export const MOMENTS_WAVE_BUCKET = 256;
export const MOMENTS_WAVE_RATE = 48000;
export const MOMENTS_MAX_WINDOWS = 4;
export const MOMENTS_MAX_ASSETS = 60;
export const MOMENTS_MAX_MEDIA_SECONDS = 1800;
/** Jobs: at most this many open (queued or running) per server (429 busy), and one per project (409 moments_in_progress). */
export const MOMENTS_MAX_OPEN_JOBS = 3;
/** How long the job waits (cancelable) for a queued or running proxy / waveform row before it reads the original or goes without sound. */
export const MOMENTS_WAIT_DERIVATIVE_MS = 10 * 60_000;
/** Document budget for ONE full record (4 windows, both bases, burst, origin): JSON bytes of analyses[id].moments. */
export const MOMENTS_RECORD_BUDGET_BYTES = 1100;
/** Data file budget: bytes of MomentsData JSON per media minute. */
export const MOMENTS_DATA_BYTES_PER_MINUTE = 12_000;

/** Every S-th source frame is measured: picture sample k is source frame k * S, exactly. */
export const momentsStep = (rate: { num: number; den: number }): number => Math.max(1, Math.round(rate.num / rate.den / MOMENTS_SAMPLES_PER_SECOND));
/** The hop a waveform bucket belongs to (buckets straddling two hops belong to the first). */
export const hopOfBucket = (bucket: number): number => Math.floor((bucket * MOMENTS_WAVE_BUCKET) / ((MOMENTS_WAVE_RATE * MOMENTS_HOP_MS) / 1000));
/** Pictures the reader must deliver for `frames` source frames truncated at `maxFrames` with step `step`. */
export const momentsExpectedSamples = (frames: number, maxFrames: number, step: number): number => Math.ceil(Math.min(frames, maxFrames) / step);

/** Gates and thresholds (starting points; nobody has judged them on real footage). */
export const MOMENTS_GATES = {
  darkLuma: 20, blownLuma: 245, whipPanPermillePerSecond: 600, cutChangePermille: 300, cutInnerPermille: 250, blurRatio: 0.5,
  coreSeconds: 1.5, separationSeconds: 4, maxStretchSeconds: 15, minInterest: 0.35, zClip: 4, madFloorShare: 0.01, zCentrePercentile: 20,
  burstDb: 9, burstFloorDbfs: -35,
  /** Box pixels each way of the whole-picture shift search (box image long side 80). The verifier showed 4 can never reach the whip-pan gate. */
  shiftSearch: 12,
  /** A flat file whose median inner motion is at least this (permille) is "active throughout" (the planner's class B), not "no clear moment". */
  activeMotionPermille: 15,
} as const;

export const MOMENT_BASES = ['inner-motion', 'sound'] as const;
const Frame = z.number().int().min(0).max(100_000_000);
/** A candidate moment, in SOURCE FRAMES of the asset's video stream (exact integers). Measured values only; never a score. */
export const MomentWindowSchema = z.object({
  peakFrame: Frame,
  /** The clean stretch around the peak: not dark, blown, blurred or whip-panned, and inside one shot. fromFrame <= peakFrame < toFrame <= frames. */
  fromFrame: Frame, toFrame: Frame,
  basis: z.array(z.enum(MOMENT_BASES)).min(1).max(2),
  /** Movement inside the picture over peak +- coreSeconds, permille of full scale; null when the picture was not measured. */
  motion: z.number().int().min(0).max(1000).nullable(),
  /** Sound level over the same stretch, dB above the file's median level; null when the file has no measured sound. */
  level: z.number().min(-60).max(60).nullable(),
  /** Sharpness as a ratio to the file's median. */
  sharp: z.number().min(0).max(9.99).nullable(),
  luma: z.number().int().min(0).max(255).nullable(),
  /** First hop at least burstDb above the file's median (and above burstFloorDbfs) inside the stretch, as a source frame. */
  burstFrame: Frame.optional(),
}).strict();
export type MomentWindow = z.infer<typeof MomentWindowSchema>;
/** File-level measured values: what the planner ranks flat files by ('arc' order, active_throughout). */
export const MomentsFileSchema = z.object({
  /** Median inner motion over the file, permille; null when the picture was not measured. */
  motion: z.number().int().min(0).max(1000).nullable(),
  /** Median sound level over the file, dBFS x 10 (-1000..0); null when no sound was measured. */
  level: z.number().int().min(-1000).max(0).nullable(),
}).strict();
export type MomentsFile = z.infer<typeof MomentsFileSchema>;

const Sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const MomentsMeasuredSchema = z.object({ picture: z.boolean(), sound: z.boolean() }).strict();
export const MomentsItemSchema = z.object({
  assetId: z.string().min(1).max(64), algo: z.literal(MOMENTS_ALGO), data: Sha,
  measured: MomentsMeasuredSchema,
  file: MomentsFileSchema,
  /** true: measured, and no moment stood out (windows is empty). */
  flat: z.boolean(),
  windows: z.array(MomentWindowSchema).max(MOMENTS_MAX_WINDOWS),
  /** Only the first MOMENTS_MAX_MEDIA_SECONDS of the file were measured. */
  truncated: z.boolean().optional(),
}).strict();
export type MomentsItem = z.infer<typeof MomentsItemSchema>;
export const AttachMomentsArgsSchema = z.object({ method: z.string().max(200), createdAt: z.string().max(40), items: z.array(MomentsItemSchema).min(1).max(MOMENTS_MAX_ASSETS) }).strict();
export type AttachMomentsArgs = z.infer<typeof AttachMomentsArgsSchema>;
/** POST /api/v1/projects/:id/moments and the MCP tool measure_moments. overwrite: measure again even when a record of this algo exists. */
export const StartMomentsBodySchema = z.object({ assetIds: z.array(z.string().min(1).max(64)).min(1).max(MOMENTS_MAX_ASSETS), overwrite: z.boolean().optional() }).strict();
export type StartMomentsBody = z.infer<typeof StartMomentsBodySchema>;

/** The data file (derivative kind 'moments', application/json). Integers only; this is the interface shared with wave-4 shorts. */
export interface PictureSeries {
  source: 'proxy' | 'original'; step: number; count: number; width: number; height: number;
  luma: number[];   // 0..255
  sharp: number[];  // mean(gx^2 + gy^2) / 16, capped at 65535
  inner: number[];  // 0..1000 permille: mean |difference| after the best whole-picture shift
  pan: number[];    // 0..10000 permille of the long side per second
  change: number[]; // 0..1000 permille: mean |difference| without the shift
  /** 1 where the sample was gated (dark, blown, whip pan, blur) or is a hard cut; the proof reads it (F2). */
  gated: number[];
  /** SHA-256 (hex) of all grey bytes read. */
  digest: string;
}
export interface SoundSeries { source: 'waveform-peaks' | 'audio-features'; hopMs: number; count: number; /** dBFS x 10, floor -1000 */ level: number[] }
export interface MomentsData {
  algo: typeof MOMENTS_ALGO; method: string;
  asset: { contentHash: string; frames: number; rate: { num: number; den: number }; startOffsetFrames: number; measuredFrames: number; truncated: boolean };
  picture: PictureSeries | null; sound: SoundSeries | null;
  file: MomentsFile; flat: boolean; windows: MomentWindow[];
}
/** meta of the derivative row of kind 'moments' (apps/server/src/derive.ts Derivatives.put). */
export interface MomentsDerivativeMeta { algo: typeof MOMENTS_ALGO; picture: 'proxy' | 'original' | null; sound: boolean; samples: number; hops: number; truncated: boolean }
/**
 * Whether a stored data file can be used as it is (a cache hit): same algo, and not stale. Stale = sound was unavailable when it
 * was measured and the waveform is ready now; then the sound is measured and the picture series is REUSED from the file (no decode).
 */
export function momentsCacheState(meta: Partial<MomentsDerivativeMeta> | null | undefined, waveformReady: boolean): 'hit' | 'add-sound' | 'miss' {
  if (!meta || meta.algo !== MOMENTS_ALGO) return 'miss';
  if (!meta.sound && waveformReady) return meta.picture ? 'add-sound' : 'miss';
  return 'hit';
}
export interface MomentsJobInput { assetIds: string[]; overwrite?: true; projectRevision: number }
export const MOMENTS_SKIP_REASONS = ['no_video', 'removed', 'decode_failed', 'not_found'] as const;
export interface MomentsJobOutput {
  measured: number; cached: number; attached: number; revision: number | null;
  skipped: { assetId: string; reason: (typeof MOMENTS_SKIP_REASONS)[number] }[];
  wallSeconds: number; mediaSeconds: number;
}
/** The job's stage text (STAGE_WORDS 'measuring moments', i18n effectParams.ts). */
export const momentsStage = (done: number, total: number) => `measuring moments ${done}/${total}`;

/** Frames in an asset's video stream, as sourceFrameIndexAt counts them (frameCount, else the duration at the stream's rate). */
export const videoFrames = (asset: Pick<Asset, 'duration' | 'video'>): number | null =>
  asset.video ? asset.video.frameCount ?? Math.max(1, T.frameIndexAt(asset.duration, asset.video.frameRate)) : null;
/** An asset whose picture moves: a video stream on a file that is not a still. Only these are measured. */
export const isMovingPicture = (asset: Pick<Asset, 'kind' | 'video'> | undefined): boolean => !!asset?.video && asset.kind !== 'image';
/**
 * Why a moments record cannot belong to this asset, or null when it can. The ONE rule for attach_moments (refused) and
 * validateProject (code analysis_moments): the asset is a moving picture; each window keeps fromFrame <= peakFrame < toFrame
 * <= frames and a burstFrame inside [fromFrame, toFrame); a window's basis matches what was measured; flat holds no window and
 * a record with a window is not flat.
 */
export function momentsProblem(asset: Pick<Asset, 'kind' | 'video' | 'duration'> | undefined, m: { measured: { picture: boolean; sound: boolean }; flat: boolean; windows: readonly MomentWindow[] }): string | null {
  if (!asset || !isMovingPicture(asset)) return 'the file has no moving picture';
  const frames = videoFrames(asset)!;
  if (m.flat && m.windows.length) return 'a flat record holds no window';
  for (const [i, w] of m.windows.entries()) {
    if (!(w.fromFrame <= w.peakFrame && w.peakFrame < w.toFrame && w.toFrame <= frames)) return `window ${i} must keep fromFrame <= peakFrame < toFrame <= ${frames} (the file's frames)`;
    if (w.burstFrame !== undefined && !(w.fromFrame <= w.burstFrame && w.burstFrame < w.toFrame)) return `window ${i}: the burst must lie inside the window`;
    if (w.basis.includes('inner-motion') && (!m.measured.picture || w.motion === null)) return `window ${i} is based on movement that was not measured`;
    if (w.basis.includes('sound') && (!m.measured.sound || w.level === null)) return `window ${i} is based on sound that was not measured`;
    if (new Set(w.basis).size !== w.basis.length) return `window ${i} names a basis twice`;
  }
  return null;
}
