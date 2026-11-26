/**
 * The additive `ready` hook of the drawn painter registry (tripmap pre-pass; drawnPainters.ts prepareDrawn): a kind that loads data
 * once per page is painted only after its preparation finished; a failed preparation is reported as `drawn.<kind>` with its
 * reason (a still or an export then refuses) and is asked again on the next frame. Uses the TEST-ONLY kind with a RECORDING
 * context (a labelled test double that only counts the painter's calls; no pixels).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type ProjectDocument } from '@pulseframe/core';
import { registerTestDrawnOp, testDrawn } from '@pulseframe/core/drawn.testKind.ts';
import { evaluate } from './evaluate.ts';
import { drawGraph, type Ctx2D } from './compositor2d.ts';
import { drawnUnready, registerDrawnPainter, unregisterDrawnPainter } from './drawnPainters.ts';
import { paintTestDrawn } from './drawnPainters.testKind.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
/** RECORDING CONTEXT (test double): every method is a no-op; fillRect calls are counted. */
function recorder() {
  const calls = { fillRect: 0 };
  const ctx = new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : k === 'fillRect' ? () => { calls.fillRect++; } : () => {}), set: (t, k: string, v) => { t[k] = v; return true; } }) as unknown as Ctx2D;
  return { ctx, calls };
}
function doc(): ProjectDocument {
  registerTestDrawnOp();
  return applyTransaction(createProject({ id: 'prj_ready', name: 'R', width: 64, height: 36 }), [{ op: 'add_test_drawn', args: { start: f(0), duration: f(30), drawn: testDrawn() } }], { idSeed: 'rd_', actor: 'test' }).doc;
}
afterEach(() => { unregisterDrawnPainter('test'); });

describe('drawn painters with a ready hook', () => {
  it('waits for ready before the first paint; a kind without the hook is painted at once', async () => {
    let loaded = false;
    registerDrawnPainter('test', (c, p, e) => { expect(loaded).toBe(true); paintTestDrawn(c, p, e); }, { ready: async () => { await new Promise((r) => setTimeout(r, 5)); loaded = true; } });
    const r = recorder();
    const res = await drawGraph(r.ctx, evaluate(doc(), f(3)), async () => null);
    expect(res.unavailableEffects).toEqual([]);
    expect(r.calls.fillRect).toBeGreaterThanOrEqual(2);
    expect(drawnUnready('test')).toBeNull();
  });
  it('a ready that fails is reported as drawn.<kind> with its reason and nothing is painted; the next frame asks again', async () => {
    let tries = 0;
    registerDrawnPainter('test', paintTestDrawn, { ready: async () => { tries++; if (tries === 1) throw new Error('chunk missing'); } });
    const a = recorder();
    const first = await drawGraph(a.ctx, evaluate(doc(), f(3)), async () => null);
    expect(first.unavailableEffects).toEqual(['drawn.test']);
    expect(first.unavailableReasons?.['drawn.test']).toBe('drawn test data could not be loaded: chunk missing');
    const painted = a.calls.fillRect;
    const b = recorder();
    const second = await drawGraph(b.ctx, evaluate(doc(), f(3)), async () => null);
    expect(second.unavailableEffects).toEqual([]);
    expect(tries).toBe(2);
    expect(b.calls.fillRect - painted).toBeGreaterThanOrEqual(2);
  });
});
