/** Pure calculations of the timeline zoom (pixels per second). No DOM, no React. */
export const MIN_PPS = 10;
export const MAX_PPS = 720;
/** Step of the zoom buttons: the same factor as the `=` / `-` keyboard commands. */
export const ZOOM_STEP = 1.5;
/** Width of the track-header gutter on the left of the time axis. */
export const GUTTER_PX = 76;
export const SLIDER_MAX = 1000;
/** Free space kept after the end of the timeline when it is fitted, in seconds. */
export const FIT_MARGIN_S = 1;
/** Space kept on the right of a fitted timeline, in pixels. */
const FIT_PAD_PX = 12;

export const clampPps = (pps: number): number => (Number.isFinite(pps) ? Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) : MIN_PPS);

/** Slider position 0..SLIDER_MAX on a logarithmic scale to pixels per second. */
export function sliderToPps(v: number): number {
  const u = Math.min(1, Math.max(0, v / SLIDER_MAX));
  return clampPps(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, u));
}

/** Pixels per second to the slider position (inverse of `sliderToPps`). */
export function ppsToSlider(pps: number): number {
  return (Math.log(clampPps(pps) / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * SLIDER_MAX;
}

/**
 * The zoom at which a timeline of `durationS` seconds (plus a small margin) fits the visible width of the scroll area.
 * An empty timeline gives `defaultPps`.
 */
export function fitPps(durationS: number, viewWidth: number, defaultPps: number, gutter = GUTTER_PX): number {
  if (!(durationS > 0)) return clampPps(defaultPps);
  const avail = viewWidth - gutter - FIT_PAD_PX;
  if (!(avail > 0)) return MIN_PPS;
  return clampPps(avail / (durationS + FIT_MARGIN_S));
}

/**
 * The `scrollLeft` that keeps the anchor time at the same x (relative to the scroll area's left edge) after the zoom changes
 * from `oldPps` to `newPps`. Content x of time t is `gutter + t * pps`.
 */
export function scrollLeftAfterZoom(a: { scrollLeft: number; oldPps: number; newPps: number; anchorX: number; gutter?: number }): number {
  const g = a.gutter ?? GUTTER_PX;
  const t = (a.scrollLeft + a.anchorX - g) / a.oldPps;
  return Math.max(0, g + t * a.newPps - a.anchorX);
}

/** Anchor x (relative to the scroll area): the playhead when it is visible, otherwise the centre of the visible time area. */
export function zoomAnchorX(a: { playheadS: number; pps: number; scrollLeft: number; viewWidth: number; gutter?: number }): number {
  const g = a.gutter ?? GUTTER_PX;
  const x = g + a.playheadS * a.pps - a.scrollLeft;
  return x >= g && x <= a.viewWidth ? x : g + (a.viewWidth - g) / 2;
}

/** Multiplier for a Ctrl/⌘+wheel event: proportional to `deltaY`, so a trackpad pinch is smooth. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 100 : deltaY;
  return Math.exp(-Math.max(-200, Math.min(200, px)) * 0.0025);
}
