/**
 * The family film dialog (ADR-0026), on the design system's Dialog (modal, focus trapped, Escape closes, focus returns to the
 * opener), Hebrew first and right to left, three steps: (1) «מה בסרט», (2) «אורך ומוזיקה», (3) «התוכנית»: plan, measure what the
 * plan lists (JobRow, cancel), plan again, one row per pick with its measured reason, «רגע אחר» / «קליפ אחר» / «הוצאה מהסרט»,
 * «לא נכנסו (n)» with «הכנסה», warnings, the footer with the draft label, «יצירת הסרט» (api.applyFilm at the plan's revision,
 * then editor.setFilmRun and close). Refusals are worded in Hebrew next to the control that caused them.
 * Calls only: api.measureMoments, momentsData, planFilm, applyFilm, cancelJob, job, derivatives, analyzeAssetJob and the editor's
 * load/openFilm/closeFilm/setFilmRun. Logic in familyFilm.logic.ts (the state machine), strings in familyFilm.strings.ts.
 * The lead mounts it once (App.tsx).
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Film } from 'lucide-react';
import { videoFrames, type Asset, type FamilyFilmParams, type MomentsData } from '@pulseframe/core';
import { AnchoredError, Button, Dialog, JobRow, Seg } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { api } from '../api.ts';
import { useEditorState } from './store.ts';
import { MomentsStrip } from './MomentsStrip.tsx';
import { FILM_TESTIDS as TID } from './familyFilm.testids.ts';
import { familyFilmStrings } from './familyFilm.strings.ts';
import {
  beatInfo, buildParams, choicesOf, defaultChoices, filmFailure, filmFlow, formatCapture, isPictureAsset, musicChoices, nextBlocked, otherClipChoices, planRows, progressDue, reasonLine, runMeasurement, spriteStyle, spriteTileIndex,
  tooManyChosen, videoSeconds, withIncluded, withNextWindow, withOtherClip, withRemoved, MAX_FILM_ASSETS,
  type FilmChoices, type FilmFlowEffect, type FilmFlowEvent, type FilmFlowState, type FilmPlanRow,
} from './familyFilm.logic.ts';
import { FAMILY_FILM_DRAFT_LABEL } from '@pulseframe/core';
import './familyFilm.css';

export interface FamilyFilmDialogProps { lang: 'he' | 'en' }
type Step = 'what' | 'length' | 'plan';
const STEPS: Step[] = ['what', 'length', 'plan'];
const enc = encodeURIComponent;

// ---------- pictures ----------
interface ThumbMeta { columns: number; rows: number; frameIndices: number[] }
const thumbCache = new Map<string, ThumbMeta>();
/** A library file's picture: a still as it is; a video as the sprite tile nearest `frame` (the nearest one, said so in the row), a quiet placeholder until its thumbnails exist. */
function FilmThumb({ projectId, asset, frame }: { projectId: string; asset: Asset; frame: number | null }): ReactElement {
  const key = `${projectId}:${asset.id}`;
  const [meta, setMeta] = useState<ThumbMeta | null>(() => thumbCache.get(key) ?? null);
  const video = asset.kind !== 'image' && !!asset.video;
  useEffect(() => {
    if (!video || meta) return;
    let on = true;
    api.derivatives(projectId, asset.id).then((r) => {
      const row = r.derivatives.find((d) => d.kind === 'thumbnails' && d.status === 'ready');
      if (row && on) { thumbCache.set(key, row.meta as ThumbMeta); setMeta(row.meta as ThumbMeta); }
    }).catch(() => undefined);
    return () => { on = false; };
  }, [video, meta, projectId, asset.id, key]);
  if (!video) return <img className="pf-film-thumb" src={`/api/v1/projects/${enc(projectId)}/assets/${enc(asset.id)}/content`} alt="" loading="lazy" draggable={false} />;
  if (!meta) return <span className="pf-film-thumb is-empty" aria-hidden="true"><Film size={16} /></span>;
  const frames = videoFrames(asset) ?? 1;
  const index = spriteTileIndex(frame ?? Math.floor(frames / 2), frames, meta.frameIndices.length);
  return <span className="pf-film-thumb" aria-hidden="true" style={{ backgroundImage: `url(/api/v1/projects/${enc(projectId)}/assets/${enc(asset.id)}/derivatives/thumbnails)`, backgroundRepeat: 'no-repeat', ...spriteStyle(meta.columns, meta.rows, index) }} />;
}
const momentsCache = new Map<string, MomentsData | null>();
/** The per-sample series of a measured file (keyed by the record's data hash, so a new measurement is fetched again). */
function useMomentsData(projectId: string, assetId: string, hash: string | undefined): MomentsData | null {
  const key = `${projectId}:${assetId}:${hash ?? ''}`;
  const [data, setData] = useState<MomentsData | null>(() => momentsCache.get(key) ?? null);
  useEffect(() => {
    if (!hash) { setData(null); return; }
    if (momentsCache.has(key)) { setData(momentsCache.get(key) ?? null); return; }
    let on = true;
    api.momentsData(projectId, assetId).then((d) => { momentsCache.set(key, d); if (on) setData(d); }).catch(() => { if (on) setData(null); });
    return () => { on = false; };
  }, [key, projectId, assetId, hash]);
  return data;
}

