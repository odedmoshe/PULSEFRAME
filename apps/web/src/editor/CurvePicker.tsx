/**
 * The curve picker «בוחר עקומה» and the curve chip (ADR-0019, W2).
 *
 * CurvePicker: role=dialog aria-modal=true with a focus trap (App.tsx's shortcut gate then mutes the global shortcuts behind
 * it), opened for editor state `curvePicker` (store.ts: a clip, a clip-local frame and the channels). Smooth «רך» and Straight
 * «ישר» buttons; a scope radio (every channel at this time, or one channel); a tile per named curve of core keyframe.ts CURVES
 * drawn by the one sampler (animation.ts sampleKeyframes at 41 points), turn-back tiles aria-disabled on light channels with
 * the reason (i18n curve.flashDisabled); a 128×128 custom editor with two focusable handles and four number inputs (x1, y1, x2,
 * y2; x in 0..1, y in -1..2); a preview in channel units, stepped for integer parameters, with a note when the parameter follows
 * the beat. Every choice is one commit (keyEdits.ts curveOps → set_keyframe_curve), applied to the segment AFTER the key.
 * Until the curve maths is built (core curves.ts CURVES_BUILT) the curves of the earlier version are the only ones offered;
 * the others say so (i18n curve.notBuilt). It belongs to the redesigned inspector's Basic tab "keyframe curve drawer"
 * (docs/design/UX_REDESIGN.md §4.6) and opens from a strip key, a path point or a curve chip.
 *
 * CurveChip: a small button beside a keyframe diamond (InspectorObject.tsx TransformRow's keyframe column, LookPanel.tsx's
 * effect parameter keyer) naming the curve after the key at the playhead; it opens the picker for that one channel.
 *
 * Test ids: keyframes.testids.ts KF_TESTIDS.picker, tile(id), custom, customHandle, customInput(i), smooth, straight, scope,
 * preview, chip(channelKey). Strings: i18n curve.*.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import * as T from '@pulseframe/time';
import { CURVES, CURVES_BUILT, channelKey, curveOps, describeCatalog, findClip, isV1Easing, keyTimes, keysOf, isLightChannel2, rangeOf, type ChannelRef, type Clip, type CurveHandles, type Easing } from '@pulseframe/core';
import type { Key } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { KF_TESTIDS } from './keyframes.testids.ts';
import { channelName } from './KeyStrip.tsx';
import { dragHandle, fieldDraft, handlesDiffer, nudgeHandle, pointFromHandle, polyline, previewPoints, setHandleField, tilePoints, turnsBackLocal, TILE_RANGE } from './curvePicker.math.ts';
import './keyframes.css';

const BOX = 128;
const DEFAULT_CUSTOM: CurveHandles = [0.25, 0.1, 0.25, 1];
const CATALOG = describeCatalog();
/** Whether an effect parameter is a whole number (the renderer rounds it, so its curve is drawn in steps). */
const isIntegerParam = (clip: Clip, ch: ChannelRef): boolean => {
  if ('property' in ch || clip.type === 'caption') return false;
  const fx = (clip.effects ?? []).find((e) => e.id === ch.effectId);
  const props = (CATALOG.effects.find((e) => e.id === fx?.type)?.paramsSchema as { properties?: Record<string, { type?: string }> } | undefined)?.properties;
  return props?.[ch.param]?.type === 'integer';
};
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

/** The picker host: reads editor state `curvePicker` and shows the dialog while it is set. */
export function CurvePicker(): ReactElement | null {
  const { state } = useEditorState();
  return state.curvePicker ? <PickerDialog key={`${state.curvePicker.clipId}:${state.curvePicker.frame}`} /> : null;
}

