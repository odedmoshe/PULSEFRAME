/**
 * Photosensitivity check of an export (ADR-0009 decision 4): every frame the encoder receives is also fed to the
 * engine's FlashAnalyser, so the export reports, in its manifest, the stretches that flash more than three times a
 * second over a large enough area. It reads the frames that were actually rendered, so it covers everything that can
 * make a screen flash. It never changes or blocks the export: the owner decides.
 */
import * as T from '@pulseframe/time';
import { FlashAnalyser, flashCells, type FlashCells, type FlashReport } from '@pulseframe/engine';

export interface PhotosensitivityReport {
  /** What was applied, in words, so a reader of the manifest knows its limits. */
  method: string;
  verdict: 'pass' | 'fail';
  /** Frames analysed (the export's frames, from its first frame on). */
  frames: number;
  /** Failing stretches in timeline time (exact rationals), with the most flashes counted in one second and the share of the frame. */
  ranges: { from: T.RationalTime; to: T.RationalTime; kind: 'general' | 'red'; flashesPerSecond: number; area: number }[];
}
export const PHOTOSENSITIVITY_METHOD = 'General and red flash thresholds of WCAG 2.3.1 (ITU-R BT.1702 family), approximated on 24 × 24 cells of the rendered frames: a stretch fails when more than a quarter of a 10-degree window (a third of the width and height) flashes more than three times in a second. A guide, not a certification.';

export class FrameFlashCheck {
  private readonly analyser: FlashAnalyser;
  private readonly frameBytes: number;
  constructor(private readonly width: number, private readonly height: number, private readonly rate: T.Rate) {
    this.analyser = new FlashAnalyser(rate.num / rate.den);
    this.frameBytes = width * height * 4;
  }
  /** RGBA frames, in order, a whole number of them (as the render page posts them). */
  feed(data: Uint8Array): void {
    for (let o = 0; o + this.frameBytes <= data.length; o += this.frameBytes) this.analyser.push(flashCells(data.subarray(o, o + this.frameBytes), this.width, this.height));
  }
  /** The result, with frame numbers turned into timeline times: the export's frame 0 is timeline frame `firstFrame`. */
  report(firstFrame: number): PhotosensitivityReport {
    return photosensitivityReport(this.analyser.report(), this.rate, firstFrame);
  }
}
/** The analyser's report in the manifest's words, shared by the single-pass check and reportFromCells. */
function photosensitivityReport(r: FlashReport, rate: T.Rate, firstFrame: number): PhotosensitivityReport {
  const at = (k: number) => T.frameTime(firstFrame + k, rate);
  return {
    method: PHOTOSENSITIVITY_METHOD,
    verdict: r.verdict,
    frames: r.frames,
    ranges: r.ranges.map((x) => ({ from: at(x.from), to: at(x.to + 1), kind: x.kind, flashesPerSecond: x.flashesPerSecond, area: x.area })),
  };
}
/**
 * The same report from per-frame cells (ADR-0024): a segmented export stores each frame's cells with its segment and feeds the
 * cells of ALL programme frames of the exported range, in order (stored ones for reused segments, fresh ones for rendered
 * segments), through ONE analyser, so the one-second windows span the joins exactly as in a single pass and a flash sequence
 * that straddles a join is counted whole. For the same frames it equals FrameFlashCheck's report (flashCheck.test.ts).
 */
export function reportFromCells(cells: Iterable<FlashCells>, rate: T.Rate, firstFrame: number): PhotosensitivityReport {
  const analyser = new FlashAnalyser(rate.num / rate.den);
  for (const c of cells) analyser.push(c);
  return photosensitivityReport(analyser.report(), rate, firstFrame);
}
