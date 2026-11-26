/**
 * The marking view of «גדלים מול העיניים» (wave 8 growing, W3): one picture drawn by the same Player / evaluate / compositor as the
 * source viewer, on sourceDocument(doc, asset) (the picture AS SHOWN, C4), with the points as an overlay. dir=ltr always.
 * Click places a point; a cross-hair moves by arrows (one picture pixel, Shift ten) and Enter places; S swaps; Backspace removes the
 * last point; a video's frame is chosen first on its own row (←/→ a frame, Shift ±1 s). The points are reported to the dialog
 * (React state in memory) and nowhere else.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react';
import type { Asset, EyePoint, ProjectDocument, SuggestEyeOrder } from '@pulseframe/core';
import { Player } from '../../player.ts';
import { useEditorState } from '../store.ts';
import { sourceDocument } from '../sourceDocument.ts';
import { clearMark, lastFrameOf, markWords, moveCrosshair, placePoint, projectFrameOfSource, removeLastMark, shownPixels, stepFrame, swapEyes, uvFromClient, withFrame, type Mark } from './growing.logic.ts';
import { growingStrings } from './growing.strings.ts';
import { eyesStrings } from './eyes.strings.ts';
import { EYES_TESTIDS as EID } from './eyes.testids.ts';
import { eyesApi } from './eyes.client.ts';
import { acceptFace, chooseByClick, letterIndex, moveChosen, orderedEyes, proposalFor, proposalOf, type EyesSetup, type Proposal } from './eyes.logic.ts';
import { GROWING_TESTIDS as ID } from './growing.testids.ts';

export interface MarkViewProps {
  lang: 'he' | 'en'; doc: ProjectDocument; asset: Asset; shown: { width: number; height: number }; mark: Mark; order: SuggestEyeOrder | null; frameLocked?: boolean;
  onChange: (m: Mark) => void; onPage: (d: -1 | 1) => void;
  /** «הציעו עיניים»: the picture model's setup (null while it is being read), and the proposal held by the dialog (memory only). */
  eyes?: { setup: EyesSetup | null; proposal: Proposal | undefined; onProposal: (p: Proposal | null) => void };
}
export function GrowingMarkView({ lang, doc, asset, shown, mark, order, frameLocked, onChange, onPage, eyes }: MarkViewProps): ReactElement {
  const { editor } = useEditorState();
  const S = growingStrings(lang);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [cross, setCross] = useState<EyePoint>({ u: 0.5, v: 0.5 });
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const isVideo = !!asset.video;
  const eS = eyesStrings(lang);
  const stageRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  const [closer, setCloser] = useState(false);
  const [notBuilt, setNotBuilt] = useState(false); // the server answered 501 eyes_not_built to a request
  const prop = eyes ? proposalFor(eyes.proposal, asset.id, mark.frame) : null;
  const setup: EyesSetup | null = notBuilt ? { code: 'not_built', module: null, missingBytes: 0 } : eyes?.setup ?? null;
  const stopEyes = () => { abortRef.current?.abort(); abortRef.current = null; setRunning(false); };
  useEffect(() => () => { abortRef.current?.abort(); }, []); // the picture changed or the dialog closed: the request is dropped
  useEffect(() => { stopEyes(); setFailed(false); setCloser(false); }, [mark.frame]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = useMemo(() => { try { return sourceDocument(doc, asset); } catch (e) { return e instanceof Error ? e : new Error(String(e)); } }, [asset.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !editor.pool || !src) return;
    if (src instanceof Error) { setErr(src.message); return; }
    const p = new Player(canvas, editor.pool, () => undefined, (e) => setErr(e instanceof Error ? e.message : String(e)));
    playerRef.current = p;
    p.setDoc(src);
    if (isVideo && mark.frame !== null) void Promise.resolve().then(() => playerRef.current === p && p.seek(projectFrameOfSource(asset, mark.frame!, editor.rate)));
    return () => { playerRef.current = null; p.dispose(); };
  }, [src, editor]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isVideo && mark.frame !== null) playerRef.current?.seek(projectFrameOfSource(asset, mark.frame, editor.rate)); }, [mark.frame]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setCross({ u: 0.5, v: 0.5 }); setNote(''); }, [asset.id]);

  const place = (p: EyePoint) => {
    const r = placePoint(mark, p, shown, order);
    if (r.refused) { setNote(S.tooClose); return; }
    const n = r.mark.clicks.length, px = shownPixels(p, shown);
    setNote(S.placed(n, px.x, px.y));
    onChange(r.mark);
  };
  const dropProposal = () => { eyes?.onProposal(null); setCloser(false); setFailed(false); };
  const chooseNear = (p: EyePoint): boolean => {
    if (!prop || prop.outcome !== 'faces' || !eyes) return false;
    const c = chooseByClick(prop.faces, p, shown);
    if (c.kind === 'none') return false;
    if (c.kind === 'closer') { setCloser(true); return true; }
    setCloser(false); eyes.onProposal({ ...prop, chosen: c.face }); setNote(eS.chosenFace(letterIndex(c.face, prop.faces.length, lang)));
    return true;
  };
  const accept = () => {
    if (!prop || !eyes || prop.chosen === null) return;
    const r = acceptFace(mark, prop.faces[prop.chosen]!, shown, order);
    if (r.refused) { setNote(S.tooClose); return; }
    const px = shownPixels(r.mark.eyes![1], shown);
    setNote(S.placed(2, px.x, px.y));
    dropProposal();
    onChange(r.mark);
  };
  const suggest = () => {
    if (!eyes || running) return;
    stageRef.current?.focus(); // in this same task, so the keys of the proposal reach the stage
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setRunning(true); setFailed(false); setCloser(false); eyes.onProposal(null);
    eyesApi.propose(doc.id, { assetId: asset.id, frame: mark.frame }, ctl.signal).then((a) => {
      if (ctl.signal.aborted) return;
      abortRef.current = null; setRunning(false);
      eyes.onProposal(proposalOf(asset.id, mark.frame, a));
    }, (err: unknown) => {
      if (ctl.signal.aborted) return;
      abortRef.current = null; setRunning(false);
      if ((err as { code?: string })?.code === 'eyes_not_built') setNotBuilt(true); else setFailed(true);
    });
  };
  const onClick = (e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const p = rect ? uvFromClient(e.clientX, e.clientY, rect) : null;
    if (!p) return;
    setCross(p);
    if (chooseNear(p)) return;
    if (prop) dropProposal();
    setFailed(false);
    place(p);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey) return;
    if (e.key === 'Escape' && (prop || running)) { e.preventDefault(); e.stopPropagation(); if (running) stopEyes(); if (prop) dropProposal(); setNote(eS.dropped); return; }
    if (prop && prop.outcome === 'faces' && eyes) {
      if (e.key === '[' || e.key === ']') { e.preventDefault(); const f = moveChosen(prop.chosen, prop.faces.length, lang, e.key === ']' ? 1 : -1); if (f !== null) { setCloser(false); eyes.onProposal({ ...prop, chosen: f }); setNote(eS.chosenFace(letterIndex(f, prop.faces.length, lang))); } return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (prop.chosen !== null) { accept(); return; }
        const c = chooseByClick(prop.faces, cross, shown);
        if (c.kind === 'chosen') { const r = acceptFace(mark, prop.faces[c.face]!, shown, order); if (r.refused) setNote(S.tooClose); else { const px = shownPixels(r.mark.eyes![1], shown); setNote(S.placed(2, px.x, px.y)); dropProposal(); onChange(r.mark); } }
        else if (c.kind === 'closer') setCloser(true);
        else setNote(eS.many(prop.faces.length));
        return;
      }
    }
    const moved = moveCrosshair(cross, e.key, e.shiftKey, shown);
    if (moved) { e.preventDefault(); setCross(moved); const px = shownPixels(moved, shown); setNote(S.crosshairAt(px.x, px.y)); return; }
    if (e.key === 'Enter') { e.preventDefault(); place(cross); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); onChange(swapEyes(mark)); }
    else if (e.key === 'Backspace') { e.preventDefault(); onChange(removeLastMark(mark)); }
    else if (e.key === 'PageDown') { e.preventDefault(); onPage(1); }
    else if (e.key === 'PageUp') { e.preventDefault(); onPage(-1); }
  };
  const onFrameKey = (e: KeyboardEvent) => {
    if (e.key === 'PageDown') { e.preventDefault(); onPage(1); return; }
    if (e.key === 'PageUp') { e.preventDefault(); onPage(-1); return; }
    if (frameLocked) return;
    const fps = asset.video!.frameRate.num / asset.video!.frameRate.den;
    const n = stepFrame(mark.frame ?? 0, e.key, e.shiftKey, fps, lastFrameOf(asset));
    if (n !== null) { e.preventDefault(); if (n !== mark.frame) { stopEyes(); eyes?.onProposal(null); } onChange(withFrame(mark, n)); }
  };
  const words = markWords(mark);
  const nFaces = prop?.faces.length ?? 0;
  const eyesNote = failed ? eS.failed : closer ? eS.closer : prop
    ? (prop.outcome === 'none' ? eS.none : prop.outcome === 'too_many' ? eS.tooMany : prop.chosen !== null && nFaces > 1 ? eS.chosenFace(letterIndex(prop.chosen, nFaces, lang)) : nFaces === 1 ? eS.one : eS.many(nFaces))
    : running ? eS.running : '';
  const first = mark.eyes?.[0] ?? mark.clicks[0] ?? null, second = mark.eyes?.[1] ?? null;
  const dot = (p: EyePoint, state: 'first' | 'second') => (
    <span key={state} className={`pf-growing-point is-${state}`} data-testid={ID.markPoint} data-state={state} style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%` }}><i>{state === 'first' ? '1' : '2'}</i></span>
  );
  return (
    <div className="pf-growing-markview" dir="ltr" data-testid={ID.markView} data-asset-id={asset.id} data-state={words}>
      {isVideo && (
        <div className="pf-growing-frame" tabIndex={0} role="spinbutton" aria-label={S.frameStepper} aria-valuenow={mark.frame ?? 0} aria-valuemin={0} aria-valuemax={lastFrameOf(asset)}
          aria-valuetext={S.frameOf(mark.frame ?? 0, lastFrameOf(asset))} data-testid={ID.markFrame} data-frame={mark.frame ?? 0} onKeyDown={onFrameKey}>
          <bdi>{S.frameOf(mark.frame ?? 0, lastFrameOf(asset))}</bdi>
        </div>
      )}
      <div ref={stageRef} className="pf-growing-stage" tabIndex={0} role="group" aria-label={`${asset.name}. ${S.markHelp}`} onKeyDown={onKey} onClick={onClick} style={{ aspectRatio: `${shown.width} / ${shown.height}` }}>
        <canvas ref={canvasRef} className="pf-growing-canvas" aria-hidden="true" />
        {first && dot(first, 'first')}{second && dot(second, 'second')}
        {prop && (
          <div className="pf-eyes-proposal" data-testid={EID.proposal} data-outcome={prop.outcome} aria-hidden="true">
            {prop.faces.map((f, face) => {
              const L = letterIndex(face, nFaces, lang), chosen = prop.chosen === face, ord = orderedEyes(f, shown, order);
              const mid = { u: (f[0].u + f[1].u) / 2, v: (f[0].v + f[1].v) / 2 };
              return (
                <span key={face} className="pf-eyes-face" data-chosen={chosen}>
                  {ord.map((p, k) => (
                    <span key={k} className={`pf-growing-point is-proposal${chosen ? ' is-chosen' : ''}`} data-testid={EID.ring} data-face={L} data-state={k === 0 ? 'first' : 'second'} data-chosen={chosen} style={{ left: `${p.u * 100}%`, top: `${p.v * 100}%` }} />
                  ))}
                  {nFaces > 1 && <span className={`pf-eyes-letter${chosen ? ' is-chosen' : ''}`} data-testid={EID.face} data-face={L} style={{ left: `${mid.u * 100}%`, top: `${mid.v * 100}%` }}>{eS.faceLetter(L)}</span>}
                </span>
              );
            })}
          </div>
        )}
        <span className="pf-growing-cross" data-testid={ID.markCrosshair} style={{ left: `${cross.u * 100}%`, top: `${cross.v * 100}%` }} aria-hidden="true" />
      </div>
      <p className="pf-growing-note" role="status" aria-live="polite">{note}</p>
      {err && <p className="pf-growing-error" role="alert">{err}</p>}
      <p className="pf-growing-note" role="status" aria-live="polite" id="eyes-note-line" data-testid={EID.note}>{eyesNote}</p>
      <div className="pf-growing-row" dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <button type="button" className="pf-growing-btn" data-testid={ID.markSwap} disabled={!mark.eyes} onClick={() => onChange(swapEyes(mark))}>{S.swap}</button>
        <button type="button" className="pf-growing-btn" data-testid={ID.markClear} disabled={mark.clicks.length === 0} onClick={() => onChange(clearMark(mark))}>{S.clearMark}</button>
        {eyes && setup && !running && (
          <button type="button" className="pf-growing-btn" data-testid={EID.suggest} data-code={setup.code} disabled={setup.code !== 'ready'} aria-describedby={setup.code !== 'ready' ? 'eyes-state-line' : undefined} onClick={suggest}>{eS.suggest}</button>
        )}
        {eyes && running && <button type="button" className="pf-growing-btn" data-testid={EID.stop} onClick={() => { stopEyes(); setNote(eS.dropped); }}>{eS.stop}</button>}
        {eyes && prop?.outcome === 'faces' && (
          <button type="button" className="pf-growing-btn" data-testid={EID.accept} disabled={prop.chosen === null} aria-describedby={prop.chosen === null ? 'eyes-note-line' : undefined} onClick={accept}>{eS.accept}</button>
        )}
        {eyes && setup && setup.code !== 'ready' && (
          <span id="eyes-state-line" className="pf-growing-muted" data-testid={EID.state} data-code={setup.code}>{setup.code === 'unknown' ? eS.setupUnknown : eS.setup(setup.code, { ...(setup.module ? { module: setup.module } : {}), bytes: setup.missingBytes })}</span>
        )}
      </div>
      {eyes && <p className="pf-growing-muted" data-testid={EID.privacy} dir={lang === 'he' ? 'rtl' : 'ltr'}>{eS.privacy}</p>}
    </div>
  );
}
