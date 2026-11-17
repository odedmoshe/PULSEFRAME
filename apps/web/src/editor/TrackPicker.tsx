/**
 * Picking a point or an area of a clip's picture on the program monitor, to start a motion track (ADR-0015).
 * An overlay over the displayed canvas like the canvas handles (CanvasHandles.tsx: the same measured rect, geometry in
 * physical left/top, dir=ltr): a click makes a point, a drag makes a box. Keyboard: arrows move the pick one frame pixel
 * (Shift: ten), Alt with the arrows resizes a box, Enter confirms, Escape cancels; where the pick is, is announced.
 * The seed frame is the source frame the evaluator shows at the playhead (layer.sourceFrameIndex), never the playhead time,
 * so speed, reverse, slips and freezes all name the right picture. Confirming commits create_motion_track (one undo step).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { findClip } from '@pulseframe/core';
import { boxToTrackUnits, frameToLayerSource, frameToScreen, layerSourceToFrame, screenToFrame, toTrackUnits, type FrameBox, type LayerPlacement } from './tracking.math.ts';
import { pickAnnouncement, TRACKING_TESTIDS as ID, trackingT } from './tracking.strings.ts';
import { useEditorState, type Editor } from './store.ts';
import './tracking.css';

/** The pick in frame px: a point, or a box (centre and size along the frame axes). */
interface Sel { px: number; py: number; w?: number; h?: number }
/** A drag shorter than this (screen px) is a click. */
const CLICK_PX = 4;
const MIN_BOX_PX = 4;

/** The target clip's picture at the playhead, placed as the compositor places it; null when it is not drawn there. */
function targetNow(editor: Editor, clipId: string): { frame: FrameBox; layer: LayerPlacement; sourceFrame: number } | null {
  const at = editor.layerAt(clipId);
  if (!at || at.layer.kind !== 'video') return null;
  const l = at.layer;
  return { frame: { W: at.graph.width, H: at.graph.height, fit: at.graph.fit }, layer: { srcW: l.sourceWidth, srcH: l.sourceHeight, transform: l.transform }, sourceFrame: l.sourceFrameIndex };
}

