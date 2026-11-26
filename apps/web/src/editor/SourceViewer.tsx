/**
 * Source viewer: look at one library file on its own, mark an in point and an out point, and add just that stretch to the timeline.
 * The file is shown by the same evaluator, compositor and sound path as the timeline (a one-clip document that is never saved),
 * so what is seen here is what the clip will show. In and out are whole frames of the project's frame rate.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { type SourceSpan } from '@pulseframe/core';
import { sourceDocument } from './sourceDocument.ts';
import { Player } from '../player.ts';
import { describeError } from './ProjectsDialog.tsx';
import { focusNow } from '../ds/focus.ts';
import { useEditorState } from './store.ts';
import { placementLabel, placementOps } from './placement.range.ts';
import { PearlForm } from './pearls/PearlForm.tsx';
import { PearlStrip } from './pearls/PearlStrip.tsx';
import { spanOfMarks } from './pearls/pearls.logic.ts';
import { pearlsT } from './pearls/pearls.strings.ts';
import { PEARLS_TESTIDS as PEARL_ID } from './pearls/pearls.testids.ts';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export { sourceDocument } from './sourceDocument.ts';

/**
 * `startAt`: where the viewer opens, in the file's own time (the Shorts review opens a candidate at its context start). A view only,
 * never an edit. `initialSpan`: a stretch of the file to start with as the in and out points (the pearls list shows a pearl).
 */
