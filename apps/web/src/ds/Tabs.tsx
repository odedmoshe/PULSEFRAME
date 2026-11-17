import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { rovingNext, rovingTabStop } from './logic.ts';
import { DS, cx, useDir } from './util.tsx';

export interface TabSpec { id: string; label: string; icon?: ReactNode; count?: number; disabled?: boolean; testId?: string }
export interface TabsProps {
  tabs: readonly TabSpec[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** icons only (≤1366px); each tab keeps its aria-label */
  collapsed?: boolean;
  /** id prefix of the panels: the tab `x` controls the element `${panelPrefix}-x` */
  panelPrefix?: string;
  className?: string;
}
/** role=tablist, roving tabindex, automatic activation: arrows move focus and select, Home/End jump. */
export function Tabs({ tabs, value, onChange, label, collapsed, panelPrefix = 'pf-tabpanel', className }: TabsProps) {
  const dir = useDir();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.max(0, tabs.findIndex((t) => t.id === value));
  const disabled = tabs.map((t) => !!t.disabled);
  const stop = rovingTabStop(active, tabs.length, disabled);
  const key = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: tabs.length, dir, disabled });
    if (to === null) return;
    e.preventDefault(); refs.current[to]?.focus(); onChange(tabs[to]!.id);
  };
  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cx(DS, 'pf-tabs', collapsed && 'is-collapsed', className)}>
      {tabs.map((t, i) => {
        const on = t.id === value;
        return (
          <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`${panelPrefix}-tab-${t.id}`} aria-selected={on} aria-controls={`${panelPrefix}-${t.id}`}
            aria-label={collapsed ? (t.count ? `${t.label} (${t.count})` : t.label) : undefined} tabIndex={i === stop ? 0 : -1} disabled={t.disabled} data-testid={t.testId}
            className={cx('pf-tab', on && 'is-on')} onClick={() => onChange(t.id)} onKeyDown={(e) => key(e, i)}>
            {t.icon}{!collapsed && <span className="pf-tab-label">{t.label}</span>}
            {t.count ? <span className="pf-tab-count num" aria-hidden={collapsed ? undefined : 'true'}>{t.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