export function TrackPicker(props: { canvas: HTMLCanvasElement | null }) {
  const { editor, state } = useEditorState();
  const { canvas } = props;
  const pick = state.picker;
  const tt = trackingT(state.lang);
  const root = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; sx: number; sy: number; moved: boolean } | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [sel, setSel] = useState<Sel | null>(null);
  const [live, setLive] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const measure = (parent: HTMLElement) => {
    const c = canvas!.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return { left: c.left - p.left + parent.scrollLeft - parent.clientLeft, top: c.top - p.top + parent.scrollTop - parent.clientTop, width: c.width, height: c.height };
  };
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!canvas || !parent || !pick) return;
    const next = measure(parent);
    setRect((r) => (r.left === next.left && r.top === next.top && r.width === next.width && r.height === next.height ? r : next));
  });
  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!canvas || !parent || !pick || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRect(measure(parent)));
    ro.observe(canvas);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvas, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new pick starts in the middle of the picture: a point, or a square area a fifth of the picture's drawn height.
  const key = pick ? `${pick.kind}:${pick.clipId}` : '';
  useEffect(() => {
    if (!pick) { setSel(null); setErr(null); return; }
    const tg = targetNow(editor, pick.clipId);
    if (!tg) { setSel(null); setErr(tt('mtrack.pick.noPicture')); }
    else {
      const c = layerSourceToFrame(tg.frame, tg.layer, 0.5, 0.5);
      const side = Math.max(MIN_BOX_PX, Math.round(Math.abs(tg.layer.transform.scale) * Math.min(tg.frame.H, tg.frame.W) * 0.2));
      setSel(pick.kind === 'point' ? { px: c.px, py: c.py } : { px: c.px, py: c.py, w: side, h: side });
      setErr(null);
    }
    setLive(`${tt(pick.kind === 'point' ? 'mtrack.pick.point' : 'mtrack.pick.region')}. ${tt('mtrack.pick.help')}`);
    const id = window.setTimeout(() => surface.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const shell = <div className="tp-clip" data-testid="track-picker-clip"><div ref={root} className="tp-root" dir="ltr" style={{ display: 'none' }} /></div>;
  if (!pick || !canvas) return shell;
  const doc = state.doc;
  if (!doc || !findClip(doc, pick.clipId)) return shell;

  const tg = targetNow(editor, pick.clipId);
  const frameW = tg?.frame.W ?? editor.viewDoc?.settings.width ?? 1;
  const announce = (s: Sel, t = tg) => {
    if (!t) return;
    const c = frameToLayerSource(t.frame, t.layer, s.px, s.py);
    const scale = Math.abs(t.layer.transform.scale) || 1;
    const fitW = t.layer.srcW * (t.frame.fit === 'cover' ? Math.max(t.frame.W / t.layer.srcW, t.frame.H / t.layer.srcH) : Math.min(t.frame.W / t.layer.srcW, t.frame.H / t.layer.srcH));
    const fitH = (fitW * t.layer.srcH) / t.layer.srcW;
    setLive(pickAnnouncement(state.lang, { x: c.u, y: c.v, ...(s.w !== undefined ? { w: s.w / (fitW * scale), h: (s.h ?? 0) / (fitH * scale) } : {}), frame: t.sourceFrame }));
  };
  const update = (s: Sel) => { setSel(s); setErr(null); announce(s); };
  const close = () => {
    const kind = pick.kind;
    editor.closePicker();
    // the focus goes back to the button that opened the picker
    window.setTimeout(() => document.querySelector<HTMLElement>(`[data-testid=${kind === 'point' ? ID.newPoint : ID.newRegion}]`)?.focus(), 0);
  };
  const confirm = async () => {
    if (busy) return;
    const t = targetNow(editor, pick.clipId); // read when used: the playhead may have moved since the last paint
    if (!t) { setErr(tt('mtrack.pick.noPicture')); return; }
    if (!sel) return;
    let args: Record<string, unknown>;
    if (sel.w === undefined) {
      const s = frameToLayerSource(t.frame, t.layer, sel.px, sel.py);
      if (!(s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1)) { setErr(tt('mtrack.pick.outside')); return; }
      args = { kind: 'point', ...toTrackUnits(s.u, s.v) };
    } else {
      const b = boxToTrackUnits(t.frame, t.layer, { px: sel.px, py: sel.py, w: sel.w, h: sel.h ?? sel.w });
      if (!b) { setErr(tt('mtrack.pick.outside')); return; }
      args = { kind: 'region', ...b };
    }
    const kind = args.kind as 'point' | 'region';
    const n = Object.values(editor.doc?.motionTracks ?? {}).filter((m) => m.assetId === pick.assetId).length;
    setBusy(true);
    try {
      const r = await editor.commit([{ op: 'create_motion_track', args: { assetId: pick.assetId, name: `${tt(kind === 'point' ? 'mtrack.name.point' : 'mtrack.name.region')} ${n + 1}`, frame: t.sourceFrame, ...args } }], 'Create motion track');
      const id = r?.results[0]?.output?.motionTrackId as string | undefined;
      if (id) { editor.set({ activeTrackId: id }); close(); } // the tracking panel says that it was created
      else { const why = editor.getState().error; if (why) setErr(why); }
    } finally { setBusy(false); }
  };
  const cancel = () => close();

  const local = (e: { clientX: number; clientY: number }) => { const r = root.current!.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !tg) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const p = local(e);
    drag.current = { pointerId: e.pointerId, sx: p.sx, sy: p.sy, moved: false };
  };
  const boxFrom = (a: { sx: number; sy: number }, b: { sx: number; sy: number }): Sel => {
    const p = screenToFrame(a.sx, a.sy, rect.width, frameW), q = screenToFrame(b.sx, b.sy, rect.width, frameW);
    return { px: (p.px + q.px) / 2, py: (p.py + q.py) / 2, w: Math.max(MIN_BOX_PX, Math.abs(q.px - p.px)), h: Math.max(MIN_BOX_PX, Math.abs(q.py - p.py)) };
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = local(e);
    if (!d.moved && Math.hypot(p.sx - d.sx, p.sy - d.sy) < CLICK_PX) return;
    d.moved = true;
    setSel(boxFrom(d, p));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    const p = local(e);
    if (d.moved) update(boxFrom(d, p));
    else { const f = screenToFrame(p.sx, p.sy, rect.width, frameW); update({ px: f.px, py: f.py }); }
  };
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // the picker owns these keys while it has the focus: they never reach the editor's shortcuts
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (drag.current) { drag.current = null; return; } cancel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void confirm(); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    if (!sel) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.altKey) {
      if (sel.w === undefined) { setLive(tt('mtrack.pick.noSize')); return; }
      // right/up make the area wider/taller, left/down narrower/lower
      update({ ...sel, w: Math.max(MIN_BOX_PX, sel.w + a[0] * step), h: Math.max(MIN_BOX_PX, (sel.h ?? sel.w) - a[1] * step) });
      return;
    }
    update({ ...sel, px: sel.px + a[0] * step, py: sel.py + a[1] * step });
  };

  const markAt = sel ? frameToScreen(sel.px, sel.py, rect.width, frameW) : null;
  const k = rect.width / frameW;
  const kindNow = sel?.w === undefined ? 'point' : 'region';
  const title = tt(pick.kind === 'point' ? 'mtrack.pick.point' : 'mtrack.pick.region');
  return (
    <>
      <div className="tp-clip" data-testid="track-picker-clip">
        <div ref={root} className="tp-root" dir="ltr" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
          <div ref={surface} className="tp-surface" tabIndex={0} role="group" aria-label={title} aria-describedby="tp-help" data-testid={ID.picker} data-kind={kindNow}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onKeyDown={onKey}>
            {sel && markAt && (sel.w === undefined
              ? <span className="tp-point" aria-hidden="true" data-testid={ID.pickerMark} data-kind="point" style={{ left: markAt.sx, top: markAt.sy }} />
              : <span className="tp-box" aria-hidden="true" data-testid={ID.pickerMark} data-kind="region" style={{ left: markAt.sx - (sel.w * k) / 2, top: markAt.sy - ((sel.h ?? sel.w) * k) / 2, width: sel.w * k, height: (sel.h ?? sel.w) * k }} />)}
          </div>
        </div>
      </div>
      <div className="tp-bar" role="group" aria-label={title} data-testid={ID.pickerBar}>
        <strong>{title}</strong>
        <p id="tp-help" className="tp-help">{tt('mtrack.pick.help')}</p>
        {err && <p className="tp-error" role="alert" data-testid={ID.pickerError}>{err}</p>}
        <div className="row">
          <button type="button" className="primary" disabled={!sel || !tg || busy} aria-busy={busy || undefined} data-testid={ID.pickerConfirm} onClick={() => void confirm()}>{tt('mtrack.pick.confirm')}</button>
          <button type="button" className="ghost" data-testid={ID.pickerCancel} onClick={cancel}>{tt('mtrack.pick.cancel')}</button>
        </div>
        <p className="sr-only" role="status" aria-live="polite" data-testid={ID.pickerLive}>{live}</p>
      </div>
    </>
  );
}
