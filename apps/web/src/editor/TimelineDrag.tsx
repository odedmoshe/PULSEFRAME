import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, timelineMarkers, type Clip } from '@pulseframe/core';
import { readSnapBeats } from '../api.ts';
import { useEditor } from './store.ts';
import { markerSnapCandidates, overlapsOnTrack, snapTime } from './interactions.math.ts';
import './interactions.css';

type Mode = 'move' | 'trim-start' | 'trim-end';
type SnapKind = 'playhead' | 'clip-edge' | 'zero' | 'marker';
export interface TimelineGhost { clipId: string; mode: Mode; leftPx: number; widthPx: number; snappedTo: SnapKind | null; invalid: boolean }

const EDGE_PX = 6;
const CLICK_PX = 4;
const SNAP_PX = 8;

interface Session {
  pointerId: number;
  clipId: string;
  mode: Mode;
  startX: number;
  captured: boolean;
  start: T.RationalTime;
  duration: T.RationalTime;
  trackId: string;
  trackKind: string;
  /** Other selected clips that move along (the dragged clip is part of a multi-selection); empty for a single clip. */
  companions: string[];
  /** Earliest start among the moving clips: the group cannot be dragged further left than this allows. */
  groupMin: T.RationalTime;
  /** Final frame-aligned result of the latest pointer position. */
  result: { start: T.RationalTime; end: T.RationalTime } | null;
}

/**
 * Drag to move / trim timeline clips. Nothing is committed while dragging; one transaction on pointer up.
 * Spread `containerProps` on the scroll container. Leaves click handling (selection) to the clip buttons.
 */
