/**
 * The keyframe strip «פס קיפריימים» (ADR-0019, W2): a sibling overlay of the selected picture, title or adjustment clip on the
 * timeline (data-drag-clip, as VolumeLine; Timeline.tsx mounts it where VolumeLine is mounted, VolumeLine stays on sound clips).
 * Interactive for a single selected clip on an unlocked track, read-only in a format view (i18n keys.readOnlyFormat). One
 * <button aria-pressed> per keyed frame, aggregated by exact frame with effect keys included (core keyEdits.ts keyTimes), its
 * glyph SHAPE showing the curve after it and its name the timecode, channels and curve; keys outside the clip as an edge chip.
 * Click selects, Shift/Mod toggles, double-click opens the curve picker; drag after 3 px moves whole frames counted from the
 * original positions and commits once on release (keyEdits.ts moveKeysOps); a context menu offers Smooth / Straight / Curve… /
 * Copy / Paste / Delete. Focused keys handle their own keys and stop propagation (VolumeLine.tsx). Selection lives in the
 * editor's session state (store.ts keySel), never in the document. Test ids: keyframes.testids.ts KF_TESTIDS.strip, key,
 * outside, menu, menuItem. Strings: i18n keys.*, curve.*.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import * as T from '@pulseframe/time';
import { CURVES_BUILT, keyTimes, moveKeysOps, type ChannelRef, type Clip, type KeyAt, type KeyRef, type Track } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { copySelectedKeys, curveSelected, deleteSelectedKeys, nudgeSelectedKeys, pasteKeys } from './commands.ts';
import { KF_TESTIDS } from './keyframes.testids.ts';
import { channelName, clampDelta, framesForPixels, glyphOf, isDrag, isSelected, refsAt, selectFrame, stripLayout, type KeySel } from './keyStrip.math.ts';
import './keyframes.css';

export interface KeyStripProps {
  clip: Clip;
  track: Track;
  /** The clip is the only selected clip (the strip is interactive only then). */
  selected: boolean;
  /** The track is not locked and no format is viewed. */
  editable: boolean;
  /** Timeline zoom (pixels per second), and the clip's drawn box on the lane (as VolumeLine). */
  pps: number;
  left: number;
  width: number;
  clipHeight: number;
  clipTop: number;
}
/** The strip's height; it sits on the clip's lower edge. */
export const KEY_STRIP_H = 16;

export { channelName };

