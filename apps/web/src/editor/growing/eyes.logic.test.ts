/** The proposal logic of «הציעו עיניים»: plan §4 click choice, reading order, keys, accepting through placePoint, setup of the model row. Pure; the answers are labelled stand-ins. */
import { describe, expect, it } from 'vitest';
import type { EyesAnswer, ShownSize } from '@pulseframe/core';
import { emptyMark, placePoint } from './growing.logic.ts';
import { acceptFace, chooseByClick, eyeDistancePx, letterIndex, moveChosen, orderedEyes, proposalFor, proposalOf, readingOrder, setupFromModels } from './eyes.logic.ts';

const shown: ShownSize = { width: 1000, height: 500 };
const P = (u: number, v: number) => ({ u, v });
// TEST STAND-IN answers (not a model): two faces, eye distance 100 shown px each
const left = [P(0.15, 0.4), P(0.25, 0.4)] as const, right = [P(0.65, 0.4), P(0.75, 0.4)] as const;
const answer = (faces: ReadonlyArray<readonly [ReturnType<typeof P>, ReturnType<typeof P>]>, outcome: EyesAnswer['outcome'] = 'faces'): EyesAnswer =>
  ({ outcome, faces: faces.map((eyes) => ({ eyes: [eyes[0], eyes[1]] })), method: 'TEST-STAND-IN' }) as EyesAnswer;

describe('proposal', () => {
  it('one face is chosen at once, several leave nothing chosen, none/too_many hold no face', () => {
    expect(proposalOf('a', null, answer([left])).chosen).toBe(0);
    expect(proposalOf('a', null, answer([left, right])).chosen).toBeNull();
    expect(proposalOf('a', 3, { outcome: 'none', faces: [], method: 'x' }).faces).toEqual([]);
    expect(proposalOf('a', null, { outcome: 'too_many', faces: [], method: 'x' }).outcome).toBe('too_many');
  });
  it('belongs to one picture and one frame', () => {
    const p = proposalOf('a', 2, answer([left]));
    expect(proposalFor(p, 'a', 2)).toBe(p);
    expect(proposalFor(p, 'a', 3)).toBeNull();
    expect(proposalFor(p, 'b', 2)).toBeNull();
    expect(proposalFor(undefined, 'a', 2)).toBeNull();
  });
});
describe('reading order and letters', () => {
  it('English reads left to right, Hebrew right to left (the stage stays ltr)', () => {
    expect(readingOrder(3, 'en')).toEqual([0, 1, 2]);
    expect(readingOrder(3, 'he')).toEqual([2, 1, 0]);
    expect(letterIndex(1, 2, 'he')).toBe(0); // the right face is א
    expect(letterIndex(1, 2, 'en')).toBe(1); // the right face is B
  });
  it('[ and ] move through the faces in reading order and wrap', () => {
    expect(moveChosen(null, 2, 'en', 1)).toBe(0);
    expect(moveChosen(null, 2, 'en', -1)).toBe(1);
    expect(moveChosen(0, 2, 'en', 1)).toBe(1);
    expect(moveChosen(1, 2, 'en', 1)).toBe(0);
    expect(moveChosen(null, 2, 'he', 1)).toBe(1); // א is the right face
    expect(moveChosen(1, 2, 'he', 1)).toBe(0);
    expect(moveChosen(null, 0, 'en', 1)).toBeNull();
  });
});
describe('click choice (plan §4)', () => {
  const faces = [left, right];
  it('a click near a face chooses it; reach is 1.5 x that face\'s eye distance', () => {
    expect(eyeDistancePx(left, shown)).toBeCloseTo(100);
    expect(chooseByClick(faces, P(0.7, 0.45), shown)).toEqual({ kind: 'chosen', face: 1 });
    expect(chooseByClick(faces, P(0.2 + 0.149, 0.4), shown)).toEqual({ kind: 'chosen', face: 0 }); // 149 px < 150
    expect(chooseByClick(faces, P(0.2 + 0.151, 0.4), shown)).toEqual({ kind: 'none' }); // 151 px > 150, and far from the other
  });
  it('a click far from every face chooses none (the caller drops the proposal and places a point)', () => {
    expect(chooseByClick(faces, P(0.45, 0.95), shown)).toEqual({ kind: 'none' });
  });
  it('two candidates within 1 shown px of each other: nothing chosen, "click closer"', () => {
    const a = [P(0.3, 0.4), P(0.4, 0.4)] as const, b = [P(0.5, 0.4), P(0.6, 0.4)] as const; // middles 0.35 and 0.55
    expect(chooseByClick([a, b], P(0.45, 0.4), shown)).toEqual({ kind: 'closer' }); // exactly between, both 100 px
    expect(chooseByClick([a, b], P(0.4504, 0.4), shown)).toEqual({ kind: 'closer' }); // 100.4 vs 99.6 px: 0.8 px apart
  });
  it('candidates 1 px or more apart in distance: the nearer one is chosen', () => {
    const a = [P(0.3, 0.4), P(0.4, 0.4)] as const, b = [P(0.5, 0.4), P(0.6, 0.4)] as const;
    expect(chooseByClick([a, b], P(0.4515, 0.4), shown)).toEqual({ kind: 'chosen', face: 1 }); // 101.5 vs 98.5
  });
});
describe('accepting goes through placePoint twice', () => {
  it('gives the same mark as two clicks, with the order rule applied, and keeps the frame', () => {
    const order = (a: ReturnType<typeof P>, b: ReturnType<typeof P>) => (a.u <= b.u ? [b, a] : [a, b]) as [typeof a, typeof b]; // STAND-IN order rule: swaps
    const viaClicks = placePoint(placePoint(emptyMark(7), right[0], shown, order).mark, right[1], shown, order).mark;
    const r = acceptFace({ ...emptyMark(7), clicks: [P(0.9, 0.9)] }, right, shown, order);
    expect(r.refused).toBeNull();
    expect(r.mark).toEqual(viaClicks);
    expect(r.mark.eyes).toEqual([right[1], right[0]]);
    expect(orderedEyes(right, shown, order)).toEqual([right[1], right[0]]);
    expect(orderedEyes(right, shown, null)).toEqual([right[0], right[1]]);
  });
  it('two points closer than growing allows are refused and the mark stays as it was', () => {
    const m = emptyMark(null);
    const r = acceptFace(m, [P(0.5, 0.5), P(0.5001, 0.5)], shown, null);
    expect(r.refused).toBe('too_close');
    expect(r.mark).toBe(m);
  });
  it('replaces an earlier mark of the picture', () => {
    const done = placePoint(placePoint(emptyMark(null), P(0.1, 0.1), shown, null).mark, P(0.3, 0.1), shown, null).mark;
    expect(acceptFace(done, left, shown, null).mark.eyes).toEqual([left[0], left[1]]);
  });
});
describe('setup of the model row', () => {
  it('reads the yunet row; a missing row reads as not built', () => {
    expect(setupFromModels([{ id: 'da3-small', code: 'ready', missingBytes: 0 }])).toEqual({ code: 'not_built', module: null, missingBytes: 0 });
    expect(setupFromModels([{ id: 'yunet', code: 'model_missing', module: null, missingBytes: 232589 }])).toEqual({ code: 'model_missing', module: null, missingBytes: 232589 });
    expect(setupFromModels([{ id: 'yunet', code: 'engine_not_working', module: 'onnxruntime', missingBytes: 0 }])).toMatchObject({ code: 'engine_not_working', module: 'onnxruntime' });
  });
});
