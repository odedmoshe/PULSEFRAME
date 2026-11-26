/**
 * «הפריים הכי חד» in the object inspector (wave 8 cover, version 1). Lead pre-pass: the mount point and this empty stub; W3 builds
 * the block (tiles with their numbers, one-frame stepping at the file's own rate, the save dialog) against core stillsContract.ts,
 * stillDocument.ts and printFit.ts, the api calls findSharpFrames / readSharpFrames / exportStill, the ids of cover.testids.ts and
 * the words of cover.strings.ts. Until then nothing is shown: InspectorObject.tsx mounts the section only when COVER_UI_BUILT.
 */
import type { MediaClip } from '@pulseframe/core';

/** True once W3 has built the block (InspectorObject.tsx mounts the section only then). */
export const COVER_UI_BUILT = false;

export function SharpBlock({ clip }: { clip: MediaClip }) {
  void clip;
  return null;
}
