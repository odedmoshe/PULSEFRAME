/**
 * The one-clip document the source viewer (and the camera overlay, and the growing dialog's marking view) draws a library file
 * with: the same evaluator, compositor and sound path as the timeline, on a document that is never saved. Pure (no browser API),
 * so it is unit-tested on its own (sourceDocument.test.ts).
 * The frame is the file's own picture shape AS SHOWN: asset.video width × height for a video, and (wave 8 growing, verifier C4)
 * asset.image width × height for a still — the size ingest records after EXIF orientation, which is also what the browser's
 * decode draws (media.ts createImageBitmap, image orientation from the file). A still used to fall to the 640×120 default and was
 * letterboxed. Sizes are rounded to even numbers (at least 2); with the file's own shape the picture fills the frame under
 * 'contain', so (u, v) on the canvas are (u, v) of the shown picture up to that rounding.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type Asset, type ProjectDocument } from '@pulseframe/core';

/** A document holding only this file as one clip from its first frame, in the project's rate; the frame is the file's own picture shape. */
export function sourceDocument(project: ProjectDocument, asset: Asset): ProjectDocument {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const shape = asset.video ?? (asset.kind === 'image' ? asset.image : undefined);
  const base = createProject({ id: 'prj_source_viewer', name: asset.name, width: even(shape?.width ?? 640), height: even(shape?.height ?? 120), frameRate: project.settings.frameRate, sampleRate: project.settings.sampleRate });
  base.assets[asset.id] = asset;
  return applyTransaction(base, [{ op: 'add_clip', args: { assetId: asset.id, start: T.ZERO } }], { idSeed: 'src_', actor: 'source-viewer' }).doc;
}
