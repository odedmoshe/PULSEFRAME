/**
 * What is drawn on a cut of a video track (docs/design/UX_REDESIGN.md §4.7 "Cuts"):
 *   - a transition chip centred on the cut, with a hatched band over the frames the transition plays on (it plays over
 *     the first frames of the clip that carries it); a beat-locked transition has a gold ring and a padlock; a light
 *     transition whose light the flash schedule held back says so (shield); a transition that no longer has the spare
 *     video it needs is amber;
 *   - the end of the band is a handle: dragging it (or the arrow keys on it) changes the transition's length;
 *   - a "+" on a cut with no transition (shown while the lane is hovered or the button has the focus);
 *   - the chip, its handle and the "+" only where the clips on both sides are wide enough to keep their own click (cutRoom):
 *     on a short clip only the band is drawn, and the transition is reached from the clip's ride bar;
 *   - a gold diamond on a cut that lands on an analysed beat.
 * Every change is the registered op set_transition through the editor's commit. Which cut is chosen is the editor's view
 * state (store.ts cutClipId, editor.selectCut): the cut inspector, the ride bar and the loupe read it from there.
 */
import { memo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { TriangleAlert } from 'lucide-react';
import * as T from '@pulseframe/time';
import { transitionDef, type Clip } from '@pulseframe/core';
import type { Lang } from '@pulseframe/i18n';
import { Tooltip } from '../ds/index.ts';
import { IconBeatLock, IconCutPlus, IconFlashShield, IconOnBeat } from './icons.tsx';
import { useEditorState, type Editor } from './store.ts';
import { TL_STRINGS } from './timeline.strings.ts';

type MediaClip = Extract<Clip, { type: 'media' }>;

// ---- which cut is chosen: the editor's cutClipId (the id of the clip AFTER the cut, the one a transition sits on) ----
/** The editor of the timeline that reads the chosen cut last (one per page); `cutSelection` below acts on it. */
let bound: Editor | null = null;
/**
 * The chosen cut for code that has no editor at hand (Timeline.tsx): `set` is editor.selectCut without the loupe change of a
 * click on a chip (selecting the clip after the cut with it), `set(null)` lets the cut go; `get` reads it.
 */
export const cutSelection = {
  get: (): string | null => bound?.getState().cutClipId ?? null,
  set(clipId: string | null) { if (bound) bound.selectCut(clipId); },
};
/** The id of the clip after the chosen cut, or null (the editor's state; re-renders when it changes). */
export function useSelectedCut(): string | null {
  const { editor, state } = useEditorState();
  bound = editor;
  return state.cutClipId;
}

/** The length given to a transition added from the "+": half a second, or as much as the spare video allows. */
export function defaultTransitionFrames(rate: T.Rate, spare: number | null): number {
  const half = Math.max(1, Math.round(rate.num / rate.den / 2));
  return spare === null ? half : Math.max(1, Math.min(half, spare));
}
export const DEFAULT_TRANSITION = 'dissolve';

/** The sign of a transition on the timeline: two shots meeting at the cut. Drawn on the icon set's 24 grid and stroke. */
export function TransitionGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg className="pf-ico pf-ico-fixed" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M4 6.5v11l8-5.5zM20 6.5v11l-8-5.5z" />
    </svg>
  );
}

const secondsText = (frames: number, rate: T.Rate) => (Math.round(((frames * rate.den) / rate.num) * 10) / 10).toFixed(1);

export interface CutChipProps {
  editor: Editor;
  lang: Lang;
  /** The clip after the cut: the one that carries the transition. */
  clip: MediaClip;
  /** The clip before the cut on the same track, when the two touch. */
  before: Clip | null;
  beforeName: string;
  afterName: string;
  /** Pixels from the lane's left edge to the cut. */
  x: number;
  pps: number;
  rate: T.Rate;
  locked: boolean;
  /** The cut lands on an analysed beat. */
  onBeat: boolean;
  /** A light transition whose light the flash schedule did not keep (ADR-0012). */
  held: boolean;
  /** Spare source frames after the previous clip's out point; null when there is no limit (no previous clip, or a still). */
  spare: number | null;
  selected: boolean;
  /** A dragged transition tile is over this cut. */
  dropping: boolean;
  /** A clip on either side of the cut is selected: its edge is being worked on, so the "+" stays out of the way of the grip (a dragged tile still shows it). */
  nearSelected: boolean;
  /** What the clips on either side leave room for (interactions.math cutRoom): the "+", and the chip with its length handle. */
  roomAdd: boolean;
  roomChip: boolean;
}

