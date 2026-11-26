import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Trash2 } from 'lucide-react';
import * as T from '@pulseframe/time';
import { adjustmentRefusal, beatPositionAt, BLEND_MODES, COLOR_LOOKS, DEFAULT_MASK, EFFECTS, PICKABLE_EFFECTS, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, describeCatalog, TRANSITIONS, findEffect, animatableParams, effectParamsAt, findClip, clipEnd, lutAssets, isTimeEffect, temporalOf, modulatableParams, paramRange, type Clip, type EffectInstance, type Mask, type Modulator, type OpCall, type ProjectDocument, beatSwitchFrame, TRANSITION_CATEGORIES, transitionDef, velocityLimit, velocityNeeds } from '@pulseframe/core';
import { effectOptionLabel, effectParamLabel, type Key, fillIn, translateRefusal } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { ApplyToGroup, EffectGalleryButton, type ApplyTo } from './EffectGallery.tsx';
import { ADJUST_STRINGS } from './adjust.strings.ts';
import { wholeEditAdjustment, type WholeEditPick } from './commands.ts';
import { flashSchedule } from '@pulseframe/engine';
import { TRANSITION_OPTION_TESTIDS } from './trendTestIds.ts';
import { SectionsContext } from './Section.tsx';
import { Seg } from '../ds/index.ts';
import { INSPECTOR_STRINGS } from './inspector.strings.ts';
import { IconKeyframeFull, IconKeyframeHalf, IconKeyframeHollow, IconOnBeat } from './icons.tsx';
import { StampSource, STAMP_SOURCE_PARAMS } from './lifeline/StampSource.tsx';
import { CurveChip } from './CurvePicker.tsx';
import type { ChannelRef } from '@pulseframe/core';

type Prop = { type?: string; minimum?: number; maximum?: number; enum?: string[]; pattern?: string; default?: unknown };
type Params = Record<string, number | string | boolean>;
// time and overlay (ADR-0011) need no graphics adapter: only effects of cost 'gpu' are ever disabled for a missing one
const CATEGORIES = ['color', 'blur', 'light', 'stylize', 'digital', 'key', 'distort', 'motion', 'time', 'overlay'] as const;
const CATALOG = describeCatalog();
const schemaCache = new Map<string, Record<string, Prop>>();
function propsOf(type: string): Record<string, Prop> {
  let p = schemaCache.get(type);
  if (!p) {
    // describeCatalog() builds each paramsSchema with z.toJSONSchema(effect.params); the web package does not depend on zod directly.
    p = (CATALOG.effects.find((e) => e.id === type)?.paramsSchema as { properties?: Record<string, Prop> } | undefined)?.properties ?? {};
    schemaCache.set(type, p);
  }
  return p;
}
const stepOf = (min: number, max: number) => { const s = (max - min) / 200; return +s.toPrecision(2) || 0.01; };

/** One control generated from a JSON-Schema property. Commits on pointer-up / key-up / change, never on drag ticks. */
interface Keyer { animated: boolean; pressed: boolean; enabled: boolean; title: string; animatedTitle: string; onToggle: () => void; /** the curve chip beside the diamond (ADR-0019) */ curve?: { clipId: string; channel: ChannelRef } }
/**
 * The ♪ of a parameter that may follow the beat (core MODULATABLE; ADR-0011): on, it makes the parameter kick on the beats of
 * the music under the clip and settle back (op set_effect_modulator); its settings are shown in a fieldset under the slider.
 */
