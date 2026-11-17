import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { DS, cx } from './util.tsx';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  pressed?: boolean;
  /** mono count after the label */
  count?: number | string;
  icon?: ReactNode;
  children: ReactNode;
}
/** Filter/toggle chip. A toggle: aria-pressed. */
export function Chip({ pressed, count, icon, className, children, type = 'button', ...rest }: ChipProps) {
  return (
    <button type={type} aria-pressed={pressed} {...rest} className={cx(DS, 'pf-chip', pressed && 'is-on', className)}>
      {icon}<span>{children}</span>{count != null && <span className="pf-chip-n num">{count}</span>}
    </button>
  );
}

export type BadgeTone = 'neutral' | 'frame' | 'pulse' | 'agent' | 'ok' | 'attention' | 'hollow';
/** Small status label. Never colour alone: pass an icon or a word. Latin/mono content uses the 12px digits size. */
export function Badge({ tone = 'neutral', icon, mono, children, className }: { tone?: BadgeTone; icon?: ReactNode; mono?: boolean; children: ReactNode; className?: string }) {
  return <span className={cx(DS, 'pf-badge', `pf-badge-${tone}`, mono && 'num', className)}>{icon}{children}</span>;
}
