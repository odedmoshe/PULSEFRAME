/**
 * The evaluator's side of the transition options (ADR-0012): the transition state each layer carries, the velocity ramp's
 * source frames (whole frames, transform at the frame's own time), and light 0 unless the flash schedule kept the start.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, smooth, velocityOffsets, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, flashSchedule, type VideoLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let k = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `to${k++}_`, actor: 'test', allowInternal });
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
/** A at frames 0–60 showing source 30–90, B at 60–120 showing source 100–160, a transition of `frames` at B. */
function pair(type: string, frames: number, options: Record<string, unknown> = {}) {
  let r = tx(createProject({ id: 'p', name: 'p', frameRate: R }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(30), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(100), duration: f(60) } }]);
  const a = r.results[0]!.output!.clipId as string, b = r.results[1]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type, frames } }, ...(Object.keys(options).length ? [{ op: 'set_transition_options', args: { clipId: b, ...options } }] : [])]);
  return { doc: r.doc, a, b };
}
const sides = (doc: ProjectDocument, frame: number) => {
  const g = evaluate(doc, f(frame));
  const pics = g.layers.filter((l): l is VideoLayer => l.kind === 'video');
  return { out: pics.find((l) => l.transition?.role === 'out')!, in: pics.find((l) => l.transition?.role === 'in')! };
};

describe('transition state on the layers (ADR-0012)', () => {
  it('without options: progress is the old ease, light 0, the registry defaults filled in, and the render quantities', () => {
    const p = pair('dissolve', 29);
    for (let l = 0; l < 29; l++) {
      const s = sides(p.doc, 60 + l);
      expect(s.in.transition).toEqual({ type: 'dissolve', progress: smooth((l + 1) / 30), role: 'in', light: 0, color: null, seed: 0, frame: l, frames: 29, fps: 30 });
      expect(s.out.transition).toEqual({ ...s.in.transition, role: 'out', light: 0 });
      expect([s.out.sourceFrameIndex, s.in.sourceFrameIndex]).toEqual([90 + l, 100 + l]);
    }
    expect(sides(p.doc, 89).in).toBeUndefined();
  });
  it('options and defaults: a colour and seed set on the transition, the type\'s defaults where none is set', () => {
    expect(sides(pair('film-burn', 15).doc, 64).in.transition).toMatchObject({ color: '#FF9A4A', seed: 0 });
    expect(sides(pair('film-burn', 15, { color: '#102030', seed: 77 }).doc, 64).in.transition).toMatchObject({ color: '#102030', seed: 77 });
    expect(sides(pair('slices-h', 15, { seed: 5 }).doc, 64).in.transition).toMatchObject({ color: null, seed: 5 });
    expect(sides(pair('block-left', 15).doc, 64).in.transition).toMatchObject({ color: '#3DE0C8', seed: 0 });
  });
  it('a light transition has light 0 while the schedule has not kept its start (the lights plan is W2\'s; empty until then)', () => {
    const p = pair('film-burn', 15);
    expect(flashSchedule(p.doc).lights.size).toBe(0);
    for (let l = 0; l < 15; l++) expect(sides(p.doc, 60 + l).in.transition!.light).toBe(0);
  });
  it('a beat lock with no analysed beat in the window plays exactly as without it', () => {
    const plain = pair('dissolve', 29), locked = pair('dissolve', 29, { sync: 'beat' });
    for (let l = 0; l < 29; l++) expect(sides(locked.doc, 60 + l).in.transition!.progress).toBe(sides(plain.doc, 60 + l).in.transition!.progress);
  });
  it('velocity: the outgoing picture is its frame (l + out) past its end and the incoming one its frame (l − in), in whole frames; placement stays at the frame\'s own time', () => {
    for (const v of [2, 3, 4] as const) for (const n of [15, 29]) {
      const plain = pair('wipe-left', n), ramp = pair('wipe-left', n, { velocity: v });
      for (let l = 0; l < n; l++) {
        const s = sides(ramp.doc, 60 + l), o = velocityOffsets(n, v, l), ref = sides(plain.doc, 60 + l);
        expect([s.out.sourceFrameIndex, s.in.sourceFrameIndex], `×${v} n=${n} l=${l}`).toEqual([90 + l + o.out, 100 + l - o.in]);
        expect(s.in.sourceSeekSeconds).toBe((100 + l - o.in + 0.5) / 30);
        expect([s.out.transform, s.in.transform]).toEqual([ref.out.transform, ref.in.transform]);
        expect(s.in.transition!.progress).toBe(ref.in.transition!.progress);
      }
      // after the transition the incoming clip plays on from where it always did
      expect(sides(ramp.doc, 60 + n).in).toBeUndefined();
      expect(evaluate(ramp.doc, f(60 + n)).layers.find((x): x is VideoLayer => x.kind === 'video')!.sourceFrameIndex).toBe(100 + n);
    }
  });
});
