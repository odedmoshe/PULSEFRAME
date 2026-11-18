import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { findClip, type Clip } from '@pulseframe/core';
import { boxToScreen, clampRotation, clampScale, clampX, edgeProxies, layerBox, rotationFromDrag, scaleFromDrag, SCALE_ANCHORS, screenDeltaToFrameFraction, type LayerHandle, type LayerTransform, type ScaleHandle } from './interactions.math.ts';
import { useEditorState, type ResolvedNow } from './store.ts';
import { MotionPath } from './MotionPath.tsx';
import './interactions.css';

type Handle = LayerHandle;
const CENTRE_SNAP_PX = 6;
/** Half the size of a handle (interactions.css), and the least distance between two grips at the viewer edge. */
const HANDLE_HALF_PX = 6;
const GRIP_GAP_PX = 16;
/** Text has no measurable box outside the canvas: nominal 80% frame width, lines x size x lineHeight tall (approximate). */
const TEXT_NOMINAL_W = 0.8;

interface Drag {
  handle: Handle;
  pointerId: number;
  startX: number;
  startY: number;
  start: LayerTransform;
  /** The clip as drawn when the drag began (for a follower: resolved, with its own offset and the follow's factor m). */
  shown: ResolvedNow;
  centre: { x: number; y: number };
  moved: boolean;
}
type Preview = Partial<LayerTransform>;