export function KeyStrip(props: KeyStripProps): ReactElement | null {
  const { clip, track, selected, editable, pps, left, width, clipHeight, clipTop } = props;
  const { editor, state, t } = useEditorState();
  const rate = editor.rate;
  const keys = useMemo(() => keyTimes(clip, track, rate), [clip, track, rate]);
  const count = T.frameIndexAt(clip.duration, rate);
  const layout = useMemo(() => stripLayout(keys, rate, pps), [keys, rate, pps]);
  const sel = state.keySel && state.keySel.clipId === clip.id ? state.keySel : null;
  const inFormat = !!state.viewVariantId;
  const interactive = selected && editable && !inFormat;
  const [drag, setDrag] = useState<{ delta: number; refused: boolean } | null>(null);
  const session = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; delta: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  if (!selected || keys.length === 0) return null;

  const shiftOf = (at: KeyAt) => (drag && !drag.refused && isSelected(sel, clip.id, at) !== 'none' && at.inside ? drag.delta : 0);
  const labelOf = (at: KeyAt) => `${t('keys.key')} ${T.toTimecode(T.add(clip.start, T.frameTime(at.frame, rate)), rate)} · ${at.channels.map((c) => channelName(clip, c, t, state.lang)).join(', ')} · ${[...new Set(at.easings)].map((e) => t(`curve.name.${e}` as Key)).join(', ')}`;

  const onDown = (at: KeyAt) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation(); // not a clip drag, not a marquee
    if (e.button !== 0 || !interactive) return;
    const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
    const state0 = isSelected(sel, clip.id, at);
    if (toggle || state0 !== 'all') editor.setKeySel(selectFrame(sel, clip.id, at, toggle));
    if (toggle) return; // a toggle is a click, not the start of a drag
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    session.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved: false, delta: 0 };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = session.current, ks = editor.getState().keySel;
    if (!s || !ks || e.pointerId !== s.pointerId) return;
    const dx = e.clientX - s.startX, dy = e.clientY - s.startY;
    if (!s.moved && !isDrag(dx, dy)) return;
    s.moved = true;
    const delta = clampDelta(framesForPixels(dx, pps, rate), ks.keys.map((k) => k.frame), count);
    s.delta = delta;
    const r = moveKeysOps(clip, track, rate, ks.keys, delta);
    setDrag({ delta, refused: 'refused' in r });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    session.current = null;
    const d = drag;
    setDrag(null);
    if (s.moved && d && !d.refused && d.delta !== 0) void nudgeSelectedKeys(editor, d.delta); // one commit, from the original positions
    else if (s.moved && d?.refused) editor.notify({ kind: 'info', title: t('keys.crosses') });
  };
  const cancel = () => { session.current = null; setDrag(null); };

  const openPicker = (at: KeyAt) => editor.openCurvePicker(clip.id, at.frame, at.channels);
  const focusClip = () => document.querySelector<HTMLElement>(`[data-testid="clip-${clip.id}"]`)?.focus();
  const onKey = (at: KeyAt) => (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!interactive) return;
    const mod = e.ctrlKey || e.metaKey;
    const own = () => { if (isSelected(sel, clip.id, at) === 'none') editor.setKeySel(selectFrame(sel, clip.id, at, false)); };
    const handled = (() => {
      if (mod) {
        if (e.code === 'KeyA') { editor.setKeySel({ clipId: clip.id, keys: keys.flatMap(refsAt) }); return true; }
        if (e.code === 'KeyC') { own(); copySelectedKeys(editor); return true; }
        if (e.code === 'KeyV') { void pasteKeys(editor); return true; }
        return false;
      }
      switch (e.code) {
        case 'ArrowLeft': case 'ArrowRight': own(); void nudgeSelectedKeys(editor, (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)); return true;
        case 'KeyS': own(); if (CURVES_BUILT) void curveSelected(editor, 'smooth'); return true;
        case 'KeyL': own(); void curveSelected(editor, 'linear'); return true;
        case 'Enter': case 'NumpadEnter': openPicker(at); return true;
        case 'Space': editor.setKeySel(selectFrame(sel, clip.id, at, true)); return true;
        case 'Delete': case 'Backspace': own(); void deleteSelectedKeys(editor); return true;
        case 'Escape':
          if (session.current) cancel(); else if (sel) editor.setKeySel(null); else focusClip();
          return true;
        default: return false;
      }
    })();
    if (handled) { e.preventDefault(); e.stopPropagation(); } // these keys act on the keys, not on the clip or the playhead
  };
  const outsideRefs = (side: 'before' | 'after'): KeyRef[] => keys.filter((k) => !k.inside && (side === 'before' ? k.frame < 0 : k.frame >= 0)).flatMap(refsAt);

  return (
    <div className={`key-strip${interactive ? ' active' : ' readonly'}`} data-testid={KF_TESTIDS.strip} data-drag-clip={clip.id} data-keys={keys.length} role="group" aria-label={t('keys.strip')}
      title={inFormat ? t('keys.readOnlyFormat') : undefined} style={{ left, width, height: KEY_STRIP_H, top: clipTop + clipHeight - KEY_STRIP_H }}>
      {(['before', 'after'] as const).map((side) => (side === 'before' ? layout.before : layout.after) > 0 && (
        <button key={side} type="button" className={`key-outside ${side}`} data-testid={KF_TESTIDS.outside} data-side={side} data-count={side === 'before' ? layout.before : layout.after} disabled={!interactive}
          aria-label={`${t('keys.outside')}: ${side === 'before' ? layout.before : layout.after}`} title={`${t('keys.outside')}: ${side === 'before' ? layout.before : layout.after}`}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); editor.setKeySel({ clipId: clip.id, keys: outsideRefs(side) }); }}>
          {side === 'before' ? '‹' : '›'}{side === 'before' ? layout.before : layout.after}
        </button>
      ))}
      {layout.dots.map(({ at, x }) => {
        const state0 = isSelected(sel, clip.id, at);
        const shift = shiftOf(at);
        return (
          <button key={at.frame} type="button" className={`key-dot glyph-${glyphOf(at.easings)}${state0 !== 'none' ? ' is-selected' : ''}${drag?.refused && state0 !== 'none' ? ' is-refused' : ''}`}
            data-testid={KF_TESTIDS.key} data-frame={at.frame} data-easing={at.easings[0]} data-channels={at.channels.length} aria-pressed={state0 !== 'none'} aria-disabled={!interactive || undefined}
            aria-label={labelOf(at)} title={labelOf(at)} style={{ left: x + (shift ? T.toSeconds(T.frameTime(shift, rate)) * pps : 0) }}
            onPointerDown={onDown(at)} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={cancel} onKeyDown={onKey(at)}
            onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); if (interactive) openPicker(at); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!interactive) return; if (state0 === 'none') editor.setKeySel(selectFrame(sel, clip.id, at, false)); setMenu({ x: e.clientX, y: e.clientY }); }} />
        );
      })}
      {drag?.refused && <span className="sr-only" role="status">{t('keys.crosses')}</span>}
      {menu && <KeyMenu x={menu.x} y={menu.y} sel={sel} onClose={() => { setMenu(null); document.querySelector<HTMLElement>('[data-testid=key-strip-key][aria-pressed=true]')?.focus(); }} />}
    </div>
  );
}

