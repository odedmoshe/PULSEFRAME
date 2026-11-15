/**
 * Marquee selection: drag on an empty part of the timeline to select every clip the box touches.
 * Shift/Ctrl/⌘ while dragging adds to the current selection. A plain click on an empty part clears the selection.
 * Clips on locked tracks are never selected. Selection is session state, not a project edit.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Editor } from './store.ts';

export interface MarqueeBox { left: number; top: number; width: number; height: number }
const MIN_DRAG_PX = 4;

export function useMarquee(editor: Editor): { marqueeProps: { onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void }; box: MarqueeBox | null } {
  const [box, setBox] = useState<MarqueeBox | null>(null);
  const session = useRef<{ inner: HTMLElement; x0: number; y0: number; add: boolean; base: string[]; prev: string[]; moved: boolean } | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || session.current) return;
    const target = e.target as HTMLElement;
    // only from empty space: a track lane or the area below the tracks (not clips, the ruler, markers or controls)
    if (!(target === e.currentTarget || target.classList.contains('track'))) return;
    // No text selection and no native drag: with text selected (Shift+drag extends a text selection) the browser would start
    // dragging it and cancel the pointer. Focus is moved off any field by hand, since preventing the default also keeps focus where it was.
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    window.getSelection()?.removeAllRanges();
    const inner = e.currentTarget;
    const r0 = inner.getBoundingClientRect();
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    session.current = { inner, x0: e.clientX - r0.left, y0: e.clientY - r0.top, add, base: add ? [...editor.getState().selection] : [], prev: [...editor.getState().selection], moved: false };
    const locked = new Set((editor.doc ? editor.doc.sequences[editor.doc.mainSequenceId]!.tracks : []).filter((t) => t.locked).map((t) => t.id));
    const hits = (b: MarqueeBox, r: DOMRect): string[] => {
      const L = r.left + b.left, T = r.top + b.top, R = L + b.width, B = T + b.height;
      const out: string[] = [];
      for (const el of inner.querySelectorAll<HTMLElement>('.track')) {
        if (locked.has(el.dataset.trackId ?? '')) continue;
        for (const c of el.querySelectorAll<HTMLElement>('[data-clip-id]')) {
          const q = c.getBoundingClientRect();
          if (q.left < R && q.right > L && q.top < B && q.bottom > T) out.push(c.dataset.clipId!);
        }
      }
      return out;
    };
    const move = (ev: PointerEvent) => {
      const s = session.current; if (!s) return;
      const r = s.inner.getBoundingClientRect(); // read again: the timeline may have scrolled
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (!s.moved && Math.hypot(x - s.x0, y - s.y0) < MIN_DRAG_PX) return;
      s.moved = true;
      const b = { left: Math.min(x, s.x0), top: Math.min(y, s.y0), width: Math.abs(x - s.x0), height: Math.abs(y - s.y0) };
      setBox(b);
      const found = hits(b, r);
      editor.set({ selection: [...s.base, ...found.filter((id) => !s.base.includes(id))] });
    };
    const finish = (cancel: boolean) => {
      const s = session.current;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancelled);
      window.removeEventListener('keydown', key, true);
      stop.current = null; session.current = null; setBox(null);
      if (!s) return;
      if (cancel) editor.set({ selection: s.prev }); // Escape or a cancelled pointer: back to the selection before the drag
      else if (!s.moved && !s.add) editor.select(null); // a plain click on empty space clears the selection
    };
    const up = () => finish(false);
    const cancelled = () => finish(true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && session.current?.moved) { ev.stopPropagation(); ev.preventDefault(); finish(true); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancelled);
    window.addEventListener('keydown', key, true);
    stop.current = () => finish(true);
  }, [editor]);

  return { marqueeProps: { onPointerDown }, box };
}