export function CanvasHandles(props: { canvas: HTMLCanvasElement | null }) {
  const { editor, state, t } = useEditorState();
  const { canvas } = props;
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0, viewW: 0, viewH: 0 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [guide, setGuide] = useState({ v: false, h: false });
  /** The handle that has the keyboard focus (:focus-visible), so a stand-in can show its ring when the handle itself is clipped. */
  const [ring, setRing] = useState<Handle | null>(null);

  // Track the canvas' displayed rect relative to the clipping layer (root's parent), which covers the viewer (the canvas wrap)
  // exactly, and the size of that layer: the viewer, outside which the handles can be neither seen nor clicked.
  const measure = (parent: HTMLElement) => {
    const c = canvas!.getBoundingClientRect();
    const p = parent.getBoundingClientRect();
    return { left: c.left - p.left + parent.scrollLeft - parent.clientLeft, top: c.top - p.top + parent.scrollTop - parent.clientTop, width: c.width, height: c.height, viewW: parent.clientWidth, viewH: parent.clientHeight };
  };
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!canvas || !parent) return;
    const next = measure(parent);
    setRect((r) => (r.left === next.left && r.top === next.top && r.width === next.width && r.height === next.height && r.viewW === next.viewW && r.viewH === next.viewH ? r : next));
  });
  useEffect(() => {
    const parent = root.current?.parentElement;
    if (!canvas || !parent || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setRect(measure(parent)));
    ro.observe(canvas);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvas]); // eslint-disable-line react-hooks/exhaustive-deps

  // The viewed format's projected document: its own frame size and fit mode. In a format, the clip is read from it so overrides show.
  const doc = editor.viewDoc;
  const viewed = state.viewVariantId ? state.doc?.variants?.[state.viewVariantId] ?? null : null;
  const masterSel = editor.selected;
  const sel = masterSel && doc ? findClip(doc, masterSel.clip.id) : undefined;
  const clip = sel?.clip;
  const safe = viewed?.safeArea && state.safeAreaOn ? viewed.safeArea : null;
  const overlay = safe && rect.width > 0 ? (
    <div className="safe-clip" aria-hidden="true" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <div className="safe-area" data-testid="safe-area" style={{ left: `${safe.left * 100}%`, right: `${safe.right * 100}%`, top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%` }} />
    </div>
  ) : null;
  const visible = !!doc && !!sel && !!clip && editor.playheadOnSelection && (sel.track.kind === 'video' || sel.track.kind === 'text') && rect.width > 0;
  // The handles live in a layer that covers the viewer and clips what lies outside it (interactions.css: .ch-clip), so the box
  // of an enlarged clip never lies over the transport bar, the side panels or the header, nor takes their clicks.
  const shell = <>{overlay}<div className="ch-clip" data-testid="canvas-handles-clip"><div ref={root} className="ch-root" data-testid="canvas-handles" dir="ltr" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, display: visible ? undefined : 'none' }} /></div></>;
  if (!visible || !doc || !clip) return shell;

  const frameW = doc.settings.width;
  const frameH = doc.settings.height;
  let natural: { w: number; h: number; fit: boolean } | null = null;
  if (clip.type === 'text') {
    const lines = Math.max(1, clip.text.split('\n').length);
    natural = { w: frameW * TEXT_NOMINAL_W, h: lines * clip.style.sizeFrac * clip.style.lineHeight * frameH, fit: false };
  } else if (clip.type === 'media') {
    const a = doc.assets[clip.assetId];
    const dims = a?.video ?? a?.image;
    // Pictures fill the frame with "cover" in formats set that way: natural size = source x max(W/w, H/h) instead of min.
    if (dims) {
      // layerBox multiplies by min(W/w, H/h); pre-scale by max/min so the result is source x max(W/w, H/h).
      const lo = Math.min(frameW / dims.width, frameH / dims.height);
      const hi = doc.settings.fit === 'cover' ? Math.max(frameW / dims.width, frameH / dims.height) : lo;
      natural = { w: (dims.width * hi) / lo, h: (dims.height * hi) / lo, fit: true };
    }
  }
  if (!natural) return shell;

  // A clip that follows a motion track (ADR-0015) is drawn where the evaluator's follow post-pass puts it; its handles sit
  // there too, and a change made with them is written back as its own offset (setShownTransform: Δ/m).
  const shown = editor.resolvedTransformNow(clip);
  const base = shown.transform;
  const eff: LayerTransform = { x: base.x, y: base.y, scale: base.scale, rotation: base.rotation, ...preview };
  const k = rect.width / frameW;
  const box = boxToScreen(layerBox({ frameW, frameH, naturalW: natural.w, naturalH: natural.h, transform: eff, fit: natural.fit }), rect.width, frameW);
  const label = (h: Handle) => (h === 'move' ? `${t('transform.x')} / ${t('text.y')}` : h === 'rotate' ? t('transform.rotation') : t('transform.scale'));

  const finish = (c: Clip, d: Drag, p: Preview | null, kind: Handle) => {
    if (!p) return;
    const changed: Partial<Record<'x' | 'y' | 'scale' | 'rotation', number>> = {};
    for (const key of ['x', 'y', 'scale', 'rotation'] as const) if (p[key] !== undefined && p[key] !== d.start[key]) changed[key] = p[key]!;
    if (!Object.keys(changed).length) return;
    void editor.setShownTransform(c, d.shown, changed, kind === 'move' ? 'Move layer' : kind === 'rotate' ? 'Rotate layer' : 'Scale layer');
  };
  const compute = (e: ReactPointerEvent<HTMLElement>, d: Drag): Preview => {
    if (d.handle === 'move') {
      const f = screenDeltaToFrameFraction(e.clientX - d.startX, e.clientY - d.startY, rect.width, rect.height);
      let x = clampX(d.start.x + f.dx);
      let y = clampX(d.start.y + f.dy);
      const sx = x * frameW * k;
      const sy = y * frameH * k;
      const gv = Math.abs(sx) <= CENTRE_SNAP_PX;
      const gh = Math.abs(sy) <= CENTRE_SNAP_PX;
      if (gv) x = 0;
      if (gh) y = 0;
      setGuide((g) => (g.v === gv && g.h === gh ? g : { v: gv, h: gh }));
      return { x, y };
    }
    if (d.handle === 'rotate') return { rotation: rotationFromDrag(d.centre, { x: d.startX, y: d.startY }, { x: e.clientX, y: e.clientY }, d.start.rotation, e.shiftKey) };
    return { scale: scaleFromDrag(Math.hypot(d.startX - d.centre.x, d.startY - d.centre.y), Math.hypot(e.clientX - d.centre.x, e.clientY - d.centre.y), d.start.scale) };
  };
  const cancel = () => { drag.current = null; setPreview(null); setGuide({ v: false, h: false }); };

  const onDown = (h: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.stopPropagation();
    const r = root.current!.getBoundingClientRect();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    drag.current = { handle: h, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, start: { ...eff }, shown, centre: { x: r.left + box.cx, y: r.top + box.cy }, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    d.moved = true;
    setPreview(compute(e, d));
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const p = d.moved ? compute(e, d) : null;
    cancel();
    finish(clip, d, p, d.handle);
  };
  const onKey = (h: Handle) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && drag.current) { cancel(); return; }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (!a) return;
    e.preventDefault();
    const at = editor.resolvedTransformNow(clip); // as drawn now (a follower: resolved; its offset is what changes)
    const now = at.transform;
    if (h === 'move') {
      const step = e.shiftKey ? 0.05 : 0.01;
      void editor.setShownTransform(clip, at, { x: clampX(now.x + a[0] * step), y: clampX(now.y + a[1] * step) }, 'Move layer');
    } else if (h === 'rotate') {
      const step = e.shiftKey ? 15 : 1;
      const dir = a[0] !== 0 ? a[0] : -a[1];
      void editor.setShownTransform(clip, at, { rotation: clampRotation(now.rotation + dir * step) }, 'Rotate layer');
    } else {
      const dir = a[0] !== 0 ? a[0] : -a[1];
      void editor.setShownTransform(clip, at, { scale: clampScale(now.scale + dir * 0.05) }, 'Scale layer');
    }
  };
  const focusRing = (h: Handle) => (e: { currentTarget: HTMLElement }) => {
    let shown = true;
    try { shown = e.currentTarget.matches(':focus-visible'); } catch { /* no :focus-visible: count every focus */ }
    setRing(shown ? h : null);
  };
  const common = (h: Handle) => ({
    type: 'button' as const, 'data-handle': h, 'aria-label': label(h), onPointerDown: onDown(h), onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: cancel, onKeyDown: onKey(h),
    onFocus: focusRing(h), onBlur: () => setRing((r) => (r === h ? null : r)),
  });
  // Stand-ins at the viewer edge for handles outside it (interactions.math.ts edgeProxies). Placed from the committed transform,
  // not the drag preview, so the one being dragged stays where the pointer took it. They are pointer grips only (aria-hidden,
  // not focusable): the handles themselves stay the keyboard controls, and a stand-in shows the ring of a focused one.
  const still = boxToScreen(layerBox({ frameW, frameH, naturalW: natural.w, naturalH: natural.h, transform: base, fit: natural.fit }), rect.width, frameW);
  const proxies = rect.viewW > 0 && rect.viewH > 0
    ? edgeProxies({ box: still, view: { left: -rect.left, top: -rect.top, right: rect.viewW - rect.left, bottom: rect.viewH - rect.top }, margin: HANDLE_HALF_PX, gap: GRIP_GAP_PX, focused: ring })
    : [];
  // The stand-in takes no focus itself (no text selection either); the handle it stands for does, without scrolling anything,
  // so Escape cancels the drag and the arrow keys go on from there, as after a drag on the handle itself.
  const proxyDown = (h: Handle) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    onDown(h)(e);
    root.current?.querySelector<HTMLElement>(`[data-handle="${h}"]`)?.focus({ preventScroll: true });
  };

  return (
    <>
    {overlay}
    <div className="ch-clip" data-testid="canvas-handles-clip">
    <div ref={root} className="ch-root" data-testid="canvas-handles" dir="ltr" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      {guide.v && <div className="ch-guide ch-guide-v" aria-hidden="true" />}
      {guide.h && <div className="ch-guide ch-guide-h" aria-hidden="true" />}
      <div className="ch-box" style={{ left: box.cx, top: box.cy, width: box.w, height: box.h, transform: `translate(-50%, -50%) rotate(${box.rotationDeg}deg)` }}>
        <button {...common('move')} className="ch-move" />
        {(Object.entries(SCALE_ANCHORS) as [ScaleHandle, readonly [number, number]][]).map(([h, [u, v]]) => (
          <button key={h} {...common(h)} className={`ch-handle ch-${h}`} style={{ left: `${u * 100}%`, top: `${v * 100}%` }} />
        ))}
        <span className="ch-stem" aria-hidden="true" />
        <button {...common('rotate')} className="ch-handle ch-rotate" />
      </div>
      {/* ADR-0019: the motion path of the clip's own x/y keys (MotionPath.tsx decides whether it shows; read-only in a format view) */}
      <MotionPath clip={clip} doc={doc} rect={rect} k={k} editable={!state.viewVariantId && !sel.track.locked}
        view={rect.viewW > 0 && rect.viewH > 0 ? { left: -rect.left, top: -rect.top, right: rect.viewW - rect.left, bottom: rect.viewH - rect.top } : undefined} />
      {proxies.map((p) => (
        <span key={p.id} className={`ch-proxy${p.mirror ? ' ch-mirror' : ''}`} data-testid="canvas-handle-proxy" data-proxy={p.id} aria-hidden="true" title={label(p.id)}
          style={{ left: p.x, top: p.y }} onPointerDown={proxyDown(p.id)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} />
      ))}
    </div>
    </div>
    </>
  );
}
