/** eyes.ts: the strict worker line to the owner's answer (shown coordinates, the closeness rule, position order, refusals with codes only). */
import { describe, expect, it } from 'vitest';
import { GROWING } from '@pulseframe/core';
import { ApiError } from '../store.ts';
import { eyesAnswerFrom, parseEyesLine } from './eyes.ts';

const M = 'TEST label';
const err = (f: () => unknown) => { try { f(); } catch (e) { expect(e).toBeInstanceOf(ApiError); return e as ApiError; } throw new Error('did not throw'); };
const dec = { w: 640, h: 320 }, shown = { width: 1280, height: 640 };

describe('parseEyesLine', () => {
  it('a strict line passes; an extra key, a third point, another id or a non-object is 502 with reason only (never the ZodError)', () => {
    expect(parseEyesLine({ id: 1, event: 'result', faces: [] }, 1)).toEqual({ id: 1, event: 'result', faces: [] });
    for (const raw of [{ id: 1, event: 'result', faces: [], scores: [1] }, { id: 1, event: 'result', faces: [[[1, 2], [3, 4], [5, 6]]] }, { id: 1, event: 'result', tooMany: true, faces: [] }, 'x', null]) {
      const e = err(() => parseEyesLine(raw, 1));
      expect([e.status, e.code, e.details]).toEqual([502, 'eyes_engine_failed', { reason: 'line' }]);
    }
    expect(err(() => parseEyesLine({ id: 2, event: 'result', faces: [] }, 1)).details).toEqual({ reason: 'line_id' });
  });
});

describe('eyesAnswerFrom', () => {
  it('pixels become (u, v) of the decoded picture; faces are ordered by eye midpoint u, then v', () => {
    const a = eyesAnswerFrom({ id: 1, event: 'result', faces: [[[400, 100], [440, 100]], [[100, 200], [140, 200]], [[100, 50], [140, 50]]] }, dec, shown, M);
    expect(a.outcome).toBe('faces');
    expect(a.faces.map((f) => f.eyes)).toEqual([
      [{ u: 100 / 640, v: 50 / 320 }, { u: 140 / 640, v: 50 / 320 }],
      [{ u: 100 / 640, v: 200 / 320 }, { u: 140 / 640, v: 200 / 320 }],
      [{ u: 400 / 640, v: 100 / 320 }, { u: 440 / 640, v: 100 / 320 }],
    ]);
    expect(a.method).toBe(M);
  });
  it('a face closer than GROWING.minEyeShownPx in SHOWN pixels is dropped; none left → outcome none', () => {
    const close = (GROWING.minEyeShownPx / 2) * 0.99; // decoded px; ×2 to the shown size: just under the limit
    expect(eyesAnswerFrom({ id: 1, event: 'result', faces: [[[10, 10], [10 + close, 10]]] }, dec, shown, M)).toEqual({ outcome: 'none', faces: [], method: M });
    expect(eyesAnswerFrom({ id: 1, event: 'result', faces: [[[10, 10], [10 + (GROWING.minEyeShownPx / 2) * 1.01, 10]]] }, dec, shown, M).outcome).toBe('faces');
  });
  it('tooMany → too_many with no point; a point outside the picture → 502', () => {
    expect(eyesAnswerFrom({ id: 1, event: 'result', tooMany: true }, dec, shown, M)).toEqual({ outcome: 'too_many', faces: [], method: M });
    expect(err(() => eyesAnswerFrom({ id: 1, event: 'result', faces: [[[641, 10], [600, 10]]] }, dec, shown, M)).details).toEqual({ reason: 'outside' });
    expect(err(() => eyesAnswerFrom({ id: 1, event: 'result', faces: [[[-1, 10], [600, 10]]] }, dec, shown, M)).details).toEqual({ reason: 'outside' });
  });
  it('the worker\'s error codes: not_built → 501, model_mismatch → 409 eyes_not_ready model_missing, others → 502 with the code', () => {
    expect(err(() => eyesAnswerFrom({ id: 1, event: 'error', code: 'not_built' }, dec, shown, M)).status).toBe(501);
    const mm = err(() => eyesAnswerFrom({ id: 1, event: 'error', code: 'model_mismatch' }, dec, shown, M));
    expect([mm.status, mm.code, mm.details]).toEqual([409, 'eyes_not_ready', { setup: 'model_missing' }]);
    expect(err(() => eyesAnswerFrom({ id: 1, event: 'error', code: 'engine_failed' }, dec, shown, M)).details).toEqual({ reason: 'worker', code: 'engine_failed' });
  });
});
