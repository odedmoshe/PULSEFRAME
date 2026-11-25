/**
 * «מגביל ראשי» in the sound panel's loudness section (wave 7 send): a switch and a ceiling (−9…0 dB, default the loudness true peak
 * or −1) committing set_master_limiter (the panel commits; this component only asks). `ReductionMeter` is the bar under the output
 * meter that shows how much the limiter takes off while playing, or says honestly that the preview plays without it.
 */
import { useEffect, useRef, useState } from 'react';
import { dictionaries } from '@pulseframe/i18n';
import { Switch } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { useEditorState } from '../store.ts';
import { SEND_TESTIDS as ID } from './send.testids.ts';
import { SEND_STRINGS } from './send.strings.ts';
import { limiterState, LIMITER_MAX, LIMITER_MIN, parseCeiling, reductionPct } from './send.logic.ts';

export interface LimiterSwitchProps { lang: 'he' | 'en'; ceiling: number | null; onChange(ceiling: number | null): void; /** the ceiling a switch-on starts at (loudness true peak, else −1) */ fallback?: number; /** why the preview runs without the limiter, when it does */ unavailable?: string | null }
export function LimiterSwitch({ lang, ceiling, onChange, fallback = -1, unavailable = null }: LimiterSwitchProps) {
  const D = dictionaries[lang], S = SEND_STRINGS[lang];
  const [text, setText] = useState(ceiling === null ? '' : String(ceiling));
  const [bad, setBad] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { setText(ceiling === null ? '' : String(ceiling)); setBad(false); dirty.current = false; }, [ceiling]);
  const commit = () => {
    if (!dirty.current || ceiling === null) return;
    dirty.current = false;
    const v = parseCeiling(text);
    if (v === null) { setBad(true); return; }
    setBad(false);
    if (v !== ceiling) onChange(v);
  };
  return (
    <div className="pf-send-limiter" data-testid={ID.limiter} data-on={ceiling !== null ? 'true' : 'false'}>
      <Switch checked={ceiling !== null} onChange={(on) => onChange(on ? fallback : null)} label={D['send.limiter']} testId={ID.limiterSwitch} />
      {ceiling !== null && (
        <label className="num-unit pf-send-field">{D['send.ceiling']}
          <input type="text" inputMode="decimal" dir="ltr" value={text} data-testid={ID.limiterCeiling} aria-invalid={bad} aria-describedby="pf-send-limiter-note"
            onChange={(e) => { dirty.current = true; setText(e.target.value); }} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
          <u aria-hidden="true">{S.ceilingUnit}</u>
        </label>
      )}
      {bad && <p className="pf-send-refusal" role="alert">{isolate(S.ceilingInvalid)}</p>}
      <p id="pf-send-limiter-note" className="muted pf-help">{ceiling === null ? D['send.limiterOff'] : S.limiterHint} <span className="pf-send-range">({LIMITER_MIN}…{LIMITER_MAX} dB)</span></p>
      {ceiling !== null && unavailable && <p className="pf-send-honest" role="status" data-testid="master-limiter-unavailable">{S.unavailable(lang === 'he' ? 'לא נטען בדפדפן הזה' : 'could not be loaded in this browser')}</p>}
    </div>
  );
}

/** The limiter's own bar under the output meter: how much it takes off now, or why there is nothing to show. */
export function ReductionMeter({ lang, ceiling, loudnessTarget }: { lang: 'he' | 'en'; ceiling: number | null; loudnessTarget: number | null }) {
  const { editor, state } = useEditorState();
  const S = SEND_STRINGS[lang], D = dictionaries[lang];
  const player = editor.player;
  const playing = !!player?.playing;
  void state.tick;
  const [red, setRed] = useState<number | null>(null);
  useEffect(() => {
    if (!playing || !player || ceiling === null) { setRed(null); return; }
    let raf = 0;
    const loop = () => { setRed(player.limiterReductionDb()); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, player, ceiling]);
  const why = player?.limiterUnavailable ?? null;
  const st = limiterState(ceiling, why, red !== null || !playing);
  const note = loudnessTarget !== null && <span className="pf-send-before" data-testid="meter-before-export-gain"><b>{D['send.beforeExportGain']}</b> · {S.beforeNote(String(loudnessTarget).replace('-', '−'))}</span>;
  if (st === 'off') return note ? <div className="pf-send-reduction" data-state="off">{note}</div> : null;
  const pct = reductionPct(red);
  const holding = red !== null && red < -0.05;
  return (
    <div className="pf-send-reduction" data-testid={ID.meterReduction} data-state={st} data-holding={holding ? 'true' : 'false'}>
      <strong>{D['send.limiter']}</strong>
      {st === 'unavailable' ? <span className="pf-send-honest" role="status" title={why ?? undefined}>{S.unavailable(lang === 'he' ? 'לא נטען בדפדפן הזה' : 'could not be loaded in this browser')}</span> : (
        <>
          <div className="pf-send-bar" role="meter" aria-label={D['send.limiter']} aria-valuemin={0} aria-valuemax={12} aria-valuenow={red === null ? 0 : Math.round(-red * 10) / 10} aria-valuetext={red === null ? S.idle : holding ? S.reduction(Math.abs(red).toFixed(1)) : S.notHolding}>
            <i style={{ inlineSize: `${pct ?? 0}%` }} />
          </div>
          <bdi dir="ltr" className="num">{red === null ? '' : `${red < -0.05 ? '−' : ''}${Math.abs(red).toFixed(1)} dB`}</bdi>
          {red === null && <span className="mix-out-note">{S.idle}</span>}
        </>
      )}
      {note}
    </div>
  );
}
