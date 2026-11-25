import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { PearlRow, PearlsView, ScreenTime, SourceRange } from '@pulseframe/core';
import {
  addPearlOp, anyFilmPearl, listState, oneLine, pearlOfWords, personChips, presenceOp, rangeById, screenRows, shortBlock, shortBody, shortName, spanOfMarks,
  spanPearlsOf, stripSegments, unusedPearlsOfPerson, usageNumbers, visibleRows,
} from './pearls.logic.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sp = (a: number, b: number) => ({ start: f(a), end: f(b) });
const noUse = { rangeId: '', uses: [], usedSource: [], untimedCopies: [] };
function row(id: string, over: Partial<PearlRow> = {}): PearlRow {
  return { id, assetId: 'a1', assetName: 'beach.mp4', kind: 'pearl', span: sp(0, 90), startSeconds: 0, endSeconds: 3, label: '', verbatim: false, people: [], createdBy: 'user', byAgent: false, usage: { ...noUse, rangeId: id }, ...over };
}
const range = (id: string, over: Partial<SourceRange> = {}): SourceRange => ({ id, assetId: 'a1', kind: 'pearl', span: sp(0, 90), label: '', createdBy: 'user', ...over });
const doc = (ranges: SourceRange[]) => ({ sourceRanges: Object.fromEntries(ranges.map((r) => [r.id, r])) });

