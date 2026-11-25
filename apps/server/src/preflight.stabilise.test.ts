/**
 * Preflight warns about stabilised clips (wave 7; preflight.ts stabiliseIssues): source frames shown that no measured stretch
 * holds (stabilise_unmeasured) and frames where the cover limit weakens the correction (stabilise_limited, with the reason and a
 * fix that recalculates the crop). Ranges are timeline frames found by the real evaluator, so speed maps them as they render.
 * Warnings only. Documents are built through the operations; no exporter is needed (the function reads the document only).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, SST, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { stabiliseIssues } from './preflight.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pfs${n++}_`, actor: 'test', allowInternal });
const asset = { kind: 'video' as const, name: 'walk.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(600, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
function shaky(len: number) {
  let x = 5;
  const r = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return ((x >>> 8) % 2001) - 1000; };
  return { dx: Array.from({ length: len }, () => 2 * r()), dy: Array.from({ length: len }, () => 2 * r()), dr: Array.from({ length: len }, () => r()), dz: Array.from({ length: len }, () => 0), st: [SST.start, ...Array<number>(len - 1).fill(SST.ok)] };
}
/** A clip of source 100..159 at timeline 0..59; its file measured on [from, from + len). */
function scene(from: number, len: number) {
  let r = tx(createProject({ id: 'prj_pfs', name: 'P', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(100), duration: f(60), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'attach_camera_motion', args: { assetId, from, ...shaky(len), method: 't', params: { algo: 1, input: 'proxy' }, createdAt: 'x' } }], true);
  return { doc: r.doc, assetId, clipId };
}
const pick = (issues: ReturnType<typeof stabiliseIssues>, code: string) => issues.filter((i) => i.code === code).map((i) => ({ range: i.range, severity: i.severity }));

describe('preflight: stabilised clips', () => {
  it('nothing for clips without the switch, or stabilised on measured frames at their own zoom', () => {
    const { doc, clipId } = scene(0, 300);
    expect(stabiliseIssues(doc, R)).toEqual([]);
    expect(stabiliseIssues(tx(doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]).doc, R)).toEqual([]);
  });
  it('stabilise_unmeasured at the timeline frames whose source frames are outside the measurement, at speed 1 and 2', () => {
    const { doc, clipId } = scene(0, 140); // measured 0..139: the clip's source 140..159 (timeline 40..59) is not
    const on = tx(doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]).doc;
    const issues = stabiliseIssues(on, R);
    expect(pick(issues, 'stabilise_unmeasured')).toEqual([{ range: { startFrame: 40, endFrame: 60 }, severity: 'warning' }]);
    expect(issues.find((i) => i.code === 'stabilise_unmeasured')!.message).toMatch(/^on frames 40–59 the camera motion of "walk.mp4" was not measured.*Measure the clip again/);
    // the clip at speed 2 shows source 100..218 over timeline 0..29: unmeasured from source 140, timeline 20
    const fast = tx(on, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    expect(pick(stabiliseIssues(fast, R), 'stabilise_unmeasured')).toEqual([{ range: { startFrame: 20, endFrame: 30 }, severity: 'warning' }]);
  });
  it('stabilise_limited where the stored zoom is too small (the clip changed), with a fix that recalculates the crop; the fix clears it', () => {
    const { doc, clipId } = scene(0, 400);
    const small = tx(doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100, zoomPm: 1001 } } }]).doc;
    const lim = stabiliseIssues(small, R).filter((i) => i.code === 'stabilise_limited');
    expect(lim.length).toBeGreaterThan(0);
    expect(lim.every((i) => i.severity === 'warning' && /the clip changed since its crop was computed/.test(i.message))).toBe(true);
    expect(lim.length).toBeLessThanOrEqual(20);
    const fix = lim[0]!.fix!;
    expect(fix.ops).toEqual([{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100 } } }]);
    expect(stabiliseIssues(tx(small, fix.ops).doc, R)).toEqual([]);
    // at speed 2 the ranges are timeline frames of the faster clip (all inside its 30 frames)
    const fast = tx(small, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    const lf = stabiliseIssues(fast, R).filter((i) => i.code === 'stabilise_limited' && i.range);
    expect(lf.length).toBeGreaterThan(0);
    expect(lf.every((i) => i.range!.startFrame >= 0 && i.range!.endFrame <= 30)).toBe(true);
  });
  it('a limit only where a transition handle reaches past the clip says so', () => {
    const { doc, clipId, assetId } = scene(0, 400);
    let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(300), duration: f(30), withLinkedAudio: false } }]);
    const b = r.results[0]!.output!.clipId as string;
    // the zoom of the clip's own frames, computed before the next clip's transition gave it a handle
    r = tx(r.doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100 } } }]);
    r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 20 } }]);
    const lim = stabiliseIssues(r.doc, R).filter((i) => i.code === 'stabilise_limited');
    expect(lim.length).toBeGreaterThan(0);
    for (const i of lim) {
      expect(i.message).toMatch(/a transition handle or a velocity ramp shows frames outside the clip/);
      expect(i.range!.startFrame).toBeGreaterThanOrEqual(60);
    }
  });
});
