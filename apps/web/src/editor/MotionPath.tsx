/**
 * The motion path «מסלול תנועה» on the stage (ADR-0019, W3), mounted inside CanvasHandles' `.ch-root` (dir=ltr), sharing its
 * rect, its scale k = rect.width / frame width, the viewed document (editor.viewDoc) and its visibility rule. Shown when x or y
 * of the selected clip is keyed, playback is paused and the editor's `pathOn` is set (store.ts; view.motionPath toggles it).
 *
 * Points come from core pathEdits.ts pathPoints (the same sampling as transformAt per frame, ≤ 600 points, every key frame
 * kept), mapped exactly as the handles map a transform: centre + (x · width, y · height) of the viewer rect. Drawn as:
 * - an aria-hidden dual-stroke polyline (a dark stroke under a light one, readable on any picture), with frame dots where they
 *   are at least 4 px apart; its points (CSS px, relative to the root) are on data-points for the proofs;
 * - one <button> per vertex (a frame inside the clip where x or y has a key), named with timecode and values. Pointer: drag
 *   after 3 px, with the centre snap of CanvasHandles (6 px), one commit on release (pathEdits.ts moveVertexOps: ≤ 2 ops; only
 *   the axes the pointer or arrow moved are snapped, rounded to 1e-4 and written, pathMove.ts);
 *   Escape cancels. Keyboard (handled here, stopPropagation, as VolumeLine): arrows move 0.01 (Shift 0.05), Alt+←/→ move the
 *   vertex's keys one frame (Shift 10), S smooth, L straight, Enter opens the curve picker, Space toggles the selection,
 *   Delete removes, Mod+A selects every vertex, Mod+C copies, Mod+V pastes at the playhead, Escape clears the selection and
 *   then returns focus to the clip on the timeline;
 * - a bend grip at the middle frame of each segment between two vertices (pathEdits.ts bendOps: an x+y vertex there through the
 *   pointer, 'smooth' on both sides; Enter bends in place). When the insertion was approximate a role=status note gives the
 *   largest deviation of the rest of the path in pixels;
 * - aria-hidden edge stand-ins at the viewer edge for vertices outside it (CanvasHandles' stand-in pattern; pointer grips
 *   only, the vertex buttons stay the keyboard controls).
 * Read-only in a format view (i18n keys.path.readOnlyFormat): drawn, its controls aria-disabled, nothing is committed. A clip
 * that follows a motion track (clip.follow) shows no path in wave 1, with its reason (i18n keys.path.follower): its on-screen
 * path is the follow post-pass's and comes with ADR-0015's monitor path overlay (wave4-decisions.md).
 * Every write goes through editor.commit with core functions (pathEdits.ts, keyEdits.ts), deciding from the document as it is
 * when the write's turn comes. Test ids: keyframes.testids.ts KF_TESTIDS. Strings: i18n keys.path.*.
 */
import { useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import * as T from '@pulseframe/time';
import {
  bendOps, copyKeys, curveOps, deleteKeysOps, findClip, moveKeysOps, pasteKeysOps, pathPoints, transformAt, vertexFrames,
  type Clip, type KeyRef, type OpCall, type ProjectDocument, type Track,
} from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { KF_TESTIDS } from './keyframes.testids.ts';
import { dragTarget, round4, vertexMoveOps, vertexNudgeOps, type VertexTarget } from './pathMove.ts';
import './motionPath.css';

export interface MotionPathProps {
  /** The selected clip as the viewed document holds it. */
  clip: Clip;
  /** The viewed document (editor.viewDoc): its frame size and the clip's format overrides. */
  doc: ProjectDocument;
  /** The viewer rectangle CanvasHandles measures (CSS pixels), and its scale k = rect.width / frame width. */
  rect: { left: number; top: number; width: number; height: number };
  k: number;
  /** False in a format view: the path is drawn but cannot be edited. */
  editable: boolean;
  /** The viewer (the clipping layer) in the root's coordinates: points outside it get edge stand-ins. Absent: no stand-ins. */
  view?: { left: number; top: number; right: number; bottom: number };
  /**
   * The centre of the layer's box as drawn at the playhead (root coordinates). A vertex or bend grip within LAYER_CLEAR_PX of it
   * lets the pointer through to the layer's move handle (it stays a keyboard control): dragging the layer there already moves
   * the path's point at the playhead (a key at the playhead, store.ts setTransformAtPlayhead).
   */
  layerCentre?: { x: number; y: number };
}

const DRAG_THRESHOLD_PX = 3;
const CENTRE_SNAP_PX = 6;
const DOT_GAP_PX = 4;
/** Half the size of a vertex (motionPath.css): stand-ins sit this far inside the viewer edge. */
const VERTEX_HALF_PX = 6;
const LAYER_CLEAR_PX = 12;
const AXES = [{ property: 'x' as const }, { property: 'y' as const }];

interface PathDrag { kind: 'vertex' | 'bend'; frame: number; a: number; b: number; pointerId: number; startX: number; startY: number; sx: number; sy: number; moved: boolean }

export function MotionPath(props: MotionPathProps): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const { clip, doc, rect, k, editable, view, layerCentre } = props;
  const drag = useRef<PathDrag | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ x: number; y: number; frame: number; kind: PathDrag['kind'] } | null>(null);
  const [note, setNote] = useState('');
  const rate = doc.settings.frameRate;
  const keyed = !!(clip.keyframes?.x?.length || clip.keyframes?.y?.length);
  const points = useMemo(() => (keyed ? pathPoints(clip, rate) : []), [clip, rate, keyed]);
  const vertices = useMemo(() => (keyed ? vertexFrames(clip, rate) : []), [clip, rate, keyed]);

  if (!state.pathOn || editor.player?.playing || !keyed || rect.width <= 0) return null;
  if (clip.follow) {
    return <p className="mp-reason" data-testid={KF_TESTIDS.pathReason} data-reason="follower" dir="auto">{t('keys.path.follower')}</p>;
  }

  const W = rect.width, H = rect.height;
  const toScreen = (x: number, y: number) => ({ x: W / 2 + x * W, y: H / 2 + y * H });
  const fromScreen = (sx: number, sy: number) => ({ x: (sx - W / 2) / W, y: (sy - H / 2) / H });
  const screen = points.map((p) => ({ frame: p.frame, ...toScreen(p.x, p.y) }));
  const atFrame = (f: number) => { const tr = transformAt(clip, T.add(clip.start, T.frameTime(f, rate))); return { x: tr.x, y: tr.y }; };
  const dots: { x: number; y: number }[] = [];
  for (const p of screen) { const l = dots[dots.length - 1]; if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= DOT_GAP_PX) dots.push(p); }
  const line = screen.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const tc = (f: number) => T.toTimecode(T.add(clip.start, T.frameTime(f, rate)), rate);
  const fmt = (v: number) => v.toFixed(3);

  // ---- selection (session state keySel: one clip at a time) ----
  const sel = state.keySel?.clipId === clip.id ? state.keySel.keys : [];
  const refsAt = (f: number): KeyRef[] => AXES.filter((ch) => clip.keyframes?.[ch.property]?.some((kf) => T.isFrameAligned(kf.time, rate) && T.frameIndexAt(kf.time, rate) === f)).map((channel) => ({ channel, frame: f }));
  const selectedAt = (f: number) => sel.some((r) => r.frame === f && 'property' in r.channel && (r.channel.property === 'x' || r.channel.property === 'y'));
  /** The keys a key command acts on: the selection when this vertex is in it, else this vertex's own x/y keys. */
  const target = (f: number): KeyRef[] => (selectedAt(f) ? sel : refsAt(f));
  const master = (): { clip: Clip; track: Track } | null => { const d = editor.doc; const s = d ? findClip(d, clip.id) : undefined; return s ? { clip: s.clip, track: s.track } : null; };
  const commit = (label: string, make: (c: Clip, track: Track) => OpCall[] | null) => {
    if (!editable) return;
    void editor.commit(() => { const m = master(); return m ? make(m.clip, m.track) : null; }, label);
  };

  /** A vertex drag moves (and snaps, rounds, writes) only the axes the pointer moved along (pathMove.ts); a bend takes both. */
  const placeFor = (d: PathDrag, e: { clientX: number; clientY: number }): VertexTarget => {
    if (d.kind === 'bend') {
      const r = root.current!.getBoundingClientRect();
      return fromScreen(e.clientX - r.left, e.clientY - r.top);
    }
    return dragTarget({ x: d.sx, y: d.sy }, { x: e.clientX - d.startX, y: e.clientY - d.startY }, { w: W, h: H }, CENTRE_SNAP_PX);
  };
  const finish = (d: PathDrag, to: VertexTarget) => {
    if (d.kind === 'vertex') {
      commit('Move path point', (c) => { const ops = vertexMoveOps(c, rate, d.frame, to); return ops.length ? ops : null; });
      setNote('');
    } else bend(d.a, d.b, { x: to.x ?? d.sx, y: to.y ?? d.sy });
  };
  const bend = (a: number, b: number, at: { x: number; y: number }) => {
    if (!editable) return;
    void editor.commit(() => {
      const m = master();
      if (!m) return null;
      const r = bendOps(m.clip, rate, a, b, round4(at.x), round4(at.y));
      const px = Math.max(r.maxDeviation.x * W, r.maxDeviation.y * H);
      setNote(r.exact ? '' : `${t('keys.path.approximate')} ${px.toFixed(1)}`);
      return r.ops;
    }, 'Bend path');
  };
  const cancel = () => { drag.current = null; setPreview(null); };
  const onDown = (kind: PathDrag['kind'], frame: number, a = frame, b = frame) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.stopPropagation();
    if (!editable) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const p = atFrame(frame);
    drag.current = { kind, frame, a, b, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, sx: p.x, sy: p.y, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const to = placeFor(d, e);
    setPreview({ x: to.x ?? d.sx, y: to.y ?? d.sy, frame: d.kind === 'bend' ? Math.floor((d.a + d.b) / 2) : d.frame, kind: d.kind });
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const at = d.moved ? placeFor(d, e) : null;
    cancel();
    if (at) finish(d, at);
  };

  const mod = (e: ReactKeyboardEvent) => e.ctrlKey || e.metaKey;
  const onVertexKey = (f: number) => (e: ReactKeyboardEvent<HTMLElement>) => {
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Escape') {
      handled();
      if (drag.current) { cancel(); return; }
      if (sel.length) { editor.set({ keySel: null }); return; }
      document.querySelector<HTMLElement>(`[data-clip-id="${CSS.escape(clip.id)}"]`)?.focus();
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (a && e.altKey) {
      if (a[0] === 0) return;
      handled();
      const by = a[0] * (e.shiftKey ? 10 : 1);
      commit('Move keyframes', (c, track) => { const r = moveKeysOps(c, track, rate, target(f), by); return 'ops' in r ? r.ops : null; });
      return;
    }
    if (a) {
      handled();
      const step = e.shiftKey ? 0.05 : 0.01;
      commit('Move path point', (c) => { const ops = vertexNudgeOps(c, rate, f, a[0] * step, a[1] * step); return ops.length ? ops : null; });
      return;
    }
    if (mod(e) && e.code === 'KeyA') { handled(); editor.set({ keySel: { clipId: clip.id, keys: vertices.flatMap(refsAt) } }); return; }
    if (mod(e) && e.code === 'KeyC') { handled(); const m = master(); if (m) editor.set({ keyClipboard: copyKeys(m.clip, rate, target(f)) }); return; }
    if (mod(e) && e.code === 'KeyV') {
      handled();
      const cb = state.keyClipboard;
      if (cb) commit('Paste keyframes', (c, track) => pasteKeysOps(c, track, rate, cb, editor.frame - T.frameIndexAt(c.start, rate)).ops);
      return;
    }
    if (mod(e) || e.altKey) return;
    if (e.code === 'KeyS' || e.code === 'KeyL') {
      handled();
      const easing = e.code === 'KeyS' ? 'smooth' : 'linear';
      commit(easing === 'smooth' ? 'Smooth keyframes' : 'Straight keyframes', (c) => curveOps(c, rate, target(f), 'both', easing));
      return;
    }
    if (e.key === 'Enter') { handled(); if (editable) editor.set({ curvePicker: { clipId: clip.id, frame: f, channels: target(f).map((r) => r.channel) } }); return; }
    if (e.key === ' ') {
      handled();
      const mine = refsAt(f);
      const rest = sel.filter((r) => r.frame !== f || !('property' in r.channel) || (r.channel.property !== 'x' && r.channel.property !== 'y'));
      const keys = selectedAt(f) ? rest : [...sel, ...mine];
      editor.set({ keySel: keys.length ? { clipId: clip.id, keys } : null });
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { handled(); commit('Delete keyframes', (c) => deleteKeysOps(c, rate, target(f))); }
  };
  const onBendKey = (a: number, b: number) => (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && drag.current) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    bend(a, b, atFrame(Math.floor((a + b) / 2)));
  };

  // ---- stand-ins at the viewer edge for vertices outside it (pointer grips only) ----
  const edges: { frame: number; x: number; y: number }[] = [];
  if (view) {
    const lo = { x: view.left + VERTEX_HALF_PX, y: view.top + VERTEX_HALF_PX }, hi = { x: view.right - VERTEX_HALF_PX, y: view.bottom - VERTEX_HALF_PX };
    if (hi.x >= lo.x && hi.y >= lo.y) for (const f of vertices) {
      const p = toScreen(atFrame(f).x, atFrame(f).y);
      if (p.x < lo.x || p.x > hi.x || p.y < lo.y || p.y > hi.y) edges.push({ frame: f, x: Math.min(hi.x, Math.max(lo.x, p.x)), y: Math.min(hi.y, Math.max(lo.y, p.y)) });
    }
  }
  const edgeDown = (f: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    onDown('vertex', f)(e);
    root.current?.querySelector<HTMLElement>(`[data-testid="${KF_TESTIDS.pathPoint}"][data-frame="${f}"]`)?.focus({ preventScroll: true });
  };

  const segments = vertices.slice(1).map((b, i) => [vertices[i]!, b] as const).filter(([a, b]) => b - a >= 2);
  const shown = (f: number, kind: PathDrag['kind']) => (preview && preview.kind === kind && preview.frame === f ? toScreen(preview.x, preview.y) : toScreen(atFrame(f).x, atFrame(f).y));
  const disabled = editable ? {} : { 'aria-disabled': true as const };
  const pass = (p: { x: number; y: number }) => (layerCentre && Math.hypot(p.x - layerCentre.x, p.y - layerCentre.y) < LAYER_CLEAR_PX ? ' mp-pass' : '');
  const dataPoints = JSON.stringify(screen.map((p) => [p.frame, Number(p.x.toFixed(3)), Number(p.y.toFixed(3))]));
  void k; // the scale the handles use: rect.width / frame width; the path maps fractions of the frame straight onto the rect

  return (
    <div ref={root} className={`mp-root${editable ? '' : ' mp-readonly'}`} data-testid={KF_TESTIDS.path} data-points={dataPoints} data-editable={editable ? 'true' : 'false'} role="group" aria-label={t('keys.path')}>
      <svg className="mp-svg" aria-hidden="true" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <polyline className="mp-under" points={line} />
        <polyline className="mp-over" points={line} />
        {dots.map((p, i) => <circle key={i} className="mp-dot" cx={p.x} cy={p.y} r={1.5} />)}
      </svg>
      {segments.map(([a, b]) => {
        const mid = Math.floor((a + b) / 2);
        const p = shown(mid, 'bend');
        return (
          <button key={`b${a}`} type="button" className={`mp-bend${pass(p)}`} data-testid={KF_TESTIDS.bend} data-from={a} data-to={b} data-frame={mid} style={{ left: p.x, top: p.y }}
            aria-label={`${t('keys.path.bend')} ${tc(a)}–${tc(b)}`} {...disabled}
            onPointerDown={onDown('bend', mid, a, b)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} onKeyDown={onBendKey(a, b)} />
        );
      })}
      {vertices.map((f) => {
        const p = shown(f, 'vertex');
        const v = atFrame(f);
        return (
          <button key={`v${f}`} type="button" className={`mp-vertex${pass(p)}`} data-testid={KF_TESTIDS.pathPoint} data-frame={f} style={{ left: p.x, top: p.y }}
            aria-pressed={selectedAt(f)} aria-label={`${t('keys.path.point')} ${tc(f)}: ${t('transform.x')} ${fmt(v.x)}, ${t('text.y')} ${fmt(v.y)}`} {...disabled}
            onPointerDown={onDown('vertex', f)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} onKeyDown={onVertexKey(f)} />
        );
      })}
      {edges.map((p) => (
        <span key={`e${p.frame}`} className="mp-edge" data-testid={KF_TESTIDS.pathEdge} data-frame={p.frame} aria-hidden="true" style={{ left: p.x, top: p.y }}
          onPointerDown={edgeDown(p.frame)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} />
      ))}
      {!editable && <p className="mp-reason" data-testid={KF_TESTIDS.pathReason} data-reason="format" dir="auto">{t('keys.path.readOnlyFormat')}</p>}
      <p className="mp-note" role="status" data-testid={KF_TESTIDS.pathNote} dir="auto">{note}</p>
    </div>
  );
}
