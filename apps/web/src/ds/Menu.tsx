import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Keys } from './Kbd.tsx';
import { menuKey, orderMenu, type MenuItemSpec } from './logic.ts';
import { DS, cx, isolate, useDir } from './util.tsx';

export interface MenuItem extends MenuItemSpec { icon?: ReactNode; /** shortcut caps shown on the end side */ keys?: readonly string[]; /** data-testid of the item (a proof's entry point) */ testId?: string }
export interface MenuProps {
  items: readonly MenuItem[];
  onSelect: (id: string) => void;
  label: string;
  /** renders the trigger; spread `props` on the button */
  trigger: (props: { ref: (el: HTMLButtonElement | null) => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; 'aria-controls': string | undefined; onClick: () => void; onKeyDown: (e: React.KeyboardEvent) => void }) => ReactNode;
  className?: string;
}
/** Popup menu: roving focus on the items (menuKey), typeahead, shortcuts on the end side, destructive items last behind a separator. */
export function Menu({ items, onSelect, label, trigger, className }: MenuProps) {
  const dir = useDir();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const ordered = useMemo(() => orderMenu(items), [items]);
  const labels = ordered.map((o) => o.item.label);
  const disabled = ordered.map((o) => !!o.item.disabled);
  useLayoutEffect(() => {
    if (!open || !btn.current || !list.current) return;
    const a = btn.current.getBoundingClientRect(), m = list.current.getBoundingClientRect();
    const left = dir === 'rtl' ? a.right - m.width : a.left;
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - m.width - 8)), top: Math.min(a.bottom + 6, Math.max(8, window.innerHeight - m.height - 8)) });
  }, [open, dir]);
  useEffect(() => { if (open && pos) list.current?.querySelectorAll<HTMLElement>('[role=menuitem]')[active]?.focus(); }, [open, active, pos]);
  const close = (restore = true) => { setOpen(false); setPos(null); if (restore) btn.current?.focus(); };
  const openAt = (i: number) => {
    const after = disabled.findIndex((d, j) => j >= i && !d);
    const before = disabled.lastIndexOf(false, i);
    setActive(after >= 0 ? after : Math.max(0, before));
    setOpen(true);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const now = Date.now();
    if (now - typed.current.at > 700) typed.current.text = '';
    const a = menuKey(e.key, active, labels, dir, disabled, typed.current.text);
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (a.type === 'close') close(true);
    else if (a.type === 'move') setActive(a.to);
    else if (a.type === 'type') { typed.current = { text: typed.current.text + e.key, at: now }; setActive(a.to); }
    else if (a.type === 'activate') { const it = ordered[active]!.item; if (!it.disabled) { close(); onSelect(it.id); } }
  };
  return (
    <>
      {trigger({
        ref: (el) => { btn.current = el; }, 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
        onClick: () => (open ? close(false) : openAt(0)),
        onKeyDown: (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openAt(e.key === 'ArrowUp' ? ordered.length - 1 : 0); } },
      })}
      {open && createPortal(
        <>
          <div className="pf-menu-catch" onMouseDown={() => close(false)} />
          <div ref={list} id={id} role="menu" aria-label={label} dir={dir} className={cx(DS, 'pf-menu', className)} style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }} onKeyDown={onKey}>
            {ordered.map(({ item, separatorBefore }, i) => (
              <div key={item.id} role="none">
                {separatorBefore && <div role="separator" className="pf-menu-sep" />}
                <button type="button" role="menuitem" tabIndex={i === active ? 0 : -1} aria-disabled={item.disabled || undefined} className={cx('pf-menu-item', item.danger && 'is-danger')} data-testid={item.testId}
                  onMouseEnter={() => !item.disabled && setActive(i)} onClick={() => { if (!item.disabled) { close(); onSelect(item.id); } }}>
                  <span className="pf-menu-ic">{item.icon}</span><span className="pf-menu-label">{isolate(item.label)}</span>{item.keys && <Keys keys={item.keys} />}
                </button>
              </div>
            ))}
          </div>
        </>, document.body)}
    </>
  );
}
