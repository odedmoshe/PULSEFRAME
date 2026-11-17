/**
 * «אפקטי קול»: the sound effects of one sound clip (ADR-0010; plan section 7). Character voices and spaces are chosen from chip rows
 * (radio groups with the arrow keys in visual order: in Hebrew ArrowLeft is the next chip), tones are toggles, and every effect on the
 * clip is listed in the fixed order it runs in, with its on/off switch, amount and settings. Every change is one committed
 * operation (or one transaction), so one undo takes it back. ▶ plays the clip with a choice applied to a scratch copy of the
 * document, made by the same operation a click would commit: it is only played, never stored, and the revision does not change.
 * Nothing here blinks, pulses or moves: playing and chosen states are a steady fill.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { applyTransaction, AUDIO_PRESETS, audioEffectParams, describeAudioCatalog, findAudioEffect, findClip, sortAudioFx, speedValue, type AudioFxInstance, type Clip, type OpCall, type ProjectDocument, type SoundTail } from '@pulseframe/core';
import { soundTailsOf } from '@pulseframe/engine';
import { audioFxOptionLabel, audioFxParamLabel, audioFxParamUnit } from '@pulseframe/i18n';
import { useEditorState } from './store.ts';
import './audioFx.css';

type SoundClip = Extract<Clip, { type: 'media' }>;
type Lang = 'he' | 'en';

/** Slider that shows its value live but commits once, when the gesture ends. The number sits in a left-to-right isolate; a unit, as a word, follows it. */
export function CommitSlider({ label, value, min, max, step, display, onCommit, testid, unit, ariaLabel, disabled }: { label: string; value: number; min: number; max: number; step: number; display: (v: number) => string; onCommit: (v: number) => void; testid: string; unit?: string; ariaLabel?: string; disabled?: boolean }) {
  const [v, setV] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { setV(value); dirty.current = false; }, [value]);
  const commit = (el: HTMLInputElement) => { if (!dirty.current) return; dirty.current = false; onCommit(Number(el.value)); };
  return (
    <label>
      <span>{label}<bdi className="val" dir="ltr">{display(v)}</bdi>{unit ? ` ${unit}` : ''}</span>
      <input type="range" min={min} max={max} step={step} value={v} data-testid={testid} aria-valuetext={`${display(v)}${unit ? ` ${unit}` : ''}`} aria-label={ariaLabel} disabled={disabled}
        onChange={(e) => { dirty.current = true; setV(Number(e.target.value)); }}
        onPointerUp={(e) => commit(e.currentTarget)} onKeyUp={(e) => commit(e.currentTarget)} onBlur={(e) => commit(e.currentTarget)} />
    </label>
  );
}

/** Parameter schemas of the sound effects (JSON Schema, as list_catalog gives them to agents). */
type ParamSchema = { type?: string; minimum?: number; maximum?: number; enum?: string[] };
const SCHEMAS = new Map(describeAudioCatalog().audioEffects.map((e) => [e.id, (e.paramsSchema as { properties: Record<string, ParamSchema> }).properties]));
const VOICES = ['voice.telephone', 'voice.megaphone', 'voice.radio', 'voice.robot'] as const;
const ROOMS = ['room', 'hall', 'cave', 'bathroom'] as const; // each is also a preset of the same id: its reverb settings
const TONES = ['tone.bassboost', 'texture.8bit', 'utility.width'] as const;
const NONE = 'none';
const nameOf = (type: string, lang: Lang) => findAudioEffect(type)?.name[lang] ?? type;
const isVoice = (f: { type: string }) => findAudioEffect(f.type)?.exclusive === 'voice';
const roomParams = (room: string) => audioEffectParams('space.reverb', AUDIO_PRESETS.find((p) => p.id === room)?.effects[0]?.params ?? { room });
/** Numbers as shown: 0–1 (and width 0–2) as a percentage, other values as they are, to at most two decimals. */
const showValue = (name: string, v: number) => (audioFxParamUnit(name, 'en') ? `${+v.toFixed(2)}` : `${Math.round(v * 100)}%`);
const stepOf = (s: ParamSchema) => (s.type === 'integer' ? 1 : (s.maximum ?? 1) - (s.minimum ?? 0) <= 1 ? 0.05 : (s.maximum ?? 1) - (s.minimum ?? 0) <= 3 ? 0.1 : 0.5);

/** Planned ring-out of each sound clip, from the engine's audio plan (the one the player and both exports use), once per document. */
const tailCache = new WeakMap<ProjectDocument, Map<string, SoundTail>>();
export function soundTailsFor(doc: ProjectDocument): Map<string, SoundTail> {
  let m = tailCache.get(doc);
  if (!m) { try { m = soundTailsOf(doc); } catch { m = new Map(); } tailCache.set(doc, m); }
  return m;
}