interface Beater {
  modulator: Modulator | undefined;
  /** Analysed music plays somewhere under the clip. Without it the toggle cannot be turned on (an existing one can be turned off). */
  music: boolean;
  /** Id of the note that says why the toggle is off, when it is. */
  noteId: string;
  range: { min: number; max: number };
  set: (m: { every: number; depth: number; decay: number } | null) => void;
}
const BEAT_EVERY = [1, 2, 4, 8] as const;
/** A new beat modulator: every second beat (ADR-0009 decision 3: safe at its defaults on fast music), a kick of a quarter of the parameter's range. */
const BEAT_DEFAULT = (r: { min: number; max: number }) => ({ every: 2, depth: +((r.max - r.min) / 4).toPrecision(2), decay: 6 });
function BeatFieldset({ name, label, beat }: { name: string; label: string; beat: Beater & { modulator: Modulator } }) {
  const { t } = useEditorState();
  const m = beat.modulator;
  const [depth, setDepth] = useState<number | null>(null);
  const [decay, setDecay] = useState<number | null>(null);
  const zeroId = useId();
  const span = beat.range.max - beat.range.min;
  const commit = (patch: Partial<{ every: number; depth: number; decay: number }>) => beat.set({ every: m.every, depth: m.depth, decay: m.decay, ...patch });
  const fmt = (v: number) => String(+v.toFixed(4)).replace('-', '−');
  // only keys that move a slider commit (Tab arriving on it must not)
  const moves = (key: string) => key.startsWith('Arrow') || key === 'Home' || key === 'End' || key === 'PageUp' || key === 'PageDown';
  return (
    <fieldset className="beat-fieldset" data-testid="beat-fieldset" data-param={name}>
      <legend>{t('look.beat.toggle')} <bdi>{label}</bdi></legend>
      <label><span>{t('look.beat.every')}</span>
        <select data-testid="beat-every" value={m.every} onChange={(e) => commit({ every: Number(e.target.value) })}>
          {[...new Set<number>([...BEAT_EVERY, m.every])].sort((a, b) => a - b).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </label>
      <label><span>{t('look.beat.depth')}<bdi className="val" dir="ltr" data-testid="beat-depth-value">{fmt(depth ?? m.depth)}</bdi></span>
        <input type="range" data-testid="beat-depth" min={-span} max={span} step={stepOf(-span, span)} list={zeroId} defaultValue={m.depth} key={m.depth}
          onInput={(e) => setDepth(Number(e.currentTarget.value))}
          onPointerUp={(e) => { setDepth(null); const v = Number(e.currentTarget.value); if (v !== m.depth) commit({ depth: v }); }}
          onKeyUp={(e) => { if (!moves(e.key)) return; setDepth(null); const v = Number(e.currentTarget.value); if (v !== m.depth) commit({ depth: v }); }} />
      </label>
      {/* the 0 tick of the signed depth: above it the parameter kicks up on the beat, below it down */}
      <datalist id={zeroId}><option value={0} /></datalist>
      <label><span>{t('look.beat.decay')}<bdi className="val" data-testid="beat-decay-value">{fmt(decay ?? m.decay)}</bdi></span>
        <input type="range" data-testid="beat-decay" min={1} max={30} step={0.5} defaultValue={m.decay} key={m.decay}
          onInput={(e) => setDecay(Number(e.currentTarget.value))}
          onPointerUp={(e) => { setDecay(null); const v = Number(e.currentTarget.value); if (v !== m.decay) commit({ decay: v }); }}
          onKeyUp={(e) => { if (!moves(e.key)) return; setDecay(null); const v = Number(e.currentTarget.value); if (v !== m.decay) commit({ decay: v }); }} />
      </label>
      <p className="muted pf-help">{t('look.beat.note')}</p>
      <button type="button" className="ghost" data-testid="beat-remove" onClick={() => beat.set(null)}>{t('look.beat.remove')}</button>
    </fieldset>
  );
}
function ParamControl({ name, prop, value, onCommit, keyer, effectType, beat }: { name: string; prop: Prop; value: number | string | boolean | undefined; onCommit: (v: number | string) => void; keyer?: Keyer; effectType: string; beat?: Beater }) {
  const [live, setLive] = useState<number | null>(null);
  const { state, t } = useEditorState();
  const shown = effectParamLabel(name, state.lang, effectType);
  const cur = value ?? prop.default;
  const tid = { 'data-testid': 'effect-param', 'data-param': name } as const;
  if (prop.enum) {
    return <label><span><bdi>{shown}</bdi></span><select {...tid} value={String(cur)} onChange={(e) => onCommit(e.target.value)}>{prop.enum.map((o) => <option key={o} value={o}>{effectOptionLabel(o, state.lang)}</option>)}</select></label>;
  }
  if (prop.type === 'string' && prop.pattern?.includes('[0-9a-fA-F]{6}')) {
    return <label><span><bdi>{shown}</bdi><bdi className="val">{String(cur)}</bdi></span><input {...tid} type="color" defaultValue={String(cur).toLowerCase()} key={String(cur)} onChange={(e) => onCommit(e.target.value.toUpperCase())} /></label>;
  }
  if (prop.type === 'integer') {
    return <label><span><bdi>{shown}</bdi></span><input {...tid} type="number" step={1} min={prop.minimum} max={prop.maximum} defaultValue={Number(cur)} key={String(cur)}
      onChange={(e) => { const n = Math.round(Number(e.target.value)); if (Number.isFinite(n) && e.target.value !== '') onCommit(n); }} /></label>;
  }
  if (prop.type === 'number') {
    const min = prop.minimum ?? 0;
    const max = prop.maximum ?? 1;
    const commit = (el: HTMLInputElement) => { setLive(null); const n = Number(el.value); if (n !== cur) onCommit(n); };
    const slider = (
      <label><span><bdi>{shown}</bdi>{keyer?.animated && <em className="animated" data-testid="effect-animated" title={keyer.animatedTitle}><IconKeyframeHalf size={12} /></em>}<bdi className="val">{+(live ?? Number(cur)).toFixed(4)}</bdi></span>
        <input {...tid} type="range" min={min} max={max} step={stepOf(min, max)} defaultValue={Number(cur)} key={String(cur)}
          onInput={(e) => setLive(Number(e.currentTarget.value))} onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} />
      </label>
    );
    if (!keyer) return slider;
    const row = (
      <div className="effect-param-row">
        {slider}
        <button type="button" className="ghost effect-key" data-testid="effect-key" data-param={name} aria-pressed={keyer.pressed} disabled={!keyer.enabled} title={keyer.title} aria-label={`${keyer.title}: ${name}`} onClick={keyer.onToggle}>{keyer.pressed ? <IconKeyframeFull size={16} /> : keyer.animated ? <IconKeyframeHalf size={16} /> : <IconKeyframeHollow size={16} />}</button>
        {keyer.curve && <CurveChip clipId={keyer.curve.clipId} channel={keyer.curve.channel} />}
        {beat && (
          <button type="button" className="ghost effect-beat" data-testid="beat-toggle" data-param={name} aria-pressed={!!beat.modulator}
            disabled={!beat.modulator && !beat.music} aria-describedby={!beat.music ? beat.noteId : undefined}
            aria-label={`${t('look.beat.toggle')} ${shown}`} title={`${t('look.beat.toggle')} ${shown}`}
            onClick={() => beat.set(beat.modulator ? null : BEAT_DEFAULT(beat.range))}><IconOnBeat size={16} /></button>
        )}
      </div>
    );
    if (!beat?.modulator) return row;
    return <div className="effect-param-block">{row}<BeatFieldset name={name} label={shown} beat={{ ...beat, modulator: beat.modulator }} /></div>;
  }
  return null;
}

/**
 * What the strobe does, as the renderer does it (packages/engine/src/strobeSchedule.ts): every strobe of the timeline takes its
 * flashes from one schedule, which starts at most three flashes in any second, counting the transitions that are a flash
 * themselves, so with several strobes, such a transition nearby, or fast music, some flashes are left out; a strobe that follows the music flashes on analysed beats only, so it shows nothing where no
 * analysed music plays (other effects fall back to their own tempo there).
 */
const STROBE_STRINGS = {
  he: {
    limit: 'מגבלת בטיחות לכל ציר הזמן: בכל שנייה מתחילים לכל היותר שלושה הבזקים, מכל אפקטי ההבזקים יחד ומהמעברים שהם הבזק בעצמם (הבזק, דרך לבן או שחור, בלוקי צבע, דפדוף). לכן, כשיש כמה אפקטים כאלה, מעבר כזה בקרבת מקום או מוזיקה מהירה, חלק מההבזקים לא יופיעו.',
    noMusic: 'אין כאן מוזיקה עם פעימות מזוהות, ולכן לא יופיעו כאן הבזקים. מנתחים פעימות בלשונית קליפ ← ניתוח, כשקליפ המוזיקה נבחר.',
  },
  en: {
    limit: 'Safety limit for the whole timeline: at most three flashes start in any second, from all strobes together and the transitions that are a flash themselves (flash, dip to white or black, colour blocks, page turn). So with several strobes, such a transition nearby, or fast music, some flashes are left out.',
    noMusic: 'No music with detected beats plays here, so this strobe shows no flashes here. Detect beats in the Clip tab → Analysis with the music clip selected.',
  },
} as const;

