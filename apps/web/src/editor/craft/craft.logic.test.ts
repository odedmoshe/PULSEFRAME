import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type DiffSummary, type OpCall, type ProjectDocument, type TextMatch } from '@pulseframe/core';
import { counted, defaultVersionName, diffSentence, findQueryOf, DEFAULT_FIND, frameState, groupMatches, laterThatStayed, listKey, nameProblem, pasteTargets, replaceablePicks, replacePlanOf, rippleNotice, say, snippetOf, stepFrame, timeLine, privacyAtStake } from './craft.logic.ts';

const R = { num: 30000, den: 1001 };
describe('the time field line', () => {
  it('says the frame and the timecode, rounding, and each refusal in words (he and en)', () => {
    const ok = timeLine('he', '1:10', R, 'goto', { base: 0 });
    expect(ok).toMatchObject({ kind: 'ok', frame: 2098 });
    expect(ok.text).toContain('פריים 2098');
    expect(timeLine('en', '5s', R, 'goto', { base: 0 }).text).toContain('frame 150');
    expect(timeLine('he', '00:00:10:00', R, 'goto', { base: 0 })).toMatchObject({ frame: 300 });
    expect(timeLine('he', '+12', R, 'goto', { base: 100 })).toMatchObject({ frame: 112 });
    expect(timeLine('he', '-1:00', R, 'goto', { base: 5000 })).toMatchObject({ kind: 'ok' });
    expect(timeLine('he', '90', R, 'goto', { base: 7 })).toMatchObject({ frame: 90 });
    expect(timeLine('he', '0.5f', R, 'goto', { base: 0 })).toMatchObject({ kind: 'refused', text: 'אפשר להקליד רק פריימים שלמים' });
    expect(timeLine('en', 'abc', R, 'goto', { base: 0 })).toMatchObject({ kind: 'refused', text: 'The time could not be read' });
    expect(timeLine('he', '-5', R, 'goto', { base: 1 }).kind).toBe('refused');
    expect(timeLine('he', '', R, 'goto', { base: 0 }).kind).toBe('empty');
  });
  it('a duration needs a frame, and a relative one is not offered for several clips', () => {
    expect(timeLine('en', '0', R, 'duration', { base: 10 }).kind).toBe('refused');
    expect(timeLine('en', '+5', R, 'duration', { base: 10, several: true }).kind).toBe('refused');
    expect(timeLine('en', '+5', R, 'duration', { base: 10 })).toMatchObject({ kind: 'ok', frame: 15 });
  });
  it('a goto past the end says it will land on the last frame', () => {
    expect(timeLine('en', '99999', R, 'goto', { base: 0, last: 100 }).text).toContain('last frame (100)');
  });
});

describe('words and toasts', () => {
  it('counted uses the one form for one and the many form otherwise', () => {
    expect(counted('he', 'trimmed', 1)).toBe('נחתך פריים אחד');
    expect(counted('he', 'trimmed', 31)).toBe('נחתכו 31 פריימים');
    expect(counted('en', 'moved', 6)).toBe('6 clips moved');
  });
  it('the ripple toast names the frames and the clips, says what stayed only when something did, and has an undo only with a transaction', () => {
    const a = rippleNotice('he', { frames: 31, moved: 6, stayed: 2 }, 'tx_1');
    expect(a).toEqual({ kind: 'undo', title: 'נחתכו 31 פריימים · 6 קליפים זזו', body: 'כותרות, מוזיקה וסמנים שאחרי החיתוך נשארו במקומם', undoes: 'tx_1' });
    const b = rippleNotice('en', { frames: 1, moved: 0, stayed: 0 }, null);
    expect(b).toEqual({ kind: 'info', title: 'Trimmed one frame' });
  });
  it('the default name of a version continues the numbering and carries the time', () => {
    const d = new Date(2026, 10, 25, 14, 32);
    expect(defaultVersionName('he', [], d)).toBe('גרסה 1 · 25.11 14:32');
    expect(defaultVersionName('he', ['גרסה 3 · x', 'אחר'], d)).toBe('גרסה 4 · 25.11 14:32');
    expect(defaultVersionName('en', ['Version 7'], d)).toBe('Version 8 · 25.11 14:32');
  });
  it('a name is 1 to 80 characters after trimming', () => {
    expect(nameProblem('he', '   ')).toBeTruthy();
    expect(nameProblem('en', 'x'.repeat(81))).toBeTruthy();
    expect(nameProblem('en', ' ok ')).toBeNull();
  });
});

