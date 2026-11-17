/**
 * The ride bar (docs/design/UX_REDESIGN.md §4.7): the actions on what is selected, in the timeline's toolbar row, centred
 * over the selection and kept inside the toolbar. It starts with a gold chip that says how long the selection is, in bars
 * or beats when the length is a whole number of them and the beat was analysed, in seconds otherwise.
 *   a clip      split · speed · animation · effect · transition · sound · replace · duplicate · delete · more
 *   several     duplicate · delete · link · more
 *   a cut       the transition (a short list of common ones, and the gallery) · lock to the beat · move the cut by a frame · remove
 *   nothing     the same clip actions, unavailable and quiet, each saying what it needs
 * Each action is the command the keyboard runs (commands.ts) or one registered op through the editor's commit. The actions
 * that open a tab of the inspector or a gallery ask for it with `openPanel` below: they do not reach into those panels.
 * The bar is one toolbar for assistive technology: Tab enters it, the arrow keys move inside it.
 */
import { forwardRef, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ArrowLeftRight, AudioLines, Blend, Check, ChevronLeft, ChevronRight, ClipboardPaste, Copy, CopyPlus, Ellipsis, Gauge, Link2, Scissors, Sparkles, Spline, Trash2, Unlink2, Volume2 } from 'lucide-react';
import * as T from '@pulseframe/time';
import { findClip, previousAdjacent, transitionDef, velocityLimit, type Clip } from '@pulseframe/core';
import { Menu, Tooltip, cx, type MenuItem } from '../ds/index.ts';
import { rovingNext } from '../ds/logic.ts';
import { COMMANDS, chordLabel } from './commands.ts';
import { cutSelection, DEFAULT_TRANSITION, defaultTransitionFrames, useSelectedCut } from './CutChip.tsx';
import { IconBeatLock } from './icons.tsx';
import { signedTimecode, type BarGrid } from './interactions.math.ts';
import { useEditorState, type Editor } from './store.ts';
import { TL_STRINGS, type TlStrings } from './timeline.strings.ts';

/** A place the ride bar can ask the editor to show: a tab of the inspector, or a gallery. */
export type PanelTarget = 'speed' | 'animation' | 'effects' | 'transition' | 'transitions-gallery' | 'sound' | 'replace';
/**
 * Ask for a panel. A cancellable `pf:open-panel` event goes to the window (detail: { target, clipId }); the panel that
 * shows the target handles it and calls preventDefault. While no panel listens, the controls that carry the kept test ids
 * of that content are used instead: the gallery button, the inspector's tab, the block of that property.
 */
export function openPanel(target: PanelTarget, clipId: string | null): void {
  const ev = new CustomEvent('pf:open-panel', { detail: { target, clipId }, cancelable: true });
  if (!window.dispatchEvent(ev)) return;
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  const show = (el: HTMLElement | null) => {
    if (!el) return false;
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
    el.scrollIntoView({ block: 'center' });
    (el.matches('button, input, select, textarea, [tabindex]') ? el : el.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]'))?.focus({ preventScroll: true });
    return true;
  };
  if (target === 'effects' || target === 'transitions-gallery') { q('[data-testid=inspector-tab-clip][aria-selected=false]')?.click(); requestAnimationFrame(() => q('[data-testid=gallery-open]')?.click()); return; }
  if (target === 'sound') { const tab = q('[data-testid=inspector-tab-sound]'); if (tab) { tab.click(); tab.focus(); } return; }
  q('[data-testid=inspector-tab-clip][aria-selected=false]')?.click();
  const first: Record<Exclude<PanelTarget, 'effects' | 'transitions-gallery' | 'sound'>, string> = { speed: '[data-testid=clip-speed]', animation: '[data-testid=animate-controls], [data-testid=text-animation]', transition: '[data-testid=transition-type], [data-testid=transition-controls]', replace: '[data-testid=replace-media-block]' };
  requestAnimationFrame(() => show(q(first[target])));
}

/** The test id of a clip action of the bar: bar-split, bar-duplicate, bar-delete. */
const barId = (id: string) => `bar-${id.slice(5)}`;
const key = (id: string) => { const k = COMMANDS.find((c) => c.id === id)?.keys[0]; return k ? chordLabel(k).split('+') : undefined; };
const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const can = (id: string, editor: Editor) => { const c = cmd(id); return !!editor.doc && (!c.enabled || c.enabled(editor)); };
/** The transitions offered straight from the ride bar: one familiar type of each family; the rest are in the gallery. */
const QUICK_TRANSITIONS = ['dissolve', 'dip-black', 'dip-white', 'wipe-left', 'push-left', 'zoom'];

