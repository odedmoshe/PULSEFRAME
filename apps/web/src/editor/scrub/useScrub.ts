/**
 * Dragging the playhead (wave 8D P5 a). A press on the playhead's grab area (around its cap, over the top rows) drags it; a press on the ruler jumps there and goes on as a drag. The picture follows on animation frames through
 * FrameGate (at most one seek an animation frame; the player itself draws only the newest wished frame, so no seek ever waits
 * in a queue), snapping to edit points within SNAP_PX unless Alt is held. Escape during the drag puts the playhead back.
 * The playhead is view state: nothing is committed, before, during or after the drag.
 */
import { useCallback, useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditor } from '../store.ts';
import { CLICK_SLOP_PX, FrameGate, cutFrames, pressStartsScrub, snapFrame, xOfFrame } from './scrub.logic.ts';

/** Measurement only (the timeline-basics proof sets it): each pointer move of a drag is recorded with the frame it asked for. */
type Probe = { t: number; frame: number }[];
const probe = (): Probe | null => { const p = (globalThis as { __pfScrubProbe?: Probe }).__pfScrubProbe; return Array.isArray(p) ? p : null; };

export interface Scrub {
  /** On the ruler: jump to the pointer, then drag. */
  onRulerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /** On the playhead's cap: drag from where it is (no jump). */
  onGrabDown: (e: ReactPointerEvent<HTMLElement>) => void;
}

export function useScrub(): Scrub {
  const editor = useEditor();
  const start = useCallback((e: ReactPointerEvent<HTMLElement>, jump: boolean) => {
    if (!pressStartsScrub(e)) return;
    const ruler = e.currentTarget.closest('.timeline')?.querySelector<HTMLElement>('[data-testid=ruler]');
    const player = editor.player;
    if (!ruler || !player || player.frameCount <= 0) return;
    e.preventDefault();
    e.stopPropagation(); // not a marquee, not a clip drag
    const rate = editor.rate, pps = editor.getState().pxPerSecond, last = player.frameCount - 1;
    const cuts = cutFrames(editor.doc, rate);
    const origin = ruler.getBoundingClientRect().left;
    const from = editor.frame;
    // a grab keeps the distance between the pointer and the line, so pressing beside the line does not move it
    const offset = jump ? 0 : e.clientX - (origin + xOfFrame(from, pps, rate));
    const gate = new FrameGate((f) => editor.seek(f), (cb) => requestAnimationFrame(cb), (h) => cancelAnimationFrame(h as number));
    gate.start(from);
    const host = e.currentTarget, id = e.pointerId, x0 = e.clientX, rec = probe();
    const root = host.closest<HTMLElement>('.timeline');
    try { host.setPointerCapture(id); } catch { /* the pointer is already gone */ }
    root?.setAttribute('data-scrubbing', 'true');
    let moved = false;
    const aim = (clientX: number, alt: boolean, t: number) => {
      const { frame } = snapFrame(clientX - offset - origin, pps, rate, last, cuts, !alt);
      rec?.push({ t, frame });
      gate.want(frame);
    };
    if (jump) { aim(e.clientX, e.altKey, e.timeStamp); gate.flush(); }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      // once the pointer really moves, the drag draws the playing picture (draft, reduced) and the release the full frame
      // again (Player.setScrubbing); a press that does not move shows the full frame at once
      if (!moved && Math.abs(ev.clientX - x0) >= CLICK_SLOP_PX) { moved = true; player.setScrubbing(true); }
      if (moved || jump) aim(ev.clientX, ev.altKey, ev.timeStamp);
    };
    const end = (ev: PointerEvent | null, cancelled: boolean) => {
      if (ev && ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      try { host.releasePointerCapture(id); } catch { /* released already */ }
      root?.removeAttribute('data-scrubbing');
      if (cancelled) { gate.cancel(); player.setScrubbing(false); editor.seek(from); return; }
      gate.flush();
      player.setScrubbing(false);
    };
    const up = (ev: PointerEvent) => end(ev, false);
    const cancel = (ev: PointerEvent) => end(ev, true);
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); end(null, true); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
  }, [editor]);
  return useMemo(() => ({ onRulerDown: (e) => start(e, true), onGrabDown: (e) => start(e, false) }), [start]);
}
