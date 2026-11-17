/**
 * The inspector of what is selected (UX_REDESIGN §4.6): a header that says what it is, a tab set per kind of object (one
 * category per screen), and in each tab a few sections: the ones people use open, the rest closed behind a summary of
 * their values, explanations behind "?". Every control commits a registered operation through the store, as before; the
 * controls that proofs drive keep their test ids on the same native elements.
 */
import { useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Activity, Blend as BlendIcon, Captions, ChevronRight, Contrast, Droplet, Ellipsis, Film, Gauge, Layers, Maximize2, Minimize2, Move, Music,
  Scissors, SlidersHorizontal, Sparkles, Spline, SquareDashed, Timer, Trash2, Type, Volume2, type LucideProps,
} from 'lucide-react';
import * as T from '@pulseframe/time';
import type { Asset, Clip, OpCall, ProjectDocument } from '@pulseframe/core';
import { beatPositionAt, clipEnd, findClip, findEffect, fitScale, FONT_CATALOG, speedValue, TEXT_PRESETS, transitionDef } from '@pulseframe/core';
import { effectParamLabel, type Key } from '@pulseframe/i18n';
import { chordLabel, COMMANDS, coverEditOps, keyframeProps, type Keymap } from './commands.ts';
import { ADJUST_STRINGS } from './adjust.strings.ts';
import { DerivativeLoader, thumbTileAt, type LoadedDerivative } from './mediaThumb.ts';
import { TEMPLATE_TESTIDS as TID } from './templates.testids.ts';
import { repeatClick, singleFlight } from './oneAtATime.ts';
import { useEditorState, type Editor, type ResolvedNow } from './store.ts';
import { AnalysisPanel } from './AnalysisPanel.tsx';
import { TrackingPanel } from './TrackingPanel.tsx';
import { FollowControls } from './FollowControls.tsx';
import { RedactControls } from './RedactControls.tsx';
import { trackingT } from './tracking.strings.ts';
import { BlendField, EffectsBlock, LOOK_CATALOG_COUNTS, LooksField, LookTarget, LookTargetLine, MaskControls, musicUnder, useLook, type LookState } from './LookPanel.tsx';
import { ColourMatchPanel } from './ColourMatchPanel.tsx';
import { ClipSound, DuckSwitch } from './SoundPanel.tsx';
import { AudioFxBlock, LinkedSoundFx } from './AudioFxBlock.tsx';
import { SpeedCurveField } from './SpeedCurves.tsx';
import { LayoutPicker } from './LayoutPicker.tsx';
import { TextAnimationField } from './TextAnimationField.tsx';
import { TextEffectsField } from './TextEffectsField.tsx';
import { Section, SectionsContext } from './Section.tsx';
import { IconKeyframeFull, IconKeyframeHalf, IconKeyframeHollow, IconOnBeat } from './icons.tsx';
import { Menu, ScrubField, Tabs, type MenuItem, type TabSpec } from '../ds/index.ts';
import { isolate } from '../ds/util.tsx';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { cutBefore, keyframeSummary, objectActions, secondsText, shortTimecode, tabsFor, type InspectorPage, type ObjectAction, type ObjectKind, type ObjectTab } from './inspector.model.ts';
import { openInspectorTab, selectCut } from './inspector.bus.ts';
import { CutPanel, TransitionPanel } from './InspectorCut.tsx';
import { ProjectPanel } from './InspectorProject.tsx';

type Media = Extract<Clip, { type: 'media' }>;
const run = (editor: Editor, id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(editor)) void c.run(editor); };
const hint = (keymap: Keymap, id: string) => { const k = keymap.keysFor(id)[0]; return k ? <kbd>{chordLabel(k)}</kbd> : null; };
const ico = (Icon: (p: LucideProps) => ReactNode, size = 18) => <Icon size={size} strokeWidth={1.75} aria-hidden="true" className="pf-ico" />;

const TAB_ICON: Record<ObjectTab, (p: LucideProps) => ReactNode> = {
  project: Film, shared: Layers, basic: SlidersHorizontal, motion: Spline, speed: Gauge, colour: Contrast, effects: Sparkles, mask: SquareDashed, audio: Volume2,
  text: Type, style: Droplet, anim: Spline, place: Move, cue: Captions, timing: Timer, soundfx: Sparkles, beat: Activity, range: SlidersHorizontal, cut: Scissors, transition: BlendIcon,
};
const TAB_LABEL: Record<ObjectTab, keyof typeof INSPECTOR_STRINGS.en> = {
  project: 'tabProject', shared: 'tabShared', basic: 'tabBasic', motion: 'tabMotion', speed: 'tabSpeed', colour: 'tabColour', effects: 'tabEffects', mask: 'tabMask', audio: 'tabAudio',
  text: 'tabText', style: 'tabStyle', anim: 'tabAnim', place: 'tabPlace', cue: 'tabCue', timing: 'tabTiming', soundfx: 'tabSoundFx', beat: 'tabBeat', range: 'tabRange', cut: 'tabCut', transition: 'tabTransition',
};

/* ------------------------------------------------------------------ header ------------------------------------------------------------------ */

/** What is selected, in one line: a kind tile, its name, and "video · 4.0 s · main track". The ⋯ menu holds the object's actions. */
export function ObjectHeader({ kind, keymap }: { kind: ObjectKind; keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = state.doc;
  const sel = editor.selected;
  const fps = editor.rate.num / editor.rate.den;
  if (!doc) return null;
  let name: string = doc.name, meta: ReactNode = null, tile: ReactNode = ico(Film, 20), tone = 'project';
  const sec = (d: T.RationalTime) => <bdi className="num">{secondsText(T.toSeconds(d))} {S.seconds}</bdi>;
  if (kind === 'none') {
    meta = <><bdi className="num">{doc.settings.width}×{doc.settings.height}</bdi> · {sec(editor.duration)}</>;
  } else if (kind === 'multi') {
    name = S.multi(state.selection.length); tile = ico(Layers, 20); tone = 'multi'; meta = S.sharedNote;
  } else if (sel) {
    const c = sel.clip;
    const trackName = sel.track.kind === 'video' && doc.sequences[doc.mainSequenceId]?.tracks.filter((x) => x.kind === 'video')[0]?.id === sel.track.id ? S.trackMain : `${S.track} ${sel.track.name}`;
    if (kind === 'cut') {
      const cut = cutBefore(doc, c.id)!;
      const names = [doc.assets[cut.prev.assetId]?.name ?? '', doc.assets[cut.next.assetId]?.name ?? ''].map((n) => n.replace(/\.[a-z0-9]{2,5}$/i, ''));
      name = S.cutTitle(shortTimecode(cut.frame, fps)); tile = ico(Scissors, 20); tone = 'cut';
      // the earlier clip first in reading order, the arrow pointing the way the edit runs (← in Hebrew, → in English)
      meta = <span dir={state.lang === 'he' ? 'rtl' : 'ltr'}><bdi dir="ltr">{names[0]}</bdi> {S.cutArrow} <bdi dir="ltr">{names[1]}</bdi></span>;
    } else if (c.type === 'text') { name = c.text.split('\n')[0] || S.kindText; tile = <span className="oh-abc" aria-hidden="true">אבג</span>; tone = 'text'; meta = <><span className="oh-part">{S.kindText} · {sec(c.duration)}</span> · <span className="oh-part">{trackName}</span></>; }
    else if (c.type === 'caption') { name = c.text || S.kindCaption; tile = ico(Captions, 20); tone = 'caption'; meta = <>{S.kindCaption} · {sec(c.duration)}</>; }
    else if (c.type === 'adjustment') { name = c.label || S.kindAdjust; tile = ico(Layers, 20); tone = 'adjust'; meta = <>{S.kindAdjust} · {sec(c.duration)}</>; }
    else {
      const a = doc.assets[c.assetId];
      name = (a?.name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '') || S.missing;
      if (sel.track.kind === 'audio') { tile = ico(Music, 20); tone = 'music'; meta = <><span className="oh-part">{S.kindSound} · {sec(c.duration)}</span> · <span className="oh-part">{trackName}</span></>; }
      else if (a?.kind === 'image') {
        tile = <img src={`/api/v1/projects/${encodeURIComponent(doc.id)}/assets/${encodeURIComponent(a.id)}/content`} alt="" loading="lazy" draggable={false} />; tone = 'video';
        meta = <><span className="oh-part">{S.kindImage} · {sec(c.duration)}</span> · <span className="oh-part">{trackName}</span></>;
      } else { tile = a?.video ? <ClipThumb projectId={doc.id} asset={a} frac={sourceFrac(c, a)} refreshKey={state.derivativeTick} /> : ico(Film, 20); tone = 'video'; meta = <><span className="oh-part">{S.kindVideo} · {sec(c.duration)}</span> · <span className="oh-part">{trackName}</span></>; }
      if (!a) tone = 'missing';
    }
  }
  const ITEM: Record<ObjectAction, MenuItem> = {
    duplicate: { id: 'edit.duplicate', label: t('cmd.duplicate'), keys: ['Ctrl', 'D'] },
    split: { id: 'edit.split', label: t('split'), keys: ['S'], disabled: !editor.playheadInsideSelection },
    delete: { id: 'edit.delete', label: t('delete'), keys: ['Del'], danger: true },
  };
  const items: MenuItem[] = sel || kind === 'multi' ? objectActions(kind).map((a) => ITEM[a]) : [];
  void keymap;
  return (
    <div className={`oh is-${tone}`} data-testid="insp-header" data-kind={kind}>
      <span className="oh-tile">{tile}</span>
      <div className="oh-text">
        <strong className="oh-name" dir="auto" title={name}>{name}</strong>
        <span className="oh-meta">{meta}</span>
      </div>
      {items.length > 0 && (
        <Menu label={S.more} items={items} onSelect={(id) => run(editor, id)}
          trigger={(p) => <button type="button" className="oh-more" aria-label={S.more} title={S.more} data-testid="insp-more" {...p}><Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" /></button>} />
      )}
    </div>
  );
}

/** Where the middle of the clip lies in its file, 0..1: the frame the header's picture shows. */
function sourceFrac(c: Media, a: Asset): number {
  const total = T.toSeconds(a.duration);
  if (!(total > 0)) return 0;
  const mid = T.toSeconds(c.sourceIn) + (T.toSeconds(c.duration) * speedValue(c)) / 2;
  return Math.max(0, Math.min(0.999, mid / total));
}
/**
 * The header's picture of a video clip: a tile of the file's filmstrip (the ingest derivative the library cards use), at the
 * middle of the clip. Until the filmstrip is there (or for a file that has none) the film icon stays.
 */
function ClipThumb({ projectId, asset, frac, refreshKey }: { projectId: string; asset: Asset; frac: number; refreshKey: number }) {
  const [loaded, setLoaded] = useState<LoadedDerivative<ImageBitmap> | null>(null);
  const loader = useRef<DerivativeLoader<ImageBitmap> | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const l = new DerivativeLoader<ImageBitmap>({ fetch: (url, signal) => fetch(url, { credentials: 'same-origin', signal }), decode: (b) => createImageBitmap(b), onChange: (v) => setLoaded(v) });
    loader.current = l;
    return () => { loader.current = null; l.dispose(); };
  }, []);
  useEffect(() => { loader.current?.show({ projectId, assetId: asset.id, contentHash: asset.contentHash, kind: 'thumbnails' }); }, [projectId, asset.id, asset.contentHash]);
  useEffect(() => { loader.current?.poke(); }, [refreshKey]);
  useEffect(() => {
    const c = canvas.current, cur = loader.current?.current;
    if (!c || !cur || cur.kind !== 'thumbnails') return;
    const tile = thumbTileAt(cur.meta, frac);
    c.width = tile.width; c.height = tile.height;
    c.getContext('2d')?.drawImage(cur.bitmap, tile.sx, tile.sy, tile.width, tile.height, 0, 0, tile.width, tile.height);
  }, [loaded, frac]);
  if (!loaded || loaded.kind !== 'thumbnails') return ico(Film, 20);
  return <canvas ref={canvas} className="oh-thumb" aria-hidden="true" data-testid="insp-header-thumb" />;
}

