/**
 * The three cards of a picture or video clip's panel (wave 8D P6): «מיקום וגודל», the blend card and «תנועה וזום».
 * Each control is an existing registered op through the store: editor.setShownTransform (transform), set_clip_blend, the keyframe
 * commands (keyframe.add / remove / prev / next) and set_keyframe_curve through keyEdits.ts curveOps. The detailed fields that
 * were there before stay reachable under «מתקדם» in the same card (the same elements and test ids).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Maximize2, Minimize2, ChevronLeft, ChevronRight, Scan } from 'lucide-react';
import type { BlendMode, Clip, Easing } from '@pulseframe/core';
import { COMMANDS } from '../commands.ts';
import { Section } from '../Section.tsx';
import { IconKeyframeFull, IconKeyframeHollow } from '../icons.tsx';
import { useEditorState, type Editor, type ResolvedNow } from '../store.ts';
import { BLEND_WORDS, CLIP_CARD_STRINGS } from './clipCards.strings.ts';
import { BLEND_MAIN, atSize, blendMoreOpen, blendRest, chipAt, chipTime, easeMoreOpen, easeRest, easeIntoOps, easingInto, EASE_MAIN, fitSizes, keyChips, tileLine, TILE_H, TILE_W, zoomText } from './clipCards.logic.ts';
import './clipCards.css';

const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id); if (c && (!c.enabled || c.enabled(editor))) void c.run(editor); };

/** A foldable «מתקדם» area inside a card: a button with aria-expanded; the body stays mounted (hidden) so it keeps its state. */
function Advanced({ id, children }: { id: string; children: ReactNode }) {
  const { state } = useEditorState();
  const S = CLIP_CARD_STRINGS[state.lang];
  const [open, setOpen] = useState(false);
  const body = useId();
  return (
    <div className="cc-adv" data-open={open ? 'true' : 'false'}>
      <button type="button" className="cc-adv-toggle" aria-expanded={open} aria-controls={body} data-testid={`cc-adv-${id}`} title={open ? S.advancedClose : S.advancedOpen} onClick={() => setOpen(!open)}>
        <span className="cc-adv-chev" aria-hidden="true">{open ? '▾' : '▸'}</span> {S.advanced}
      </button>
      <div id={body} className="cc-adv-body" hidden={!open}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ position and size ------------------------------------------------------------------ */

/** «מיקום וגודל»: three fit buttons over the existing size / position / rotation / opacity sliders (passed in as `rows`). */
export function PlaceCard({ clip, shown, rows, scope }: { clip: Extract<Clip, { type: 'media' }>; shown: ResolvedNow; rows: ReactNode; scope: ReactNode }) {
  const { editor, state } = useEditorState();
  const S = CLIP_CARD_STRINGS[state.lang];
  const doc = editor.viewDoc ?? state.doc;
  const a = state.doc?.assets[clip.assetId];
  const sizes = doc ? fitSizes(doc.settings.width, doc.settings.height, a?.video?.width ?? a?.image?.width, a?.video?.height ?? a?.image?.height, doc.settings.fit ?? 'contain') : null;
  const on = editor.playheadOnSelection;
  const cur = shown.transform;
  const set = (scale: number) => void editor.setShownTransform(clip, shown, { scale, x: 0, y: 0 }, 'Frame fill');
  const distinct = sizes ? Math.abs(sizes.fill - sizes.fit) > 0.005 : false;
  return (
    <Section id="transform" title={S.placeTitle}>
      {scope}
      {sizes && (
        <div className="cc-fit" role="group" aria-label={S.fitGroup}>
          <button type="button" className="cc-btn" aria-pressed={atSize(cur, sizes.fill) && distinct} disabled={!on || !distinct} title={S.fitFillHint} data-testid="fill-fill" onClick={() => set(sizes.fill)}>
            <Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" /><span>{S.fitFill}</span></button>
          <button type="button" className="cc-btn" aria-pressed={atSize(cur, sizes.fit)} disabled={!on} title={S.fitFitHint} data-testid="fill-fit" onClick={() => set(sizes.fit)}>
            <Minimize2 size={16} strokeWidth={1.75} aria-hidden="true" /><span>{S.fitFit}</span></button>
          <button type="button" className="cc-btn" aria-pressed={atSize(cur, sizes.original)} disabled={!on || !sizes.originalInRange} title={sizes.originalInRange ? S.fitOriginalHint : S.fitOriginalOut} data-testid="fill-original" onClick={() => set(sizes.original)}>
            <Scan size={16} strokeWidth={1.75} aria-hidden="true" /><span>{S.fitOriginal}</span></button>
        </div>
      )}
      <div className="cc-rows">{rows}</div>
    </Section>
  );
}

/* ------------------------------------------------------------------ blend ------------------------------------------------------------------ */

/** The blend card: pills (most used first, the rest under «עוד»), one sentence for the chosen mode, the full list under «מתקדם». */
export function BlendCard({ clip, field }: { clip: Clip; field: ReactNode }) {
  const { editor, state } = useEditorState();
  const lang = state.lang;
  const S = CLIP_CARD_STRINGS[lang], W = BLEND_WORDS[lang];
  const mode: BlendMode = clip.type === 'caption' ? 'normal' : clip.blend ?? 'normal';
  const [more, setMore] = useState(false);
  const showMore = blendMoreOpen(mode, more);
  const moreId = useId(), sayId = useId();
  const locked = !!editor.selectionLocked;
  const choose = (m: BlendMode) => { if (m !== mode) void editor.commit([{ op: 'set_clip_blend', args: { clipId: clip.id, mode: m } }], 'Blend mode'); };
  const pill = (m: BlendMode) => (
    <button key={m} type="button" className="cc-pill" aria-pressed={m === mode} aria-describedby={sayId} disabled={locked} data-testid={`blend-pill-${m}`} onClick={() => choose(m)}>{W[m].name}</button>
  );
  return (
    <Section id="blend" title={S.blendTitle} defaultOpen={false} summary={W[mode].name} /* closed at first (its summary names the mode) so the three cards' titles fit the panel; a choice to keep it open is remembered */>
      <div className="cc-pills" role="group" aria-label={S.blendGroup}>
        {BLEND_MAIN.map(pill)}
        <button type="button" className="cc-pill cc-pill-more" aria-expanded={showMore} aria-controls={moreId} disabled={showMore && !more} data-testid="blend-more" onClick={() => setMore(!more)}>{showMore ? S.blendLess : S.blendMore}</button>
      </div>
      <div id={moreId} className="cc-pills" role="group" aria-label={S.blendAll} hidden={!showMore}>{blendRest().map(pill)}</div>
      <p id={sayId} className="cc-says" aria-live="polite" data-testid="blend-says">{W[mode].says}</p>
      <Advanced id="blend">{field}</Advanced>
    </Section>
  );
}

/* ------------------------------------------------------------------ motion and zoom ------------------------------------------------------------------ */

/** The easing tile: the real curve drawn from the engine's sampler, its word beneath, an accessible name that says what it does. */
function EaseTile({ id, current, disabled, onPick }: { id: Easing; current: Easing | 'mixed' | null; disabled: boolean; onPick: (e: Easing) => void }) {
  const { state } = useEditorState();
  const S = CLIP_CARD_STRINGS[state.lang];
  const word = S.curves[id] ?? id;
  return (
    <button type="button" className="cc-tile" aria-pressed={current === id} disabled={disabled} aria-label={`${S.easeGroup}: ${word}`} title={S.curveSays[id]} data-testid={`ease-tile-${id}`} onClick={() => onPick(id)}>
      <svg viewBox={`0 0 ${TILE_W} ${TILE_H}`} width={TILE_W} height={TILE_H} aria-hidden="true" focusable="false">
        <polyline points={tileLine(id)} className="cc-tile-line" data-curve={id} />
      </svg>
      <span className="cc-tile-word">{word}</span>
    </button>
  );
}

/** «תנועה וזום»: the keyframe pill and arrows, one chip per keyframe, the easing into the chosen keyframe, the zoom slider. */
export function MotionCard({ clip, shown, advanced }: { clip: Clip; shown: ResolvedNow; advanced: ReactNode }) {
  const { editor, state } = useEditorState();
  const S = CLIP_CARD_STRINGS[state.lang];
  const sel = editor.selected;
  const rate = editor.rate;
  const chips = sel && clip.type !== 'caption' ? keyChips(clip, sel.track, rate) : [];
  const here = chipAt(chips, editor.frame);
  const on = editor.playheadOnSelection;
  const blocked = !!state.viewVariantId || !!editor.selectionLocked;
  const easing = here ? easingInto(clip, here.frame, rate) : null;
  const [more, setMore] = useState(false);
  const moreId = useId();
  const showMore = easeMoreOpen(easing, more);
  const pick = (e: Easing) => { if (here && !blocked) void editor.commit(() => { const ops = easeIntoOps(clip, here.frame, rate, e); return ops.length ? ops : null; }, 'Keyframe curve'); };
  const note = blocked ? S.keyLocked : !on ? S.keyOutside : !chips.length ? S.keyNone : null;
  const easeNote = !here ? S.easeNoKey : easing === null ? S.easeFirst : easing === 'mixed' ? S.easeMixed : null;
  const easeDisabled = blocked || !here || easing === null;
  const ids: Easing[] = [...EASE_MAIN];
  return (
    <Section id="keys" title={S.motionTitle} summary={chips.length ? String(chips.length) : undefined}>
      <div className="cc-keyrow">
        <button type="button" className="cc-btn cc-btn-prev" disabled={!chips.length} aria-label={S.keyPrev} title={S.keyPrev} data-testid="cc-key-prev" onClick={() => run(editor, 'keyframe.prev')}>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="cc-flip" /></button>
        <button type="button" className="cc-pill cc-keypill" aria-pressed={!!here} disabled={!on || blocked} aria-label={here ? S.keyRemove : S.keyAdd} title={here ? S.keyHasHere : S.keyAdd} data-testid="cc-key-toggle" onClick={() => run(editor, here ? 'keyframe.remove' : 'keyframe.add')}>
          {here ? <IconKeyframeFull size={14} /> : <IconKeyframeHollow size={14} />}<span>{here ? S.keyHasHere : S.keyHere}</span></button>
        <button type="button" className="cc-btn cc-btn-next" disabled={!chips.length} aria-label={S.keyNext} title={S.keyNext} data-testid="cc-key-next" onClick={() => run(editor, 'keyframe.next')}>
          <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" className="cc-flip" /></button>
      </div>
      {note && <p className="cc-note muted" role="note">{note}</p>}
      {chips.length > 0 && (
        <div className="cc-chips" role="group" aria-label={S.keyChips}>
          {chips.map((c) => (
            <button key={c.frame} type="button" className="cc-chip" aria-pressed={here?.frame === c.frame} aria-label={S.keyChip(zoomText(c.zoom), chipTime(c.seconds))} data-testid="cc-key-chip" data-frame={c.frame} onClick={() => editor.seek(c.absFrame)}>
              <bdi className="num">{zoomText(c.zoom)}</bdi> <bdi className="num cc-chip-time">{chipTime(c.seconds)}</bdi></button>
          ))}
        </div>
      )}
      {chips.length > 0 && (
        <>
          <div className="cc-sub" id={`${moreId}-h`}>{S.easeGroup}</div>
          <div className="cc-tiles" role="group" aria-labelledby={`${moreId}-h`}>
            {ids.map((id) => <EaseTile key={id} id={id} current={easing} disabled={easeDisabled} onPick={pick} />)}
          </div>
          <div className="cc-morerow"><button type="button" className="cc-pill cc-pill-more" aria-expanded={showMore} aria-controls={moreId} disabled={showMore && !more} data-testid="ease-more" onClick={() => setMore(!more)}>{showMore ? S.easeLess : S.easeMore}</button></div>
          <div id={moreId} className="cc-tiles" role="group" aria-label={S.easeMore} hidden={!showMore}>
            {easeRest().map((id) => <EaseTile key={id} id={id} current={easing} disabled={easeDisabled} onPick={pick} />)}
          </div>
          {easing && easing !== 'mixed' ? <p className="cc-says" aria-live="polite">{S.curveSays[easing]}</p> : easeNote && <p className="cc-note muted" role="note">{easeNote}</p>}
          <ZoomSlider clip={clip} shown={shown} enabled={!!here && !blocked} />
        </>
      )}
      <Advanced id="keys">{advanced}</Advanced>
    </Section>
  );
}

/** The zoom strength of the chosen keyframe: the transform's scale at the playhead (editor.setShownTransform writes the key there). */
function ZoomSlider({ clip, shown, enabled }: { clip: Clip; shown: ResolvedNow; enabled: boolean }) {
  const { editor, state } = useEditorState();
  const S = CLIP_CARD_STRINGS[state.lang];
  const now = shown.transform.scale;
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => { setDraft(null); }, [now]);
  const v = draft ?? now;
  const commit = (x: number) => { setDraft(x); const p = enabled && Math.abs(x - now) > 1e-6 ? editor.setShownTransform(clip, shown, { scale: Math.round(x * 1e4) / 1e4 }, 'Zoom') : undefined; if (p) void p.then((r) => { if (!r) setDraft(null); }, () => setDraft(null)); else setDraft(null); };
  const id = useId();
  return (
    <div className="cc-zoom">
      <label htmlFor={id} className="cc-zoom-label">{S.zoom} <bdi className="num cc-zoom-val" data-testid="cc-zoom-value">{zoomText(v)}</bdi></label>
      <input id={id} type="range" min={0.1} max={4} step={0.05} value={v} disabled={!enabled} aria-label={S.zoomOn} aria-valuetext={zoomText(v)} title={enabled ? undefined : S.zoomNeedKey} data-testid="cc-zoom"
        onChange={(e) => setDraft(Number(e.currentTarget.value))} onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) commit(Number(e.currentTarget.value)); }} />
    </div>
  );
}

