/**
 * The «גדלים מול העיניים» dialog (wave 8 growing, W3; shaped like story/StoryDialog.tsx): «בחרו תמונות» · «סמנו עיניים» (GrowingMarkView, in
 * SHOWN coordinates) · «איך זה ייראה», the live preview after the second marked picture through the real planGrowing + applyTransaction
 * on a COPY + the same Player (C13), the C7 privacy sentence, the ask before closing (C8), focus trap and Escape (ds Dialog; focus goes back
 * to the opener in the same commit). Mounted once in App.tsx.
 * The eye marks live in this component's React state only: no store field, no browser storage, no URL; they travel once in
 * api.applyGrowing / api.regenerateGrowing and are dropped when the dialog closes.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { GROWING_BUILT, GROWING, growingPickKey, planGrowing, suggestEyeOrder, type Asset, type ProjectDocument, type SuggestEyeOrder } from '@pulseframe/core';
import { Button, Dialog } from '../../ds/index.ts';
import { isolate } from '../../ds/util.tsx';
import { api } from '../../api.ts';
import { Player } from '../../player.ts';
import { useEditorState } from '../store.ts';
import { GrowingMarkView } from './GrowingMarkView.tsx';
import { growingStrings } from './growing.strings.ts';
import { GROWING_TESTIDS as ID } from './growing.testids.ts';
import { eyesApi } from './eyes.client.ts';
import { setupFromModels, type EyesSetup, type Proposal } from './eyes.logic.ts';
import { setGrowingLast, takeGrowingIntent } from './growing.link.ts';
import {
  agePerson, buildParams, buildPreview, closeLosesMarks, createBlocker, currentGrowingRun, dateWords, defaultSettings, emptyMark, failureWords, fpsOf, holdFrames, listCandidates,
  markedCount, markWords, mergeOrder, minHoldFrames, moveUndated, pickId, refusalWords, restoreParams, secondsText, shownSizeOf, type Candidate, type Mark, type Settings,
} from './growing.logic.ts';
import './growing.css';

/** True once W3 has built this dialog. The start-hub card shows only when this and core GROWING_BUILT are both true. */
export const GROWING_UI_BUILT: boolean = true;

export function GrowingDialog({ lang }: { lang: 'he' | 'en' }): ReactElement | null {
  const { state } = useEditorState();
  if (!state.growingOpen || !state.doc || !GROWING_BUILT || !GROWING_UI_BUILT) return null;
  return <GrowingDialogBody lang={lang} />;
}

type Step = 'pick' | 'mark' | 'settings';
const orderFn: SuggestEyeOrder | null = GROWING_BUILT ? suggestEyeOrder : null;

