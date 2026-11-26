/**
 * The one-clip document of a still (wave 8 cover, version 1; verify C5/C6). Lead pre-pass: the signature; W2 builds the body.
 * The ONE document the editor's tile (paused player) and the server's saved picture (Exporter.renderStill) draw, so tile = still.
 *
 * Rules W2 keeps: frame = the stored file's own width × height (odd sizes kept: no even rounding for a still), frame rate = the
 * file's own rate (a picture file: 30/1), one video track with one media clip of the asset at time 0 lasting one frame, fit
 * 'contain', the default transform, no effects, no title, no sound; sourceIn = sourceTimeOfFrame(asset, sourceFrame) for a
 * video (0 for a picture). The picture is then drawn 1:1, and a crop is cut AFTER rendering (ffmpeg crop on the lossless PNG),
 * never by scaling the clip. A side over STILL_MAX_SIDE, a frame outside the file or a file without a picture is refused with
 * the STILLS_REFUSALS row (stillTooLarge, stillTooSmall, stillFrame, stillNoPicture). The asset itself is copied into the document's assets, so
 * the renderer reads the same stored bytes (the original, never the proxy).
 */
import * as T from '@pulseframe/time';
import { videoFrames } from './momentsContract.ts';
import { DEFAULT_TRANSFORM, SCHEMA_VERSION, type Asset, type ProjectDocument } from './schema.ts';
import { sourceTimeOfFrame } from './speed.ts';
import { STILL_MAX_SIDE, STILL_MIN_SIDE, stillsRefusal } from './stillsContract.ts';

/** The frame rate of a still of a picture file (one frame; the rate only sets how long the clip lasts). */
export const STILL_PICTURE_RATE = { num: 30, den: 1 } as const;
/** Ids inside a still's document (fixed, so two stills of the same frame are the same document). */
export const STILL_DOC_IDS = { project: 'prj_still', sequence: 'seq_main', track: 'trk_video', clip: 'clp_still' } as const;

/** The picture a still is drawn from: the stored file's own size and the rate its frames are counted at. Refuses as stillDocument does. */
export function stillPicture(asset: Asset, sourceFrame: number): { width: number; height: number; rate: T.Rate; picture: boolean; frames: number } {
  const picture = asset.kind === 'image' && !!asset.image;
  const size = picture ? asset.image! : asset.kind === 'video' && asset.video ? asset.video : null;
  if (!size) throw stillsRefusal('stillNoPicture', [asset.id]);
  const frames = picture ? 1 : videoFrames(asset)!;
  if (!Number.isSafeInteger(sourceFrame) || sourceFrame < 0 || sourceFrame >= frames) throw stillsRefusal('stillFrame', [sourceFrame, frames]);
  if (size.width > STILL_MAX_SIDE || size.height > STILL_MAX_SIDE) throw stillsRefusal('stillTooLarge', [size.width, size.height]);
  // below the schema's minimum frame (16 px a side) the one-clip document would not be a valid document
  if (size.width < STILL_MIN_SIDE || size.height < STILL_MIN_SIDE) throw stillsRefusal('stillTooSmall', [size.width, size.height]);
  return { width: size.width, height: size.height, rate: picture ? { ...STILL_PICTURE_RATE } : { ...asset.video!.frameRate }, picture, frames };
}

export function stillDocument(asset: Asset, sourceFrame: number): ProjectDocument {
  const p = stillPicture(asset, sourceFrame);
  const sourceIn = p.picture ? T.ZERO : sourceTimeOfFrame(asset, sourceFrame);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: STILL_DOC_IDS.project,
    name: 'still',
    // odd sizes are kept: the picture is drawn 1:1, never rounded to even sides
    settings: { width: p.width, height: p.height, frameRate: p.rate, sampleRate: 48000, background: '#000000', fit: 'contain' },
    assets: { [asset.id]: structuredClone(asset) },
    sequences: {
      [STILL_DOC_IDS.sequence]: {
        id: STILL_DOC_IDS.sequence, name: 'Still',
        tracks: [{
          id: STILL_DOC_IDS.track, kind: 'video', name: 'V1', locked: false, muted: true, hidden: false,
          clips: [{ id: STILL_DOC_IDS.clip, type: 'media', assetId: asset.id, start: T.ZERO, duration: T.frameTime(1, p.rate), sourceIn, transform: { ...DEFAULT_TRANSFORM }, gain: 0, linkGroupId: null }],
        }],
      },
    },
    mainSequenceId: STILL_DOC_IDS.sequence,
    transcripts: {}, analyses: {}, variants: {}, recipeRuns: {}, markers: {}, motionTracks: {}, events: {},
  };
}
