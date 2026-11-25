/**
 * «סימון הרגע» and «אל הפעימה» in the clip's Beat tab (wave 7 musicfit track, builder C). «סימון הרגע» marks the source time the
 * playhead shows (set_clip_impact; one undo); the line «הרגע 4 פריימים אחרי הפעימה» is core planImpact, the same function the
 * operation uses; «אל הפעימה» / «אל תחילת התיבה» (with earlier / later) commit sync_impact and then state the offset BEFORE and the
 * residual AFTER; musicfit.uncalibrated says the screen and speaker delay is not calibrated; musicfit.impactKept says a marked clip
 * is kept on regeneration. Never the word «מסונכרן». B / Alt+B (musicFit.commands.ts) do the same as the two buttons.
 */
import { useState } from 'react';
import { findClip, type Clip, type SyncImpactOutput } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import { useEditorState } from '../store.ts';
import { MUSICFIT_TESTIDS as ID } from './musicFit.testids.ts';
import { musicFitT } from './musicFit.strings.ts';
import { afterSyncText, impactView, markOp, momentAtPlayhead, syncOp } from './musicFit.logic.ts';
import './musicFit.css';

export function ImpactControls({ clip: given }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = musicFitT(lang);
  const doc = state.doc;
  const clip = (doc && (findClip(doc, given.id)?.clip as Extract<Clip, { type: 'media' }> | undefined)) || given;
  const [to, setTo] = useState<'beat' | 'bar'>('beat');
  const [said, setSaid] = useState('');
  if (!doc) return null;
  const view = impactView(doc, clip, lang, t, to);
  if (view.kind === 'cannot') return <p className="mf-muted mf-impact" data-testid={ID.impact} data-state="cannot">{t('impactNoHold')}</p>;
  const locked = !!findClip(doc, clip.id)?.track.locked;
  const here = momentAtPlayhead(doc, clip.id, editor.playhead);

  const mark = async () => {
    const m = momentAtPlayhead(editor.doc!, clip.id, editor.playhead);
    if (!m) { setSaid(t('impactNeedsPlayhead')); return; }
    setSaid('');
    const r = await editor.commit([markOp(clip.id, m)], 'Mark the moment');
    if (r) setSaid(t('cmdMarked'));
  };
  const clear = async () => { setSaid(''); await editor.commit([markOp(clip.id, null)], 'Clear the mark'); };
  const sync = async (target: 'beat' | 'bar', pick?: 'earlier' | 'later') => {
    setTo(target); setSaid('');
    const r = await editor.commit([syncOp(clip.id, target, pick)], 'Moment to the beat');
    const out = r?.results[0]?.output as SyncImpactOutput | undefined;
    if (out) setSaid(`${afterSyncText(t, out)}. ${t('impactMoved', { frames: Math.abs(out.offsetBefore.frames) })}`);
  };
  const marked = view.kind === 'marked';
  const plan = marked ? view.plan : null;

  return (
    <div className="mf-impact fields" data-testid={ID.impact} data-state={marked ? (view.onBeat ? 'on-beat' : 'marked') : 'unmarked'} role="group" aria-label={t('impactTitle')}>
      <h4 className="mf-h">{t('impactTitle')}</h4>
      <div className="row">
        <Button size="sm" data-testid={ID.markImpact} disabledReason={locked ? undefined : here ? undefined : t('impactNeedsPlayhead')} onClick={() => void mark()}>{t('markImpact')}</Button>
        {marked && <Button size="sm" variant="ghost" data-testid={ID.clearImpact} onClick={() => void clear()}>{t('clearImpact')}</Button>}
      </div>
      {!marked && <p className="mf-muted">{t('impactNone')}</p>}
      {marked && (
        <>
          <p className="mf-muted">{t('impactMarkedAt', { seconds: (Math.round(view.momentSeconds * 1000) / 1000).toString() })}</p>
          <p className="mf-line" role="status" data-testid={ID.impactOffset}>{view.line ?? view.refusal}</p>
          {plan && <p className="mf-muted">{t('impactPreview', { frames: plan.frames, ms: plan.ms, target: t(to === 'bar' ? 'impactTargetBar' : 'impactTargetBeat') })}</p>}
          <div className="row">
            <Button size="sm" variant="ghost" data-testid={ID.toBeat} disabled={locked} keys={['B']} onClick={() => void sync('beat')}>{t('toBeat')}</Button>
            <Button size="sm" variant="ghost" data-testid={ID.toBar} disabled={locked} keys={['Alt', 'B']} onClick={() => void sync('bar')}>{t('toBar')}</Button>
          </div>
          <div className="row mf-lr">
            <Button size="sm" variant="ghost" data-testid={ID.earlier} disabled={locked} onClick={() => void sync(to, 'earlier')}>{t('earlier')}</Button>
            <Button size="sm" variant="ghost" data-testid={ID.later} disabled={locked} onClick={() => void sync(to, 'later')}>{t('later')}</Button>
          </div>
        </>
      )}
      <p className="mf-line" role="status" aria-live="polite">{said}</p>
      <p className="mf-muted">{t('uncalibrated')} · {t('impactKept')}</p>
    </div>
  );
}
