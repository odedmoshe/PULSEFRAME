/** Lane and sheet-line logic of the render cache (ADR-0024): runs to pixel stretches, stale list, summary, refresh policy. */
import { describe, expect, it } from 'vitest';
import type { SegmentPlanView, SegmentRun } from '@pulseframe/core';
import { RefreshPolicy, clockOf, frameRangeOf, autoRefresh, laneStretches, laneVisible, planSummary, staleStretchCount, staleStretches, videoSeconds, type RefreshTimers } from './renderCache.logic.ts';

const cache = { enabled: true, capBytes: 2 ** 31, usedBytes: 0, segments: 0, highWaterBytes: 0, autoClear: true, minFreeBytes: 2 ** 30 };
function view(runs: SegmentRun[], over: Partial<SegmentPlanView> = {}): SegmentPlanView {
  const by = (s: string) => runs.filter((r) => r.state === s).reduce((n, r) => n + r.segments, 0);
  const total = runs.reduce((n, r) => n + r.segments, 0);
  return {
    revision: 3, mode: 'incremental', segFrames: 60, firstFrame: 0, frames: runs.reduce((n, r) => n + r.frames, 0),
    segments: { total, cached: by('cached'), render: by('render'), uncacheable: by('uncacheable') },
    framesToRender: runs.filter((r) => r.state !== 'cached').reduce((n, r) => n + r.frames, 0),
    runs, uncacheable: [], estimate: { seconds: null, basis: '', bytesToStore: null }, cache, keyingMs: 40, ...over,
  };
}
const run = (state: SegmentRun['state'], firstSegment: number, segments: number, firstFrame: number, frames: number): SegmentRun => ({ state, firstSegment, segments, firstFrame, frames });
const R30 = { num: 30, den: 1 };
const R2997 = { num: 30000, den: 1001 };
// the proof's shape: 300 segments, the two under one title changed
const edited = view([run('cached', 0, 10, 0, 600), run('render', 10, 2, 600, 120), run('cached', 12, 288, 720, 17281)]);

describe('laneStretches', () => {
  it('maps runs to exact pixels, left to right', () => {
    const s = laneStretches(edited, 50, R30);
    expect(s.map((x) => [x.state, x.x, x.width, x.firstFrame, x.frames, x.segments])).toEqual([
      ['cached', 0, 1000, 0, 600, 10], ['render', 1000, 200, 600, 120, 2], ['cached', 1200, 28801.666666666668, 720, 17281, 288],
    ]);
    for (let i = 1; i < s.length; i++) expect(s[i]!.x).toBeCloseTo(s[i - 1]!.x + s[i - 1]!.width, 6);
  });
  it('uses the exact rational rate, not 29.97', () => {
    const s = laneStretches(view([run('render', 0, 1, 0, 1001)]), 100, R2997);
    expect(s[0]!.width).toBeCloseTo((1001 * 1001 * 100) / 30000, 9);
    expect(laneStretches(view([run('render', 0, 1, 0, 30000)]), 100, R2997)[0]!.width).toBeCloseTo(100 * 1001, 6);
  });
  it('offsets runs by the exported range (programme frames)', () => {
    const v = view([run('render', 0, 1, 0, 60)], { firstFrame: 90 });
    const s = laneStretches(v, 30, R30)[0]!;
    expect(s.firstFrame).toBe(90);
    expect(s.x).toBe(90);
  });
  it('draws nothing for an empty plan or an unusable scale', () => {
    expect(laneStretches(view([]), 50, R30)).toEqual([]);
    expect(laneStretches(edited, 0, R30)).toEqual([]);
    expect(laneStretches(edited, 50, { num: 0, den: 1 })).toEqual([]);
  });
  it('keeps the uncacheable state', () => {
    expect(laneStretches(view([run('uncacheable', 0, 2, 0, 120)]), 10, R30)[0]!.state).toBe('uncacheable');
  });
});

describe('staleStretches', () => {
  it('lists render runs only, in programme order, with programme frames', () => {
    expect(staleStretches(edited)).toEqual([{ firstFrame: 600, frames: 120, segments: 2 }]);
  });
  it('is capped at 8 and says how many there are', () => {
    const runs: SegmentRun[] = [];
    for (let i = 0; i < 12; i++) { runs.push(run('cached', i * 2, 1, i * 120, 60)); runs.push(run('render', i * 2 + 1, 1, i * 120 + 60, 60)); }
    const v = view(runs);
    expect(staleStretches(v)).toHaveLength(8);
    expect(staleStretches(v, 3).map((s) => s.firstFrame)).toEqual([60, 180, 300]);
    expect(staleStretchCount(v)).toBe(12);
  });
  it('merges neighbouring render runs and does not list uncacheable ones', () => {
    const v = view([run('render', 0, 1, 0, 60), run('render', 1, 2, 60, 120), run('uncacheable', 3, 1, 180, 60)]);
    expect(staleStretches(v)).toEqual([{ firstFrame: 0, frames: 180, segments: 3 }]);
  });
  it('is empty when nothing changed', () => { expect(staleStretches(view([run('cached', 0, 5, 0, 300)]))).toEqual([]); });
});

describe('planSummary', () => {
  it('counts and recognises the first export and the unchanged project', () => {
    expect(planSummary(edited)).toMatchObject({ total: 300, cached: 298, render: 2, uncacheable: 0, framesToRender: 120, first: false, nothingChanged: false });
    expect(planSummary(view([run('render', 0, 300, 0, 18000)]))).toMatchObject({ first: true, nothingChanged: false });
    expect(planSummary(view([run('cached', 0, 300, 0, 18000)]))).toMatchObject({ first: false, nothingChanged: true });
  });
  it('uncacheable segments mean something is rendered every time: not "nothing changed"', () => {
    expect(planSummary(view([run('cached', 0, 4, 0, 240), run('uncacheable', 4, 1, 240, 60)])).nothingChanged).toBe(false);
  });
  it('an empty plan is neither', () => { expect(planSummary(view([]))).toMatchObject({ first: false, nothingChanged: false, total: 0 }); });
});

