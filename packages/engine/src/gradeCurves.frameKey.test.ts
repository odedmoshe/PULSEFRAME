/**
 * Colour curves in the graph and the frame key (wave 8 grade pre-pass; grade-plan §3.5, proof G8): evaluate passes a grade's curves
 * (points, never tables) into the layer's look, so the frame key covers them with no rule of its own; a graph without curves has no
 * `curves` key at all, so every document without curves keys exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, frameKey } from './frameKey.ts';
import { evaluate } from './evaluate.ts';
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
  it.todo('W1 (describe_moment, G10): a layer with a grade reports grade { params, curves } — the points only, no table samples (cut)');
});