/** A length as the gold chip says it. */
export function lengthLabel(s: TlStrings, frames: number, rate: T.Rate, grid: BarGrid | null): { text: string; musical: boolean } {
  const m = grid?.lengthIn(frames);
  if (m) return { text: m.unit === 'bar' ? s.bars(String(m.count)) : s.beats(String(m.count)), musical: true };
  return { text: s.seconds((Math.round(((frames * rate.den) / rate.num) * 10) / 10).toFixed(1)), musical: false };
}

/**
 * One action of the bar: an icon and its label (the label is kept for assistive technology when the bar shows icons only),
 * a tooltip with the name and the key, and, while it cannot be used, the reason in place of the name (the button stays
 * focusable so the reason can be reached).
 */
interface ActProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> { label: string; icon: ReactNode; keys?: string[]; reason?: string; danger?: boolean; pressed?: boolean; iconOnly?: boolean; testId?: string }
const Act = forwardRef<HTMLButtonElement, ActProps>(function Act({ label, icon, keys, reason, danger, pressed, iconOnly, testId, onClick, className, ...rest }, ref) {
  return (
    <Tooltip label={reason ?? label} keys={reason ? undefined : keys} reason={!!reason}>
      <button ref={ref} type="button" {...rest} data-testid={testId} aria-disabled={reason ? true : undefined} aria-pressed={pressed}
        className={cx('pf-btn', danger ? 'pf-btn-danger-quiet' : 'pf-btn-ghost', 'pf-btn-sm', 'ride-btn', iconOnly && 'is-icon', reason && 'is-disabled', pressed && 'is-on', className)}
        onClick={(e) => { if (reason) { e.preventDefault(); return; } onClick?.(e); }}>
        {icon}<span className="pf-btn-label">{label}</span>
      </button>
    </Tooltip>
  );
});
const ico = (I: typeof Scissors) => <I size={15} strokeWidth={1.75} aria-hidden="true" />;

