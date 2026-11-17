import { describe, expect, it } from 'vitest';
import { FONT_CATALOG, FONT_PAIRS, findFont } from '@pulseframe/core';
import { dictionaries } from '@pulseframe/i18n';
import { FONT_STRINGS } from './font.strings.ts';
import {
  EMPTY_TYPE_AHEAD, FONT_CATEGORIES, TYPE_AHEAD_MS, categoriesOf, choose, indexOfFamily, isListKey, isTypeKey, moveActive, optionId, optionsFor, pairingsOf, toggleCategory, typeAhead, weightFor, withWeight,
} from './fontPicker.logic.ts';

const names = FONT_CATALOG.map((f) => f.family);
describe('categories and options', () => {
  it('has a chip for each category some catalogue family belongs to, in the fixed order', () => {
    expect(categoriesOf(FONT_CATALOG)).toEqual(FONT_CATEGORIES);
    expect(categoriesOf(FONT_CATALOG.filter((f) => f.category === 'serif'))).toEqual(['serif']);
  });
  it('lists the catalogue when no chip is pressed and the union of the pressed categories otherwise', () => {
    expect(optionsFor(FONT_CATALOG, []).map((f) => f.family)).toEqual(names);
    const some = optionsFor(FONT_CATALOG, ['handwriting', 'serif']);
    expect(some.length).toBeGreaterThan(0);
    for (const f of some) expect(['handwriting', 'serif']).toContain(f.category);
    expect(some.map((f) => f.family)).toEqual(names.filter((n) => some.some((f) => f.family === n)));
  });
  it('pressing a chip adds it and pressing it again lets go', () => {
    expect(toggleCategory([], 'sans')).toEqual(['sans']);
    expect(toggleCategory(['sans'], 'serif')).toEqual(['sans', 'serif']);
    expect(toggleCategory(['sans', 'serif'], 'sans')).toEqual(['serif']);
  });
  it('every family of the catalogue is reachable from some chip', () => {
    const reach = new Set(FONT_CATEGORIES.flatMap((c) => optionsFor(FONT_CATALOG, [c]).map((f) => f.family)));
    expect(reach.size).toBe(FONT_CATALOG.length);
  });
});

describe('choosing', () => {
  it('keeps the weight when the family bundles it and falls to the nearest bundled one otherwise', () => {
    const heebo = findFont('Heebo')!, suez = findFont('Suez One')!;
    expect(choose(heebo, { family: 'Rubik', weight: 700 })).toEqual({ family: 'Heebo', weight: 700 });
    expect(choose(suez, { family: 'Heebo', weight: 700 })).toEqual({ family: 'Suez One', weight: 400 });
    expect(weightFor(findFont('Amatic SC')!, 600)).toBe(700);
  });
  it('the weight control only moves to a weight the family bundles', () => {
    const dl = findFont('David Libre')!;
    expect(withWeight(dl, { family: 'David Libre', weight: 400 }, 700)).toEqual({ family: 'David Libre', weight: 700 });
    const v = { family: 'Suez One', weight: 400 };
    expect(withWeight(findFont('Suez One')!, v, 700)).toBe(v);
  });
  it('finds the active option of a value, and -1 when its family is filtered out', () => {
    const only = optionsFor(FONT_CATALOG, ['handwriting']);
    expect(indexOfFamily(only, 'Gveret Levin')).toBeGreaterThanOrEqual(0);
    expect(indexOfFamily(only, 'Heebo')).toBe(-1);
  });
});

