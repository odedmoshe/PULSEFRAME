/**
 * The one-clip document of a still (wave 8 cover, version 1; verify C5/C6). Lead pre-pass: the signature; W2 builds the body.
 * The ONE document the editor's tile (paused player) and the server's saved picture (Exporter.renderStill) draw, so tile = still.
 *
 * Rules W2 keeps: frame = the stored file's own width × height (odd sizes kept: no even rounding for a still), frame rate = the
 * file's own rate (a picture file: 30/1), one video track with one media clip of the asset at time 0 lasting one frame, fit
 * 'contain', the default transform, no effects, no title, no sound; sourceIn = sourceTimeOfFrame(asset, sourceFrame) for a
 * video (0 for a picture). The picture is then drawn 1:1, and a crop is cut AFTER rendering (ffmpeg crop on the lossless PNG),
 * never by scaling the clip. A side over STILL_MAX_SIDE, a frame outside the file or a file without a picture is refused with
 * the STILLS_REFUSALS row (stillTooLarge, stillFrame, stillNoPicture). The asset itself is copied into the document's assets, so
 * the renderer reads the same stored bytes (the original, never the proxy).
 */
import type { Asset, ProjectDocument } from './schema.ts';
import { stillsRefusal } from './stillsContract.ts';

export function stillDocument(asset: Asset, sourceFrame: number): ProjectDocument {
  void asset; void sourceFrame;
  throw stillsRefusal('stillNotBuilt', []);
}