function PickerDialog(): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const cp = state.curvePicker!;
  const found = editor.doc ? findClip(editor.doc, cp.clipId) : undefined;
  const rate = editor.rate;
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(typeof document === 'undefined' ? null : document.activeElement);
  const [scope, setScope] = useState<'all' | 'one'>(cp.channels.length === 1 ? 'one' : 'all');
  const [hover, setHover] = useState<{ easing: Easing; bezier?: CurveHandles } | null>(null);
  const reasonId = useId();
  const close = () => editor.closeCurvePicker();
  // focus into the dialog, back to where it came from on close
  useEffect(() => {
    root.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const back = opener.current;
    return () => { if (back instanceof HTMLElement && back.isConnected) back.focus(); };
  }, []);
  const clip = found?.clip, track = found?.track;
  const at = useMemo(() => (clip && track ? keyTimes(clip, track, rate).find((k) => k.frame === cp.frame) : undefined), [clip, track, rate, cp.frame]);
  const readOnly = !!state.viewVariantId || !!track?.locked;
  const [custom, setCustom] = useState<CurveHandles>(DEFAULT_CUSTOM);
  // the text of a custom field while it is typed in (curvePicker.math.ts fieldDraft); null shows the handle's value
  const [drafts, setDrafts] = useState<readonly (string | null)[]>([null, null, null, null]);
  const setDraft = (i: number, d: string | null) => setDrafts((x) => x.map((v, j) => (j === i ? d : v)));
  const customSeeded = useRef(false);
  // once the user edits the handles, the stored key never seeds them again: a commit of one field (on blur) arriving while the
  // next field is typed in would otherwise put the stored handles back over what is being typed (keyframes-proof P2)
  const editCustom = (h: CurveHandles) => { customSeeded.current = true; setCustom(h); };
  // a field commits on blur only when its handles differ from the last applied ones: tabbing through must not turn a key into a custom curve
  const applied = useRef<CurveHandles>(DEFAULT_CUSTOM);
  const all = at?.channels ?? [];
  const mine = cp.channels.filter((c) => all.some((a) => channelKey(a) === channelKey(c)));
  const targets: ChannelRef[] = scope === 'all' || mine.length === 0 ? all : [mine[0]!];
  const first = targets[0];
  const key = clip && first ? keysOf(clip, first).find((k) => T.frameIndexAt(k.time, rate) === cp.frame) : undefined;
  useEffect(() => {
    if (!customSeeded.current && key?.bezier) { customSeeded.current = true; applied.current = [...key.bezier] as unknown as CurveHandles; setCustom([...key.bezier] as unknown as CurveHandles); }
  }, [key]);
  if (!clip || !track || !at || !first) return <Shell root={root} t={t} onClose={close}><p className="curve-note" role="status">{t('keys.outside')}</p></Shell>;
  const light = targets.some((c) => isLightChannel2(clip, c));
  const range = rangeOf(clip, first);
  const integer = isIntegerParam(clip, first);
  const beat = !('property' in first) && clip.type !== 'caption' && !!(clip.effects ?? []).find((e) => e.id === first.effectId)?.modulate?.[first.param];
  const current: { easing: Easing; bezier?: CurveHandles } = hover ?? (key ? { easing: key.easing, ...(key.bezier ? { bezier: key.bezier } : {}) } : { easing: 'linear' });
  const blocked = (easing: Easing, bezier?: CurveHandles): string | null => {
    if (!isV1Easing(easing) && !CURVES_BUILT) return t('curve.notBuilt');
    if (light && turnsBackLocal(easing, bezier)) return t('curve.flashDisabled');
    return null;
  };
  const apply = (easing: Easing, bezier?: CurveHandles) => {
    if (readOnly || blocked(easing, bezier)) return;
    if (easing === 'bezier' && bezier) applied.current = [...bezier] as unknown as CurveHandles;
    const refs = targets.map((channel) => ({ channel, frame: cp.frame }));
    void editor.commit(() => {
      const live = editor.doc ? findClip(editor.doc, clip.id)?.clip : undefined;
      return live ? curveOps(live, rate, refs, 'after', easing, bezier) : null;
    }, 'Keyframe curve');
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
    e.preventDefault();
    items[next]!.focus();
  };
  const customBlock = blocked('bezier', custom);
  return (
    <Shell root={root} t={t} onClose={close} onKeyDown={onKeyDown}>
      <p className="curve-note" data-testid="curve-picker-channels">{targets.map((c) => channelName(clip, c, t, state.lang)).join(', ')}</p>
      {readOnly && <p className="curve-note" role="note">{t('keys.readOnlyFormat')}</p>}
      <div className="curve-row">
        <button type="button" className="ghost" data-testid={KF_TESTIDS.smooth} aria-disabled={readOnly || !CURVES_BUILT || undefined} title={CURVES_BUILT ? undefined : t('curve.notBuilt')} onClick={() => apply('smooth')}>{t('curve.smooth')}</button>
        <button type="button" className="ghost" data-testid={KF_TESTIDS.straight} aria-disabled={readOnly || undefined} onClick={() => apply('linear')}>{t('curve.straight')}</button>
        {all.length > 1 && (
          <fieldset role="radiogroup" aria-label={t('curve.scope')} data-testid={KF_TESTIDS.scope}>
            {(['all', 'one'] as const).map((v) => (
              <label key={v}><input type="radio" name="curve-scope" value={v} data-scope={v} checked={scope === v} onChange={() => setScope(v)} /> {t(`curve.scope.${v}` as Key)}</label>
            ))}
          </fieldset>
        )}
      </div>
      <div className="curve-tiles" role="group" aria-label={t('curve.picker')}>
        {CURVES.map((c) => {
          const why = blocked(c.id);
          const drawn = isV1Easing(c.id) || CURVES_BUILT;
          const name = t(`curve.name.${c.id}` as Key);
          return (
            <button key={c.id} type="button" className="curve-tile" data-testid={KF_TESTIDS.tile(c.id)} aria-pressed={key?.easing === c.id} aria-disabled={why || readOnly ? true : undefined} aria-describedby={why ? reasonId : undefined} title={why ?? undefined}
              onClick={() => apply(c.id)} onPointerEnter={() => drawn && setHover({ easing: c.id })} onPointerLeave={() => setHover(null)} onFocus={() => drawn && setHover({ easing: c.id })} onBlur={() => setHover(null)}>
              <svg width={64} height={40} viewBox="0 0 64 40" aria-hidden="true" focusable="false">
                {drawn && <polyline className="curve-line" points={polyline(tilePoints(c.id), 64, 40, TILE_RANGE.min, TILE_RANGE.max)} />}
              </svg>
              <span>{name}{c.turnsBack ? ` · ${t('curve.turnsBack')}` : ''}</span>
            </button>
          );
        })}
      </div>
      {(light || !CURVES_BUILT) && <p className="curve-note" id={reasonId}>{!CURVES_BUILT ? t('curve.notBuilt') : t('curve.flashDisabled')}</p>}
      <div className="curve-custom" data-testid={KF_TESTIDS.custom}>
        <CustomEditor handles={custom} setHandles={editCustom} disabled={readOnly || !CURVES_BUILT} onCommit={(h) => apply('bezier', h)} label={t('curve.custom')} t={t} />
        <div className="curve-fields">
          {([0, 1, 2, 3] as const).map((i) => (
            <label key={i}>
              <span>{i % 2 === 0 ? t('curve.handle.time') : t('curve.handle.value')} {i < 2 ? 1 : 2}</span>
              <input type="number" dir="ltr" step={0.01} min={i % 2 === 0 ? 0 : -1} max={i % 2 === 0 ? 1 : 2} value={drafts[i] ?? custom[i]} disabled={readOnly || !CURVES_BUILT} data-testid={KF_TESTIDS.customInput(i)}
                onChange={(e) => { setDraft(i, fieldDraft(e.target.value, e.target.validity.badInput)); editCustom(setHandleField(custom, i, e.target.value)); }}
                onBlur={() => { setDraft(i, null); if (handlesDiffer(custom, applied.current)) apply('bezier', custom); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply('bezier', custom); } }} />
            </label>
          ))}
          {customBlock && CURVES_BUILT && <p className="curve-note" role="note">{customBlock}</p>}
        </div>
      </div>
      <figure className="curve-preview" data-testid={KF_TESTIDS.preview} aria-label={`${t('curve.name.' + current.easing as Key)}`}>
        <svg width={BOX * 2} height={BOX} viewBox={`0 0 ${BOX * 2} ${BOX}`} aria-hidden="true" focusable="false">
          {(isV1Easing(current.easing) || CURVES_BUILT) && <polyline className="curve-line" points={polyline(previewPoints(current.easing, current.bezier, range, integer), BOX * 2, BOX, range.min, range.max)} />}
        </svg>
        <figcaption className="curve-note"><bdi>{range.min}</bdi> – <bdi>{range.max}</bdi>{integer ? ` · ${t('curve.stepped')}` : ''}</figcaption>
      </figure>
      {beat && <p className="curve-note" role="note">{t('curve.beatNote')}</p>}
    </Shell>
  );
}

