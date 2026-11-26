import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { isModified, parseTyped, resetValue, scrubKey, scrubValue, type ScrubSpec } from './logic.ts';
import { DS, cx } from './util.tsx';
import { focusNow } from './focus.ts';

export interface ScrubFieldProps extends ScrubSpec {
  value: number;
  onChange: (v: number) => void;
  /** called once when a drag, a typed value or a key press ends (the place for a store commit) */
  onCommit?: (v: number) => void;
  unit?: string;
  /** the default: Alt-click resets to it */
  defaultValue?: number;
  label: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

const DRAG_THRESHOLD = 3;
/** LTR mono value + unit, in every language. Drag sideways, click to type, arrows ±1, Shift ±10, Alt-click resets. */
export function ScrubField(props: ScrubFieldProps) {
  const { value, onChange, onCommit, unit, defaultValue, label, disabled, className, testId } = props;
  const spec: ScrubSpec = { min: props.min, max: props.max, step: props.step, decimals: props.decimals, pxPerStep: props.pxPerStep };
  const decimals = spec.decimals ?? (String(spec.step).split('.')[1]?.length ?? 0);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; start: number; moved: boolean; id: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  const shown = value.toFixed(decimals);

  const down = (e: PointerEvent) => {
    if (disabled || editing || e.button !== 0) return;
    if (e.altKey && defaultValue != null) { const v = resetValue(defaultValue, spec); onChange(v); onCommit?.(v); return; }
    drag.current = { x: e.clientX, start: value, moved: false, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    if (!d.moved) { d.moved = true; setDragging(true); }
    onChange(scrubValue(d.start, dx, spec, { shift: e.shiftKey, alt: e.altKey }));
  };
  const up = (e: PointerEvent) => {
    const d = drag.current; drag.current = null; setDragging(false);
    if (!d) return;
    if (d.moved) onCommit?.(scrubValue(d.start, e.clientX - d.x, spec, { shift: e.shiftKey, alt: e.altKey }));
    else { setText(shown); setEditing(true); }
  };
  const key = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); setText(shown); setEditing(true); return; }
    const v = scrubKey(value, e.key, spec, e.shiftKey);
    if (v === null) return;
    e.preventDefault(); onChange(v); onCommit?.(v);
  };
  const ended = useRef(false);
  useEffect(() => { if (editing) ended.current = false; }, [editing]);
  /** Ends editing. Focus returns to the field only when the person ended it with Enter or Escape; on blur (Tab, a click elsewhere) it stays where they sent it. */
  const finish = (accept: boolean, refocus: boolean) => {
    if (ended.current) return;
    ended.current = true;
    // the field itself (root) is in the page the whole time: the focus goes to it first, in this task, while the input still exists (its blur finds `ended` set)
    if (refocus) focusNow(root.current);
    setEditing(false);
    if (accept) { const v = parseTyped(text, spec); if (v !== null && v !== value) { onChange(v); onCommit?.(v); } }
  };
  const label2 = `${shown}${unit ? ` ${unit}` : ''}`;
  return (
    <div ref={root} className={cx(DS, 'pf-scrub', dragging && 'is-dragging', editing && 'is-editing', disabled && 'is-disabled', isModified(value, defaultValue ?? value) && 'is-modified', className)} data-testid={testId}
      role="spinbutton" aria-label={label} aria-valuemin={spec.min} aria-valuemax={spec.max} aria-valuenow={value} aria-valuetext={label2} aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0} dir="ltr" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDragging(false); }} onKeyDown={editing ? undefined : key}>
      {editing
        ? <input ref={input} className="pf-scrub-input num" inputMode="decimal" aria-label={label} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => finish(true, false)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true, true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); } }} />
        : <span className="pf-scrub-val num">{shown}{unit && <u>{unit}</u>}</span>}
    </div>
  );
}
