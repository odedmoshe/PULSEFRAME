import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.tsx';
import { DEFAULT_TTL, dismissToast, pushToast, type ToastItem, type ToastKind } from './logic.ts';
import { createHostStack, createToastClock, type ToastClock } from './toastHost.ts';
import { CheckIcon, CloseIcon, DS, InfoIcon, WarnIcon, cx, isolate } from './util.tsx';

/** The open modal that holds the toast region (toastHost.ts); null = the page. */
const toastHosts = createHostStack<HTMLElement>();
/** What the region draws: the queue and the words around it. Shared by the page region and the slot of an open modal. */
interface RegionData { queue: Entry[]; dismiss: (id: string) => void; closeLabel: string; label: string; clock: ToastClock }
const RegionCtx = createContext<RegionData | null>(null);

function ToastRegion({ where }: { where: 'page' | 'modal' }) {
  const d = useContext(RegionCtx);
  if (!d) return null;
  return (
    <div className={cx(DS, 'pf-toasts')} role="region" aria-label={d.label} data-testid="toasts" data-host={where}>
      {d.queue.map((t) => <ToastView key={t.id} t={t} onDismiss={() => d.dismiss(t.id)} closeLabel={d.closeLabel} clock={d.clock} />)}
    </div>
  );
}

/**
 * Rendered inside a modal dialog (Dialog.tsx, and the editor's own modals: template dialog, effect gallery, curve picker, command
 * palette): while the modal is open the toast region lives here, so toasts stay focusable inside the modal's focus trap and stay in
 * the accessibility tree (announced), instead of under the inert page. The region is rendered in place, not through a portal from
 * the provider: React delivers a key press to the components that contain the element, so the modal's own Tab wrap and Escape
 * handler hear a key typed on a toast button (a portal from the provider would send it to the provider's ancestors instead).
 */
export function ToastSlot() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => toastHosts.claim(ref.current!), []);
  const host = useSyncExternalStore(toastHosts.subscribe, toastHosts.current, () => null);
  return <div ref={ref} className="pf-toast-slot" data-testid="toast-slot">{host !== null && host === ref.current && <ToastRegion where="modal" />}</div>;
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
  const clock = useMemo(createToastClock, []);
  useEffect(() => { clock.keepOnly(queue.map((t) => t.id)); }, [clock, queue]);
  const region = useMemo(() => ({ queue, dismiss, closeLabel, label, clock }), [queue, dismiss, closeLabel, label, clock]);
  return (
    <Ctx.Provider value={api}>
      <RegionCtx.Provider value={region}>
        {children}
        {/* the page holds the region until a modal claims it (then its ToastSlot draws it) */}
        {typeof document !== 'undefined' && host === null && createPortal(<ToastRegion where="page" />, document.body)}
      </RegionCtx.Provider>
    </Ctx.Provider>
  );
}

const ICON: Record<ToastKind, ReactNode> = { undo: <CheckIcon />, receipt: <CheckIcon />, fix: <WarnIcon />, info: <InfoIcon /> };

/** One toast. Exported so the gallery can show each kind statically (no timer when `static`). */
export function ToastView({ t, onDismiss, closeLabel = 'Close', staticView, clock }: { t: Entry; onDismiss?: () => void; closeLabel?: string; staticView?: boolean; /** where the time left is kept, so a view that is rebuilt (the region moved) carries on */ clock?: ToastClock }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(clock ? clock.left(t.id, t.ttl) : t.ttl);
  const elapsed = useRef(t.ttl - left.current); // the bar carries on from here when the view is rebuilt
  const started = useRef(0);
  useEffect(() => {
    if (staticView || t.ttl <= 0 || paused) return;
    started.current = performance.now();
    const h = setTimeout(() => onDismiss?.(), left.current);
    return () => { clearTimeout(h); left.current = Math.max(0, left.current - (performance.now() - started.current)); clock?.save(t.id, left.current); };
  }, [paused, staticView, t.ttl, t.id, onDismiss, clock]);
  // a paused toast (focus or hover) is a stopping point too: keep what is left so a move while paused does not refill it
  useEffect(() => () => { clock?.save(t.id, left.current); }, [clock, t.id]);
  return (
    <div role="status" className={cx('pf-toast', `is-${t.kind}`)} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="pf-toast-ic" aria-hidden="true">{ICON[t.kind]}</span>
      <div className="pf-toast-body">
        <b>{isolate(t.title)}</b>{t.body && <p>{isolate(t.body)}</p>}
        {t.action && <div className="pf-toast-actions"><Button size="sm" variant={t.kind === 'fix' ? 'primary' : 'secondary'} onClick={() => { t.onAction?.(); onDismiss?.(); }}>{t.action}</Button></div>}
      </div>
      {onDismiss && <button type="button" className="pf-toast-x" aria-label={closeLabel} onClick={onDismiss}><CloseIcon size={14} /></button>}
      {t.ttl > 0 && <span className={cx('pf-toast-timer', paused && 'is-paused')} style={{ '--ttl': `${t.ttl}ms`, animationDelay: elapsed.current > 0 ? `-${Math.round(elapsed.current)}ms` : undefined } as CSSProperties} aria-hidden="true" />}
    </div>
  );
}
