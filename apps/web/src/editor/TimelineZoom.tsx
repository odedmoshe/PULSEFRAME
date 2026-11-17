import { useCallback, useRef } from 'react';
import { flushSync } from 'react-dom';
import * as T from '@pulseframe/time';
import { MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import type { Editor } from './store.ts';
import { useEditorState } from './store.ts';
import { ZOOM_STRINGS } from './zoom.strings.ts';
import { clampPps, fitPps, ppsToSlider, scrollLeftAfterZoom, SLIDER_MAX, sliderToPps, wheelFactor, ZOOM_STEP, zoomAnchorX } from './zoom.math.ts';
import './timelineZoom.css';

/** The zoom the store starts with, read from the first editor state seen here (before anything could change it). */
let initialPps: number | null = null;
const defaultPps = (editor: Editor) => (initialPps ??= editor.getState().pxPerSecond);

const scroller = (from: Element | null) => from?.closest('.timeline')?.querySelector<HTMLElement>('.tl-scroll') ?? null;

/** Set the zoom and keep `anchorX` (relative to the scroll area) on the same time. */
function zoomTo(editor: Editor, el: HTMLElement | null, next: number, anchorX?: number) {
  const oldPps = editor.getState().pxPerSecond;
  const newPps = clampPps(next);
  if (newPps === oldPps) return;
  if (!el) { editor.set({ pxPerSecond: newPps }); return; }
  const ax = anchorX ?? zoomAnchorX({ playheadS: T.toSeconds(editor.playhead), pps: oldPps, scrollLeft: el.scrollLeft, viewWidth: el.clientWidth });
  const scrollLeft = scrollLeftAfterZoom({ scrollLeft: el.scrollLeft, oldPps, newPps, anchorX: ax });
  flushSync(() => editor.set({ pxPerSecond: newPps }));
  el.scrollLeft = scrollLeft;
}

/** Callback ref for the scrolling element: Ctrl/⌘+wheel (and trackpad pinch) zooms around the pointer; a plain wheel scrolls as before. */
export function useWheelZoom() {
  const { editor } = useEditorState();
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

export function TimelineZoom() {
  const { editor, state } = useEditorState();
  const s = ZOOM_STRINGS[state.lang];
  const pps = state.pxPerSecond;
  const root = useRef<HTMLSpanElement>(null);
  const el = () => scroller(root.current);
  defaultPps(editor);
  const fit = () => {
    const sc = el();
    const dur = state.doc ? T.toSeconds(editor.duration) : 0;
    zoomTo(editor, sc, fitPps(dur, sc?.clientWidth ?? 0, defaultPps(editor)));
    if (sc) sc.scrollLeft = 0;
  };
  return (
    <span ref={root} className="tl-zoom" role="group" aria-label={s.group} dir="ltr" data-testid="tl-zoom">
      <button type="button" className="tl-zoom-btn" data-testid="tl-zoom-out" aria-label={s.out} title={s.out} onClick={() => zoomTo(editor, el(), pps / ZOOM_STEP)}><ZoomOut size={14} aria-hidden="true" /></button>
      <input type="range" className="tl-zoom-slider" data-testid="tl-zoom-slider" min={0} max={SLIDER_MAX} step={1} value={Math.round(ppsToSlider(pps))}
        aria-label={s.slider} aria-valuetext={s.value(pps)} onChange={(e) => zoomTo(editor, el(), sliderToPps(Number(e.target.value)))} />
      <button type="button" className="tl-zoom-btn" data-testid="tl-zoom-in" aria-label={s.in} title={s.in} onClick={() => zoomTo(editor, el(), pps * ZOOM_STEP)}><ZoomIn size={14} aria-hidden="true" /></button>
      {/* the label and the icon are never shown together (timelineZoom.css); the name is the label at every width */}
      <button type="button" className="tl-zoom-btn tl-zoom-fit" data-testid="tl-zoom-fit" aria-label={s.fit} title={s.fitTitle} onClick={fit}><MoveHorizontal className="tl-zoom-fit-ico" size={14} aria-hidden="true" /><span className="tl-zoom-fit-label">{s.fit}</span></button>
    </span>
  );
}