describe('pearls.logic: the list', () => {
  const rows = [
    row('r1', { label: 'צחוק ראשון', people: [{ id: 'p1', name: 'אלף' }] }),
    row('r2', { label: 'First steps!', assetName: 'garden.mp4', people: [{ id: 'p2', name: 'Gimel' }] }),
    row('r3', { label: '', assetName: 'שִׁיר.mp4' }),
  ];
  it('searches label, file and names with vowel points, punctuation and case ignored; every token must be found', () => {
    expect(visibleRows(rows, [], { text: 'first STEPS', filter: 'all', personId: null }).map((r) => r.id)).toEqual(['r2']);
    expect(visibleRows(rows, [], { text: 'צחוק', filter: 'all', personId: null }).map((r) => r.id)).toEqual(['r1']);
    expect(visibleRows(rows, [], { text: 'שיר', filter: 'all', personId: null }).map((r) => r.id)).toEqual(['r3']);
    expect(visibleRows(rows, [], { text: 'gimel garden', filter: 'all', personId: null }).map((r) => r.id)).toEqual(['r2']);
    expect(visibleRows(rows, [], { text: 'gimel beach', filter: 'all', personId: null })).toEqual([]);
    expect(visibleRows(rows, [], { text: '  ', filter: 'all', personId: null })).toHaveLength(3);
  });
  it('filters unused and by person, keeping the route\'s order', () => {
    expect(visibleRows(rows, ['r3', 'r1'], { text: '', filter: 'unused', personId: null }).map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(visibleRows(rows, ['r3', 'r1'], { text: '', filter: 'unused', personId: 'p1' }).map((r) => r.id)).toEqual(['r1']);
    expect(visibleRows(rows, [], { text: '', filter: 'all', personId: 'p2' }).map((r) => r.id)).toEqual(['r2']);
  });
  it('names with labels hidden still search by file and person', () => {
    const hidden = rows.map((r) => ({ ...r, label: '' }));
    expect(visibleRows(hidden, [], { text: 'garden', filter: 'all', personId: null }).map((r) => r.id)).toEqual(['r2']);
  });
  it('person chips in order of first appearance, each once', () => {
    expect(personChips([...rows, row('r4', { people: [{ id: 'p2', name: 'Gimel' }, { id: 'p3', name: 'gimel' }] })])).toEqual([{ id: 'p1', name: 'אלף' }, { id: 'p2', name: 'Gimel' }, { id: 'p3', name: 'gimel' }]);
  });
  it('usage numbers: none for an unused row and for a whole-file pearl; used capped at the length', () => {
    expect(usageNumbers(row('x'))).toBeNull();
    expect(usageNumbers(row('x', { span: null }))).toBeNull();
    expect(usageNumbers(row('x', { span: null, usage: { ...noUse, usedSource: [sp(0, 90)] } }), 12)).toEqual({ used: '3', total: '12' });
    const used = row('x', { span: sp(0, 186), usage: { ...noUse, usedSource: [sp(0, 60), sp(90, 150)] } });
    expect(usageNumbers(used)).toEqual({ used: '4', total: '6.2' });
  });
  it('listState: 501 is the honest setup state, another refusal is shown, an empty route is empty', () => {
    const view = { ranges: [row('r1')] } as unknown as PearlsView;
    expect(listState(null, { status: 501, code: 'pearls_not_built' })).toBe('not-built');
    expect(listState(null, { status: 403, code: 'scope_required' })).toBe('refused');
    expect(listState({ ranges: [] } as unknown as PearlsView, null)).toBe('empty');
    expect(listState(view, null)).toBe('list');
  });
});

describe('pearls.logic: «שורט מהפנינה» (decisions C17)', () => {
  it('needs a span of 3–180 s on a file with video, and says why not otherwise', () => {
    expect(shortBlock(row('x', { span: sp(0, 90) }), true)).toBeNull();
    expect(shortBlock(row('x', { span: sp(0, 5400) }), true)).toBeNull();
    expect(shortBlock(row('x', { span: sp(0, 60) }), true)).toBe('too_short');
    expect(shortBlock(row('x', { span: sp(0, 5401) }), true)).toBe('too_long');
    expect(shortBlock(row('x', { span: null }), true)).toBe('whole_file');
    expect(shortBlock(row('x', { span: sp(0, 90) }), false)).toBe('no_picture');
  });
  it('the body is one pick of the exact stretch, named by the label cut to 128; no name when unnamed', () => {
    const b = shortBody(row('x', { label: 'א'.repeat(300), span: sp(30, 120) }))!;
    expect(b.picks).toHaveLength(1);
    expect(b.picks[0]!.name).toHaveLength(128);
    expect(T.eq(b.picks[0]!.start, f(30)) && T.eq(b.picks[0]!.end, f(120))).toBe(true);
    expect(shortBody(row('x', { label: '  ', span: sp(0, 90) }))!.picks[0]).not.toHaveProperty('name');
    expect(shortBody(row('x', { span: null }))).toBeNull();
    expect(shortName('')).toBeUndefined();
  });
});

describe('pearls.logic: marking in the viewer (P3 numbers)', () => {
  const d = T.rt(10, 1);
  it('I at frame 30, O at frame 74 (the out point is the frame after): exactly [30/30, 75/30) s', () => {
    const s = spanOfMarks({ inFrame: 30, outFrame: 75, rate: R, duration: d, isImage: false })!;
    expect(T.eq(s.start, T.rt(30, 30))).toBe(true);
    expect(T.eq(s.end, T.rt(75, 30))).toBe(true);
  });
  it('nothing marked, or a photo, is the whole file; an out point past the end is cut to the file; an empty stretch is none', () => {
    expect(spanOfMarks({ inFrame: 0, outFrame: null, rate: R, duration: d, isImage: false })).toBeNull();
    expect(spanOfMarks({ inFrame: 30, outFrame: 75, rate: R, duration: d, isImage: true })).toBeNull();
    const s = spanOfMarks({ inFrame: 290, outFrame: 301, rate: R, duration: T.rt(9995, 1000), isImage: false })!;
    expect(T.eq(s.end, T.rt(9995, 1000))).toBe(true);
    expect(spanOfMarks({ inFrame: 300, outFrame: null, rate: R, duration: d, isImage: false })).toBeNull();
  });
  it('the operation: kind pearl, the exact span, a one-line name, people sorted, nothing for what was not given', () => {
    const op = addPearlOp('a1', sp(30, 75), '  שלום\nעולם ', ['p2', 'p1']);
    expect(op.op).toBe('add_source_range');
    expect(op.args).toMatchObject({ assetId: 'a1', kind: 'pearl', start: f(30), end: f(75), label: 'שלום עולם', people: ['p1', 'p2'] });
    const bare = addPearlOp('a1', null, '', []).args as Record<string, unknown>;
    expect(Object.keys(bare).sort()).toEqual(['assetId', 'kind']);
    expect(oneLine('x'.repeat(250))).toHaveLength(200);
  });
});

describe('pearls.logic: transcript words (P4 numbers)', () => {
  const w = (text: string, a: number, dur: number) => ({ text, start: T.rt(a, 100), duration: T.rt(dur, 100) });
  const words = [w('אחד', 0, 40), w('שניים', 45, 30), w('שלושה', 80, 33), w('ארבעה', 120, 41)];
  it('span = first word start to last word end exactly; the label is the words joined by spaces', () => {
    const p = pearlOfWords('a1', words.slice(1, 4))!;
    expect(T.eq(p.span.start, T.rt(45, 100))).toBe(true);
    expect(T.eq(p.span.end, T.rt(161, 100))).toBe(true);
    expect(p.label).toBe('שניים שלושה ארבעה');
    expect(pearlOfWords('a1', [])).toBeNull();
  });
  it('a long selection is cut to the label limit', () => { expect(pearlOfWords('a1', [w('א'.repeat(150), 0, 10), w('ב'.repeat(150), 10, 10)])!.label).toHaveLength(200); });
});

describe('pearls.logic: the strip', () => {
  it('places saved pearls and used stretches by percentage; a hairline stays visible; nothing on an empty file', () => {
    const segs = stripSegments(T.rt(10, 1), [sp(30, 75)], [sp(0, 60)]);
    expect(segs).toEqual([{ kind: 'used', fromPercent: 0, widthPercent: 20 }, { kind: 'pearl', fromPercent: 10, widthPercent: 15 }]);
    expect(stripSegments(T.rt(10, 1), [sp(30, 31)], [])[0]!.widthPercent).toBeGreaterThanOrEqual(0.5);
    expect(stripSegments(T.ZERO, [sp(0, 1)], [])).toEqual([]);
  });
});

describe('pearls.logic: «מי בקליפ?»', () => {
  const none = doc([]);
  const tagged = doc([range('rp', { kind: 'presence', span: null, people: ['p1', 'p2'] }), range('r1', { people: ['p1'] })]);
  it('adds, updates, removes or does nothing', () => {
    expect(presenceOp(none, 'a1', [])).toBeNull();
    expect(presenceOp(none, 'a1', ['p2', 'p1', 'p1'])).toEqual({ op: 'add_source_range', args: { assetId: 'a1', kind: 'presence', people: ['p1', 'p2'] } });
    expect(presenceOp(tagged, 'a1', ['p2', 'p1'])).toBeNull();
    expect(presenceOp(tagged, 'a1', ['p1'])).toEqual({ op: 'update_source_range', args: { rangeId: 'rp', people: ['p1'] } });
    expect(presenceOp(tagged, 'a1', [])).toEqual({ op: 'remove_source_range', args: { rangeId: 'rp' } });
    expect(presenceOp(tagged, 'other', [])).toBeNull();
  });
  it('own-property lookups: an id like "constructor" is not a range', () => {
    expect(rangeById(tagged, 'constructor')).toBeNull();
    expect(rangeById(tagged, 'r1')?.id).toBe('r1');
  });
});

describe('pearls.logic: the film\'s pearls and the screen-time table', () => {
  it('only pearls with a span count for the film; they are in source order', () => {
    const d = doc([range('b', { span: sp(60, 90) }), range('a', { span: sp(0, 30) }), range('w', { span: null }), range('p', { kind: 'presence', span: null, people: ['p1'] })]);
    expect(spanPearlsOf(d, 'a1').map((r) => r.id)).toEqual(['a', 'b']);
    expect(anyFilmPearl(d, ['a1'])).toBe(true);
    expect(anyFilmPearl(d, ['zz'])).toBe(false);
    expect(anyFilmPearl(doc([range('w', { span: null })]), ['a1'])).toBe(false);
  });
  it('rows: seconds from frames and the rate, percent of the picture time, the untagged remainder, the partial-numbers note above half', () => {
    const st: ScreenTime = { sequenceId: 's', rate: { num: 30000, den: 1001 }, pictureFrames: 600, untaggedFrames: 301, people: [{ personId: 'p1', frames: 150, clips: ['c1'] }, { personId: 'p2', frames: 60, clips: ['c2'] }] };
    const t = screenRows(st, (id) => id.toUpperCase());
    expect(t.rows.map((r) => [r.name, r.frames, r.percent])).toEqual([['P1', 150, 25], ['P2', 60, 10]]);
    expect(t.rows[0]!.seconds).toBeCloseTo((150 * 1001) / 30000, 9);
    expect(t.untagged.percent).toBe(50);
    expect(t.mostlyUntagged).toBe(true);
    expect(screenRows({ ...st, untaggedFrames: 300 }, (i) => i).mostlyUntagged).toBe(false);
    expect(screenRows({ ...st, pictureFrames: 0, untaggedFrames: 0, people: [] }, (i) => i)).toMatchObject({ mostlyUntagged: false, untagged: { percent: 0 } });
  });
  it('the unused pearls of a person: pearls only, the usage order', () => {
    const d = doc([range('r1', { people: ['p1'] }), range('r2', { people: ['p1'] }), range('rp', { kind: 'presence', span: null, people: ['p1'] }), range('r3', { people: ['p2'] })]);
    expect(unusedPearlsOfPerson(d, ['r2', 'rp', 'r3', 'r1', 'gone'], 'p1')).toEqual(['r2', 'r1']);
  });
});
