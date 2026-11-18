/**
 * What the font picker decides (ADR-0022), kept apart from the component so it can be tested without a browser: the
 * options of a category, the keys of a listbox (arrows, Home, End, type-ahead), what a choice becomes and the pairings of a
 * family. Families and weights come from FONT_CATALOG only; nothing here keeps project state.
 */
import { FONT_PAIRS, resolveWeight, type FontCategory, type FontEntry, type FontPair } from '@pulseframe/core';

export interface FontChoice { family: string; weight: number }
/** The category chips, in their order. */
export const FONT_CATEGORIES: readonly FontCategory[] = ['sans', 'serif', 'display', 'handwriting'];

/** The categories some family of `catalog` belongs to (a chip for a category without a face would only dead-end). */
export const categoriesOf = (catalog: readonly FontEntry[]): FontCategory[] => FONT_CATEGORIES.filter((c) => catalog.some((f) => f.category === c));
/** The families to list: those of the pressed categories, or all when none is pressed. Catalogue order. */
export const optionsFor = (catalog: readonly FontEntry[], pressed: readonly FontCategory[]): FontEntry[] => (pressed.length ? catalog.filter((f) => pressed.includes(f.category)) : [...catalog]);
/** A chip pressed again lets go; pressed, it joins the others. */
export const toggleCategory = (pressed: readonly FontCategory[], c: FontCategory): FontCategory[] => (pressed.includes(c) ? pressed.filter((x) => x !== c) : [...pressed, c]);

/** The weight an option stands for when it is picked: the current weight, or the nearest the family bundles (never synthesised). */
export const weightFor = (font: FontEntry, current: number): number => resolveWeight(font, current);
/** What picking `font` changes the value into: the family, at the nearest bundled weight to the one in use. */
export const choose = (font: FontEntry, current: FontChoice): FontChoice => ({ family: font.family, weight: weightFor(font, current.weight) });
/** The same family at another of its bundled weights; a weight the family does not bundle gives the value back unchanged. */
export const withWeight = (font: FontEntry, current: FontChoice, weight: number): FontChoice => (font.weights.includes(weight) ? { family: font.family, weight } : current);

/** Index of the option of `family` in `options`, or -1 (the value may name a family that is not in the pressed categories). */
export const indexOfFamily = (options: readonly FontEntry[], family: string): number => options.findIndex((f) => f.family === family);

export type ListKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End' | 'PageDown' | 'PageUp';
export const isListKey = (k: string): k is ListKey => k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End' || k === 'PageDown' || k === 'PageUp';
/** The active index after an arrow key: the list is vertical, so the arrows do not mirror in right-to-left. No wrap-around (a listbox of 11 has ends). */
export function moveActive(index: number, key: ListKey, count: number): number {
  if (count <= 0) return -1;
  const last = count - 1, at = Math.min(Math.max(index, 0), last);
  switch (key) {
    case 'ArrowDown': return Math.min(last, at + 1);
    case 'ArrowUp': return Math.max(0, at - 1);
    case 'PageDown': return Math.min(last, at + 5);
    case 'PageUp': return Math.max(0, at - 5);
    case 'Home': return 0;
    case 'End': return last;
  }
}

/** Type-ahead: the typed prefix and when the last key came. */
export interface TypeAhead { buffer: string; at: number }
export const TYPE_AHEAD_MS = 700;
export const EMPTY_TYPE_AHEAD: TypeAhead = { buffer: '', at: 0 };
/** A key that extends the type-ahead: one printable character, no modifier. */
export const isTypeKey = (e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean => e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
/**
 * The next type-ahead state and the index it lands on. Keys within TYPE_AHEAD_MS of each other build one prefix ("fre" finds
 * Fredoka); a first key starts looking after the active option, and the same letter typed again and again cycles through the
 * families that start with it. A prefix nothing starts with keeps the active index.
 */
export function typeAhead(state: TypeAhead, key: string, now: number, names: readonly string[], active: number): { state: TypeAhead; index: number } {
  const fresh = now - state.at > TYPE_AHEAD_MS || state.buffer === '';
  const buffer = (fresh ? '' : state.buffer) + key.toLowerCase();
  const next = { buffer, at: now };
  const starts = (i: number, p: string) => names[i]!.toLowerCase().startsWith(p);
  const n = names.length;
  if (n === 0) return { state: next, index: -1 };
  const same = buffer.length > 1 && [...buffer].every((c) => c === buffer[0]);
  const from = same ? active + 1 : (fresh ? active + 1 : active); // a longer prefix may stay where it is
  const prefix = same ? buffer[0]! : buffer;
  for (let k = 0; k < n; k++) { const i = (from + k) % n; if (starts(i, prefix)) return { state: next, index: i }; }
  return { state: next, index: active };
}

/** A pairing as the picker shows it: the other family, the weight it is paired at, and the words. */
export interface PairingView { role: 'heading' | 'body'; other: string; otherWeight: number; note: { he: string; en: string } }
/** The pairings that name `family`, as seen from it. A family may head some pairs and be the body of others. */
export function pairingsOf(family: string, pairs: readonly FontPair[] = FONT_PAIRS): PairingView[] {
  const out: PairingView[] = [];
  for (const p of pairs) {
    if (p.heading === family) out.push({ role: 'heading', other: p.body, otherWeight: p.bodyWeight, note: p.note });
    else if (p.body === family) out.push({ role: 'body', other: p.heading, otherWeight: p.headingWeight, note: p.note });
  }
  return out;
}

/** The sample every option is drawn with, in its own face: letters, then a pointed word so the points are seen. */
export const SAMPLE = { he: 'אבג שָׁלוֹם', en: 'Abc שָׁלוֹם' } as const;
/** The option's id in the DOM (aria-activedescendant). */
export const optionId = (base: string, family: string): string => `${base}-${family.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
