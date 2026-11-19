import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { rovingNext, rovingTabStop } from './logic.ts';
import { DS, cx, useDir } from './util.tsx';

export interface SegOption<V extends string = string> { value: V; label: ReactNode; icon?: ReactNode; disabled?: boolean; ariaLabel?: string; /** CSS colour for a tinted icon (ModeBar) */ tint?: string; testId?: string }
export interface SegProps<V extends string = string> {
  options: readonly SegOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** 'radio': one choice, radiogroup semantics. 'pressed': buttons with aria-pressed. */
  semantics?: 'radio' | 'pressed';
  size?: 'sm' | 'md';
  block?: boolean;
  label: string;
  /** icons only; each option keeps its aria-label */
  iconOnly?: boolean;
  className?: string;
}

/** Segmented control with a roving tabindex: one tab stop, arrows move AND select (automatic activation), Home/End jump. */
export function Seg<V extends string = string>({ options, value, onChange, semantics = 'radio', size = 'md', block, label, iconOnly, className }: SegProps<V>) {
  const dir = useDir();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const active = Math.max(0, options.findIndex((o) => o.value === value));
  const disabled = options.map((o) => !!o.disabled);
  const stop = rovingTabStop(active, options.length, disabled);
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: options.length, dir, disabled });
    if (to === null) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(options[to]!.value);
  };
  return (
    <div role={semantics === 'radio' ? 'radiogroup' : 'group'} aria-label={label} className={cx(DS, 'pf-seg', `pf-seg-${size}`, block && 'is-block', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        const common = {
          ref: (el: HTMLButtonElement | null) => { refs.current[i] = el; },
          type: 'button' as const, disabled: o.disabled, className: cx('pf-seg-btn', on && 'is-on'),
          'aria-label': iconOnly ? (o.ariaLabel ?? (typeof o.label === 'string' ? o.label : undefined)) : o.ariaLabel,
          'data-testid': o.testId, onClick: () => onChange(o.value), onKeyDown: (e: KeyboardEvent) => onKey(e, i),
          style: o.tint ? ({ '--mc': o.tint } as CSSProperties) : undefined,
        };
        const body = <>{o.icon}{!iconOnly && <span>{o.label}</span>}</>;
        return semantics === 'radio'
          ? <button key={o.value} {...common} role="radio" aria-checked={on} tabIndex={i === stop ? 0 : -1}>{body}</button>
          : <button key={o.value} {...common} aria-pressed={on}>{body}</button>;
      })}
    </div>
  );
}

/** The mode bar: a Seg whose icons carry the mode tint (--pf-m-*), used for עריכה · מראה · סאונד · כתוביות · מסירה. */
export function ModeBar<V extends string = string>(props: Omit<SegProps<V>, 'semantics' | 'size'>) {
  return <Seg {...props} semantics="radio" size="md" className={cx('pf-modebar', props.className)} />;
}