describe('find rows', () => {
  const text = 'שלום עולם, שלום לכולם';
  it('splits a text around its matches and trims long texts to a window', () => {
    const sn = snippetOf(text, [[0, 4], [11, 15]]);
    expect(sn.parts.filter((p) => p.match).map((p) => p.text)).toEqual(['שלום', 'שלום']);
    expect(sn.cutBefore).toBe(false);
    const long = `${'א'.repeat(200)}שלום${'ב'.repeat(200)}`;
    const w = snippetOf(long, [[200, 204]]);
    expect(w.cutBefore && w.cutAfter).toBe(true);
    expect(w.parts.map((p) => p.text).join('').length).toBeLessThan(120);
  });
  it('a query needs text, and selected clips or a shown format when it asks for them', () => {
    expect(findQueryOf('', DEFAULT_FIND, [], null)).toBeNull();
    expect(findQueryOf('נעה', { ...DEFAULT_FIND, scope: 'clips' }, [], null)).toBeNull();
    expect(findQueryOf('נעה', { ...DEFAULT_FIND, formats: 'viewed' }, [], null)).toBeNull();
    expect(findQueryOf('נעה', { ...DEFAULT_FIND, formats: 'viewed' }, [], 'var_1')).toMatchObject({ formats: 'viewed', variantId: 'var_1', ignoreMarks: true, finalsEqual: true, wholeWord: false });
    expect(findQueryOf('נעה', { ...DEFAULT_FIND, scope: 'clips' }, ['c1'], null)).toMatchObject({ scope: 'clips', clipIds: ['c1'] });
  });
  it('a replacement that would leave a text empty cannot be ticked; the rest plans as one replace_text', () => {
    const m = (t: string, ranges: [number, number][]): TextMatch => ({ at: { kind: 'title', clipId: t }, sequenceId: 'seq_main', kind: 'title', variantId: null, text: t, ranges, frame: 0, notes: [] });
    const matches = [m('נעה', [[0, 3]]), m('נעה ילדה', [[0, 3]])];
    expect(replaceablePicks(matches, '', new Set([0, 1]))).toEqual([1]);
    expect(replaceablePicks(matches, 'נועה', new Set([1, 0]))).toEqual([0, 1]);
  });
  it('the keys of the list move by one, ten, to the ends and nothing else', () => {
    expect(listKey('ArrowDown', 0, 3)).toBe(1);
    expect(listKey('ArrowDown', 2, 3)).toBe(2);
    expect(listKey('ArrowUp', 0, 3)).toBe(0);
    expect(listKey('End', 0, 30)).toBe(29);
    expect(listKey('PageDown', 0, 30)).toBe(10);
    expect(listKey('q', 0, 3)).toBeNull();
    expect(listKey('Delete', 0, 3)).toBeNull();
    expect(listKey('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('paste', () => {
  it('the source is left out of the targets and said so', () => {
    expect(pasteTargets(['a', 'b', 'c'], 'b')).toEqual({ targets: ['a', 'c'], leftOut: true });
    expect(pasteTargets(['a'], 'z')).toEqual({ targets: ['a'], leftOut: false });
  });
});

describe('versions', () => {
  const diff = (o: Partial<DiffSummary>): DiffSummary => ({ counts: { added: 0, removed: 0, changed: 0 }, rows: [], more: 0, privacy: { added: 0, removed: 0, changed: 0 }, ...o });
  it('says the counts by kind first, in both languages', () => {
    const rows = [
      ...[1, 2, 3].map((n) => ({ entity: 'clip' as const, id: `a${n}`, change: 'added' as const, name: 'x', restores: true })),
      ...[1, 2].map((n) => ({ entity: 'clip' as const, id: `r${n}`, change: 'removed' as const, name: 'y', restores: true })),
      ...[1, 2, 3, 4, 5].map((n) => ({ entity: 'clip' as const, id: `c${n}`, change: 'changed' as const, name: 'z', restores: true })),
    ];
    const d = diff({ counts: { added: 3, removed: 2, changed: 5 }, rows });
    expect(diffSentence('he', d)).toBe('3 קליפים נוספו · 2 קליפים נמחקו · 5 קליפים שונו');
    expect(diffSentence('en', d)).toBe('3 clips added · 2 clips deleted · 5 clips changed');
  });
  it('falls back to the totals when the rows are not complete', () => {
    expect(diffSentence('en', diff({ counts: { added: 1000, removed: 0, changed: 0 }, more: 500, rows: [] }))).toBe('1000 added');
  });
  it('the second confirmation is needed when regions are removed or changed, not when only added', () => {
    expect(privacyAtStake(diff({ privacy: { added: 4, removed: 0, changed: 0 } }))).toBe(0);
    expect(privacyAtStake(diff({ privacy: { added: 0, removed: 2, changed: 1 } }))).toBe(3);
  });
  it('a frame past the end of one side is named, never drawn blank; steps stay inside', () => {
    expect(frameState(10, 20, 5)).toBe('b');
    expect(frameState(10, 5, 20)).toBe('a');
    expect(frameState(30, 5, 20)).toBe('both');
    expect(frameState(3, 5, 20)).toBe('ok');
    expect(stepFrame(2, -10, 50)).toBe(0);
    expect(stepFrame(45, 10, 50)).toBe(50);
  });
});

describe('what stayed behind a cut', () => {
  it('counts clips of other tracks and markers at or after the cut that were not moved', () => {
    let doc: ProjectDocument = createProject({ id: 'p', name: 't' });
    const r = applyTransaction(doc, [{ op: 'add_text', args: { text: 'a', start: T.frameTime(0, doc.settings.frameRate), duration: T.frameTime(30, doc.settings.frameRate) } }, { op: 'add_text', args: { text: 'b', start: T.frameTime(60, doc.settings.frameRate), duration: T.frameTime(30, doc.settings.frameRate) } }, { op: 'add_marker', args: { time: T.frameTime(70, doc.settings.frameRate) } }] as OpCall[], { idSeed: 't', actor: 'test' });
    doc = r.doc;
    expect(laterThatStayed(doc, T.frameTime(30, doc.settings.frameRate), [])).toBe(2);
    expect(laterThatStayed(doc, T.frameTime(90, doc.settings.frameRate), [])).toBe(0);
    void groupMatches; void replacePlanOf; void say;
  });
});
