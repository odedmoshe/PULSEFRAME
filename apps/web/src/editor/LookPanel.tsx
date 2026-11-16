import { useState } from 'react';
import * as T from '@pulseframe/time';
import { beatPositionAt, BLEND_MODES, COLOR_LOOKS, DEFAULT_MASK, EFFECTS, GPU_EFFECT_IDS, GPU_TRANSITION_IDS, describeCatalog, TRANSITIONS, findEffect, animatableParams, effectParamsAt, findClip, clipEnd, type Clip, type EffectInstance, type Mask } from '@pulseframe/core';
import { effectOptionLabel, effectParamLabel, type Key } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import { EffectGalleryButton } from './EffectGallery.tsx';

type Prop = { type?: string; minimum?: number; maximum?: number; enum?: string[]; pattern?: string; default?: unknown };
type Params = Record<string, number | string | boolean>;
const CATEGORIES = ['color', 'blur', 'light', 'stylize', 'digital', 'key', 'distort', 'motion'] as const;
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
function ParamControl({ name, prop, value, onCommit, keyer }: { name: string; prop: Prop; value: number | string | boolean | undefined; onCommit: (v: number | string) => void; keyer?: Keyer }) {
  const [live, setLive] = useState<number | null>(null);
  const { state } = useEditorState();
  const shown = effectParamLabel(name, state.lang);
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
    return (
      <div className="effect-param-row">
        {slider}
        <button type="button" className="ghost effect-key" data-testid="effect-key" data-param={name} aria-pressed={keyer.pressed} disabled={!keyer.enabled} title={keyer.title} aria-label={`${keyer.title}: ${name}`} onClick={keyer.onToggle}>◆</button>
      </div>
    );
  }
  return null;
}

function EffectRow({ clipId, fx, index, count }: { clipId: string; fx: EffectInstance; index: number; count: number }) {
  const { editor, state, t } = useEditorState();
  const def = findEffect(fx.type);
  const props = propsOf(fx.type);
  const label = def ? def.name[state.lang] : fx.type;
  const animatable = new Set(animatableParams(fx.type));
  const clip = editor.doc ? findClip(editor.doc, clipId)?.clip : undefined;
  const inside = !!clip && T.lte(clip.start, editor.playhead) && T.lt(editor.playhead, clipEnd(clip));
  const local = clip ? T.frameTime(editor.frame - T.frameIndexAt(clip.start, editor.rate), editor.rate) : T.ZERO;
  const current = effectParamsAt(fx, local);
  const update = (args: Record<string, unknown>) => void editor.commit([{ op: 'update_effect', args: { clipId, effectId: fx.id, ...args } }], 'Update effect');
  return (
    <li className="effect-row" data-testid="effect-row" data-effect-type={fx.type} data-effect-id={fx.id}>
      <div className="row effect-head">
        <label className="check"><input type="checkbox" checked={fx.enabled} data-testid="effect-enabled" aria-label={`${t('look.effect.bypass')}: ${label}`} onChange={(e) => update({ enabled: e.target.checked })} /> <strong>{label}</strong></label>
        <span className="spacer" />
        <button type="button" className="ghost" data-testid="effect-up" disabled={index === 0} aria-label={t('look.effect.up')} title={t('look.effect.up')} onClick={() => update({ index: index - 1 })}>↑</button>
        <button type="button" className="ghost" data-testid="effect-down" disabled={index === count - 1} aria-label={t('look.effect.down')} title={t('look.effect.down')} onClick={() => update({ index: index + 1 })}>↓</button>
        <button type="button" className="ghost danger" data-testid="effect-remove" aria-label={t('look.effect.remove')} title={t('look.effect.remove')} onClick={() => void editor.commit([{ op: 'remove_effect', args: { clipId, effectId: fx.id } }], 'Remove effect')}>×</button>
      </div>
      <div className="fields">
        {Object.entries(props).map(([name, prop]) => {
          if (!animatable.has(name) || prop.type !== 'number') return <ParamControl key={name} name={name} prop={prop} value={fx.params[name]} onCommit={(v) => update({ params: { [name]: v } })} />;
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
          return <ParamControl key={name} name={name} prop={prop} keyer={keyer} value={animated ? current[name] : fx.params[name]}
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
          <p className="muted" role="note" data-testid="effect-follow-note">{state.lang === 'he' ? 'אין כאן מוזיקה עם פעימות מזוהות, אז האפקט פועל בקצב הקבוע שלו. מנתחים פעימות בלשונית קליפ ← ניתוח, כשקליפ המוזיקה נבחר.' : 'No music with detected beats plays here, so the effect uses its own steady tempo. Detect beats in the Clip tab → Analysis with the music clip selected.'}</p>
        )}
      </div>
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
  return (
    <div className="look-panel" data-testid="look-panel">
      <h3>{t('look')}</h3>
      <EffectGalleryButton clip={clip} trackKind={trackKind} />
      <div className="fields">
        <h4>{t('look.effects')}</h4>
        {effects.length === 0 ? <p className="muted">{t('look.effects.none')}</p> : (
          <ul className="effect-list" data-testid="effect-list">
            {effects.map((fx, i) => <EffectRow key={fx.id} clipId={clip.id} fx={fx} index={i} count={effects.length} />)}
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
        <select id="look-effect-add" data-testid="effect-add" value="" onChange={(e) => { const type = e.target.value; if (type) void editor.commit([{ op: 'add_effect', args: { clipId: clip.id, type } }], 'Add effect'); }}>
          <option value="">{t('look.effect.add')}</option>
          {CATEGORIES.map((c) => (
            <optgroup key={c} label={t(`look.cat.${c}` as Key)}>
              {EFFECTS.filter((e) => e.category === c).map((e) => <option key={e.id} value={e.id} disabled={e.cost === 'gpu' && !state.gpu?.available}>{e.name[state.lang]}{e.cost === 'gpu' && !state.gpu?.available ? ` — ${t('look.gpu.needed')}` : ''}</option>)}
            </optgroup>
          ))}
        </select>
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