/* ------------------------------------------------------------------ rows ------------------------------------------------------------------ */

/** The label | control | value | keyframe row of the inspector (the grid of ds PropertyRow), around a native control. */
function Row({ label, modified, value, kf, children, className }: { label: string; modified?: boolean; value?: ReactNode; kf?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`pf-prop${className ? ` ${className}` : ''}`}>
      <span className="pf-prop-label"><span className="pf-prop-name">{label}</span>{modified && <i className="pf-prop-dot" aria-hidden="true" />}</span>
      <span className="pf-prop-control">{children}</span>
      <span className="pf-prop-value">{value}</span>
      <span className="pf-prop-kf">{kf}</span>
    </div>
  );
}

interface TField { prop: 'x' | 'y' | 'scale' | 'rotation' | 'opacity'; label: 'posX' | 'posY' | 'size' | 'rotation' | 'opacity'; min: number; max: number; step: number; spatial: boolean; unit: string; show: number; neutral: number; decimals: number }
const TRANSFORM_FIELDS: TField[] = [
  { prop: 'scale', label: 'size', min: 0.1, max: 4, step: 0.05, spatial: false, unit: '%', show: 100, neutral: 1, decimals: 0 },
  { prop: 'x', label: 'posX', min: -0.6, max: 0.6, step: 0.01, spatial: true, unit: '%', show: 100, neutral: 0, decimals: 0 },
  { prop: 'y', label: 'posY', min: -0.6, max: 0.6, step: 0.01, spatial: true, unit: '%', show: 100, neutral: 0, decimals: 0 },
  { prop: 'rotation', label: 'rotation', min: -180, max: 180, step: 1, spatial: true, unit: '°', show: 1, neutral: 0, decimals: 0 },
  { prop: 'opacity', label: 'opacity', min: 0, max: 1, step: 0.05, spatial: false, unit: '%', show: 100, neutral: 1, decimals: 0 },
];

/**
 * The value a control shows while a gesture is under way (a drag, arrow keys, typing), and the committed value otherwise.
 * The row keeps its elements across commits (it is never keyed by its value), so the control that has the keyboard focus
 * keeps it after each committed step. The draft is dropped when the committed value changes, or when the edit is refused.
 */
function useDraft(committed: number): [number, (v: number | null) => void] {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => { setDraft(null); }, [committed]);
  return [draft ?? committed, setDraft];
}
/** Commits a value and drops the draft when the edit did not go through (otherwise the new committed value replaces it). */
const settle = (p: Promise<unknown> | false | undefined | void, drop: (v: null) => void) => { if (p) void p.then((r) => { if (!r) drop(null); }, () => drop(null)); else drop(null); };

/**
 * Size, position, rotation and opacity as shown at the playhead. The slider (the element proofs drive) and the number beside
 * it edit the same value; an animated property gets a keyframe at the playhead, a still one is set directly
 * (editor.setShownTransform). The diamond adds or removes that property's keyframe here.
 */
function TransformRows({ clip, viewClip, shown, only }: { clip: Clip; viewClip: Clip; shown: ResolvedNow; only?: readonly TField['prop'][] }) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const on = editor.playheadOnSelection;
  const beat = editor.doc ? onBeatFrame(editor) : false;
  const props = keyframeProps(clip) as readonly string[];
  return (
    <>
      {TRANSFORM_FIELDS.filter((f) => props.includes(f.prop) && (!only || only.includes(f.prop))).map((fld) => (
        <TransformRow key={fld.prop} fld={fld} clip={clip} viewClip={viewClip} shown={shown} on={on} beat={beat} />
      ))}
      {!on && <p className="muted insp-note" role="note">{S.outsideClip}</p>}
    </>
  );
}
function TransformRow({ fld, clip, viewClip, shown, on, beat }: { fld: TField; clip: Clip; viewClip: Clip; shown: ResolvedNow; on: boolean; beat: boolean }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const A = ADJUST_STRINGS[state.lang];
  const variantId = state.viewVariantId;
  const now = shown.transform[fld.prop];
  const [live, setDraft] = useDraft(now);
  const local = () => T.sub(editor.playhead, clip.start);
  const keys = viewClip.type === 'caption' ? [] : viewClip.keyframes?.[fld.prop] ?? [];
  const animated = keys.length > 0;
  const here = on && keys.some((k) => T.eq(k.time, local()));
  const commit = (v: number) => { setDraft(v); settle(on && v !== now && editor.setShownTransform(clip, shown, { [fld.prop]: v }), setDraft); };
  const label = clip.type === 'adjustment' ? A.opacity : S[fld.label];
  const toggleKey = () => {
    if (!on || variantId) return;
    const at = local();
    void editor.commit(() => {
      const cur = editor.doc ? findClip(editor.doc, clip.id)?.clip : undefined;
      if (!cur || cur.type === 'caption') return null;
      const has = cur.keyframes?.[fld.prop]?.some((k) => T.eq(k.time, at));
      return has ? [{ op: 'delete_keyframe', args: { clipId: clip.id, property: fld.prop, time: at } }] : [{ op: 'set_keyframe', args: { clipId: clip.id, property: fld.prop, time: at, value: Math.round(now * 1e4) / 1e4 } }];
    }, 'Keyframe');
  };
  const Kf = here ? IconKeyframeFull : animated ? IconKeyframeHalf : IconKeyframeHollow;
  const text = `${+(live * fld.show).toFixed(fld.decimals)}${fld.unit}`;
  return (
    <Row label={label} modified={Math.abs(now - fld.neutral) > 1e-6}
      value={<ScrubField label={label} value={+(live * fld.show).toFixed(fld.decimals)} min={fld.min * fld.show} max={fld.max * fld.show} step={fld.show === 100 ? 1 : fld.step} unit={fld.unit} defaultValue={fld.neutral * fld.show} disabled={!on}
        onChange={(v) => setDraft(v / fld.show)} onCommit={(v) => commit(v / fld.show)} />}
      kf={<button type="button" className={`pf-kf${here ? (beat ? ' is-on-beat' : ' is-at-playhead') : animated ? ' is-animated' : ''}`} disabled={!on || !!variantId} aria-pressed={here}
        aria-label={`${S.kfToggle}: ${label}`} title={variantId ? t('transform.keyframesMasterOnly') : here ? S.kfHere : animated ? S.kfAnimated : S.kfToggle} data-testid={`kf-${fld.prop}`} onClick={toggleKey}>
        {here && beat ? <IconOnBeat size={16} /> : <Kf size={16} />}</button>}>
      <span className="sr-only val">{+now.toFixed(3)}{animated ? ` ${t('keyframes.animated')}` : ''}</span>
      <input type="range" dir={fld.spatial ? 'ltr' : undefined} className={fld.spatial ? 'is-bipolar' : undefined} min={fld.min} max={fld.max} step={fld.step} value={live} disabled={!on} aria-label={label}
        data-testid={clip.type === 'adjustment' ? TID.adjustOpacity : `transform-${fld.prop}`} aria-valuetext={text}
        onChange={(e) => setDraft(Number(e.currentTarget.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))} onKeyUp={(e) => { if (RANGE_KEYS.has(e.key)) commit(Number(e.currentTarget.value)); }} />
    </Row>
  );
}
/** The keys that move a range input: a commit follows their release, not the release of Tab or a modifier. */
const RANGE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);
/** Whether the playhead stands on an analysed beat of the music under it (the gold keyframe). */
function onBeatFrame(editor: Editor): boolean {
  const doc = editor.doc; if (!doc) return false;
  const fps = editor.rate.num / editor.rate.den, now = editor.frame / fps;
  const pos = beatAt(doc, editor);
  return !!pos && pos.some((b) => Math.abs(b - now) < 0.5 / fps);
}
const beatAt = (doc: ProjectDocument, editor: Editor): number[] | null => { const p = beatPositionAt(doc, editor.playhead); return p ? p.hits.map((h) => h.t) : null; };

