/**
 * «התאמה לאורך» in the Sound tab of a music clip (wave 7 musicfit track, builder C), under «סיום המוזיקה עם התמונה»: the plan inline
 * (api.musicFitPlan) BEFORE anything is applied — what will be made, how it ends in words (with «סיום אחר»), for a song the join row
 * with its measured sentence, «השמעת החיבור» (aria-pressed) and «חיבור אחר», the notes of the plan, then «בצעו» (api.musicFitApply
 * with the plan's revision; one undo). On a shortened song's clip: the chip «חיבור אוטומטי — עוד לא הושמע» and «שמעתי — החיבור בסדר»
 * (api.markJoinHeard; the owner's session only: for any other credential the server's refusal is shown in words, the control stays).
 * Built-in tracks keep MUSIC_UNHEARD_LABEL. A 501 shows musicfit.notBuilt. data-state: idle | planning | plan | refused | not-built.
 * Nothing here says an ending or a join sounds good; nobody has listened.
 */
import { useEffect, useRef, useState } from 'react';
import { findClip, type JoinRemoval, type MediaClip, type MusicFitPlan } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { MUSICFIT_TESTIDS as ID } from './musicFit.testids.ts';
import { musicFitT } from './musicFit.strings.ts';
import { auditionRemoval, chipFor, chosenCandidate, endingText, fitFailure, fitRequest, isFittableMusicClip, joinOffText, joinSentence, joinState, makeText, nextRemoval, noteText, type BlockState, type Failure, type JoinState } from './musicFit.logic.ts';
import * as T from '@pulseframe/time';
import { useJoinAudition } from './useJoinAudition.ts';
import { SwapMusicButton } from './SwapMusicDialog.tsx';
import './musicFit.css';

const secText = (x: T.RationalTime) => (Math.round(T.toSeconds(x) * 100) / 100).toString();
/** True once builder C has built the editor surfaces (the block, the dialog, the impact controls and tick, the commands). */
export const MUSICFIT_UI_BUILT = true;