export const CutChip = memo(function CutChip({ editor, lang, clip, before, beforeName, afterName, x, pps, rate, locked, onBeat, held, spare, selected, dropping, nearSelected, roomAdd, roomChip }: CutChipProps) {
  const s = TL_STRINGS[lang];
  const tr = clip.transition;
  const def = tr ? transitionDef(tr.type) : undefined;
  const [dragFrames, setDragFrames] = useState<number | null>(null);
  const session = useRef<{ pointerId: number; x0: number; frames0: number } | null>(null);
  const pxPerFrame = (pps * rate.den) / rate.num;
  const maxFrames = Math.max(1, Math.min(150, T.frameIndexAt(clip.duration, rate), spare === null ? 150 : Math.max(1, spare)));
  const frames = dragFrames ?? tr?.frames ?? 0;
  const short = !!tr && spare !== null && spare < tr.frames;
  const tcAt = T.toTimecode(clip.start, rate);
  const select = () => editor.selectCut(clip.id);

  const setLength = (next: number) => {
    if (!tr) return;
    const n = Math.max(1, Math.min(maxFrames, Math.round(next)));
    if (n !== tr.frames) void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type: tr.type, frames: n } }], 'Transition length');
  };
  const lenDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.button !== 0 || !tr || locked) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    session.current = { pointerId: e.pointerId, x0: e.clientX, frames0: tr.frames };
  };
  const lenMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const q = session.current;
    if (!q || e.pointerId !== q.pointerId) return;
    setDragFrames(Math.max(1, Math.min(maxFrames, q.frames0 + Math.round((e.clientX - q.x0) / pxPerFrame))));
  };
  const lenUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const q = session.current;
    if (!q || e.pointerId !== q.pointerId) return;
    session.current = null;
    if (dragFrames !== null) setLength(dragFrames);
    setDragFrames(null);
  };
  const lenKey = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!tr || locked) return;
    const by = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (!by) return;
    e.preventDefault(); e.stopPropagation(); // the arrows change the length here, not the playhead
    setLength(tr.frames + by * (e.shiftKey ? 5 : 1));
  };

  const add = () => {
    if (locked || spare === 0) return;
    void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type: DEFAULT_TRANSITION, frames: defaultTransitionFrames(rate, spare) } }], 'Add transition').then((r) => { if (r) select(); });
  };

  const lenText = s.seconds(secondsText(frames, rate));
  const name = def?.name[lang] ?? tr?.type ?? '';
  const facts = tr ? [s.cutChip(name, lenText), tr.sync === 'beat' ? s.cutBeatLocked : '', held ? s.cutHeld : '', short ? s.cutShort(s.frames(Math.max(0, spare ?? 0))) : ''].filter(Boolean).join(' · ') : '';
  return (
    <div className={`cut${tr ? ' has-transition' : ''}${selected ? ' selected' : ''}${dropping ? ' dropping' : ''}`} style={{ left: x }} data-cut-of={clip.id} data-testid="cut" data-frame={T.frameIndexAt(clip.start, rate)} data-on-beat={onBeat ? 'true' : undefined}>
      {onBeat && <span className="cut-beat" title={s.cutOnBeat} role="img" aria-label={s.cutOnBeat}><IconOnBeat size={12} /></span>}
      {tr && <i className={`cut-band${tr.sync === 'beat' ? ' beat' : ''}${short ? ' short' : ''}`} style={{ width: Math.max(4, frames * pxPerFrame) }} aria-hidden="true" data-testid="cut-band" />}
      {tr && (roomChip || dropping) ? (
        <Tooltip label={facts}>
          <button type="button" className={`cut-chip${tr.sync === 'beat' ? ' beat' : ''}${held ? ' held' : ''}${short ? ' short' : ''}`} data-testid="cut-chip" data-transition={tr.type} data-frames={tr.frames} data-sync={tr.sync ?? undefined} data-held={held ? 'true' : undefined} data-short={short ? 'true' : undefined}
            aria-pressed={selected} aria-label={`${s.cutAt(tcAt)} · ${facts}`}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); select(); }}>
            <TransitionGlyph size={14} />
            {tr.sync === 'beat' && <IconBeatLock size={12} />}
            {held && <IconFlashShield size={12} />}
            {short && <TriangleAlert size={12} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        </Tooltip>
      ) : !tr && before && ((roomAdd && !nearSelected) || dropping) ? (
        <Tooltip label={spare === 0 ? s.cutNoHandles : s.cutAdd} reason={spare === 0}>
          <button type="button" className="cut-add" data-testid="cut-add" aria-disabled={spare === 0 || locked ? true : undefined} aria-label={`${s.cutAddAt(beforeName, afterName)} · ${tcAt}`}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); add(); }}>
            <IconCutPlus size={14} />
          </button>
        </Tooltip>
      ) : null}
      {tr && !locked && roomChip && (
        <button type="button" className="cut-len" data-testid="cut-len" role="slider" aria-orientation="horizontal" aria-label={s.cutLength} aria-valuemin={1} aria-valuemax={maxFrames} aria-valuenow={frames} aria-valuetext={`${lenText} · ${s.frames(frames)}`} title={s.cutLengthHelp}
          style={{ left: Math.max(4, frames * pxPerFrame) }} onPointerDown={lenDown} onPointerMove={lenMove} onPointerUp={lenUp} onPointerCancel={() => { session.current = null; setDragFrames(null); }} onKeyDown={lenKey} onClick={(e) => e.stopPropagation()} />
      )}
      {dragFrames !== null && <span className="cut-len-chip num" aria-hidden="true" style={{ left: Math.max(4, frames * pxPerFrame) }}>{lenText}</span>}
    </div>
  );
});