/** The transform scope while a format is viewed, and the reset of that format's own values. */
function FormatScope({ clip }: { clip: Clip }) {
  const { editor, state, t } = useEditorState();
  const variantId = state.viewVariantId;
  if (!variantId) return <span hidden data-testid="transform-scope" data-scope="master" />;
  const hasOverride = !!editor.doc?.variants?.[variantId]?.overrides[clip.id]?.transform;
  return (
    <div className="transform-scope" data-testid="transform-scope" data-scope="format">
      <span className="muted">{t('transform.scopeFormat')}</span>
      <button className="ghost" disabled={!hasOverride} data-testid="transform-reset-format"
        onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, transform: null } }], 'Reset format transform')}>{t('transform.resetFormat')}</button>
    </div>
  );
}

/** Add, remove and clear keyframes of the whole clip (all its animated properties at once), as the K shortcut does. */
function KeyframeButtons({ clip, keymap }: { clip: Clip; keymap: Keymap }) {
  const { editor, state, t } = useEditorState();
  const variantId = state.viewVariantId;
  const on = editor.playheadOnSelection;
  const has = clip.type !== 'caption' && !!clip.keyframes;
  const title = variantId ? t('transform.keyframesMasterOnly') : undefined;
  return (
    <div className="row">
      <button className="ghost" disabled={!on || !!variantId} title={title} onClick={() => run(editor, 'keyframe.add')} data-testid="keyframe-add"><IconKeyframeFull size={14} /> {t('cmd.keyframeAdd')} {hint(keymap, 'keyframe.add')}</button>
      <button className="ghost" disabled={!on || !has || !!variantId} title={title} onClick={() => run(editor, 'keyframe.remove')}>{t('cmd.keyframeRemove')} {hint(keymap, 'keyframe.remove')}</button>
      <button className="ghost" disabled={!has || !!variantId} title={title} data-testid="keyframes-clear"
        onClick={() => void editor.commit([{ op: 'clear_keyframes', args: { clipId: clip.id, at: T.sub(T.max(clip.start, T.min(editor.playhead, T.sub(clipEnd(clip), T.frameTime(1, editor.rate)))), clip.start) } }], 'Clear keyframes')}>{t('keyframes.clear')}</button>
    </div>
  );
}

/** Where the clip sits in time, and the cuts at the playhead (the ride bar of the timeline offers the same). */
function TimeBlock({ clip, keymap }: { clip: Clip; keymap: Keymap }) {
  const { editor, t } = useEditorState();
  const inside = editor.playheadInsideSelection;
  return (
    <>
      <dl className="insp-dl">
        <dt>{t('clip.start')}</dt><dd><bdi className="num">{T.toSeconds(clip.start).toFixed(3)}s</bdi></dd>
        <dt>{t('clip.duration')}</dt><dd><bdi className="num">{T.toSeconds(clip.duration).toFixed(3)}s</bdi></dd>
      </dl>
      <div className="row">
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.split')} data-testid="split">{t('split')} {hint(keymap, 'edit.split')}</button>
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.trimStart')}>{t('trim.start')} {hint(keymap, 'edit.trimStart')}</button>
        <button className="ghost" disabled={!inside} onClick={() => run(editor, 'edit.trimEnd')}>{t('trim.end')} {hint(keymap, 'edit.trimEnd')}</button>
        <button className="ghost danger" onClick={() => run(editor, 'edit.delete')} data-testid="delete">{t('delete')} {hint(keymap, 'edit.delete')}</button>
      </div>
    </>
  );
}

/** Fit (the whole picture shows) and fill (the picture covers the frame): the size that does each, set like any size change. */
function FrameFill({ clip, shown }: { clip: Media; shown: ResolvedNow }) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = editor.viewDoc ?? state.doc;
  const a = state.doc?.assets[clip.assetId];
  const sw = a?.video?.width ?? a?.image?.width, sh = a?.video?.height ?? a?.image?.height;
  if (!doc || !sw || !sh) return null;
  const { width, height } = doc.settings;
  const base = fitScale(width, height, sw, sh, doc.settings.fit ?? 'contain');
  const fit = fitScale(width, height, sw, sh, 'contain') / base, fill = fitScale(width, height, sw, sh, 'cover') / base;
  const on = editor.playheadOnSelection;
  const cur = shown.transform.scale;
  const near = (v: number) => Math.abs(cur - v) < 0.005 && Math.abs(shown.transform.x) < 0.005 && Math.abs(shown.transform.y) < 0.005;
  const set = (scale: number) => void editor.setShownTransform(clip, shown, { scale: Math.round(scale * 1e4) / 1e4, x: 0, y: 0 }, 'Frame fill');
  return (
    <div className="pf-choice" role="group" aria-label={S.secFill}>
      <button type="button" aria-pressed={near(fit)} disabled={!on} title={S.fitHint} data-testid="fill-fit" onClick={() => set(fit)}><Minimize2 size={16} strokeWidth={1.75} aria-hidden="true" /> {S.fit}</button>
      <button type="button" aria-pressed={near(fill) && Math.abs(fill - fit) > 0.005} disabled={!on || Math.abs(fill - fit) <= 0.005} title={S.fillHint} data-testid="fill-fill" onClick={() => set(fill)}><Maximize2 size={16} strokeWidth={1.75} aria-hidden="true" /> {S.fill}</button>
    </div>
  );
}

/** The cut this clip starts with: what is on it now, and the way into the cut inspector (the timeline's cut chip does the same). */
function CutLink({ clip }: { clip: Media }) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const cut = state.doc ? cutBefore(state.doc, clip.id) : null;
  if (!cut) return null;
  const tr = clip.transition;
  return (
    <button type="button" className="insp-link" data-testid="insp-cut-open" onClick={() => selectCut(clip.id)}>
      <Scissors size={16} strokeWidth={1.75} aria-hidden="true" />
      <span className="insp-link-text"><span>{S.cutBefore}</span><span className="muted">{tr ? <bdi>{transitionDef(tr.type)?.name[state.lang] ?? tr.type} · <span className="num">{tr.frames}</span> {S.frames}</bdi> : S.cutNone}</span></span>
      <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="pf-ico pf-ico-flip" />
    </button>
  );
}

/**
 * "On the beat": what of this clip follows the music, in the pulse style. Shown only where analysed music plays under the
 * clip. It lists the effect parameters that kick on the beat (set with the ♪ beside a parameter) and leads to the effects tab;
 * nothing here is invented when nothing follows the beat yet.
 */
