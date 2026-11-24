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
 * Angle viewers (draftMaxHeight): always draft, at most that many lines high.
 *
 * Both sides are rounded from one scale, so the playing picture has the project's shape within a pixel; drawGraph places
 * every layer as a fraction of the frame, so the geometry is the same at the smaller size.
 */
export const PLAYING_SHORT_SIDE = 540;

export interface PictureSize {
  width: number;
  height: number;
  /** The playing picture's size over the project's. */
  scale: number;
  /** 'draft': proxy frames and drawGraph's draft quality. 'full': the originals, the exact picture. */
  quality: 'draft' | 'full';
}

export function pictureSize(settings: { width: number; height: number }, view: { playing: boolean; draftMaxHeight?: number }): PictureSize {
  const { width, height } = settings;
  const short = Math.min(width, height);
  const scale = view.draftMaxHeight ? Math.min(1, view.draftMaxHeight / height) : view.playing && short > 0 ? Math.min(1, PLAYING_SHORT_SIDE / short) : 1;
  const quality = view.draftMaxHeight !== undefined || (view.playing && scale !== 1) ? 'draft' : 'full';
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale, quality };
}
