/**
 * «צליל» in a row of «מוזיקה מובנית» (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md §4; builder W3).
 * The radiogroup «מסונתז» / «כלים מוקלטים» (arrows move and select, right-to-left aware), the badge (unheard until the owner's mark),
 * the kit's state in words with the next step, what the kit asks of a film (credit, non-commercial) before an add, «השוואה עיוורת»
 * and «שמעתי» (the owner's own session; any other credential gets the server's refusal in words). Chrome right to left; numbers
 * in <bdi dir="ltr">. Nothing here says a recorded kit sounds better: nobody has listened.
 */
import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { api, ApiFailure } from '../../api.ts';
import { Badge, Button, rovingNext, useDir } from '../../ds/index.ts';
import { INSTRUMENTS_TESTIDS as ID } from './instruments.testids.ts';
import { dutiesOf, heardDate, INSTRUMENTS_UI_BUILT, isReady, kitInstrumentTitles, licenceWhy, refusalWords, type KitView, type Sound } from './instruments.logic.ts';
import { instrumentsT, type InstrumentsT } from './instruments.strings.ts';
import { AuditionPair } from './AuditionPair.tsx';

const CHOICES = ['synth', 'recorded'] as const;
/** A template with {date} where the date goes in its own left-to-right run. */
const withDate = (template: string, date: string): ReactNode => template.split('{date}').flatMap((p, i, a) => (i < a.length - 1 ? [p, <bdi key={i} dir="ltr">{date}</bdi>] : [p]));

function stateWords(t: InstrumentsT, v: KitView): string {
  if (v.phase === 'failed') return `${t('state.failed')}${v.why ? ` (${v.why})` : ''}`;
  return t(`state.${v.phase}`);
}