/** A refusal, worded in Hebrew, next to the control that caused it. */
function FilmError({ message, blocking }: { message: string; blocking?: boolean }): ReactElement {
  return <div data-testid={TID.error} className="pf-film-error"><AnchoredError blocking={blocking}>{message}</AnchoredError></div>;
}

// ---------- one row of the plan ----------
function PlanRow({ row, lang, projectId, asset, hash, others, onWindow, onClip, onRemove }: {
  row: FilmPlanRow; lang: 'he' | 'en'; projectId: string; asset: Asset | undefined; hash: string | undefined; others: { assetId: string; name: string }[];
  onWindow: () => void; onClip: (assetId: string) => void; onRemove: () => void;
}): ReactElement {
  const S = familyFilmStrings(lang);
  const [open, setOpen] = useState(false);
  const data = useMomentsData(projectId, row.assetId, row.still ? undefined : hash);
  const win = row.windowIndex !== null && data ? data.windows[row.windowIndex] : undefined;
  const marked = row.sourceInFrame !== null && row.sourceFrames !== null ? { fromFrame: row.sourceInFrame, toFrame: row.sourceInFrame + row.sourceFrames, peakFrame: win?.peakFrame ?? row.sourceInFrame + Math.floor(row.sourceFrames / 2) } : null;
  const mid = row.sourceInFrame !== null && row.sourceFrames !== null ? row.sourceInFrame + Math.floor(row.sourceFrames / 2) : null;
  return (
    <li className="pf-film-row" data-testid={TID.planRow} data-key={row.key} data-asset-id={row.assetId}>
      {asset ? <FilmThumb projectId={projectId} asset={asset} frame={mid} /> : <span className="pf-film-thumb is-empty" aria-hidden="true" />}
      <div className="pf-film-row-main">
        <b className="pf-film-row-name">{isolate(row.name)}</b>
        <span className="pf-film-row-facts">{isolate(S.rowFacts(formatCapture(row.captureAt, lang), row.span, row.seconds))}</span>
        <span className="pf-film-reason" data-testid={TID.reason}>{isolate(reasonLine(row.reasons, lang))}</span>
        {!row.still && <MomentsStrip data={data} window={marked} />}
        {open && (
          <ul className="pf-film-choices" aria-label={S.chooseClip}>
            {others.map((o) => <li key={o.assetId}><button type="button" className="pf-film-choice" onClick={() => { setOpen(false); onClip(o.assetId); }}>{isolate(o.name)}</button></li>)}
          </ul>
        )}
      </div>
      <div className="pf-film-row-actions">
        {!row.still && <Button size="sm" data-testid={TID.swapWindow} aria-label={`${S.swapWindow}: ${row.name}`} disabledReason={row.canSwapWindow ? undefined : S.noOtherWindow} onClick={onWindow}>{S.swapWindow}</Button>}
        <Button size="sm" data-testid={TID.swapClip} aria-label={`${S.swapClip}: ${row.name}`} aria-expanded={open} disabledReason={others.length ? undefined : S.noOtherClip} onClick={() => setOpen((v) => !v)}>{S.swapClip}</Button>
        <Button size="sm" variant="ghost" data-testid={TID.remove} aria-label={`${S.remove}: ${row.name}`} onClick={onRemove}>{S.remove}</Button>
      </div>
    </li>
  );
}

