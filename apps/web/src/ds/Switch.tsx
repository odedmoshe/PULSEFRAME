import type { ReactNode } from 'react';
import { DS, cx } from './util.tsx';

export interface SwitchProps { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; tone?: 'frame' | 'pulse'; disabled?: boolean; id?: string; /** the label is visually hidden */ hideLabel?: boolean; className?: string; testId?: string }
/** role=switch. The thumb sits at the END of the track when on, so it mirrors in right-to-left (logical properties in CSS). */
export function Switch({ checked, onChange, label, tone = 'frame', disabled, id, hideLabel, className, testId }: SwitchProps) {
  return (
    <label className={cx(DS, 'pf-switch-row', disabled && 'is-disabled', className)}>
      <button type="button" role="switch" id={id} aria-checked={checked} disabled={disabled} data-testid={testId} className={cx('pf-switch', `pf-switch-${tone}`)} onClick={() => onChange(!checked)}><i className="pf-switch-thumb" /></button>
      <span className={hideLabel ? 'pf-sr' : 'pf-switch-label'}>{label}</span>
    </label>
  );
}