function BeatRow({ clip, onOpen }: { clip: Clip; onOpen: () => void }) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = state.doc;
  // looked up when the project or the clip changes, not on every painted frame
  const music = useMemo(() => !!doc && musicUnder(doc, clip, editor.rate), [doc, clip, editor.rate]);
  if (!doc || clip.type === 'caption' || !music) return null;
  const following = (clip.effects ?? []).flatMap((fx) => Object.entries(fx.modulate ?? {}).map(([param, m]) => ({ fx, param, m })));
  return (
    <button type="button" className="pf-card is-pulse beat-row" data-testid="insp-beat-row" data-following={following.length} onClick={onOpen}>
      <IconOnBeat size={18} />
      <span className="pf-card-text">
        <strong>{S.onTheBeat}</strong>
        <span className="muted">{following.length === 0 ? S.beatNothing : following.map(({ fx, param, m }) => `${findEffect(fx.type)?.name[state.lang] ?? fx.type} · ${effectParamLabel(param, state.lang, fx.type)} · ${S.everyBeats(m.every)}`).join(' · ')}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="pf-ico pf-ico-flip" />
    </button>
  );
}

/* ------------------------------------------------------------------ speed ------------------------------------------------------------------ */

/** Clip speed: preset chips and a number field. Commits `set_clip_speed`; the clip's length follows, picture and linked sound together. */
function SpeedField({ clip }: { clip: Media }) {
  const { editor, t } = useEditorState();
  const value = +speedValue(clip).toFixed(3);
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value, clip.id]);
  const set = (n: number) => { if (n !== value) void editor.commit([{ op: 'set_clip_speed', args: { clipId: clip.id, speed: n } }], 'Clip speed'); };
  // The sound this clip's speed applies to: the clip itself on a sound track, and the sound clips linked to it.
  const doc = editor.doc;
  const sound = doc ? doc.sequences[doc.mainSequenceId]!.tracks.filter((tr) => tr.kind === 'audio').flatMap((tr) => tr.clips)
    .filter((c): c is Media => c.type === 'media' && (c.id === clip.id || (!!clip.linkGroupId && c.linkGroupId === clip.linkGroupId)) && !!doc.assets[c.assetId]?.audio) : [];
  const commit = () => { const n = Number(v); if (v === '' || !Number.isFinite(n) || n < 0.1 || n > 8) { setV(String(value)); return; } set(Math.round(n * 1000) / 1000); };
  return (
    <div className="fields" data-testid="speed-field">
      <div className="pf-chips" role="group" aria-label={t('speed.presets')}>
        {[0.25, 0.5, 1, 1.5, 2, 4].map((p) => <button key={p} type="button" className="pf-chipbtn" aria-pressed={value === p} data-testid={`clip-speed-${p}`} onClick={() => set(p)}><bdi className="num">×{p}</bdi></button>)}
      </div>
      <label>{t('speed.label')}
        <input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={v} data-testid="clip-speed"
          onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
      </label>
      <p className="muted pf-help">{t('speed.hint')}</p>
      {sound.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={sound.every((c) => !!c.keepPitch)} data-testid="clip-keep-pitch"
            onChange={(e) => void editor.commit([{ op: 'set_clip_pitch', args: { clipId: clip.id, keepPitch: e.target.checked } }], 'Keep pitch')} />
          {t('speed.keepPitch')}
        </label>
      )}
    </div>
  );
}

/** A gradual speed change over the selected clip, as consecutive steps of constant speed (see the `speed_ramp` op). */
function RampField({ clip }: { clip: Media }) {
  const { editor, t } = useEditorState();
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('2');
  const [steps, setSteps] = useState('8');
  const [eased, setEased] = useState(clip.speedCurve === 'smooth');
  const a = Number(from), b = Number(to), n = Math.round(Number(steps));
  const range = a >= 0.1 && a <= 8 && b >= 0.1 && b <= 8 && a !== b;
  const ok = range && n >= 2 && n <= 24 && !clip.keyframes && !clip.volume && !clip.transition && !clip.reverse && !clip.speedEnd;
  const smoothOk = range && !clip.transition && !clip.reverse && !clip.freeze && !clip.keepPitch;
  // One edit at a time (oneAtATime.ts, as in SpeedCurves.tsx): the second click of a double-click, or a click while the
  // first edit is still on its way, sends nothing. "In steps" in particular would otherwise divide its own first step again.
  // `busy` only repaints the buttons (aria-disabled, so the focus stays); the guard reads the flight itself.
  const [flight] = useState(singleFlight);
  const [busy, setBusy] = useState(false);
  const once = async (clicks: number, ops: OpCall[], label: string) => {
    if (repeatClick(clicks) || flight.busy) return;
    setBusy(true);
    try { await flight.run(() => editor.commit(ops, label)); } finally { setBusy(false); }
  };
  return (
    <fieldset className="ramp" data-testid="ramp">
      <legend className="sr-only">{t('ramp.title')}</legend>
      <div className="row">
        <label>{t('ramp.from')}<input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="ramp-from" /></label>
        <label>{t('ramp.to')}<input type="number" dir="ltr" min={0.1} max={8} step={0.05} value={to} onChange={(e) => setTo(e.target.value)} data-testid="ramp-to" /></label>
        <label>{t('ramp.steps')}<input type="number" dir="ltr" min={2} max={24} step={1} value={steps} onChange={(e) => setSteps(e.target.value)} data-testid="ramp-steps" /></label>
      </div>
      {clip.speedEnd && (
        <p className="row" data-testid="ramp-state">
          <span>{t('ramp.now')}: <bdi dir="ltr">{+speedValue(clip).toFixed(3)}× → {+(clip.speedEnd.num / clip.speedEnd.den).toFixed(3)}×</bdi>{clip.speedCurve === 'smooth' ? ` · ${t('ramp.eased.short')}` : ''}{clip.rampWindow ? ` · ${t('ramp.part')}` : ''}</span>
          <button type="button" className="ghost" data-testid="ramp-clear" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={(e) => void once(e.detail, [{ op: 'set_clip_speed', args: { clipId: clip.id, speed: +speedValue(clip).toFixed(3) } }], 'Clip speed')}>{t('ramp.clear')}</button>
        </p>
      )}
      <div className="row">
        <button type="button" className="primary" disabled={!smoothOk} aria-disabled={busy || undefined} aria-busy={busy || undefined} data-testid="ramp-smooth" onClick={(e) => void once(e.detail, [{ op: 'set_clip_speed_ramp', args: { clipId: clip.id, from: a, to: b, ...(eased ? { curve: 'smooth' } : {}) } }], 'Gradual speed change')}>{t('ramp.smooth')}</button>
        <button type="button" className="ghost" disabled={!ok} aria-disabled={busy || undefined} aria-busy={busy || undefined} data-testid="ramp-apply" onClick={(e) => void once(e.detail, [{ op: 'speed_ramp', args: { clipId: clip.id, from: a, to: b, steps: n } }], 'Speed ramp')}>{t('ramp.apply')}</button>
      </div>
      <label className="check">
        <input type="checkbox" checked={eased} data-testid="ramp-eased" onChange={(e) => setEased(e.target.checked)} />
        {t('ramp.eased')}
      </label>
      <p className="muted pf-help">{t('ramp.smoothNote')}</p>
      <p className="muted pf-help">{t('ramp.note')}</p>
    </fieldset>
  );
}

/** Freeze frame: hold the picture at the playhead for a chosen time. Everything after it moves later (one transaction). */
function FreezeField({ clip }: { clip: Media }) {
  const { editor, t } = useEditorState();
  const [secs, setSecs] = useState('1');
  const n = Number(secs);
  const valid = secs !== '' && Number.isFinite(n) && n > 0 && n <= 600;
  const inside = T.lte(clip.start, editor.playhead) && T.lt(editor.playhead, T.add(clip.start, clip.duration));
  const go = () => {
    const at = editor.playhead; // read when used, not at the last render
    if (!valid || !T.lte(clip.start, at) || !T.lt(at, T.add(clip.start, clip.duration))) return;
    const frames = Math.max(1, Math.round((n * editor.rate.num) / editor.rate.den));
    void editor.commit([{ op: 'freeze_frame', args: { clipId: clip.id, at, duration: T.frameTime(frames, editor.rate) } }], 'Freeze frame');
  };
  return (
    <div className="fields" data-testid="freeze-field">
      <label>{t('freeze.seconds')}
        <input type="number" dir="ltr" min={0.1} max={600} step={0.1} value={secs} data-testid="freeze-seconds" onChange={(e) => setSecs(e.target.value)} />
      </label>
      <button type="button" className="ghost" disabled={!valid || !inside} data-testid="freeze-apply" onClick={go}>{t('freeze.apply')}</button>
      <p className="muted pf-help">{t('freeze.hint')}</p>
    </div>
  );
}

