/**
 * The picture card of «תא הבדיקה» (wave 8 booth). BUILDER W2: the booth's own scene on the two test pictures (GET
 * /api/v1/booth/test-picture/a|b), drawn by drawGraph(evaluate(doc, frame)) as the gallery tiles are; a still first (mid-transition or
 * effect frame); «הפעלה» plays the window once with every frame through the dialog's ONE FlashGuard; prefers-reduced-motion → three
 * stills, no playback; changesLight items start as a still with booth.changesLight; no adapter → booth.needsGpu and only «דלגו».
 * The canvas is role="img" with a Hebrew description (BOOTH_TESTIDS.pictureCanvas). Not mounted until W3's dialog mounts it.
 */
import type { BoothPictureProps } from './booth.contract.ts';

export function BoothPicture(props: BoothPictureProps): null {
  void props;
  return null;
}
