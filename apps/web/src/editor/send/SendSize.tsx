/**
 * «גודל יעד» of the «מתאים לשליחה» tile (wave 7 send): the sizes to pick (16, 64, 100 MB, each marked «לא אומת») or a typed number,
 * nothing preselected; the picture size the plan will produce, said before the export; and what happens when the size cannot be met.
 * It promises bytes only. The plan comes from the sheet (the server's plan route), so there is one request, not two.
 */
import { useEffect, useState } from 'react';
import { translateRefusal, dictionaries } from '@pulseframe/i18n';
import { isolate } from '../../ds/util.tsx';
import { SEND_TESTIDS as ID } from './send.testids.ts';
import { SEND_STRINGS } from './send.strings.ts';
import { bytesOfMb, isShrunk, parseTargetMb, SIZE_CHOICES_MB, sayMb, type FitView } from './send.logic.ts';
import { readLastTarget } from './sendPrefs.ts';
import './send.css';

export interface SendSizeProps {
  lang: 'he' | 'en'; targetBytes: number | null; onChange(targetBytes: number | null): void;
  /** what the server's plan said about the fit for this target (the sheet fetches it) */
  plan?: FitView;
  /** the size the picture would have without the fit, to say whether it is shrunk */
  asked?: { width: number; height: number };
}
export function SendSize({ lang, targetBytes, onChange, plan = { kind: 'none' }, asked }: SendSizeProps) {
  const S = SEND_STRINGS[lang], D = dictionaries[lang];
  const [text, setText] = useState(targetBytes === null ? '' : sayMb(targetBytes));
  const [bad, setBad] = useState<string | null>(null);
  const last = readLastTarget();
  useEffect(() => { if (targetBytes !== null && parseTargetMb(text).ok !== true) setText(sayMb(targetBytes)); else if (targetBytes !== null) { const p = parseTargetMb(text); if (p.ok && p.bytes !== targetBytes) setText(sayMb(targetBytes)); } }, [targetBytes]); // eslint-disable-line react-hooks/exhaustive-deps
  const type = (v: string) => {
    setText(v);
    const p = parseTargetMb(v);
    if (p.ok) { setBad(null); onChange(p.bytes); return; }
    setBad(p.reason === 'empty' ? null : p.reason === 'not_a_number' ? S.typeNumber : S.outOfRange);
    onChange(null);
  };
  const pick = (bytes: number) => { setBad(null); setText(sayMb(bytes)); onChange(bytes); };
  const choices: { bytes: number; last?: boolean }[] = SIZE_CHOICES_MB.map((mb) => ({ bytes: bytesOfMb(mb) }));
  if (last !== null && !choices.some((c) => c.bytes === last)) choices.push({ bytes: last, last: true });
  const refusal = plan.kind === 'refused' ? (translateRefusal(lang, plan.message) ?? `${plan.message}${plan.hint ? `. ${plan.hint}` : ''}`) : bad;
  return (
    <div className="pf-send-size" data-testid={ID.size}>
      <div className="pf-xs-seg" role="radiogroup" aria-label={D['send.targetSize']}>
        {choices.map((c) => (
          <button key={c.bytes} type="button" role="radio" aria-checked={targetBytes === c.bytes} className={targetBytes === c.bytes ? 'is-on' : ''} data-testid={ID.sizeChoice} data-mb={sayMb(c.bytes)} onClick={() => pick(c.bytes)}>
            {c.last ? isolate(S.last(sayMb(c.bytes))) : <><bdi dir="ltr" className="num">{sayMb(c.bytes)}</bdi> {D['send.megabyte']}</>}
            <small className="pf-send-nv">{D['send.notVerified']}</small>
          </button>
        ))}
      </div>
      <label className="pf-send-field">{S.sizeLabel}
        <input type="text" inputMode="decimal" dir="ltr" value={text} data-testid={ID.sizeInput} aria-invalid={!!refusal} aria-describedby="pf-send-size-note" placeholder={D['send.chooseSize']} onChange={(e) => type(e.target.value)} />
      </label>
      <p id="pf-send-size-note" className="pf-xs-note">{isolate(D['send.megabyteIs'])} · {D['send.onlyBytes']}</p>
      {targetBytes === null && !refusal && <p className="pf-xs-note" data-testid="send-size-pending">{D['send.chooseSize']}</p>}
      {targetBytes !== null && plan.kind === 'checking' && <p className="pf-xs-note" role="status">{S.planning}</p>}
      {targetBytes !== null && plan.kind === 'unknown' && <p className="pf-xs-note" role="status">{S.planUnknown}</p>}
      {targetBytes !== null && plan.kind === 'plan' && (
        <p className="pf-send-fitted" role="status" data-testid={ID.sizeFitted} data-shrunk={asked && isShrunk(plan, asked) ? 'true' : 'false'}>
          {isolate(asked && isShrunk(plan, asked) ? S.fitted(plan.width, plan.height, sayMb(plan.targetBytes)) : S.keeps(plan.width, plan.height))}
        </p>
      )}
      {refusal && <p className="pf-send-refusal" role="alert" data-testid={ID.sizeRefusal} dir="auto">{isolate(refusal)}</p>}
      <p className="pf-xs-note">{S.cannotFit}</p>
    </div>
  );
}