const ANIMS = ['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'] as const;
/** Entrance and exit of a clip as keyframes (animate_clip). */
function AnimateControls({ clipId }: { clipId: string }) {
  const { editor, t } = useEditorState();
  const [inA, setInA] = useState<string>('none');
  const [outA, setOutA] = useState<string>('none');
  const [frames, setFrames] = useState('12');
  const n = Math.round(Number(frames));
  const ok = (inA !== 'none' || outA !== 'none') && Number.isFinite(n) && n >= 1;
  const opts = ANIMS.map((a) => <option key={a} value={a}>{t(`animate.${a}` as Key)}</option>);
  return (
    <div className="fields" data-testid="animate-controls">
      <label>{t('animate.in')}
        <select value={inA} onChange={(e) => setInA(e.target.value)} data-testid="animate-in">{opts}</select>
      </label>
      <label>{t('animate.out')}
        <select value={outA} onChange={(e) => setOutA(e.target.value)} data-testid="animate-out">{opts}</select>
      </label>
      <label>{t('animate.frames')}
        <input type="number" dir="ltr" min={1} step={1} value={frames} onChange={(e) => setFrames(e.target.value)} data-testid="animate-frames" />
      </label>
      <p className="muted pf-help">{t('animate.note')}</p>
      <button className="primary" disabled={!ok} data-testid="animate-apply"
        onClick={() => void editor.commit([{ op: 'animate_clip', args: { clipId, ...(inA !== 'none' ? { in: inA } : {}), ...(outA !== 'none' ? { out: outA } : {}), inFrames: n, outFrames: n } }], 'Animate clip')}>{t('animate.apply')}</button>
    </div>
  );
}

/** "Cover the whole edit" of an adjustment clip (ADR-0016): trims it to [0, end of the last picture or title), one transaction. */
function CoverEdit({ clipId }: { clipId: string }) {
  const { editor, state } = useEditorState();
  const A = ADJUST_STRINGS[state.lang];
  const ops = state.doc ? coverEditOps(state.doc, clipId) : null;
  const hintId = useId();
  return (
    <div className="row">
      <button type="button" className="ghost" disabled={!ops} aria-describedby={hintId} data-testid={TID.adjustCoverEdit}
        onClick={() => void editor.commit(() => (editor.doc ? coverEditOps(editor.doc, clipId) : null), 'Cover the whole edit')}>{A.coverEdit}</button>
      <span id={hintId} className="muted">{ops ? A.coverEditHint : A.coverEditDone}</span>
    </div>
  );
}

/**
 * "Replace media…" of a picture or sound clip (ADR-0016, replace_clip_media): another library file in the same clip, which
 * keeps its id, place, length, effects, motion and transition. Offered: files that suit the track (a picture or video on a
 * picture track, sound on a sound track). A clip with a linked sound partner takes a file without sound only by unlinking
 * it (linked: 'detach', said on the option); with sound, the partner follows.
 */
