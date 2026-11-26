import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { FrameGate, GRAB_PX, SNAP_PX, cutFrames, frameAtX, snapFrame, xOfFrame } from './scrub.logic.ts';

const R30 = { num: 30, den: 1 }, NTSC = { num: 30000, den: 1001 };

describe('frameAtX', () => {
  it('rounds to the nearest whole frame and clamps to [0, last]', () => {
    expect(frameAtX(90, 90, R30, 299)).toBe(30);
    expect(frameAtX(91.4, 90, R30, 299)).toBe(30);
    expect(frameAtX(92, 90, R30, 299)).toBe(31);
    expect(frameAtX(-40, 90, R30, 299)).toBe(0);
    expect(frameAtX(1e6, 90, R30, 299)).toBe(299);
    expect(frameAtX(Number.NaN, 90, R30, 299)).toBe(0);
  });
  it('round-trips through xOfFrame at a fractional rate', () => {
    for (const f of [0, 1, 29, 30, 1799, 17982]) expect(frameAtX(xOfFrame(f, 37.5, NTSC), 37.5, NTSC, 1e6)).toBe(f);
  });
  it('the grab area is at least 24 px wide (brief P5 a)', () => expect(GRAB_PX).toBeGreaterThanOrEqual(24));
});

describe('snapFrame', () => {
  const cuts = [0, 45, 120];
  it('sticks to an edit point within 6 px, else follows the pointer', () => {
    const at45 = xOfFrame(45, 90, R30); // 135 px
    expect(snapFrame(at45 + SNAP_PX, 90, R30, 299, cuts, true)).toEqual({ frame: 45, snapped: true });
    expect(snapFrame(at45 - SNAP_PX, 90, R30, 299, cuts, true)).toEqual({ frame: 45, snapped: true });
    expect(snapFrame(at45 + SNAP_PX + 1, 90, R30, 299, cuts, true)).toEqual({ frame: frameAtX(at45 + 7, 90, R30, 299), snapped: false });
  });
  it('Alt (snap off) never sticks', () => expect(snapFrame(xOfFrame(45, 90, R30) + 2, 90, R30, 299, cuts, false)).toEqual({ frame: 46, snapped: false }));
  it('the nearest edit point wins; a point past the last frame is ignored', () => {
    expect(snapFrame(xOfFrame(46, 900, R30) - 1, 900, R30, 299, [45, 46], true).frame).toBe(46);
    expect(snapFrame(xOfFrame(120, 90, R30), 90, R30, 100, cuts, true)).toEqual({ frame: 100, snapped: false });
  });
});

describe('cutFrames', () => {
  it('0 and every clip start and end, once each, ascending', () => {
    const clip = (id: string, s: number, d: number) => ({ id, type: 'media', start: T.frameTime(s, R30), duration: T.frameTime(d, R30) });
    const doc = { mainSequenceId: 's', sequences: { s: { tracks: [{ clips: [clip('a', 10, 20), clip('b', 30, 5)] }, { clips: [clip('c', 0, 30)] }] } } } as unknown as ProjectDocument;
    expect(cutFrames(doc, R30)).toEqual([0, 10, 30, 35]);
    expect(cutFrames(null, R30)).toEqual([]);
  });
});

describe('FrameGate', () => {
  const make = () => {
    const sought: number[] = [];
    let queued: (() => void)[] = [];
    const g = new FrameGate((f) => sought.push(f), (cb) => { queued.push(cb); return queued.length; }, () => { queued = []; });
    const frame = () => { const q = queued; queued = []; q.forEach((cb) => cb()); };
    return { g, sought, frame, pending: () => queued.length };
  };
  it('many moves inside one animation frame make one seek, to the last position', () => {
    const { g, sought, frame, pending } = make();
    g.start(0);
    for (const f of [3, 7, 12, 9]) g.want(f);
    expect(pending()).toBe(1); // never more than one callback scheduled
    expect(sought).toEqual([]);
    frame();
    expect(sought).toEqual([9]);
  });
  it('a wish equal to the frame already sought seeks nothing; release flushes the pending wish at once', () => {
    const { g, sought, frame } = make();
    g.start(5);
    g.want(5); frame();
    expect(sought).toEqual([]);
    g.want(6); g.flush();
    expect(sought).toEqual([6]);
    frame();
    expect(sought).toEqual([6]);
    expect(g.seeks).toBe(1);
  });
  it('cancel drops the wish', () => {
    const { g, sought, frame } = make();
    g.start(0); g.want(4); g.cancel(); frame();
    expect(sought).toEqual([]);
  });
});

describe('which press starts a scrub (wave 8D integration)', () => {
  it('a left press does, whether or not the browser marks it primary; a second finger and other buttons do not', async () => {
    const { pressStartsScrub } = await import('./scrub.logic.ts');
    expect(pressStartsScrub({ button: 0, isPrimary: true, pointerType: 'mouse' })).toBe(true);
    // a pointer event made by a script (proofs, assistive tools) is not "primary" unless it says so; it is still a press on the ruler
    expect(pressStartsScrub({ button: 0, isPrimary: false, pointerType: '' })).toBe(true);
    expect(pressStartsScrub({ button: 0, isPrimary: false, pointerType: 'touch' })).toBe(false);
    expect(pressStartsScrub({ button: 2, isPrimary: true, pointerType: 'mouse' })).toBe(false);
  });
});
