/**
 * The sharpest-frame ranking and the range of a clip (wave 8 cover, version 1). Lead pre-pass: signatures; W1 builds the bodies
 * (pure, integers, deterministic) by the rules written in stillsContract.ts ("RANKING") and verify C2/C4/C13.
 * The ranking only ever compares frames of ONE range of ONE file ("within this clip, by this measure"); it says nothing across clips.
 */
import * as T from '@pulseframe/time';
import { isMovingPicture, videoFrames } from './momentsContract.ts';
import type { Asset, MediaClip, ProjectDocument } from './schema.ts';
import { sourceFrameIndexAt, sourceTimeOfFrame } from './speed.ts';
import {
  STILLS_CANDIDATES, STILLS_MANY_CLIPPED_PERMILLE, STILLS_MAX_RANGE_FRAMES, STILLS_SEPARATION_SECONDS, stillsRefusal,
  STILLS_MEASURE_BUILT, type SharpCandidate, type StillMeasure, type StillsRanking,
} from './stillsContract.ts';

/** Whether the bodies answer (the core flag STILLS_MEASURE_BUILT; until the integrator flips it they refuse stills_not_built). */
let rankBuilt: boolean = STILLS_MEASURE_BUILT;
/** TEST ONLY: run the bodies before the core flag is flipped at integration (W1's own tests). */
export const setStillsRankBuiltForTests = (on: boolean) => { rankBuilt = on; };

/** The lower median of integers (the same rule as moments: sorted[floor((n − 1) / 2)]); 0 for none. */
export function stillsMedian(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)]!;
}
/** Whole frames of the file's own rate between two candidates: ceil(STILLS_SEPARATION_SECONDS · rate). */
export const stillsSeparationFrames = (rate: { num: number; den: number }): number => Math.ceil((STILLS_SEPARATION_SECONDS * rate.num) / rate.den);

/**
 * Median and up to STILLS_CANDIDATES candidates of [from, to) from the measured frames (ascending, unique). The median and the
 * candidates are over every frame of the range; a range with a frame missing gives { median: null, candidates: [] } (not complete).
 * `asset` supplies the rate (separation) and each candidate's time (sourceTimeOfFrame).
 */
export function rankStills(asset: Pick<Asset, 'video'>, measured: readonly StillMeasure[], from: number, to: number): StillsRanking {
  if (!rankBuilt) throw stillsRefusal('notBuilt', []);
  if (!asset.video) throw stillsRefusal('noVideo', ['?']);
  if (!(Number.isSafeInteger(from) && Number.isSafeInteger(to)) || from < 0 || to <= from) return { median: null, candidates: [] };
  const byFrame = new Map<number, StillMeasure>();
  for (const m of measured) if (m.frame >= from && m.frame < to) byFrame.set(m.frame, m);
  if (byFrame.size !== to - from) return { median: null, candidates: [] };
  const rows: StillMeasure[] = [];
  for (let f = from; f < to; f++) rows.push(byFrame.get(f)!);
  const median = stillsMedian(rows.map((r) => r.sharp));
  // local maxima inside the range: strictly above both neighbours, or equal to the earlier one and above the later one
  // (a plateau that ends in a descent gives its last frame); a neighbour outside the range is not compared
  const peaks: StillMeasure[] = [];
  for (let i = 0; i < rows.length; i++) {
    const s = rows[i]!.sharp, earlier = i > 0 ? rows[i - 1]!.sharp : null, later = i + 1 < rows.length ? rows[i + 1]!.sharp : null;
    if ((later === null || s > later) && (earlier === null || s >= earlier)) peaks.push(rows[i]!);
  }
  const motionKey = (m: number | null) => (m === null ? Number.POSITIVE_INFINITY : m);
  peaks.sort((a, b) => b.sharp - a.sharp || motionKey(a.motion) - motionKey(b.motion) || a.frame - b.frame);
  const sep = stillsSeparationFrames(asset.video.frameRate);
  const picked: StillMeasure[] = [];
  for (const p of peaks) {
    if (picked.length >= STILLS_CANDIDATES) break;
    if (picked.every((q) => Math.abs(q.frame - p.frame) >= sep)) picked.push(p);
  }
  const candidates: SharpCandidate[] = picked.map((m) => ({
    frame: m.frame, time: sourceTimeOfFrame(asset, m.frame),
    sharp: m.sharp, sobel: m.sobel, sigma100: m.sigma100,
    sharpRatioPermille: Math.round((1000 * m.sharp) / Math.max(1, median)),
    motion: m.motion, hi: m.hi, lo: m.lo,
    manyClipped: m.hi > STILLS_MANY_CLIPPED_PERMILLE,
  }));
  return { median, candidates };
}

/**
 * The source frames [from, to) of the file's video stream that a clip shows (speed, reverse and freeze honoured through speed.ts;
 * a freeze clip gives one frame), in any sequence of the document. Refused (StillsRefusal) for an unknown clip (notPictureClip),
 * a clip that shows no video file (notPictureClip), and a range over STILLS_MAX_RANGE_FRAMES (rangeTooLong).
 * The ends are the source frames shown at the clip's first and last project frames (sourceFrameIndexAt, the evaluator's rule);
 * every source frame between them is in the range, at the FILE's own rate (a 60 fps file in a 30 fps project gives every one of
 * its frames, not every other).
 */
export function rangeOfClip(doc: ProjectDocument, clipId: string): { assetId: string; from: number; to: number } {
  if (!rankBuilt) throw stillsRefusal('notBuilt', []);
  const rate = doc.settings.frameRate;
  let clip: MediaClip | null = null;
  for (const seq of Object.values(doc.sequences ?? {})) {
    for (const tr of seq.tracks) {
      for (const c of tr.clips) {
        if (c.id !== clipId) continue;
        if (tr.kind !== 'video' || c.type !== 'media') throw stillsRefusal('notPictureClip', [clipId]);
        clip = c;
      }
    }
  }
  if (!clip) throw stillsRefusal('notPictureClip', [clipId]);
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  if (!asset || !isMovingPicture(asset) || !asset.video) throw stillsRefusal('notPictureClip', [clipId]);
  const a = { ...asset, video: asset.video };
  const last = T.max(clip.start, T.sub(T.add(clip.start, clip.duration), T.frameTime(1, rate)));
  const x = sourceFrameIndexAt(a, clip, clip.start, rate), y = sourceFrameIndexAt(a, clip, last, rate);
  const from = Math.min(x, y), to = Math.min(Math.max(x, y) + 1, videoFrames(asset) ?? Math.max(x, y) + 1);
  if (to - from > STILLS_MAX_RANGE_FRAMES) throw stillsRefusal('rangeTooLong', [to - from, STILLS_MAX_RANGE_FRAMES], { clipId, from, to, max: STILLS_MAX_RANGE_FRAMES });
  return { assetId: asset.id, from, to };
}