/** Strings of the colour table chooser (kept here, like the other notes of this panel). */
const LUT_STRINGS = {
  he: { none: 'ללא טבלה', import: 'ייבוא ‎.cube', importing: 'מייבא…', importTitle: 'ייבוא קובץ ‎.cube (טבלת צבע תלת־ממדית) לספריית הפרויקט ובחירתו לאפקט הזה', notCube: 'יש לבחור קובץ ‎.cube', empty: 'אין עדיין טבלאות צבע בפרויקט. ייבאו קובץ ‎.cube כדי שהאפקט ישנה את התמונה.' },
  en: { none: 'None', import: 'Import .cube', importing: 'Importing…', importTitle: 'Import a .cube file (a 3D colour table) into the project library and choose it for this effect', notCube: 'Choose a .cube file', empty: 'This project has no colour tables yet. Import a .cube file for the effect to change the picture.' },
} as const;
/** The `lut` parameter of a colour table effect: one of the project's colour tables (library entries of kind lut), or none, plus import of a new one. */
function LutControl({ value, onCommit }: { value: string; onCommit: (assetId: string) => void }) {
  const { editor, state } = useEditorState();
  const S = LUT_STRINGS[state.lang];
  const tables = editor.doc ? lutAssets(editor.doc) : [];
  const take = async (file: File) => {
    if (!/\.cube$/i.test(file.name)) { editor.fail(new Error(S.notCube)); return; }
    // the existing upload path: the table joins the library, then this effect is pointed at it (update_effect)
    const assetId = await editor.importFile(file);
    if (assetId && editor.doc?.assets[assetId]?.kind === 'lut') onCommit(assetId);
  };
  return (
    <div className="effect-lut" data-testid="effect-lut-control">
      <label><span><bdi>{effectParamLabel('lut', state.lang, 'color.lut')}</bdi></span>
        <select data-testid="effect-lut" data-param="lut" value={tables.some((a) => a.id === value) ? value : ''} onChange={(e) => onCommit(e.target.value)}>
          <option value="">{S.none}</option>
          {tables.map((a) => <option key={a.id} value={a.id}>{a.name}{a.lut ? ` (${a.lut.size}³)` : ''}</option>)}
        </select>
      </label>
      <label className="ghost file" title={S.importTitle}>
        {state.uploading ? S.importing : S.import}
        <input type="file" accept=".cube" disabled={state.uploading} data-testid="effect-lut-import" aria-label={S.importTitle} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void take(f); }} />
      </label>
      {tables.length === 0 && <p className="muted" role="note" data-testid="effect-lut-empty">{S.empty}</p>}
    </div>
  );
}

/** Today's date as the stamp writes it: 'YY M D (two-digit year, month and day without leading zeros, like '05 7 14). */
const todayStamp = (d = new Date()) => `'${String(d.getFullYear() % 100).padStart(2, '0')} ${d.getMonth() + 1} ${d.getDate()}`;
/**
 * The `text` of stylize.date-stamp (ADR-0011), modelled on the colour table control: ParamControl renders no free text. The
 * text is always drawn left to right, so the field is too. It is committed on Enter or when the field is left, through
 * update_effect; the effect's schema is the only judge of what is allowed, and its refusal is shown under the field.
 */
function StampControl({ value, onCommit }: { value: string; onCommit: (text: string) => Promise<string | null> }) {
  const { state, t } = useEditorState();
  const [draft, setDraft] = useState(value);
  const [tried, setTried] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const hintId = useId(), refusalId = useId();
  const input = useRef<HTMLInputElement>(null);
  // a change from elsewhere (undo, another participant) shows in the field unless the person is typing in it
  useEffect(() => { if (document.activeElement !== input.current) { setDraft(value); setRefusal(null); setTried(null); } }, [value]);
  const commit = async (text: string) => {
    if (text === value || text === tried) return;
    setTried(text);
    const r = await onCommit(text);
    setRefusal(r);
    if (!r) setTried(null);
  };
  return (
    <div className="effect-stamp" data-testid="effect-stamp-control">
      <label><span><bdi>{effectParamLabel('text', state.lang, 'stylize.date-stamp')}</bdi></span>
        <input ref={input} type="text" dir="ltr" data-testid="effect-stamp" data-param="text" value={draft} pattern="[0-9 .:'\/\-]{0,20}" spellCheck={false} autoComplete="off"
          aria-describedby={refusal ? `${hintId} ${refusalId}` : hintId} aria-invalid={!!refusal}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void commit(e.currentTarget.value); }} onBlur={(e) => void commit(e.currentTarget.value)} />
      </label>
      <button type="button" className="ghost" data-testid="effect-stamp-today" onClick={() => { const s = todayStamp(); setDraft(s); void commit(s); }}>{t('look.stamp.today')}</button>
      <p id={hintId} className="muted pf-help" data-testid="effect-stamp-hint">{t('look.stamp.hint')}</p>
      {refusal && <p id={refusalId} className="danger" role="alert" data-testid="effect-stamp-refusal">{refusal}</p>}
    </div>
  );
}

/** Whether music with detected beats plays anywhere under the clip: what a beat modulator follows (core beatPositionAt, sampled over the clip). */
export function musicUnder(doc: ProjectDocument, clip: Clip, rate: T.Rate): boolean {
  const start = T.frameIndexAt(clip.start, rate), frames = Math.max(1, T.frameIndexAt(clip.duration, rate));
  for (let k = 0; k <= 8; k++) if (beatPositionAt(doc, T.frameTime(start + Math.min(frames - 1, Math.round((k * frames) / 8)), rate))) return true;
  return false;
}

/**
 * Commits an edit of the panel and gives back its refusal (null when it went through or nothing was refused). The refusal is
 * shown under the add-effect control unless `own` says the control shows it next to itself.
 */
type RunFx = (ops: OpCall[], label: string, own?: boolean) => Promise<string | null>;

