import type { ReactNode } from 'react';
import { Button } from './Button.tsx';
import { Badge } from './Chip.tsx';
import { clampPercent, progressFillSide, ringDash } from './logic.ts';
import { CheckIcon, DS, WarnIcon, cx, useDir } from './util.tsx';

export interface ProgressBarProps { value: number | null; label: string; tone?: 'frame' | 'pulse' | 'ok'; className?: string }
/** role=progressbar. Fills from the reading-direction start (the right in Hebrew). value=null is indeterminate (no aria-valuenow). */
export function ProgressBar({ value, label, tone = 'frame', className }: ProgressBarProps) {
  const dir = useDir();
  const pct = value == null ? null : clampPercent(value);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-valuetext={pct == null ? undefined : `${pct}%`}
      className={cx(DS, 'pf-bar', `is-${tone}`, pct == null && 'is-indeterminate', className)} data-fill-side={progressFillSide(dir)}>
      <i style={pct == null ? undefined : { inlineSize: `${pct}%` }} />
    </div>
  );
}

export interface RingProps { value: number | null; label: string; size?: 28 | 36 | 48; /** text inside: "64%" */ children?: ReactNode; className?: string }
/** Circular progress; the arc starts at the top and runs clockwise in both languages (a clock face does not mirror). */
export function Ring({ value, label, size = 36, children, className }: RingProps) {
  const r = (size - 6) / 2;
  const pct = value == null ? null : clampPercent(value);
  const { circumference, dash } = ringDash(pct ?? 25, r);
  return (
    <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} className={cx(DS, 'pf-ring', pct == null && 'is-indeterminate', className)} style={{ inlineSize: size, blockSize: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
        <circle className="pf-ring-track" cx={size / 2} cy={size / 2} r={r} />
        <circle className="pf-ring-arc" cx={size / 2} cy={size / 2} r={r} strokeDasharray={`${dash} ${circumference}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {children != null && <span className="pf-ring-text num">{children}</span>}
    </span>
  );
}

export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'needs-setup';
export interface JobRowProps {
  title: string;
  detail?: string;
  state: JobState;
  /** 0..100 while running */
  progress?: number | null;
  /** localized word for the state, e.g. "בעבודה" */
  stateLabel: string;
  cancelLabel?: string;
  onCancel?: () => void;
  action?: string;
  onAction?: () => void;
  className?: string;
}
/** One background job: ring or state icon, title, detail, state badge, cancel. Failed and needs-setup are honest states with a next step. */
export function JobRow({ title, detail, state, progress = null, stateLabel, cancelLabel, onCancel, action, onAction, className }: JobRowProps) {
  const lead = state === 'running' ? <Ring value={progress} label={title} size={28}>{progress != null ? `${clampPercent(progress)}` : undefined}</Ring>
    : state === 'done' ? <span className="pf-job-ic is-ok"><CheckIcon /></span>
    : state === 'failed' ? <span className="pf-job-ic is-danger"><WarnIcon /></span>
    : state === 'needs-setup' ? <span className="pf-job-ic is-muted"><WarnIcon /></span> : <span className="pf-job-ic is-muted"><i className="pf-job-dot" /></span>;
  const tone = state === 'done' ? 'ok' : state === 'failed' ? 'attention' : state === 'running' ? 'frame' : 'neutral';
  return (
    <div className={cx(DS, 'pf-job', `is-${state}`, className)} role="group" aria-label={title}>
      {lead}
      <div className="pf-job-text"><b>{title}</b>{detail && <span>{detail}</span>}</div>
      <Badge tone={tone}>{stateLabel}</Badge>
      {action && <Button size="sm" variant="secondary" onClick={onAction}>{action}</Button>}
      {state === 'running' && onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>{cancelLabel ?? 'Cancel'}</Button>}
    </div>
  );
}
