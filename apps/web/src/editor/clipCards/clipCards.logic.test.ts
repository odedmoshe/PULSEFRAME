import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { BLEND_MODES, CURVES, type Clip, type Track } from '@pulseframe/core';
import { BLEND_MAIN, atSize, blendMoreOpen, blendRest, chipAt, chipTime, curveAt, easeIntoOps, easeMoreOpen, easeRest, easingInto, EASE_MAIN, fitSizes, keyChips, segmentsInto, tileLine, zoomText } from './clipCards.logic.ts';
import { BLEND_WORDS, CLIP_CARD_STRINGS } from './clipCards.strings.ts';
import { tilePoints } from '../curvePicker.math.ts';

const rate = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, rate);
const clip = (keyframes: Record<string, { time: T.RationalTime; value: number; easing: string }[]>): Clip =>
  ({ id: 'c1', type: 'media', assetId: 'a', start: f(30), duration: f(150), sourceIn: f(0), transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes }) as unknown as Clip;
const track = { id: 't', kind: 'video', name: 'V1', clips: [] } as unknown as Track;

describe('fit sizes', () => {
  it('fit, fill and original for a 4:3 picture in a 16:9 frame', () => {
    const s = fitSizes(1920, 1080, 1440, 1080, 'contain')!;
    expect(s.fit).toBe(1);
    expect(s.fill).toBeCloseTo(1920 / 1440, 3);
    expect(s.original).toBe(1); // 1440x1080 shown contained is already 1:1
    expect(s.originalInRange).toBe(true);
  });
  it('original is out of range for a huge picture and says so', () => {
    const s = fitSizes(1920, 1080, 40000, 30000, 'contain')!;
    expect(s.original).toBeGreaterThan(20);
    expect(s.originalInRange).toBe(false);
  });
  it('unknown picture size gives null', () => { expect(fitSizes(1920, 1080, undefined, 10)).toBeNull(); });
  it('atSize needs a centred picture at that scale', () => {
    expect(atSize({ scale: 1.2, x: 0, y: 0 }, 1.2)).toBe(true);
    expect(atSize({ scale: 1.2, x: 0.1, y: 0 }, 1.2)).toBe(false);
  });
});

describe('blend pills', () => {
  it('main pills are existing modes, rest are the others, none lost or repeated', () => {
    expect([...BLEND_MAIN, ...blendRest()].sort()).toEqual([...BLEND_MODES].sort());
    expect(BLEND_MAIN[0]).toBe('normal');
  });
  it('every mode has a Hebrew and an English name and ONE sentence', () => {
    for (const l of ['he', 'en'] as const) for (const m of BLEND_MODES) {
      expect(BLEND_WORDS[l][m].name.length).toBeGreaterThan(0);
      expect(BLEND_WORDS[l][m].says.replace(/\.$/, '')).not.toMatch(/\.\s/); // ONE sentence
    }
  });
  it('«עוד» opens by itself when the chosen mode is one of the rest', () => {
    expect(blendMoreOpen('normal', false)).toBe(false);
    expect(blendMoreOpen('hue', false)).toBe(true);
    expect(blendMoreOpen('normal', true)).toBe(true);
  });
});

describe('keyframe chips', () => {
  const c = clip({ scale: [{ time: f(0), value: 1, easing: 'linear' }, { time: f(45), value: 1.4, easing: 'ease-out' }], x: [{ time: f(45), value: 0.1, easing: 'linear' }] });
  it('one chip per keyframe frame with the zoom drawn there', () => {
    const chips = keyChips(c, track, rate);
    expect(chips.map((k) => k.frame)).toEqual([0, 45]);
    expect(chips.map((k) => k.absFrame)).toEqual([30, 75]);
    expect(chips[1]!.zoom).toBeCloseTo(1.4, 6);
    expect(chips[1]!.seconds).toBe(1.5);
  });
  it('chipAt finds the keyframe the playhead stands on', () => {
    const chips = keyChips(c, track, rate);
    expect(chipAt(chips, 75)?.frame).toBe(45);
    expect(chipAt(chips, 76)).toBeUndefined();
  });
  it('text of a chip', () => { expect(chipTime(1.5)).toBe('0:01.50'); expect(chipTime(75.13)).toBe('1:15.13'); expect(zoomText(1.4)).toBe('×1.40'); });
  it('a clip without keys has no chips', () => { expect(keyChips(clip({}), track, rate)).toEqual([]); });
});

describe('easing into a keyframe', () => {
  const c = clip({ scale: [{ time: f(0), value: 1, easing: 'ease-out' }, { time: f(45), value: 1.4, easing: 'linear' }, { time: f(90), value: 1, easing: 'hold' }] });
  it('is the easing of the segment that ends there; null on the first key', () => {
    expect(easingInto(c, 0, rate)).toBeNull();
    expect(easingInto(c, 45, rate)).toBe('ease-out');
    expect(easingInto(c, 90, rate)).toBe('linear');
  });
  it('is mixed when channels differ', () => {
    const m = clip({ scale: [{ time: f(0), value: 1, easing: 'linear' }, { time: f(45), value: 2, easing: 'linear' }], x: [{ time: f(0), value: 0, easing: 'hold' }, { time: f(45), value: 0.2, easing: 'linear' }] });
    expect(easingInto(m, 45, rate)).toBe('mixed');
  });
  it('the op is set_keyframe_curve on the «before» side of that key, nothing on the first key', () => {
    const ops = easeIntoOps(c, 45, rate, 'smooth');
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'set_keyframe_curve', args: { clipId: 'c1', side: 'before', easing: 'smooth', channels: [{ property: 'scale' }] } });
    expect(easeIntoOps(c, 0, rate, 'smooth')).toEqual([]);
    expect(segmentsInto(c, 45, rate)).toEqual([{ prop: 'scale', easing: 'ease-out' }]);
  });
});

describe('easing tiles', () => {
  it('only existing curve kinds; main and rest cover core CURVES exactly once', () => {
    const ids = CURVES.map((x) => x.id);
    expect([...EASE_MAIN, ...easeRest()].sort()).toEqual([...ids].sort());
    for (const l of ['he', 'en'] as const) for (const id of ids) { expect(CLIP_CARD_STRINGS[l].curves[id]).toBeTruthy(); expect(CLIP_CARD_STRINGS[l].curveSays[id]).toBeTruthy(); }
  });
  it('the line is the real curve: its samples are the engine sampler values', () => {
    expect(curveAt('linear', 0.5)).toBeCloseTo(0.5, 6);
    expect(curveAt('hold', 0.5)).toBe(0);
    expect(curveAt('ease-out', 0.5)).toBeGreaterThan(0.5);
    expect(curveAt('ease-in', 0.5)).toBeLessThan(0.5);
    expect(curveAt('overshoot', 0.8)).toBeGreaterThan(1);
    expect(tilePoints('ease-out')).toHaveLength(41);
    expect(tileLine('ease-out').split(' ')).toHaveLength(41);
  });
  it('kinds draw differently', () => { expect(new Set(EASE_MAIN.map((e) => tileLine(e))).size).toBe(EASE_MAIN.length); });
  it('«עוד» opens for a kind that is not on the first tiles', () => {
    expect(easeMoreOpen('smooth', false)).toBe(false);
    expect(easeMoreOpen('bounce', false)).toBe(true);
    expect(easeMoreOpen('mixed', false)).toBe(false);
    expect(easeMoreOpen(null, true)).toBe(true);
  });
});