function EffectRow({ clipId, fx, index, count, timeFirst, run }: { clipId: string; fx: EffectInstance; index: number; count: number; timeFirst: boolean; run: RunFx }) {
  const { editor, state, t } = useEditorState();
  const def = findEffect(fx.type);
  const props = propsOf(fx.type);
  const label = def ? def.name[state.lang] : fx.type;
  const animatable = new Set(animatableParams(fx.type));
  const clip = editor.doc ? findClip(editor.doc, clipId)?.clip : undefined;
  const inside = !!clip && T.lte(clip.start, editor.playhead) && T.lt(editor.playhead, clipEnd(clip));
  const local = clip ? T.frameTime(editor.frame - T.frameIndexAt(clip.start, editor.rate), editor.rate) : T.ZERO;
  const current = effectParamsAt(fx, local);
  const update = (args: Record<string, unknown>) => void run([{ op: 'update_effect', args: { clipId, effectId: fx.id, ...args } }], 'Update effect');
  // Time effects (ADR-0011): a time effect is always the first of its clip, so a move that would put another effect above it
  // is not offered (aria-disabled: still reachable, with the reason as its title).
  const time = isTimeEffect(fx.type);
  const upBlocked = timeFirst && index === 1, downBlocked = time && index === 0;
  const temporal = temporalOf(fx.type);
  const pictures = temporal && temporal.kind === 'taps' && temporal.decodes ? (fx.type === 'time.echo' ? Number(current.count ?? temporal.maxTaps) : temporal.maxTaps) : null;
  // Beat on a parameter (ADR-0011): the parameters this effect lets follow the beat, and whether analysed music plays under the clip
  const beatable = useMemo(() => new Set(modulatableParams(fx.type)), [fx.type]);
  const music = useMemo(() => (beatable.size > 0 && editor.doc && clip ? musicUnder(editor.doc, clip, editor.rate) : false), [beatable, editor.doc, clip, editor.rate]);
  const beatNoteId = useId();
  const setModulator = (param: string, modulator: { every: number; depth: number; decay: number } | null) => void run([{ op: 'set_effect_modulator', args: { clipId, effectId: fx.id, param, modulator } }], 'Beat on a parameter');
  const blockedTitle = t('look.time.first');
  // A row shows its parameters when it is the only one or the newest; in the "all tools" view every row does.
  const { flat } = useContext(SectionsContext);
  const [open, setOpen] = useState(flat || count <= 2 || index === count - 1);
  const bodyId = useId();
  const beats = Object.keys(fx.modulate ?? {}).length;
  return (
    <li className={`effect-row${time ? ' time-effect' : ''}${open ? ' is-open' : ''}`} data-testid="effect-row" data-effect-type={fx.type} data-effect-id={fx.id}>
      <div className="row effect-head">
        <label className="check fx-eye" title={t('look.effect.bypass')}>
          <input type="checkbox" checked={fx.enabled} data-testid="effect-enabled" aria-label={`${t('look.effect.bypass')}: ${label}`} onChange={(e) => update({ enabled: e.target.checked })} />
          {fx.enabled ? <Eye size={16} strokeWidth={1.75} aria-hidden="true" /> : <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />}
        </label>
        <button type="button" className="fx-name" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          <strong>{label}</strong>
          {beats > 0 && <span className="fx-beat" title={t('look.beat.toggle')}><IconOnBeat size={14} /></span>}
          <ChevronDown className="fx-chev" size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" className="ghost fx-act" data-testid="effect-up" disabled={index === 0} aria-disabled={upBlocked || undefined} aria-label={t('look.effect.up')} title={upBlocked ? blockedTitle : t('look.effect.up')} onClick={() => { if (!upBlocked) update({ index: index - 1 }); }}><ArrowUp size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        <button type="button" className="ghost fx-act" data-testid="effect-down" disabled={index === count - 1} aria-disabled={downBlocked || undefined} aria-label={t('look.effect.down')} title={downBlocked ? blockedTitle : t('look.effect.down')} onClick={() => { if (!downBlocked) update({ index: index + 1 }); }}><ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        <button type="button" className="ghost danger fx-act" data-testid="effect-remove" aria-label={t('look.effect.remove')} title={t('look.effect.remove')} onClick={() => void run([{ op: 'remove_effect', args: { clipId, effectId: fx.id } }], 'Remove effect')}><Trash2 size={14} strokeWidth={1.75} aria-hidden="true" /></button>
      </div>
      <div className="fields fx-body" id={bodyId} hidden={!open}>
        {pictures !== null && <p className="muted" data-testid="time-cost">{t('look.time.cost')} <bdi>{pictures}</bdi></p>}
        {fx.type === 'time.shutter' && <p className="muted" role="note" data-testid="time-note">{t('look.time.shutterNote')}</p>}
        {fx.type === 'time.stutter' && <p className="muted" role="note" data-testid="time-note">{t('look.time.stutterNote')}</p>}
        {Object.entries(props).map(([name, prop]) => {
          if (fx.type === 'color.lut' && name === 'lut') return <LutControl key={name} value={typeof fx.params.lut === 'string' ? fx.params.lut : ''} onCommit={(assetId) => update({ params: { lut: assetId } })} />;
          // life line (ADR-0021): the source, the clock and the date order of a date stamp are one control, not three generic ones
          if (fx.type === 'stylize.date-stamp' && STAMP_SOURCE_PARAMS.includes(name)) return name === 'source' ? <StampSource key={name} clipId={clipId} effectId={fx.id} /> : null;
          if (fx.type === 'stylize.date-stamp' && name === 'text') return <StampControl key={name} value={typeof fx.params.text === 'string' ? fx.params.text : String(prop.default ?? '')} onCommit={(text) => run([{ op: 'update_effect', args: { clipId, effectId: fx.id, params: { text } } }], 'Date stamp', true)} />;
          if (!animatable.has(name) || prop.type !== 'number') return <ParamControl key={name} name={name} prop={prop} effectType={fx.type} value={fx.params[name]} onCommit={(v) => update({ params: { [name]: v } })} />;
          const keys = fx.keyframes?.[name] ?? [];
          const animated = keys.length > 0;
          const hasKey = inside && keys.some((k) => T.eq(k.time, local));
          // Decisions are taken from live state, not from this render: the playhead when the control is used, and the
          // effect as it is when the edit's turn comes (after the user's own earlier, still queued edits).
          const liveLocal = () => { const c = editor.doc ? findClip(editor.doc, clipId)?.clip : undefined; return c && T.lte(c.start, editor.playhead) && T.lt(editor.playhead, clipEnd(c)) ? T.sub(editor.playhead, c.start) : null; };
          const liveFx = () => { const c = editor.doc ? findClip(editor.doc, clipId)?.clip : undefined; return c?.effects?.find((e) => e.id === fx.id); };
          const keyOp = (at: T.RationalTime, value: number) => ({ op: 'set_effect_keyframe', args: { clipId, effectId: fx.id, param: name, time: at, value } });
          const keyer: Keyer = {
            animated, pressed: hasKey, enabled: inside, title: t('cmd.keyframeAdd'), animatedTitle: t('keyframes.animated'), curve: { clipId, channel: { effectId: fx.id, param: name } },
            onToggle: () => {
              const at = liveLocal();
              if (!at) return;
              void editor.commit(() => {
                const cur = liveFx();
                if (!cur) return null;
                return cur.keyframes?.[name]?.some((k) => T.eq(k.time, at)) ? [{ op: 'delete_effect_keyframe', args: { clipId, effectId: fx.id, param: name, time: at } }] : [keyOp(at, Number(effectParamsAt(cur, at)[name]))];
              }, 'Effect keyframe');
            },
          };
          const range = beatable.has(name) ? paramRange(fx.type, name) : null;
          const beat: Beater | undefined = range ? { modulator: fx.modulate?.[name], music, noteId: beatNoteId, range, set: (m) => setModulator(name, m) } : undefined;
          return <ParamControl key={name} name={name} prop={prop} keyer={keyer} beat={beat} effectType={fx.type} value={animated ? current[name] : fx.params[name]}
            onCommit={(v) => {
              const at = liveLocal();
              void editor.commit(() => {
                const cur = liveFx();
                if (!cur) return null;
                if (!cur.keyframes?.[name]?.length) return [{ op: 'update_effect', args: { clipId, effectId: fx.id, params: { [name]: v } } }];
                return at ? [keyOp(at, Number(v))] : null;
              }, 'Effect parameter');
            }} />;
        })}
        {fx.params.follow === 'music' && editor.doc && !beatPositionAt(editor.doc, editor.playhead) && (
          <p className="muted" role="note" data-testid="effect-follow-note">{fx.type === 'light.strobe' ? STROBE_STRINGS[state.lang].noMusic
            : state.lang === 'he' ? 'אין כאן מוזיקה עם פעימות מזוהות, אז האפקט פועל בקצב הקבוע שלו. מנתחים פעימות בלשונית קליפ ← ניתוח, כשקליפ המוזיקה נבחר.' : 'No music with detected beats plays here, so the effect uses its own steady tempo. Detect beats in the Clip tab → Analysis with the music clip selected.'}</p>
        )}
        {beatable.size > 0 && !music && editor.doc && <p className="muted" role="note" id={beatNoteId} data-testid="effect-beat-note">{t('look.beat.noMusic')}</p>}
        {fx.type === 'light.strobe' && <p className="muted" role="note" data-testid="effect-strobe-limit">{STROBE_STRINGS[state.lang].limit}</p>}
      </div>
      {/* a separator that names the rule; its children are presentational, so the rule is its accessible name */}
      {time && index === 0 && <div className="time-separator" role="separator" data-testid="time-separator" aria-label={t('look.time.first')}>{t('look.time.first')}</div>}
    </li>
  );
}