export function SourceViewer({ assetId, onClose, startAt, initialSpan }: { assetId: string; onClose: () => void; startAt?: T.RationalTime; initialSpan?: SourceSpan }) {
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
  const [inFrame, setIn] = useState(() => (initialSpan ? Math.max(0, T.frameIndexAt(initialSpan.start, editor.rate)) : 0));
  const [outFrame, setOut] = useState<number | null>(() => { // exclusive; null = the end of the file
    if (!initialSpan) return null;
    const k = T.frameIndexAt(initialSpan.end, editor.rate);
    return T.lt(T.frameTime(k, editor.rate), initialSpan.end) ? k + 1 : k;
  });
  const [formOpen, setFormOpen] = useState(false); // «שמור כפנינה»: the inline form (wave 7 pearls)
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const P = pearlsT(state.lang);
  // Target tracks for add / insert / overwrite: '' = automatic (the first unlocked track with room).
  const [vTarget, setVTarget] = useState(() => editor.target('video') ?? ''); // starts from the timeline's target tracks
  const [aTarget, setATarget] = useState(() => editor.target('audio') ?? '');
  // Built once per file: later project edits do not matter to the viewer.
  const doc = useMemo(() => { try { return state.doc && asset ? sourceDocument(state.doc, asset) : null; } catch (e) { return e instanceof Error ? e : new Error(String(e)); } }, [assetId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    editor.player?.pause(); // one thing plays at a time
    const canvas = canvasRef.current;
    if (!canvas || !editor.pool || !doc || doc instanceof Error) { if (doc instanceof Error) setErr(doc.message); return; }
    const p = new Player(canvas, editor.pool, () => setTick((x) => x + 1), (e) => setErr(describeError(e)));
    playerRef.current = p;
    p.sharpness = editor.getState().playSharpness; // the viewer's choice of the playing picture (Settings), as in the main preview
    p.setDoc(doc);
    if (startAt) { const f = Math.max(0, T.frameIndexAt(startAt, editor.rate)); void Promise.resolve().then(() => playerRef.current === p && p.seek(Math.min(f, Math.max(0, p.frameCount - 1)))); }
    closeRef.current?.focus();
    return () => { playerRef.current = null; p.dispose(); };
  }, [doc, editor]);
  useEffect(() => { if (playerRef.current) playerRef.current.sharpness = state.playSharpness; }, [state.playSharpness]);

  const liveTracks = state.doc ? state.doc.sequences[state.doc.mainSequenceId]!.tracks : [];
  const hasPicture = !!asset && (!!asset.video || asset.kind === 'image'), hasSound = !!asset?.audio;
  const vTracks = hasPicture ? liveTracks.filter((tr) => tr.kind === 'video' && !tr.locked) : [];
  const aTracks = hasSound ? liveTracks.filter((tr) => tr.kind === 'audio' && !tr.locked) : [];
  const vChosen = vTracks.find((tr) => tr.id === vTarget), aChosen = aTracks.find((tr) => tr.id === aTarget); // a target that was removed or locked meanwhile falls back to automatic
  /** `add_clip` arguments naming the chosen tracks: the picture track (or the sound track of a sound-only file) and the linked sound's track. */
  const targetArgs = () => (hasPicture ? { ...(vChosen ? { trackId: vChosen.id } : {}), ...(aChosen ? { audioTrackId: aChosen.id } : {}) } : aChosen ? { trackId: aChosen.id } : {});
  const p = playerRef.current;
  const total = p?.frameCount ?? 0;
  const frame = p?.frame ?? 0;
  const end = outFrame ?? total;
  const tc = (f: number) => T.toTimecode(T.frameTime(f, rate), rate);
  const seek = useCallback((f: number) => { const pl = playerRef.current; if (pl) pl.seek(Math.max(0, Math.min(f, pl.frameCount - 1))); }, []);
  const toggle = useCallback(() => { const pl = playerRef.current; if (!pl) return; if (pl.playing) pl.pause(); else void pl.play(); }, []);
  const markIn = useCallback(() => { const f = playerRef.current?.frame ?? 0; setIn(f); setOut((o) => (o !== null && o <= f ? null : o)); }, []);
  const markOut = useCallback(() => { const f = (playerRef.current?.frame ?? 0) + 1; setOut(f); setIn((i) => (i >= f ? 0 : i)); }, []); // the frame under the playhead is the last one included
  /** The three placements are made by the pure builder placement.range.ts (the pearls list makes the same operations). */
  const place = async (mode: 'add' | 'insert' | 'overwrite') => {
    const d = editor.doc;
    if (!asset || !d || end <= inFrame) return;
    setBusy(true); setErr(null);
    try {
      playerRef.current?.pause();
      const duration = T.frameTime(end - inFrame, rate), sourceIn = T.frameTime(inFrame, rate);
      const named = hasPicture ? { ...(vChosen ? { trackId: vChosen.id } : {}), ...(aChosen ? { audioTrackId: aChosen.id } : {}) } : aChosen ? { trackId: aChosen.id } : {};
      let ops;
      if (mode === 'add') {
        const whole = inFrame === 0 && outFrame === null;
        ops = placementOps({ mode, assetId, at: editor.appendPoint(), range: whole ? null : { sourceIn, duration }, ...named });
      } else if (mode === 'insert') {
        ops = placementOps({ mode, assetId, at: T.frameTime(editor.frame, rate), range: { sourceIn, duration }, ...named });
      } else {
        // clear the range's length on the target picture track and the target sound track (the chosen ones, else the first unlocked; nothing moves)
        const tracks = d.sequences[d.mainSequenceId]!.tracks;
        const v = hasPicture ? vChosen ?? tracks.find((tr) => tr.kind === 'video' && !tr.locked) : undefined;
        const a = asset.audio ? aChosen ?? tracks.find((tr) => tr.kind === 'audio' && !tr.locked) : undefined;
        const clearTrackIds = [v, a].filter((tr): tr is NonNullable<typeof tr> => !!tr).map((tr) => tr.id);
        ops = placementOps({ mode, assetId, at: T.frameTime(editor.frame, rate), range: { sourceIn, duration }, clearTrackIds,
          ...(hasPicture ? { ...(v ? { trackId: v.id } : {}), ...(a ? { audioTrackId: a.id } : {}) } : a ? { trackId: a.id } : {}) });
      }
      await editor.commit(ops, placementLabel(mode));
      onClose();
    } catch (e) { setErr(describeError(e)); } finally { setBusy(false); }
  };
  const insert = () => place('insert');
  const overwrite = () => place('overwrite');
  const add = () => place('add');

  // «שמור כפנינה» (wave 7 pearls): the marks as a span of the file; null = the whole file (nothing marked, or a photo)
  const markedSpan = (): SourceSpan | null => (asset ? spanOfMarks({ inFrame, outFrame, rate, duration: asset.duration, isImage: asset.kind === 'image' }) : null);
  const openForm = () => { playerRef.current?.pause(); setSavedNote(null); setFormOpen(true); };
  // the save button stays in the page while the form is open: the focus goes to it first, then the form closes, in this task
  const closeForm = useCallback(() => { focusNow(saveRef.current); setFormOpen(false); }, []);

  useEffect(() => {
    // an open pearl form owns Escape (its own listener runs first and prevents the default): the viewer stays open then
    const onDocKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); onClose(); } };
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
    else if (e.code === 'KeyP' && !formOpen) { e.preventDefault(); openForm(); }
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
        <PearlStrip assetId={assetId} />
        <div className="row">
          <button ref={saveRef} type="button" className="ghost" aria-expanded={formOpen} onClick={() => (formOpen ? closeForm() : openForm())} data-testid={PEARL_ID.save}>{P('save')} (P)</button>
          {savedNote && <span role="status" className="muted" data-testid="pearl-saved-note">{savedNote}</span>}
        </div>
        {formOpen && <PearlForm assetId={assetId} span={markedSpan()} rate={rate} onCancel={closeForm} onSaved={() => { focusNow(saveRef.current); setFormOpen(false); setSavedNote(P('saved')); }} />}
        <p role="status" data-testid="source-range" data-in={inFrame} data-out={end}>
          {t('source.range')}: <bdi dir="ltr">{tc(inFrame)} – {tc(end)}</bdi> · <bdi dir="ltr">{end - inFrame}</bdi> {t('source.frames')}
        </p>
        {(vTracks.length > 0 || aTracks.length > 0) && (
          <div className="fields" data-testid="source-targets">
            {vTracks.length > 0 && (
              <label>{t('source.target.picture')}
                <select value={vChosen ? vTarget : ''} onChange={(e) => setVTarget(e.target.value)} data-testid="source-target-picture">
                  <option value="">{t('source.target.auto')}</option>
                  {vTracks.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                </select>
              </label>
            )}
            {aTracks.length > 0 && (
              <label>{t('source.target.sound')}
                <select value={aChosen ? aTarget : ''} onChange={(e) => setATarget(e.target.value)} data-testid="source-target-sound">
                  <option value="">{t('source.target.auto')}</option>
                  {aTracks.map((tr) => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
                </select>
              </label>
            )}
          </div>
        )}
        <div className="row">
          <button type="button" className="primary" disabled={busy || end <= inFrame || total === 0} onClick={() => void add()} data-testid="source-add">{t('source.add')}</button>
          <button type="button" className="ghost" disabled={busy || end <= inFrame || total === 0} onClick={() => void insert()} data-testid="source-insert">{t('source.insert')} <bdi dir="ltr">({T.toTimecode(T.frameTime(editor.frame, rate), rate)})</bdi></button>
          <button type="button" className="ghost" disabled={busy || end <= inFrame || total === 0} onClick={() => void overwrite()} data-testid="source-overwrite">{t('source.overwrite')}</button>
        </div>
        {err && <p className="muted danger" role="alert" data-testid="source-error">{err}</p>}
      </div>
    </div>
  );
}
