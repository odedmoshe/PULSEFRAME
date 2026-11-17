/**
 * The look fields of a title (ADR-0012): gradient, letter spacing, second outline, glow, extrusion and long shadow. One
 * labelled checkbox per field turns it on (with a starting value) or off, and reveals its controls. Every change is a
 * registered op through editor.commit: update_text on the master, or set_variant_override with textStyle while a format
 * is viewed (there a null means "off in this format"). Nothing here keeps project state; the values shown are the title's
 * as the viewed format shows it. Drawn by Canvas2D, so these work without a graphics adapter.
 */
import { useEffect, useRef, useState } from 'react';
import { TEXT_LOOK_FIELDS, type Clip, type OpCall, type TextLookField, type TextStyle } from '@pulseframe/core';
import { hasArabicScript } from '@pulseframe/engine/textAnimation.ts';
import { useEditorState } from './store.ts';
import { TEXT_EFFECT_TESTIDS, textEffectTestId } from './trendTestIds.ts';

type Text = Extract<Clip, { type: 'text' }>;
type Look = Partial<Pick<TextStyle, TextLookField>>;

const STR = {
  he: {
    title: 'אפקטים לכותרת',
    fields: { gradient: 'מעבר צבעים', tracking: 'מרווח בין אותיות', stroke2: 'קו מתאר שני', glow: 'זוהר', extrude: 'תלת־ממד', longShadow: 'צל ארוך' } as Record<TextLookField, string>,
    colour: 'צבע', colourN: (n: number) => ['צבע ראשון', 'צבע שני', 'צבע שלישי'][n] ?? `צבע ${n + 1}`, hex: (what: string) => `${what}: קוד hex`,
    third: 'צבע שלישי באמצע', angle: 'זווית (מעלות)', spacing: 'מרווח (חלק מגודל הגופן)', width: 'עובי (חלק מגודל הגופן)', radius: 'רדיוס (חלק מגודל הגופן)',
    intensity: 'עוצמה', depth: 'עומק (חלק מגודל הגופן)', shade: 'הכהיה לעומק', length: 'אורך (בגדלי גופן)',
    removeAll: 'הסרת כל האפקטים',
    note: 'זווית 0° היא ימינה (במעבר צבעים: משמאל לימין) ו־90° למטה. האפקטים מצוירים בלי כרטיס גרפי, וכותרת בלי אפקטים נראית בדיוק כמו קודם.',
    format: 'בתצוגת פורמט השינוי נשמר לפורמט הזה בלבד; כיבוי כאן מכבה את האפקט רק בו.',
    arabic: 'בשורות בכתב ערבי האותיות מחוברות, ולכן אין בהן מרווח בין אותיות.',
    refused: (why: string) => `השינוי לא נשמר${why ? `: ${why}` : '.'}`,
    badHex: 'קוד צבע הוא # ואחריו 6 או 8 ספרות הקסדצימליות (למשל ‎#FF2BD6‎).',
  },
  en: {
    title: 'Title effects',
    fields: { gradient: 'Gradient', tracking: 'Letter spacing', stroke2: 'Second outline', glow: 'Glow', extrude: '3D extrude', longShadow: 'Long shadow' } as Record<TextLookField, string>,
    colour: 'Colour', colourN: (n: number) => ['First colour', 'Second colour', 'Third colour'][n] ?? `Colour ${n + 1}`, hex: (what: string) => `${what}: hex code`,
    third: 'A third colour in the middle', angle: 'Angle (degrees)', spacing: 'Spacing (fraction of the font size)', width: 'Width (fraction of the font size)', radius: 'Radius (fraction of the font size)',
    intensity: 'Intensity', depth: 'Depth (fraction of the font size)', shade: 'Darkening toward the back', length: 'Length (font sizes)',
    removeAll: 'Remove all effects',
    note: 'An angle of 0° points right (for a gradient: left to right) and 90° down. These effects need no graphics adapter, and a title without them looks exactly as before.',
    format: 'While a format is viewed the change is kept for that format only; turning an effect off here turns it off there only.',
    arabic: 'Lines in Arabic script keep their letters joined, so they get no letter spacing.',
    refused: (why: string) => `The change was not saved${why ? `: ${why}` : '.'}`,
    badHex: 'A colour code is # and 6 or 8 hexadecimal digits (for example #FF2BD6).',
  },
} as const;

/** The value a field gets when it is turned on (and the master has none to copy). */
export const LOOK_DEFAULTS: { [K in TextLookField]-?: NonNullable<TextStyle[K]> } = {
  gradient: { colors: ['#FFD166', '#EF476F'], angle: 90 },
  tracking: 0.1,
  stroke2: { color: '#111111', widthFrac: 0.06 },
  glow: { color: '#FF2BD6', radiusFrac: 0.5, intensity: 0.8 },
  extrude: { color: '#1D3557', depthFrac: 0.15, angle: 45, shade: 0.5 },
  longShadow: { color: '#0000004D', lengthFrac: 1.5, angle: 45 },
};
const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
/** The op a change of the look fields commits: update_text on the master, set_variant_override with textStyle in a format view. */
export const lookOps = (clipId: string, variantId: string | null, patch: Look): OpCall[] => variantId
  ? [{ op: 'set_variant_override', args: { variantId, clipId, textStyle: patch } }]
  : [{ op: 'update_text', args: { clipId, style: patch } }];
