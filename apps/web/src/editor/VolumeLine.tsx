/**
 * The volume line of a sound clip, drawn over the clip on the timeline (SPEC §17 automation).
 * Always visible when the clip has volume keys. When the clip is the selection, each key is a handle:
 * drag it (up/down = level, sideways = time, whole frames), arrow keys nudge it, Delete or a double-click removes it,
 * S makes the stretch after it smooth or straight, and a double-click on the line adds a key there. Alt + drag that starts
 * on the line draws the level freehand: the keys under the stroke are replaced by the drawn ones, as one edit.
 * Every change is a registered op (the ones the Sound panel uses, and `draw_volume` for a stroke).
 * The wrapper names the clip for the drag handler (`data-drag-clip`), so a drag that starts on the line still moves the clip.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import * as T from '@pulseframe/time';
import { volumeLevelAt, volumePoints, type Clip } from '@pulseframe/core';
import { useEditorState } from './store.ts';

type MediaClip = Extract<Clip, { type: 'media' }>;
const H = 34, PAD = 4, TOP = 2; // the line uses the clip's height; a level of 2 (+6 dB) or more is drawn at the top
export const levelToY = (v: number): number => H - PAD - (Math.min(TOP, Math.max(0, v)) / TOP) * (H - 2 * PAD);
export const yToLevel = (y: number): number => Math.round(Math.min(TOP, Math.max(0, ((H - PAD - y) / (H - 2 * PAD)) * TOP)) * 100) / 100;

export function VolumeLine({ clip, selected, editable, pps, left, width }: { clip: MediaClip; selected: boolean; editable: boolean; pps: number; left: number; width: number }) {
  const { editor, t } = useEditorState();
  const rate = editor.rate;
  const [drag, setDrag] = useState<{ index: number; frame: number; value: number } | null>(null);
  const session = useRef<{ pointerId: number; index: number; startX: number; startY: number; frame0: number; y0: number; moved: boolean } | null>(null);
  const [stroke, setStroke] = useState<Map<number, number> | null>(null); // freehand: frame → level, while drawing
  const drawing = useRef<{ pointerId: number; left: number; top: number; step: number } | null>(null);
  const stored = (clip.volume ?? []).map((k) => ({ frame: T.frameIndexAt(k.time, rate), value: k.value, curve: k.curve }));
  const keys = drag ? stored.map((k, i) => (i === drag.index ? { ...k, frame: drag.frame, value: drag.value } : k)) : stored;
  const lastFrame = T.frameIndexAt(clip.duration, rate);
  const xOf = (frame: number) => T.toSeconds(T.frameTime(frame, rate)) * pps;
  // the same points the mixers follow (a smooth stretch is a run of short straight pieces)
  const shape = volumePoints(keys.map((k) => ({ time: T.frameTime(k.frame, rate), value: k.value, ...(k.curve ? { curve: k.curve } : {}) })), (t) => T.toSeconds(t) * pps);
  const points = keys.length ? [{ x: 0, y: levelToY(keys[0]!.value) }, ...shape.map((q) => ({ x: q.x, y: levelToY(q.value) })), { x: width, y: levelToY(keys[keys.length - 1]!.value) }] : [{ x: 0, y: levelToY(1) }, { x: width, y: levelToY(1) }];
  const path = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const levelAtFrame = (frame: number): number => volumeLevelAt(clip.volume, T.frameTime(frame, rate));
  /** Frames a key may move to: inside the clip and strictly between its neighbours. */
  const bounds = (index: number): [number, number] => [index > 0 ? stored[index - 1]!.frame + 1 : 0, index < stored.length - 1 ? stored[index + 1]!.frame - 1 : lastFrame];
  const write = (index: number, frame: number, value: number) => {
    const was = stored[index]!;
    if (was.frame === frame && was.value === value) return;
    const ops: { op: string; args: Record<string, unknown> }[] = [];
    if (was.frame !== frame) ops.push({ op: 'delete_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(was.frame, rate) } });
    ops.push({ op: 'set_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(frame, rate), value } });
    void editor.commit(ops, 'Volume key');
  };
  const remove = (index: number) => void editor.commit([{ op: 'delete_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(stored[index]!.frame, rate) } }], 'Remove volume key');

  const onDown = (index: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // not a clip drag, not a marquee
    if (e.button !== 0) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    session.current = { pointerId: e.pointerId, index, startX: e.clientX, startY: e.clientY, frame0: stored[index]!.frame, y0: levelToY(stored[index]!.value), moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
    if (!s.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    s.moved = true;
    const [lo, hi] = bounds(s.index);
    const frame = Math.min(hi, Math.max(lo, s.frame0 + Math.round(((dx / pps) * rate.num) / rate.den)));
    setDrag({ index: s.index, frame, value: yToLevel(s.y0 + dy) });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    session.current = null;
    if (s.moved && drag) write(drag.index, drag.frame, drag.value);
    setDrag(null);
  };
  /** Keyboard nudge. Computed against the live project when the edit runs, so quick repeated presses each count. */
  const nudge = (index: number, dFrame: number, dValue: number) => void editor.commit(() => {
    const live = editor.doc?.sequences[editor.doc.mainSequenceId]?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id);
    const ks = live?.type === 'media' ? (live.volume ?? []).map((k) => ({ frame: T.frameIndexAt(k.time, rate), value: k.value })) : [];
    const k = ks[index];
    if (!live || !k) return null;
    const lo = index > 0 ? ks[index - 1]!.frame + 1 : 0, hi = index < ks.length - 1 ? ks[index + 1]!.frame - 1 : T.frameIndexAt(live.duration, rate);
    const frame = Math.min(hi, Math.max(lo, k.frame + dFrame)), value = Math.min(4, Math.max(0, Math.round((k.value + dValue) * 100) / 100));
    if (frame === k.frame && value === k.value) return null;
    return [...(frame !== k.frame ? [{ op: 'delete_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(k.frame, rate) } }] : []), { op: 'set_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(frame, rate), value } }];
  }, 'Volume key');
  const onKey = (index: number) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.25 : 0.05;
    const handled = (() => {
      switch (e.key) {
        case 'ArrowUp': nudge(index, 0, step); return true;
        case 'ArrowDown': nudge(index, 0, -step); return true;
        case 'ArrowLeft': nudge(index, -1, 0); return true;
        case 'ArrowRight': nudge(index, 1, 0); return true;
        case 'Delete': case 'Backspace': remove(index); return true;
        case 's': case 'S': { // the stretch from this key to the next: smooth or straight
          const k = stored[index]!;
          void editor.commit([{ op: 'set_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(k.frame, rate), value: k.value, curve: k.curve === 'smooth' ? 'linear' : 'smooth' } }], 'Volume curve');
          return true;
        }
        default: return false;
      }
    })();
    if (handled) { e.preventDefault(); e.stopPropagation(); } // these keys act on the key, not on the clip or the playhead
  };
  const addAt = (clientX: number, box: DOMRect) => {
    const frame = Math.min(lastFrame, Math.max(0, Math.round((((clientX - box.left) / pps) * rate.num) / rate.den)));
    if (stored.some((k) => k.frame === frame)) return;
    void editor.commit([{ op: 'set_volume_keyframe', args: { clipId: clip.id, time: T.frameTime(frame, rate), value: Math.round(levelAtFrame(frame) * 100) / 100 } }], 'Volume key');
  };
  // Freehand: Alt + drag starting on the line. One key per few pixels; released, the keys under the stroke are replaced by it.
  const frameAt = (clientX: number, left: number) => Math.min(lastFrame, Math.max(0, Math.round((((clientX - left) / pps) * rate.num) / rate.den)));
  const drawDown = (e: ReactPointerEvent<SVGPolylineElement>) => {
    if (!e.altKey || e.button !== 0) return; // without Alt the press goes on to the timeline and drags the clip
    e.stopPropagation();
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    const pxPerFrame = (pps * rate.den) / rate.num;
    drawing.current = { pointerId: e.pointerId, left: box.left, top: box.top, step: Math.max(1, Math.round(6 / pxPerFrame)) };
    setStroke(new Map([[frameAt(e.clientX, box.left), yToLevel(e.clientY - box.top)]]));
  };
  const drawMove = (e: ReactPointerEvent<SVGPolylineElement>) => {
    const dr = drawing.current;
    if (!dr || e.pointerId !== dr.pointerId) return;
    const fr = frameAt(e.clientX, dr.left), bucket = Math.min(lastFrame, Math.round(fr / dr.step) * dr.step);
    setStroke((m) => new Map(m ?? []).set(bucket, yToLevel(e.clientY - dr.top)));
  };
  const drawUp = (e: ReactPointerEvent<SVGPolylineElement>) => {
    const dr = drawing.current;
    if (!dr || e.pointerId !== dr.pointerId) return;
    drawing.current = null;
    const drawn = [...(stroke ?? new Map<number, number>()).entries()].sort((x, y) => x[0] - y[0]);
    setStroke(null);
    if (drawn.length < 2) return; // a press without a stroke changes nothing
    void editor.commit([{ op: 'draw_volume', args: { clipId: clip.id, from: T.frameTime(drawn[0]![0], rate), to: T.frameTime(drawn[drawn.length - 1]![0], rate), keys: drawn.map(([fr, value]) => ({ time: T.frameTime(fr, rate), value })) } }], 'Draw volume');
  };
  const strokePath = stroke ? [...stroke.entries()].sort((x, y) => x[0] - y[0]).map(([fr, v]) => `${xOf(fr).toFixed(1)},${levelToY(v).toFixed(1)}`).join(' ') : '';
  const active = selected && editable;
  return (
    <div className={`vol-line${active ? ' active' : ''}`} data-testid={`volume-line-${clip.id}`} data-drag-clip={clip.id} data-keys={stored.length} style={{ left, width }}>
      <svg width={width} height={H} aria-hidden="true" focusable="false">
        <polyline className="vol-path" points={path} />
        {active && <polyline className="vol-hit" data-testid="volume-line-hit" points={path} onDoubleClick={(e) => { e.stopPropagation(); addAt(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect()); }}
          onPointerDown={drawDown} onPointerMove={drawMove} onPointerUp={drawUp} onPointerCancel={() => { drawing.current = null; setStroke(null); }}><title>{t('sound.volume.line')}</title></polyline>}
        {stroke && <polyline className="vol-stroke" data-testid="volume-stroke" points={strokePath} />}
      </svg>
      {active && keys.map((k, i) => {
        const label = `${t('sound.volume.key')} ${T.toTimecode(T.add(clip.start, T.frameTime(k.frame, rate)), rate)} · ${Math.round(k.value * 100)}%`;
        return (
          <button key={i} type="button" className={`vol-key${k.curve === 'smooth' ? ' smooth' : ''}`} data-testid="volume-line-key" data-frame={k.frame} data-value={k.value} data-curve={k.curve ?? 'linear'} aria-label={label} title={`${label}\n${t('sound.volume.keyHelp')}`}
            style={{ left: xOf(k.frame), top: levelToY(k.value) }} onPointerDown={onDown(i)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { session.current = null; setDrag(null); }}
            onKeyDown={onKey(i)} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); remove(i); }} />
        );
      })}
    </div>
  );
}