function Shell({ root, t, onClose, onKeyDown, children }: { root: React.RefObject<HTMLDivElement | null>; t: (k: Key) => string; onClose: () => void; onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void; children: React.ReactNode }) {
  const title = useId();
  return createPortal(
    <div className="curve-picker-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={root} className="curve-picker" role="dialog" aria-modal="true" aria-labelledby={title} data-testid={KF_TESTIDS.picker} onKeyDown={onKeyDown}>
        <header><h2 id={title}>{t('curve.picker')}</h2><button type="button" className="ghost" onClick={onClose}>{t('close')}</button></header>
        {children}
      </div>
    </div>, document.body);
}

/** The 128 × 128 box with two focusable handles: x 0..1 across, y -1 (bottom) to 2 (top). Dragging draws a draft; release commits. */
function CustomEditor({ handles, setHandles, disabled, onCommit, label, t }: { handles: CurveHandles; setHandles: (h: CurveHandles) => void; disabled: boolean; onCommit: (h: CurveHandles) => void; label: string; t: (k: Key) => string }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ which: 0 | 1; id: number } | null>(null);
  const live = useRef(handles);
  live.current = handles;
  const p0 = pointFromHandle(0, 0, BOX), p1 = pointFromHandle(1, 1, BOX);
  const a = pointFromHandle(handles[0], handles[1], BOX), b = pointFromHandle(handles[2], handles[3], BOX);
  const down = (which: 0 | 1) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if (disabled) return;
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    drag.current = { which, id: e.pointerId };
  };
  const move = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = drag.current, box = svg.current?.getBoundingClientRect();
    if (!d || !box || e.pointerId !== d.id) return;
    setHandles(dragHandle(live.current, d.which, ((e.clientX - box.left) / box.width) * BOX, ((e.clientY - box.top) / box.height) * BOX, BOX));
  };
  const up = (e: ReactPointerEvent<SVGCircleElement>) => {
    if (!drag.current || e.pointerId !== drag.current.id) return;
    drag.current = null;
    onCommit(live.current);
  };
  const key = (which: 0 | 1) => (e: ReactKeyboardEvent<SVGCircleElement>) => {
    const s = e.shiftKey ? 0.1 : 0.01;
    const d: Record<string, [number, number]> = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] };
    const m = d[e.key];
    if (!m || disabled) return;
    e.preventDefault(); e.stopPropagation();
    const next = nudgeHandle(live.current, which, m[0], m[1]);
    setHandles(next);
    onCommit(next);
  };
  const handle = (which: 0 | 1, p: { x: number; y: number }, x: number, y: number) => (
    <circle key={which} className="curve-handle" data-testid={KF_TESTIDS.customHandle} data-handle={which + 1} cx={p.x} cy={p.y} r={7} tabIndex={disabled ? -1 : 0} role="slider" aria-disabled={disabled || undefined}
      aria-label={t(which === 0 ? 'curve.handle.first' : 'curve.handle.second')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={x} aria-valuetext={`${x}, ${y}`}
      onPointerDown={down(which)} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }} onKeyDown={key(which)} />
  );
  return (
    <svg ref={svg} width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} role="group" aria-label={label}>
      <rect x={0} y={0} width={BOX} height={BOX} fill="none" stroke="var(--pf-line-strong)" />
      <line className="curve-guide" x1={0} y1={p0.y} x2={BOX} y2={p0.y} /><line className="curve-guide" x1={0} y1={p1.y} x2={BOX} y2={p1.y} />
      <line className="curve-stem" x1={p0.x} y1={p0.y} x2={a.x} y2={a.y} /><line className="curve-stem" x1={p1.x} y1={p1.y} x2={b.x} y2={b.y} />
      {(isFinite(handles[0]) && (CURVES_BUILT)) && <polyline className="curve-line" points={polyline(tilePoints('bezier', handles), BOX, BOX, -1, 2)} />}
      {handle(0, a, handles[0], handles[1])}{handle(1, b, handles[2], handles[3])}
    </svg>
  );
}

export interface CurveChipProps { clipId: string; channel: ChannelRef }
/** The curve after the key at the playhead, as a small button beside the diamond; it opens the picker for this channel. Nothing without a key there. */
export function CurveChip({ clipId, channel }: CurveChipProps): ReactElement | null {
  const { editor, state, t } = useEditorState();
  const found = editor.doc ? findClip(editor.doc, clipId) : undefined;
  if (!found) return null;
  const rate = editor.rate;
  const frame = editor.frame - T.frameIndexAt(found.clip.start, rate);
  const k = keysOf(found.clip, channel).find((q) => T.frameIndexAt(q.time, rate) === frame);
  if (!k || !editor.playheadOnSelection) return null;
  const name = t(`curve.name.${k.easing}` as Key);
  return (
    <button type="button" className="curve-chip" data-testid={KF_TESTIDS.chip(channelKey(channel))} disabled={!!state.viewVariantId || found.track.locked}
      aria-label={`${t('curve.chip')}: ${name}`} title={`${t('curve.chip')}: ${name}`} onClick={() => editor.openCurvePicker(clipId, frame, [channel])}>{name}</button>
  );
}
