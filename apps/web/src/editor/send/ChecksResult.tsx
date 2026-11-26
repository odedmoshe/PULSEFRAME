/**
 * «בדיקות הקובץ» on the file card (wave 7 send): what the export found, each finding with its time, the measurement behind it and
 * «מעבר לקטע». Report only: it never stops an export. A quiet report names what was looked for and says "not found"; it never says
 * the file is fine, and a part that did not measure is not listed as clean.
 */
import { SearchCheck, TriangleAlert } from 'lucide-react';
import type { ExportChecks } from '@pulseframe/core';
import type { RationalTime } from '@pulseframe/time';
import { dictionaries } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { SEND_TESTIDS as ID } from './send.testids.ts';
import { SEND_STRINGS } from './send.strings.ts';
import { findingRows, lookedKinds } from './send.logic.ts';
import { ExplainedFindings } from '../qc/ExplainedFindings.tsx';

export interface ChecksResultProps { lang: 'he' | 'en'; checks: ExportChecks | null; onJump(at: RationalTime): void; rate?: { num: number; den: number } }
export function ChecksResult({ lang, checks, onJump, rate = { num: 30, den: 1 } }: ChecksResultProps) {
  if (!checks) return null;
  const D = dictionaries[lang], S = SEND_STRINGS[lang];
  const rows = findingRows(checks, rate);
  const { kinds, allMeasured } = lookedKinds(checks);
  const name = (k: string) => D[`send.find.${k}` as 'send.find.black'];
  return (
    <div className={`pf-xs-card${rows.length ? ' is-bad' : ''} pf-send-checks`} data-testid={ID.checks} role="group" aria-label={D['send.checks']} data-found={rows.length}>
      {rows.length ? <TriangleAlert size={18} aria-hidden="true" /> : <SearchCheck size={18} aria-hidden="true" />}
      <div className="pf-xs-card-text">
        <b>{D['send.checks']}{rows.length > 0 && <> · {S.foundN(rows.length)}</>}</b>
        {rows.length > 0 ? (
          <ul className="pf-xs-flash-list">
            {rows.map((r) => (
              <li key={r.key} data-testid={ID.checkItem} data-kind={r.kind}>
                <b>{name(r.kind)}</b> · <bdi dir="ltr" className="num">{r.fromText}–{r.toText}</bdi>
                {r.context === 'gap' && <> · {S.gap}</>}{r.context === 'picture' && <> · {S.blackPicture}</>}
                {r.soundPlays !== null && <> · {r.soundPlays ? S.soundPlays : S.noSoundPlays}</>}
                {r.measured && <small className="pf-send-measured"> · <bdi dir="ltr" className="num">{r.measured}</bdi></small>}
                <Button size="sm" variant="secondary" data-testid={ID.checkJump} onClick={() => onJump(r.from)}>{D['send.jump']}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <span data-testid="export-checks-quiet">{allMeasured ? S.quiet : kinds.length ? `${S.notFound}: ${kinds.map(name).join(', ')}. ${S.notMeasured}: ${(['black', 'frozen', 'silence', 'clipped'] as const).filter((k) => !kinds.includes(k)).map(name).join(', ')}` : `${S.notMeasured}`}</span>
        )}
        <ExplainedFindings lang={lang} checks={checks} rate={rate} onJump={onJump} />
        <span className="pf-xs-note"><bdi lang="en" dir="ltr">{checks.picture.method}</bdi> · <bdi lang="en" dir="ltr">{checks.sound.method}</bdi></span>
        <span className="pf-xs-note">{D['send.heuristic']} · {S.reportOnly}</span>
      </div>
    </div>
  );
}
