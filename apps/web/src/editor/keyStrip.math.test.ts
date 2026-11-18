import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Clip, KeyAt } from '@pulseframe/core';
import { keyTimes } from '@pulseframe/core';
import { clampDelta, framesForPixels, glyphOf, isDrag, isSelected, nudgeBounds, pruneKeySel, remapKeySel, selectFrame, stripLayout } from './keyStrip.math.ts';

const rate = { num: 30, den: 1 };
const key = (f: number, value = 0, easing: 'linear' | 'hold' | 'smooth' = 'linear') => ({ time: T.frameTime(f, rate), value, easing });
const clip = { id: 'c', type: 'media', start: T.ZERO, duration: T.frameTime(100, rate), keyframes: { x: [key(-3), key(10), key(100)], y: [key(10, 0, 'hold')], opacity: [key(40, 1, 'smooth')] } } as unknown as Clip;
const track = { id: 't', kind: 'video', name: '', locked: false, muted: false, hidden: false, clips: [] } as never;

describe('stripLayout', () => {
  const keys = keyTimes(clip, track, rate);
  it('aggregates by exact frame and counts keys outside the clip for the edge chips', () => {
    expect(keys.map((k) => k.frame)).toEqual([-3, 10, 40, 100]);
    const l = stripLayout(keys, rate, 90);
    expect(l.dots.map((d) => d.at.frame)).toEqual([10, 40]);
    expect(l.dots[0]!.at.channels).toHaveLength(2);
    expect(l.dots[0]!.x).toBeCloseTo((10 / 30) * 90, 9);
    expect([l.before, l.after]).toEqual([1, 1]);
  });
});
describe('glyphs', () => {
  it('shows the shared curve, or mixed', () => {
    expect(glyphOf(['linear', 'linear'])).toBe('diamond');
    expect(glyphOf(['smooth', 'ease-in'])).toBe('soft');
    expect(glyphOf(['bounce'])).toBe('burst');
    expect(glyphOf(['linear', 'hold'])).toBe('mixed');
    expect(glyphOf(['bezier'])).toBe('custom');
  });
});
describe('drag and nudge bounds', () => {
  it('counts whole frames and has a 3 px threshold', () => {
    expect(framesForPixels(45, 90, rate)).toBe(15);
    expect(framesForPixels(2, 90, rate)).toBe(1);
    expect(isDrag(2, 2)).toBe(false);
    expect(isDrag(3, 0)).toBe(true);
  });
  it('keeps every selected key inside [0, count − 1]', () => {
    expect(nudgeBounds([5, 20], 100)).toEqual([-5, 79]);
    expect(clampDelta(-50, [5, 20], 100)).toBe(-5);
    expect(clampDelta(200, [5, 20], 100)).toBe(79);
    expect(nudgeBounds([-4, 120], 100)).toEqual([0, 0]); // keys outside the clip do not move
  });
});
describe('selection', () => {
  const at = keyTimes(clip, track, rate)[1] as KeyAt;
  it('selects a frame, toggles it, and tells all from some', () => {
    const s = selectFrame(null, 'c', at, false);
    expect(s.keys).toHaveLength(2);
    expect(isSelected(s, 'c', at)).toBe('all');
    expect(isSelected({ ...s, keys: s.keys.slice(0, 1) }, 'c', at)).toBe('some');
    expect(selectFrame(s, 'c', at, true).keys).toEqual([]);
    expect(isSelected(s, 'other', at)).toBe('none');
  });
  it('remaps after a move and prunes what is gone', () => {
    const s = selectFrame(null, 'c', at, false);
    const m = remapKeySel(s, 5, 100);
    expect(m.keys.map((k) => k.frame)).toEqual([15, 15]);
    expect(pruneKeySel(m, () => clip, rate)).toBeNull();
    expect(pruneKeySel(s, () => clip, rate)?.keys).toHaveLength(2);
    expect(pruneKeySel(s, () => undefined, rate)).toBeNull();
    expect(pruneKeySel(null, () => clip, rate)).toBeNull();
  });
});
