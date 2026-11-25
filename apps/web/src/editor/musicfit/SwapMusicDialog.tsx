/**
 * «מוזיקה אחרת» (wave 7 musicfit track, builder C): a button (MUSICFIT_TESTIDS.swap, data-host = clip | film | template) opening a modal
 * (ds Dialog: focus trapped, Escape closes, focus returns to the button) that lists the built-in styles and the project's songs with
 * measured beats, a tick «להתאים גם את האורך», and the "what changes" table from the plan (cuts before → after, shortest gap, cuts
 * left out for the flash rule, clips kept by hand, clips laid out again, template slots blocked by name, marked moments that move off
 * the beat, volume keys dropped). The plan is asked for BEFORE anything is applied; «בצעו» applies it (one undo). A 501 shows the
 * honest "not built" state; a licence or other refusal shows its reason and next step. Mounted in FilmBar, TemplatesDrawer's applied
 * bar and MusicFitBlock.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { findClip, type MusicFitPlan } from '@pulseframe/core';
import { Button, Dialog } from '../../ds/index.ts';
import { api, ApiFailure } from '../../api.ts';
import { useEditorState } from '../store.ts';
import { MUSICFIT_TESTIDS as ID } from './musicFit.testids.ts';
import { musicFitT } from './musicFit.strings.ts';
import { endingText, fitFailure, makeText, noteText, realignCount, realignOps, swapRequest, swapRows, TABLE_CODES, whatChanges, type Failure, type SwapHost, type SwapRow } from './musicFit.logic.ts';
import './musicFit.css';

export type { SwapHost } from './musicFit.logic.ts';

export function SwapMusicButton({ host }: { host: SwapHost }) {
  const { state } = useEditorState();
  const t = musicFitT(state.lang);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={btn} size="sm" variant="ghost" data-testid={ID.swap} data-host={host.kind} aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('swap')}</Button>
      {open && <SwapDialog host={host} onClose={() => setOpen(false)} />}
    </>
  );
}

function SwapDialog({ host, onClose }: { host: SwapHost; onClose: () => void }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = musicFitT(lang);
  const doc = state.doc!;
  const currentAsset = host.kind === 'clip' ? (findClip(doc, host.clipId)?.clip as { assetId?: string } | undefined)?.assetId : undefined;
  const rows = useMemo(() => swapRows(doc, lang, t, currentAsset), [doc, lang, currentAsset]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<SwapRow | null>(null);
  const [tailor, setTailor] = useState(host.kind === 'clip');
  const [recut, setRecut] = useState(true);
  const [plan, setPlan] = useState<MusicFitPlan | null>(null);
  const [fail, setFail] = useState<Failure | null>(null);
  const [planning, setPlanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ clipIds: string[] } | null>(null);
  const [realigned, setRealigned] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!picked) return;
    const mine = ++seq.current;
    setPlanning(true); setFail(null); setPlan(null);
    api.musicFitPlan(doc.id, swapRequest(host, picked.choice, tailor, recut))
      .then((p) => { if (mine === seq.current) setPlan(p); })
      .catch((e) => { if (mine === seq.current) setFail(fitFailure(lang, e)); })
      .finally(() => { if (mine === seq.current) setPlanning(false); });
  }, [picked, tailor, recut]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = async () => {
    if (!picked || !plan) return;
    setBusy(true);
    try {
      const r = await api.musicFitApply(doc.id, { ...swapRequest(host, picked.choice, tailor, recut), expectedRevision: plan.revision });
      await editor.load(doc.id);
      editor.notify({ kind: 'undo', title: t('swapDone'), undoes: r.transactionId });
      const off = r.plan.impacts.filter((i) => i.framesFromBeatAfter !== null && i.framesFromBeatAfter !== 0).map((i) => i.clipId);
      if (off.length) setDone({ clipIds: off }); else onClose();
    } catch (e) {
      if (e instanceof ApiFailure && (e.code === 'stale_revision' || e.code === 'fit_stale')) { await editor.load(doc.id).catch(() => undefined); setPlan(null); setPicked({ ...picked }); setFail({ kind: 'refused', code: e.code, text: t('staleReload') }); }
      else setFail(fitFailure(lang, e));
    } finally { setBusy(false); }
  };

  const realign = async () => {
    const ops = realignOps(editor.doc!, done?.clipIds ?? []);
    if (!ops.length) { setRealigned(t('swapWhatNothing')); return; }
    const r = await editor.commit(ops, 'Align moments to the beat');
    if (r) { setRealigned(t('impactRealigned')); editor.notify({ kind: 'undo', title: t('impactRealigned'), ...(r.transactionId ? { undoes: r.transactionId } : {}) }); setDone(null); setTimeout(onClose, 0); }
  };
  const blocked = !!plan && plan.blocking.length > 0;
  const forText = host.kind === 'clip' ? t('swapForClip') : host.kind === 'film' ? t('swapForFilm') : t('swapForTemplate');
  const sections: [string, SwapRow[]][] = [[t('swapBuiltin'), rows.filter((r) => r.kind === 'builtin')], [t('swapSongs'), rows.filter((r) => r.kind === 'song')]];
  return (
    <Dialog open onClose={onClose} title={t('swap')} size="lg" closeLabel={t('close')} testId={ID.swapDialog}
      footer={done ? <>
        <Button variant="primary" data-testid={ID.realign} onClick={() => void realign()}>{t('realign', { n: realignCount({ impacts: plan?.impacts.filter((i) => done.clipIds.includes(i.clipId)) ?? [] }) || done.clipIds.length })}</Button>
        <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
      </> : <>
        <Button variant="primary" data-testid={ID.swapApply} busy={busy} disabledReason={!picked ? t('swapPick') : !plan ? (planning ? t('planning') : fail?.text ?? t('swapPick')) : blocked ? noteText(lang, t, plan.blocking[0]!) : undefined} onClick={() => void apply()}>{t('apply')}</Button>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
      </>}>
      {done && <p className="mf-line" role="status">{t('swapDone')} {t('offBeat', { n: done.clipIds.length })}</p>}
      {realigned && <p className="mf-muted" role="status">{realigned}</p>}
      <p className="mf-muted">{forText}</p>
      {sections.map(([title, list], i) => (
        <section key={i} className="mf-swap-sec">
          <h3 className="mf-h">{title}</h3>
          {list.length === 0 && i === 1 && <p className="mf-muted">{t('swapNoSongs')}</p>}
          <ul className="mf-swap-list" role="listbox" aria-label={`${t('swapListLabel')}: ${title}`}>
            {list.map((r) => (
              <li key={r.id} role="presentation">
                <button type="button" role="option" aria-selected={picked?.id === r.id} className={`mf-swap-row${picked?.id === r.id ? ' is-on' : ''}`} data-testid={ID.swapRow}
                  {...(r.assetId ? { 'data-asset-id': r.assetId } : { 'data-style-id': r.styleId })} onClick={() => setPicked(r)}>
                  <b dir="auto">{r.name}</b>
                  <span className="mf-muted">{r.sub}</span>
                  {picked?.id === r.id && <span className="mf-picked">{t('swapPicked')}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <label className="mf-check"><input type="checkbox" data-testid={ID.swapTailor} checked={tailor} onChange={(e) => setTailor(e.target.checked)} /> {t('alsoLength')}</label>
      {host.kind !== 'clip' && <label className="mf-check"><input type="checkbox" checked={recut} onChange={(e) => setRecut(e.target.checked)} /> {t('swapRecut')}</label>}
      <div role="status" aria-live="polite" className="mf-status">{planning ? t('planning') : ''}</div>
      {fail && fail.kind === 'not-built' && <p className="mf-note is-info" data-testid={`${ID.swapDialog}-notbuilt`}>{t('notBuilt')}</p>}
      {fail && fail.kind === 'refused' && <p className="mf-note is-refused" role="alert"><bdi>{fail.text}</bdi></p>}
      {plan && (
        <div className="mf-plan" data-testid={ID.swapWhat}>
          <h3 className="mf-h">{t('what')}</h3>
          <p className="mf-line">{makeText(t, plan)}</p>
          <p className="mf-line">{endingText(t, plan)}</p>
          <ul className="mf-what">{whatChanges(t, plan).map((r) => <li key={r.key} data-row={r.key}><bdi>{r.text}</bdi></li>)}</ul>
          {plan.blocking.length > 0 && <div className="mf-notes is-blocking" role="alert"><b>{t('blockingLead')}</b><ul>{plan.blocking.map((n, i) => <li key={i}><bdi>{noteText(lang, t, n)}</bdi></li>)}</ul></div>}
          {plan.warnings.filter((n) => !TABLE_CODES.has(n.code)).length > 0 && <div className="mf-notes"><b>{t('warningsLead')}</b><ul>{plan.warnings.filter((n) => !TABLE_CODES.has(n.code)).map((n, i) => <li key={i} data-code={n.code}><bdi>{noteText(lang, t, n)}</bdi></li>)}</ul></div>}
        </div>
      )}
    </Dialog>
  );
}
