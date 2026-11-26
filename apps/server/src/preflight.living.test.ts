/**
 * Preflight warns about living pictures (wave 8 living; preflight.ts livingPreflightIssues): living_too_fast when the move breaks the
 * comfort rule of thumb as it is now (keys made faster by hand, a trim), with the clip's frames, the numbers and a fix that lowers
 * the amount; living_no_depth and living_rotated when the picture is not drawn. Warnings only. Documents are built through the
 * operations (the no-depth case is written straight into the document, as a split or an agent can leave it); synthetic files only.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, LIVING_EFFECT, LIVING_PREFLIGHT, livingComfort, type ClipDepth, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { livingPreflightIssues } from './preflight.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `pfl${n++}_`, actor: 'test', allowInternal: false });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const PHOTO = { kind: 'image' as const, name: 'photo.png', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
const DEPTH: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 400 }, strokes: [] };

/** A photo at timeline frames 30..180 (150 frames) with a living picture: push, amount 0.5, the op's own keys. */
function scene() {
  let r = applyTransaction(createProject({ id: 'prj_pfl', name: 'P', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: PHOTO } }], { idSeed: 'pfl_a_', actor: 'test', allowInternal: true });
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(30), duration: f(150) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'set_living_picture', args: { clipId, depth: DEPTH } }]);
  return { doc: r.doc, clipId, fxId: r.results[0]!.output!.effectId as string };
}
const codes = (doc: ProjectDocument) => livingPreflightIssues(doc, R).map((i) => [i.code, i.severity, i.range]);

describe('preflight: living pictures', () => {
  it('nothing for a living picture the op made, nor for a document without one', () => {
    const s = scene();
    expect(livingPreflightIssues(s.doc, R)).toEqual([]);
    expect(livingPreflightIssues(createProject({ id: 'x', name: 'x' }), R)).toEqual([]);
  });
  it('living_too_fast: keys made faster by replace_effect_keyframes → a warning at the clip\'s frames with the numbers and a fix that lowers the amount', () => {
    const s = scene();
    const fast = tx(s.doc, [{ op: 'replace_effect_keyframes', args: { clipId: s.clipId, effectId: s.fxId, param: 'travel', keys: [{ time: f(0), value: 0, easing: 'linear' }, { time: f(15), value: 1, easing: 'linear' }] } }]).doc;
    const issues = livingPreflightIssues(fast, R);
    expect(issues.map((i) => [i.code, i.severity, i.range, i.ids])).toEqual([[LIVING_PREFLIGHT.tooFast, 'warning', { startFrame: 30, endFrame: 180 }, [s.clipId, s.fxId]]]);
    const fx = findClip(fast, s.clipId)!.clip.effects![0]!;
    const c = livingComfort(fx, 150, R);
    // travel 0 → 1 in 15 frames (0.5 s) at amount 0.5 push: 0.5·0.03·2 = 0.03 of the height a second, the rule of thumb is 0.02
    expect(c.peakRate).toBeCloseTo(0.03, 10);
    expect(issues[0]!.measured).toEqual({ peakRate: c.peakRate, limit: 0.02, amount: 0.5, maxAmount: 0.33, clipFrames: 150 });
    expect(issues[0]!.message).toMatch(/3\.00% of the frame height a second, the rule of thumb is 2% \(not a medical check\)\. The highest amount these keys allow: 0\.33/);
    // the fix is accepted and clears the warning
    const fixed = tx(fast, issues[0]!.fix!.ops).doc;
    expect(livingPreflightIssues(fixed, R)).toEqual([]);
  });
  it('a trim that leaves the keys as they are does not speed the move up (it ends earlier): no warning', () => {
    const s = scene();
    expect(codes(tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.clipId, edge: 'end', to: f(90) } }]).doc)).toEqual([]);
  });
  it('a bypassed living picture is not checked', () => {
    const s = scene();
    const fast = tx(s.doc, [{ op: 'replace_effect_keyframes', args: { clipId: s.clipId, effectId: s.fxId, param: 'travel', keys: [{ time: f(0), value: 0, easing: 'linear' }, { time: f(15), value: 1, easing: 'linear' }] } }]).doc;
    expect(codes(tx(fast, [{ op: 'update_effect', args: { clipId: s.clipId, effectId: s.fxId, enabled: false } }]).doc)).toEqual([]);
  });
  it('living_rotated after the picture is rotated; living_no_depth when the depth is gone (written as a split or an agent can leave it)', () => {
    const s = scene();
    const rot = tx(s.doc, [{ op: 'set_clip_transform', args: { clipId: s.clipId, transform: { rotation: 10 } } }]).doc;
    expect(codes(rot)).toEqual([[LIVING_PREFLIGHT.rotated, 'warning', { startFrame: 30, endFrame: 180 }]]);
    expect(livingPreflightIssues(rot, R)[0]!.message).toMatch(/"photo\.png" is on a rotated picture, so it is not drawn/);
    const bare = structuredClone(s.doc);
    const c = findClip(bare, s.clipId)!.clip;
    if (c.type === 'media') delete c.depth;
    expect(c.effects![0]!.type).toBe(LIVING_EFFECT);
    expect(codes(bare)).toEqual([[LIVING_PREFLIGHT.noDepth, 'warning', { startFrame: 30, endFrame: 180 }]]);
    // a hidden track is not shown, so it is not checked
    const hidden = structuredClone(bare);
    hidden.sequences[hidden.mainSequenceId]!.tracks.find((t) => t.clips.some((x) => x.id === s.clipId))!.hidden = true;
    expect(codes(hidden)).toEqual([]);
  });
});
