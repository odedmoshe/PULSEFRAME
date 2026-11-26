/**
 * The range marks on the timeline (wave 8D P5 b): «התחלה» and «סוף» flags on the ruler that can be dragged (or moved a frame
 * with the arrows, ten with Shift; Delete removes one), and the marked stretch tinted across every lane. View state only.
 */
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { useEditor, useEditorState } from '../store.ts';
import { cutFrames, snapFrame, xOfFrame } from '../scrub/scrub.logic.ts';
import { fullRange } from './range.logic.ts';
import { moveMark } from './range.commands.ts';
import { rangeStore, useRange } from './range.state.ts';
import { RANGE_STRINGS } from './range.strings.ts';
import './range.css';

/** The two flags, inside the ruler (its left edge is time 0). */
export function RangeFlags({ pps }: { pps: number }) {
  const editor = useEditor();
  const { state } = useEditorState();
  const marks = useRange(state.doc?.id);
  if (!state.doc || (marks.in === null && marks.out === null)) return null;
  const S = RANGE_STRINGS[state.lang], rate = editor.rate;
  const tc = (f: number) => T.toTimecode(T.frameTime(f, rate), rate);
  return (
    <>
      {marks.in !== null && <Flag which="in" frame={marks.in} pps={pps} label={S.in} aria={S.flagIn(tc(marks.in))} />}
      {marks.out !== null && <Flag which="out" frame={marks.out} pps={pps} label={S.out} aria={S.flagOut(tc(marks.out))} />}
    </>
  );
}

function Flag({ which, frame, pps, label, aria }: { which: 'in' | 'out'; frame: number; pps: number; label: string; aria: string }) {
  const editor = useEditor();
  const rate = editor.rate;
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // not a jump of the playhead
    const ruler = e.currentTarget.closest<HTMLElement>('[data-testid=ruler]');
    if (!ruler) return;
    const origin = ruler.getBoundingClientRect().left, last = Math.max(0, (editor.player?.frameCount ?? 1) - 1);
    const offset = e.clientX - (origin + xOfFrame(frame, pps, rate));
    const cuts = [...cutFrames(editor.doc, rate), editor.frame, ...(which === 'out' ? [last + 1] : [])];
    const host = e.currentTarget, id = e.pointerId;
    try { host.setPointerCapture(id); } catch { /* gone */ }
    host.dataset.dragging = 'true';
    const move = (ev: PointerEvent) => { if (ev.pointerId === id) moveMark(editor, which, snapFrame(ev.clientX - offset - origin, pps, rate, last + 1, cuts, !ev.altKey).frame); };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      try { host.releasePointerCapture(id); } catch { /* released */ }
      delete host.dataset.dragging;
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); moveMark(editor, which, frame + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); e.stopPropagation();
      if (editor.doc) rangeStore.set(editor.doc.id, { ...rangeStore.get(editor.doc.id), [which]: null });
    }
  };
  return (
    <button type="button" className={`range-flag is-${which}`} data-testid={`range-${which}`} data-frame={frame} style={{ left: xOfFrame(frame, pps, rate) }}
      aria-label={aria} title={aria} onPointerDown={onPointerDown} onKeyDown={onKeyDown}>
      <span dir="auto">{label}</span>
    </button>
  );
}

/** The marked stretch over every lane (under the top rows' sticky band, over the clips, never catching the pointer). */
export function RangeTint({ pps, head }: { pps: number; head: number }) {
  const editor = useEditor();
  const { state } = useEditorState();
  const marks = useRange(state.doc?.id);
  if (!state.doc || !fullRange(marks)) return null;
  const rate = editor.rate, S = RANGE_STRINGS[state.lang];
  const tc = (f: number) => T.toTimecode(T.frameTime(f, rate), rate);
  return <div className="range-tint" data-testid="range-tint" data-in={marks.in} data-out={marks.out} role="img" aria-label={S.tint(tc(marks.in), tc(marks.out))}
    style={{ left: head + xOfFrame(marks.in, pps, rate), width: Math.max(1, xOfFrame(marks.out - marks.in, pps, rate)) }} />;
}