describe('listbox keys', () => {
  it('the arrows do not wrap and the list is vertical (no mirroring in right-to-left)', () => {
    expect(moveActive(0, 'ArrowUp', 11)).toBe(0);
    expect(moveActive(10, 'ArrowDown', 11)).toBe(10);
    expect(moveActive(3, 'ArrowDown', 11)).toBe(4);
    expect(moveActive(3, 'ArrowUp', 11)).toBe(2);
    expect(moveActive(3, 'Home', 11)).toBe(0);
    expect(moveActive(3, 'End', 11)).toBe(10);
    expect(moveActive(8, 'PageDown', 11)).toBe(10);
    expect(moveActive(2, 'PageUp', 11)).toBe(0);
    expect(moveActive(4, 'ArrowDown', 0)).toBe(-1);
    expect(moveActive(-1, 'ArrowDown', 3)).toBe(1);
  });
  it('knows its keys', () => {
    for (const k of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp']) expect(isListKey(k)).toBe(true);
    expect(isListKey('ArrowLeft')).toBe(false);
    expect(isListKey('Enter')).toBe(false);
    expect(isTypeKey({ key: 'f' })).toBe(true);
    expect(isTypeKey({ key: 'f', ctrlKey: true })).toBe(false);
    expect(isTypeKey({ key: ' ' })).toBe(false);
    expect(isTypeKey({ key: 'Enter' })).toBe(false);
  });
});

describe('type-ahead', () => {
  const at = (state: typeof EMPTY_TYPE_AHEAD, key: string, t: number, active: number) => typeAhead(state, key, t, names, active);
  it('lands on the first family that starts with the typed prefix, building the prefix within the time', () => {
    const a = at(EMPTY_TYPE_AHEAD, 'f', 1000, 0);
    expect(names[a.index]).toMatch(/^F/);
    const b = at(a.state, 'r', 1200, a.index);
    expect(names[b.index]!.toLowerCase().startsWith('fr')).toBe(true);
    const c = at(b.state, 'e', 1400, b.index);
    expect(names[c.index]).toBe('Fredoka');
  });
  it('a pause starts a new prefix', () => {
    const a = at(EMPTY_TYPE_AHEAD, 'f', 1000, 0);
    const b = at(a.state, 'g', 1000 + TYPE_AHEAD_MS + 1, a.index);
    expect(b.state.buffer).toBe('g');
    expect(names[b.index]).toBe('Gveret Levin');
  });
  it('the same letter again cycles through the families that start with it', () => {
    const f1 = at(EMPTY_TYPE_AHEAD, 'f', 0, 0);
    const f2 = at(f1.state, 'f', 100, f1.index);
    expect(names[f1.index]).toMatch(/^F/);
    expect(names[f2.index]).toMatch(/^F/);
    expect(f2.index).not.toBe(f1.index);
    const f3 = at(f2.state, 'f', 200, f2.index);
    expect(f3.index).toBe(f1.index);
  });
  it('is case-insensitive and keeps the active option when nothing matches', () => {
    expect(names[at(EMPTY_TYPE_AHEAD, 'H', 0, 5).index]).toBe('Heebo');
    expect(at(EMPTY_TYPE_AHEAD, 'z', 0, 5).index).toBe(5);
    expect(typeAhead(EMPTY_TYPE_AHEAD, 'a', 0, [], 0).index).toBe(-1);
  });
});

describe('pairings', () => {
  it('shows a heading its body and a body its headings, with the pair weights', () => {
    const suez = pairingsOf('Suez One');
    expect(suez).toHaveLength(1);
    expect(suez[0]).toMatchObject({ role: 'heading', other: 'Heebo', otherWeight: 400 });
    const heebo = pairingsOf('Heebo');
    expect(heebo.length).toBeGreaterThanOrEqual(3);
    for (const p of heebo) expect(p.role).toBe('body');
  });
  it('every pairing names families of the catalogue, and a family out of every pair has none', () => {
    for (const f of FONT_CATALOG) for (const p of pairingsOf(f.family)) expect(findFont(p.other)).toBeDefined();
    expect(pairingsOf('Nope')).toEqual([]);
    expect(FONT_PAIRS.length).toBe(8);
  });
});

describe('strings and ids', () => {
  it('Hebrew and English cover the same keys and share the i18n words', () => {
    expect(Object.keys(FONT_STRINGS.en).sort()).toEqual(Object.keys(FONT_STRINGS.he).sort());
    for (const lang of ['he', 'en'] as const) {
      for (const c of FONT_CATEGORIES) expect(FONT_STRINGS[lang].category[c]).toBe(dictionaries[lang][`font.category.${c}` as const]);
      expect(FONT_STRINGS[lang].nikud).toBe(dictionaries[lang]['font.nikudChecked']);
    }
    expect(FONT_STRINGS.he.nikud).toBe('ניקוד נבדק');
  });
  it('option ids are valid and distinct', () => {
    const ids = FONT_CATALOG.map((f) => optionId('x', f.family));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^x-[a-z0-9-]+$/);
  });
  it('no emoji', () => {
    expect(JSON.stringify(FONT_STRINGS)).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
