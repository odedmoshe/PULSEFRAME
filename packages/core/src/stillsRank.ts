/**
 * The sharpest-frame ranking and the range of a clip (wave 8 cover, version 1). Lead pre-pass: signatures; W1 builds the bodies
 * (pure, integers, deterministic) by the rules written in stillsContract.ts ("RANKING") and verify C2/C4/C13.
 */
import type { Asset, ProjectDocument } from './schema.ts';
import { stillsRefusal, type StillMeasure, type StillsRanking } from './stillsContract.ts';

/**
 * Median and up to STILLS_CANDIDATES candidates of [from, to) from the measured frames (ascending, unique). The median and the
 * candidates are over every frame of the range; a range with a frame missing gives { median: null, candidates: [] } (not complete).
 * `asset` supplies the rate (separation) and each candidate's time (sourceTimeOfFrame).
 */
export function rankStills(asset: Pick<Asset, 'video'>, measured: readonly StillMeasure[], from: number, to: number): StillsRanking {
  void asset; void measured; void from; void to;
  throw stillsRefusal('notBuilt', []);
}
/**
 * The source frames [from, to) of the file's video stream that a clip shows (speed, reverse and freeze honoured through speed.ts;
 * a freeze clip gives one frame), in any sequence of the document. Refused (StillsRefusal) for an unknown clip (notPictureClip),
 * a clip that shows no video file (notPictureClip), and a range over STILLS_MAX_RANGE_FRAMES (rangeTooLong).
 */
export function rangeOfClip(doc: ProjectDocument, clipId: string): { assetId: string; from: number; to: number } {
  void doc; void clipId;
  throw stillsRefusal('notBuilt', []);
}
