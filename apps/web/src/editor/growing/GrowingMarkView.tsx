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
import { GROWING_TESTIDS as ID } from './growing.testids.ts';

export interface MarkViewProps {
  lang: 'he' | 'en'; doc: ProjectDocument; asset: Asset; shown: { width: number; height: number }; mark: Mark; order: SuggestEyeOrder | null; frameLocked?: boolean;
  onChange: (m: Mark) => void; onPage: (d: -1 | 1) => void;
}
export function GrowingMarkView({ lang, doc, asset, shown, mark, order, frameLocked, onChange, onPage }: MarkViewProps): ReactElement {
  const { editor } = useEditorState();
  const S = growingStrings(lang);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [cross, setCross] = useState<EyePoint>({ u: 0.5, v: 0.5 });
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const isVideo = !!asset.video;
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
  const onClick = (e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const p = rect ? uvFromClient(e.clientX, e.clientY, rect) : null;
    if (p) { setCross(p); place(p); }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey) return;
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
    if (n !== null) { e.preventDefault(); onChange(withFrame(mark, n)); }
  };
  const words = markWords(mark);
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
      <div className="pf-growing-stage" tabIndex={0} role="group" aria-label={`${asset.name}. ${S.markHelp}`} onKeyDown={onKey} onClick={onClick} style={{ aspectRatio: `${shown.width} / ${shown.height}` }}>
        <canvas ref={canvasRef} className="pf-growing-canvas" aria-hidden="true" />
        {first && dot(first, 'first')}{second && dot(second, 'second')}
        <span className="pf-growing-cross" data-testid={ID.markCrosshair} style={{ left: `${cross.u * 100}%`, top: `${cross.v * 100}%` }} aria-hidden="true" />
      </div>
      <p className="pf-growing-note" role="status" aria-live="polite">{note}</p>
      {err && <p className="pf-growing-error" role="alert">{err}</p>}
      <div className="pf-growing-row" dir={lang === 'he' ? 'rtl' : 'ltr'}>
        <button type="button" className="pf-growing-btn" data-testid={ID.markSwap} disabled={!mark.eyes} onClick={() => onChange(swapEyes(mark))}>{S.swap}</button>
        <button type="button" className="pf-growing-btn" data-testid={ID.markClear} disabled={mark.clicks.length === 0} onClick={() => onChange(clearMark(mark))}>{S.clearMark}</button>
      </div>
    </div>
  );
}
