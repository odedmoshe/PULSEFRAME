import { useEffect, useId, useMemo, useRef, useState } from 'react';
import * as T from '@pulseframe/time';
import { beatPositionAt, BLEND_MODES, COLOR_LOOKS, DEFAULT_MASK, EFFECTS, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, describeCatalog, TRANSITIONS, findEffect, animatableParams, effectParamsAt, findClip, clipEnd, lutAssets, isTimeEffect, temporalOf, modulatableParams, paramRange, type Clip, type EffectInstance, type Mask, type Modulator, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { effectOptionLabel, effectParamLabel, type Key } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { EffectGalleryButton } from './EffectGallery.tsx';

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
interface Keyer { animated: boolean; pressed: boolean; enabled: boolean; title: string; animatedTitle: string; onToggle: () => void }
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
      <p className="muted">{t('look.beat.note')}</p>
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
      <label><span><bdi>{shown}</bdi>{keyer?.animated && <em className="animated" data-testid="effect-animated" title={keyer.animatedTitle}>◆</em>}<bdi className="val">{+(live ?? Number(cur)).toFixed(4)}</bdi></span>
        <input {...tid} type="range" min={min} max={max} step={stepOf(min, max)} defaultValue={Number(cur)} key={String(cur)}
          onInput={(e) => setLive(Number(e.currentTarget.value))} onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} />
      </label>
    );
    if (!keyer) return slider;
    const row = (
      <div className="effect-param-row">
        {slider}
        <button type="button" className="ghost effect-key" data-testid="effect-key" data-param={name} aria-pressed={keyer.pressed} disabled={!keyer.enabled} title={keyer.title} aria-label={`${keyer.title}: ${name}`} onClick={keyer.onToggle}>◆</button>
        {beat && (
          <button type="button" className="ghost effect-beat" data-testid="beat-toggle" data-param={name} aria-pressed={!!beat.modulator}
            disabled={!beat.modulator && !beat.music} aria-describedby={!beat.music ? beat.noteId : undefined}
            aria-label={`${t('look.beat.toggle')} ${shown}`} title={`${t('look.beat.toggle')} ${shown}`}
            onClick={() => beat.set(beat.modulator ? null : BEAT_DEFAULT(beat.range))}>♪</button>
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
 * flashes from one schedule, which starts at most three flashes in any second, so with several strobes, or with fast music,
 * some flashes are left out; a strobe that follows the music flashes on analysed beats only, so it shows nothing where no
 * analysed music plays (other effects fall back to their own tempo there).
 */
const STROBE_STRINGS = {
  he: {
    limit: 'מגבלת בטיחות לכל ציר הזמן: בכל שנייה מתחילים לכל היותר שלושה הבזקים, מכל אפקטי ההבזקים יחד. לכן, כשיש כמה אפקטים כאלה או מוזיקה מהירה, חלק מההבזקים לא יופיעו.',
    noMusic: 'אין כאן מוזיקה עם פעימות מזוהות, ולכן לא יופיעו כאן הבזקים. מנתחים פעימות בלשונית קליפ ← ניתוח, כשקליפ המוזיקה נבחר.',
  },
  en: {
    limit: 'Safety limit for the whole timeline: at most three flashes start in any second, from all strobes together. So with several strobes, or with fast music, some flashes are left out.',
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
      <label><span><bdi>{effectParamLabel('lut', state.lang)}</bdi></span>
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
      <p id={hintId} className="muted" data-testid="effect-stamp-hint">{t('look.stamp.hint')}</p>
      {refusal && <p id={refusalId} className="danger" role="alert" data-testid="effect-stamp-refusal">{refusal}</p>}
    </div>
  );
}

/** Whether music with detected beats plays anywhere under the clip: what a beat modulator follows (core beatPositionAt, sampled over the clip). */
function musicUnder(doc: ProjectDocument, clip: Clip, rate: T.Rate): boolean {
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
  return (
    <li className={`effect-row${time ? ' time-effect' : ''}`} data-testid="effect-row" data-effect-type={fx.type} data-effect-id={fx.id}>
      <div className="row effect-head">
        <label className="check"><input type="checkbox" checked={fx.enabled} data-testid="effect-enabled" aria-label={`${t('look.effect.bypass')}: ${label}`} onChange={(e) => update({ enabled: e.target.checked })} /> <strong>{label}</strong></label>
        <span className="spacer" />
        <button type="button" className="ghost" data-testid="effect-up" disabled={index === 0} aria-disabled={upBlocked || undefined} aria-label={t('look.effect.up')} title={upBlocked ? blockedTitle : t('look.effect.up')} onClick={() => { if (!upBlocked) update({ index: index - 1 }); }}>↑</button>
        <button type="button" className="ghost" data-testid="effect-down" disabled={index === count - 1} aria-disabled={downBlocked || undefined} aria-label={t('look.effect.down')} title={downBlocked ? blockedTitle : t('look.effect.down')} onClick={() => { if (!downBlocked) update({ index: index + 1 }); }}>↓</button>
        <button type="button" className="ghost danger" data-testid="effect-remove" aria-label={t('look.effect.remove')} title={t('look.effect.remove')} onClick={() => void run([{ op: 'remove_effect', args: { clipId, effectId: fx.id } }], 'Remove effect')}>×</button>
      </div>
      <div className="fields">
        {pictures !== null && <p className="muted" data-testid="time-cost">{t('look.time.cost')} <bdi>{pictures}</bdi></p>}
        {fx.type === 'time.shutter' && <p className="muted" role="note" data-testid="time-note">{t('look.time.shutterNote')}</p>}
        {fx.type === 'time.stutter' && <p className="muted" role="note" data-testid="time-note">{t('look.time.stutterNote')}</p>}
        {Object.entries(props).map(([name, prop]) => {
          if (fx.type === 'color.lut' && name === 'lut') return <LutControl key={name} value={typeof fx.params.lut === 'string' ? fx.params.lut : ''} onCommit={(assetId) => update({ params: { lut: assetId } })} />;
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
            animated, pressed: hasKey, enabled: inside, title: t('cmd.keyframeAdd'), animatedTitle: t('keyframes.animated'),
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
      <input type="range" min={min} max={max} step={step} defaultValue={m[field]} disabled={!mask} data-testid={`mask-${field}`}
        onPointerUp={(e) => Number(e.currentTarget.value) !== m[field] && set({ [field]: Number(e.currentTarget.value) })}
        onKeyUp={(e) => Number(e.currentTarget.value) !== m[field] && set({ [field]: Number(e.currentTarget.value) })} />
    </label>
  );
  return (
    <div className="fields" data-testid="mask-controls">
      <h3>{t('look.mask')}</h3>
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

function TransitionControls({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  const { editor, state, t } = useEditorState();
  const tr = clip.transition;
  const [frames, setFrames] = useState(String(tr?.frames ?? 15));
  const n = Math.round(Number(frames));
  const valid = Number.isFinite(n) && n >= 1 && n <= 150;
  const commit = (type: string | null, f: number) => void editor.commit([{ op: 'set_transition', args: { clipId: clip.id, type, frames: f } }], 'Transition');
  return (
    <div className="fields" data-testid="transition-controls">
      <h3>{t('look.transition')}</h3>
      <label>{t('look.transition.type')}
        <select value={tr?.type ?? 'none'} data-testid="transition-type" onChange={(e) => (e.target.value === 'none' ? commit(null, n) : valid && commit(e.target.value, n))}>
          <option value="none">{t('look.transition.none')}</option>
          {TRANSITIONS.map((x) => <option key={x.id} value={x.id} disabled={x.gpu && !state.gpu?.available}>{x.name[state.lang]}{x.gpu && !state.gpu?.available ? ` — ${t('look.gpu.needed')}` : ''}</option>)}
        </select>
      </label>
      <label>{t('look.transition.frames')}
        <input type="number" min={1} max={150} step={1} value={frames} data-testid="transition-frames" aria-invalid={!valid}
          onChange={(e) => setFrames(e.target.value)}
          onBlur={() => { if (tr && valid && n !== tr.frames) commit(tr.type, n); }} />
      </label>
      <p className="muted">{t('look.transition.note')}</p>
    </div>
  );
}

export function LookPanel({ clip, trackKind }: { clip: Clip; trackKind: string }) {
  const { editor, state, t } = useEditorState();
  const effects = clip.type === 'caption' ? [] : clip.effects ?? [];
  const blend = clip.type === 'caption' ? 'normal' : clip.blend ?? 'normal';
  const media = clip.type === 'media' && trackKind === 'video';
  const timeFirst = effects.length > 0 && isTimeEffect(effects[0]!.type);
  // A refusal of an edit made here is shown here too (besides the editor's error bar), in the interface language: the editor
  // words the server's refusal with translateRefusal (store.ts fail).
  const [refusal, setRefusal] = useState<string | null>(null);
  const refusalId = useId();
  const run: RunFx = async (ops, label, own = false) => {
    const r = await editor.commit(ops, label);
    const why = r ? null : editor.getState().error;
    setRefusal(own ? null : why);
    return why;
  };
  return (
    <div className="look-panel" data-testid="look-panel">
      <h3>{t('look')}</h3>
      <EffectGalleryButton clip={clip} trackKind={trackKind} />
      <div className="fields">
        <h4>{t('look.effects')}</h4>
        {effects.length === 0 ? <p className="muted">{t('look.effects.none')}</p> : (
          <ul className="effect-list" data-testid="effect-list">
            {effects.map((fx, i) => <EffectRow key={fx.id} clipId={clip.id} fx={fx} index={i} count={effects.length} timeFirst={timeFirst} run={run} />)}
          </ul>
        )}
        {(effects.some((fx) => GPU_EFFECT_IDS.includes(fx.type)) || (clip.type === 'media' && !!clip.transition && GPU_TRANSITION_IDS.includes(clip.transition.type))) && !state.gpu?.available && state.gpu && (
          <p className="muted danger" role="status" data-testid="gpu-unavailable">{t('look.gpu.unavailable')} <bdi>{state.gpu.reason}</bdi></p>
        )}
        <label>{t('look.looks')}
          <select data-testid="look-apply" value="" disabled={!state.gpu?.available} title={state.gpu?.available ? t('look.looks.hint') : t('look.gpu.needed')} onChange={(e) => { const lookId = e.target.value; if (lookId) void editor.commit([{ op: 'apply_look', args: { clipId: clip.id, lookId } }], 'Apply colour look'); }}>
            <option value="">{state.gpu?.available ? t('look.looks.pick') : `${t('look.looks.pick')} — ${t('look.gpu.needed')}`}</option>
            {COLOR_LOOKS.map((l) => <option key={l.id} value={l.id}>{l.name[state.lang]}</option>)}
          </select>
        </label>
        <label className="sr-only" htmlFor="look-effect-add">{t('look.effect.add')}</label>
        <select id="look-effect-add" data-testid="effect-add" value="" aria-describedby={refusal ? refusalId : undefined} onChange={(e) => { const type = e.target.value; if (type) void run([{ op: 'add_effect', args: { clipId: clip.id, type } }], 'Add effect'); }}>
          <option value="">{t('look.effect.add')}</option>
          {CATEGORIES.map((c) => (
            <optgroup key={c} label={t(`look.cat.${c}` as Key)}>
              {EFFECTS.filter((e) => e.category === c).map((e) => <option key={e.id} value={e.id} disabled={e.cost === 'gpu' && !state.gpu?.available}>{e.name[state.lang]}{e.cost === 'gpu' && !state.gpu?.available ? ` — ${t('look.gpu.needed')}` : ''}</option>)}
            </optgroup>
          ))}
        </select>
        {refusal && <p id={refusalId} className="danger" role="alert" data-testid="look-refusal">{refusal}</p>}
        <label>{t('look.blend')}
          <select value={blend} data-testid="blend-mode" onChange={(e) => void editor.commit([{ op: 'set_clip_blend', args: { clipId: clip.id, mode: e.target.value } }], 'Blend mode')}>
            {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
      {media && clip.type === 'media' && <MaskControls key={`mask:${clip.id}`} clipId={clip.id} mask={clip.mask} />}
      {media && clip.type === 'media' && <TransitionControls key={`tr:${clip.id}:${clip.transition?.type ?? ''}:${clip.transition?.frames ?? ''}`} clip={clip} />}
    </div>
  );
}