export function InstrumentsChoice({ styleId, lang, bars, seed, value, onChange, view, onRecheck, onPlay }: {
  styleId: string; lang: 'he' | 'en'; bars: number; seed: number; value: Sound; onChange: (v: Sound) => void;
  view: KitView; onRecheck: () => Promise<void> | void; /** a pair or a row preview starts: stop the other player */ onPlay?: () => void;
}): ReactElement | null {
  if (!INSTRUMENTS_UI_BUILT) return null;
  const t = instrumentsT(lang);
  const dir = useDir();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);
  const [mark, setMark] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [marking, setMarking] = useState(false);
  const kit = view.kit;
  const recorded = value === 'recorded';
  const ready = isReady(view);
  const uid = styleId.replace(/\W/g, '-');
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: CHOICES.length, dir });
    if (to === null) return;
    e.preventDefault();
    refs.current[to]?.focus();
    onChange(CHOICES[to]!);
  };
  const date = kit ? heardDate(kit) : null;
  const duties = kit ? dutiesOf(kit.sources) : null;
  const markHeard = async (heard: boolean) => {
    if (!kit) return;
    setMarking(true); setMark(null);
    try {
      const r = await api.markKitHeard(kit.kitId, heard);
      await onRecheck();
      setMark({ kind: 'ok', text: heard ? t('heardSaved', { date: (r.heard?.at ?? '').slice(0, 10) }) : t('heardCleared') });
    } catch (e) {
      const f = e instanceof ApiFailure ? e : null;
      setMark({ kind: 'err', text: `${t('heardFailed')}: ${refusalWords(lang, { message: f?.message ?? (e instanceof Error ? e.message : String(e)), ...(f?.hint ? { hint: f.hint } : {}) })}` });
    } finally { setMarking(false); }
  };
  const auditionReason = !recorded ? t('auditionNeedRecorded') : !ready ? t('auditionNeedKit') : bars <= 0 ? t('auditionNeedBars') : undefined;
  const showPair = open && !auditionReason;
  return (
    <div className="pf-instruments" data-style-id={styleId} data-sound={value}>
      <div className="pf-instr-head">
        <span className="pf-instr-label" id={`pf-instr-label-${uid}`}>{t('sound')}</span>
        <div role="radiogroup" aria-labelledby={`pf-instr-label-${uid}`} aria-describedby={`pf-instr-help-${uid}`} className="pf-seg pf-seg-sm pf-ds" data-testid={ID.choice}>
          {CHOICES.map((c, i) => (
            <button key={c} type="button" role="radio" aria-checked={value === c} tabIndex={value === c ? 0 : -1}
              ref={(el) => { refs.current[i] = el; }} className={`pf-seg-btn${value === c ? ' is-on' : ''}`} data-testid={ID.choiceOption} data-choice={c}
              onClick={() => onChange(c)} onKeyDown={(e) => onKey(e, i)}><span>{t(c)}</span></button>
          ))}
        </div>
        {kit && (
          <Badge tone="attention" className="pf-instr-badge">
            <span data-testid={ID.unheard} data-heard={kit.heard ? 'true' : 'false'}>
              {date ? withDate(t('heardOn'), date) : t('unheard')}
            </span>
          </Badge>
        )}
      </div>
      <p className="pf-instr-help" id={`pf-instr-help-${uid}`}>{t('soundHelp')}</p>
      <p className={`pf-instr-state is-${view.phase}`} data-testid={ID.state} data-state={view.phase} role="status">
        <span className="pf-instr-state-words">{stateWords(t, view)}</span>
        {recorded && <span className="pf-instr-next"> {t(`next.${view.phase}`)}</span>}
      </p>
      {recorded && view.phase === 'licence' && kit && (
        <ul className="pf-instr-list" data-part="licence-why">
          {kit.sources.map((s) => <li key={s.sourceId}>{t('licenceSource', { title: s.title, licence: s.licenceId })} <span>{t(`licenceWhy.${licenceWhy(s.licenceId)}`)}</span></li>)}
          {kit.sources.length === 0 && <li>{t('licenceWhy.other')}</li>}
        </ul>
      )}
      {recorded && (view.phase === 'failed' || view.phase === 'item_missing' || view.phase === 'item_version' || view.phase === 'file_missing' || view.phase === 'file_changed' || view.phase === 'unreadable' || view.phase === 'library_not_set' || view.phase === 'not_calibrated' || view.phase === 'not_built') && (
        <Button size="sm" onClick={() => void onRecheck()}>{t('recheck')}</Button>
      )}
      {recorded && ready && kit && duties && (
        <div className="pf-instr-duties" data-part="duties">
          <p className="pf-instr-line">{t('parts', { recorded: kitInstrumentTitles(kit, lang).join(', ') })}</p>
          <p className="pf-instr-line"><strong>{t('dutiesHeading')}</strong></p>
          <ul className="pf-instr-list">
            {duties.credit.map((c) => <li key={`c-${c}`} data-duty="credit">{t('credits', { credit: c })}</li>)}
            {duties.nonCommercial && <li data-duty="non-commercial"><strong>{t('nonCommercial')}</strong>. {t('dutyNonCommercialMore')}</li>}
            {duties.none.map((n) => <li key={`n-${n}`} data-duty="none">{t('dutyNone', { title: n })}</li>)}
            {kit.sources.length === 0 && <li data-duty="unknown">{t('dutyNoSources')}</li>}
          </ul>
          <p className="pf-instr-help">{t('allOrNothing')}</p>
        </div>
      )}
      {recorded && (
        <div className="pf-instr-actions">
          <Button size="sm" data-testid={ID.audition} aria-expanded={showPair} aria-controls={`pf-instr-pair-${uid}`} disabledReason={auditionReason}
            onClick={() => setOpen((o) => !o)}>{showPair ? t('auditionClose') : t('audition')}</Button>
          <Button size="sm" data-testid={ID.heard} data-heard={kit?.heard ? 'true' : 'false'} busy={marking}
            disabledReason={!kit || !ready ? t('heardNeedKit') : undefined} onClick={() => void markHeard(!kit?.heard)}>{kit?.heard ? t('notHeard') : t('heard')}</Button>
        </div>
      )}
      {recorded && <p className="pf-instr-help">{t('heardHelp')}</p>}
      {showPair && <AuditionPair styleId={styleId} lang={lang} bars={bars} seed={seed} {...(onPlay ? { onPlay } : {})} />}
      {mark && <p className={`pf-instr-line is-${mark.kind}`} role="status" data-part="heard-status">{mark.text}</p>}
    </div>
  );
}
