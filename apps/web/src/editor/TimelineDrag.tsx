import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as T from '@pulseframe/time';
import { clipEnd, timelineMarkers, type Clip } from '@pulseframe/core';
import { readSnapBeats } from '../api.ts';
import { useEditor } from './store.ts';
import { beatSnapTargets, markerSnapCandidates, overlapsOnTrack, snapToTargets, type SnapKind, type SnapTarget } from './interactions.math.ts';
import './timeline.css';

type Mode = 'move' | 'trim-start' | 'trim-end';
export type { SnapKind };
export interface TimelineGhost {
  clipId: string; mode: Mode; leftPx: number; widthPx: number; snappedTo: SnapKind | null; invalid: boolean;
  /** The edge that is being moved, as a timeline frame: the start for a move or a start trim, the end for an end trim (the end too when a move snapped by its end). */
  edgeFrame: number;
  /** How far that edge moved from where it was, in frames (the live chip beside the pointer). */
  deltaFrames: number;
  /** The clip's length as it would be, in frames. */
  durationFrames: number;
}

const EDGE_PX = 8;
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
  /**
   * Roll: Ctrl/Cmd held when an edge drag starts on a cut shared with the clip next to it. That neighbour's edge follows the
   * dragged edge, so the cut moves and nothing else does. `limit` is the furthest the cut may go (the neighbour keeps one frame).
   */
  roll: { neighbourId: string; limit: T.RationalTime } | null;
  /**
   * Slide: Ctrl/Cmd held when a drag starts on the body of a single clip that has a clip touching it on each side. The clip
   * keeps its length and content; the neighbour ahead is trimmed back and the one behind is extended. `min`/`max` bound its start.
   */
  slide: { prevId: string; nextId: string; min: T.RationalTime; max: T.RationalTime } | null;
  /** Final frame-aligned result of the latest pointer position. */
  result: { start: T.RationalTime; end: T.RationalTime } | null;
}

/**
 * Drag to move / trim timeline clips; Ctrl/Cmd + drag on an edge that touches the next clip rolls the cut between them;
 * Ctrl/Cmd + drag on the body of a clip that has a clip touching it on each side slides it between them.
 * Nothing is committed while dragging; one transaction on pointer up.
 * Spread `containerProps` on the scroll container. Leaves click handling (selection) to the clip buttons.
 */