export function RideBar({ anchor, grid }: { /** centre of the selection, in pixels from the left edge of the timeline; null when nothing is selected */ anchor: number | null; grid: BarGrid | null }) {
  const { editor, state } = useEditorState(); // also re-renders with the playhead: what split can do depends on it
  void state.tick;
  const s = TL_STRINGS[state.lang];
  const doc = state.doc, rate = editor.rate;
  const cutOf = useSelectedCut();
  const root = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  const sel = state.selection;
  const clips = useMemo(() => (doc ? sel.map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f) : []), [doc, sel]);
  const one = clips.length === 1 ? clips[0]! : null;
  const cut = one && cutOf === one.clip.id && one.clip.type === 'media' && one.track.kind === 'video' ? one : null;
  const mode: 'cut' | 'clip' | 'many' | 'none' = cut ? 'cut' : clips.length > 1 ? 'many' : one ? 'clip' : 'none';

  // centred on the selection, clamped to the room the toolbar leaves between its two ends
  useLayoutEffect(() => {
    const el = root.current, zone = el?.parentElement;
    if (!el || !zone) return;
    const place = () => {
      const z = zone.getBoundingClientRect(), tl = zone.closest('.timeline')?.getBoundingClientRect(), w = el.offsetWidth;
      const want = anchor === null || !tl ? z.width / 2 : anchor + tl.left - z.left;
      setLeft(Math.round(Math.max(0, Math.min(Math.max(0, z.width - w), want - w / 2))));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(zone); ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, mode, state.lang, sel.length, one?.clip.id]);

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('button') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to = rovingNext(i, e.key, { count: items.length, dir: state.lang === 'he' ? 'rtl' : 'ltr' });
    if (to === null) return;
    e.preventDefault(); e.stopPropagation(); // the arrows move inside the bar here, not the playhead
    items[to]?.focus();
  };

  const run = (id: string) => () => void cmd(id).run(editor);
  const locked = editor.selectionLocked;
  const none = mode === 'none';
  const why = (id: string, need: string) => (none ? s.needClip : locked ? s.locked : can(id, editor) ? undefined : need);

  let chip: ReactNode = null, body: ReactNode = null;
  if (mode === 'cut' && cut && doc) {
    const clip = cut.clip as Extract<Clip, { type: 'media' }>;
    const tr = clip.transition;
    const spare = velocityLimit(doc, clip.id).haveOutFrames;
    const hasPrev = !!previousAdjacent(cut.track, clip);
    const setType = (type: string) => void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type, frames: tr ? tr.frames : defaultTransitionFrames(rate, spare) } }], 'Transition');
    const items: MenuItem[] = [
      ...QUICK_TRANSITIONS.map((id) => ({ id, label: transitionDef(id)?.name[state.lang] ?? id, icon: tr?.type === id ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : undefined })),
      { id: '#gallery', label: s.allTransitions, icon: <Sparkles size={14} strokeWidth={1.75} aria-hidden="true" /> },
    ];
    chip = <span className="ride-chip is-cut" data-testid="ride-length"><Scissors size={13} strokeWidth={1.75} aria-hidden="true" /><span>{s.cut}</span><bdi className="num">{signedTimecode(T.frameIndexAt(clip.start, rate), rate).slice(1)}</bdi></span>;
    body = (
      <>
        <Menu label={s.rTransition} items={items} onSelect={(id) => (id === '#gallery' ? openPanel('transitions-gallery', clip.id) : setType(id))}
          trigger={(p) => <Act {...p} testId="ride-transition" label={tr ? transitionDef(tr.type)?.name[state.lang] ?? s.rTransition : s.rTransition} icon={ico(Blend)} reason={locked ? s.locked : undefined} className="keeps-label" />} />
        <Act testId="ride-beat-lock" className="ride-beat" label={s.cutBeatLock} icon={<IconBeatLock size={15} />} pressed={tr?.sync === 'beat'} reason={!tr ? s.cutAdd : !grid ? s.rulerBarsNeed : locked ? s.locked : undefined}
          onClick={() => void editor.commit([{ op: 'set_transition_options', args: { clipId: clip.id, sync: tr?.sync === 'beat' ? null : 'beat' } }], 'Beat lock')} />
        <span className="ride-sep" aria-hidden="true" />
        <Act testId="ride-roll-earlier" iconOnly label={s.cutRollEarlier} keys={key('edit.rollEarlier')} reason={!hasPrev || !can('edit.rollEarlier', editor) ? s.cutNoHandles : undefined} icon={ico(ChevronLeft)} onClick={run('edit.rollEarlier')} />
        <span className="ride-word">{s.frame}</span>
        <Act testId="ride-roll-later" iconOnly label={s.cutRollLater} keys={key('edit.rollLater')} reason={!hasPrev || !can('edit.rollLater', editor) ? s.cutNoHandles : undefined} icon={ico(ChevronRight)} onClick={run('edit.rollLater')} />
        <span className="ride-sep" aria-hidden="true" />
        <Act testId="ride-transition-remove" danger label={s.cutRemove} icon={ico(Trash2)} reason={!tr ? s.cutAdd : locked ? s.locked : undefined}
          onClick={() => void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type: null } }], 'Remove transition')} />
      </>
    );
  } else {
    const clip = one?.clip;
    const isPicture = !!one && clip?.type === 'media' && one.track.kind === 'video';
    const isSound = !!one && clip?.type === 'media' && (one.track.kind === 'audio' || (isPicture && !!clip.linkGroupId));
    const isMedia = clip?.type === 'media';
    const visual = !!one && clip?.type !== 'caption' && one.track.kind !== 'audio';
    const canTransition = isPicture && !!previousAdjacent(one!.track, clip!);
    if (mode === 'clip' && clip) {
      const len = lengthLabel(s, T.frameIndexAt(clip.duration, rate), rate, grid);
      chip = <span className={`ride-chip${len.musical ? ' is-musical' : ''}`} data-testid="ride-length">{len.musical && <AudioLines size={13} strokeWidth={1.75} aria-hidden="true" />}<bdi className="num">{len.text}</bdi></span>;
    } else if (mode === 'many') {
      chip = <span className="ride-chip" data-testid="ride-length"><bdi className="num">{s.nSelected(clips.length)}</bdi></span>;
    }
    const jump = (target: PanelTarget, label: string, icon: ReactNode, testId: string) => <Act testId={testId} label={label} icon={icon} reason={locked ? s.locked : undefined} onClick={() => openPanel(target, clip?.id ?? null)} />;
    const more: MenuItem[] = [
      { id: 'edit.copy', label: s.rCopy, icon: <Copy size={14} strokeWidth={1.75} aria-hidden="true" />, keys: key('edit.copy'), disabled: !can('edit.copy', editor) },
      { id: 'edit.cut', label: s.rCut, icon: <Scissors size={14} strokeWidth={1.75} aria-hidden="true" />, keys: key('edit.cut'), disabled: !can('edit.cut', editor) },
      { id: 'edit.paste', label: s.rPaste, icon: <ClipboardPaste size={14} strokeWidth={1.75} aria-hidden="true" />, keys: key('edit.paste'), disabled: !can('edit.paste', editor) },
      { id: 'edit.link', label: s.link, icon: <Link2 size={14} strokeWidth={1.75} aria-hidden="true" />, disabled: !can('edit.link', editor) },
      ...(one && clip?.type === 'media' && clip.linkGroupId ? [{ id: '#unlink', label: s.unlink, icon: <Unlink2 size={14} strokeWidth={1.75} aria-hidden="true" />, disabled: locked }] : []),
      { id: 'edit.closeGaps', label: s.closeGaps, icon: <ArrowLeftRight size={14} strokeWidth={1.75} aria-hidden="true" />, disabled: !can('edit.closeGaps', editor) },
    ];
    body = (
      <>
        <Act testId={barId('edit.split')} label={s.rSplit} keys={key('edit.split')} reason={why('edit.split', s.needPlayhead)} icon={ico(Scissors)} onClick={run('edit.split')} />
        {mode === 'clip' && (
          <>
            {isMedia && jump('speed', s.rSpeed, ico(Gauge), 'ride-speed')}
            {visual && jump('animation', s.rAnim, ico(Spline), 'ride-animation')}
            {visual && jump('effects', s.rEffect, ico(Sparkles), 'ride-effect')}
            {isPicture && (
              <Act testId="ride-transition" label={s.rTransition} icon={ico(Blend)} reason={locked ? s.locked : !canTransition && !(clip as Extract<Clip, { type: 'media' }>).transition ? s.needVideoCut : undefined}
                onClick={() => {
                  const c = clip as Extract<Clip, { type: 'media' }>;
                  cutSelection.set(c.id); // the bar turns into the cut's tools
                  if (!c.transition && doc) { const spare = velocityLimit(doc, c.id).haveOutFrames; if (spare !== 0) void editor.commit([{ op: 'set_transition', args: { clipId: c.id, type: DEFAULT_TRANSITION, frames: defaultTransitionFrames(rate, spare) } }], 'Add transition'); }
                }} />
            )}
            {isSound && jump('sound', s.rSound, ico(Volume2), 'ride-sound')}
            {isMedia && jump('replace', s.rReplace, ico(ArrowLeftRight), 'ride-replace')}
          </>
        )}
        <Act testId={barId('edit.duplicate')} label={s.rDuplicate} keys={key('edit.duplicate')} reason={why('edit.duplicate', s.needClip)} icon={ico(CopyPlus)} onClick={run('edit.duplicate')} />
        <Act testId={barId('edit.delete')} danger label={s.rDelete} keys={key('edit.delete')} reason={why('edit.delete', s.needClip)} icon={ico(Trash2)} onClick={run('edit.delete')} />
        <Menu label={s.rMore} items={more} onSelect={(id) => { if (id === '#unlink') void editor.commit([{ op: 'unlink_clip', args: { clipId: clip!.id } }], 'Unlink'); else void cmd(id).run(editor); }}
          trigger={(p) => <Act {...p} iconOnly testId="ride-more" label={s.rMore} icon={ico(Ellipsis)} />} />
      </>
    );
  }
  return (
    <div ref={root} className={`ride${none ? ' is-idle' : ''}`} role="toolbar" aria-label={s.ride} aria-orientation="horizontal" data-testid="timeline-actions" data-mode={mode} dir={state.lang === 'he' ? 'rtl' : 'ltr'}
      style={left === null ? { visibility: 'hidden' } : { left }} onKeyDown={onKey}>
      {chip}
      {body}
    </div>
  );
}