/**
 * Where a key moves the focus in a row of `count` chips, from chip `i`: the arrows follow the order the chips are seen in (in a
 * right-to-left row the next chip is to the left, so ArrowLeft goes to it), Up and Down go back and on, Home and End to the ends,
 * wrapping around. Null for any other key (Space and Enter are the button's own click: one commit).
 */
export function chipKeyTarget(key: string, i: number, count: number, rtl: boolean): number | null {
  const step = key === 'ArrowLeft' ? (rtl ? 1 : -1) : key === 'ArrowRight' ? (rtl ? -1 : 1) : key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : null;
  if (step !== null) return (i + step + count) % count;
  return key === 'Home' ? 0 : key === 'End' ? count - 1 : null;
}
/** Operations that give a clip the character voice `type` ('none' removes it): a voice that is there already is replaced in the same transaction, so one revision and one undo. */
export function voiceOps(clip: SoundClip, type: string): OpCall[] {
  const voice = (clip.audioFx ?? []).find(isVoice);
  if (type === (voice?.type ?? NONE)) return [];
  return [...(voice ? [removeOp(clip, voice)] : []), ...(type === NONE ? [] : [addOp(clip, type)])];
}
/** Operations that put a clip in one of the rooms (the reverb settings of the preset of that name), or take it out ('none'). */
export function roomOps(clip: SoundClip, room: string): OpCall[] {
  const reverb = (clip.audioFx ?? []).find((f) => f.type === 'space.reverb');
  if (room === NONE) return reverb ? [removeOp(clip, reverb)] : [];
  if (reverb?.params.room === room) return [];
  const params = roomParams(room);
  return [reverb ? { op: 'update_audio_effect', args: { clipId: clip.id, effectId: reverb.id, params } } : addOp(clip, 'space.reverb', params)];
}
/** An on/off effect (echo, bass boost, 8-bit, width): added with its defaults, or removed. */
export function toggleOps(clip: SoundClip, type: string): OpCall[] {
  const on = (clip.audioFx ?? []).find((f) => f.type === type);
  return [on ? removeOp(clip, on) : addOp(clip, type)];
}
const addOp = (clip: SoundClip, type: string, params?: Record<string, unknown>): OpCall => ({ op: 'add_audio_effect', args: { clipId: clip.id, type, includeLinked: false, ...(params ? { params } : {}) } });
const removeOp = (clip: SoundClip, fx: AudioFxInstance): OpCall => ({ op: 'remove_audio_effect', args: { clipId: clip.id, effectId: fx.id } });

/**
 * A row of chips as a radio group with a roving tab stop: Tab reaches the chosen chip, the arrow keys move between chips in the
 * order they are seen (chipKeyTarget), and Space or Enter commits the focused chip through the button's own click (moving
 * changes nothing). Each chip may have its own ▶ to listen to it first.
 */
