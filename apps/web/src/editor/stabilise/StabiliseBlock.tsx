/**
 * The «ייצוב תמונה» block of the object inspector (wave 7 stabilise track). Thin: what it shows is stabilise.logic.ts over the
 * document. States (data-state of the panel): not-measured (the button), measuring (progress and «עצירה»), on, off, limited,
 * refused (the refusal in words, through translateRefusal), not-offered (stills and multicam segments, with the reason).
 * The strength slider previews through editor.previewStabilise and commits ONCE on release; nothing is called steady or good.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { findClip, STABILISE_JOB_TYPE, type MediaClip } from '@pulseframe/core';
import { jobStageLabel } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { refusalText } from '../TrackingPanel.tsx';
import { useEditorState } from '../store.ts';
import {
  dependsOnOf, FALLBACK_POLL_MS, forgetRun, jumpFrameIn, needsFallbackRead, OPEN_JOB, panelState, percentText, previewPlan, previewValue, rememberRun, rememberedRun, rememberStrength, removeOp, settledOf, sliderKey, stabiliseProgress,
  stabiliseView, strengthOp, strengthToUse, switchOffOp, switchOnOp, zoomText,
} from './stabilise.logic.ts';
import { stabiliseT } from './stabilise.strings.ts';
import { STABILISE_TESTIDS as ID } from './stabilise.testids.ts';
import '../tracking.css';
import './stabilise.css';

/** True once W3 has built the block (InspectorObject.tsx mounts the section only then). */
export const STABILISE_UI_BUILT = true;

const POLL_MS = 400;

