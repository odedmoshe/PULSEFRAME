import { cloneElement, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Keys } from './Kbd.tsx';
import { TOOLTIP_DELAY_MS, placeTip } from './logic.ts';
import { DS, cx } from './util.tsx';

export interface TooltipProps { label: string; keys?: readonly string[]; /** the label says why the control is unavailable */ reason?: boolean; children: ReactElement<{ 'aria-describedby'?: string }> | ReactNode }
/** Tooltip after 140 ms of hover or on keyboard focus; Escape dismisses. The label is also the accessible description of the control. */
export function Tooltip({ label, keys, reason, children }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; side: 'top' | 'bottom' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (immediate = false) => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), immediate ? 0 : TOOLTIP_DELAY_MS); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); setPos(null); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect(), t = tip.current.getBoundingClientRect();
    setPos(placeTip({ left: a.left, top: a.top, width: a.width, height: a.height }, { width: t.width, height: t.height }, { width: window.innerWidth, height: window.innerHeight }));
  }, [open, label]);
  if (!label && !keys?.length) return <>{children}</>;
  const child = isValidElement<{ 'aria-describedby'?: string }>(children) ? cloneElement(children, { 'aria-describedby': id }) : children;
  return (
    <span ref={anchor} className="pf-tip-anchor" onMouseEnter={() => show()} onMouseLeave={hide} onFocus={(e) => { if ((e.target as HTMLElement).matches(':focus-visible')) show(true); }} onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { hide(); } }}>
      {child}
      {open && createPortal(
        <span ref={tip} id={id} role="tooltip" className={cx(DS, 'pf-tip', reason && 'is-reason', pos && `is-${pos.side}`)} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}>
          <span>{label}</span>{keys && keys.length > 0 && <Keys keys={keys} />}
        </span>, document.body)}
      {!open && <span id={id} className="pf-sr">{label}</span>}
    </span>
  );
}