/** The value a checkbox sends: off is null; on is the master's value when it has one (a format turning it back on), else the starting value. */
export function toggleValue<K extends TextLookField>(master: Look, k: K, on: boolean): TextStyle[K] {
  if (!on) return null as TextStyle[K];
  const m = master[k];
  return (m != null && !(k === 'tracking' && m === 0) ? m : LOOK_DEFAULTS[k]) as TextStyle[K];
}
/** "Remove all effects": the six fields as null. */
export const REMOVE_ALL: Look = Object.fromEntries(TEXT_LOOK_FIELDS.map((k) => [k, null])) as Look;
/** On: present, not null, and for tracking not 0 (core hasTextLook). */
const isOn = (s: Look, k: TextLookField) => s[k] != null && !(k === 'tracking' && s[k] === 0);
const fxId = (field: TextLookField, part: string) => `${textEffectTestId(field)}-${part}`;

/** A number with a slider and a typed field, committed when the slider is let go (pointer or key) or the field is left. */
function NumberField({ label, value, min, max, step, testid, integer, onCommit }: { label: string; value: number; min: number; max: number; step: number; testid: string; integer?: boolean; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const fit = (x: number) => { const c = Math.min(max, Math.max(min, x)); return integer ? Math.round(c) : Math.round(c * 1000) / 1000; };
  const done = (x: number) => { if (!Number.isFinite(x)) { setV(value); return; } const c = fit(x); setV(c); if (c !== value) onCommit(c); };
  return (
    <div className="row">
      <label>{label}
        <input type="range" min={min} max={max} step={step} value={v} data-testid={`${testid}-range`} onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={(e) => done(Number(e.currentTarget.value))} onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key.startsWith('Page')) done(Number(e.currentTarget.value)); }} />
      </label>
      <label><span className="sr-only">{label}</span>
        <input type="number" dir="ltr" min={min} max={max} step={step} defaultValue={value} key={`${testid}:${value}`} data-testid={testid}
          onBlur={(e) => done(e.currentTarget.valueAsNumber)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
    </div>
  );
}