function MaskControls({ clipId, mask }: { clipId: string; mask: Mask | undefined }) {
  const { editor, t } = useEditorState();
  const set = (m: Partial<Mask> | null) => void editor.commit([{ op: 'set_clip_mask', args: { clipId, mask: m } }], 'Mask');
  const m = mask ?? DEFAULT_MASK;
  const slider = (field: 'x' | 'y' | 'width' | 'height' | 'radius' | 'feather', min: number, max: number, step: number) => (
    <label key={`${field}:${m[field]}`}><span>{t(`look.mask.${field}` as Key)} <bdi className="val">{+m[field].toFixed(3)}</bdi></span>
      <input type="range" dir={field === 'x' || field === 'y' ? 'ltr' : undefined} min={min} max={max} step={step} defaultValue={m[field]} disabled={!mask} data-testid={`mask-${field}`}
        onPointerUp={(e) => Number(e.currentTarget.value) !== m[field] && set({ [field]: Number(e.currentTarget.value) })}
        onKeyUp={(e) => Number(e.currentTarget.value) !== m[field] && set({ [field]: Number(e.currentTarget.value) })} />
    </label>
  );
  return (
    <div className="fields" data-testid="mask-controls">
      <label className="check"><input type="checkbox" checked={!!mask} data-testid="mask-enabled" onChange={(e) => set(e.target.checked ? { ...DEFAULT_MASK } : null)} /> {t('look.mask.enabled')}</label>
      <label>{t('look.mask.shape')}
        <select value={m.shape} disabled={!mask} data-testid="mask-shape" onChange={(e) => set({ shape: e.target.value === 'ellipse' ? 'ellipse' : 'rect' })}>
          <option value="rect">{t('look.mask.rect')}</option><option value="ellipse">{t('look.mask.ellipse')}</option>
        </select>
      </label>
      {slider('x', -1, 1, 0.01)}
      {slider('y', -1, 1, 0.01)}
      {slider('width', 0.01, 2, 0.01)}
      {slider('height', 0.01, 2, 0.01)}
      {m.shape === 'rect' && slider('radius', 0, 1, 0.005)}
      {slider('feather', 0, 0.2, 0.001)}
      <label className="check"><input type="checkbox" checked={m.invert} disabled={!mask} data-testid="mask-invert" onChange={(e) => set({ invert: e.target.checked })} /> {t('look.mask.invert')}</label>
    </div>
  );
}

/** One option of set_transition_options: a value, or null to remove it (ADR-0012). */
type TransitionOptionArgs = Partial<{ sync: 'beat' | null; velocity: 2 | 3 | 4 | null; color: string | null; seed: number | null }>;
const VELOCITY_CHOICES = [2, 3, 4] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
/** A timecode inside a sentence of either direction: an isolated left-to-right run. */
const ltrRun = (s: string) => `\u2066${s}\u2069`;

/**
 * The options of the transition at the start of a picture clip (ADR-0012), each changed by one set_transition_options
 * commit: the beat lock with what it locks to, the velocity ramp with what each choice needs, the colour and seed of the types
 * that have them, and whether a light transition's light is shown or held by the timeline's flash schedule.
 */