function ReplaceMedia({ clip }: { clip: Media }) {
  const { editor, state } = useEditorState();
  const A = ADJUST_STRINGS[state.lang];
  const [open, setOpen] = useState(false);
  const listId = useId();
  const doc = state.doc;
  const track = editor.selected?.track.kind;
  if (!doc || (track !== 'video' && track !== 'audio')) return null;
  const candidates = Object.values(doc.assets).filter((a) => a.id !== clip.assetId && a.kind !== 'lut' && (track === 'video' ? !!(a.video || a.image) : !!a.audio));
  const kindOf = (a: (typeof candidates)[number]) => (a.video ? A.video : a.image ? A.image : A.audio);
  return (
    <div className="pf-replace" data-testid="replace-media-block">
      <button type="button" className="ghost" aria-expanded={open} aria-controls={listId} data-testid={TID.replaceMedia} title={A.replaceMediaTitle} onClick={() => setOpen((o) => !o)}>{A.replaceMedia}</button>
      {open && (
        <div id={listId} className="pf-replace-list">
          <p className="muted pf-help">{A.replaceMediaNote}</p>
          {candidates.length === 0 ? <p className="muted" role="note">{A.replaceMediaNone}</p> : (
            <ul>
              {candidates.map((a) => {
                const detach = !!clip.linkGroupId && track === 'video' && !a.audio;
                return (
                  <li key={a.id}>
                    <button type="button" className="ghost" data-testid={TID.replaceMediaOption} data-asset-id={a.id}
                      onClick={() => { setOpen(false); void editor.commit([{ op: 'replace_clip_media', args: { clipId: clip.id, assetId: a.id, ...(detach ? { linked: 'detach' } : {}) } }], 'Replace media'); }}>
                      <bdi>{a.name}</bdi> <span className="muted">({kindOf(a)}{detach ? ` · ${A.replaceDetach}` : ''})</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ text ------------------------------------------------------------------ */

function useText(clip: Clip, viewClip: Clip) {
  const { editor, state } = useEditorState();
  const variantId = state.viewVariantId;
  const shownText = viewClip.type === 'text' || viewClip.type === 'caption' ? viewClip.text : '';
  const [text, setText] = useState(shownText);
  useEffect(() => { setText(shownText); }, [shownText, clip.id, variantId]);
  const textOverride = variantId ? editor.doc?.variants?.[variantId]?.overrides[clip.id] : undefined;
  const commit = () => {
    if (!text || text === shownText) return;
    void editor.commit(variantId ? [{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text } }] : [{ op: clip.type === 'caption' ? 'update_cue' : 'update_text', args: { clipId: clip.id, text } }], 'Edit text');
  };
  return { text, setText, commit, textOverride, variantId };
}

/* ------------------------------------------------------------------ the tab panels ------------------------------------------------------------------ */

interface PanelProps { clip: Clip; viewClip: Clip; shown: ResolvedNow; keymap: Keymap; look: LookState | null; trackKind: string }

function BasicTab({ clip, viewClip, shown, keymap }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const variantId = state.viewVariantId;
  const media = clip.type === 'media' ? clip : null;
  const ks = keyframeSummary(clip);
  const blend = clip.type === 'caption' ? 'normal' : clip.blend ?? 'normal';
  const fps = editor.rate.num / editor.rate.den;
  const moved = TRANSFORM_FIELDS.some((f) => Math.abs(shown.transform[f.prop] - f.neutral) > 1e-6);
  const reset = () => void editor.setShownTransform(clip, shown, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, 'Reset transform');
  return (
    <>
      <Section id="transform" title={S.secPlace} onReset={moved && editor.playheadOnSelection ? reset : undefined}>
        {/* Values shown are the ones rendered at the playhead. Editing an animated property writes a keyframe there. */}
        <FormatScope clip={clip} />
        <TransformRows clip={clip} viewClip={viewClip} shown={shown} />
      </Section>
      {media && <Section id="fill" title={S.secFill}><FrameFill clip={media} shown={shown} /></Section>}
      <BeatRow clip={clip} onOpen={() => openInspectorTab('effects')} />
      {media && !variantId && <CutLink clip={media} />}
      <Section id="keys" title={S.secKeys} defaultOpen={false} summary={ks.count ? S.keysCount(ks.count) : S.keysNone}><KeyframeButtons clip={clip} keymap={keymap} /></Section>
      <Section id="blend" title={S.secBlend} defaultOpen={false} summary={S.blend[blend] ?? blend}><BlendField clip={clip} /></Section>
      <Section id="time" title={S.secTime} defaultOpen={false} summary={`${shortTimecode(T.frameIndexAt(clip.start, editor.rate), fps)} · ${secondsText(T.toSeconds(clip.duration))} ${S.seconds}`}><TimeBlock clip={clip} keymap={keymap} /></Section>
      {media && !variantId && (
        <Section id="media" title={S.secMedia} defaultOpen={false} summary={(state.doc?.assets[media.assetId]?.name ?? '').replace(/\.[a-z0-9]{2,5}$/i, '')}>
          <ReplaceMedia key={`replace:${media.id}`} clip={media} />
          {media.linkGroupId && <div className="row"><button type="button" className="ghost" data-testid="unlink-clip" title={t('unlink.hint')} onClick={() => void editor.commit([{ op: 'unlink_clip', args: { clipId: media.id } }], 'Detach clip')}>{t('unlink.label')}</button></div>}
        </Section>
      )}
      {media && state.selection.length === 1 && <Section id="analysis" title={S.secAnalysis} defaultOpen={false} help><AnalysisPanel key={`analysis:${clip.id}`} /></Section>}
    </>
  );
}

function MotionTab({ clip }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const tt = trackingT(state.lang);
  const video = clip.type === 'media' && !!state.doc?.assets[clip.assetId]?.video;
  return (
    <>
      <Section id="entrance" title={S.secEntrance} help><AnimateControls key={`anim:${clip.id}`} clipId={clip.id} /></Section>
      {/* motion tracking (ADR-0015): follow for a title or a picture; the tracks of a video clip's file */}
      <Section id="follow" title={tt('follow.title')} defaultOpen={false} help><FollowControls key={`follow:${clip.id}`} /></Section>
      {video && <Section id="tracking" title={tt('mtrack.title')} defaultOpen={false} help><TrackingPanel key={`tracking:${clip.id}`} /></Section>}
    </>
  );
}

function SpeedTab({ clip }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const variantId = state.viewVariantId;
  if (clip.type !== 'media') return null;
  const asset = editor.doc?.assets[clip.assetId];
  const kind = editor.selected?.track.kind;
  const notImage = !variantId && asset?.kind !== 'image' && !clip.freeze;
  const canFreeze = !variantId && !clip.freeze && kind === 'video' && !!asset?.video;
  const canReverse = !variantId && !clip.freeze && (kind === 'video' ? !!asset?.video : kind === 'audio' && !!asset?.audio);
  if (variantId) return <p className="muted insp-note">{t('transform.keyframesMasterOnly')}</p>;
  return (
    <>
      {notImage && <Section id="speed" title={S.secSpeed} help summary={S.speedNow(String(+speedValue(clip).toFixed(2)))}><SpeedField clip={clip} /></Section>}
      {notImage && <Section id="curves" title={S.secCurves} help><SpeedCurveField key={`curve:${clip.id}`} clip={clip} /></Section>}
      {notImage && <Section id="ramp" title={S.secRamp} defaultOpen={false} help summary={clip.speedEnd ? `×${+speedValue(clip).toFixed(2)} → ×${+(clip.speedEnd.num / clip.speedEnd.den).toFixed(2)}` : undefined}><RampField clip={clip} /></Section>}
      {canFreeze && <Section id="freeze" title={S.secFreeze} defaultOpen={false} help><FreezeField clip={clip} /></Section>}
      {canReverse && (
        <Section id="reverse" title={S.secMore} defaultOpen={false} help summary={clip.reverse ? t('reverse.label') : undefined}>
          <label className="check">
            <input type="checkbox" checked={!!clip.reverse} data-testid="reverse-toggle" onChange={(e) => void editor.commit([{ op: 'set_clip_reverse', args: { clipId: clip.id, reverse: e.target.checked } }], 'Reverse clip')} /> {t('reverse.label')}
          </label>
          <p className="muted pf-help" data-testid="reverse-note">{t(clip.linkGroupId ? 'reverse.note.linked' : 'reverse.note')}</p>
        </Section>
      )}
      {clip.freeze && <p className="muted insp-note" data-testid="freeze-note">{t('freeze.note')}</p>}
    </>
  );
}

const GRADE_FIELDS = [
  { key: 'exposure', label: 'gradeExposure', min: -2, max: 2, step: 0.05, neutral: 0, bipolar: true },
  { key: 'temperature', label: 'gradeTemperature', min: -1, max: 1, step: 0.02, neutral: 0, bipolar: true },
  { key: 'tint', label: 'gradeTint', min: -1, max: 1, step: 0.02, neutral: 0, bipolar: true },
  { key: 'contrast', label: 'gradeContrast', min: 0, max: 2, step: 0.02, neutral: 1, bipolar: false },
  { key: 'saturation', label: 'gradeSaturation', min: 0, max: 2, step: 0.02, neutral: 1, bipolar: false },
] as const;
/**
 * The manual colour block: exposure, temperature, tint, contrast and saturation of the clip's colour grade, each set with one
 * registered operation (set_colour_grade, merge: the other values stay). It is the same colour grade the ready looks and
 * colour match write, and it also stands in the effect stack, where its remaining values are.
 */
function ManualGrade({ clip }: { clip: Clip }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (clip.type === 'caption') return null;
  const grade = clip.effects?.find((e) => e.type === 'color.grade');
  const gpu = !!state.gpu?.available;
  const value = (k: string, neutral: number) => { const v = grade?.params[k]; return typeof v === 'number' ? v : neutral; };
  const set = (params: Record<string, number>, mode: 'merge' | 'replace' = 'merge') => editor.commit([{ op: 'set_colour_grade', args: { clipId: clip.id, params, mode } }], 'Colour grade');
  const changed = !!grade && GRADE_FIELDS.some((f) => Math.abs(value(f.key, f.neutral) - f.neutral) > 1e-6);
  const animated = (k: string) => !!grade?.keyframes?.[k]?.length;
  return (
    <Section id="grade" title={S.secGrade} onReset={changed && gpu ? () => void set(Object.fromEntries(GRADE_FIELDS.map((f) => [f.key, f.neutral]))) : undefined}>
      {!gpu && <p className="muted" role="note" data-testid="grade-unavailable">{t('look.gpu.needed')}</p>}
      {GRADE_FIELDS.map((f) => <GradeRow key={f.key} f={f} value={value(f.key, f.neutral)} gpu={gpu} animated={animated(f.key)} set={set} />)}
    </Section>
  );
}

function GradeRow({ f, value: v, gpu, animated, set }: { f: (typeof GRADE_FIELDS)[number]; value: number; gpu: boolean; animated: boolean; set: (params: Record<string, number>) => Promise<unknown> | void }) {
  const { state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const [live, setDraft] = useDraft(v);
  const label = S[f.label], full = effectParamLabel(f.key, state.lang, 'color.grade');
  const commit = (n: number) => { setDraft(n); settle(n !== v && set({ [f.key]: Math.round(n * 1e3) / 1e3 }), setDraft); };
  const shown = `${live - f.neutral > 0 ? '+' : ''}${Math.round((live - f.neutral) * 100)}`.replace('-', '\u2212');
  return (
    <Row label={label} modified={Math.abs(v - f.neutral) > 1e-6} value={<bdi className="val num pf-read">{shown}</bdi>}>
      <input type="range" dir={f.bipolar ? 'ltr' : undefined} className={f.bipolar ? 'is-bipolar' : undefined} min={f.min} max={f.max} step={f.step} value={live} disabled={!gpu || animated} aria-label={full} aria-valuetext={shown} data-testid={`grade-${f.key}`}
        title={animated ? t('keyframes.animated') : full} onChange={(e) => setDraft(Number(e.currentTarget.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))} onKeyUp={(e) => { if (RANGE_KEYS.has(e.key)) commit(Number(e.currentTarget.value)); }} />
    </Row>
  );
}

function ColourTab({ clip, look, trackKind }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (!look) return null;
  const media = clip.type === 'media' && trackKind === 'video';
  return (
    <>
      <Section id="looks" title={S.secLooks} summary={S.looksCount(LOOK_CATALOG_COUNTS.looks)}><LookTargetLine look={look} /><LooksField look={look} /></Section>
      <ManualGrade clip={clip} />
      {media && clip.type === 'media' && <Section id="match" title={S.secMatch} defaultOpen={false} help><ColourMatchPanel key={`cm:${clip.id}`} clip={clip} /></Section>}
    </>
  );
}

function EffectsTab({ clip, look }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (!look) return null;
  const n = clip.type === 'caption' ? 0 : clip.effects?.length ?? 0;
  return (
    <div className="look-panel" data-testid="look-panel">
      <LookTarget look={look} />
      <Section id="look" title={S.secStack} summary={S.stackCount(n)} help><EffectsBlock look={look} /></Section>
      {clip.type === 'text' && <Section id="blend-text" title={S.secBlend} defaultOpen={false}><BlendField clip={clip} /></Section>}
    </div>
  );
}

function MaskTab({ clip }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const A = ADJUST_STRINGS[state.lang];
  const tt = trackingT(state.lang);
  if (clip.type !== 'media' && clip.type !== 'adjustment') return null;
  const video = clip.type === 'media' && !!state.doc?.assets[clip.assetId]?.video;
  const regions = clip.type === 'media' ? clip.redact?.length ?? 0 : 0;
  return (
    <>
      <Section id="mask" title={S.secMask} summary={clip.mask ? S.maskOn : S.maskOff}>
        <MaskControls key={`mask:${clip.id}`} clipId={clip.id} mask={clip.mask} />
        {clip.type === 'adjustment' && <p className="muted pf-help" role="note" data-testid="adjust-mask-note">{A.maskNote}</p>}
      </Section>
      {/* privacy regions (ADR-0015): open whenever the clip has one, so their standing warning is never folded away */}
      {video && <Section id="redact" title={tt('redact.title')} defaultOpen={regions > 0} summary={S.privacyCount(regions)} help><RedactControls key={`redact:${clip.id}`} /></Section>}
    </>
  );
}

/** The sound of a picture clip lives in the sound clip linked to it: its level, its cleanup and its effects are edited there, and shown here. */
function LinkedAudioTab({ clip }: PanelProps) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const doc = state.doc;
  if (clip.type !== 'media' || !doc) return null;
  const sounds = clip.linkGroupId ? doc.sequences[doc.mainSequenceId]!.tracks.filter((tr) => tr.kind === 'audio').flatMap((tr) => tr.clips)
    .filter((c): c is Media => c.type === 'media' && c.id !== clip.id && c.linkGroupId === clip.linkGroupId && !!doc.assets[c.assetId]?.audio) : [];
  if (!sounds.length) return <p className="muted insp-note" data-testid="insp-no-sound">{S.noSound}</p>;
  return (
    <>
      <p className="muted insp-note">{S.linkedSound} <button type="button" className="ghost" data-testid="insp-linked-sound" onClick={() => editor.select(sounds[0]!.id)}>{S.linkedOpen}</button></p>
      <LinkedSoundFx sounds={sounds} />
    </>
  );
}

function SoundAudioTab({ clip }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (clip.type !== 'media') return null;
  return (
    <>
      <Section id="volume" title={S.secVolume} help><ClipSound key={`cs:${clip.id}`} clip={clip} /></Section>
      <DuckSwitch clip={clip} />
    </>
  );
}

function TextTab({ clip, viewClip }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const tx = useText(clip, viewClip);
  if (clip.type !== 'text') return null;
  const variantId = tx.variantId;
  const hasTextOverride = !!(tx.textOverride && (tx.textOverride.text !== undefined || tx.textOverride.textStyle));
  const sizeCommit = (v: number) => editor.commit(variantId
    ? [{ op: 'set_variant_override', args: { variantId, clipId: clip.id, textStyle: { sizeFrac: v } } }]
    : [{ op: 'update_text', args: { clipId: clip.id, style: { sizeFrac: v } } }], 'Text size');
  const size = viewClip.type === 'text' ? viewClip.style.sizeFrac : 0.05;
  return (
    <>
      <Section id="text" title={S.secWords}>
        <label className="insp-area"><span className="sr-only">{t('text.content')}</span>
          <textarea dir="auto" rows={3} value={tx.text} data-testid="text-content" onChange={(e) => tx.setText(e.target.value)} onBlur={tx.commit} />
          <span className="insp-count num" aria-hidden="true">{tx.text.length}</span>
        </label>
        {variantId && (
          <p className="muted" data-testid="text-format-note">{t(hasTextOverride ? 'text.formatOnly.set' : 'text.formatOnly.hint')}
            {hasTextOverride && <> <button type="button" className="ghost" data-testid="text-format-reset" onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text: null, textStyle: null } }], 'Reset format text')}>{t('text.formatOnly.reset')}</button></>}
          </p>
        )}
      </Section>
      <Section id="font" title={S.secFont}>
        <label>{t('font.family')}
          <select value={clip.style.fontFamily} data-testid="text-font" onChange={(e) => void editor.commit([{ op: 'update_text', args: { clipId: clip.id, style: { fontFamily: e.target.value } } }], 'Font')}>
            {FONT_CATALOG.map((f) => <option key={f.family} value={f.family} style={{ fontFamily: `"${f.family}"` }}>{f.family}</option>)}
          </select>
        </label>
        <SizeRow key={variantId ?? 'master'} size={size} commit={sizeCommit} />
      </Section>
    </>
  );
}

/** The text size: the slider and its readout follow a drag; one commit when it ends. Keyed by the viewed format only, so focus stays. */
function SizeRow({ size, commit }: { size: number; commit: (v: number) => Promise<unknown> }) {
  const { state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const [live, setDraft] = useDraft(size);
  const done = (v: number) => { setDraft(v); settle(v !== size && commit(v), setDraft); };
  return (
    <Row label={S.fontSize} value={<bdi className="val num pf-read">{Math.round(live * 100)}%</bdi>}>
      <input type="range" min={0.02} max={0.2} step={0.005} value={live} aria-label={t('text.size')} aria-valuetext={`${Math.round(live * 100)}%`} data-testid="text-size"
        onChange={(e) => setDraft(Number(e.currentTarget.value))} onPointerUp={(e) => done(Number(e.currentTarget.value))} onKeyUp={(e) => { if (RANGE_KEYS.has(e.key)) done(Number(e.currentTarget.value)); }} />
    </Row>
  );
}

function StyleTab({ clip, viewClip }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (clip.type !== 'text') return null;
  return (
    <>
      <Section id="preset" title={S.secStyle}>
        <label><span className="sr-only">{t('text.preset')}</span>
          <select value="" data-testid="text-preset" aria-label={t('text.preset')} onChange={(e) => { const presetId = e.target.value; if (presetId) void editor.commit([{ op: 'apply_text_preset', args: { clipId: clip.id, presetId } }], 'Apply text style'); }}>
            <option value="">{t('text.preset.pick')}</option>
            {TEXT_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name[state.lang]}</option>)}
          </select>
        </label>
      </Section>
      <Section id="textfx" title={S.secTextFx} help><TextEffectsField clip={clip} style={viewClip.type === 'text' ? viewClip.style : clip.style} variantId={state.viewVariantId ?? null} /></Section>
    </>
  );
}

function AnimTab({ clip }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (clip.type !== 'text') return null;
  return (
    <>
      <Section id="textanim" title={S.secTextAnim} help><TextAnimationField clip={clip} /></Section>
      <Section id="entrance" title={S.secEntrance} defaultOpen={false} help><AnimateControls key={`anim:${clip.id}`} clipId={clip.id} /></Section>
    </>
  );
}

function PlaceTab({ clip, viewClip, shown, keymap }: PanelProps) {
  const { editor, state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const tt = trackingT(state.lang);
  const ks = keyframeSummary(clip);
  const moved = TRANSFORM_FIELDS.some((f) => Math.abs(shown.transform[f.prop] - f.neutral) > 1e-6);
  return (
    <>
      <Section id="transform" title={S.secPlace} onReset={moved && editor.playheadOnSelection ? () => void editor.setShownTransform(clip, shown, { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, 'Reset transform') : undefined}>
        <FormatScope clip={clip} />
        <TransformRows clip={clip} viewClip={viewClip} shown={shown} />
      </Section>
      <Section id="keys" title={S.secKeys} defaultOpen={false} summary={ks.count ? S.keysCount(ks.count) : S.keysNone}><KeyframeButtons clip={clip} keymap={keymap} /></Section>
      <Section id="follow" title={tt('follow.title')} defaultOpen={false} help><FollowControls key={`follow:${clip.id}`} /></Section>
      <Section id="time" title={S.secTime} defaultOpen={false} summary={`${secondsText(T.toSeconds(clip.duration))} ${S.seconds}`}><TimeBlock clip={clip} keymap={keymap} /></Section>
    </>
  );
}

function CueTab({ clip, viewClip }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const tx = useText(clip, viewClip);
  if (clip.type !== 'caption') return null;
  const variantId = tx.variantId;
  const cues = editor.selected?.track.clips ?? [];
  const hasNext = cues[cues.findIndex((c) => c.id === clip.id) + 1]?.type === 'caption';
  return (
    <Section id="text" title={S.secWords}>
      <label className="insp-area"><span className="sr-only">{t('cue.text')}</span>
        <textarea dir="auto" rows={2} value={tx.text} data-testid="cue-text" onChange={(e) => tx.setText(e.target.value)} onBlur={tx.commit} />
      </label>
      {!variantId && <div className="row"><button type="button" className="ghost" disabled={!hasNext} data-testid="cue-merge" onClick={() => void editor.commit([{ op: 'merge_cues', args: { clipId: clip.id } }], 'Merge captions')}>{t('cue.merge')}</button></div>}
      {variantId && (
        <label className="check">
          <input type="checkbox" checked={!!tx.textOverride?.hidden} data-testid="cue-format-hide" onChange={(e) => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, hidden: e.target.checked } }], 'Hide caption in format')} /> {t('cue.formatOnly.hide')}
        </label>
      )}
      {variantId && (
        <p className="muted" data-testid="cue-format-note">{t(tx.textOverride?.text !== undefined ? 'cue.formatOnly.set' : 'cue.formatOnly.hint')}
          {tx.textOverride?.text !== undefined && <> <button type="button" className="ghost" data-testid="cue-format-reset" onClick={() => void editor.commit([{ op: 'set_variant_override', args: { variantId, clipId: clip.id, text: null } }], 'Reset format caption')}>{t('text.formatOnly.reset')}</button></>}
        </p>
      )}
      <p className="muted insp-note">{S.captionLooksLink}</p>
    </Section>
  );
}

function TimingTab({ clip, keymap }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  return <Section id="time" title={S.secTime}><TimeBlock clip={clip} keymap={keymap} /></Section>;
}

function SoundFxTab({ clip }: PanelProps) {
  if (clip.type !== 'media') return null;
  return <AudioFxBlock key={`fx:${clip.id}`} clip={clip} />;
}

function BeatTab({ clip, keymap }: PanelProps) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (clip.type !== 'media') return null;
  const beats = state.doc?.analyses?.[clip.assetId]?.beats;
  const bpm = beats?.bpm ?? null;
  return (
    <>
      <div className={`pf-card${beats ? ' is-pulse' : ''} beat-card`} data-testid="insp-beat" data-beats={beats ? beats.beats.length : 0}>
        <IconOnBeat size={18} />
        {/* "120 BPM" is one left-to-right run, in every language */}
        <span>{beats ? <>{S.tempo} <bdi dir="ltr" className="num">{bpm === null ? '—' : Math.round(bpm)} BPM</bdi> · {isolate(S.beatsN(beats.beats.length))}</> : S.bpmNone}</span>
      </div>
      <Section id="analysis" title={S.secBeat} help><AnalysisPanel key={`analysis:${clip.id}`} /></Section>
      <Section id="time" title={S.secTime} defaultOpen={false} summary={`${secondsText(T.toSeconds(clip.duration))} ${S.seconds}`}><TimeBlock clip={clip} keymap={keymap} /></Section>
      {!state.viewVariantId && (
        <Section id="media" title={S.secMedia} defaultOpen={false}>
          <ReplaceMedia key={`replace:${clip.id}`} clip={clip} />
          {clip.linkGroupId && <div className="row"><button type="button" className="ghost" data-testid="unlink-clip" title={t('unlink.hint')} onClick={() => void editor.commit([{ op: 'unlink_clip', args: { clipId: clip.id } }], 'Detach clip')}>{t('unlink.label')}</button></div>}
        </Section>
      )}
    </>
  );
}

