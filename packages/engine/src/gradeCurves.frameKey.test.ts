/**
 * Colour curves in the graph and the frame key (wave 8 grade pre-pass; grade-plan §3.5, proof G8): evaluate passes a grade's curves
 * (points, never tables) into the layer's look, so the frame key covers them with no rule of its own; a graph without curves has no
 * `curves` key at all, so every document without curves keys exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, frameKey } from './frameKey.ts';
import { describeMoment, evaluate } from './evaluate.ts';
import { curvePixel, GRADE_DEFAULTS, gradePixel } from './colourMatch.ts';
import { gradeCurveTables } from '@pulseframe/core';
import { ctxFor, f, richDoc, tx } from './frameKey.testDocs.ts';

const CURVES = { master: [[0, 0], [64, 40], [192, 210], [255, 255]] as [number, number][] };
const at = (frame: number) => f(frame);

describe('colour curves in the graph and the frame key', () => {
  it('the curves reach the layer look; one point raised by 1 changes the key; the same document keys equal twice', () => {
    const rich = richDoc();
    const d1 = tx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: CURVES } }]).doc;
    const graph = canonicalJson(evaluate(d1, at(30)));
    expect(graph).toContain('"curves":{"master":[[0,0],[64,40],[192,210],[255,255]]}');
    const raised = structuredClone(CURVES); raised.master[1]![1] = 41;
    const d2 = tx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: raised } }]).doc;
    expect(frameKey(d1, 30, ctxFor(d1))).toBe(frameKey(d1, 30, ctxFor(d1)));
    expect(frameKey(d2, 30, ctxFor(d2))).not.toBe(frameKey(d1, 30, ctxFor(d1)));
  });
  it('a grade without curves adds no key to the graph, and the curves field is removed with null', () => {
    const rich = richDoc();
    const graded = tx(rich.doc, [{ op: 'set_colour_grade', args: { clipId: rich.clips.A1, params: { exposure: 0.2 } } }]).doc;
    expect(canonicalJson(evaluate(graded, at(30)))).not.toContain('"curves"');
    const curved = tx(graded, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: CURVES } }]).doc;
    const cleared = tx(curved, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: null } }]).doc;
    expect(canonicalJson(evaluate(cleared, at(30)))).toBe(canonicalJson(evaluate(graded, at(30))));
    expect(frameKey(cleared, 30, ctxFor(cleared))).toBe(frameKey(graded, 30, ctxFor(graded)));
  });
  it('an adjustment clip passes its grade\'s curves to its pass too', () => {
    const rich = richDoc();
    const d = tx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.ADJ, curves: CURVES } }]).doc;
    expect(canonicalJson(evaluate(d, at(230)))).toContain('"curves":{"master"');
  });
  it('describe_moment (G10): a layer with a grade reports grade { params, curves } — the points only, no table samples (cut)', () => {
    const rich = richDoc();
    const graded = tx(rich.doc, [{ op: 'set_colour_grade', args: { clipId: rich.clips.A1, params: { exposure: 0.2 } } }]).doc;
    const layerOf = (d: typeof graded, frame: number) => describeMoment(d, at(frame)).layers.find((l) => 'clipId' in l && l.clipId === rich.clips.A1) as { grade?: { params: Record<string, unknown>; curves?: unknown } } | undefined;
    const plain = layerOf(graded, 30)!;
    expect(plain.grade!.params.exposure).toBe(0.2);
    expect('curves' in plain.grade!).toBe(false);
    const curved = tx(graded, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: CURVES } }]).doc;
    const g = layerOf(curved, 30)!.grade!;
    expect(g.curves).toEqual(CURVES);
    expect(g.params).toEqual(plain.grade!.params);
    expect(JSON.stringify(g)).not.toMatch(/samples|"at"/);
    // a layer without a grade has no grade key; an adjustment clip reports its own grade's curves
    expect('grade' in (layerOf(rich.doc, 30) ?? {})).toBe(false);
    const adj = tx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.ADJ, curves: CURVES } }]).doc;
    const a = describeMoment(adj, at(230)).layers.find((l) => l.kind === 'adjust') as { grade?: { curves?: unknown } };
    expect(a.grade!.curves).toEqual(CURVES);
  });
});

describe('the model of the curve step (colourMatch.ts curvePixel; proof G5/G6)', () => {
  it('at an exact code the step reads T[v]; between codes it mixes the two neighbours; 1.0 reads T[255]; gradePixel applies it after the sliders', () => {
    const tables = gradeCurveTables({ master: [[0, 0], [64, 40], [192, 210], [255, 255]], r: [[0, 10], [255, 250]] });
    for (const v of [0, 1, 63, 64, 128, 200, 254, 255]) {
      const out = curvePixel([v / 255, v / 255, v / 255], tables);
      expect(Math.round(out[0] * 255)).toBe(tables.r[v]);
      expect(Math.round(out[1] * 255)).toBe(tables.g[v]);
      expect(out[1] * 255).toBeCloseTo(tables.g[v]!, 9);
    }
    const mid = curvePixel([100.25 / 255, 0, 2], tables);
    expect(mid[0] * 255).toBeCloseTo(tables.r[100]! * 0.75 + tables.r[101]! * 0.25, 9);
    expect(mid[2] * 255).toBeCloseTo(tables.b[255]!, 9); // clamped like the pass's clamp
    const p = { ...GRADE_DEFAULTS, exposure: 0.5, contrast: 1.2 };
    const rgb: [number, number, number] = [0.3, 0.5, 0.7];
    expect(gradePixel(rgb, p, tables)).toEqual(curvePixel(gradePixel(rgb, p), tables));
    // the identity tables change nothing beyond f64 rounding
    const id = gradeCurveTables({ master: [[0, 0], [255, 255]] });
    const g = gradePixel(rgb, p);
    gradePixel(rgb, p, id).forEach((v, i) => expect(v).toBeCloseTo(g[i]!, 12));
  });
});
