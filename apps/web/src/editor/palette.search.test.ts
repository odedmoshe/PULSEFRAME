import { describe, expect, it } from 'vitest';
import { rankCommands, normalize } from './palette.search.ts';

const items = [
  { id: 'transport.toggle', he: 'ניגון / השהיה', en: 'Play / pause' },
  { id: 'edit.split', he: 'פיצול', en: 'Split' },
  { id: 'edit.deselect', he: 'ביטול בחירה', en: 'Deselect' },
  { id: 'history.undo', he: 'ביטול', en: 'Undo' },
  { id: 'edit.selectNext', he: 'בחירת הקליפ הבא', en: 'Select next clip' },
];

describe('rankCommands', () => {
  it('returns original order for an empty or blank query', () => {
    expect(rankCommands('', items)).toEqual(items.map((i) => i.id));
    expect(rankCommands('   ', items)).toEqual(items.map((i) => i.id));
  });
  it('finds a Hebrew label with an English query language and vice versa', () => {
    expect(rankCommands('פיצול', items)).toEqual(['edit.split']);
    expect(rankCommands('split', items)).toEqual(['edit.split']);
  });
  it('ignores niqqud and Latin diacritics and case', () => {
    expect(rankCommands('פִּיצּוּל', items)).toEqual(['edit.split']);
    expect(normalize('Café')).toBe('cafe');
    expect(rankCommands('SPLÍT', items)).toEqual(['edit.split']);
  });
  it('ranks exact > prefix > word-prefix > substring', () => {
    const list = [
      { id: 'a', he: 'א', en: 'xxundoxx' },
      { id: 'b', he: 'ב', en: 'the undo thing' },
      { id: 'c', he: 'ג', en: 'undo all' },
      { id: 'd', he: 'ד', en: 'undo' },
    ];
    expect(rankCommands('undo', list)).toEqual(['d', 'c', 'b', 'a']);
  });
  it('prefix beats substring in the real set', () => {
    const r = rankCommands('bi', items.concat([{ id: 'z', he: 'ז', en: 'Fabric' }]));
    expect(r.indexOf('z')).toBeGreaterThan(-1);
    expect(rankCommands('de', items)[0]).toBe('edit.deselect');
  });
  it('fuzzy subsequence matches', () => {
    expect(rankCommands('plps', items)).toEqual(['transport.toggle']);
  });
  it('excludes non-matches', () => {
    expect(rankCommands('zzzq', items)).toEqual([]);
  });
  it('matches the command id', () => {
    expect(rankCommands('history', items)).toEqual(['history.undo']);
  });
  it('keeps registry order on ties', () => {
    const list = [
      { id: 'one', he: 'א', en: 'Zoom in' },
      { id: 'two', he: 'ב', en: 'Zoom out' },
      { id: 'three', he: 'ג', en: 'Zoom fit' },
    ];
    expect(rankCommands('zoom', list)).toEqual(['one', 'two', 'three']);
  });
});