function RangeTab({ clip, viewClip, shown }: PanelProps) {
  const { state } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  const A = ADJUST_STRINGS[state.lang];
  if (clip.type !== 'adjustment') return null;
  return (
    <>
      <Section id="transform" title={S.secRange}>
        {/* an adjustment clip (ADR-0016) has opacity only: no place, size or turn of its own */}
        <p className="muted pf-help" role="note" data-testid="adjust-transform-note">{A.adjustNote}</p>
        <FormatScope clip={clip} />
        <TransformRows clip={clip} viewClip={viewClip} shown={shown} />
        {!state.viewVariantId && <CoverEdit clipId={clip.id} />}
      </Section>
      <Section id="mask" title={S.secMask} defaultOpen={false} summary={clip.mask ? S.maskOn : S.maskOff}>
        <MaskControls key={`mask:${clip.id}`} clipId={clip.id} mask={clip.mask} />
        <p className="muted pf-help" role="note" data-testid="adjust-mask-note">{A.maskNote}</p>
      </Section>
    </>
  );
}

function SharedTab() {
  return <LayoutPicker />;
}

/* ------------------------------------------------------------------ the object ------------------------------------------------------------------ */

/**
 * The tabs and panels of the selected object. All panels of the object stay mounted and all but the shown one are hidden, so
 * a value typed in one tab is still there after a look at another; in the "all tools" view every panel is shown, one under
 * the other, each under its tab's name.
 */
