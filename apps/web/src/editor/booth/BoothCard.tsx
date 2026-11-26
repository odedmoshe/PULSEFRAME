/**
 * One card of «תא הבדיקה» (wave 8 booth, builder W3): the title, what is seen or heard, the state of the card in words, the body by kind
 * (the sound, W2's picture or microphone card), the three answers, «שוב», and the «מה לא טוב?» panel that «לא טוב» opens. Presentational:
 * the dialog owns the queue, the keys, the focus and the saving. Words from the shared booth strings and booth.strings.ts.
 */
import { forwardRef, type MutableRefObject, type ReactElement } from 'react';
import type { BoothCheckRow, BoothItemView, BoothSay, BoothVerdict } from '@pulseframe/core';
import type { FlashGuard } from '@pulseframe/engine';
import type { Lang } from '@pulseframe/i18n';
import { Button } from '../../ds/index.ts';
import { AudioCard, type AudioControl } from './AudioCard.tsx';
import { BoothPicture } from './BoothPicture.tsx';
import { MicCard } from './MicCard.tsx';
import type { BoothAnswerExtras } from './booth.contract.ts';
import { BOOTH_TESTIDS as TID } from './booth.testids.ts';
import { drawnOnSoftware, noAdapter, stateLine } from './booth.logic.ts';

export interface BadPanel { problems: string[]; note: string }
export interface BoothCardProps {
  lang: Lang; say: BoothSay; view: BoothItemView; n: number; m: number; replay: number;
  browserGpu: BoothCheckRow | null; guard: FlashGuard; reducedMotion: boolean;
  volume: number; onVolume: (v: number) => void; audioControl: MutableRefObject<AudioControl | null>; onPlayed: (sha: string) => void;
  onExtras: (x: BoothAnswerExtras) => void;
  bad: BadPanel | null; onBad: (b: BadPanel) => void; onSubmitBad: () => void; onCancelBad: () => void;
  onAnswer: (v: BoothVerdict) => void; onAgain: () => void; names: number;
}

export const BoothCard = forwardRef<HTMLElement, BoothCardProps>(function BoothCard(p, ref): ReactElement {
  const { lang, say, view, bad } = p;
  const it = view.item;
  const pictureBlocked = it.kind === 'picture' && noAdapter(p.browserGpu);
  const kindWhat = it.source === 'music' || it.source === 'sfx' ? say(it.source === 'music' ? 'booth.what.music' : 'booth.what.sfx')
    : it.source === 'gpu-transition' ? say('booth.what.transition') : it.source === 'gpu-effect' ? say('booth.what.effect') : '';
  const toggle = (id: string) => { if (!bad) return; const on = bad.problems.includes(id); p.onBad({ ...bad, problems: on ? bad.problems.filter((x) => x !== id) : [...bad.problems, id] }); };
  const atMax = (bad?.problems.length ?? 0) >= 6;
  return (
    <section ref={ref} className="pf-booth-card" data-testid={TID.card} data-item={it.id} data-kind={it.kind} data-state={view.state} data-changes-light={it.changesLight ? 'yes' : 'no'} aria-labelledby={`pf-booth-t-${it.id.replace(/[^a-z0-9]/gi, '-')}`}>
      <p className="pf-booth-meta"><span>{say('page.cardOf', { n: p.n, m: p.m })}</span> · <span>{say(`booth.group.${it.group}`)}</span> · <span>{say(`page.kind.${it.kind}`)}</span> · <span>{say('page.minutes', { n: it.minutes })}</span></p>
      <h3 id={`pf-booth-t-${it.id.replace(/[^a-z0-9]/gi, '-')}`} className="pf-booth-title" tabIndex={-1}>{it.title[lang]}</h3>
      <p className="pf-booth-what">{it.what[lang] || kindWhat}</p>
      {it.kind === 'picture' && <p className="pf-booth-note">{say('booth.testPicture')}</p>}
      {it.usedBy.length > 0 && <p className="pf-booth-note">{it.usedBy.map((u) => say(`booth.usedBy.${u}`)).join(' · ')}</p>}
      {it.changesLight && <p className="pf-booth-note" data-part="changes-light">{say('booth.changesLight')}</p>}
      <p className="pf-booth-state" data-part="state" data-state={view.state}>{stateLine(say, view)}</p>
      {view.answer && drawnOnSoftware(view.answer) && <p className="pf-booth-warn" data-part="software">{say('booth.software')}</p>}
      <div className="pf-booth-body" key={p.replay}>
        {it.kind === 'audio' && <AudioCard lang={lang} say={say} view={view} volume={p.volume} onVolume={p.onVolume} onPlayed={p.onPlayed} control={p.audioControl} />}
        {it.kind === 'picture' && (pictureBlocked
          ? <p className="pf-booth-warn" role="status" data-part="needs-gpu">{say('booth.needsGpu')}</p>
          : <BoothPicture lang={lang} view={view} browserGpu={p.browserGpu} guard={p.guard} reducedMotion={p.reducedMotion} onExtras={p.onExtras} />)}
        {it.kind === 'task' && <MicCard lang={lang} view={view} onMeasured={() => undefined} />}
      </div>
      {p.names > 0 && <p className="pf-booth-warn" role="alert" data-part="name-warning">{say('page.names', { n: p.names })}</p>}
      <div className="pf-booth-answers" role="group" aria-label={say('booth.title')}>
        {(['ok', 'bad', 'skip'] as const).map((v) => (
          <Button key={v} variant={v === 'ok' ? 'primary' : 'secondary'} data-testid={TID.answer} data-verdict={v} aria-pressed={view.answer?.verdict === v && view.state === 'answered'}
            disabledReason={pictureBlocked && v !== 'skip' ? say('booth.needsGpu') : undefined} onClick={() => p.onAnswer(v)}>{say(`booth.answer.${v}`)}</Button>
        ))}
        <Button variant="ghost" data-testid={TID.again} onClick={p.onAgain}>{say('booth.again')}</Button>
      </div>
      <p className="pf-booth-note" data-part="keys">{say('booth.keys')} · {say('page.focusHint')}</p>
      {bad && (
        <form className="pf-booth-problems" onSubmit={(e) => { e.preventDefault(); p.onSubmitBad(); }}>
          <fieldset>
            <legend>{say('booth.problemsHeading')}</legend>
            {it.problems.map((id) => (
              <label key={id} className="pf-booth-problem" data-testid={TID.problem} data-problem={id}>
                <input type="checkbox" checked={bad.problems.includes(id)} disabled={atMax && !bad.problems.includes(id)} onChange={() => toggle(id)} />
                <span>{say(`booth.problem.${id}`)}</span>
              </label>
            ))}
          </fieldset>
          <label className="pf-booth-notefield">
            <span>{say('booth.note')}</span>
            <textarea data-testid={TID.note} dir="auto" rows={3} maxLength={280} value={bad.note} onChange={(e) => p.onBad({ ...bad, note: e.target.value })} />
          </label>
          <div className="pf-booth-actions">
            <Button type="submit" variant="primary">{say('page.save')}</Button>
            <Button variant="ghost" onClick={p.onCancelBad}>{say('page.cancelProblems')}</Button>
          </div>
        </form>
      )}
    </section>
  );
});
