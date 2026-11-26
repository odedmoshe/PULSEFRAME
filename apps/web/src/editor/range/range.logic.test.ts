import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type ProjectDocument } from '@pulseframe/core';
import { NO_RANGE, dragMark, fullRange, markIn, markOut, rangeCutPlan } from './range.logic.ts';
import { rangeKeysHere } from './range.commands.ts';
import { RANGE_STRINGS } from './range.strings.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);

describe('marks', () => {
  it('I sets the start, O the end after the playhead frame; a second press on the same frame clears that mark', () => {
    let r = markIn(NO_RANGE, 10);
    expect(r).toEqual({ in: 10, out: null });
    r = markOut(r, 39);
    expect(r).toEqual({ in: 10, out: 40 });
    expect(fullRange(r)).toBe(true);
    expect(markIn(r, 10)).toEqual({ in: null, out: 40 });
    expect(markOut(r, 39)).toEqual({ in: 10, out: null });
  });
  it('never an empty or backwards range: a start at or past the end drops the end, an end at or before the start drops the start', () => {
    expect(markIn({ in: 10, out: 40 }, 40)).toEqual({ in: 40, out: null });
    expect(markOut({ in: 10, out: 40 }, 9)).toEqual({ in: null, out: 10 });
    expect(markOut({ in: 10, out: null }, 10)).toEqual({ in: 10, out: 11 });
  });
  it('a dragged flag stays on its side of the other one and inside the film', () => {
    expect(dragMark({ in: 10, out: 40 }, 'in', 55, 299)).toEqual({ in: 39, out: 40 });
    expect(dragMark({ in: 10, out: 40 }, 'in', -5, 299)).toEqual({ in: 0, out: 40 });
    expect(dragMark({ in: 10, out: 40 }, 'out', 3, 299)).toEqual({ in: 10, out: 11 });
    expect(dragMark({ in: 10, out: 40 }, 'out', 900, 299)).toEqual({ in: 10, out: 300 });
  });
});

/** Two titles, 0–90 and 90–120, on one text track, and a marker at 100 (frames at 30 fps). */
function project(locked = false): ProjectDocument {
  let d = applyTransaction(createProject({ id: 'prj_range', name: 'range', width: 320, height: 180, frameRate: R }), [{ op: 'add_text', args: { text: 'a', start: f(0), duration: f(90) } }, { op: 'add_text', args: { text: 'b', start: f(90), duration: f(30) } }, { op: 'add_marker', args: { time: f(100) } }], { idSeed: 'x_', actor: 'test' }).doc;
  if (locked) { const tr = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.clips.length)!; d = applyTransaction(d, [{ op: 'update_track', args: { trackId: tr.id, locked: true } }], { idSeed: 'y_', actor: 'test' }).doc; }
  return d;
}

describe('rangeCutPlan', () => {
  it('is ONE cut_range op over [in, out): applied, it removes exactly that stretch from every track and later material and markers move earlier', () => {
    const d = project();
    const plan = rangeCutPlan(d, { in: 30, out: 60 }, R);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toEqual({ op: 'cut_range', args: { start: f(30), end: f(60) } });
    const after = applyTransaction(d, plan.ops, { idSeed: 'c_', actor: 'test' }).doc;
    const clips = after.sequences[after.mainSequenceId]!.tracks.flatMap((t) => t.clips).map((c) => [T.frameIndexAt(c.start, R), T.frameIndexAt(c.duration, R)]).sort((a, b) => a[0]! - b[0]!);
    expect(clips).toEqual([[0, 30], [30, 30], [60, 30]]); // 0–90 lost 30–60; 90–120 moved to 60–90
    expect(Object.values(after.markers ?? {}).map((m) => T.frameIndexAt(m.time, R))).toEqual([70]);
  });
  it('holds the end to the end of the material, and refuses a range that starts after it', () => {
    const d = project();
    const p = rangeCutPlan(d, { in: 100, out: 500 }, R);
    expect(p.ok && p.end).toBe(120);
    expect(rangeCutPlan(d, { in: 120, out: 500 }, R)).toEqual({ ok: false, why: 'past_end' });
  });
  it('refuses without both marks, without a project, and while a track is locked (naming it); nothing is sent', () => {
    const d = project();
    expect(rangeCutPlan(d, { in: 10, out: null }, R)).toEqual({ ok: false, why: 'need_both' });
    expect(rangeCutPlan(null, { in: 1, out: 5 }, R)).toEqual({ ok: false, why: 'no_project' });
    const locked = rangeCutPlan(project(true), { in: 10, out: 20 }, R);
    expect(locked.ok).toBe(false);
    if (!locked.ok) { expect(locked.why).toBe('locked'); expect(locked.tracks?.length).toBe(1); }
  });
  it('every refusal pairs the reason with the next step, in Hebrew and English', () => {
    for (const S of [RANGE_STRINGS.he, RANGE_STRINGS.en]) for (const s of [S.needBoth, S.pastEnd, S.locked('T1'), S.noProject]) expect(s).toMatch(/:\s*\S/);
  });
});

describe('rangeKeysHere (I and O belong to the timeline, never to a dialog or another panel)', () => {
  const docWith = (active: { closest: (s: string) => unknown } | 'body' | null, modal = false) => {
    const body = {};
    return { body, documentElement: {}, activeElement: active === 'body' ? body : active, querySelector: (s: string) => (modal && s.includes('aria-modal') ? {} : null) } as unknown as Document;
  };
  it('on the page, the timeline or the stage: yes', () => {
    expect(rangeKeysHere(docWith('body'))).toBe(true);
    expect(rangeKeysHere(docWith(null))).toBe(true);
    expect(rangeKeysHere(docWith({ closest: () => ({}) }))).toBe(true);
  });
  it('inside another panel or behind a modal (the source viewer has its own I and O): no', () => {
    expect(rangeKeysHere(docWith({ closest: () => null }))).toBe(false);
    expect(rangeKeysHere(docWith('body', true))).toBe(false);
  });
});

describe('wording', () => {
  it('a track name inside the refusal is isolated, so a Latin name keeps its order in the Hebrew sentence', () => {
    expect(RANGE_STRINGS.he.locked('A1')).toContain('⁨A1⁩');
    expect(RANGE_STRINGS.en.locked('A1')).toContain('⁨A1⁩');
  });
});
