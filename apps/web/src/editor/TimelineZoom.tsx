import { memo, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import * as T from '@pulseframe/time';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button, IconButton } from '../ds/index.ts';
import type { Lang } from '@pulseframe/i18n';
import type { Editor } from './store.ts';
import { useEditor } from './store.ts';
import { TL_STRINGS } from './timeline.strings.ts';
import { clampPps, fitPps, ppsToSlider, scrollLeftAfterZoom, SLIDER_MAX, sliderToPps, wheelFactor, ZOOM_STEP, zoomAnchorX } from './zoom.math.ts';
import './timelineZoom.css';

/** The zoom the store starts with, read from the first editor state seen here (before anything could change it). */
let initialPps: number | null = null;
const defaultPps = (editor: Editor) => (initialPps ??= editor.getState().pxPerSecond);

const scroller = (from: Element | null) => from?.closest('.timeline')?.querySelector<HTMLElement>('.tl-scroll') ?? null;
/** Width of the track-header column on the left of the time axis (the --pf-track-head token, as it is at this window size). */
const gutterOf = (el: Element | null): number => {
  const tl = el?.closest('.timeline');
  const v = tl ? parseFloat(getComputedStyle(tl).getPropertyValue('--pf-track-head')) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 156;
};

/** Set the zoom and keep `anchorX` (relative to the scroll area) on the same time. */
function zoomTo(editor: Editor, el: HTMLElement | null, next: number, anchorX?: number) {
  const oldPps = editor.getState().pxPerSecond;
  const newPps = clampPps(next);
  if (newPps === oldPps) return;
  if (!el) { editor.set({ pxPerSecond: newPps }); return; }
  const gutter = gutterOf(el);
  const ax = anchorX ?? zoomAnchorX({ playheadS: T.toSeconds(editor.playhead), pps: oldPps, scrollLeft: el.scrollLeft, viewWidth: el.clientWidth, gutter });
  const scrollLeft = scrollLeftAfterZoom({ scrollLeft: el.scrollLeft, oldPps, newPps, anchorX: ax, gutter });
  flushSync(() => editor.set({ pxPerSecond: newPps }));
  el.scrollLeft = scrollLeft;
}

/** Callback ref for the scrolling element: Ctrl/⌘+wheel (and trackpad pinch) zooms around the pointer; a plain wheel scrolls as before. */
export function useWheelZoom() {
  const editor = useEditor();
  const off = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    off.current?.(); off.current = null;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ax = e.clientX - el.getBoundingClientRect().left;
      zoomTo(editor, el, editor.getState().pxPerSecond * wheelFactor(e.deltaY, e.deltaMode), ax);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    off.current = () => el.removeEventListener('wheel', onWheel);
  }, [editor]);
}

/**
 * "The whole edit" (Shift+Z), zoom out, the zoom slider and zoom in: the end of the timeline's toolbar.
 * It takes the zoom and the language from the timeline and does not listen to the player, so playback does not redraw it.
 */
export const TimelineZoom = memo(function TimelineZoom({ pps, lang }: { pps: number; lang: Lang }) {
  const editor = useEditor();
  const s = TL_STRINGS[lang];
  const root = useRef<HTMLSpanElement>(null);
  const el = () => scroller(root.current);
  defaultPps(editor);
  const fit = useCallback(() => {
    const sc = scroller(root.current);
    const dur = editor.doc ? T.toSeconds(editor.duration) : 0;
    zoomTo(editor, sc, fitPps(dur, sc?.clientWidth ?? 0, defaultPps(editor), gutterOf(sc)));
    if (sc) sc.scrollLeft = 0;
  }, [editor]);
  // Shift+Z shows the whole edit (a physical key, so it works on a Hebrew layout); never while typing or behind a dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyZ' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      fit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);
  // what the slider says to assistive technology: how much time one screen shows, not a pixel count
  const across = (() => { const sc = el(); const w = sc ? sc.clientWidth - gutterOf(sc) : 0; return w > 0 ? String(Math.round(w / pps)) : String(Math.round(1200 / pps)); })();
  return (
    <span ref={root} className="tl-zoom" role="group" aria-label={s.zoomGroup} dir="ltr" data-testid="tl-zoom">
      {/* the one zoom button with a word (DESIGN_REVIEW WP1): it shows the whole film */}
      <Button size="sm" variant="ghost" className="tl-zoom-btn tl-act" data-testid="tl-zoom-fit" keys={['Shift', 'Z']} icon={<Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={fit}>{s.fitWord}</Button>
      <IconButton size="sm" className="tl-zoom-btn" data-testid="tl-zoom-out" label={s.zoomOut} keys={['-']} icon={<ZoomOut size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={() => zoomTo(editor, el(), pps / ZOOM_STEP)} />
      <input type="range" className="tl-zoom-slider" data-testid="tl-zoom-slider" min={0} max={SLIDER_MAX} step={1} value={Math.round(ppsToSlider(pps))} style={{ '--v': `${(ppsToSlider(pps) / SLIDER_MAX) * 100}%` } as React.CSSProperties}
        aria-label={s.zoomSlider} aria-valuetext={s.zoomValue(across)} onChange={(e) => zoomTo(editor, el(), sliderToPps(Number(e.target.value)))} />
      <IconButton size="sm" className="tl-zoom-btn" data-testid="tl-zoom-in" label={s.zoomIn} keys={['=']} icon={<ZoomIn size={15} strokeWidth={1.75} aria-hidden="true" />} onClick={() => zoomTo(editor, el(), pps * ZOOM_STEP)} />
    </span>
  );
});
