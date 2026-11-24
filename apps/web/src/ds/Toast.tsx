import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.tsx';
import { DEFAULT_TTL, dismissToast, pushToast, type ToastItem, type ToastKind } from './logic.ts';
import { createHostStack } from './toastHost.ts';
import { CheckIcon, CloseIcon, DS, InfoIcon, WarnIcon, cx, isolate } from './util.tsx';

/** The open modal that holds the toast region (toastHost.ts); null = the page. */
const toastHosts = createHostStack<HTMLElement>();
/**
 * Rendered inside a modal dialog (Dialog.tsx does it): while the modal is open the toast region lives here, so toasts stay
 * focusable inside the modal's focus trap and stay in the accessibility tree (announced), instead of under the inert page.
 */
export function ToastSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => toastHosts.claim(ref.current!), []);
  return <div ref={ref} className="pf-toast-slot" data-testid="toast-slot" />;
}

export interface ToastInput { id?: string; kind: ToastKind; title: string; body?: string; action?: string; onAction?: () => void; ttl?: number }
interface Entry extends ToastItem { onAction?: () => void }
interface Api { push: (t: ToastInput) => string; dismiss: (id: string) => void }
const Ctx = createContext<Api | null>(null);
export function useToasts(): Api {
  const api = useContext(Ctx);
  if (!api) throw new Error('useToasts needs a <ToastProvider>');
  return api;
}

let counter = 0;
/** Toast queue: start-bottom, at most three, undo with a timer bar, receipt (agent edge), fix. role=status, never steals focus. */
export function ToastProvider({ children, closeLabel = 'Close', label = 'Notifications' }: { children: ReactNode; closeLabel?: string; /** the region's name, in the interface language */ label?: string }) {
  const [queue, setQueue] = useState<Entry[]>([]);
  const dismiss = useCallback((id: string) => setQueue((q) => dismissToast(q, id) as Entry[]), []);
  const push = useCallback((t: ToastInput) => {
    const id = t.id ?? `t${++counter}`;
    setQueue((q) => pushToast(q, { id, kind: t.kind, title: t.title, body: t.body, action: t.action, ttl: t.ttl ?? DEFAULT_TTL[t.kind], onAction: t.onAction } as Entry) as Entry[]);
    return id;
  }, []);
  const api = useMemo(() => ({ push, dismiss }), [push, dismiss]);
  const host = useSyncExternalStore(toastHosts.subscribe, toastHosts.current, () => null);
  return (
    <Ctx.Provider value={api}>
      {children}
      {typeof document !== 'undefined' && createPortal(
        <div className={cx(DS, 'pf-toasts')} role="region" aria-label={label} data-testid="toasts" data-host={host ? 'modal' : 'page'}>
          {queue.map((t) => <ToastView key={t.id} t={t} onDismiss={() => dismiss(t.id)} closeLabel={closeLabel} />)}
        </div>, host ?? document.body)}
    </Ctx.Provider>
  );
}

const ICON: Record<ToastKind, ReactNode> = { undo: <CheckIcon />, receipt: <CheckIcon />, fix: <WarnIcon />, info: <InfoIcon /> };

/** One toast. Exported so the gallery can show each kind statically (no timer when `static`). */
export function ToastView({ t, onDismiss, closeLabel = 'Close', staticView }: { t: Entry; onDismiss?: () => void; closeLabel?: string; staticView?: boolean }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(t.ttl);
  const started = useRef(0);
  useEffect(() => {
    if (staticView || t.ttl <= 0 || paused) return;
    started.current = performance.now();
    const h = setTimeout(() => onDismiss?.(), left.current);
    return () => { clearTimeout(h); left.current = Math.max(0, left.current - (performance.now() - started.current)); };
  }, [paused, staticView, t.ttl, onDismiss]);
  return (
    <div role="status" className={cx('pf-toast', `is-${t.kind}`)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="pf-toast-ic" aria-hidden="true">{ICON[t.kind]}</span>
      <div className="pf-toast-body">
        <b>{isolate(t.title)}</b>{t.body && <p>{isolate(t.body)}</p>}
        {t.action && <div className="pf-toast-actions"><Button size="sm" variant={t.kind === 'fix' ? 'primary' : 'secondary'} onClick={() => { t.onAction?.(); onDismiss?.(); }}>{t.action}</Button></div>}
      </div>
      {onDismiss && <button type="button" className="pf-toast-x" aria-label={closeLabel} onClick={onDismiss}><CloseIcon size={14} /></button>}
      {t.ttl > 0 && <span className={cx('pf-toast-timer', paused && 'is-paused')} style={{ '--ttl': `${t.ttl}ms` } as CSSProperties} aria-hidden="true" />}
    </div>
  );
}