function TransitionOptions({ clip, run, describedBy }: { clip: Extract<Clip, { type: 'media' }>; run: (args: TransitionOptionArgs, label: string) => void; describedBy: string | undefined }) {
  const { editor, state, t } = useEditorState();
  const tr = clip.transition!;
  const doc = editor.doc;
  const def = transitionDef(tr.type);
  const rate = editor.rate, fps = rate.num / rate.den, n = tr.frames;
  const syncNoteId = useId(), velocityNoteId = useId();
  // what the beat lock locks to: the frame of the beat nearest the middle of the window, or nothing (it then plays as usual)
  const k = useMemo(() => (doc && tr.sync ? beatSwitchFrame(doc, clip) : null), [doc, clip, tr.sync]);
  const syncText = !tr.sync ? '' : k === null ? t('look.transition.sync.none') : (() => {
    const frame = T.frameIndexAt(clip.start, rate) + k;
    return fillIn(t('look.transition.sync.locked'), { frame, time: ltrRun(T.toTimecode(T.frameTime(frame, rate), rate)) });
  })();
  // what the velocity ramp may be: the largest the source on both sides allows as the clips are now
  const limit = useMemo(() => (doc ? velocityLimit(doc, clip.id) : null), [doc, clip.id]);
  const maxVelocity = limit?.maxVelocity ?? 1;
  const needOf = (v: number) => { const need = velocityNeeds(n, v); return fillIn(t('look.transition.velocity.need'), { out: need.outFrames, head: need.headFrames }); };
  // a velocity a later trim, slip or speed change has outgrown: the ramp holds its first or last source frame (preflight warns)
  const outgrown = !!tr.velocity && tr.velocity > maxVelocity;
  const whyNone = maxVelocity === 1 && limit?.refusal ? translateRefusal(state.lang, limit.refusal) ?? limit.refusal : null;
  // a light transition's light (ADR-0012 under ADR-0009 decision 5): shown, or held after another flash
  const plan = def?.light && doc ? flashSchedule(doc).lights.get(clip.id) : undefined;
  const lightText = !plan ? '' : plan.kept ? t('look.transition.light.kept') : fillIn(t('look.transition.light.held'), { s: plan.since === null ? '0' : (plan.since / fps).toFixed(2) });
  const hasColor = !!def?.options.includes('color'), hasSeed = !!def?.options.includes('seed');
  const color = tr.color ?? def?.defaults?.color ?? null;
  const seed = tr.seed ?? def?.defaults?.seed ?? 0;
  const [hex, setHex] = useState(color ?? '');
  const [seedText, setSeedText] = useState(String(seed));
  useEffect(() => { setHex(color ?? ''); }, [color]);
  useEffect(() => { setSeedText(String(seed)); }, [seed]);
  // the colour picker commits when it is closed (its change event), not on every move inside it
  const picker = useRef<HTMLInputElement>(null);
  const colorRef = useRef(color);
  colorRef.current = color;
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => { const v = el.value.toUpperCase(); if (HEX.test(v) && v !== colorRef.current?.toUpperCase()) run({ color: v }, 'Transition colour'); };
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, [run]);
  const commitHex = (text: string) => {
    const v = text.trim().toUpperCase();
    if (v === '') { if (tr.color !== undefined) run({ color: null }, 'Transition colour'); return; } // empty: the type's own (none, or its default)
    if (HEX.test(v) && v !== color?.toUpperCase()) run({ color: v }, 'Transition colour');
  };
  const commitSeed = (text: string) => { const v = Math.round(Number(text)); if (text.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 9999 && v !== seed) run({ seed: v }, 'Transition variation'); };
  const hexValid = hex.trim() === '' || HEX.test(hex.trim());
  return (
    <fieldset className="transition-options" data-testid={TRANSITION_OPTION_TESTIDS.options}>
      <legend>{t('look.transition.options')}</legend>
      <label className="check">
        <input type="checkbox" checked={tr.sync === 'beat'} data-testid={TRANSITION_OPTION_TESTIDS.sync} aria-describedby={[syncNoteId, describedBy].filter(Boolean).join(' ') || undefined}
          onChange={(e) => run({ sync: e.target.checked ? 'beat' : null }, 'Transition beat lock')} /> {t('look.transition.sync')}
      </label>
      <p className="muted" role="status" id={syncNoteId} data-testid={TRANSITION_OPTION_TESTIDS.syncStatus}>{syncText}</p>
      <label>{t('look.transition.velocity')}
        <select value={tr.velocity ?? ''} data-testid={TRANSITION_OPTION_TESTIDS.velocity} aria-describedby={[outgrown || whyNone ? velocityNoteId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
          onChange={(e) => { const v = e.target.value === '' ? null : (Number(e.target.value) as 2 | 3 | 4); run({ velocity: v }, 'Transition velocity'); }}>
          <option value="">{t('look.transition.velocity.off')}</option>
          {VELOCITY_CHOICES.map((v) => <option key={v} value={v} disabled={v > maxVelocity}>{`×${v}`}{v > maxVelocity ? ` — ${needOf(v)}` : ''}</option>)}
        </select>
      </label>
      {(outgrown || whyNone) && <p className="muted danger" id={velocityNoteId} data-testid="transition-velocity-note">{outgrown ? `×${tr.velocity}: ${needOf(tr.velocity!)}` : whyNone}</p>}
      {hasColor && (
        <div className="transition-color">
          <label>{t('look.transition.color')}
            <input ref={picker} type="color" data-testid={TRANSITION_OPTION_TESTIDS.color} defaultValue={(color ?? '#FFFFFF').toLowerCase()} key={color ?? 'none'} aria-describedby={describedBy} />
          </label>
          <input type="text" dir="ltr" className="transition-hex" data-testid="transition-color-hex" aria-label={`${t('look.transition.color')} (#RRGGBB)`} value={hex} placeholder={def?.defaults?.color ?? '#RRGGBB'}
            spellCheck={false} autoComplete="off" aria-invalid={!hexValid} aria-describedby={describedBy}
            onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitHex(e.currentTarget.value); }} onBlur={(e) => commitHex(e.currentTarget.value)} />
        </div>
      )}
      {hasSeed && (
        <div className="transition-seed">
          <label>{t('look.transition.seed')}
            <input type="number" dir="ltr" min={0} max={9999} step={1} value={seedText} data-testid={TRANSITION_OPTION_TESTIDS.seed} aria-describedby={describedBy}
              onChange={(e) => setSeedText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') commitSeed(e.currentTarget.value); }} onBlur={(e) => commitSeed(e.currentTarget.value)} />
          </label>
          <button type="button" className="ghost" data-testid={TRANSITION_OPTION_TESTIDS.shuffle} aria-describedby={describedBy} onClick={() => run({ seed: (seed + 1) % 10000 }, 'Transition variation')}>{t('look.transition.shuffle')}</button>
        </div>
      )}
      {def?.light && <p className="muted" role="status" data-testid={TRANSITION_OPTION_TESTIDS.lightStatus}>{lightText}</p>}
    </fieldset>
  );
}

