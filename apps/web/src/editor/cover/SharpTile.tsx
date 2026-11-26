/**
 * One candidate of «הפריים הכי חד»: a paused player on the frame, its number lines (always the numbers, never a verdict), the label
 * of the heuristic, the one-clip note, and stepping: focus the tile, ← / → one source frame of the file's own rate (← earlier, →
 * later, as the transport), Shift one second, Enter chooses (opens «שמירת התמונה» for the shown frame). A frame without a record says
 * «לא נמדד».
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { STILLS_LABEL, type Asset, type SharpAnswer } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { focusNow } from '../../ds/focus.ts';
import { StillCanvas } from './StillCanvas.tsx';
import { coverT } from './cover.strings.ts';
import { COVER_TESTIDS as ID } from './cover.testids.ts';
import { fileRate, fpsText, frameNumbers, frameTimecode, LATER_ARROW, percentText, ratesDiffer, ratioText, sigmaText, steppedFrame } from './cover.logic.ts';

/** A template with {placeholders}: each value is an LTR isolate (numbers stay readable inside Hebrew). */
export function Line({ text, vars }: { text: string; vars: Record<string, string | number> }): ReactNode {
  const parts = text.split(/(\{\w+\})/);
  return <>{parts.map((p, i) => { const m = /^\{(\w+)\}$/.exec(p); return m && m[1]! in vars ? <bdi key={i} dir="ltr">{vars[m[1]!]}</bdi> : p; })}</>;
}

export function SharpTile({ rank, startFrame, asset, answer, lang, projectRate, onSave }: {
  rank: number; startFrame: number; asset: Asset; answer: SharpAnswer; lang: Lang; projectRate: { num: number; den: number }; onSave: (frame: number) => void;
}) {
  const t = coverT(lang);
  const [frame, setFrame] = useState(startFrame);
  const saveRef = useRef<HTMLButtonElement>(null);
  const n = frameNumbers(answer, frame);
  const tc = frameTimecode(asset, frame);
  const open = () => { focusNow(saveRef.current); onSave(frame); }; // the focus is on the button first (Escape in the dialog returns to it), in this task
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') { e.preventDefault(); open(); return; }
    const next = steppedFrame(frame, e.key, e.shiftKey, asset);
    if (next === null) return;
    e.preventDefault();
    setFrame(next);
  };
  const rate = fileRate(asset);
  const differs = ratesDiffer(rate, projectRate);
  const label = t('tileLabel', { n: rank, frame });
  const na = <span>{t('notMeasured')}</span>;
  return (
    <div className="cover-tile" role="group" tabIndex={0} aria-label={label} aria-describedby={`cover-hint-${rank}`} data-testid={ID.tile} data-frame={frame} data-candidate={rank} onKeyDown={onKey}>
      <StillCanvas asset={asset} frame={frame} label={`${label} · ${tc}`} />
      <div className="cover-numbers" data-testid={ID.numbers}
        {...(n.measured ? { 'data-frame': frame, 'data-sharp': n.sharp!, 'data-sigma100': n.sigma100!, 'data-hi': n.hi!, 'data-lo': n.lo!, ...(n.motion !== null && n.motion !== undefined ? { 'data-motion': n.motion } : {}) } : { 'data-frame': frame })}>
        <p className="cover-frame-line" role="status" aria-live="polite"><Line text={t('line.frame')} vars={{ n: frame, t: tc }} /></p>
        {!n.measured ? <p className="muted">{na}</p> : (
          <ul className="cover-lines">
            {n.ratioPermille !== null && <li><Line text={t('line.sharp')} vars={{ r: ratioText(n.ratioPermille) }} /></li>}
            <li><Line text={t('line.noise')} vars={{ sigma: sigmaText(n.sigma100!) }} /></li>
            <li>{n.firstFrame ? t('firstFrame') : <Line text={t('line.motion')} vars={{ m: percentText(n.motion!) }} />}</li>
            <li><Line text={t('line.hi')} vars={{ h: percentText(n.hi!) }} /></li>
            <li><Line text={t('line.lo')} vars={{ l: percentText(n.lo!) }} /></li>
          </ul>
        )}
        {n.manyClipped && <p className="cover-note">{t('manyClipped')}</p>}
      </div>
      <p className="muted cover-label" data-testid={ID.label}>{STILLS_LABEL[lang]} · <strong>{t('notByEye')}</strong></p>
      <p className="muted cover-keyhint" id={`cover-hint-${rank}`} data-testid={ID.keyHint}>{t('keyHint', { later: LATER_ARROW })}</p>
      {differs && <p className="muted" data-testid={ID.rateNote}>{t('rateDiffers', { fps: fpsText(rate) })}</p>}
      <div className="row"><button ref={saveRef} type="button" className="ghost" data-testid={ID.save} onClick={open}>{t('save')}</button></div>
    </div>
  );
}
