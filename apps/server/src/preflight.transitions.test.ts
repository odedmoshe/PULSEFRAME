/**
 * Preflight on transitions whose source ran out through later edits (ADR-0012). set_transition and set_transition_options
 * check the source a transition reads, but a later trim, slip or speed change of either clip is not refused for it (as
 * with a plain transition's handle): the picture would freeze. Preflight names it and offers a fix that is itself accepted:
 * - the outgoing side: the previous clip's spare frames after its end, `frames` without a ramp, velocityNeeds().outFrames with one;
 * - the incoming side of a velocity ramp: the clip's frames before its start, velocityNeeds().headFrames.
 * The exporter is a stub (labelled as such): only its plan is read here, and it reports nothing.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, velocityNeeds, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, type VideoLayer } from '@pulseframe/engine';
import type { Exporter } from './export.ts';
import { preflight } from './preflight.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let k = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pt${k++}_`, actor: 'test', allowInternal }).doc;
const stubExporter = { plan: () => ({ blockers: [], warnings: [] }) } as unknown as Exporter;
const asset = {
  kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
/** A at frames 0–60 showing source 30–90 (150 spare frames after it), B at 60–120 showing source from `sourceIn` (100), a transition at B. */
function pair(type: string, frames: number, options: Record<string, unknown> = {}, sourceIn = 100) {
  const r0 = applyTransaction(createProject({ id: 'prj_pt', name: 'PT', frameRate: R }), [{ op: 'import_asset', args: { asset } }], { idSeed: `pt${k++}_`, actor: 'test', allowInternal: true });
  const assetId = r0.results[0]!.output!.assetId as string;
  const r = applyTransaction(r0.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(30), duration: f(60) } }, { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(sourceIn), duration: f(60) } }], { idSeed: `pt${k++}_`, actor: 'test' });
  const a = r.results[0]!.output!.clipId as string, b = r.results[1]!.output!.clipId as string;
  const doc = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type, frames } }, ...(Object.keys(options).length ? [{ op: 'set_transition_options', args: { clipId: b, ...options } }] : [])]);
  return { doc, a, b };
}
const issues = (doc: ProjectDocument) => preflight(stubExporter, doc, 1).issues.filter((i) => i.code === 'transition_freeze' || i.code === 'velocity_source');
/** Source frames the outgoing or incoming picture of B's transition shows on its frames. */
const shown = (doc: ProjectDocument, role: 'in' | 'out', n: number) =>
  Array.from({ length: n }, (_, l) => evaluate(doc, f(60 + l)).layers.filter((x): x is VideoLayer => x.kind === 'video').find((x) => x.transition?.role === role)!.sourceFrameIndex);
const moving = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);
const transitionOf = (doc: ProjectDocument, clipId: string) => (doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as MediaClip).transition;

