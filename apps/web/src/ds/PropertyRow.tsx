import { useId, useState, type ReactNode } from 'react';
import { IconKeyframeFull, IconKeyframeGold, IconKeyframeHalf, IconKeyframeHollow } from '../editor/icons.tsx';
import { keyframeGlyph, type KeyframeState } from './logic.ts';
import { DS, HelpIcon, ChevronIcon, cx, isolate } from './util.tsx';

const KF = { keyframeHollow: IconKeyframeHollow, keyframeHalf: IconKeyframeHalf, keyframeFull: IconKeyframeFull, keyframeGold: IconKeyframeGold } as const;

export interface PropertyRowProps {
  label: string;
  /** an accent dot after the label marks a modified value */
  modified?: boolean;
  /** the control: ScrubField, Slider, Seg ... */
  children: ReactNode;
  /** the value column (a mono read-out, or a ScrubField) */
  value?: ReactNode;
  keyframe?: KeyframeState;
  onKeyframe?: () => void;
  keyframeLabel?: string;
  className?: string;
}
/** Grid `76px | 1fr | 62px | 22px` (label | control | value | keyframe); 30px high, 24px at compact height. */
export function PropertyRow({ label, modified, children, value, keyframe, onKeyframe, keyframeLabel, className }: PropertyRowProps) {
  const id = useId();
  const Kf = keyframe ? KF[keyframeGlyph(keyframe)] : null;
  return (
    <div role="group" aria-labelledby={id} className={cx(DS, 'pf-prop', className)}>
      <span id={id} className="pf-prop-label"><span className="pf-prop-name">{label}</span>{modified && <i className="pf-prop-dot" title="" aria-hidden="true" />}{modified && <span className="pf-sr">·</span>}</span>
      <span className="pf-prop-control">{children}</span>
      <span className="pf-prop-value">{value}</span>
      <span className="pf-prop-kf">
        {Kf && <button type="button" className={cx('pf-kf', `is-${keyframe}`)} aria-label={keyframeLabel ?? label} aria-pressed={keyframe !== 'none'} onClick={onKeyframe}><Kf size={16} /></button>}
      </span>
    </div>
  );
}

export interface SectionProps {
  title: string;
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  /** shown on the header while closed: "· 100% · רגיל" */
  summary?: ReactNode;
  onReset?: () => void;
  resetLabel?: string;
  /** text of the "?" popover */
  help?: ReactNode;
  helpLabel?: string;
  children: ReactNode;
  className?: string;
}
/** Collapsible section. A closed section keeps a value summary on its header, with reset and a "?" help popover. */
export function Section({ title, open: controlled, defaultOpen = true, onToggle, summary, onReset, resetLabel = 'Reset', help, helpLabel = 'Help', children, className }: SectionProps) {
  const [inner, setInner] = useState(defaultOpen);
  const [helpOpen, setHelpOpen] = useState(false);
  const open = controlled ?? inner;
  const bodyId = useId(), helpId = useId();
  const toggle = () => { setInner(!open); onToggle?.(!open); };
  return (
    <section className={cx(DS, 'pf-section', open && 'is-open', className)}>
      <header className="pf-section-head">
        <h3 className="pf-section-title">
          <button type="button" className="pf-section-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <ChevronIcon className="pf-section-chev" /><span>{title}</span>{!open && summary != null && <span className="pf-section-summary">{typeof summary === 'string' ? isolate(summary) : <bdi>{summary}</bdi>}</span>}
          </button>
        </h3>
        {onReset && <button type="button" className="pf-section-act" onClick={onReset}>{resetLabel}</button>}
        {help != null && <button type="button" className="pf-section-help" aria-label={helpLabel} aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(!helpOpen)}><HelpIcon size={14} /></button>}
      </header>
      {helpOpen && help != null && <div id={helpId} role="note" className="pf-section-pop">{help}</div>}
      <div id={bodyId} className="pf-section-body" hidden={!open}>{children}</div>
    </section>
  );
}
