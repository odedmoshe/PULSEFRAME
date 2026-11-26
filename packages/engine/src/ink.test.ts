/**
 * The painter of «ציור חי» drawings (wave 8 ink; inkPainter.ts). Lead pre-pass: the honest state until W2 builds it, the rule table,
 * the scratch slots, and the checks W2 must make pass (todo). W2 owns this file after the pre-pass; pixel checks use the PIXEL
 * STAND-IN of drawn.test.ts (a labelled test double), extended for paths, arcs and drawImage.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type InkStrokeIn } from '@pulseframe/core';
import { evaluate } from './evaluate.ts';
import { drawnPainter, noPainterId } from './drawnPainters.ts';
import { HIGHLIGHTER_ALPHA, INK_BRUSH_RULES, INK_PAINTER_BUILT, INK_SCRATCH_SLOTS } from './inkPainter.ts';
import { TEXT_FX_SLOTS } from './textEffects.ts';
import { CANVAS_TRANSITION_SLOT } from './canvasTransitions.ts';
import { TAP_PLACE_SLOT } from './taps.ts';
import { ADJUST_PASS_SLOT } from './evaluate.ts';
import { REGION_COPY_SLOT, REGION_MASK_SLOT } from './look.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const line: InkStrokeIn = { brush: 'neon', color: '#FFCC00', width: 80, at: 0, x: [0, 500, 1000], y: [0, 0, 0], t: [0, 100, 200] };

describe('the ink painter contract', () => {
  it('until built, no painter is registered: a frame with a drawing reports drawn.ink (the carrier then refuses a still or an export)', () => {
    expect(INK_PAINTER_BUILT).toBe(false);
    expect(drawnPainter('ink')).toBeUndefined();
    expect(noPainterId('ink')).toBe('drawn.ink');
    const doc = applyTransaction(createProject({ id: 'prj_inkp', name: 'P', width: 640, height: 360, frameRate: R }), [{ op: 'add_ink', args: { start: f(0), strokes: [line] } }], { idSeed: 'ip_', actor: 'test' }).doc;
    const g = evaluate(doc, f(3));
    const layer = g.layers.find((l) => l.kind === 'drawn');
    expect(layer && layer.kind === 'drawn' && layer.drawn.kind).toBe('ink');
  });
  it('the brush table and the scratch slots: highlighter source-over at an alpha, neon through the title glow, only slots 10–12', () => {
    expect(INK_BRUSH_RULES).toEqual({ marker: { via: 'direct', alpha: 1 }, highlighter: { via: 'silhouette', alpha: HIGHLIGHTER_ALPHA }, neon: { via: 'glow', alpha: 1 } });
    expect([...INK_SCRATCH_SLOTS]).toEqual([TEXT_FX_SLOTS.silhouette, TEXT_FX_SLOTS.work, TEXT_FX_SLOTS.work2]);
    for (const taken of [0, 1, 2, TAP_PLACE_SLOT, CANVAS_TRANSITION_SLOT, ADJUST_PASS_SLOT, REGION_COPY_SLOT, REGION_MASK_SLOT]) expect(INK_SCRATCH_SLOTS as readonly number[]).not.toContain(taken);
  });
});

describe('builders (W2)', () => {
  it.todo('round caps and joins: a 3-point marker polyline covers exactly the pixels of the round-capped, round-joined model (stand-in)');
  it.todo('widths in frame-height units: the same drawing at 320×180 and 640×360 has line widths in the ratio 2 (±0.5 px)');
  it.todo('one reached point is a dot of diameter w; points === 0 draws nothing; the partial segment ends at frac of the next segment');
  it.todo('the play rule: at local frames 0, 1, 5 and on a sub-frame tap time the farthest lit pixel along a straight line is inkStrokeProgress\'s position (±1 px)');
  it.todo('highlighter: one self-crossing stroke on black is uniformly HIGHLIGHTER_ALPHA × colour (no darker crossing); two crossing strokes are darker where they cross');
  it.todo('neon: glow() is called with the stroke silhouette in slot 10 and writes only slots 11 and 12; a title with a glow painted after it is byte-identical to one painted alone');
  it.todo('neon without ctx.filter: core and stroke only, and drawn.ink.glow is noted');
  it.todo('fade: at opacity 0.5 two crossing marker strokes are as light at the crossing as elsewhere (the carrier\'s buffer path)');
  it.todo('split at frame 20 and trim-start by 7 frames render byte-equal to the unsplit clip at the same timeline frames (stand-in)');
  it.todo('60 frames rendered in shuffled order equal the same frames in sequence (frame key covers the payload)');
  it.todo('INK_PAINTER_BUILT is true and drawnPainter("ink") is paintInk');
});