/** A colour: the system picker (opaque part) and a hex field that also takes #RRGGBBAA. Committed when the picker is closed or the field is left. */
function ColourField({ label, value, testid, onCommit, onBadHex, hexLabel }: { label: string; value: string; testid: string; hexLabel: string; onCommit: (c: string) => void; onBadHex: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  useEffect(() => {
    // the 'change' event (picker closed), not React's onChange, which fires on every move inside the picker
    const el = picker.current;
    if (!el) return;
    const on = () => { const { value: cur, onCommit: commit } = latest.current; const next = el.value.toUpperCase() + (cur.length === 9 ? cur.slice(7) : ''); if (next.toUpperCase() !== cur.toUpperCase()) commit(next); };
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, [value]); // the input is a new element whenever the stored value changes (its key)
  return (
    <div className="row">
      <label>{label}
        <input ref={picker} type="color" defaultValue={value.slice(0, 7).toLowerCase()} key={`${testid}:${value}`} data-testid={testid} />
      </label>
      <label><span className="sr-only">{hexLabel}</span>
        <input type="text" dir="ltr" spellCheck={false} defaultValue={value} key={`${testid}-hex:${value}`} data-testid={`${testid}-hex`} aria-label={hexLabel}
          onBlur={(e) => { const t = e.currentTarget.value.trim(); if (t.toUpperCase() === value.toUpperCase()) return; if (!HEX.test(t)) { e.currentTarget.value = value; onBadHex(); return; } onCommit(t.toUpperCase()); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </label>
    </div>
  );
}

/**
 * `style`: the title's style as the viewed format shows it (the master's when no format is viewed). Turning an effect on
 * in a format copies the master's value of it when the master has one.
 */
export function TextEffectsField({ clip, style, variantId }: { clip: Text; style: TextStyle; variantId: string | null }) {
  const { editor, state } = useEditorState();
  const S = STR[state.lang];
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { setStatus(null); }, [clip.id, variantId]);
  const shown: Look = style;
  const commit = async (patch: Look, label: string) => {
    const r = await editor.commit(lookOps(clip.id, variantId, patch), label);
    // a refusal is shown by the editor's error bar too; here it is said where the change was made, for a screen reader as well
    setStatus(r ? null : S.refused(editor.getState().error ?? ''));
  };
  const set = <K extends TextLookField>(k: K, v: TextStyle[K]) => void commit({ [k]: v } as Look, `Title effect: ${k}`);
  const toggle = (k: TextLookField, on: boolean) => set(k, toggleValue(clip.style, k, on));
  const anyOn = TEXT_LOOK_FIELDS.some((k) => isOn(shown, k));
  const badHex = () => setStatus(S.badHex);
  const colour = (field: TextLookField, label: string, value: string, apply: (c: string) => void, part = 'color') => (
    <ColourField label={label} hexLabel={S.hex(label)} value={value} testid={fxId(field, part)} onCommit={apply} onBadHex={badHex} />
  );
  const angle = (field: TextLookField, value: number, apply: (a: number) => void) => (
    <NumberField label={S.angle} value={value} min={0} max={359} step={15} integer testid={fxId(field, 'angle')} onCommit={apply} />
  );

  const controls = (k: TextLookField) => {
    if (k === 'gradient' && shown.gradient) {
      const g = shown.gradient;
      return (<>
        {g.colors.map((c, i) => <div key={i}>{colour('gradient', S.colourN(i), c, (v) => set('gradient', { ...g, colors: g.colors.map((x, j) => (j === i ? v : x)) }), `color${i + 1}`)}</div>)}
        <label className="check"><input type="checkbox" checked={g.colors.length === 3} data-testid={fxId('gradient', 'third')}
          onChange={(e) => set('gradient', { ...g, colors: e.target.checked ? [g.colors[0]!, g.colors[0]!, g.colors[1]!] : [g.colors[0]!, g.colors.at(-1)!] })} /> {S.third}</label>
        {angle('gradient', g.angle, (a) => set('gradient', { ...g, angle: a }))}
      </>);
    }
    if (k === 'tracking' && shown.tracking != null) return (<>
      <NumberField label={S.spacing} value={shown.tracking} min={-0.05} max={0.5} step={0.01} testid={fxId('tracking', 'value')} onCommit={(v) => set('tracking', v)} />
      {hasArabicScript(clip.text) && <p className="muted">{S.arabic}</p>}
    </>);
    if (k === 'stroke2' && shown.stroke2) { const o = shown.stroke2; return (<>
      {colour('stroke2', S.colour, o.color, (c) => set('stroke2', { ...o, color: c }))}
      <NumberField label={S.width} value={o.widthFrac} min={0.01} max={0.5} step={0.01} testid={fxId('stroke2', 'width')} onCommit={(v) => set('stroke2', { ...o, widthFrac: v })} />
    </>); }
    if (k === 'glow' && shown.glow) { const o = shown.glow; return (<>
      {colour('glow', S.colour, o.color, (c) => set('glow', { ...o, color: c }))}
      <NumberField label={S.radius} value={o.radiusFrac} min={0.05} max={1} step={0.05} testid={fxId('glow', 'radius')} onCommit={(v) => set('glow', { ...o, radiusFrac: v })} />
      <NumberField label={S.intensity} value={o.intensity} min={0.1} max={1} step={0.05} testid={fxId('glow', 'intensity')} onCommit={(v) => set('glow', { ...o, intensity: v })} />
    </>); }
    if (k === 'extrude' && shown.extrude) { const o = shown.extrude; return (<>
      {colour('extrude', S.colour, o.color, (c) => set('extrude', { ...o, color: c }))}
      <NumberField label={S.depth} value={o.depthFrac} min={0.02} max={0.6} step={0.01} testid={fxId('extrude', 'depth')} onCommit={(v) => set('extrude', { ...o, depthFrac: v })} />
      {angle('extrude', o.angle, (a) => set('extrude', { ...o, angle: a }))}
      <NumberField label={S.shade} value={o.shade} min={0} max={0.8} step={0.05} testid={fxId('extrude', 'shade')} onCommit={(v) => set('extrude', { ...o, shade: v })} />
    </>); }
    if (k === 'longShadow' && shown.longShadow) { const o = shown.longShadow; return (<>
      {colour('longShadow', S.colour, o.color, (c) => set('longShadow', { ...o, color: c }))}
      <NumberField label={S.length} value={o.lengthFrac} min={0.1} max={4} step={0.1} testid={fxId('longShadow', 'length')} onCommit={(v) => set('longShadow', { ...o, lengthFrac: v })} />
      {angle('longShadow', o.angle, (a) => set('longShadow', { ...o, angle: a }))}
    </>); }
    return null;
  };

  return (
    <fieldset className="ramp" data-testid={TEXT_EFFECT_TESTIDS.panel}>
      <legend>{S.title}</legend>
      <div className="fields">
        {TEXT_LOOK_FIELDS.map((k) => (
          <div key={k} className="fields" data-field={k}>
            <label className="check">
              <input type="checkbox" checked={isOn(shown, k)} data-testid={textEffectTestId(k)} onChange={(e) => toggle(k, e.target.checked)} /> {S.fields[k]}
            </label>
            {isOn(shown, k) && controls(k)}
          </div>
        ))}
        {variantId && <p className="muted">{S.format}</p>}
        <p className="muted">{S.note}</p>
        <p className="muted" role="status" aria-live="polite" data-testid={TEXT_EFFECT_TESTIDS.status}>{status ?? ''}</p>
        <div className="row">
          <button type="button" className="ghost" disabled={!anyOn} data-testid={TEXT_EFFECT_TESTIDS.removeAll}
            onClick={() => void commit(REMOVE_ALL, 'Remove title effects')}>{S.removeAll}</button>
        </div>
      </div>
    </fieldset>
  );
}
