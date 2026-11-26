/**
 * The depth dialog «ציור עומק» (wave 8 living track). A modal (design-system Dialog: focus kept inside, Escape cancels, focus returns
 * to what opened it). The photo upright at fit size with the nearness drawn over it from core depthGrid itself (light = near, dark =
 * far, at 50%, the legend in words), so what is painted is the grid the pass reads. Tools: horizon (drag, or arrow keys in 1/100 steps
 * on the picture), a soft brush near / far (keys 1 / 2), brush size, undo the last stroke (button, Ctrl+Z inside the dialog), clear,
 * flat, Save (the caller commits once) and Cancel. Nothing is stored before Save. Test ids: living.testids.ts.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { depthGrid, MAX_DEPTH_NUMBERS, MAX_DEPTH_STROKES, type ClipDepth, type DepthGrid, type DepthStroke } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Dialog } from '../../ds/index.ts';
import { api } from '../../api.ts';
import { livingT } from './living.strings.ts';
import { LIVING_TESTIDS as ID } from './living.testids.ts';
import {
  addStroke, atLimit, canAddStroke, clearStrokes, extendStroke, horizonAfterKey, horizonOf, newStroke, overlayPixels, popStroke, setFlat, setHorizon, toUnits,
} from './living.logic.ts';
import './living.css';

export interface DepthDialogProps {
  /** the clip's depth, or core LIVING_RAMP_START when it has none (shown, never stored until Save) */
  start: ClipDepth;
  /** the picture as shown (asset image width/height): only the aspect counts */
  shown: { width: number; height: number };
  lang?: Lang;
  projectId?: string;
  assetId?: string;
  /** Save: the caller commits once; a returned string is a refusal in words, shown here and the dialog stays open */
  onSave(depth: ClipDepth): void | Promise<string | null>;
  onCancel(): void;
}
type Tool = 'horizon' | 'near' | 'far';
const W = 560;

