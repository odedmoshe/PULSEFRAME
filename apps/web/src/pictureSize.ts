/**
 * The size the preview composites a frame at, and the quality that goes with it (ADR-0005, amendment of 2026-11-24). One rule
 * for the player's pump, for pictureQuality() (which decoders prefetch warms) and for the lab's playback bench.
 *
 * Paused: the project's own size, the full picture (identical to a still and to export).
 * Playing: the short side of the frame is at most PLAYING_SHORT_SIDE px, the height of a proxy (apps/server derive.ts: a proxy
 * is at most 540 lines high). A landscape or square frame is then exactly as high as its proxies, so a picture fitted to the
 * frame is drawn from its proxy pixel for pixel, with no resampling per layer; the browser scales the one finished canvas to
 * the layout. Measured on CPU canvases (pnpm bench:playback): drawing a 960×540 proxy frame at 1707×960, the size playback had
 * before, cost about five times what drawing it at 960×540 costs, per layer. A frame that is not reduced (short side at most
 * 540) plays at full size and full quality.
 * That is the viewer's choice 'smooth', the default. With 'sharper' (a preference of this browser, never project state:
 * Settings, editor/store.ts playSharpness) the playing frame is at most PLAYING_HEIGHT_SHARPER px high instead, the rule until
 * 2026-11-24: 1707×960 for a 1920×1080 project, so titles are drawn larger, and every layer is resampled up from its proxy
 * per frame. On CPU canvases that costs about three times as much per frame and drops frames; a computer with a graphics
 * card may play it smoothly (not measured here). Sharper is never a smaller picture than smooth.
 * Angle viewers (draftMaxHeight): always draft, at most that many lines high; the viewer's choice does not apply to them.
 *
 * Both sides are rounded from one scale, so the playing picture has the project's shape within a pixel; drawGraph places
 * every layer as a fraction of the frame, so the geometry is the same at the smaller size.
 */
export const PLAYING_SHORT_SIDE = 540;
/** 'sharper': the playing frame's height at most this. */
export const PLAYING_HEIGHT_SHARPER = 960;
/** The viewer's choice of the playing picture: 'smooth' (the default) or 'sharper'. */
export type PlaySharpness = 'smooth' | 'sharper';
/** localStorage key of that choice (per browser; the editor's store reads and writes it). */
export const PLAY_SHARPNESS_KEY = 'pf.playSharpness';
/** A stored value of any kind: 'sharper' only when it says exactly that, else the default. */
export const parsePlaySharpness = (raw: unknown): PlaySharpness => (raw === 'sharper' ? 'sharper' : 'smooth');

export interface PictureSize {
  width: number;
  height: number;
  /** The playing picture's size over the project's. */
  scale: number;
  /** 'draft': proxy frames and drawGraph's draft quality. 'full': the originals, the exact picture. */
  quality: 'draft' | 'full';
}

export function pictureSize(settings: { width: number; height: number }, view: { playing: boolean; draftMaxHeight?: number; sharpness?: PlaySharpness }): PictureSize {
  const { width, height } = settings;
  const short = Math.min(width, height);
  const smooth = short > 0 ? Math.min(1, PLAYING_SHORT_SIDE / short) : 1;
  // never smaller than smooth: a frame higher than 960 and at most 540 wide (480×1000) is not reduced by smooth at all
  const playing = view.sharpness === 'sharper' && height > 0 ? Math.max(smooth, Math.min(1, PLAYING_HEIGHT_SHARPER / height)) : smooth;
  const scale = view.draftMaxHeight ? Math.min(1, view.draftMaxHeight / height) : view.playing ? playing : 1;
  const quality = view.draftMaxHeight !== undefined || (view.playing && scale !== 1) ? 'draft' : 'full';
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale, quality };
}