/** The id of the object's first tab is the old "clip" tab's (test-id policy: the id stays on the control that opens the clip's properties), unless the mode's own tab row carries it. */
const CLIP_PAGE: InspectorPage = 'clip';
export function ObjectPanels({ kind, tab, onTab, keymap, firstIsClipTab }: { kind: ObjectKind; tab: ObjectTab; onTab: (t: ObjectTab) => void; keymap: Keymap; firstIsClipTab: boolean }) {
  const { editor, state } = useEditorState();
  const { flat } = useContext(SectionsContext);
  const S = INSPECTOR_STRINGS[state.lang];
  const sel = editor.selected;
  const tabs = tabsFor(kind);
  const clip = sel?.clip;
  const variantId = state.viewVariantId;
  const viewClip = clip && variantId ? editor.viewDoc?.sequences[editor.viewDoc.mainSequenceId]?.tracks.flatMap((tr) => tr.clips).find((c) => c.id === clip.id) ?? clip : clip;
  const narrow = useNarrow();
  // As drawn at the playhead, worked out once for all the tabs: for a clip that follows a motion track (ADR-0015) the resolved values, edited as its offset.
  const shown = clip && viewClip ? editor.resolvedTransformNow(variantId ? viewClip : clip) : null;
  const count = clip && clip.type !== 'caption' ? clip.effects?.length ?? 0 : 0;
  const specs: TabSpec[] = tabs.map((id, i) => ({ id, label: S[TAB_LABEL[id]] as string, icon: ico(TAB_ICON[id]), count: id === 'effects' && count ? count : undefined, testId: i === 0 && firstIsClipTab ? `inspector-tab-${CLIP_PAGE}` : `insp-tab-${id}` }));
  return (
    <div className="insp-object" data-kind={kind} data-tab={tab}>
      {!flat && tabs.length > 1 && <Tabs tabs={specs} value={tab} onChange={(id) => onTab(id as ObjectTab)} label={S.objectTabs} panelPrefix="insp-panel" collapsed={narrow && tabs.length > 5} className="insp-tabs" />}
      {clip && sel ? <WithLook key={clip.id} clip={clip} trackKind={sel.track.kind}>{(look) => panels(look)}</WithLook> : panels(null)}
      {/* all tools on one screen: the transition at the start of a picture clip stands with the clip (in tabs it belongs to the cut) */}
      {flat && (kind === 'video' || kind === 'image') && clip?.type === 'media' && (
        <div role="group" aria-label={S.tabTransition} className="insp-tabpanel" data-testid="insp-panel-transition">
          <h3 className="insp-flat-title">{ico(TAB_ICON.transition, 16)} {S.tabTransition}</h3>
          <TransitionPanel clip={clip} />
        </div>
      )}
    </div>
  );
  function panels(look: LookState | null) {
    return tabs.map((id) => (
        <div key={id} role={flat || tabs.length < 2 ? 'group' : 'tabpanel'} id={`insp-panel-${id}`} aria-labelledby={flat || tabs.length < 2 ? undefined : `insp-panel-tab-${id}`} aria-label={flat || tabs.length < 2 ? (S[TAB_LABEL[id]] as string) : undefined}
          hidden={!flat && id !== tab} className="insp-tabpanel" data-testid={`insp-panel-${id}`}>
          {flat && tabs.length > 1 && <h3 className="insp-flat-title">{ico(TAB_ICON[id], 16)} {S[TAB_LABEL[id]] as string}</h3>}
          {kind === 'none' ? <ProjectPanel /> : kind === 'multi' ? <SharedTab /> : kind === 'cut' && clip?.type === 'media'
            ? (id === 'cut' ? <CutPanel clip={clip} /> : <TransitionPanel clip={clip} />)
            : clip && viewClip && sel && shown ? <ObjectTabBody id={id} kind={kind} clip={clip} viewClip={viewClip} shown={shown} keymap={keymap} trackKind={sel.track.kind} look={look} /> : null}
        </div>
      ));
  }
}

/** One tab's content. */
function ObjectTabBody({ id, kind, clip, viewClip, shown, keymap, trackKind, look }: { id: ObjectTab; kind: ObjectKind; clip: Clip; viewClip: Clip; shown: ResolvedNow; keymap: Keymap; trackKind: string; look: LookState | null }) {
  const p: PanelProps = { clip, viewClip, shown, keymap, look, trackKind };
  switch (id) {
    case 'basic': return <BasicTab {...p} />;
    case 'motion': return <MotionTab {...p} />;
    case 'speed': return <SpeedTab {...p} />;
    case 'colour': return <ColourTab {...p} />;
    case 'effects': return <EffectsTab {...p} />;
    case 'mask': return <MaskTab {...p} />;
    case 'audio': return kind === 'sound' ? <SoundAudioTab {...p} /> : <LinkedAudioTab {...p} />;
    case 'text': return <TextTab {...p} />;
    case 'style': return <StyleTab {...p} />;
    case 'anim': return <AnimTab {...p} />;
    case 'place': return <PlaceTab {...p} />;
    case 'cue': return <CueTab {...p} />;
    case 'timing': return <TimingTab {...p} />;
    case 'soundfx': return <SoundFxTab {...p} />;
    case 'beat': return <BeatTab {...p} />;
    case 'range': return <RangeTab {...p} />;
    default: return null;
  }
}

/**
 * The look state of the selected object, made once for all its tabs: the colour tab and the effects tab show and change the
 * same "this clip / the whole edit" choice, and each shows the status and refusal of a look applied from either. The caller
 * keys it by the clip, so another selection starts again at "this clip".
 */
function WithLook({ clip, trackKind, children }: { clip: Clip; trackKind: string; children: (look: LookState | null) => ReactNode }) {
  const look = useLook(clip, trackKind);
  return <>{children(clip.type === 'caption' ? null : look)}</>;
}

/** True at the widths where the inspector column is narrow (tokens: ≤1366px): seven tabs then show as icons, each with its name for assistive technology. */
function useNarrow(): boolean {
  const q = '(max-width: 1366px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(q), on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

/** The foot of the object inspector: what else the edit can reach, and a quiet delete. */
export function ObjectFooter({ kind }: { kind: ObjectKind }) {
  const { editor, state, t } = useEditorState();
  const S = INSPECTOR_STRINGS[state.lang];
  if (!objectActions(kind).includes('delete')) return null;
  return (
    <div className="insp-foot" data-testid="insp-footer">
      <button type="button" className="insp-foot-main" data-testid="insp-duplicate" onClick={() => run(editor, 'edit.duplicate')}>{S.duplicate}</button>
      <button type="button" className="insp-foot-del" data-testid="clip-delete" aria-label={t('clip.delete')} title={t('clip.delete')} onClick={() => run(editor, 'edit.delete')}><Trash2 size={16} strokeWidth={1.75} aria-hidden="true" /></button>
    </div>
  );
}