export function DepthDialog({ start, shown, lang = 'he', projectId, assetId, onSave, onCancel }: DepthDialogProps) {
  const t = livingT(lang);
  const [depth, setDepth] = useState<ClipDepth>(start);
  const [tool, setTool] = useState<Tool>(start.strokes.length ? 'near' : 'horizon');
  const [size, setSize] = useState(60);
  const [live, setLive] = useState<DepthStroke | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<ImageBitmap | null | 'missing'>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const H = Math.max(1, Math.round((W * shown.height) / Math.max(1, shown.width)));
  const shownDepth = useMemo(() => (live ? { ...depth, strokes: [...depth.strokes, live] } : depth), [depth, live]);
  const grid = useMemo<DepthGrid | null>(() => { try { return depthGrid(shownDepth, shown); } catch { return null; } }, [shownDepth, shown]);

  useEffect(() => {
    if (!projectId || !assetId) { setPhoto('missing'); return; }
    let stop = false;
    api.assetBlob(projectId, assetId).then((b) => createImageBitmap(b)).then((bmp) => { if (!stop) setPhoto(bmp); }).catch(() => { if (!stop) setPhoto('missing'); });
    return () => { stop = true; };
  }, [projectId, assetId]);

  useEffect(() => {
    const c = canvas.current, ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    if (photo && photo !== 'missing') ctx.drawImage(photo, 0, 0, W, H);
    if (grid) {
      const off = document.createElement('canvas');
      off.width = grid.width; off.height = grid.height;
      off.getContext('2d')?.putImageData(new ImageData(overlayPixels(grid) as unknown as Uint8ClampedArray<ArrayBuffer>, grid.width, grid.height), 0, 0);
      ctx.save(); ctx.globalAlpha = 0.5; ctx.imageSmoothingEnabled = true; ctx.drawImage(off, 0, 0, W, H); ctx.restore();
    }
  }, [photo, grid, H]);

  const at = (e: PointerEvent): [number, number] => toUnits(e.clientX, e.clientY, canvas.current!.getBoundingClientRect());
  const down = (e: PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const [x, y] = at(e);
    if (tool === 'horizon') { setDepth((d) => setHorizon(d, y)); setLive(null); return; }
    if (!canAddStroke(depth)) return;
    setLive(newStroke(tool, size, x, y));
  };
  const move = (e: PointerEvent) => {
    if (e.buttons === 0 && !live) return;
    const [x, y] = at(e);
    if (tool === 'horizon') { if (e.buttons) setDepth((d) => setHorizon(d, y)); return; }
    if (live) setLive((s) => (s ? extendStroke(depth, s, x, y) : s));
  };
  const up = () => { if (live) { setDepth((d) => addStroke(d, live)); setLive(null); } };
  const undo = () => { setLive(null); setDepth((d) => popStroke(d)); };
  const h = horizonOf(depth);
  const canvasKey = (e: KeyboardEvent) => {
    if (h === null) return;
    const n = horizonAfterKey(e.key, h);
    if (n !== null) { e.preventDefault(); setTool('horizon'); setDepth((d) => setHorizon(d, n)); }
  };
  const dialogKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation?.(); undo(); return; }
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === '1') setTool('near'); else if (e.key === '2') setTool('far');
  };
  const save = async () => {
    if (busy || !grid) return;
    setBusy(true); setErr(null);
    const r = await onSave(depth);
    setBusy(false);
    if (typeof r === 'string') setErr(r);
  };
  const choose = (x: Tool) => { setTool(x); if (x === 'horizon' && h === null) setDepth((d) => setHorizon(d, 450)); };
  const used = depth.strokes.reduce((n, s) => n + s.pts.length, 0);

  return (
    <Dialog open onClose={onCancel} title={t('depth.title')} size="lg" closeLabel={t('depth.cancel')} testId={ID.dialog}
      footer={<>
        <button type="button" className="ghost" data-testid={ID.cancel} onClick={onCancel}>{t('depth.cancel')}</button>
        <button type="button" className="primary" data-testid={ID.save} disabled={busy || !grid} aria-busy={busy || undefined} onClick={() => void save()}>{t('depth.save')}</button>
      </>}>
      <div className="depth-dlg" dir={lang === 'he' ? 'rtl' : 'ltr'} lang={lang} onKeyDown={dialogKey}>
        <p className="living-line">{t('depth.start')}</p>
        <div className="depth-pic">
          <canvas ref={canvas} width={W} height={H} className="depth-canvas" data-testid={ID.canvas}
            {...(h !== null ? { role: 'slider', tabIndex: 0, 'aria-orientation': 'vertical' as const, 'aria-valuemin': 0, 'aria-valuemax': 999, 'aria-valuenow': h, 'aria-valuetext': t('depth.horizonValue', { n: h }), 'aria-label': t('depth.horizon') }
              : { role: 'img', 'aria-label': t('depth.canvasLabel') })}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={canvasKey} />
        </div>
        <p className="living-line">{t('depth.legend')}</p>
        {photo === 'missing' && <p className="living-line" role="status">{t('depth.photoMissing')}</p>}
        {!grid && <p className="living-err" role="alert">{t('depth.gridMissing')}</p>}
        <p className="living-line">{t('depth.pointerNote')} · {t('depth.keys')}</p>
        <fieldset className="depth-tools">
          <legend>{t('depth.tools')}</legend>
          <button type="button" className="ghost" aria-pressed={tool === 'horizon'} data-testid={ID.toolHorizon} onClick={() => choose('horizon')}>{t('depth.horizon')}</button>
          <button type="button" className="ghost" aria-pressed={tool === 'near'} data-testid={ID.toolNear} onClick={() => choose('near')}>{t('depth.near')}</button>
          <button type="button" className="ghost" aria-pressed={tool === 'far'} data-testid={ID.toolFar} onClick={() => choose('far')}>{t('depth.far')}</button>
        </fieldset>
        <label className="depth-size">
          <span>{t('depth.brushSize')} <bdi dir="ltr">{size}</bdi></span>
          <input type="range" min={5} max={300} step={5} value={size} data-testid={ID.brushSize} aria-valuetext={String(size)} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <div className="living-row">
          <button type="button" className="ghost" data-testid={ID.undoStroke} disabled={!depth.strokes.length} onClick={undo}>{t('depth.undoStroke')}</button>
          <button type="button" className="ghost" data-testid={ID.clear} disabled={!depth.strokes.length} onClick={() => { setLive(null); setDepth(clearStrokes); }}>{t('depth.clear')}</button>
          <button type="button" className="ghost" data-testid={ID.flat} aria-pressed={depth.base.kind === 'flat'} onClick={() => { setDepth(setFlat); if (tool === 'horizon') setTool('near'); }}>{t('depth.flat')}</button>
          <span className="living-line"><bdi dir="ltr">{depth.strokes.length}/{MAX_DEPTH_STROKES} · {used}/{MAX_DEPTH_NUMBERS}</bdi></span>
        </div>
        {atLimit(depth) && <p className="living-line" role="status">{t('depth.limit', { max: depth.strokes.length >= MAX_DEPTH_STROKES ? MAX_DEPTH_STROKES : MAX_DEPTH_NUMBERS })}</p>}
        {err && <p className="living-err" role="alert"><bdi dir="auto">{err}</bdi></p>}
      </div>
    </Dialog>
  );
}