export function useTimelineDrag(): { containerProps: Record<string, unknown>; ghost: TimelineGhost | null } {
  const editor = useEditor();
  const [ghost, setGhost] = useState<TimelineGhost | null>(null);
  const session = useRef<Session | null>(null);
  const container = useRef<HTMLElement | null>(null);

  const end = useCallback((cancel: boolean) => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    try { if (s.captured) container.current?.releasePointerCapture(s.pointerId); } catch { /* already released */ }
    const r = s.result;
    if (cancel || !s.captured || !r) { setGhost(null); return; }
    const unchanged = s.mode === 'move' ? T.eq(r.start, s.start) : s.mode === 'trim-start' ? T.eq(r.start, s.start) : T.eq(r.end, T.add(s.start, s.duration));
    if (unchanged) { setGhost(null); return; }
    const ops = s.mode === 'move'
      ? (s.companions.length ? [{ op: 'move_clips', args: { clipIds: [s.clipId, ...s.companions], delta: T.sub(r.start, s.start) } }] : [{ op: 'move_clip', args: { clipId: s.clipId, start: r.start } }])
      : [{ op: 'trim_clip', args: { clipId: s.clipId, edge: s.mode === 'trim-start' ? 'start' : 'end', to: s.mode === 'trim-start' ? r.start : r.end } }];
    // The ghost stays until the server answers; a rejection (null) just removes it, the store reports the error.
    void editor.commit(ops as never, s.mode === 'move' ? 'Move clip' : 'Trim clip').finally(() => setGhost(null));
  }, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && session.current) end(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [end]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || session.current) return;
    const el = (e.target as HTMLElement).closest?.('[data-clip-id]') as HTMLElement | null;
    const doc = editor.doc;
    if (!el || !doc) return;
    const id = el.dataset.clipId!;
    const found = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => tr.clips.map((clip) => ({ clip, tr }))).find((x) => x.clip.id === id);
    if (!found) return;
    if (found.tr.locked) return;
    const rect = el.getBoundingClientRect();
    const mode: Mode = rect.width >= 16 && e.clientX - rect.left <= EDGE_PX ? 'trim-start' : rect.width >= 16 && rect.right - e.clientX <= EDGE_PX ? 'trim-end' : 'move';
    container.current = e.currentTarget;
    session.current = {
      pointerId: e.pointerId, clipId: id, mode, startX: e.clientX, captured: false, start: found.clip.start, duration: found.clip.duration,
      trackId: found.tr.id, trackKind: found.tr.kind, result: null, companions: [], groupMin: found.clip.start,
    };
    // Dragging one clip of a multi-selection moves the whole selection (move only; trimming stays per clip).
    const selection = editor.getState().selection;
    if (mode === 'move' && selection.length > 1 && selection.includes(id)) {
      const all = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => (tr.locked ? [] : tr.clips));
      const others = all.filter((c) => c.id !== id && selection.includes(c.id));
      session.current.companions = others.map((c) => c.id);
      session.current.groupMin = others.reduce((m, c) => T.min(m, c.start), found.clip.start);
    }
  }, [editor]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = session.current;
    const doc = editor.doc;
    if (!s || !doc || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX;
    if (!s.captured) {
      if (Math.abs(dx) < CLICK_PX) return; // still a click
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      s.captured = true;
    }
    const pps = editor.getState().pxPerSecond;
    const rate = editor.rate;
    const frame = T.frameTime(1, rate);
    const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
    const self = tracks.flatMap((tr) => tr.clips).find((c) => c.id === s.clipId);
    if (!self) { end(true); return; }
    const group = new Set<string>([s.clipId, ...s.companions]);
    const link = (c: Clip) => (c.type === 'media' ? c.linkGroupId : null);
    const lg = link(self);
    if (lg) for (const tr of tracks) for (const c of tr.clips) if (link(c) === lg) group.add(c.id);
    // linked partners of the other selected clips move too
    const lgs = new Set(tracks.flatMap((tr) => tr.clips).filter((c) => s.companions.includes(c.id)).map(link).filter(Boolean));
    if (lgs.size) for (const tr of tracks) for (const c of tr.clips) if (lgs.has(link(c))) group.add(c.id);

    // Snap candidates: exact times from the document.
    const cands: T.RationalTime[] = [T.ZERO, editor.playhead];
    const kinds: SnapKind[] = ['zero', 'playhead'];
    for (const tr of tracks) for (const c of tr.clips) {
      if (group.has(c.id)) continue;
      cands.push(c.start, clipEnd(c));
      kinds.push('clip-edge', 'clip-edge');
    }
    if (s.mode === 'move' && readSnapBeats()) {
      const m = timelineMarkers(doc);
      for (const c of markerSnapCandidates([...m.beats, ...m.sceneCuts], rate)) { cands.push(c); kinds.push('marker'); }
    }
    const snapping = !e.altKey;
    let snappedTo: SnapKind | null = null;
    const trySnap = (time: T.RationalTime) => {
      if (!snapping) return null;
      const r = snapTime({ time, candidates: cands, pxPerSecond: pps, thresholdPx: SNAP_PX });
      return r.snapped ? r : null;
    };
    const delta = T.fromSeconds(dx / pps);
    const origEnd = T.add(s.start, s.duration);
    let start = s.start;
    let endT = origEnd;
    if (s.mode === 'move') {
      const rawStart = T.add(s.start, delta);
      const a = trySnap(rawStart);
      const b = trySnap(T.add(rawStart, s.duration));
      const da = a ? Math.abs(T.toSeconds(T.sub(a.time, rawStart))) : Infinity;
      const db = b ? Math.abs(T.toSeconds(T.sub(T.sub(b.time, s.duration), rawStart))) : Infinity;
      if (a && da <= db) { start = a.time; snappedTo = kinds[a.index]!; }
      else if (b) { start = T.sub(b.time, s.duration); snappedTo = kinds[b.index]!; }
      else start = rawStart;
      start = T.snapToFrame(start, rate);
      // The earliest moving clip stops at 0, so the group keeps its shape.
      const floor = T.sub(s.start, s.groupMin);
      if (T.lt(start, floor)) start = floor;
      endT = T.add(start, s.duration);
    } else if (s.mode === 'trim-start') {
      const raw = T.add(s.start, delta);
      const a = trySnap(raw);
      if (a) snappedTo = kinds[a.index]!;
      start = T.snapToFrame(a ? a.time : raw, rate);
      if (T.isNegative(start)) start = T.ZERO;
      const latest = T.sub(origEnd, frame);
      if (T.lt(latest, start)) start = latest;
    } else {
      const raw = T.add(origEnd, delta);
      const a = trySnap(raw);
      if (a) snappedTo = kinds[a.index]!;
      endT = T.snapToFrame(a ? a.time : raw, rate);
      const earliest = T.add(s.start, frame);
      if (T.lt(endT, earliest)) endT = earliest;
    }
    s.result = { start, end: endT };
    const track = tracks.find((t) => t.id === s.trackId);
    const invalid = !!track && s.trackKind !== 'audio' && overlapsOnTrack(track.clips, group, start, endT);
    setGhost({
      clipId: s.clipId, mode: s.mode, leftPx: T.toSeconds(start) * pps, widthPx: Math.max(4, T.toSeconds(T.sub(endT, start)) * pps - 1), snappedTo, invalid,
    });
  }, [editor, end]);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (session.current && e.pointerId === session.current.pointerId) end(false);
  }, [end]);
  const onPointerCancel = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (session.current && e.pointerId === session.current.pointerId) end(true);
  }, [end]);

  return { containerProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, 'data-timeline-drag': ghost ? ghost.mode : 'idle' }, ghost };
}
