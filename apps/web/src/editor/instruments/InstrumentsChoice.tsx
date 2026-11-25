/**
 * «צליל» in a row of «מוזיקה מובנית» (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md §4). LEAD: the stub, its props
 * and its mount (MusicBrowser.tsx). Builder W3 builds it: the radiogroup «מסונתז» / «כלים מוקלטים» (arrow keys inside), the state line
 * built from the kit's state in words (never the server's code alone), the badge (MUSIC_RECORDED_UNHEARD_LABEL until the owner's mark),
 * «השוואה עיוורת» with «א» and «ב» at matched level (audio.volume from x-pf-level-scale) and «מה היה מה?», and «שמעתי» (api.markKitHeard;
 * a refusal is shown in words). Chrome right to left; numbers in <bdi dir="ltr">. Nothing here says a recorded kit sounds better.
 * Renders nothing while INSTRUMENTS_UI_BUILT is false (the ids below are the contract the builder keeps).
 */
import type { ReactElement } from 'react';
import { INSTRUMENTS_TESTIDS as ID } from './instruments.testids.ts';
import { INSTRUMENTS_UI_BUILT } from './instruments.logic.ts';
import { instrumentsT } from './instruments.strings.ts';

export function InstrumentsChoice({ styleId, lang, value, onChange }: { styleId: string; lang: 'he' | 'en'; bars: number; seed: number; value: 'synth' | 'recorded'; onChange: (v: 'synth' | 'recorded') => void }): ReactElement | null {
  if (!INSTRUMENTS_UI_BUILT) return null;
  const t = instrumentsT(lang);
  return (
    <div className="pf-instruments" data-style-id={styleId}>
      <div role="radiogroup" aria-label={t('sound')} data-testid={ID.choice}>
        {(['synth', 'recorded'] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={value === c} data-testid={ID.choiceOption} data-choice={c} onClick={() => onChange(c)}>{t(c)}</button>
        ))}
      </div>
      <p data-testid={ID.state} data-state="not_built">{t('state.not_built')}</p>
      <span data-testid={ID.unheard}>{t('unheard')}</span>
      <button type="button" data-testid={ID.audition}>{t('audition')}</button>
      <button type="button" aria-pressed={false} data-testid={ID.auditionA}>{t('auditionA')}</button>
      <button type="button" aria-pressed={false} data-testid={ID.auditionB}>{t('auditionB')}</button>
      <button type="button" data-testid={ID.reveal}>{t('reveal')}</button>
      <p data-testid={ID.levelNote}>{t('levelNote')}</p>
      <button type="button" data-testid={ID.heard}>{t('heard')}</button>
    </div>
  );
}
