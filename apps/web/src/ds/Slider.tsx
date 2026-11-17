import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { sliderDir, sliderGeometry, sliderKey, sliderPointerValue, type SliderKind, type ScrubSpec } from './logic.ts';
import { DS, cx, useDir } from './util.tsx';

export interface SliderProps {
  value: number; min: number; max: number; step?: number;
  /** spatial: LTR in every language (X, Y, rotation, pan, time). magnitude: fills from the reading direction (opacity, volume, intensity). */
  kind?: SliderKind;
  /** centre tick, fill from the centre */
  bipolar?: boolean;
  /** beat-linked: gold notches at these values (beat lengths) */
  beats?: readonly number[];
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  valueText?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function Slider({ value, min, max, step = 1, kind = 'magnitude', bipolar, beats, onChange, onCommit, label, valueText, disabled, className, testId }: SliderProps) {
  const textDir = useDir();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const spec: ScrubSpec = { min, max, step };
  const g = sliderGeometry(value, min, max, kind, textDir, bipolar);
  const at = (v: number) => sliderGeometry(v, min, max, kind, textDir).knob * 100;
  const fromPointer = (e: PointerEvent) => { const r = track.current!.getBoundingClientRect(); return sliderPointerValue(e.clientX, r.left, r.width, min, max, kind, textDir, spec); };
  const down = (e: PointerEvent) => { if (disabled) return; dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onChange(fromPointer(e)); };
  const move = (e: PointerEvent) => { if (dragging.current) onChange(fromPointer(e)); };
  const up = (e: PointerEvent) => { if (!dragging.current) return; dragging.current = false; onCommit?.(fromPointer(e)); };
  const key = (e: KeyboardEvent) => { const v = sliderKey(value, e.key, kind, textDir, spec, e.shiftKey); if (v === null || disabled) return; e.preventDefault(); onChange(v); onCommit?.(v); };
  const vars = { '--a': `${g.fillStart * 100}%`, '--b': `${g.fillEnd * 100}%`, '--k': `${g.knob * 100}%` } as CSSProperties;
  return (
    // The track is laid out left-to-right in absolute coordinates in both languages: the geometry decides which end "min" is on.
    <div ref={track} dir="ltr" className={cx(DS, 'pf-slider', `is-${kind}`, bipolar && 'is-bipolar', disabled && 'is-disabled', className)} style={vars} data-testid={testId} data-reading-dir={sliderDir(kind, textDir)}
      role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-valuetext={valueText} aria-orientation="horizontal" aria-disabled={disabled || undefined}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onKeyDown={key}>
      <span className="pf-slider-rail" />
      <span className="pf-slider-fill" />
      {bipolar && <span className="pf-slider-centre" />}
      {beats?.map((b) => <span key={b} className="pf-slider-beat" style={{ left: `${at(b)}%` }} />)}
      <span className="pf-slider-knob" />
    </div>
  );
}