function GrowingDialogBody({ lang }: { lang: 'he' | 'en' }): ReactElement {
  const { editor, state } = useEditorState();
  const S = growingStrings(lang);
  const doc = state.doc!;
  const rtl = lang === 'he';
  const intent = useRef(takeGrowingIntent()).current; // the bar's «החזרת החלקים שנמחקו»
  const runView = useMemo(() => (intent.restore ? currentGrowingRun(doc) : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const cands = useMemo(() => listCandidates(doc), [doc]);
  const byId = useMemo(() => Object.fromEntries(cands.map((c) => [c.assetId, c])) as Record<string, Candidate>, [cands]);
  const [order, setOrder] = useState<string[]>(() => cands.map((c) => c.assetId));
  // files that come in after the dialog opened (the start hub's card opens it when the import queue is idle) join the list
  useEffect(() => { setOrder((o) => mergeOrder(o, cands) as string[]); }, [cands]);
  const [ticked, setTicked] = useState<string[]>(() => (runView ? runView.deleted.map((d) => d.assetId) : []));
  const [step, setStep] = useState<Step>(runView ? 'mark' : 'pick');
  const [marks, setMarks] = useState<Record<string, Mark>>(() => Object.fromEntries((runView?.deleted ?? []).map((d) => [d.assetId, emptyMark(d.frame)]))); // by asset id; MEMORY ONLY (C8)
  const [cur, setCur] = useState(0);
  // «הציעו עיניים»: the proposals by asset id and the picture model's setup; memory only, dropped with the dialog
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [eyesSetup, setEyesSetup] = useState<EyesSetup | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const made = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (step !== 'mark') return;
    const ctl = new AbortController();
    eyesApi.models(ctl.signal).then((a) => { if (!ctl.signal.aborted) setEyesSetup(setupFromModels(a.models)); }, (e: unknown) => {
      if (ctl.signal.aborted) return;
      setEyesSetup((e as { code?: string })?.code === 'eyes_not_built' || (e as { status?: number })?.status === 501 ? { code: 'not_built', module: null, missingBytes: 0 } : { code: 'unknown' });
    });
    return () => ctl.abort();
  }, [step === 'mark']); // eslint-disable-line react-hooks/exhaustive-deps

  const refs = useMemo(() => order.filter((id) => ticked.includes(id)).map((id) => ({ assetId: id, frame: (marks[id] ?? emptyMark(byId[id]?.kind === 'video' ? 0 : null)).frame })), [order, ticked, marks, byId]);
  const markOf = (id: string): Mark => marks[id] ?? emptyMark(byId[id]?.kind === 'video' ? 0 : null);
  const keyed = useMemo(() => Object.fromEntries(refs.map((r) => [pickId(r.assetId, r.frame), markOf(r.assetId)])), [refs, marks]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = markedCount(refs.map((r) => pickId(r.assetId, r.frame)), keyed);
  const blocker = runView ? (runView.deleted.every((d) => markOf(d.assetId).eyes) ? null : 'unmarked') as 'unmarked' | null : createBlocker(refs, keyed);
  const person = agePerson(doc);
  const fps = fpsOf(doc);

  // the live preview (C13): from the second marked picture on, on a copy, never saved
  const params = useMemo(() => buildParams(doc, refs, keyed, settings), [doc, refs, keyed, settings]);
  const preview = useMemo(() => (params ? buildPreview(doc, params, { plan: planGrowing }) : null), [doc, params]);

  const close = () => {
    if (closeLosesMarks(keyed, made.current)) { setAsking(true); return; }
    editor.closeGrowing();
  };
  const patchMark = (id: string, m: Mark) => setMarks((x) => ({ ...x, [id]: m }));
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const onItemKey = (id: string) => (e: KeyboardEvent) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); setOrder((o) => moveUndated(o, byId, id, e.key === 'ArrowUp' ? -1 : 1)); }
  };

  const fail = (e: unknown) => {
    const x = e as { code?: string };
    setError(x?.code === 'stale_revision' || x?.code === 'conflict' ? S.staleProject : failureWords(lang, e, S.notBuilt));
  };
  const create = async () => {
    if (busy || blocker) return;
    setBusy(true); setError(null);
    try {
      if (runView) {
        const p = restoreParams(runView, Object.fromEntries(runView.deleted.map((d) => [pickId(d.assetId, d.frame), markOf(d.assetId)])));
        if (!p) return;
        const r = await api.regenerateGrowing(doc.id, runView.run.id, { params: p, restoreRemoved: true, expectedRevision: state.revision });
        setGrowingLast({ runId: r.runId, picks: r.picks, excluded: r.excluded });
      } else {
        if (!params) return;
        const r = await api.applyGrowing(doc.id, { params, expectedRevision: state.revision });
        setGrowingLast({ runId: r.runId, picks: r.picks, excluded: r.excluded });
      }
      made.current = true;
      await editor.load(doc.id);
      if (alive.current) editor.closeGrowing();
    } catch (e) { if (alive.current) fail(e); } finally { if (alive.current) setBusy(false); }
  };

  const goMark = () => { setCur(0); setStep('mark'); };
  const page = (d: -1 | 1) => setCur((c) => Math.max(0, Math.min(refs.length - 1, c + d)));
  const curRef = refs[Math.min(cur, Math.max(0, refs.length - 1))];
  const curAsset: Asset | undefined = curRef ? doc.assets[curRef.assetId] : undefined;
  const curShown = curAsset ? shownSizeOf(curAsset) : null;

  const title = runView ? S.restoreTitle : S.name;
  const footer = (
    <>
      <Button variant="ghost" data-testid={ID.close} onClick={close}>{S.close}</Button>
      <span className="pf-growing-spacer" />
      {step !== 'pick' && !runView && <Button onClick={() => setStep(step === 'settings' ? 'mark' : 'pick')}>{S.back}</Button>}
      {step === 'pick' && <Button variant="primary" data-testid={ID.pickNext} disabledReason={ticked.length < GROWING.minPictures ? S.blockerFew : undefined} onClick={goMark}>{S.next}</Button>}
      {step === 'mark' && !runView && <Button variant="primary" disabledReason={counts.marked < GROWING.minPictures ? S.blockerFew : undefined} onClick={() => setStep('settings')}>{S.next}</Button>}
      {(step === 'settings' || (runView && step === 'mark')) && (
        <Button variant="primary" data-testid={ID.create} busy={busy} disabledReason={blocker === 'few' ? S.blockerFew : blocker === 'unmarked' ? S.blockerUnmarked : undefined} onClick={() => void create()}>{runView ? S.restoreCreate : S.create}</Button>
      )}
    </>
  );

  return (
    <Dialog open onClose={close} title={title} size="lg" closeLabel={S.close} dismissOnBackdrop={false} footer={footer} testId={ID.dialog} className="pf-growing-dialog">
      <div className="pf-growing-body" dir={rtl ? 'rtl' : 'ltr'} lang={lang} data-step={step} data-testid="growing-body">
        <p className="pf-growing-steps" aria-label={S.name}>
          {[['pick', S.stepPick], ['mark', S.stepMark], ['settings', S.stepSettings]].map(([k, l]) => <span key={k} className={k === step ? 'is-on' : ''} aria-current={k === step ? 'step' : undefined}>{l}</span>)}
        </p>
        {asking && (
          <div className="pf-growing-ask" role="alertdialog" aria-label={S.closeLosesMarks} data-testid={ID.closeAsk}>
            <p>{S.closeLosesMarks}</p>
            <div className="pf-growing-row">
              <Button data-testid={ID.closeKeep} onClick={() => setAsking(false)}>{S.closeKeep}</Button>
              <Button variant="danger" data-testid={ID.closeConfirm} onClick={() => editor.closeGrowing()}>{S.closeConfirm}</Button>
            </div>
          </div>
        )}

        {step === 'pick' && (
          <section aria-label={S.stepPick}>
            <p className="pf-growing-muted">{S.pickHelp}</p>
            {cands.length === 0 ? <p className="pf-growing-muted">{S.pickEmpty}</p> : (
              <ul className="pf-growing-list" data-testid={ID.pickList} aria-label={S.pickLabel}>
                {order.map((id) => {
                  const c = byId[id]!;
                  return (
                    <li key={id} className="pf-growing-item" data-testid={ID.pickItem} data-asset-id={id} data-state={c.wall ? 'dated' : 'undated'} onKeyDown={onItemKey(id)}>
                      <label>
                        <input type="checkbox" data-testid={ID.pickTick} checked={ticked.includes(id)} onChange={() => toggle(id)} aria-describedby={`gd-${id}`} />
                        <span className="pf-growing-item-name">{isolate(c.name)}</span>
                      </label>
                      <span id={`gd-${id}`} className="pf-growing-muted">{c.wall ? S.dateOf(dateWords(c.wall, S.undated)) : `${S.undated} · ${S.moveHint}`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="pf-growing-muted" role="status" aria-live="polite">{S.ticked(ticked.length)}</p>
          </section>
        )}

        {step === 'mark' && (
          <section aria-label={S.stepMark}>
            <p className="pf-growing-count" role="status" aria-live="polite" data-testid={ID.markCount}>{S.marked(counts.marked, counts.of)}</p>
            {runView && <p className="pf-growing-muted">{S.needsMarksList(runView.deleted.length)}</p>}
            <p className="pf-growing-muted">{S.markHelp} {curAsset?.video ? S.markHelpVideo : ''}</p>
            <ol className="pf-growing-pics" aria-label={S.pictureList}>
              {refs.map((r, i) => {
                const a = doc.assets[r.assetId], w = markWords(markOf(r.assetId));
                const wordsOf = w === 'done' ? S.stateDone : w === 'one' ? S.stateOne : S.stateNone;
                return (
                  <li key={r.assetId}><button type="button" className={`pf-growing-pic${i === cur ? ' is-on' : ''}`} aria-current={i === cur ? 'true' : undefined} data-asset-id={r.assetId} data-state={w} onClick={() => setCur(i)}>{S.stateWords(a?.name ?? r.assetId, wordsOf)}</button></li>
                );
              })}
            </ol>
            {curAsset && curShown && curRef && (
              <>
                <p className="pf-growing-prompt" data-testid={ID.markPrompt} role="status" aria-live="polite">
                  {markWords(markOf(curRef.assetId)) === 'none' ? S.firstEye : markWords(markOf(curRef.assetId)) === 'one' ? S.secondEye : S.stateDone}
                </p>
                <GrowingMarkView key={curAsset.id} lang={lang} doc={doc} asset={curAsset} shown={curShown} mark={markOf(curRef.assetId)} order={orderFn} frameLocked={!!runView} onChange={(m) => patchMark(curRef.assetId, m)} onPage={page}
                  eyes={{ setup: eyesSetup, proposal: proposals[curRef.assetId], onProposal: (p) => setProposals((x) => { const { [curRef.assetId]: _gone, ...rest } = x; return p ? { ...rest, [curRef.assetId]: p } : rest; }) }} />
                <div className="pf-growing-row">
                  <Button size="sm" data-testid={ID.markPrev} disabled={cur <= 0} onClick={() => page(-1)}>{S.prevPicture}</Button>
                  <Button size="sm" data-testid={ID.markNext} disabled={cur >= refs.length - 1} onClick={() => page(1)}>{S.nextPicture}</Button>
                </div>
              </>
            )}
            {!runView && <PreviewBlock lang={lang} preview={preview} showKey={curRef ? growingPickKey(curRef.assetId, curRef.frame) : null} />}
            {error && <p className="pf-growing-error" role="alert" data-testid={ID.error}>{error}</p>}
          </section>
        )}

        {step === 'settings' && (
          <section aria-label={S.stepSettings}>
            <PreviewBlock lang={lang} preview={preview} showKey={null} />
            <div className="pf-growing-field">
              <label htmlFor="gd-hold">{S.hold}</label>
              <input id="gd-hold" type="number" min={0.1} step={0.1} value={settings.holdSeconds} data-testid={ID.hold}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) setSettings((s) => ({ ...s, holdSeconds: v })); }} />
              <span className="pf-growing-muted"><bdi>{S.holdSeconds(secondsText(holdFrames(settings.holdSeconds, fps), fps))}</bdi> · {S.holdFramesText(holdFrames(settings.holdSeconds, fps), minHoldFrames(fps))}</span>
              {preview && !preview.ok && <p className="pf-growing-error" role="alert" data-testid={ID.error}>{refusalWords(lang, preview.message)}</p>}
            </div>
            <div className="pf-growing-field" role="radiogroup" aria-label={S.dissolve}>
              <span>{S.dissolve}</span>
              {(['none', 'short', 'long'] as const).map((d) => (
                <button key={d} type="button" role="radio" aria-checked={settings.dissolve === d} className={`pf-growing-btn${settings.dissolve === d ? ' is-on' : ''}`} data-testid={ID.dissolve} data-variant={d}
                  onClick={() => setSettings((s) => ({ ...s, dissolve: d }))}>{d === 'none' ? S.dissolveNone : d === 'short' ? S.dissolveShort : S.dissolveLong}</button>
              ))}
            </div>
            <div className="pf-growing-field">
              <label htmlFor="gd-face">{S.faceSize}: <bdi>{Math.round(settings.faceSize * 100)}%</bdi></label>
              <input id="gd-face" type="range" min={GROWING.faceSize.min} max={GROWING.faceSize.max} step={0.005} value={settings.faceSize} data-testid={ID.faceSize}
                onChange={(e) => setSettings((s) => ({ ...s, faceSize: Number(e.target.value) }))} />
              {preview?.ok && preview.plan.suggestedFaceSize !== null && (
                <Button size="sm" data-testid={ID.faceSuggest} title={S.faceSuggestTitle} onClick={() => setSettings((s) => ({ ...s, faceSize: preview.ok ? preview.plan.suggestedFaceSize! : s.faceSize }))}>{S.faceSuggest(Math.round(preview.plan.suggestedFaceSize * 100))}</Button>
              )}
            </div>
            <fieldset className="pf-growing-field">
              <legend>{S.caption}</legend>
              <label><input type="checkbox" data-testid={ID.captionDate} checked={settings.caption.date} onChange={(e) => setSettings((s) => ({ ...s, caption: { ...s.caption, date: e.target.checked } }))} /> {S.captionDate}</label>
              <label><input type="checkbox" data-testid={ID.captionAge} disabled={!person} aria-describedby={person ? undefined : 'gd-age-why'} checked={settings.caption.age && !!person}
                onChange={(e) => setSettings((s) => ({ ...s, caption: { ...s.caption, age: e.target.checked } }))} /> {S.captionAge}{person ? ` (${isolate(person.name)})` : ''}</label>
              {!person && <span id="gd-age-why" className="pf-growing-muted" data-testid={ID.captionAgeReason}>{S.noBirthDate}</span>}
              <span className="pf-growing-muted">{S.captionNeedsDate}</span>
            </fieldset>
            {preview?.ok && preview.plan.warnings.length > 0 && (
              <ul className="pf-growing-warnings">
                {preview.plan.warnings.map((w, i) => {
                  const mag = typeof w.details?.magnification === 'number' ? ` (${w.details.magnification})` : '';
                  return <li key={`${w.code}${i}`} data-testid={ID.warning} data-code={w.code}>{S.warning[w.code]}{mag}</li>;
                })}
              </ul>
            )}
            <p className="pf-growing-privacy" data-testid={ID.privacy}>{S.privacy}</p>
            <p className="pf-growing-muted" data-testid={ID.limits}>{S.orientationLimit} · {S.flashAfterExport} · {S.method}</p>
            {error && <p className="pf-growing-error" role="alert" data-testid={ID.error}>{error}</p>}
          </section>
        )}
        {step === 'pick' && <p className="pf-growing-muted">{S.privacy}</p>}
      </div>
    </Dialog>
  );
}

/** The live preview, labelled; the planner's refusal in words when it refuses. Plays the copy with the same Player. */
/**
 * `showKey`: the pick being marked. While the preview is paused it shows the middle of that picture's hold, so a mark or «החליפו»
 * (S) on it is seen at once (C10, C13); null leaves the frame where it is.
 */
function PreviewBlock({ lang, preview, showKey }: { lang: 'he' | 'en'; preview: ReturnType<typeof buildPreview> | null; showKey: string | null }): ReactElement {
  const { editor } = useEditorState();
  const S = growingStrings(lang);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [, setTick] = useState(0);
  const pdoc: ProjectDocument | null = preview?.ok ? preview.doc : null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !editor.pool || !pdoc) return;
    editor.player?.pause();
    const p = new Player(canvas, editor.pool, () => setTick((x) => x + 1), () => undefined);
    playerRef.current = p;
    p.setDoc(pdoc);
    return () => { playerRef.current = null; p.dispose(); };
  }, [!!pdoc, editor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pdoc) playerRef.current?.setDoc(pdoc); }, [pdoc]);
  const showAt = preview?.ok && showKey ? (() => { const p = preview.plan.picks.find((x) => x.key === showKey); return p ? p.startFrame + Math.floor(p.frames / 2) : null; })() : null;
  useEffect(() => { const p = playerRef.current; if (p && showAt !== null && !p.playing) p.seek(showAt); }, [showAt, pdoc]);
  if (!preview) return <p className="pf-growing-muted" data-testid="growing-preview-wait">{S.previewNeedsTwo}</p>;
  if (!preview.ok) return <p className="pf-growing-error" role="alert" data-testid={ID.error}>{refusalWords(lang, preview.message)}</p>;
  const playing = playerRef.current?.playing ?? false;
  const toggle = () => { const p = playerRef.current; if (!p) return; if (p.playing) p.pause(); else { p.seek(0); void p.play(); } /* the preview plays from its start */ setTick((x) => x + 1); };
  return (
    <div className="pf-growing-preview" data-testid={ID.preview} dir="ltr">
      <p className="pf-growing-previewlabel" data-testid={ID.previewLabel} dir={lang === 'he' ? 'rtl' : 'ltr'}>{S.preview}</p>
      <canvas ref={canvasRef} className="pf-growing-previewcanvas" role="img" aria-label={S.preview} />
      <button type="button" className="pf-growing-btn" onClick={toggle}>{playing ? S.pausePreview : S.playPreview}</button>
    </div>
  );
}
