/**
 * The template dialog's fieldset «פרטים» (ADR-0022; plan §8 with the verifier's corrections): one field per pack field the
 * template's titles hold (TemplateSummary.fields; labels i18n pack.field.*): שם and שם נוסף (dir=auto), גיל (number, LTR), נר
 * (radio group 1–8, always shown and editable), מקום, מתי; for a candle template also the date (the live Hebrew date in <bdi>,
 * aria-live polite, from the life line's calendar) and the switch «צולם בהדלקת הנרות של אותו ערב» (on by default). The value
 * is PackFieldsInput exactly as TemplateInput.fields takes it; nothing reads a clock. Test ids: PACK_TESTIDS.fields, field(k),
 * date, hebrewDate, atLighting. Values are literal: a field that holds «{n}» is that text (the planner writes them once).
 */
import { useEffect, useId, useState } from 'react';
import type { PackFieldKey, PackFieldsInput } from '@pulseframe/core';
import { Button, Seg, Switch } from '../ds/index.ts';
import { DS, cx } from '../ds/util.tsx';
import { PACK_TESTIDS as TID } from './packs.testids.ts';
import { PACK_STRINGS } from './packs.strings.ts';
import { CANDLES, atLightingOn, dateProblem, fieldWasCut, hebrewDateOf, setAtLighting, setCandle, setDate, setField, shownCandle } from './packs.logic.ts';
import './packs.css';

export function PackFields({ fields, candle, value, onChange, lang }: { fields: readonly PackFieldKey[]; candle: boolean; value: PackFieldsInput; onChange: (next: PackFieldsInput) => void; lang: 'he' | 'en' }) {
  const S = PACK_STRINGS[lang].fields;
  const base = useId();
  const [dateRaw, setDateRaw] = useState(value.date ?? '');
  // an outside change of the date reaches the input; a half-typed or invalid entry stays as typed
  useEffect(() => { setDateRaw((raw) => ((value.date ?? '') !== raw && !dateProblem(raw) ? (value.date ?? '') : raw)); }, [value.date]);
  const [cut, setCut] = useState<Partial<Record<PackFieldKey, 'age' | 'long'>>>({});
  const text = (k: Exclude<PackFieldKey, 'night'>) => {
    const id = `${base}-${k}`;
    const why = cut[k];
    return (
      <div key={k} className="pf-pfield">
        <label htmlFor={id} className="pf-pfield-label">{S.label[k]}</label>
        <input id={id} type="text" data-testid={TID.field(k)} value={value[k] ?? ''} maxLength={k === 'age' ? 3 : undefined}
          inputMode={k === 'age' ? 'numeric' : undefined} dir={k === 'age' ? 'ltr' : 'auto'} className={cx('pf-pinput', k === 'age' && 'num')} autoComplete="off"
          aria-describedby={why ? `${id}-why` : undefined} aria-invalid={why ? true : undefined}
          onChange={(e) => { setCut((c) => ({ ...c, [k]: fieldWasCut(k, e.target.value) ?? undefined })); onChange(setField(value, k, e.target.value)); }} />
        {why && <span id={`${id}-why`} className="pf-pfield-why" role="status">{why === 'age' ? S.ageOnly : S.tooLong}</span>}
      </div>
    );
  };
  const shown = shownCandle(value);
  const lighting = atLightingOn(value);
  const heb = hebrewDateOf(value.date, lighting);
  const bad = dateProblem(dateRaw);
  const candleBlock = fields.includes('night') && (
    <div key="night" className="pf-pfield" data-testid={TID.field('night')}>
      <span id={`${base}-night`} className="pf-pfield-label">{S.candleGroup}</span>
      <div className="pf-pfield-candles">
        <Seg size="sm" label={S.candleGroup} value={shown.n === null ? '' : String(shown.n)} onChange={(v) => onChange(setCandle(value, Number(v)))}
          options={CANDLES.map((n) => ({ value: String(n), label: <span className="num">{n}</span>, ariaLabel: S.candle(n) }))} />
        {value.night !== undefined && <Button size="sm" variant="ghost" onClick={() => onChange(setCandle(value, null))}>{S.clearCandle}</Button>}
      </div>
      <span className="pf-pfield-why" role="status">
        {shown.by === 'date' && shown.n !== null ? S.candleDerived(shown.n) : shown.by === 'none' ? (candle && value.date && !bad ? S.notHanukkah : S.candleNone) : ''}
      </span>
    </div>
  );
  return (
    <fieldset className={cx(DS, 'pf-pfields')} data-testid={TID.fields} data-lang={lang}>
      <legend className="pf-pfields-legend">{S.legend}</legend>
      {fields.filter((k): k is Exclude<PackFieldKey, 'night'> => k !== 'night').map(text)}
      {candleBlock}
      {candle && (
        <>
          <div className="pf-pfield">
            <label htmlFor={`${base}-date`} className="pf-pfield-label">{S.label.date}</label>
            <input id={`${base}-date`} type="date" data-testid={TID.date} value={dateRaw} min="1900-01-01" max="2100-12-31" dir="ltr" className="pf-pinput num"
              aria-invalid={bad || undefined} aria-describedby={`${base}-heb`}
              onChange={(e) => { setDateRaw(e.target.value); onChange(setDate(value, e.target.value)); }} />
          </div>
          <p id={`${base}-heb`} className="pf-pfield-heb" data-testid={TID.hebrewDate} aria-live="polite">
            <span className="pf-pfield-label">{S.hebrewDate}: </span>
            {bad ? <span className="pf-pfield-why">{S.invalidDate}</span> : heb ? (
              <>
                <bdi dir="rtl" lang="he">{heb.day}</bdi>
                {heb.evening && <span className="pf-pfield-evening"> · <bdi dir="rtl" lang="he">{S.hebrewDateAtEvening(heb.evening)}</bdi></span>}
              </>
            ) : <span aria-hidden="true">—</span>}
          </p>
          <div className="pf-pfield">
            <Switch checked={lighting} onChange={(on) => onChange(setAtLighting(value, on))} label={S.atLighting} testId={TID.atLighting} />
            <span className="pf-pfield-why">{S.atLightingHint}</span>
          </div>
        </>
      )}
    </fieldset>
  );
}