export function MusicFitBlock({ clip: given }: { clip: Extract<import('@pulseframe/core').Clip, { type: 'media' }> }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = musicFitT(lang);
  const doc = state.doc;
  const clip = (doc && (findClip(doc, given.id)?.clip as MediaClip | undefined)) || given;
  const [tailor, setTailor] = useState(true);
  const [removal, setRemoval] = useState<JoinRemoval | undefined>(undefined);
  const [phase, setPhase] = useState<BlockState>('idle');
  const [plan, setPlan] = useState<MusicFitPlan | null>(null);
  const [fail, setFail] = useState<Failure | null>(null);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const audition = useJoinAudition(doc?.id ?? '');
  useEffect(() => { setPhase('idle'); setPlan(null); setFail(null); setSaid(''); setRemoval(undefined); setTailor(true); audition.stop(); }, [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc || !isFittableMusicClip(doc, clip)) return null;
  const asset = doc.assets[clip.assetId];
  const chip = chipFor(lang, t, asset);
  const join = joinState(asset);

  const run = async (nextTailor: boolean, nextRemoval?: JoinRemoval) => {
    const mine = ++seq.current;
    audition.stop(); setPhase('planning'); setFail(null); setSaid('');
    try {
      const p = await api.musicFitPlan(doc.id, fitRequest(clip.id, nextTailor, nextRemoval));
      if (mine !== seq.current) return;
      setPlan(p); setTailor(nextTailor); setRemoval(nextRemoval); setPhase('plan');
    } catch (e) {
      if (mine !== seq.current) return;
      const f = fitFailure(lang, e);
      setPlan(null); setFail(f); setPhase(f.kind === 'not-built' ? 'not-built' : 'refused');
    }
  };
  const cancel = () => { seq.current++; audition.stop(); setPhase('idle'); setPlan(null); setFail(null); };
  const apply = async () => {
    if (!plan) return;
    setBusy(true); setSaid(t('applying'));
    try {
      const r = await api.musicFitApply(doc.id, { ...fitRequest(clip.id, tailor, removal), expectedRevision: plan.revision });
      await editor.load(doc.id);
      editor.notify({ kind: 'undo', title: t('applied'), undoes: r.transactionId });
      setSaid(t('applied')); setPhase('idle'); setPlan(null);
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'fit_stale')) { await editor.load(doc.id).catch(() => undefined); setSaid(t('staleReload')); void run(tailor, removal); return; }
      const f = fitFailure(lang, e);
      setFail(f); setPhase(f.kind === 'not-built' ? 'not-built' : 'refused'); setSaid('');
    } finally { setBusy(false); }
  };

  const cand = plan ? chosenCandidate(plan) : null;
  const other = plan ? nextRemoval(plan) : null;
  const blocked = !!plan && plan.blocking.length > 0;
  const planAudition = plan && plan.make.kind === 'fitted' && cand ? { assetId: plan.make.sourceAssetId, removal: cand.candidate.removal } : null;

  return (
    <div className="mf-block" data-testid={ID.block} data-state={phase} role="group" aria-label={t('fit')}>
      {chip && <p className={`mf-chip is-${chip.kind}`} data-testid={chip.kind === 'unheard-builtin' ? undefined : ID.unheardChip} data-heard={chip.kind === 'heard-join' ? 'true' : 'false'}><bdi>{chip.text}</bdi></p>}
      {join && <JoinHeard join={join} assetId={clip.assetId} audition={audition} />}
      <div className="row">
        <Button size="sm" data-testid={ID.fit} busy={phase === 'planning'} onClick={() => void run(true)}>{t('fit')}</Button>
        <SwapMusicButton host={{ kind: 'clip', clipId: clip.id }} />
      </div>
      <div role="status" aria-live="polite" className="mf-status">{phase === 'planning' ? t('planning') : said}</div>
      {phase === 'not-built' && fail && <p className="mf-note is-info" data-testid={`${ID.block}-notbuilt`}>{t('notBuilt')}</p>}
      {phase === 'refused' && fail && <p className="mf-note is-refused" role="alert"><bdi>{fail.text}</bdi></p>}
      {phase === 'plan' && plan && (
        <div className="mf-plan" data-testid={`${ID.block}-plan`}>
          <p className="mf-line">{makeText(t, plan)}</p>
          <p className="mf-line" data-testid={ID.ending} data-ending={plan.ending.kind}>{endingText(t, plan)}</p>
          <div className="row">
            <Button size="sm" variant="ghost" data-testid={ID.otherEnding} title={t('otherEndingHint')} onClick={() => void run(!tailor)}>{t('otherEnding')}</Button>
          </div>
          {cand && (
            <div className="mf-join" data-testid={ID.join} data-index={cand.index}>
              <p className="mf-line"><bdi>{t('joinRow', { n: cand.index + 1, m: cand.count })}</bdi> · {t('joinRemoves', { from: secText(cand.candidate.removal.from), to: secText(cand.candidate.removal.to) })}</p>
              <p className="mf-line" data-testid={ID.joinMeasured}><bdi>{joinSentence(lang, cand.candidate)}</bdi></p>
              <p className="mf-line mf-muted">{joinOffText(t, cand.candidate)} · {t('unheard')}</p>
              <div className="row">
                <Button size="sm" variant="ghost" data-testid={ID.playJoin} aria-pressed={audition.playing} disabled={!planAudition} onClick={() => planAudition && void audition.toggle(planAudition)}>{t('playJoin')}</Button>
                <Button size="sm" variant="ghost" data-testid={ID.otherJoin} disabledReason={other ? undefined : t('nextOtherJoin')} onClick={() => other && void run(tailor, other)}>{t('otherJoin')}</Button>
              </div>
              {audition.playing && <p className="mf-muted" role="status">{t('playingJoin')}</p>}
              {audition.failed && <p className="mf-note is-refused" role="alert">{t('joinPlayFailed')}</p>}
            </div>
          )}
          {plan.blocking.length > 0 && (
            <div className="mf-notes is-blocking" role="alert"><b>{t('blockingLead')}</b><ul>{plan.blocking.map((n, i) => <li key={i}><bdi>{noteText(lang, t, n)}</bdi></li>)}</ul></div>
          )}
          {plan.warnings.length > 0 && (
            <div className="mf-notes"><b>{t('warningsLead')}</b><ul>{plan.warnings.map((n, i) => <li key={i} data-code={n.code}><bdi>{noteText(lang, t, n)}</bdi></li>)}</ul></div>
          )}
          {plan.basis.length > 0 && (
            <details className="mf-basis"><summary>{t('rests')}{lang === 'he' ? ` (${t('basisLang')})` : ''}</summary><ul dir="ltr">{plan.basis.map((b, i) => <li key={i}>{b}</li>)}</ul></details>
          )}
          <div className="row">
            <Button size="sm" variant="primary" data-testid={ID.apply} busy={busy} disabledReason={blocked ? noteText(lang, t, plan.blocking[0]!) : undefined} onClick={() => void apply()}>{t('apply')}</Button>
            <Button size="sm" variant="ghost" data-testid={ID.cancel} onClick={cancel}>{t('cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The owner's «שמעתי — החיבור בסדר» on a shortened song's clip, with the join audition. Every credential sees the control; the server decides. */
function JoinHeard({ join, assetId, audition }: { join: JoinState; assetId: string; audition: ReturnType<typeof useJoinAudition> }) {
  const { editor, state } = useEditorState();
  const t = musicFitT(state.lang);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const doc = state.doc!;
  if (join.heard) return null;
  const spec = { assetId: join.sourceAssetId, ...auditionRemoval(join) };
  const mark = async () => {
    setErr(null);
    try { await api.markJoinHeard(doc.id, assetId, true); await editor.load(doc.id); setOk(true); }
    catch (e) { setErr(fitFailure(state.lang, e).text); }
  };
  return (
    <div className="mf-heard">
      <div className="row">
        <Button size="sm" variant="ghost" data-testid={ID.playJoin} aria-pressed={audition.playing} onClick={() => void audition.toggle(spec)}>{t('playJoin')}</Button>
        <Button size="sm" data-testid={ID.heard} disabledReason={audition.played ? undefined : t('heardNeedsPlay')} onClick={() => void mark()}>{t('heard')}</Button>
      </div>
      {audition.playing && <p className="mf-muted" role="status">{t('playingJoin')}</p>}
      {audition.failed && <p className="mf-note is-refused" role="alert">{t('joinPlayFailed')}</p>}
      {err && <p className="mf-note is-refused" role="alert" data-testid={`${ID.heard}-refused`}><bdi>{err}</bdi></p>}
      {ok && <p className="mf-muted" role="status">{t('heardSaved')}</p>}
    </div>
  );
}