describe('autoRefresh, videoSeconds, laneVisible', () => {
  it('refreshes by itself with no plan yet and below 2000 ms of keying', () => {
    expect(autoRefresh(null)).toBe(true);
    expect(autoRefresh(1999)).toBe(true);
    expect(autoRefresh(2000)).toBe(false);
    expect(autoRefresh(9000)).toBe(false);
  });
  it('words 120 frames at 30 fps as 4 seconds and 1 frame as 1', () => {
    expect(videoSeconds(120, R30)).toBe(4);
    expect(videoSeconds(1, R30)).toBe(1);
    expect(videoSeconds(0, R30)).toBe(0);
    expect(videoSeconds(1920, R2997)).toBe(64);
  });
  it('hides the lane when off, and while there is nothing to show', () => {
    expect(laneVisible('off', edited)).toBe(false);
    expect(laneVisible('ready', edited)).toBe(true);
    expect(laneVisible('updating', edited)).toBe(true);
    expect(laneVisible('updating', null)).toBe(true);
    expect(laneVisible('ready', null)).toBe(false);
    expect(laneVisible('error', null)).toBe(false);
  });
});

class FakeTimers implements RefreshTimers {
  now = 0; private next = 1; private jobs = new Map<number, { at: number; fn: () => void }>();
  set(fn: () => void, ms: number) { const id = this.next++; this.jobs.set(id, { at: this.now + ms, fn }); return id; }
  clear(h: unknown) { this.jobs.delete(h as number); }
  advance(ms: number) {
    const to = this.now + ms;
    for (;;) {
      const due = [...this.jobs.entries()].filter(([, j]) => j.at <= to).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.jobs.delete(due[0]); this.now = due[1].at; due[1].fn();
    }
    this.now = to;
  }
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('RefreshPolicy', () => {
  it('plans 1.5 s after the LAST change, not after the first', async () => {
    const t = new FakeTimers(); const calls: number[] = [];
    const p = new RefreshPolicy(async (_s, rev) => { calls.push(rev); return { keyingMs: 10 }; }, t);
    p.changed(1); t.advance(1000); p.changed(2); t.advance(1000); p.changed(3);
    expect(calls).toEqual([]);
    t.advance(1499); expect(calls).toEqual([]);
    t.advance(1); await tick(); expect(calls).toEqual([3]);
  });
  it('aborts the request in flight when a newer change arrives', async () => {
    const t = new FakeTimers(); const signals: AbortSignal[] = [];
    const p = new RefreshPolicy((s) => { signals.push(s); return new Promise(() => {}); }, t);
    p.changed(1); t.advance(1500); await tick();
    expect(signals).toHaveLength(1); expect(signals[0]!.aborted).toBe(false);
    expect(p.pending).toBe(true);
    p.changed(2);
    expect(signals[0]!.aborted).toBe(true);
    t.advance(1500); await tick();
    expect(signals).toHaveLength(2); expect(signals[1]!.aborted).toBe(false);
  });
  it('a superseded request that rejects with its abort is swallowed, never an unhandled rejection; a real failure still rejects (review item)', async () => {
    const t = new FakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      // the documented use: the signal goes to fetch, which rejects with an AbortError when it is aborted
      const p = new RefreshPolicy((s) => new Promise((_r, reject) => s.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))), t);
      p.changed(1); t.advance(1500); await tick();
      p.changed(2); // aborts the first
      await tick(); await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toEqual([]);
      // control: a failure of a request nobody aborted is not hidden
      const failing = new RefreshPolicy(async () => { throw new Error('plan route 500'); }, t);
      await expect(failing.now(3)).rejects.toThrow('plan route 500');
    } finally { process.off('unhandledRejection', onUnhandled); }
  });
  it('stops scheduling by itself after a slow keying; the button still asks', async () => {
    const t = new FakeTimers(); const calls: number[] = [];
    const p = new RefreshPolicy(async (_s, rev) => { calls.push(rev); return { keyingMs: 4500 }; }, t);
    p.changed(1); t.advance(1500); await tick();
    expect(calls).toEqual([1]);
    expect(p.changed(2)).toBe(false); t.advance(5000); await tick();
    expect(calls).toEqual([1]);
    await p.now(2);
    expect(calls).toEqual([1, 2]);
  });
  it('a disposed policy asks for nothing', async () => {
    const t = new FakeTimers(); const calls: number[] = [];
    const p = new RefreshPolicy(async (_s, rev) => { calls.push(rev); }, t);
    p.changed(1); p.dispose(); t.advance(5000); await tick();
    await p.now(2);
    expect(calls).toEqual([]);
    expect(p.pending).toBe(false);
  });
});

describe('clockOf and frameRangeOf', () => {
  it('floors exact seconds and writes the frame range first to last', () => {
    expect(clockOf(600, R30)).toBe('0:20');
    expect(clockOf(1799, R30)).toBe('0:59');
    expect(clockOf(1800, R30)).toBe('1:00');
    expect(clockOf(30000, R2997)).toBe('16:41');
    expect(frameRangeOf({ firstFrame: 600, frames: 120 })).toBe('600–719');
    expect(frameRangeOf({ firstFrame: 5, frames: 1 })).toBe('5');
  });
});
