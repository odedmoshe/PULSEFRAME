/**
 * The stabilise track's contract (wave 7; .artifacts/wave7/stabilise-decisions.md): the optional schema fields, the integer
 * half-window, the lead-built attach_camera_motion with its merge rule and caps, the validation rules, the changes to existing ops
 * (freeze_frame, replace_clip_asset / replace_clip_media, the shared budget), the honest "not built" state of the two public ops,
 * and the rule that steady.ts never calls the float functions of Math. The it.todo rows name what W2 must make pass.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as T from '@pulseframe/time';
import {
  applyTransaction, ASSISTANT_EXCLUDED_OPS, creativeProjection, diffEntities, planStabilise, restoreEntities, steadySelftest, type SetClipStabiliseOutput, assistantOps, CameraMotionSchema, ClipStabiliseSchema, createProject, cropAreaPercent, getOp, MAX_PROJECT_TRACK_SAMPLES,
  MAX_STEADY_SAMPLES, mergeCameraStretch, OpError, ProjectSchema, SST, STEADY_OPS_BUILT, STEADY_REFUSALS, steadyHalfWindow, steadyMarginFrames, validateProject,
  type CameraStretch, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `st${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const videoAsset = (frames: number, k = 1) => ({ kind: 'video' as const, name: `v${k}.mp4`, contentHash: `sha256:${String(k).repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov });
function project(frames = 600) {
  const r = tx(createProject({ id: 'prj_st', name: 'S', width: 1280, height: 720 }), [{ op: 'import_asset', args: { asset: videoAsset(frames) } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const c = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.ZERO, duration: T.frameTime(90, R) } }]);
  const clipId = (c.results[0]!.output as { clipIds?: string[]; clipId?: string }).clipIds?.[0] ?? (c.results[0]!.output as { clipId: string }).clipId;
  return { doc: c.doc, assetId, clipId };
}
const cols = (len: number, st = SST.ok) => ({ dx: Array(len).fill(7), dy: Array(len).fill(-3), dr: Array(len).fill(5), dz: Array(len).fill(1), st: [SST.start, ...Array(len - 1).fill(st)] });
const attach = (doc: ProjectDocument, assetId: string, from: number, c: ReturnType<typeof cols>) =>
  tx(doc, [{ op: 'attach_camera_motion', args: { assetId, from, ...c, method: 'test', params: { algo: 1, input: 'proxy' }, createdAt: '2026-11-25T00:00:00Z' } }], true);
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const stretch = (from: number, st: number[], v = 1): CameraStretch => ({ from, dx: st.map(() => v), dy: st.map(() => v), dr: st.map(() => v), dz: st.map(() => v), st, origin: { method: `m${v}`, params: {}, createdAt: 'x', createdBy: 'test' } });

describe('the optional schema fields', () => {
  it('parse; unknown keys and out-of-range values do not', () => {
    expect(ClipStabiliseSchema.safeParse({ strength: 50, zoomPm: 1040 }).success).toBe(true);
    expect(ClipStabiliseSchema.safeParse({ strength: 0, zoomPm: 1040 }).success).toBe(false);
    expect(ClipStabiliseSchema.safeParse({ strength: 50, zoomPm: 999 }).success).toBe(false);
    expect(CameraMotionSchema.safeParse({ stretches: [stretch(0, [SST.start, SST.ok])] }).success).toBe(true);
    expect(CameraMotionSchema.safeParse({ stretches: [] }).success).toBe(false);
    expect(CameraMotionSchema.safeParse({ stretches: [{ ...stretch(0, [SST.start]), extra: 1 }] }).success).toBe(false);
  });
});

describe('the integer half-window and the stated crop', () => {
  it('s = 1, 50, 100 at 30 fps are 3, 21, 75 frames; 150 at 60 fps; at least 1, at most 240', () => {
    expect([1, 50, 100].map((s) => steadyHalfWindow(s, R))).toEqual([3, 21, 75]);
    expect(steadyHalfWindow(100, { num: 60, den: 1 })).toBe(150);
    expect(steadyMarginFrames({ num: 30000, den: 1001 })).toBe(75);
    expect(steadyHalfWindow(1, { num: 1, den: 1 })).toBe(1);
    expect(steadyHalfWindow(100, { num: 120, den: 1 })).toBe(240);
  });
  it('areaPercent = 100·(1 − 10⁶/zoomPm²) to one decimal', () => {
    expect(cropAreaPercent(1000)).toBe(0);
    expect(cropAreaPercent(1040)).toBe(7.5);
  });
});

describe('attach_camera_motion (lead-built)', () => {
  it('attaches a stretch as one analysis change, keeps other analyses, and validates', () => {
    const { doc, assetId } = project();
    const r = attach(doc, assetId, 10, cols(50));
    expect(r.results[0]!.output).toEqual({ assetId, stretches: 1, samples: 50, from: 10, to: 60 });
    expect(r.doc.analyses[assetId]!.cameraMotion!.stretches[0]!.origin.createdBy).toBe('test');
    expect(validateProject(r.doc)).toEqual([]);
    expect(ProjectSchema.safeParse(r.doc).success).toBe(true);
  });
  it('merges an overlapping or touching stretch; a separate one stays separate; extension keeps the old delta into its first frame', () => {
    const { doc, assetId } = project();
    let d = attach(doc, assetId, 0, cols(50)).doc;
    d = attach(d, assetId, 49, { ...cols(20), dx: Array(20).fill(9) }).doc; // overlaps frame 49: the new start sample keeps the old ok delta
    const s = d.analyses[assetId]!.cameraMotion!.stretches;
    expect(s.length).toBe(1);
    expect([s[0]!.from, s[0]!.st.length, s[0]!.st[49], s[0]!.dx[49], s[0]!.dx[50]]).toEqual([0, 69, SST.ok, 7, 9]);
    d = attach(d, assetId, 200, cols(10)).doc;
    expect(d.analyses[assetId]!.cameraMotion!.stretches.map((x) => [x.from, x.st.length])).toEqual([[0, 69], [200, 10]]);
    d = attach(d, assetId, 69, cols(5)).doc; // touches the first: merged, and its start sample stays a boundary
    const m = d.analyses[assetId]!.cameraMotion!.stretches;
    expect(m.map((x) => [x.from, x.st.length])).toEqual([[0, 74], [200, 10]]);
    expect(m[0]!.st[69]).toBe(SST.start);
    expect(validateProject(d)).toEqual([]);
  });
  it('mergeCameraStretch is pure and sorted', () => {
    const a = [stretch(10, [SST.start, SST.ok]), stretch(40, [SST.start, SST.ok])];
    expect(mergeCameraStretch(a, stretch(0, [SST.start, SST.ok, SST.ok], 2)).map((x) => [x.from, x.st.length])).toEqual([[0, 3], [10, 2], [40, 2]]);
    const out = mergeCameraStretch(a, stretch(0, [SST.start, ...Array(9).fill(SST.ok)], 2)); // ends at 10: touches the stretch at 10
    expect(out.map((x) => [x.from, x.st.length, x.st[10]])).toEqual([[0, 12, SST.start], [40, 2, undefined]]);
    expect(a[0]!.from).toBe(10);
  });
  it('refuses malformed columns, a first sample that is not a start, a stretch past the file, a file over its cap, a non-video file', () => {
    const { doc, assetId } = project(MAX_STEADY_SAMPLES + 500);
    expect(refusal(() => attach(doc, assetId, 0, { ...cols(5), dx: [1] })).message).toBe(STEADY_REFUSALS.badColumns.message('the columns differ in length'));
    expect(refusal(() => attach(doc, assetId, 0, { ...cols(5), st: [SST.ok, 1, 1, 1, 1] })).message).toBe(STEADY_REFUSALS.firstNotStart.message());
    expect(refusal(() => attach(doc, assetId, 0, { ...cols(5), dr: [0, 0, 0, 900_000, 0] })).message).toBe(STEADY_REFUSALS.badColumns.message('a column holds a value out of range'));
    expect(refusal(() => attach(doc, assetId, MAX_STEADY_SAMPLES + 499, cols(5))).message).toBe(STEADY_REFUSALS.outsideFile.message(MAX_STEADY_SAMPLES + 504, MAX_STEADY_SAMPLES + 500));
    const half = attach(doc, assetId, 0, cols(6000)).doc;
    expect(refusal(() => attach(half, assetId, 6300, cols(4900))).message).toBe(STEADY_REFUSALS.fileFull.message(10_900));
    expect(refusal(() => attach(doc, 'ast_none', 0, cols(5))).message).toBe(STEADY_REFUSALS.assetMissing.message());
  });
  it('shares the project budget with the motion tracks, in both directions', () => {
    let doc = createProject({ id: 'prj_b', name: 'B', width: 1280, height: 720 });
    const ids: string[] = [];
    for (let k = 1; k <= 5; k++) { const r = tx(doc, [{ op: 'import_asset', args: { asset: videoAsset(MAX_STEADY_SAMPLES, k) } }], true); doc = r.doc; ids.push(r.results[0]!.output!.assetId as string); }
    for (const id of ids.slice(0, 4)) doc = attach(doc, id, 0, cols(MAX_STEADY_SAMPLES)).doc;
    expect(refusal(() => attach(doc, ids[4]!, 0, cols(2))).message).toBe(STEADY_REFUSALS.budget.message(MAX_PROJECT_TRACK_SAMPLES + 2, MAX_PROJECT_TRACK_SAMPLES));
    const t = refusal(() => tx(doc, [{ op: 'create_motion_track', args: { assetId: ids[4], kind: 'point', frame: 0, x: 1, y: 1 } }]));
    expect([t.code, t.message]).toEqual(['out_of_bounds', STEADY_REFUSALS.budget.message(MAX_PROJECT_TRACK_SAMPLES + 1, MAX_PROJECT_TRACK_SAMPLES)]);
  });
});

describe('validation rules (lead-built)', () => {
  it('stabilise_clip, stabilise_path, camera_motion', () => {
    const { doc, assetId, clipId } = project();
    const d = structuredClone(doc);
    const clip = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    (clip as { stabilise?: unknown }).stabilise = { strength: 50, zoomPm: 1040 };
    expect(validateProject(d).map((i) => i.code)).toContain('stabilise_path');
    d.analyses[assetId] = { assetId, cameraMotion: { stretches: [stretch(0, [SST.ok, SST.ok]), stretch(2, [SST.start])] } };
    const codes = validateProject(d).filter((i) => i.code === 'camera_motion').map((i) => i.message);
    expect(codes.some((m) => /sample 0 is not a start/.test(m))).toBe(true);
    expect(codes.some((m) => /overlaps or touches/.test(m))).toBe(true);
    const audio = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')?.clips[0];
    if (audio) { (audio as { stabilise?: unknown }).stabilise = { strength: 50, zoomPm: 1000 }; expect(validateProject(d).some((i) => i.code === 'stabilise_clip' && i.ids[0] === audio.id)).toBe(true); }
  });
});

describe('existing ops that meet a stabilised clip', () => {
  const stabilised = () => {
    const { doc, assetId, clipId } = project();
    const d = attach(doc, assetId, 0, cols(200)).doc;
    const clip = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)!;
    (clip as { stabilise?: unknown }).stabilise = { strength: 50, zoomPm: 1040 };
    expect(validateProject(d)).toEqual([]);
    return { d, assetId, clipId };
  };
  it('freeze_frame copies the switch to the held clip', () => {
    const { d, clipId } = stabilised();
    const r = tx(d, [{ op: 'freeze_frame', args: { clipId, at: T.frameTime(30, R), duration: T.frameTime(10, R) } }]);
    const held = r.doc.sequences[r.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'media' && c.freeze);
    expect((held as { stabilise?: unknown }).stabilise).toEqual({ strength: 50, zoomPm: 1040 });
  });
  it('replace_clip_media refuses otherFile instead of dropping the switch', () => {
    const { d, clipId } = stabilised();
    const r = tx(d, [{ op: 'import_asset', args: { asset: videoAsset(600, 2) } }], true);
    const other = r.results[0]!.output!.assetId as string;
    const e = refusal(() => tx(r.doc, [{ op: 'replace_clip_media', args: { clipId, assetId: other } }]));
    expect([e.code, e.message]).toEqual(['incompatible', STEADY_REFUSALS.otherFile.message()]);
  });
  it('replace_clip_asset refuses otherFile on a stabilised clip given a derived copy', () => {
    const { d, clipId, assetId } = stabilised();
    const derived = { ...videoAsset(600, 3), provenance: { origin: 'derived' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_x', capabilityId: 'cap', capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [assetId], outputName: 'o', outputRole: 'video', encoding: 'h264', provider: {} } } };
    const r = tx(d, [{ op: 'import_asset', args: { asset: derived } }], true);
    const copy = r.results[0]!.output!.assetId as string;
    const e = refusal(() => tx(r.doc, [{ op: 'replace_clip_asset', args: { clipId, assetId: copy } }]));
    expect([e.code, e.message]).toEqual(['incompatible', STEADY_REFUSALS.otherFile.message()]);
    // switched off first, the same call is judged on its own rules again (here the copy's timing), no longer otherFile
    const off = tx(r.doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: null } }]).doc;
    expect(refusal(() => tx(off, [{ op: 'replace_clip_asset', args: { clipId, assetId: copy } }])).message).not.toBe(STEADY_REFUSALS.otherFile.message());
  });
});

describe('the public operations before W2', () => {
  it('are registered, public, excluded from the assistant; each refuses notBuilt and changes nothing', () => {
    for (const op of ['set_clip_stabilise', 'remove_camera_motion']) {
      expect(getOp(op)?.internal ?? false).toBe(false);
      expect(ASSISTANT_EXCLUDED_OPS as readonly string[]).toContain(op);
      expect(assistantOps()).not.toContain(op);
    }
    expect(getOp('attach_camera_motion')?.internal).toBe(true);
    if (STEADY_OPS_BUILT) return;
    const { doc, clipId, assetId } = project();
    for (const call of [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }, { op: 'remove_camera_motion', args: { assetId } }]) {
      const e = refusal(() => tx(doc, [call]));
      expect([e.code, e.message]).toEqual(['unknown_op', STEADY_REFUSALS.notBuilt.message(call.op)]);
    }
  });
  const shaky = (len: number, seed = 1) => {
    let x = seed;
    const r = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return ((x >>> 8) % 2001) - 1000; };
    return { dx: Array.from({ length: len }, () => r()), dy: Array.from({ length: len }, () => r()), dr: Array.from({ length: len }, () => r()), dz: Array.from({ length: len }, () => Math.trunc(r() / 4)), st: [SST.start, ...Array(len - 1).fill(SST.ok)] };
  };
  const clipOf = (doc: ProjectDocument, id: string) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as { stabilise?: { strength: number; zoomPm: number } };
  it('set_clip_stabilise — notVideo, multicam, notMeasured, tooLittle; default strength 50; maxCrop bisection with strengthLowered; zoomPm rounded up; null keeps the measurement; one undo', () => {
    const { doc, clipId, assetId } = project();
    const audio = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')?.clips[0];
    if (audio) expect(refusal(() => tx(doc, [{ op: 'set_clip_stabilise', args: { clipId: audio.id, stabilise: {} } }])).message).toBe(STEADY_REFUSALS.notVideo.message());
    const mc = structuredClone(doc);
    (clipOf(mc, clipId) as { multicam?: unknown }).multicam = { groupId: 'mcg_x', angle: 'x' };
    expect(refusal(() => tx(mc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }])).message).toBe(STEADY_REFUSALS.multicam.message());
    expect(refusal(() => tx(doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }])).message).toBe(STEADY_REFUSALS.notMeasured.message());
    const elsewhere = attach(doc, assetId, 300, cols(50)).doc; // the clip shows frames 0..89: none measured
    expect(refusal(() => tx(elsewhere, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }])).message).toBe(STEADY_REFUSALS.notMeasured.message());
    // 40 of the clip's 90 frames ok or weak (44 %), the rest unknown
    const thin = attach(doc, assetId, 0, { ...cols(90), st: [SST.start, ...Array(39).fill(SST.ok), ...Array(50).fill(SST.unknown)] }).doc;
    const tl = refusal(() => tx(thin, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]));
    expect([tl.code, tl.message, tl.details.percent]).toEqual(['incompatible', STEADY_REFUSALS.tooLittle.message(44), 44]);
    // measured: the default strength, the smallest zoom rounded up, one change of the clip entity, one undo
    const m = attach(doc, assetId, 0, shaky(200)).doc;
    const r = tx(m, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]);
    const out = r.results[0]!.output as unknown as SetClipStabiliseOutput;
    const plan = planStabilise(m, clipOf(m, clipId) as never, { strength: 50 });
    expect(out).toEqual({ stabilise: { strength: 50, zoomPm: plan.zoomPm }, crop: { zoomPm: plan.zoomPm, areaPercent: cropAreaPercent(plan.zoomPm) }, measured: { frames: 90, ok: 90, weak: 0, unknown: 0, outside: 0 }, strengthLowered: false, limitedFrames: [] });
    expect(plan.zoomPm).toBeGreaterThan(1000);
    expect(clipOf(r.doc, clipId).stabilise).toEqual({ strength: 50, zoomPm: plan.zoomPm });
    expect(validateProject(r.doc)).toEqual([]);
    const changes = diffEntities(m, r.doc);
    expect(changes.map((c) => c.id)).toEqual([clipId]);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(m));
    // maxCrop below what strength 100 needs: lowered, the crop within it
    const full = (tx(m, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100 } } }]).results[0]!.output as unknown as SetClipStabiliseOutput).crop!;
    const cap = Math.max(1, Math.floor(full.areaPercent) - 1);
    const low = tx(m, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100, maxCrop: cap } } }]).results[0]!.output as unknown as SetClipStabiliseOutput;
    expect(low.strengthLowered).toBe(true);
    expect(low.stabilise!.strength).toBeLessThan(100);
    expect(100 * (1 - 1e6 / low.crop!.zoomPm ** 2)).toBeLessThanOrEqual(cap);
    // a given zoom is stored as is
    expect(tx(m, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 70, zoomPm: 1500 } } }]).results[0]!.output).toMatchObject({ stabilise: { strength: 70, zoomPm: 1500 } });
    // null: switched off, the measurement kept; one undo
    const off = tx(r.doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: null } }]);
    expect(clipOf(off.doc, clipId).stabilise).toBeUndefined();
    expect(off.doc.analyses[assetId]!.cameraMotion).toEqual(r.doc.analyses[assetId]!.cameraMotion);
    expect(off.results[0]!.output).toMatchObject({ stabilise: null, crop: null });
  });
  it('remove_camera_motion — noMeasurement, inUse; mode unbind switches the clips off; mode unused-only keeps what stabilised clips show', () => {
    const { doc, clipId, assetId } = project();
    expect(refusal(() => tx(doc, [{ op: 'remove_camera_motion', args: { assetId } }])).message).toBe(STEADY_REFUSALS.noMeasurement.message());
    expect(refusal(() => tx(doc, [{ op: 'remove_camera_motion', args: { assetId: 'ast_none' } }])).message).toBe(STEADY_REFUSALS.assetMissing.message());
    let m = attach(doc, assetId, 0, shaky(200)).doc;
    m = attach(m, assetId, 400, cols(50)).doc; // a second stretch, far from the clip
    const plain = tx(m, [{ op: 'remove_camera_motion', args: { assetId } }]);
    expect(plain.results[0]!.output).toEqual({ assetId, removedStretches: 2, unbound: [] });
    expect(plain.doc.analyses[assetId]).toBeUndefined(); // nothing else was on the record
    const on = tx(m, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]).doc;
    const iu = refusal(() => tx(on, [{ op: 'remove_camera_motion', args: { assetId } }]));
    expect([iu.code, iu.message]).toEqual(['incompatible', STEADY_REFUSALS.inUse.message(1)]);
    expect(refusal(() => tx(on, [{ op: 'remove_camera_motion', args: { assetId, mode: 'if-unused' } }])).message).toBe(STEADY_REFUSALS.inUse.message(1));
    const ub = tx(on, [{ op: 'remove_camera_motion', args: { assetId, mode: 'unbind' } }]);
    expect(ub.results[0]!.output).toEqual({ assetId, removedStretches: 2, unbound: [clipId] });
    expect(clipOf(ub.doc, clipId).stabilise).toBeUndefined();
    expect(validateProject(ub.doc)).toEqual([]);
    const changes = diffEntities(on, ub.doc), back = structuredClone(ub.doc);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(on));
    const uo = tx(on, [{ op: 'remove_camera_motion', args: { assetId, mode: 'unused-only' } }]);
    expect(uo.results[0]!.output).toEqual({ assetId, removedStretches: 1, unbound: [] });
    expect(uo.doc.analyses[assetId]!.cameraMotion!.stretches.map((s) => s.from)).toEqual([0]);
    expect(clipOf(uo.doc, clipId).stabilise).toBeDefined();
    expect(validateProject(uo.doc)).toEqual([]);
    // a stabilised clip trimmed off every stretch still uses the nearest one (its frames are drawn with that stretch's poses)
    const far = tx(on, [{ op: 'slip_clip', args: { clipId, by: T.frameTime(300, R) } }]).doc; // shows 300..389, stretches at 0..199 and 400..449
    const kept = tx(far, [{ op: 'remove_camera_motion', args: { assetId, mode: 'unused-only' } }]).doc;
    expect(kept.analyses[assetId]!.cameraMotion!.stretches.length).toBeGreaterThan(0);
    expect(validateProject(kept)).toEqual([]);
  });
  it('replaying set_clip_stabilise from the op log gives the same zoomPm bits (STEADY_MATHS_V1)', () => {
    const { doc, clipId, assetId } = project();
    const m = attach(doc, assetId, 0, shaky(300, 7)).doc;
    const calls: OpCall[] = [{ op: 'set_clip_stabilise', args: { clipId, stabilise: { strength: 100, maxCrop: 3 } } }];
    const a = tx(m, calls), b = applyTransaction(JSON.parse(JSON.stringify(m)) as ProjectDocument, calls, { idSeed: 'replay_', actor: 'test' }); // a fresh document: no cached poses
    expect(JSON.stringify(b.results[0]!.output)).toBe(JSON.stringify(a.results[0]!.output));
    expect(clipOf(b.doc, clipId).stabilise).toEqual(clipOf(a.doc, clipId).stabilise);
    expect((a.results[0]!.output as unknown as SetClipStabiliseOutput).strengthLowered).toBe(true);
  });
});

describe('steady.ts uses only + − × / (STEADY_MATHS_V1)', () => {
  it('never calls the float functions of Math', () => {
    const src = fs.readFileSync(new URL('./steady.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src.match(/Math\.(sin|cos|tan|exp|expm1|log|log1p|log2|log10|pow|atan|atan2|asin|acos|hypot|sqrt|cbrt|sinh|cosh|tanh)\b/g) ?? []).toEqual([]);
  });
  it('sinCos and expm, compose/inverse, the steady pan, neededZoom and limitToCover are proved in steady.test.ts (S8, S9, S6 rows); the frozen digest holds', () => {
    expect(steadySelftest().ok).toBe(true);
  });
});