function TransitionControls({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, state, t } = useEditorState();
  const tr = clip.transition;
  const [frames, setFrames] = useState(String(tr?.frames ?? 15));
  const n = Math.round(Number(frames));
  const valid = Number.isFinite(n) && n >= 1 && n <= 150;
  // a refusal of an edit made here is shown here, in a live region the controls point to (the pattern of the look panel)
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalId = useId();
  const commitOps = async (ops: OpCall[], label: string) => { const r = await editor.commit(ops, label); setRefusal(r ? null : editor.getState().error); };
  const commit = (type: string | null, f: number) => void commitOps([{ op: 'set_transition', args: { clipId: clip.id, type, frames: f } }], 'Transition');
  const setOptions = (args: TransitionOptionArgs, label: string) => void commitOps([{ op: 'set_transition_options', args: { clipId: clip.id, ...args } }], label);
  const describedBy = refusal ? refusalId : undefined;
  return (
    <div className="fields" data-testid="transition-controls">
      <label>{t('look.transition.type')}
        <select value={tr?.type ?? 'none'} data-testid="transition-type" aria-describedby={describedBy} onChange={(e) => (e.target.value === 'none' ? commit(null, n) : valid && commit(e.target.value, n))}>
          <option value="none">{t('look.transition.none')}</option>
          {TRANSITION_CATEGORIES.map((c) => (
            <optgroup key={c} label={t(`look.trcat.${c}` as Key)}>
              {TRANSITIONS.filter((x) => x.category === c).map((x) => <option key={x.id} value={x.id} disabled={x.gpu && !state.gpu?.available}>{x.name[state.lang]}{x.gpu && !state.gpu?.available ? ` — ${t('look.gpu.needed')}` : ''}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label>{t('look.transition.frames')}
        <input type="number" min={1} max={150} step={1} value={frames} data-testid="transition-frames" aria-invalid={!valid} aria-describedby={describedBy}
          onChange={(e) => setFrames(e.target.value)}
          onBlur={() => { if (tr && valid && n !== tr.frames) commit(tr.type, n); }} />
      </label>
      <p className="muted pf-help">{t('look.transition.note')}</p>
      {tr && <TransitionOptions clip={clip} run={setOptions} describedBy={describedBy} />}
      {refusal && <p id={refusalId} className="danger" role="alert" data-testid="transition-refusal">{refusal}</p>}
    </div>
  );
}

/** Whether a clip takes a look at all, and what the panel around it shares: where a look goes, and the refusal of the last edit. */
export interface LookState {
  clip: Clip;
  trackKind: string;
  adjustment: boolean;
  applyTo: ApplyTo;
  setApplyTo: (v: ApplyTo) => void;
  toEdit: boolean;
  refusal: string | null;
  refusalId: string;
  editStatus: string | null;
  run: RunFx;
  toWholeEdit: (pick: WholeEditPick) => Promise<void>;
}
/**
 * The state the look controls of one clip share, wherever the inspector shows them (the colour tab and the effects tab):
 * whether a look goes on this clip or, through an adjustment layer, on the whole edit; and the refusal of the last edit made
 * here, worded in the interface language (store.ts fail), which the controls point to.
 */
export function useLook(clip: Clip, trackKind: string): LookState {
  const { editor, state } = useEditorState();
  const adjustment = clip.type === 'adjustment';
  const A = ADJUST_STRINGS[state.lang];
  const [applyTo, setApply] = useState<ApplyTo>('clip');
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalId = useId();
  const run: RunFx = async (ops, label, own = false) => {
    const r = await editor.commit(ops, label);
    const why = r ? null : editor.getState().error;
    setRefusal(own ? null : why);
    return why;
  };
  const toWholeEdit = async (pick: WholeEditPick) => {
    const r = await editor.applyToWholeEdit(pick);
    setRefusal(r ? null : editor.getState().error);
    setEditStatus(r ? A.appliedToEdit : null);
  };
  return { clip, trackKind, adjustment, applyTo, setApplyTo: (v) => { setApply(v); setEditStatus(null); }, toEdit: !adjustment && applyTo === 'edit', refusal, refusalId, editStatus, run, toWholeEdit };
}

/** "This clip / the whole edit", the gallery button and what an adjustment layer says about itself: the head of the effects tab. */
export function LookTarget({ look }: { look: LookState }) {
  const { editor, state } = useEditorState();
  const A = ADJUST_STRINGS[state.lang];
  const { clip, adjustment, toEdit } = look;
  const whole = state.doc ? wholeEditAdjustment(state.doc) : null;
  return (
    <div className="look-target">
      {adjustment && <p className="muted pf-help" role="note" data-testid="adjust-note">{A.adjustNote}</p>}
      {!adjustment && clip.type !== 'caption' && <ApplyToGroup value={look.applyTo} onChange={look.setApplyTo} />}
      <EffectGalleryButton clip={clip} trackKind={look.trackKind} applyTo={adjustment ? 'clip' : look.applyTo} onApplyTo={look.setApplyTo} />
      {toEdit && whole && (
        <p className="row">
          <button type="button" className="ghost" data-testid="adjust-select" onClick={() => editor.select(whole.clip.id)}>{A.showAdjustment}</button>
        </p>
      )}
      {toEdit && look.editStatus && <p className="muted" role="status" data-testid="adjust-status">{look.editStatus}</p>}
    </div>
  );
}

/**
 * The same "this clip / the whole edit" choice as the effects tab's, at the head of the colour tab, so a ready look never
 * changes the whole edit without the tab saying so; and what the last look applied from here did (or why it was refused).
 * The manual sliders below always act on the clip, which the note under "the whole edit" says.
 */
export function LookTargetLine({ look }: { look: LookState }) {
  const { editor, state } = useEditorState();
  const A = ADJUST_STRINGS[state.lang];
  const whole = state.doc ? wholeEditAdjustment(state.doc) : null;
  const refusalId = useId();
  if (look.adjustment || look.clip.type === 'caption') return null;
  return (
    <div className="look-target-line" data-testid="colour-apply-to">
      <span className="look-target-label">{A.applyTo}</span>
      <Seg label={A.applyTo} size="sm" value={look.applyTo} onChange={(v) => look.setApplyTo(v as ApplyTo)}
        options={[{ value: 'clip', label: A.applyToClip, testId: 'colour-apply-clip' }, { value: 'edit', label: A.applyToEdit, testId: 'colour-apply-edit' }]} />
      {look.toEdit && <p className="muted pf-help">{A.looksOnEditNote}</p>}
      {look.toEdit && look.editStatus && <p className="muted" role="status" data-testid="colour-apply-status">{look.editStatus} {whole && <button type="button" className="ghost" onClick={() => editor.select(whole.clip.id)}>{A.showAdjustment}</button>}</p>}
      {look.refusal && <p id={refusalId} className="danger" role="alert" data-testid="colour-refusal">{look.refusal}</p>}
    </div>
  );
}

/** The effect stack of a clip: its rows in order, the notice of a missing graphics adapter, and "add an effect". */
export function EffectsBlock({ look }: { look: LookState }) {
  const { state, t } = useEditorState();
  const { clip, adjustment, toEdit, refusal, refusalId, run } = look;
  const A = ADJUST_STRINGS[state.lang];
  const effects = clip.type === 'caption' ? [] : clip.effects ?? [];
  /** Why this effect cannot be picked here: an adjustment (this clip, or the whole-edit layer) refuses time effects, the chroma key and the shadow. */
  const refusedHere = (type: string) => (adjustment || toEdit ? adjustmentRefusal(type) : null);
  const timeFirst = effects.length > 0 && isTimeEffect(effects[0]!.type);
  return (
    <div className="fields effects-block">
      {effects.length === 0 ? <p className="muted fx-empty">{t('look.effects.none')}</p> : (
        <ul className="effect-list" data-testid="effect-list">
          {effects.map((fx, i) => <EffectRow key={fx.id} clipId={clip.id} fx={fx} index={i} count={effects.length} timeFirst={timeFirst} run={run} />)}
        </ul>
      )}
      {(effects.some((fx) => GPU_EFFECT_IDS.includes(fx.type)) || (clip.type === 'media' && !!clip.transition && GPU_TRANSITION_IDS.includes(clip.transition.type))) && !state.gpu?.available && state.gpu && (
        <p className="muted danger" role="status" data-testid="gpu-unavailable">{t('look.gpu.unavailable')} <bdi>{state.gpu.reason}</bdi></p>
      )}
      <div className="fx-add">
        <label className="sr-only" htmlFor="look-effect-add">{t('look.effect.add')}</label>
        <select id="look-effect-add" data-testid="effect-add" value="" aria-describedby={refusal ? refusalId : undefined} onChange={(e) => { const type = e.target.value; if (!type) return; if (toEdit) void look.toWholeEdit({ kind: 'effect', type }); else void run([{ op: 'add_effect', args: { clipId: clip.id, type } }], 'Add effect'); }}>
          <option value="">+ {t('look.effect.add')}</option>
          {CATEGORIES.map((c) => (
            <optgroup key={c} label={t(`look.cat.${c}` as Key)}>
              {PICKABLE_EFFECTS.filter((e) => e.category === c).map((e) => { /* a living picture: the Motion tab (opOnlyEffect) */
                const noGpu = e.cost === 'gpu' && !state.gpu?.available, refused = !!refusedHere(e.id);
                return <option key={e.id} value={e.id} disabled={noGpu || refused}>{e.name[state.lang]}{refused ? ` — ${A.notOnAdjustment}` : noGpu ? ` — ${t('look.gpu.needed')}` : ''}</option>;
              })}
            </optgroup>
          ))}
        </select>
      </div>
      {refusal && <p id={refusalId} className="danger" role="alert" data-testid="look-refusal">{refusal}</p>}
    </div>
  );
}

/** "Apply a ready colour look": the catalogue of looks, for this clip or (through an adjustment layer) the whole edit. */
export function LooksField({ look }: { look: LookState }) {
  const { editor, state, t } = useEditorState();
  const { clip, toEdit } = look;
  return (
    <label className="looks-field">{t('look.looks')}
      <select data-testid="look-apply" value="" disabled={!state.gpu?.available} title={state.gpu?.available ? t('look.looks.hint') : t('look.gpu.needed')} onChange={(e) => { const lookId = e.target.value; if (!lookId) return; if (toEdit) void look.toWholeEdit({ kind: 'look', lookId }); else void look.run([{ op: 'apply_look', args: { clipId: clip.id, lookId } }], 'Apply colour look'); }}>
        <option value="">{state.gpu?.available ? t('look.looks.pick') : `${t('look.looks.pick')} — ${t('look.gpu.needed')}`}</option>
        {COLOR_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name[state.lang]}</option>)}
      </select>
    </label>
  );
}

/** How the clip is mixed with what lies under it. */
export function BlendField({ clip }: { clip: Clip }) {
  const { editor, state, t } = useEditorState();
  const blend = clip.type === 'caption' ? 'normal' : clip.blend ?? 'normal';
  return (
    <label className="blend-field">{t('look.blend')}
      <select value={blend} data-testid="blend-mode" onChange={(e) => void editor.commit([{ op: 'set_clip_blend', args: { clipId: clip.id, mode: e.target.value } }], 'Blend mode')}>
        {BLEND_MODES.map((m) => <option key={m} value={m}>{INSPECTOR_STRINGS[state.lang].blend[m] ?? m}</option>)}
      </select>
    </label>
  );
}
export { MaskControls, TransitionControls };
export const LOOK_CATALOG_COUNTS = { looks: COLOR_LOOKS.length, effects: EFFECTS.length, transitions: TRANSITIONS.length } as const;
