/**
 * Source viewer: look at one library file on its own, mark an in point and an out point, and add just that stretch to the timeline.
 * The file is shown by the same evaluator, compositor and sound path as the timeline (a one-clip document that is never saved),
 * so what is seen here is what the clip will show. In and out are whole frames of the project's frame rate.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type Asset, type ProjectDocument } from '@pulseframe/core';
import { Player } from '../player.ts';
import { describeError } from './ProjectsDialog.tsx';
import { useEditorState } from './store.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** A document holding only this file as one clip from its first frame, in the project's rate; the frame is the file's own picture shape. */
export function sourceDocument(project: ProjectDocument, asset: Asset): ProjectDocument {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const base = createProject({ id: 'prj_source_viewer', name: asset.name, width: even(asset.video?.width ?? 640), height: even(asset.video?.height ?? 120), frameRate: project.settings.frameRate, sampleRate: project.settings.sampleRate });
  base.assets[asset.id] = asset;
  return applyTransaction(base, [{ op: 'add_clip', args: { assetId: asset.id, start: T.ZERO } }], { idSeed: 'src_', actor: 'source-viewer' }).doc;
}

export function SourceViewer({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const { editor, state, t } = useEditorState();
  const asset = state.doc?.assets[assetId];
  const rate = editor.rate;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inFrame, setIn] = useState(0);
  const [outFrame, setOut] = useState<number | null>(null); // exclusive; null = the end of the file
  // Built once per file: later project edits do not matter to the viewer.
  const doc = useMemo(() => { try { return state.doc && asset ? sourceDocument(state.doc, asset) : null; } catch (e) { return e instanceof Error ? e : new Error(String(e)); } }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    editor.player?.pause(); // one thing plays at a time
    const canvas = canvasRef.current;
    if (!canvas || !editor.pool || !doc || doc instanceof Error) { if (doc instanceof Error) setErr(doc.message); return; }
    const p = new Player(canvas, editor.pool, () => setTick((x) => x + 1), (e) => setErr(describeError(e)));
    playerRef.current = p;
    p.setDoc(doc);
    closeRef.current?.focus();
    return () => { playerRef.current = null; p.dispose(); };
  }, [doc, editor]);

  const p = playerRef.current;
  const total = p?.frameCount ?? 0;
  const frame = p?.frame ?? 0;
  const end = outFrame ?? total;
  const tc = (f: number) => T.toTimecode(T.frameTime(f, rate), rate);
  const seek = useCallback((f: number) => { const pl = playerRef.current; if (pl) pl.seek(Math.max(0, Math.min(f, pl.frameCount - 1))); }, []);
  const toggle = useCallback(() => { const pl = playerRef.current; if (!pl) return; if (pl.playing) pl.pause(); else void pl.play(); }, []);
  const markIn = useCallback(() => { const f = playerRef.current?.frame ?? 0; setIn(f); setOut((o) => (o !== null && o <= f ? null : o)); }, []);
  const markOut = useCallback(() => { const f = (playerRef.current?.frame ?? 0) + 1; setOut(f); setIn((i) => (i >= f ? 0 : i)); }, []); // the frame under the playhead is the last one included
  /** Ripple insert at the timeline playhead: open a gap of the range's length there and place the range in it, as one transaction. */
  const insert = async () => {
    if (!asset || end <= inFrame) return;
    setBusy(true); setErr(null);
    try {
      playerRef.current?.pause();
      const at = T.frameTime(editor.frame, rate), duration = T.frameTime(end - inFrame, rate);
      await editor.commit([{ op: 'insert_gap', args: { at, duration } }, { op: 'add_clip', args: { assetId, start: at, sourceIn: T.frameTime(inFrame, rate), duration } }], 'Insert clip');
      onClose();
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const add = async () => {
    if (!asset || end <= inFrame) return;
    setBusy(true); setErr(null);
    try {
      playerRef.current?.pause();
      const whole = inFrame === 0 && outFrame === null;
      await editor.commit([{ op: 'add_clip', args: { assetId, start: editor.appendPoint(), ...(whole ? {} : { sourceIn: T.frameTime(inFrame, rate), duration: T.frameTime(end - inFrame, rate) }) } }], 'Add clip');
      onClose();
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    const onDocKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onDocKey, true);
    return () => document.removeEventListener('keydown', onDocKey, true);
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName) && (e.target as HTMLInputElement).type !== 'range';
    if (e.key === 'Tab') {
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!nodes.length) return;
      const first = nodes[0]!, last = nodes[nodes.length - 1]!, at = document.activeElement;
      if (e.shiftKey && (at === first || !dialogRef.current?.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !dialogRef.current?.contains(at))) { e.preventDefault(); first.focus(); }
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = (e.target as HTMLElement).tagName === 'BUTTON';
    if (e.code === 'KeyI') { e.preventDefault(); markIn(); }
    else if (e.code === 'KeyO') { e.preventDefault(); markOut(); }
    else if (e.code === 'Space' && !onButton) { e.preventDefault(); toggle(); } // on a button, Space presses that button
    else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(frame - (e.shiftKey ? 10 : 1)); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); seek(frame + (e.shiftKey ? 10 : 1)); }
  };

  if (!asset) return null;
  return (
    <div className="pf-dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialogRef} className="pf-dlg source-viewer" role="dialog" aria-modal="true" aria-label={`${t('source.title')}: ${asset.name}`} data-testid="source-viewer" onKeyDown={onKey}>
        <div className="pf-dlg-head">
          <h2>{t('source.title')}: <bdi dir="auto">{asset.name}</bdi></h2>
          <button ref={closeRef} type="button" className="ghost" onClick={onClose} aria-label={t('projects.close')} data-testid="source-close">×</button>
        </div>
        <canvas ref={canvasRef} className={`source-canvas${asset.video ? '' : ' sound-only'}`} data-testid="source-canvas" aria-label={t('source.picture')} role="img" />
        <div className="row" dir="ltr">
          <button type="button" className="ghost" onClick={() => seek(frame - 1)} aria-label={t('frame.prev')}>◀︎</button>
          <button type="button" className="primary" onClick={toggle} aria-label={p?.playing ? t('pause') : t('play')} data-testid="source-play">{p?.playing ? '❚❚' : '▶'}</button>
          <button type="button" className="ghost" onClick={() => seek(frame + 1)} aria-label={t('frame.next')}>▶︎</button>
          <span className="timecode" data-testid="source-timecode">{tc(frame)}</span>
          <span className="muted">/ {tc(total)}</span>
        </div>
        <input type="range" dir="ltr" min={0} max={Math.max(0, total - 1)} step={1} value={frame} onChange={(e) => seek(Number(e.target.value))} aria-label={t('source.position')} data-testid="source-scrub" />
        <div className="row">
          <button type="button" className="ghost" onClick={markIn} data-testid="source-mark-in">{t('source.markIn')} (I)</button>
          <button type="button" className="ghost" onClick={markOut} data-testid="source-mark-out">{t('source.markOut')} (O)</button>
          <button type="button" className="ghost" disabled={inFrame === 0 && outFrame === null} onClick={() => { setIn(0); setOut(null); }} data-testid="source-clear">{t('source.clear')}</button>
        </div>
        <p role="status" data-testid="source-range" data-in={inFrame} data-out={end}>
          {t('source.range')}: <bdi dir="ltr">{tc(inFrame)} – {tc(end)}</bdi> · <bdi dir="ltr">{end - inFrame}</bdi> {t('source.frames')}
        </p>
        <div className="row">
          <button type="button" className="primary" disabled={busy || end <= inFrame || total === 0} onClick={() => void add()} data-testid="source-add">{t('source.add')}</button>
          <button type="button" className="ghost" disabled={busy || end <= inFrame || total === 0} onClick={() => void insert()} data-testid="source-insert">{t('source.insert')} <bdi dir="ltr">({T.toTimecode(T.frameTime(editor.frame, rate), rate)})</bdi></button>
        </div>
        {err && <p className="muted danger" role="alert" data-testid="source-error">{err}</p>}
      </div>
    </div>
  );
}