function ChipGroup({ label, value, options, onCommit, listen, playing, disabled, testid }: {
  label: string; value: string; options: { value: string; name: string }[]; onCommit: (v: string) => void;
  listen?: (v: string) => void; playing: string | null; disabled: boolean; testid: string;
}) {
  const { t } = useEditorState();
  const labelId = useId();
  const chosen = Math.max(0, options.findIndex((o) => o.value === value));
  const [focus, setFocus] = useState(chosen);
  useEffect(() => setFocus(chosen), [chosen]);
  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const group = e.currentTarget.closest('[role=radiogroup]')!;
    const next = chipKeyTarget(e.key, i, options.length, getComputedStyle(group).direction === 'rtl');
    if (next === null) return;
    e.preventDefault();
    setFocus(next);
    group.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
  };
  return (
    <div className="afx-group">
      <span className="afx-group-label" id={labelId}>{label}</span>
      <div className="afx-chips" role="radiogroup" aria-labelledby={labelId} aria-disabled={disabled || undefined} data-testid={testid}>
        {options.map((o, i) => (
          <span className="afx-chip" role="none" key={o.value}>
            <button type="button" role="radio" aria-checked={o.value === value} tabIndex={i === focus ? 0 : -1} disabled={disabled} data-testid={`${testid}-${o.value}`} data-value={o.value}
              onClick={(e) => { setFocus(i); e.currentTarget.focus(); onCommit(o.value); }} onKeyDown={(e) => onKey(e, i)} onFocus={() => setFocus(i)}>
              <bdi>{o.name}</bdi>
            </button>
            {listen && (
              <button type="button" className="afx-listen" aria-pressed={playing === `${testid}:${o.value}`} disabled={disabled} data-testid={`${testid}-listen-${o.value}`}
                aria-label={`${t('sound.fx.listen')}: ${o.name} ${t('sound.fx.notSaved')}`} title={`${t('sound.fx.listen')}: ${o.name} ${t('sound.fx.notSaved')}`} onClick={() => listen(o.value)}>▶</button>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * One effect on the clip: on/off switch, its main amount, settings behind a disclosure, and removal. On a locked track nothing
 * can change; on a clip that cannot carry effects yet (`blocked`), an effect can still be changed, switched off or removed, but
 * not switched on (the operations say the same).
 */
function FxRow({ clip, fx, lang, locked, blocked, mono }: { clip: SoundClip; fx: AudioFxInstance; lang: Lang; locked: boolean; blocked: boolean; mono: boolean }) {
  const disabled = locked;
  const { editor, t } = useEditorState();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const name = nameOf(fx.type, lang);
  const schema = SCHEMAS.get(fx.type) ?? {};
  const main = 'amount' in schema ? 'amount' : 'stereoWidth' in schema ? 'stereoWidth' : null;
  const update = (args: Record<string, unknown>, label: string) => void editor.commit([{ op: 'update_audio_effect', args: { clipId: clip.id, effectId: fx.id, ...args } }], label);
  const setParam = (p: string, v: number | string | boolean) => update({ params: { [p]: v } }, 'Sound effect setting');
  const slider = (p: string, s: ParamSchema, testid: string) => (
    <CommitSlider key={p} label={audioFxParamLabel(p, lang)} value={Number(fx.params[p] ?? 0)} min={s.minimum ?? 0} max={s.maximum ?? 1} step={stepOf(s)} unit={audioFxParamUnit(p, lang) || undefined}
      ariaLabel={`${audioFxParamLabel(p, lang)}: ${name}`} display={(v) => showValue(p, v)} testid={testid} disabled={disabled} onCommit={(v) => setParam(p, v)} />
  );
  return (
    <li className="afx-row" data-testid="afx-row" data-type={fx.type} data-enabled={fx.enabled ? 'true' : 'false'}>
      <div className="afx-row-head">
        <span className="afx-name"><bdi>{name}</bdi></span>
        <button type="button" role="switch" className="afx-switch" aria-checked={fx.enabled} aria-label={`${t('sound.fx.on')}: ${name}`} disabled={locked || (blocked && !fx.enabled)} data-testid="afx-enabled"
          onClick={() => update({ enabled: !fx.enabled }, fx.enabled ? 'Sound effect off' : 'Sound effect on')}>
          <span className="afx-switch-track" aria-hidden="true" />{t('sound.fx.on')}
        </button>
        <button type="button" aria-expanded={open} aria-controls={panelId} aria-label={`${t('sound.fx.settings')}: ${name}`} data-testid="afx-settings" onClick={() => setOpen(!open)}>{t('sound.fx.settings')}</button>
        <button type="button" className="danger" disabled={disabled} data-testid="afx-remove" onClick={() => void editor.commit([{ op: 'remove_audio_effect', args: { clipId: clip.id, effectId: fx.id } }], 'Remove sound effect')}>{t('sound.fx.remove')} <bdi>{name}</bdi></button>
      </div>
      {main && schema[main] && slider(main, schema[main]!, 'afx-amount')}
      {fx.type === 'utility.width' && mono && <p className="muted afx-note" data-testid="afx-mono">{t('sound.fx.mono')}</p>}
      <div className="afx-params" id={panelId} hidden={!open}>
        {open && Object.entries(schema).filter(([p]) => p !== main).map(([p, s]) => {
          if (s.enum) return (
            <label key={p}>{audioFxParamLabel(p, lang)}
              <select value={String(fx.params[p])} disabled={disabled} data-testid={`afx-param-${p}`} onChange={(e) => setParam(p, e.target.value)}>
                {s.enum.map((o) => <option key={o} value={o}>{audioFxOptionLabel(o, lang)}</option>)}
              </select>
            </label>
          );
          if (s.type === 'boolean') return (
            <label key={p} className="check">
              <input type="checkbox" checked={fx.params[p] === true} disabled={disabled} data-testid={`afx-param-${p}`} onChange={(e) => setParam(p, e.target.checked)} /> {audioFxParamLabel(p, lang)}
            </label>
          );
          if (p === 'seed') return <SeedField key={p} label={audioFxParamLabel(p, lang)} value={Number(fx.params[p] ?? 1)} max={s.maximum ?? 1_000_000} disabled={disabled} onCommit={(v) => setParam(p, v)} />;
          return slider(p, s, `afx-param-${p}`);
        })}
      </div>
    </li>
  );
}

/** The noise pattern of a seeded effect: a whole number typed in, committed on Enter or when the field is left. */
function SeedField({ label, value, max, disabled, onCommit }: { label: string; value: number; max: number; disabled: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => { const n = Number(v); if (v === '' || !Number.isInteger(n) || n < 0 || n > max) { setV(String(value)); return; } if (n !== value) onCommit(n); };
  return (
    <label>{label}
      <input type="number" dir="ltr" min={0} max={max} step={1} value={v} disabled={disabled} data-testid="afx-param-seed" onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />
    </label>
  );
}

/** The sound effects of one sound clip (a clip on a sound track whose file has sound). */
export function AudioFxBlock({ clip, heading = 'h3' }: { clip: SoundClip; heading?: 'h3' | 'h4' }) {
  const { editor, state, t } = useEditorState();
  const doc = state.doc!;
  const lang: Lang = state.lang;
  const found = findClip(doc, clip.id);
  const [playing, setPlaying] = useState<string | null>(null);
  const [, rerender] = useState(0);
  useEffect(() => () => { editor.player?.stopAudition(); }, [editor, clip.id]); // leaving the clip stops what it was playing
  if (!found) return null;
  const list = sortAudioFx(clip.audioFx ?? []);
  const blocked = !!clip.speedEnd || (!!clip.keepPitch && speedValue(clip) !== 1); // wave-1 limit (ADR-0010 D7): the operations refuse it too
  const locked = found.track.locked;
  const disabled = blocked || locked;
  const voice = list.find(isVoice), reverb = list.find((f) => f.type === 'space.reverb'), echo = list.find((f) => f.type === 'space.echo');
  const mono = doc.assets[clip.assetId]?.audio?.channels === 1;
  const tail = soundTailsFor(doc).get(clip.id);
  const unavailable = editor.player?.unavailableAudioFx[clip.id];
  const bypass = !!editor.player?.bypassAudioFx;
  const commit = (ops: OpCall[], label: string) => { if (ops.length) void editor.commit(ops, label); };
  const toggle = (type: string) => commit(toggleOps(clip, type), list.some((f) => f.type === type) ? 'Remove sound effect' : 'Add sound effect');
  /** ▶: the clip alone, with `ops` applied to a scratch copy. A second press stops it. */
  const listen = async (key: string, ops: OpCall[]) => {
    const player = editor.player;
    if (!player) return;
    if (playing === key) { player.stopAudition(); setPlaying(null); return; }
    let draft = doc;
    if (ops.length) { try { draft = applyTransaction(doc, ops, { idSeed: 'listen_', actor: 'preview' }).doc; } catch (e) { editor.fail(e); return; } }
    player.stopAudition();
    setPlaying(key);
    try { await player.audition(draft, clip.id, 4); } catch (e) { editor.fail(e); } finally { setPlaying((cur) => (cur === key ? null : cur)); }
  };
  const track = found.track;
  const others = track.clips.filter((c) => c.type === 'media' && c.id !== clip.id && !!doc.assets[c.assetId]?.audio).map((c) => c.id).slice(0, 200);
  const H = heading;
  return (
    <section className="afx" aria-labelledby={`afx-h-${clip.id}`} data-testid="afx-block" data-clip-id={clip.id}>
      <H id={`afx-h-${clip.id}`}>{t('sound.fx')}</H>
      <p className="muted afx-note">{t('sound.fx.dsp')}</p>
      {blocked && <p className="muted afx-note" role="note" data-testid="afx-blocked">{t('sound.fx.blocked')}</p>}
      {!blocked && locked && <p className="muted afx-note" data-testid="afx-locked">{t('sound.fx.locked')}</p>}
      {unavailable && <p className="afx-note" role="status" data-testid="afx-unavailable">{t('sound.fx.unavailable')} <bdi dir="ltr">{unavailable}</bdi></p>}
      <ChipGroup label={t('sound.fx.voice')} testid="afx-voice" value={voice?.type ?? NONE} disabled={disabled} playing={playing}
        options={[{ value: NONE, name: t('sound.fx.none') }, ...VOICES.map((v) => ({ value: v, name: nameOf(v, lang) }))]}
        onCommit={(v) => commit(voiceOps(clip, v), 'Sound effect')} listen={(v) => void listen(`afx-voice:${v}`, voiceOps(clip, v))} />
      <ChipGroup label={t('sound.fx.space')} testid="afx-space" value={reverb ? String(reverb.params.room) : NONE} disabled={disabled} playing={playing}
        options={[{ value: NONE, name: t('sound.fx.none') }, ...ROOMS.map((r) => ({ value: r, name: AUDIO_PRESETS.find((p) => p.id === r)?.name[lang] ?? audioFxOptionLabel(r, lang) }))]}
        onCommit={(v) => commit(roomOps(clip, v), 'Sound effect')} listen={(v) => void listen(`afx-space:${v}`, roomOps(clip, v))} />
      <div className="afx-toggles" role="group" aria-label={`${t('sound.fx.space')} · ${t('sound.fx.tone')}`}>
        <button type="button" aria-pressed={!!echo} disabled={disabled} data-testid="afx-echo" onClick={() => toggle('space.echo')}><bdi>{nameOf('space.echo', lang)}</bdi></button>
        {TONES.map((type) => (
          <button key={type} type="button" aria-pressed={list.some((f) => f.type === type)} disabled={disabled} data-testid={`afx-tone-${type}`} onClick={() => toggle(type)}><bdi>{nameOf(type, lang)}</bdi></button>
        ))}
      </div>
      <div className="afx-group">
        <h4 className="afx-group-label" id={`afx-list-${clip.id}`}>{t('sound.fx.active')}</h4>
        {list.length === 0 ? <p className="muted afx-note" data-testid="afx-empty">{t('sound.fx.empty')}</p> : (
          <>
            <ol className="afx-list" aria-labelledby={`afx-list-${clip.id}`} data-testid="afx-list">
              {list.map((fx) => <FxRow key={fx.id} clip={clip} fx={fx} lang={lang} locked={locked} blocked={blocked} mono={mono} />)}
            </ol>
            <p className="muted afx-note">{t('sound.fx.order')}</p>
          </>
        )}
      </div>
      {tail && (tail.cut ? (
        <p className="afx-note" role="status" data-testid="afx-tail-cut">{tail.seconds >= 0.05 ? <>{t('sound.fx.tailCut.before')} <bdi dir="ltr">{tail.seconds.toFixed(1)}</bdi> {t('sound.fx.tailCut.after')}</> : t('sound.fx.tailCut.none')}</p>
      ) : tail.seconds >= 0.05 && (
        <p className="muted afx-note" data-testid="afx-tail">{t('sound.fx.tail.before')} <bdi dir="ltr">{tail.seconds.toFixed(1)}</bdi> {t('sound.fx.tail.after')}</p>
      ))}
      <label>{t('sound.fx.presets')}
        <select value="" disabled={disabled} data-testid="afx-preset" onChange={(e) => { const v = e.target.value; if (v) commit([{ op: 'apply_audio_preset', args: { clipId: clip.id, presetId: v === NONE ? null : v, includeLinked: false } }], 'Sound preset'); }}>
          <option value="">{t('sound.fx.presets.pick')}</option>
          {AUDIO_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name[lang]}</option>)}
          {list.length > 0 && <option value={NONE}>{t('sound.fx.presets.clear')}</option>}
        </select>
      </label>
      <p className="muted afx-note">{t('sound.fx.presets.hint')}</p>
      <div className="row">
        <button type="button" aria-pressed={bypass} data-testid="afx-bypass" title={t('sound.fx.bypass.hint')} disabled={!editor.player}
          onClick={() => { editor.player?.setBypassAudioFx(!bypass); rerender((n) => n + 1); }}>{t('sound.fx.bypass')}</button>
        <button type="button" disabled={disabled || !list.length || !others.length} data-testid="afx-apply-track" title={t('sound.fx.applyTrack.hint')}
          onClick={() => commit([{ op: 'copy_audio_effects', args: { fromClipId: clip.id, toClipIds: others, replace: true } }], 'Copy sound effects')}>{t('sound.fx.applyTrack')}</button>
      </div>
      <p className="muted afx-note">{t('sound.fx.bypass.hint')}</p>
    </section>
  );
}

/**
 * In the clip tab of a picture clip: «אפקטי קול…» opens the same block for the sound linked to it (a picture has no sound of its
 * own; the sound clip carries the effects).
 */
export function LinkedSoundFx({ sounds }: { sounds: SoundClip[] }) {
  const { t } = useEditorState();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!sounds.length) return null;
  return (
    <div className="afx-linked">
      <button type="button" className="ghost" aria-expanded={open} aria-controls={id} data-testid="afx-linked-open" onClick={() => setOpen(!open)}>{t('sound.fx.open')}</button>
      <div id={id} hidden={!open}>{open && sounds.map((c) => <AudioFxBlock key={c.id} clip={c} heading="h4" />)}</div>
    </div>
  );
}
