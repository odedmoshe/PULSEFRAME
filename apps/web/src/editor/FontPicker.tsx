/**
 * The font picker (ADR-0022; plan §8): replaces the plain font selects of the title and caption inspectors (the lead mounts it
 * after the redesign's inspector split). A listbox with type-ahead and arrow keys; each option drawn in its own face with
 * «אבג שָׁלוֹם»; category chips (סנס / סריף / כותרת / כתב יד); the badge «ניקוד נבדק» for a row whose nikud is 'positioned';
 * «מתאים עם…» from FONT_PAIRS. Families and weights come from FONT_CATALOG only. Test ids: FONT_TESTIDS (packs.testids.ts).
 * Nothing here keeps project state: it reports the next { family, weight } and the caller commits it as one operation.
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { FONT_CATALOG, findFont, type FontCategory, type FontEntry } from '@pulseframe/core';
import { Badge, Chip, Seg, cx } from '../ds/index.ts';
import { CheckIcon, DS } from '../ds/util.tsx';
import { FONT_TESTIDS as TID } from './packs.testids.ts';
import { FONT_STRINGS } from './font.strings.ts';
import {
  EMPTY_TYPE_AHEAD, SAMPLE, categoriesOf, choose, indexOfFamily, isListKey, isTypeKey, moveActive, optionId, optionsFor, pairingsOf, toggleCategory, typeAhead, weightFor, withWeight,
  type FontChoice, type TypeAhead,
} from './fontPicker.logic.ts';
import './fontPicker.css';

export type { FontChoice } from './fontPicker.logic.ts';

export function FontPicker({ value, onChange, lang, label, disabled }: { value: FontChoice; onChange: (next: FontChoice) => void; lang: 'he' | 'en'; label: string; disabled?: boolean }) {
  const S = FONT_STRINGS[lang];
  const base = useId();
  const [pressed, setPressed] = useState<FontCategory[]>([]);
  const options = optionsFor(FONT_CATALOG, pressed);
  const selected = indexOfFamily(options, value.family);
  const [activeFamily, setActiveFamily] = useState<string | null>(null);
  const typed = useRef<TypeAhead>(EMPTY_TYPE_AHEAD);
  // the active option: the one moved to, else the chosen one, else the first
  const active = (() => { const i = activeFamily !== null ? indexOfFamily(options, activeFamily) : -1; return i >= 0 ? i : selected >= 0 ? selected : 0; })();
  const current = findFont(value.family);
  const pick = (f: FontEntry) => { setActiveFamily(f.family); if (!disabled) onChange(choose(f, value)); };
  const move = (to: number) => { const f = options[to]; if (f) { setActiveFamily(f.family); document.getElementById(optionId(base, f.family))?.scrollIntoView?.({ block: 'nearest' }); } };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (isListKey(e.key)) { e.preventDefault(); move(moveActive(active, e.key, options.length)); return; }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const f = options[active]; if (f) pick(f); return; }
    if (isTypeKey(e)) {
      const r = typeAhead(typed.current, e.key, Date.now(), options.map((f) => f.family), active);
      typed.current = r.state;
      if (r.index >= 0 && r.index !== active) { e.preventDefault(); move(r.index); }
    }
  };
  const pairs = current ? pairingsOf(current.family) : [];
  const weights = current && current.weights.length > 1 ? current.weights : null;
  return (
    <div className={cx(DS, 'pf-fp', disabled && 'is-disabled')} data-lang={lang}>
      <span id={`${base}-label`} className="pf-fp-label">{label}</span>
      <div role="group" aria-label={S.categories} className="pf-fp-chips">
        {categoriesOf(FONT_CATALOG).map((c) => (
          <Chip key={c} pressed={pressed.includes(c)} data-testid={TID.category} data-category={c} disabled={disabled} onClick={() => setPressed((p) => toggleCategory(p, c))}>{S.category[c]}</Chip>
        ))}
      </div>
      {options.length === 0 && <p className="pf-fp-empty" role="status">{S.noneInCategory}</p>}
      <div role="listbox" tabIndex={disabled ? -1 : 0} aria-labelledby={`${base}-label`} aria-activedescendant={options[active] ? optionId(base, options[active]!.family) : undefined}
        aria-disabled={disabled || undefined} data-testid={TID.picker} className="pf-fp-list" onKeyDown={onKey}>
        {options.map((f, i) => {
          const w = weightFor(f, value.weight);
          const on = f.family === value.family;
          return (
            <div key={f.family} role="option" id={optionId(base, f.family)} aria-selected={on} aria-label={S.optionLabel(f.family, w, f.nikud === 'positioned')} data-testid={TID.option} data-family={f.family} data-weight={w}
              className={cx('pf-fp-option', on && 'is-on', i === active && 'is-active')} onClick={() => pick(f)}>
              <span className="pf-fp-name" dir="ltr" lang="en">{f.family}</span>
              <span className="pf-fp-sample" dir="rtl" lang="he" aria-hidden="true" style={{ fontFamily: `"${f.family}", var(--pf-font)`, fontWeight: w }}>{SAMPLE.he}</span>
              {f.nikud === 'positioned' && <Badge tone="ok" icon={<CheckIcon size={12} />} className="pf-fp-badge"><span data-testid={TID.nikud} title={S.nikudTitle}>{S.nikud}</span></Badge>}
              {on && <CheckIcon size={16} className="pf-fp-check" />}
            </div>
          );
        })}
      </div>
      {weights && current && (
        <Seg size="sm" label={S.weights} value={String(weightFor(current, value.weight))} onChange={(v) => onChange(withWeight(current, value, Number(v)))}
          options={weights.map((w) => ({ value: String(w), label: S.weight[w] ?? S.weightOther(w), disabled }))} />
      )}
      <div className="pf-fp-pairs" data-testid={TID.pairs} aria-live="polite">
        <span className="pf-fp-pairs-title">{S.pairsWith}</span>
        {pairs.length === 0 ? <span className="pf-fp-pairs-none">{S.pairsNone}</span> : (
          <ul className="pf-fp-pairs-list">
            {pairs.map((p) => {
              const other = findFont(p.other);
              return (
                <li key={`${p.role}-${p.other}`}>
                  <button type="button" className="pf-fp-pair" disabled={disabled || !other} aria-label={`${S.pairUse(p.other)}: ${p.note[lang]}`} onClick={() => other && onChange({ family: other.family, weight: p.otherWeight })}>
                    <span className="pf-fp-pair-face" style={{ fontFamily: `"${p.other}", var(--pf-font)`, fontWeight: p.otherWeight }} dir="ltr">{p.other}</span>
                    <span className="pf-fp-pair-role">{p.role === 'heading' ? S.bodyRole : S.headingRole}</span>
                    <span className="pf-fp-pair-note" lang={lang} dir="auto">{p.note[lang]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
