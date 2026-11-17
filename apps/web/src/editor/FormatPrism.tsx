/**
 * The format prism of the stage header (UX_REDESIGN §4.5): one chip per output format of the edit (the master and its linked
 * variants), drawn in the format's own shape, and "+" to add one. Choosing a chip shows that format in the viewer; a dot marks
 * a format that has adjustments of its own. A radiogroup with a roving tab stop: arrows move and choose.
 * It only views (editor.setViewVariant) and adds formats (the registered add_variant operation, through the store).
 */
import { useRef, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import { FORMAT_PROFILES } from '@pulseframe/core';
import { useEditorState } from './store.ts';
import { Menu, rovingNext, useDir } from '../ds/index.ts';
import { STAGE_STRINGS } from './stage.strings.ts';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
/** "16:9", "9:16", "1:1", "4:5": the shape of a frame in the smallest whole numbers (a shape that has none short enough is written as a decimal ratio). */
export function ratioLabel(width: number, height: number): string {
  const g = gcd(width, height) || 1, a = width / g, b = height / g;
  return a <= 32 && b <= 32 ? `${a}:${b}` : `${(width / height).toFixed(2)}:1`;
}

export function FormatPrism() {
  const { editor, state } = useEditorState();
  const S = STAGE_STRINGS[state.lang];
  const dir = useDir();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const doc = state.doc;
  if (!doc) return null;
  const variants = Object.values(doc.variants ?? {});
  const chips = [
    { id: '', name: S.master, width: doc.settings.width, height: doc.settings.height, diverged: false },
    ...variants.map((v) => ({ id: v.id, name: v.name, width: v.width, height: v.height, diverged: Object.keys(v.overrides ?? {}).length > 0 })),
  ];
  const current = state.viewVariantId ?? '';
  const active = Math.max(0, chips.findIndex((c) => c.id === current));
  const choose = (id: string) => editor.setViewVariant(id || null);
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = rovingNext(i, e.key, { count: chips.length, dir, disabled: chips.map(() => false) });
    if (to === null) return;
    e.preventDefault(); refs.current[to]?.focus(); choose(chips[to]!.id);
  };
  const have = new Set(variants.map((v) => v.profileId));
  const addable = FORMAT_PROFILES.filter((p) => !have.has(p.id));
  const add = async (profileId: string) => {
    const p = FORMAT_PROFILES.find((x) => x.id === profileId);
    if (!p) return;
    const r = await editor.commit([{ op: 'add_variant', args: { profileId: p.id, name: p.name[state.lang] } }], 'Add format');
    const id = r?.results[0]?.output?.variantId;
    if (typeof id === 'string') editor.setViewVariant(id);
  };
  return (
    <div className="prism">
      <div className="prism-chips" role="radiogroup" aria-label={S.formats} data-testid="format-switch" data-value={current}>
        {chips.map((c, i) => {
          const on = i === active;
          const ratio = ratioLabel(c.width, c.height);
          return (
            <button key={c.id || 'master'} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className={`prism-chip${on ? ' is-on' : ''}`}
              data-value={c.id} data-testid={on && c.id ? 'format-badge' : 'format-chip'} data-variant-id={c.id || undefined}
              aria-label={`${c.name} ${ratio} (${c.width}×${c.height})${c.diverged ? ` · ${S.diverged}` : ''}`} title={on && c.id ? S.formatNote : `${c.name} · ${c.width}×${c.height}${c.diverged ? ` · ${S.diverged}` : ''}`}
              onClick={() => choose(c.id)} onKeyDown={(e) => onKey(e, i)}>
              <span className="prism-shape" aria-hidden="true"><i style={c.width >= c.height ? { inlineSize: 22, blockSize: Math.max(6, Math.round((22 * c.height) / c.width)) } : { blockSize: 18, inlineSize: Math.max(6, Math.round((18 * c.width) / c.height)) }} /></span>
              <span className="num">{ratio}</span>
              {c.diverged && <i className="prism-dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      {addable.length > 0 && (
        <Menu label={S.addFormat} items={addable.map((p) => ({ id: p.id, label: `${p.name[state.lang]} · ${p.width}×${p.height}` }))} onSelect={(id) => void add(id)}
          trigger={(p) => <button type="button" className="prism-add" aria-label={S.addFormat} title={S.addFormat} data-testid="prism-add" {...p}><Plus size={16} strokeWidth={1.75} aria-hidden="true" /></button>} />
      )}
    </div>
  );
}
