/**
 * The splitter between the viewer and the timeline (docs/design/UX_REDESIGN.md §4.1): a grip that is dragged, or moved
 * with the arrow keys (role=separator with aria-valuenow: the timeline's height in pixels). A double-click, Enter or Home
 * returns to the usual height.
 *
 * The shell (ds/shell.css) places this element in the `split` area and reads the timeline's height from --pf-shell-tl on
 * the shell element (`.app`, this element's parent); the splitter is the one that sets it:
 *   - a height the viewer chose: remembered in this browser (never in the project), one per film shape (tall or wide), and
 *     kept within the window;
 *   - otherwise the usual height (interactions.math tlUsual): as tall as the timeline's lanes need (--pf-tl-natural, set by
 *     Timeline.tsx), at most 30% of the window for a tall film and 38% for a wide one; in Sound mode as tall as the taller
 *     sound lanes need (never less than the lanes, never more than the window leaves).
 * Keep the root element and its data-shell-slot: the shell finds the mount by it.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Tooltip } from '../ds/index.ts';
import { splitterHeight, splitterKey, tlUsual } from './interactions.math.ts';
import { useEditorState } from './store.ts';
import { TL_STRINGS } from './timeline.strings.ts';

/** Before heights were kept per film shape (wave 8D) one height was kept for all: it stands for wide films. */
const OLD_KEY = 'pf.tl.height.v1';
const MIN_H = 200;       // toolbar, Pulse Strip, ruler and the main lane still fit
const KEEP_ABOVE = 260;  // what the top bar and the viewer above keep, whatever is asked for

const readStored = (key: string): number | null => {
  try {
    const raw = localStorage.getItem(key) ?? (key.includes('landscape') ? localStorage.getItem(OLD_KEY) : null);
    const v = Number(raw);
    return raw !== null && Number.isFinite(v) && v >= MIN_H ? v : null;
  } catch { return null; }
};

export function Splitter() {
  const { state } = useEditorState();
  const s = TL_STRINGS[state.lang];
  const root = useRef<HTMLDivElement>(null);
  const shape = state.doc ? { width: state.doc.settings.width, height: state.doc.settings.height } : null;
  const key = splitterKey(shape);
  const usual = tlUsual(shape, state.workspace === 'sound');
  const [chosenBy, setChosenBy] = useState<{ key: string; h: number | null }>(() => ({ key, h: readStored(key) }));
  // a project of the other shape reads its own remembered height
  const chosen = chosenBy.key === key ? chosenBy.h : readStored(key);
  useEffect(() => { if (chosenBy.key !== key) setChosenBy({ key, h: readStored(key) }); }, [key, chosenBy.key]);
  const [now, setNow] = useState({ height: 0, max: 0 });
  const drag = useRef<{ pointerId: number; y0: number; h0: number } | null>(null);

  const limits = () => ({ min: MIN_H, available: window.innerHeight, keepAbove: KEEP_ABOVE });
  const timelineEl = () => root.current?.parentElement?.querySelector<HTMLElement>(':scope > .timeline') ?? null;
  /** The height of the timeline's row in the shell: the timeline with its own margins. */
  const rowHeight = (): number => {
    const tl = timelineEl();
    if (!tl) return 0;
    const cs = getComputedStyle(tl);
    return Math.round(tl.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0));
  };
  const measure = useCallback(() => {
    const h = rowHeight(), max = Math.max(MIN_H, window.innerHeight - KEEP_ABOVE);
    setNow((was) => (was.height === h && was.max === max ? was : { height: h, max }));
  }, []);

  // the shell reads the height from the property on .app
  useEffect(() => {
    const app = root.current?.parentElement;
    if (!app) return;
    app.style.setProperty('--pf-shell-tl', chosen !== null ? `${splitterHeight(chosen, limits())}px` : usual);
    measure();
    return () => { app.style.removeProperty('--pf-shell-tl'); };
  }, [chosen, usual, measure]);
  // a smaller window keeps the chosen height inside it; the shown value follows the timeline's real height
  useEffect(() => {
    const onResize = () => {
      const app = root.current?.parentElement;
      if (app && chosen !== null) app.style.setProperty('--pf-shell-tl', `${splitterHeight(chosen, limits())}px`);
      measure();
    };
    window.addEventListener('resize', onResize);
    const tl = timelineEl();
    const ro = tl ? new ResizeObserver(measure) : null;
    if (tl) ro!.observe(tl);
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); };
  }, [chosen, measure]);

  const choose = (h: number | null) => {
    const next = h === null ? null : splitterHeight(h, limits());
    setChosenBy({ key, h: next });
    try {
      if (next === null) { localStorage.removeItem(key); if (key.includes('landscape')) localStorage.removeItem(OLD_KEY); } else localStorage.setItem(key, String(next));
    } catch { /* storage unavailable: the height lasts for this visit */ }
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    drag.current = { pointerId: e.pointerId, y0: e.clientY, h0: rowHeight() || now.height };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    choose(d.h0 - (e.clientY - d.y0)); // dragging up makes the timeline taller
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => { if (drag.current?.pointerId === e.pointerId) drag.current = null; };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const h = rowHeight() || now.height, step = e.shiftKey ? 48 : 16;
    const next = e.key === 'ArrowUp' ? h + step : e.key === 'ArrowDown' ? h - step : e.key === 'End' ? window.innerHeight : e.key === 'PageUp' ? h + 96 : e.key === 'PageDown' ? h - 96 : null;
    if (next === null && e.key !== 'Home' && e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation(); // the arrows resize here, they do not step the playhead
    choose(next);
  };
  return (
    <div data-shell-slot="splitter" ref={root} className="pf-ds tl-splitter">
      <Tooltip label={s.splitterHelp}>
        <div className="tl-splitter-grip" role="separator" aria-orientation="horizontal" tabIndex={0} aria-label={s.splitter} aria-valuemin={MIN_H} aria-valuemax={now.max || undefined} aria-valuenow={now.height || undefined}
          aria-valuetext={now.height ? `${now.height} px` : undefined} data-testid="tl-splitter" data-chosen={chosen !== null ? 'true' : undefined}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={() => choose(null)} onKeyDown={onKey}><i aria-hidden="true" /></div>
      </Tooltip>
    </div>
  );
}