/** The context menu: Smooth / Straight / Curve… / Copy / Paste / Delete. role=menu, arrow keys move, Escape closes. */
function KeyMenu({ x, y, sel, onClose }: { x: number; y: number; sel: KeySel | null; onClose: () => void }) {
  const { editor, state, t } = useEditorState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus(); }, []);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [onClose]);
  const items: { action: string; label: string; disabled?: string; run: () => void }[] = [
    { action: 'smooth', label: t('curve.smooth'), disabled: CURVES_BUILT ? undefined : t('curve.notBuilt'), run: () => void curveSelected(editor, 'smooth') },
    { action: 'straight', label: t('curve.straight'), run: () => void curveSelected(editor, 'linear') },
    { action: 'curve', label: t('keys.menu.curve'), run: () => { const k = sel?.keys[0]; if (sel && k) editor.openCurvePicker(sel.clipId, k.frame, sel.keys.filter((q) => q.frame === k.frame).map((q) => q.channel)); } },
    { action: 'copy', label: t('keys.menu.copy'), run: () => copySelectedKeys(editor) },
    { action: 'paste', label: t('keys.menu.paste'), disabled: state.keyClipboard && editor.playheadOnSelection ? undefined : t('keys.menu.paste'), run: () => void pasteKeys(editor) },
    { action: 'delete', label: t('keys.menu.delete'), run: () => void deleteSelectedKeys(editor) },
  ];
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
  return createPortal(
    <div ref={ref} className="key-menu" role="menu" aria-label={t('keys.menu')} data-testid={KF_TESTIDS.menu} style={{ left: x, top: y }} onKeyDown={onKey}>
      {items.map((it) => (
        <button key={it.action} type="button" role="menuitem" className="key-menu-item" data-testid={KF_TESTIDS.menuItem} data-action={it.action} aria-disabled={it.disabled ? true : undefined} title={it.disabled}
          onClick={() => { if (it.disabled) return; it.run(); onClose(); }}>{it.label}</button>
      ))}
    </div>, document.body);
}