describe('preflight: a velocity ramp whose source a later edit took (velocity_source)', () => {
  it('with enough source on both sides nothing is reported', () => {
    const p = pair('dissolve', 15, { velocity: 4 }, 21); // headFrames(15, ×4) = 21, exactly what B has
    expect(velocityNeeds(15, 4)).toEqual({ outFrames: 36, headFrames: 21 });
    expect(issues(p.doc)).toEqual([]);
    expect(moving(shown(p.doc, 'in', 15)) && moving(shown(p.doc, 'out', 15))).toBe(true);
  });
  it('a slip of the incoming clip that takes its head: the incoming picture would freeze; the fix removes the ramp', () => {
    const p = pair('dissolve', 15, { velocity: 4 }, 21);
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.b, by: f(-21) } }]); // accepted: later edits are not refused for it
    expect(moving(shown(doc, 'in', 15))).toBe(false); // the evaluator clamps to source frame 0: a freeze
    const [i, ...more] = issues(doc);
    expect(more).toEqual([]);
    expect(i).toMatchObject({ code: 'velocity_source', severity: 'warning', ids: [p.b], fix: { label: 'Remove the velocity ramp', ops: [{ op: 'set_transition_options', args: { clipId: p.b, velocity: null } }] } });
    expect(i!.message).toBe('the dissolve transition\'s ×4 velocity ramp needs 21 source frames before the clip\'s start (0 exist); the incoming picture will freeze');
    const fixed = tx(doc, i!.fix!.ops);
    expect(issues(fixed)).toEqual([]);
    expect(moving(shown(fixed, 'in', 15))).toBe(true);
  });
  it('speed ×2 on the incoming clip halves its head in timeline frames: the fix lowers the ramp to what fits', () => {
    const p = pair('dissolve', 15, { velocity: 4 }, 21);
    const doc = tx(p.doc, [{ op: 'set_clip_speed', args: { clipId: p.b, speed: 2 } }]);
    expect(moving(shown(doc, 'in', 15))).toBe(false);
    const [i] = issues(doc);
    expect(i).toMatchObject({ code: 'velocity_source', ids: [p.b], fix: { label: 'Lower the velocity ramp to ×2', ops: [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }] } });
    expect(i!.message).toMatch(/needs 21 source frames before the clip's start \(10 exist\); the incoming picture will freeze$/);
    const fixed = tx(doc, i!.fix!.ops);
    expect(issues(fixed)).toEqual([]);
    expect(moving(shown(fixed, 'in', 15))).toBe(true);
  });
  it('a slip of the previous clip that leaves more than `frames` but less than the ramp reads: the outgoing picture would freeze', () => {
    const p = pair('dissolve', 15, { velocity: 4 });
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(120) } }]); // 30 spare frames: ×3 reads 29, ×4 reads 36
    expect(moving(shown(doc, 'out', 15))).toBe(false);
    const [i, ...more] = issues(doc);
    expect(more).toEqual([]);
    expect(i).toMatchObject({ code: 'velocity_source', ids: [p.b, p.a], fix: { label: 'Lower the velocity ramp to ×3', ops: [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 3 } }] } });
    expect(i!.message).toBe('the dissolve transition\'s ×4 velocity ramp needs 36 spare source frames after the previous clip (30 exist); the outgoing picture will freeze');
    const fixed = tx(doc, i!.fix!.ops);
    expect(issues(fixed)).toEqual([]);
    expect(moving(shown(fixed, 'out', 15))).toBe(true);
  });
  it('both sides short are one issue naming both pictures', () => {
    const p = pair('dissolve', 15, { velocity: 4 }, 21);
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(120) } }, { op: 'slip_clip', args: { clipId: p.b, by: f(-21) } }]);
    const all = issues(doc);
    expect(all.map((i) => i.code)).toEqual(['velocity_source']);
    expect(all[0]!.message).toBe('the dissolve transition\'s ×4 velocity ramp needs 36 spare source frames after the previous clip (30 exist) and 21 source frames before the clip\'s start (0 exist); the outgoing and incoming pictures will freeze');
    expect(issues(tx(doc, all[0]!.fix!.ops))).toEqual([]);
  });
});

describe('preflight: transition_freeze, whose fix is accepted whatever options the transition carries', () => {
  it('without options: the message and the fix are what they always were', () => {
    const p = pair('dissolve', 15);
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(140) } }]); // 10 spare frames
    expect(issues(doc)).toEqual([{ code: 'transition_freeze', severity: 'warning', message: 'the dissolve transition needs 15 spare source frames after the previous clip but only 10 exist; the outgoing picture will freeze', ids: [p.b, p.a], fix: { label: 'Shorten the transition to 10 frames', ops: [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 10 } }] } }]);
    const none = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(150) } }]); // 0 spare frames
    expect(issues(none)[0]!.fix).toEqual({ label: 'Remove the transition', ops: [{ op: 'set_transition', args: { clipId: p.b, type: null } }] });
    expect(issues(tx(none, issues(none)[0]!.fix!.ops))).toEqual([]);
  });
  it('with a velocity ramp, a beat lock, a colour and a seed: set_transition alone would be refused (it keeps the ramp); the fix drops the ramp and keeps the rest', () => {
    const p = pair('film-burn', 15, { velocity: 2, sync: 'beat', color: '#102030', seed: 77 });
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(140) } }]);
    expect(() => tx(doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'film-burn', frames: 10 } }])).toThrow(/velocity ×2 needs 14/);
    const [i, ...more] = issues(doc);
    expect(more).toEqual([]);
    expect(i).toMatchObject({ code: 'transition_freeze', ids: [p.b, p.a], fix: { label: 'Shorten the transition to 10 frames, without its velocity ramp' } });
    expect(i!.message).toBe('the film-burn transition needs 15 spare source frames after the previous clip (22 with its ×2 velocity ramp) but only 10 exist; the outgoing picture will freeze');
    const fixed = tx(doc, i!.fix!.ops);
    expect(transitionOf(fixed, p.b)).toEqual({ type: 'film-burn', frames: 10, sync: 'beat', color: '#102030', seed: 77 });
    expect(issues(fixed)).toEqual([]);
  });
  it('with a beat lock and 2 spare frames: a beat lock needs 3, so the fix drops it', () => {
    const p = pair('dissolve', 15, { sync: 'beat' });
    const doc = tx(p.doc, [{ op: 'slip_clip', args: { clipId: p.a, by: f(148) } }]);
    expect(() => tx(doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 2 } }])).toThrow(/at least 3 frames/);
    const [i] = issues(doc);
    expect(i!.fix!.label).toBe('Shorten the transition to 2 frames, without the beat lock');
    const fixed = tx(doc, i!.fix!.ops);
    expect(transitionOf(fixed, p.b)).toEqual({ type: 'dissolve', frames: 2 });
    expect(issues(fixed)).toEqual([]);
  });
});