export function StabiliseBlock({ clip: given }: { clip: MediaClip }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const t = stabiliseT(lang);
  const doc = state.doc;
  // the clip as the document has it now (the selection's copy can be one revision behind)
  const clip = (doc && (findClip(doc, given.id)?.clip as MediaClip | undefined)) || given;
  const view = useMemo(() => (doc ? stabiliseView(doc, clip) : null), [doc, clip]);
  const [err, setErr] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const [lowered, setLowered] = useState<{ strength: number; maxCrop: number } | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const liveRef = useRef<number | null>(null);
  const frame = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; cancelAnimationFrame(frame.current); }; }, []);

  // follow the run of this clip (started here or by the command) until it ends
  const [watched, setWatched] = useState<string | undefined>(() => rememberedRun(clip.id));
  useEffect(() => {
    const id = setInterval(() => { const r = rememberedRun(clip.id); if (r !== watched) setWatched(r); }, POLL_MS);
    return () => clearInterval(id);
  }, [clip.id, watched]);
  // the run's events come through the store's event stream (Editor.onJobEvent); the block reads the job from it
  const job = watched ? (state.stabiliseJobs[watched] ?? null) : null;
  useEffect(() => {
    if (!watched || !job) return;
    const s = settledOf(job);
    if (s.kind === 'open') return;
    forgetRun(clip.id);
    setWatched(undefined);
    if (s.kind === 'done') {
      if (s.strengthLowered) setLowered({ strength: editor.doc ? ((findClip(editor.doc, clip.id)?.clip as MediaClip | undefined)?.stabilise?.strength ?? 0) : 0, maxCrop: 15 });
      setSaid(t('job.done'));
    } else if (s.kind === 'canceled') setSaid(t('job.canceled'));
    else setErr(`${t('job.failed')}: ${refusalText(lang, new ApiFailure(0, s.code, s.message))}`);
  }, [watched, job]); // eslint-disable-line react-hooks/exhaustive-deps
  // one slow fallback read, only while the stream is not connected (or has said nothing of this run): its answer goes the same way an event does
  useEffect(() => {
    if (!watched) return;
    let stop = false;
    const id = setInterval(async () => {
      if (!needsFallbackRead(editor.streamOpen, editor.getState().stabiliseJobs[watched])) return;
      try {
        const j = await api.job(watched);
        if (!stop && alive.current) editor.onJobEvent({ id: j.id, type: STABILISE_JOB_TYPE, status: j.status, stage: j.stage ?? null, error: j.error ?? null, output: j.output ?? null });
      } catch (e) { if (!stop && alive.current) { forgetRun(clip.id); setWatched(undefined); setErr(refusalText(lang, e)); } }
    }, FALLBACK_POLL_MS);
    return () => { stop = true; clearInterval(id); };
  }, [watched, clip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!doc || !view) return null;
  const locked = !!findClip(doc, clip.id)?.track.locked;
  const measuring = !!watched && (!job || OPEN_JOB.has(job.status));
  const panel = panelState(view, { measuring, refused: !!err });
  const progress = stabiliseProgress(job?.stage);
  const stage = jobStageLabel(job?.stage, lang) || t('job.queued');

  const run = async () => {
    setErr(null); setSaid(''); setLowered(null);
    try {
      const mem = view.stored?.strength;
      const r = await api.stabiliseClip(doc.id, clip.id, mem ? { strength: mem } : {});
      rememberRun(clip.id, r.jobId);
      setWatched(r.jobId);
    } catch (e) { setErr(refusalText(lang, e)); }
  };
  const stop = () => { const id = watched; if (id) api.cancelJob(id).catch((e) => setErr(refusalText(lang, e))); };

  /** One commit; its refusal is shown in place. */
  const commit = async (op: ReturnType<typeof switchOnOp>, label: string, announce: string): Promise<boolean> => {
    setErr(null); setSaid(''); setLowered(null);
    const r = await editor.commit([op], label, { dependsOn: dependsOnOf(clip.assetId) });
    if (!alive.current) return !!r;
    if (!r) { setErr(t('job.failed')); return false; }
    const out = r.results[0]?.output as { strengthLowered?: boolean; stabilise?: { strength: number } | null } | undefined;
    if (out?.strengthLowered && out.stabilise) setLowered({ strength: out.stabilise.strength, maxCrop: 15 });
    setSaid(announce);
    return true;
  };
  const toggle = async () => {
    if (view.kind === 'on') { rememberStrength(clip.id, clip.stabilise!.strength); await commit(switchOffOp(clip), 'Stabilise', t('switchedOff')); }
    else if (view.switchable) await commit(switchOnOp(clip), 'Stabilise', t('switchedOn'));
  };
  const recalc = () => void commit(strengthOp(clip, clip.stabilise!.strength), 'Stabilise', t('switchedOn'));
  const remove = () => void commit(removeOp(doc, clip), 'Remove camera motion', t('removed'));

  // the slider: the preview moves with it, one commit on release
  const move = (v: number) => {
    liveRef.current = v; setLive(v);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => { frame.current = 0; const x = liveRef.current; if (x !== null) editor.previewStabilise(clip.id, previewValue(previewPlan(doc, clip, x))); });
  };
  const release = async () => {
    const v = liveRef.current;
    if (v === null) return;
    liveRef.current = null;
    cancelAnimationFrame(frame.current); frame.current = 0;
    if (clip.stabilise && v !== clip.stabilise.strength) { rememberStrength(clip.id, v); await commit(strengthOp(clip, v), 'Stabilise', t('strengthValue', { n: v })); }
    editor.previewStabilise(clip.id, null);
    if (alive.current) setLive(null);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const v = sliderKey(e.key, live ?? clip.stabilise?.strength ?? 50);
    if (v !== null) { e.preventDefault(); move(v); }
  };
  const jump = (from: number, to: number) => {
    const f = jumpFrameIn(doc, clip, from, to);
    if (f === null) setErr(t('report.jumpNone')); else { setErr(null); editor.seek(f); }
  };

  const shown = view.kind === 'on' ? (live !== null ? previewPlan(doc, clip, live) : view.plan) : null;
  const value = live ?? clip.stabilise?.strength ?? strengthToUse(clip);
  const m = view.measured;
  return (
    <div className="fields stab" data-testid={ID.panel} data-state={panel} data-clip-id={clip.id}>
      {(view.kind === 'still' || view.kind === 'multicam') ? <p className="muted">{t(view.kind === 'still' ? 'notOffered.still' : 'notOffered.multicam')}</p> : (
        <>
          {measuring ? (
            <div className="row" style={{ alignItems: 'center' }}>
              <div className="mtrack-bar" role="progressbar" aria-label={t('progress')} aria-valuemin={0} aria-valuemax={100} {...(progress.percent !== null ? { 'aria-valuenow': progress.percent } : {})} aria-valuetext={stage} data-indeterminate={progress.percent === null || undefined}>
                <span style={{ inlineSize: `${progress.percent ?? 30}%` }} />
              </div>
              <span className="muted"><bdi>{stage}</bdi></span>
              <button type="button" className="ghost danger" data-testid={ID.stop} disabled={job?.status === 'cancel-requested'} onClick={stop}>{t('stop')}</button>
            </div>
          ) : view.kind === 'not-measured' ? (
            <div className="fields">
              <p className="muted">{t('notMeasuredYet')}</p>
              <div className="row"><button type="button" className="primary" data-testid={ID.run} disabled={locked} onClick={() => void run()}>{t('run')}</button></div>
            </div>
          ) : (
            <>
              <div className="row stab-switch">
                <button type="button" role="switch" aria-checked={view.kind === 'on'} className="ghost" data-testid={ID.toggle} disabled={locked || (view.kind === 'off' && !view.switchable)} onClick={() => void toggle()}>{t('toggle')}</button>
              </div>
              <label className="stab-strength">
                <span>{t('strength')} <bdi dir="ltr" aria-hidden="true">{value}</bdi></span>
                <input type="range" min={1} max={100} step={1} value={value} disabled={locked || view.kind !== 'on'} data-testid={ID.strength} aria-valuetext={t('strengthValue', { n: value })}
                  onChange={(e) => move(Number(e.target.value))} onKeyDown={onKey} onPointerUp={() => void release()} onKeyUp={(e) => { if (sliderKey(e.key, 1) !== null || e.key.startsWith('Arrow')) void release(); }} onBlur={() => void release()} />
              </label>
              {shown && (
                <p className="stab-crop" data-testid={ID.crop} data-zoom-pm={shown.zoomPm} data-area-percent={shown.areaPercent}>
                  {t('crop', { percent: percentText(shown.areaPercent), zoom: zoomText(shown.zoomPm) })}
                </p>
              )}
              {lowered && <p className="stab-note">{t('lowered', lowered)}</p>}
              <div className="row">
                {view.kind === 'on' && view.limited.clip && <button type="button" className="ghost" data-testid={ID.recalc} disabled={locked} onClick={recalc}>{t('recalc')}</button>}
                <button type="button" className="ghost" data-testid={ID.run} disabled={locked} onClick={() => void run()}>{t('run')}</button>
                <button type="button" className="ghost danger" data-testid={ID.remove} disabled={locked} onClick={remove}>{t('remove')}</button>
              </div>
            </>
          )}
          {m && view.kind !== 'not-measured' && (
            <div className="stab-report" data-testid={ID.report} data-ok={m.ok} data-weak={m.weak} data-unknown={m.unknown} data-outside={m.outside}>
              <p className="muted">{t('measured', { n: m.ok + m.weak, total: m.frames })}</p>
              {m.unknown + m.outside > 0 && <p className="stab-note">{t('notMeasured', { n: m.unknown + m.outside })}</p>}
              {m.weak > 0 && <p className="stab-note">{t('weak', { n: m.weak })}</p>}
              {view.kind === 'on' && view.limited.clip && <p className="stab-note">{t('limitedClip')}</p>}
              {view.kind === 'on' && view.limited.reach && <p className="stab-note">{t('limitedReach')}</p>}
              {view.weakerNearEdges && <p className="stab-note">{t('edges')}</p>}
              {view.sped && <p className="muted">{t('speedHint')}</p>}
              <strong className="muted">{t('report')}</strong>
              {view.report.length === 0 ? <p className="muted">{t('report.none')}</p> : (
                <ul className="mtrack-problems" aria-label={t('report')}>
                  {view.report.map((r) => (
                    <li key={`${r.kind}:${r.from}`} data-kind={r.kind} data-from={r.from} data-to={r.to}>
                      <span>{r.kind === 'cut' ? t('cut', { frame: r.from }) : `${t(`report.${r.kind}`)} · ${t('report.frames')} `}{r.kind !== 'cut' && <bdi dir="ltr">{r.to - r.from > 1 ? `${r.from}–${r.to - 1}` : r.from}</bdi>}</span>
                      <button type="button" className="ghost" aria-label={`${t('report.jump')}: ${r.from}`} onClick={() => jump(r.from, r.to)}>{t('report.jump')}</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="muted stab-standing">{t('noModel')}</p>
          <p className="muted stab-standing">{t('notCorrected')}</p>
          <p className="muted stab-standing">{t('synthetic')}</p>
        </>
      )}
      <p className={`tracking-msg${err ? ' danger' : ''}`} role={err ? 'alert' : 'status'} aria-live="polite" data-testid={ID.status} data-status={job?.status}>{err ?? said}</p>
    </div>
  );
}
