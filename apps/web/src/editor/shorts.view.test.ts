/**
 * The pure helpers of the Shorts panel (shorts.view.ts): edge nudges by statement and by word, the review list's keys, the
 * selection cap, the length chips, and the rebuild helpers. Times are exact rationals; an edge only lands on a real edge.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Statement } from '@pulseframe/core';
import { handleReviewKey, LENGTH_CHIPS, lengthRange, nudgeEdge, reviewKey, SHORTS_MAX_SELECTED, toggleSelection, type NudgeContext, type ReviewEdges } from './shorts.view.ts';

const t = (n: number) => T.rt(n, 10); // tenths of a second
const sec = (x: T.RationalTime) => T.toSeconds(x);
const st = (id: string, a: number, b: number): Statement => ({ id, segmentId: 's', wordIds: [], start: t(a), end: t(b), text: id, endKind: 'period', endsSentence: true, question: false, startsWithConnective: false, timing: 'word', minConfidence: null, speaker: null });
// statements: [0,40] [50,100] [110,160] [170,230]; words every 10 tenths inside them
const statements = [st('a', 0, 40), st('b', 50, 100), st('c', 110, 160), st('d', 170, 230)];
const words = [0, 20, 50, 80, 110, 140, 170, 200].map((a) => ({ start: t(a), end: t(a + 15) }));
const ctx = (minSeconds = 5): NudgeContext => ({ statements, words, minSeconds });
const at = (a: number, b: number): ReviewEdges => ({ start: t(a), end: t(b) });

describe('nudgeEdge: statements', () => {
  it('the start moves to the previous and the next statement start, exactly', () => {
    const e = at(50, 160);
    expect(nudgeEdge(e, 'start', -1, 'statement', ctx()).start).toEqual(t(0));
    expect(nudgeEdge(e, 'start', 1, 'statement', ctx()).start).toEqual(t(110));
    expect(nudgeEdge(e, 'start', 1, 'statement', ctx()).end).toEqual(t(160));
  });
  it('the end moves to the previous and the next statement end, exactly', () => {
    const e = at(50, 160);
    expect(nudgeEdge(e, 'end', -1, 'statement', ctx()).end).toEqual(t(100));
    expect(nudgeEdge(e, 'end', 1, 'statement', ctx()).end).toEqual(t(230));
  });
  it('an edge that is between statement edges goes to the nearest one in that direction', () => {
    expect(nudgeEdge(at(60, 160), 'start', -1, 'statement', ctx()).start).toEqual(t(50));
    expect(nudgeEdge(at(60, 160), 'start', 1, 'statement', ctx()).start).toEqual(t(110));
  });
  it('nothing beyond the first or last statement: the edges stay', () => {
    expect(nudgeEdge(at(0, 160), 'start', -1, 'statement', ctx())).toEqual(at(0, 160));
    expect(nudgeEdge(at(50, 230), 'end', 1, 'statement', ctx())).toEqual(at(50, 230));
  });
});

describe('nudgeEdge: words (Alt)', () => {
  it('Alt moves by exactly one word: start edges are word starts, end edges are word ends', () => {
    expect(nudgeEdge(at(50, 160), 'start', 1, 'word', ctx()).start).toEqual(t(80));
    expect(nudgeEdge(at(50, 160), 'start', -1, 'word', ctx()).start).toEqual(t(20));
    expect(nudgeEdge(at(50, 160), 'end', -1, 'word', ctx()).end).toEqual(t(155));
    expect(nudgeEdge(at(50, 160), 'end', 1, 'word', ctx()).end).toEqual(t(185));
  });
  it('one step moves one word edge, never two', () => {
    let e = at(0, 230);
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) { e = nudgeEdge(e, 'start', 1, 'word', ctx(1)); seen.push(sec(e.start)); }
    expect(seen).toEqual([2, 5, 8]);
  });
});

describe('nudgeEdge: edges never cross and never get closer than minSeconds', () => {
  it('the start does not pass the end', () => {
    expect(nudgeEdge(at(110, 160), 'start', 1, 'statement', ctx(1))).toEqual(at(110, 160)); // the next start (170) is after the end
    expect(nudgeEdge(at(140, 150), 'start', 1, 'word', ctx(0))).toEqual(at(140, 150));
  });
  it('the end does not pass the start', () => {
    expect(nudgeEdge(at(50, 100), 'end', -1, 'statement', ctx(1))).toEqual(at(50, 100)); // the previous end (40) is before the start
  });
  it('a move that would leave less than minSeconds is refused', () => {
    // 5 s window; moving the start from 0 to 5 (statement b) would leave 4.0 s … for minSeconds 5 it is refused
    expect(nudgeEdge(at(0, 90), 'start', 1, 'statement', ctx(5))).toEqual(at(0, 90));
    expect(sec(nudgeEdge(at(0, 90), 'start', 1, 'statement', ctx(3)).start)).toBe(5);
    expect(nudgeEdge(at(50, 100), 'end', -1, 'word', ctx(5))).toEqual(at(50, 100)); // the previous word end (9.5 s) leaves 4.5 s
    expect(nudgeEdge(at(50, 100), 'end', -1, 'word', ctx(4)).end).toEqual(t(95));
  });
  it('after any number of random steps the edges stay ordered and at least minSeconds apart', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let e = at(50, 160);
    for (let i = 0; i < 400; i++) {
      e = nudgeEdge(e, rnd() < 0.5 ? 'start' : 'end', rnd() < 0.5 ? -1 : 1, rnd() < 0.5 ? 'statement' : 'word', ctx(4));
      expect(T.lt(e.start, e.end)).toBe(true);
      expect(sec(e.end) - sec(e.start)).toBeGreaterThanOrEqual(4 - 1e-9);
    }
  });
});

describe('the review list keys', () => {
  const ev = (code: string, m: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({ code, shiftKey: false, altKey: false, ...m });
  it('maps [ ] to the start by statements, Shift to the end, Alt to words', () => {
    expect(reviewKey(ev('BracketLeft'))).toEqual({ kind: 'nudge', edge: 'start', dir: -1, unit: 'statement' });
    expect(reviewKey(ev('BracketRight'))).toEqual({ kind: 'nudge', edge: 'start', dir: 1, unit: 'statement' });
    expect(reviewKey(ev('BracketLeft', { shiftKey: true }))).toEqual({ kind: 'nudge', edge: 'end', dir: -1, unit: 'statement' });
    expect(reviewKey(ev('BracketRight', { shiftKey: true }))).toEqual({ kind: 'nudge', edge: 'end', dir: 1, unit: 'statement' });
    expect(reviewKey(ev('BracketRight', { altKey: true }))).toEqual({ kind: 'nudge', edge: 'start', dir: 1, unit: 'word' });
    expect(reviewKey(ev('BracketLeft', { shiftKey: true, altKey: true }))).toEqual({ kind: 'nudge', edge: 'end', dir: -1, unit: 'word' });
    expect(reviewKey(ev('Space'))).toEqual({ kind: 'preview' });
    expect(reviewKey(ev('Enter'))).toEqual({ kind: 'toggle' });
  });
  it('other keys and chords with Ctrl or Meta are not the list\'s', () => {
    for (const code of ['KeyA', 'ArrowLeft', 'Comma', 'Period', 'Tab']) expect(reviewKey(ev(code))).toBeNull();
    expect(reviewKey(ev('BracketLeft', { ctrlKey: true }))).toBeNull();
    expect(reviewKey(ev('Enter', { metaKey: true }))).toBeNull();
  });
  it('the handler reports handled and stops the event for BracketLeft, BracketRight, Space and Enter, and leaves the rest', () => {
    for (const code of ['BracketLeft', 'BracketRight', 'Space', 'Enter']) {
      const calls: string[] = [];
      const acts: string[] = [];
      const handled = handleReviewKey({ ...ev(code), preventDefault: () => calls.push('prevent'), stopPropagation: () => calls.push('stop') }, (a) => acts.push(a.kind));
      expect(handled, code).toBe(true);
      expect(calls, code).toEqual(['prevent', 'stop']);
      expect(acts, code).toHaveLength(1);
    }
    const calls: string[] = [];
    expect(handleReviewKey({ ...ev('KeyX'), preventDefault: () => calls.push('p'), stopPropagation: () => calls.push('s') }, () => calls.push('act'))).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('selection', () => {
  it('toggles on and off', () => {
    expect(toggleSelection([], 'a')).toEqual({ selected: ['a'], capped: false });
    expect(toggleSelection(['a', 'b'], 'a')).toEqual({ selected: ['b'], capped: false });
  });
  it('is capped at 10: the eleventh is ignored and reported, an unselect past the cap still works', () => {
    expect(SHORTS_MAX_SELECTED).toBe(10);
    let sel: string[] = [];
    for (let i = 0; i < 10; i++) sel = toggleSelection(sel, `c${i}`).selected;
    expect(sel).toHaveLength(10);
    expect(toggleSelection(sel, 'c10')).toEqual({ selected: sel, capped: true });
    expect(toggleSelection(sel, 'c3').selected).toHaveLength(9);
  });
});

describe('length chips', () => {
  it('a chip of T asks for 0.6·T to 1.25·T inside what the finder accepts', () => {
    expect([...LENGTH_CHIPS]).toEqual([15, 30, 45, 60, 90]);
    expect(lengthRange(30)).toEqual({ minSeconds: 18, maxSeconds: 37.5 });
    expect(lengthRange(60)).toEqual({ minSeconds: 36, maxSeconds: 75 });
    for (const c of LENGTH_CHIPS) { const r = lengthRange(c); expect(r.minSeconds).toBeGreaterThanOrEqual(5); expect(r.maxSeconds).toBeLessThanOrEqual(180); expect(r.minSeconds).toBeLessThan(r.maxSeconds); }
  });
});
