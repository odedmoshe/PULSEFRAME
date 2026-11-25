import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { FilmWarning, SourceRange } from '@pulseframe/core';
import type { FilmPicks } from '../familyFilm.logic.ts';
import { buildParams, choicesOf, defaultChoices, pearlLabelOf, picksAfterFiles, reasonLine, warningText, withNextWindow, withOtherClip, withRemoved } from '../familyFilm.logic.ts';

const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const range = (id: string, assetId: string, over: Partial<SourceRange> = {}): SourceRange => ({ id, assetId, kind: 'pearl', span: { start: f(0), end: f(90) }, label: '', createdBy: 'user', ...over });
const doc = (...rs: SourceRange[]) => ({ sourceRanges: Object.fromEntries(rs.map((r) => [r.id, r])) });
const HEB = /[֐-׿]/;

describe('the family film dialog: the whole picks object (pearls: prefer)', () => {
  it('«להעדיף פנינים» is preselected when a chosen file has a pearl with a span; never for a whole-file pearl or none', () => {
    const src = { assetIds: ['a', 'b'], event: null };
    expect(defaultChoices(src, 'he', doc(range('r1', 'b'))).picks).toEqual({ exclude: [], include: [], window: {}, pearls: 'prefer' });
    expect(defaultChoices(src, 'he', doc(range('r1', 'b', { span: null }))).picks.pearls).toBeUndefined();
    expect(defaultChoices(src, 'he', doc(range('r1', 'zz'))).picks.pearls).toBeUndefined();
    expect(defaultChoices(src, 'he').picks.pearls).toBeUndefined();
  });
  it('the parameters carry picks.pearls, and only then; without it the params equal what they were before pearls', () => {
    const base = defaultChoices({ assetIds: ['a'], event: null }, 'he');
    expect(buildParams(base).picks).toBeUndefined();
    expect(buildParams({ ...base, picks: { ...base.picks, pearls: 'prefer' } }).picks).toEqual({ pearls: 'prefer' });
    expect(buildParams({ ...base, picks: { ...base.picks, exclude: ['a'], pearls: 'prefer' } }).picks).toEqual({ exclude: ['a'], pearls: 'prefer' });
  });
  it('choicesOf and the pick edits keep pearls', () => {
    const p = buildParams({ ...defaultChoices({ assetIds: ['a', 'b'], event: null }, 'he'), picks: { exclude: [], include: [], window: {}, pearls: 'prefer' } });
    expect(choicesOf(p).picks.pearls).toBe('prefer');
    expect(buildParams(choicesOf(p))).toEqual(p);
    expect(withRemoved(p, 'a').picks).toEqual({ exclude: ['a'], pearls: 'prefer' });
    expect(withNextWindow(p, 'a', null, 3).picks).toEqual({ window: { a: 0 }, pearls: 'prefer' });
    expect(withOtherClip(p, 'a', 'b').picks?.pearls).toBe('prefer');
  });
  it('a change of files drops pearls when no pearl is left, preselects it for an untouched choice, and respects a choice made by hand', () => {
    const d = doc(range('r1', 'b'));
    const none: FilmPicks = { exclude: [], include: [], window: {} };
    expect(picksAfterFiles({ ...none, pearls: 'prefer' }, d, ['a'], false)).toEqual(none);
    expect(picksAfterFiles(none, d, ['a', 'b'], false)).toEqual({ ...none, pearls: 'prefer' });
    expect(picksAfterFiles(none, d, ['a', 'b'], true)).toEqual(none);
    expect(picksAfterFiles({ ...none, pearls: 'prefer' }, d, ['a', 'b'], true)).toEqual({ ...none, pearls: 'prefer' });
  });
});

describe('FilmWhy: the pearl\'s name by rangeId', () => {
  const reasons = [{ code: 'pearl' as const, rangeId: 'r1', fromSecond: 2, toSecond: 4 }];
  it('shows the name beside the reason, «פנינה שנמחקה» when the range is gone, nothing for an unnamed or hidden name', () => {
    const d = doc(range('r1', 'a', { label: 'צחוק ראשון' }), range('r2', 'a', { label: '' }));
    expect(reasonLine(reasons, 'he', pearlLabelOf(d))).toContain('צחוק ראשון');
    expect(reasonLine(reasons, 'en', pearlLabelOf(d))).toContain('צחוק ראשון');
    expect(reasonLine(reasons, 'he', pearlLabelOf(doc()))).toContain('פנינה שנמחקה');
    expect(reasonLine(reasons, 'en', pearlLabelOf(doc()))).toContain('A deleted pearl');
    const plain = reasonLine([{ code: 'pearl', rangeId: 'r2' }], 'he', pearlLabelOf(d));
    expect(plain).toBe(reasonLine([{ code: 'pearl', rangeId: 'r2' }], 'he'));
    expect(reasonLine(reasons, 'he')).toBe(reasonLine(reasons, 'he', undefined));
  });
  it('an id like "constructor" is not a range', () => { expect(pearlLabelOf(doc())('constructor')).toBeNull(); });
});

describe('removed_by_hand with details.pearls', () => {
  const w = (details: Record<string, unknown>): FilmWarning => ({ code: 'removed_by_hand', message: 'x', details: { keys: [], items: [], ...details } });
  const one = { pearls: [{ rangeId: 'r1', assetId: 'a', name: 'beach.mp4' }] };
  it('is worded in Hebrew and English: which file, that the file may stay, and the way back; no label', () => {
    const he = warningText(w(one), 'he'), en = warningText(w(one), 'en');
    expect(he).toContain('beach.mp4'); expect(he).toContain('פנינה שסימנתם'); expect(he).toContain('החזרת החלקים שנמחקו'); expect(HEB.test(he)).toBe(true);
    expect(en).toContain('beach.mp4'); expect(en).toContain('a pearl you marked'); expect(en).toContain('Restore deleted parts'); expect(HEB.test(en)).toBe(false);
  });
  it('several pearls are plural; with other left-out parts the sentence follows theirs', () => {
    const two = warningText(w({ pearls: [{ rangeId: 'r1', assetId: 'a', name: 'a.mp4' }, { rangeId: 'r2', assetId: 'b', name: 'b.mp4' }] }), 'he');
    expect(two).toContain('פנינים שסימנתם'); expect(two).toContain('a.mp4'); expect(two).toContain('b.mp4');
    const both = warningText(w({ ...one, items: [{ kind: 'file', name: 'clip.mp4' }] }), 'he');
    expect(both).toContain('clip.mp4'); expect(both).toContain('beach.mp4'); expect(both).toContain('וגם');
  });
  it('without pearls the generic wording is unchanged', () => {
    expect(warningText(w({}), 'he')).toContain('חלקים שמחקתם ידנית');
    expect(warningText(w({ pearls: [] }), 'he')).toContain('חלקים שמחקתם ידנית');
    expect(warningText(w({ pearls: [{ nope: 1 }] }), 'he')).toContain('חלקים שמחקתם ידנית');
  });
});
