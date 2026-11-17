import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { initialFocus, trapTarget, type FocusableInfo } from './logic.ts';
import { CloseIcon, DS, FOCUSABLE, cx } from './util.tsx';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** dialog: centred modal. sheet: panel from the END edge (right in LTR, left in RTL), 320 ms. */
  variant?: 'dialog' | 'sheet';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  /** a confirm dialog may not close on a backdrop click */
  dismissOnBackdrop?: boolean;
  className?: string;
  testId?: string;
}

const infoOf = (el: HTMLElement): FocusableInfo & { autofocus?: boolean } => ({
  tabIndex: el.tabIndex, disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true' && el.tagName === 'FIELDSET',
  hidden: !!(el.hidden || el.closest('[hidden],[inert]') || el.getClientRects().length === 0), autofocus: el.hasAttribute('data-autofocus'),
});

/** Modal Dialog / Sheet: role=dialog aria-modal, focus trapped (pure order in logic.ts), Escape closes, focus returns to what opened it. */
export function Dialog({ open, onClose, title, variant = 'dialog', size = 'md', children, footer, closeLabel = 'Close', dismissOnBackdrop = true, className, testId }: DialogProps) {
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = root.current!;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = initialFocus(items.map(infoOf));
    (items[first] ?? el).focus();
    // Everything else in the document is made inert while the modal is open, so no focus or click can reach the page behind it.
    const made: HTMLElement[] = [];
    for (const n of Array.from(document.body.children)) if (n instanceof HTMLElement && !n.contains(el) && !n.inert) { n.inert = true; made.push(n); }
    // Safety net for focus that is already outside (e.g. the body after a scrim click): Tab comes back in.
    const onDoc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Tab' || el.contains(document.activeElement)) return;
      const its = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
      e.preventDefault(); (e.shiftKey ? its[its.length - 1] : its[0] ?? el)?.focus();
    };
    document.addEventListener('keydown', onDoc);
    return () => { document.removeEventListener('keydown', onDoc); for (const n of made) n.inert = false; const o = opener.current; if (o && o.isConnected) o.focus(); };
  }, [open]);
  if (!open) return null;
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const el = root.current!;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const to = trapTarget(items.map(infoOf), items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
    if (to === null) return;
    e.preventDefault();
    (to < 0 ? el : items[to]!).focus();
  };
  return createPortal(
    <div className={cx(DS, 'pf-scrim', `is-${variant}`)} onMouseDown={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); if (dismissOnBackdrop) onClose(); }}>
      <div ref={root} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('pf-dialog', `is-${variant}`, `is-${size}`, className)} data-testid={testId} onKeyDown={key}>
        <header className="pf-dialog-head">
          <h2 id={titleId} className="pf-dialog-title">{title}</h2>
          <button type="button" className="pf-dialog-x" aria-label={closeLabel} onClick={onClose}><CloseIcon /></button>
        </header>
        <div className="pf-dialog-body">{children}</div>
        {footer && <footer className="pf-dialog-foot">{footer}</footer>}
      </div>
    </div>, document.body);
}
export { Dialog as Sheet };
