/** Pure logic of the living block and depth dialog. The DepthGrid in the overlay test is a labelled stand-in (core depthGrid is W1's). */
import { describe, expect, it } from 'vitest';
import { LIVING_RAMP_START, MAX_DEPTH_NUMBERS, MAX_DEPTH_STROKES, MAX_STROKE_NUMBERS, type ClipDepth, type DepthGrid } from '@pulseframe/core';
import {
  addStroke, amountFor, applyOp, canAddStroke, changeOp, clampHorizon, extendStroke, horizonAfterKey, moveAfterKey, newStroke, overlayPixels, popStroke, removeOp, replacedAny, saveOp, setFlat, setHorizon, toUnits, type LivingView,
} from './living.logic.ts';

const view = (o: Partial<LivingView> = {}): LivingView => ({ kind: 'offer', reason: null, tooShort: false, move: 'push', amount: 0.5, curve: 'ease-in-out', frames: 150, maxAmount: 1, capped: false, depth: null, strokes: 0, unavailable: null, refit: false, shown: { width: 100, height: 50 }, ...o });

describe('ops', () => {
  it('first apply is ONE set_living_picture carrying the depth; later saves are set_clip_depth', () => {
    expect(saveOp(view(), 'c1', LIVING_RAMP_START)).toEqual(applyOp('c1', LIVING_RAMP_START, 'push', 0.5));
    expect(saveOp(view({ maxAmount: 0.3 }), 'c1', LIVING_RAMP_START).args).toMatchObject({ amount: 0.3 });
    expect(saveOp(view({ kind: 'on' }), 'c1', LIVING_RAMP_START)).toEqual({ op: 'set_clip_depth', args: { clipId: 'c1', depth: LIVING_RAMP_START } });
    expect(removeOp('c1').args).toEqual({ clipId: 'c1', remove: true });
    expect(changeOp('c1', 'slide', 0.2).args).toEqual({ clipId: 'c1', move: 'slide', amount: 0.2 });
  });
  it('amountFor never exceeds the cap and rounds down to hundredths', () => {
    expect(amountFor(0.5, 0.43)).toBe(0.43);
    expect(amountFor(0.456, 1)).toBe(0.45);
    expect(replacedAny({ replacedMotion: ['motion.move.ken-burns-in'] })).toBe(true);
    expect(replacedAny({ replacedMotion: [] })).toBe(false);
    expect(replacedAny(undefined)).toBe(false);
  });
});
describe('move chips', () => {
  it('arrow keys follow the reading direction', () => {
    expect(moveAfterKey('ArrowLeft', 'he', 'push')).toBe('slide');
    expect(moveAfterKey('ArrowRight', 'he', 'slide')).toBe('push');
    expect(moveAfterKey('ArrowRight', 'en', 'push')).toBe('slide');
    expect(moveAfterKey('a', 'en', 'push')).toBeNull();
  });
});
describe('depth editing', () => {
  it('horizon moves in 1/100 steps and stays in range', () => {
    expect(horizonAfterKey('ArrowDown', 450)).toBe(460);
    expect(horizonAfterKey('ArrowUp', 5)).toBe(0);
    expect(horizonAfterKey('End', 450)).toBe(999);
    expect(horizonAfterKey('x', 450)).toBeNull();
    expect(clampHorizon(1500)).toBe(999);
    expect(setHorizon(setFlat(LIVING_RAMP_START), 300).base).toEqual({ kind: 'ramp', horizon: 300 });
  });
  it('pointer to units', () => {
    expect(toUnits(150, 75, { left: 100, top: 50, width: 200, height: 100 })).toEqual([250, 250]);
    expect(toUnits(-5, 999, { left: 0, top: 0, width: 10, height: 10 })).toEqual([0, 1000]);
  });
  it('strokes: add, pop, limits', () => {
    let d: ClipDepth = LIVING_RAMP_START;
    d = addStroke(d, newStroke('near', 60, 10, 10));
    expect(d.strokes).toHaveLength(1);
    expect(popStroke(d).strokes).toHaveLength(0);
    let s = newStroke('far', 9999, 0, 0);
    expect(s.size).toBe(300);
    expect(extendStroke(d, s, 1, 1)).toBe(s); // closer than 2 units: dropped
    for (let i = 0; i < 400; i++) s = extendStroke(d, s, (i * 7) % 1000, (i * 13) % 1000);
    expect(s.pts.length).toBe(MAX_STROKE_NUMBERS);
    let full: ClipDepth = LIVING_RAMP_START;
    for (let i = 0; i < MAX_DEPTH_STROKES + 3; i++) full = addStroke(full, newStroke('near', 20, 5, 5));
    expect(full.strokes).toHaveLength(MAX_DEPTH_STROKES);
    expect(canAddStroke(full)).toBe(false);
    expect(MAX_DEPTH_NUMBERS).toBeGreaterThanOrEqual(MAX_DEPTH_STROKES * 2);
  });
  it('overlay: light is near (stand-in grid, not core depthGrid)', () => {
    const g: DepthGrid = { width: 2, height: 1, data: new Uint8Array([0, 255]) };
    expect([...overlayPixels(g)]).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
});