export function FamilyFilmDialog({ lang }: FamilyFilmDialogProps): ReactElement | null {
  const { state } = useEditorState();
  if (!state.filmOpen || !state.doc || !state.filmSource) return null;
  return <FilmDialogBody lang={lang} />;
}

function FilmDialogBody({ lang }: FamilyFilmDialogProps): ReactElement | null {
  const { editor, state } = useEditorState();
  const S = familyFilmStrings(lang);
  const doc = state.doc!, source = state.filmSource!;
  const docId = doc.id;
  const candidates = useMemo(() => source.assetIds.filter((id) => isPictureAsset(doc.assets[id])), [source, doc.assets]);
  const [step, setStep] = useState<Step>('what');
  const [choices, setChoices] = useState<FilmChoices>(() => defaultChoices({ assetIds: candidates, event: source.event }, lang));
  const [flow, setFlow] = useState<FilmFlowState>({ phase: 'idle' });
  const [showExcluded, setShowExcluded] = useState(false);
  const [measuringBeat, setMeasuringBeat] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const flowRef = useRef<FilmFlowState>(flow);
  const paramsRef = useRef<FamilyFilmParams>(buildParams(choices));
  const seq = useRef(0), alive = useRef(true), jobRef = useRef<string | null>(null), lastProgress = useRef<number | null>(null);
  paramsRef.current = buildParams(choices);

  const send = (ev: FilmFlowEvent) => {
    const r = filmFlow(flowRef.current, ev);
    flowRef.current = r.state; setFlow(r.state);
    if (r.effect) void run(r.effect);
  };
  const refuse = (e: unknown) => { const f = filmFailure(lang, e); send({ type: 'refused', status: f.status, code: f.code, message: f.message }); };
  const run = async (effect: NonNullable<FilmFlowEffect>) => {
    if (effect.kind === 'plan') {
      const my = ++seq.current;
      try { const view = await api.planFilm(docId, paramsRef.current); if (my === seq.current && alive.current) send({ type: 'planned', view }); }
      catch (e) { if (my === seq.current && alive.current) refuse(e); }
    } else if (effect.kind === 'measure') {
      lastProgress.current = null;
      try {
        const r = await runMeasurement(
          { start: (b) => api.measureMoments(docId, b), job: (id) => api.job(id), sleep: (ms) => new Promise((ok) => setTimeout(ok, ms)) }, effect.assetIds,
          { onJob: (id, total) => { jobRef.current = id; if (alive.current) send({ type: 'measure-started', jobId: id, total }); },
            onProgress: (done, total) => { const now = Date.now(); if (alive.current && progressDue(lastProgress.current, now)) { lastProgress.current = now; send({ type: 'measure-progress', done, total }); } },
            stopped: () => !alive.current });
        jobRef.current = null;
        if (!alive.current) return;
        if (r === 'succeeded') await editor.load(docId);
        send(r === 'canceled' ? { type: 'measure-canceled' } : r === 'cached' ? { type: 'measure-cached' } : { type: 'measure-finished', ok: r === 'succeeded' });
      } catch (e) { jobRef.current = null; if (alive.current) refuse(e); }
    } else if (effect.kind === 'cancel') {
      void api.cancelJob(effect.jobId).catch(() => undefined);
    } else if (effect.kind === 'apply') {
      try {
        const view = flowRef.current.phase === 'applying' ? flowRef.current.view : null;
        const r = await api.applyFilm(docId, paramsRef.current, effect.revision);
        editor.setFilmRun({ runId: r.runId, params: paramsRef.current, picks: r.picks, excluded: r.excluded, alternatives: view?.alternatives ?? [] });
        await editor.load(docId);
        if (alive.current) send({ type: 'applied' });
      } catch (e) { if (alive.current) refuse(e); }
    } else if (effect.kind === 'close') editor.closeFilm();
  };
  useEffect(() => () => { alive.current = false; seq.current++; if (jobRef.current) void api.cancelJob(jobRef.current).catch(() => undefined); }, []);

  /** Change the parameters (a pick edit), keep them in the choices and plan again. */
  const edit = (next: FamilyFilmParams) => { const c = choicesOf(next); paramsRef.current = buildParams(c); setChoices(c); send({ type: 'params-changed' }); };
  const patch = (p: Partial<FilmChoices>) => setChoices((c) => ({ ...c, ...p }));
  const at = STEPS.indexOf(step);
  const go = (s: Step) => { setStep(s); if (s === 'plan') send({ type: 'enter-plan' }); else if (flowRef.current.phase === 'measuring') send({ type: 'cancel' }); };

  const measureBeats = async (assetId: string) => {
    setMeasuringBeat(assetId); setMusicError(null);
    try { await api.analyzeAssetJob(docId, assetId, { kind: 'beats' }); await editor.load(docId); patch({ musicAssetId: assetId }); }
    catch (e) { setMusicError(filmFailure(lang, e).message); } finally { setMeasuringBeat(null); }
  };
  const toggle = (id: string) => patch({ assetIds: choices.assetIds.includes(id) ? choices.assetIds.filter((x) => x !== id) : [...candidates.filter((c) => c === id || choices.assetIds.includes(c))] });

  const blockedNext = nextBlocked(choices, lang);
  const secs = videoSeconds(doc, choices.assetIds);
  const music = musicChoices(doc);
  const view = flow.phase === 'ready' || flow.phase === 'applying' ? flow.view : null;
  const rows = view ? planRows(view, doc, lang) : [];
  const warnings = view ? [...view.blocking.map((w) => ({ w, blocking: true })), ...view.warnings.map((w) => ({ w, blocking: false }))] : [];
  const applyBlocked = flow.phase === 'refused' ? S.notPlanned : flow.phase !== 'ready' && flow.phase !== 'applying' ? S.planning : view && view.blocking.length ? S.blockedTitle : rows.length === 0 ? S.emptyPlan : undefined;
  const refused = flow.phase === 'refused' ? flow : null;
  const onBeat = !!view && !!view.params.musicAssetId && view.predicted.offGridCuts.length === 0;

  const footer = (
    <>
      <Button variant="ghost" data-testid={TID.close} onClick={() => editor.closeFilm()}>{S.close}</Button>
      <span className="pf-film-spacer" />
      {at > 0 && <Button data-testid={TID.back} onClick={() => go(STEPS[at - 1]!)}>{S.back}</Button>}
      {step !== 'plan'
        ? <Button variant="primary" data-testid={TID.next} disabledReason={step === 'what' ? blockedNext ?? undefined : undefined} onClick={() => go(STEPS[at + 1]!)}>{S.next}</Button>
        : <Button variant="primary" data-testid={TID.apply} busy={flow.phase === 'applying'} disabledReason={applyBlocked} onClick={() => send({ type: 'apply' })}>{flow.phase === 'applying' ? S.applying : S.apply}</Button>}
    </>
  );

  return (
    <Dialog open onClose={() => editor.closeFilm()} title={S.title} size="lg" closeLabel={S.close} dismissOnBackdrop={false} footer={footer} testId={TID.dialog} className="pf-film-dialog">
      <ol className="pf-film-steps" aria-label={S.stepsLabel}>
        {STEPS.map((s, i) => <li key={s} aria-current={s === step ? 'step' : undefined} className={s === step ? 'is-on' : i < at ? 'is-done' : ''}><span className="num">{i + 1}</span> {S.steps[s]}</li>)}
      </ol>

      {step === 'what' && (
        <section data-testid={TID.stepWhat} aria-label={S.steps.what} className="pf-film-step">
          <p className="pf-film-source">{isolate(source.event ? S.fromEvent(source.event.name || S.noName) : S.fromSelection)}</p>
          <p className="pf-film-count" data-testid={TID.count} aria-live="polite">{isolate(S.countLine(choices.assetIds.length, secs))}</p>
          <div className="pf-film-tools">
            <Button size="sm" onClick={() => patch({ assetIds: [...candidates] })}>{S.selectAll}</Button>
            <Button size="sm" onClick={() => patch({ assetIds: [] })}>{S.selectNone}</Button>
          </div>
          {candidates.length === 0 ? <p>{S.emptySource}</p> : (
            <ul className="pf-film-grid" aria-label={S.clipsLabel}>
              {candidates.map((id) => {
                const a = doc.assets[id]!, on = choices.assetIds.includes(id);
                return (
                  <li key={id} data-testid={TID.clip} data-asset-id={id} className={on ? 'is-on' : ''}>
                    <label className="pf-film-clip">
                      <input type="checkbox" data-testid={TID.clipCheck} checked={on} onChange={() => toggle(id)} />
                      <FilmThumb projectId={docId} asset={a} frame={null} />
                      <span className="pf-film-clip-name">{isolate(a.name)}</span>
                      <span className="pf-film-clip-kind">{a.kind === 'image' ? S.kindImage : S.kindVideo}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {tooManyChosen(choices) && <p role="alert" className="pf-film-too-many" data-testid={TID.tooMany}>{isolate(S.tooMany(MAX_FILM_ASSETS))}</p>}
        </section>
      )}

      {step === 'length' && (
        <section data-testid={TID.stepLength} aria-label={S.steps.length} className="pf-film-step">
          <Seg label={S.lengthLabel} value={String(choices.targetSeconds)} onChange={(v) => patch({ targetSeconds: Number(v) as 30 | 60 | 90 })} options={[
            { value: '30', label: isolate(S.lengthOption(30)), testId: TID.length30 }, { value: '60', label: isolate(S.lengthOption(60)), testId: TID.length60 }, { value: '90', label: isolate(S.lengthOption(90)), testId: TID.length90 }]} />
          <fieldset className="pf-film-fieldset">
            <legend>{S.musicLabel}</legend>
            <div role="radiogroup" aria-label={S.musicLabel} className="pf-film-music">
              <label className="pf-film-opt"><input type="radio" name="film-music" data-testid={TID.musicNone} checked={choices.musicAssetId === null} onChange={() => patch({ musicAssetId: null })} /> <span>{S.musicNone}</span></label>
              {music.map((a) => {
                const b = beatInfo(doc, a.id);
                return (
                  <div key={a.id} className="pf-film-opt" data-testid={TID.music} data-asset-id={a.id}>
                    <label><input type="radio" name="film-music" checked={choices.musicAssetId === a.id} disabled={!b.measured} onChange={() => patch({ musicAssetId: a.id })} /> <span>{isolate(a.name)}</span> <span className="pf-film-muted">{isolate(b.measured ? S.musicBeats(b.count, b.bpm) : S.musicNoBeats)}</span></label>
                    {!b.measured && <Button size="sm" data-testid={TID.musicMeasureBeats} aria-label={`${S.measureBeats}: ${a.name}`} busy={measuringBeat === a.id} onClick={() => void measureBeats(a.id)}>{measuringBeat === a.id ? S.measuringBeats : S.measureBeats}</Button>}
                  </div>
                );
              })}
            </div>
            {music.length === 0 && <p className="pf-film-muted">{S.musicNoSound}</p>}
            {musicError && <AnchoredError onDismiss={() => setMusicError(null)} dismissLabel={S.close}>{musicError}</AnchoredError>}
            <p className="pf-film-muted">{S.musicNote}</p>
          </fieldset>
          <Seg label={S.soundLabel} value={choices.ownSound} onChange={(v) => patch({ ownSound: v })} options={[
            { value: 'under', label: choices.musicAssetId ? S.sound.under : S.underWithoutMusic, testId: TID.soundUnder }, { value: 'lead', label: S.sound.lead, testId: TID.soundLead }, { value: 'mute', label: S.sound.mute, testId: TID.soundMute }]} />
          <p className="pf-film-muted">{choices.ownSound === 'under' && !choices.musicAssetId ? S.underWithoutMusic : S.soundNote[choices.ownSound]}</p>
          <Seg label={S.orderLabel} value={choices.order} onChange={(v) => patch({ order: v })} options={[
            { value: 'capture', label: S.order.capture, testId: TID.orderCapture }, { value: 'given', label: S.order.given, testId: TID.orderGiven }, { value: 'arc', label: S.order.arc, testId: TID.orderArc }]} />
          <p className="pf-film-muted">{S.orderNote[choices.order]}</p>
          <label className="pf-film-field">
            <span>{S.titleLabel}</span>
            <input type="text" data-testid={TID.titleField} maxLength={200} value={choices.openingText ?? ''} placeholder={S.titlePlaceholder(choices.event?.name ?? null)} onChange={(e) => patch({ openingText: e.target.value })} aria-describedby="pf-film-title-hint" />
          </label>
          <p id="pf-film-title-hint" className="pf-film-muted">{S.titleHint}</p>
        </section>
      )}

      {step === 'plan' && (
        <section data-testid={TID.stepPlan} aria-label={S.steps.plan} className="pf-film-step" aria-busy={flow.phase === 'planning' || flow.phase === 'measuring'}>
          {flow.phase === 'measuring' && (
            <div role="status" data-testid={TID.measureProgress} className="pf-film-measure">
              <JobRow title={S.measuring(flow.done, flow.total)} state="running" progress={flow.total ? (flow.done / flow.total) * 100 : null} stateLabel={S.measureState} />
              <Button size="sm" data-testid={TID.measureCancel} onClick={() => send({ type: 'cancel' })}>{S.measureCancel}</Button>
            </div>
          )}
          {flow.phase === 'planning' && <p role="status">{S.planning}</p>}
          {refused && refused.at !== 'apply' && <FilmError message={refused.message} blocking />}
          {refused && <Button size="sm" data-testid={TID.retry} onClick={() => send({ type: 'retry' })}>{S.retry}</Button>}
          {(flow.phase === 'planning' || flow.phase === 'ready') && flow.note && <FilmError message={flow.note.message} />}
          {view && (
            <>
              <p className="pf-film-muted">{S.planNote}</p>
              {warnings.length > 0 && (
                <ul className="pf-film-warnings" aria-label={S.warningsLabel}>
                  {warnings.map(({ w, blocking }, i) => <li key={`${w.code}-${i}`} data-testid={TID.warning} data-code={w.code} className={blocking ? 'is-blocking' : ''}>{blocking && <b>{S.blockedTitle}: </b>}{isolate(S.warning(w))}</li>)}
                </ul>
              )}
              {rows.length === 0 ? <p>{S.emptyPlan}</p> : (
                <ol className="pf-film-rows" aria-label={S.rowsLabel}>
                  {rows.map((row) => (
                    <PlanRow key={row.key} row={row} lang={lang} projectId={docId} asset={doc.assets[row.assetId]} hash={doc.analyses?.[row.assetId]?.moments?.data}
                      others={otherClipChoices(view, doc, row.assetId)}
                      onWindow={() => edit(withNextWindow(paramsRef.current, row.assetId, row.windowIndex, row.windowsAvailable))}
                      onClip={(to) => edit(withOtherClip(paramsRef.current, row.assetId, to))}
                      onRemove={() => edit(withRemoved(paramsRef.current, row.assetId))} />
                  ))}
                </ol>
              )}
              <p className="pf-film-thumbnote pf-film-muted">{S.thumbNote}</p>
              <div className="pf-film-excluded">
                <button type="button" className="pf-film-disclose" data-testid={TID.excludedToggle} aria-expanded={showExcluded} onClick={() => setShowExcluded((v) => !v)}>{isolate(S.excludedCount(view.excluded.length))}</button>
                {showExcluded && (view.excluded.length === 0 ? <p className="pf-film-muted">{S.excludedNone}</p> : (
                  <ul>
                    {view.excluded.map((e) => {
                      const back = withIncluded(paramsRef.current, e);
                      return (
                        <li key={`${e.assetId}-${e.code}`} data-testid={TID.excluded} data-asset-id={e.assetId} data-code={e.code}>
                          <span>{isolate(doc.assets[e.assetId]?.name ?? e.assetId)}</span> <span className="pf-film-muted">{isolate(S.exclusion(e))}</span>
                          {back && <Button size="sm" data-testid={TID.include} aria-label={`${S.include}: ${doc.assets[e.assetId]?.name ?? e.assetId}`} onClick={() => edit(back)}>{S.include}</Button>}
                        </li>
                      );
                    })}
                  </ul>
                ))}
              </div>
              <p className="pf-film-footer" data-testid={TID.footer}>
                <b>{isolate(S.footer(view.picks.length, view.predicted.seconds))}</b>
                {onBeat && <span> · {S.onBeat}</span>}
                <span> · {FAMILY_FILM_DRAFT_LABEL[lang]}</span>
                <span> · {S.facesNote}</span>
              </p>
            </>
          )}
          {refused && refused.at === 'apply' && <FilmError message={refused.message} blocking />}
        </section>
      )}
    </Dialog>
  );
}
