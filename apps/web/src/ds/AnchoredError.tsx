import { useId, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import { CloseIcon, DS, WarnIcon, cx } from './util.tsx';

export interface AnchoredErrorProps {
  /** plain Hebrew/English: what happened and what to do, no developer language */
  children: ReactNode;
  /** the fix as one button ("קיצור ב־0.25 ש׳ ותיקון") */
  fix?: string;
  onFix?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** true only when the error blocks the person: announced at once (role=alert). Otherwise role=status. */
  blocking?: boolean;
  /** set this as the control's aria-describedby */
  id?: string;
  className?: string;
}
/** Sits next to the control that caused it. It is dismissed by the next good commit (the owner clears it), never by a timer. */
export function AnchoredError({ children, fix, onFix, onDismiss, dismissLabel = 'Dismiss', blocking, id, className }: AnchoredErrorProps) {
  const auto = useId();
  return (
    <div id={id ?? auto} role={blocking ? 'alert' : 'status'} className={cx(DS, 'pf-anchored', className)}>
      <WarnIcon className="pf-anchored-ic" />
      <div className="pf-anchored-body"><p>{children}</p>{fix && <Button size="sm" variant="primary" onClick={onFix}>{fix}</Button>}</div>
      {onDismiss && <button type="button" className="pf-anchored-x" aria-label={dismissLabel} onClick={onDismiss}><CloseIcon size={14} /></button>}
    </div>
  );
}