export function useTimelineDrag(opts: { /** the blade tool is active: a press on a clip cuts it, so nothing is dragged */ disabled?: boolean } = {}): { containerProps: Record<string, unknown>; ghost: TimelineGhost | null } {
  const editor = useEditor();
  const disabled = !!opts.disabled;
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
    const rollOps = (() => {
      if (!s.roll || s.mode === 'move') return null;
      const origEnd = T.add(s.start, s.duration);
      // free the frames first, then take them: the clip that gets shorter is trimmed before the one that grows
      if (s.mode === 'trim-start') {
        const self = { op: 'trim_clip', args: { clipId: s.clipId, edge: 'start', to: r.start } }, nb = { op: 'trim_clip', args: { clipId: s.roll.neighbourId, edge: 'end', to: r.start } };
        return T.lt(s.start, r.start) ? [self, nb] : [nb, self];
      }
      const self = { op: 'trim_clip', args: { clipId: s.clipId, edge: 'end', to: r.end } }, nb = { op: 'trim_clip', args: { clipId: s.roll.neighbourId, edge: 'start', to: r.end } };
      return T.lt(origEnd, r.end) ? [nb, self] : [self, nb];
    })();
    const slideOps = (() => {
      if (!s.slide || s.mode !== 'move') return null;
      const trimPrev = { op: 'trim_clip', args: { clipId: s.slide.prevId, edge: 'end', to: r.start } };
      const trimNext = { op: 'trim_clip', args: { clipId: s.slide.nextId, edge: 'start', to: r.end } };
      const move = { op: 'move_clip', args: { clipId: s.clipId, start: r.start } };
      return T.lt(s.start, r.start) ? [trimNext, move, trimPrev] : [trimPrev, move, trimNext]; // make room first, fill the gap last
    })();
    const ops = rollOps ?? slideOps ?? (s.mode === 'move'
      ? (s.companions.length ? [{ op: 'move_clips', args: { clipIds: [s.clipId, ...s.companions], delta: T.sub(r.start, s.start) } }] : [{ op: 'move_clip', args: { clipId: s.clipId, start: r.start } }])
      : [{ op: 'trim_clip', args: { clipId: s.clipId, edge: s.mode === 'trim-start' ? 'start' : 'end', to: s.mode === 'trim-start' ? r.start : r.end } }]);
    // The ghost stays until the server answers; a rejection (null) just removes it, the store reports the error.
    void editor.commit(ops as never, rollOps ? 'Roll cut' : slideOps ? 'Slide clip' : s.mode === 'move' ? 'Move clip' : 'Trim clip').finally(() => setGhost(null));
  }, [editor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && session.current) end(true); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [end]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || session.current || disabled) return;
    // `data-drag-clip`: an overlay drawn over a clip (its volume line) that should drag the clip like the clip itself
    const el = (e.target as Element).closest?.('[data-clip-id], [data-drag-clip]') as HTMLElement | null;
    const doc = editor.doc;
    if (!el || !doc) return;
    const id = (el.dataset.clipId ?? el.dataset.dragClip)!;
    const found = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => tr.clips.map((clip) => ({ clip, tr }))).find((x) => x.clip.id === id);
    if (!found) return;
    if (found.tr.locked) return;
    const rect = el.getBoundingClientRect();
    // the grips of a selected clip are its edges whatever their width; otherwise the outer few pixels of the clip are
    const grip = (e.target as Element).closest?.('[data-grip]')?.getAttribute('data-grip');
    const mode: Mode = grip === 'start' ? 'trim-start' : grip === 'end' ? 'trim-end'
      : rect.width >= 16 && e.clientX - rect.left <= EDGE_PX ? 'trim-start' : rect.width >= 16 && rect.right - e.clientX <= EDGE_PX ? 'trim-end' : 'move';
    container.current = e.currentTarget;
    session.current = {
      pointerId: e.pointerId, clipId: id, mode, startX: e.clientX, captured: false, start: found.clip.start, duration: found.clip.duration,
      trackId: found.tr.id, trackKind: found.tr.kind, result: null, companions: [], groupMin: found.clip.start, roll: null, slide: null,
    };
    if (mode !== 'move' && (e.ctrlKey || e.metaKey)) {
      const frame = T.frameTime(1, editor.rate), endOf = clipEnd(found.clip);
      const nb = found.tr.clips.find((c) => c.id !== id && (mode === 'trim-start' ? T.eq(clipEnd(c), found.clip.start) : T.eq(c.start, endOf)));
      if (nb) session.current.roll = { neighbourId: nb.id, limit: mode === 'trim-start' ? T.add(nb.start, frame) : T.sub(clipEnd(nb), frame) };
    }
    // Dragging one clip of a multi-selection moves the whole selection (move only; trimming stays per clip).
    const selection = editor.getState().selection;
    if (mode === 'move' && (e.ctrlKey || e.metaKey) && !(selection.length > 1 && selection.includes(id))) {
      const frame = T.frameTime(1, editor.rate), endOf = clipEnd(found.clip);
      const prev = found.tr.clips.find((c) => c.id !== id && T.eq(clipEnd(c), found.clip.start)), next = found.tr.clips.find((c) => c.id !== id && T.eq(c.start, endOf));
      if (prev && next) session.current.slide = { prevId: prev.id, nextId: next.id, min: T.add(prev.start, frame), max: T.sub(T.sub(clipEnd(next), frame), found.clip.duration) };
    }
    if (mode === 'move' && selection.length > 1 && selection.includes(id)) {
      const all = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((tr) => (tr.locked ? [] : tr.clips));
      const others = all.filter((c) => c.id !== id && selection.includes(c.id));
      session.current.companions = others.map((c) => c.id);
      session.current.groupMin = others.reduce((m, c) => T.min(m, c.start), found.clip.start);
    }
  }, [editor, disabled]);

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
    if (s.roll) group.add(s.roll.neighbourId); // the neighbour gives way: it is neither an obstacle nor a snap target
    if (s.slide) { group.add(s.slide.prevId); group.add(s.slide.nextId); }
    const link = (c: Clip) => (c.type === 'media' ? c.linkGroupId : null);
    const lg = link(self);
    if (lg) for (const tr of tracks) for (const c of tr.clips) if (link(c) === lg) group.add(c.id);
    // linked partners of the other selected clips move too
    const lgs = new Set(tracks.flatMap((tr) => tr.clips).filter((c) => s.companions.includes(c.id)).map(link).filter(Boolean));
    if (lgs.size) for (const tr of tracks) for (const c of tr.clips) if (lgs.has(link(c))) group.add(c.id);

    // Snap targets: exact times from the document. Cuts and the playhead always; beats, bar starts, scene cuts and the
    // user's markers while "snap to beats" is on (for a move and for a trim alike). Alt suspends snapping.
    const targets: SnapTarget[] = [{ time: T.ZERO, kind: 'zero' }, { time: editor.playhead, kind: 'playhead' }];
    for (const tr of tracks) for (const c of tr.clips) {
      if (group.has(c.id)) continue;
      targets.push({ time: c.start, kind: 'clip-edge' }, { time: clipEnd(c), kind: 'clip-edge' });
    }
    if (readSnapBeats()) {
      const m = timelineMarkers(doc);
      targets.push(...beatSnapTargets(m.beats, m.downbeats, rate));
      for (const c of markerSnapCandidates(m.sceneCuts, rate)) targets.push({ time: c, kind: 'scene' });
      for (const mk of Object.values(doc.markers ?? {})) if (mk.sequenceId === doc.mainSequenceId) targets.push({ time: T.snapToFrame(mk.time, rate), kind: 'marker' });
    }
    if (s.roll) {
      // The cut being rolled is where it starts: edges of other clips at that same time (linked sound, other tracks) must not hold it there.
      const cut = s.mode === 'trim-start' ? s.start : T.add(s.start, s.duration);
      for (let i = targets.length - 1; i >= 0; i--) if (targets[i]!.kind === 'clip-edge' && T.eq(targets[i]!.time, cut)) targets.splice(i, 1);
    }
    const snapping = !e.altKey && !s.slide; // a slide moves between its two neighbours by whole frames; there is nothing useful to snap to
    let snappedTo: SnapKind | null = null;
    let byEnd = false;
    const trySnap = (time: T.RationalTime) => (snapping ? snapToTargets({ time, targets, pxPerSecond: pps, thresholdPx: SNAP_PX }) : null);
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
      if (a && da <= db) { start = a.time; snappedTo = a.kind; }
      else if (b) { start = T.sub(b.time, s.duration); snappedTo = b.kind; byEnd = true; }
      else start = rawStart;
      start = T.snapToFrame(start, rate);
      // The earliest moving clip stops at 0, so the group keeps its shape.
      const floor = T.sub(s.start, s.groupMin);
      if (T.lt(start, floor)) start = floor;
      if (s.slide) { if (T.lt(start, s.slide.min)) start = s.slide.min; if (T.lt(s.slide.max, start)) start = s.slide.max; }
      endT = T.add(start, s.duration);
    } else if (s.mode === 'trim-start') {
      const raw = T.add(s.start, delta);
      const a = trySnap(raw);
      if (a) snappedTo = a.kind;
      start = T.snapToFrame(a ? a.time : raw, rate);
      if (T.isNegative(start)) start = T.ZERO;
      const latest = T.sub(origEnd, frame);
      if (T.lt(latest, start)) start = latest;
      if (s.roll && T.lt(start, s.roll.limit)) start = s.roll.limit;
    } else {
      const raw = T.add(origEnd, delta);
      const a = trySnap(raw);
      if (a) snappedTo = a.kind;
      endT = T.snapToFrame(a ? a.time : raw, rate);
      const earliest = T.add(s.start, frame);
      if (T.lt(endT, earliest)) endT = earliest;
      if (s.roll && T.lt(s.roll.limit, endT)) endT = s.roll.limit;
    }
    s.result = { start, end: endT };
    const track = tracks.find((t) => t.id === s.trackId);
    const invalid = !!track && s.trackKind !== 'audio' && overlapsOnTrack(track.clips, group, start, endT);
    const fr = (t: T.RationalTime) => T.frameIndexAt(t, rate);
    const endEdge = s.mode === 'trim-end' || (s.mode === 'move' && byEnd);
    // a snap that the limits above pulled the edge away from is no longer a snap
    const edge = endEdge ? endT : start;
    if (snappedTo && !targets.some((t) => t.kind === snappedTo && T.eq(t.time, edge))) snappedTo = null;
    setGhost({
      clipId: s.clipId, mode: s.mode, leftPx: T.toSeconds(start) * pps, widthPx: Math.max(4, T.toSeconds(T.sub(endT, start)) * pps - 1), snappedTo, invalid,
      edgeFrame: fr(edge), deltaFrames: s.mode === 'trim-end' ? fr(endT) - fr(origEnd) : fr(start) - fr(s.start), durationFrames: fr(endT) - fr(start),
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
