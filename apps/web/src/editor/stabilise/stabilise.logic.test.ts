/** The block's logic: states, the crop line equal to the operation's, the report, the operations it commits, keys and progress. */
import { beforeEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, SST, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import {
  forgetStrengths, jumpFrameIn, panelState, previewPlan, previewValue, rememberStrength, removeOp, reportItems, sliderKey, stabiliseProgress, stabiliseView, strengthOp, strengthToUse,
  switchOffOp, switchOnOp, switchableFrom, zoomText, percentText,
} from './stabilise.logic.ts';

const R30 = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sl${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (frames: number, kind: 'video' | 'image' = 'video') => ({ kind, name: 'v.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30), video: { width: 1280, height: 720, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov });
const clips = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips);
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
function setup(opts: { from?: number; frames?: number; st?: number[] } = {}) {
  const base = tx(createProject({ id: 'prj_sl', name: 'S', width: 1280, height: 720 }), [{ op: 'import_asset', args: { asset: video(600) } }], true);
  const assetId = base.results[0]!.output!.assetId as string;
  const added = tx(base.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, R30), sourceIn: T.frameTime(100, R30), duration: T.frameTime(90, R30) } }]).doc;
  const clipId = clips(added).find((c) => c.type === 'media')!.id;
  const len = opts.frames ?? 240, r = rng(4);
  const st = opts.st ?? [SST.start, ...Array<number>(len - 1).fill(SST.ok)];
  const col = () => st.map((s) => (s === SST.ok || s === SST.weak ? Math.round((r() - 0.5) * 600) : 0));
  const doc = tx(added, [{ op: 'attach_camera_motion', args: { assetId, from: opts.from ?? 25, st, dx: col(), dy: col(), dr: col(), dz: col().map((v) => Math.round(v / 4)), method: 't', params: { algo: 1, input: 'proxy' }, createdAt: 'x' } }], true).doc;
  return { doc, clip: clips(doc).find((c) => c.id === clipId) as MediaClip, assetId, clipId };
}
const on = (s: ReturnType<typeof setup>, stabilise: Record<string, unknown> = { strength: 50, maxCrop: 15 }) => {
  const doc = tx(s.doc, [{ op: 'set_clip_stabilise', args: { clipId: s.clipId, stabilise } }]).doc;
  return { ...s, doc, clip: clips(doc).find((c) => c.id === s.clipId) as MediaClip };
};
beforeEach(() => forgetStrengths());

describe('the kind of the block', () => {
  it('a clip with no camera motion is not measured', () => {
    const base = tx(createProject({ id: 'prj_sl', name: 'S', width: 1280, height: 720 }), [{ op: 'import_asset', args: { asset: video(600) } }], true);
    const assetId = base.results[0]!.output!.assetId as string;
    const d = tx(base.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, R30), duration: T.frameTime(60, R30) } }]).doc;
    const v = stabiliseView(d, clips(d).find((c) => c.type === 'media'))!;
    expect(v.kind).toBe('not-measured');
    expect(v.switchable).toBe(false);
    expect(panelState(v, { measuring: false, refused: false })).toBe('not-measured');
  });
  it('a measurement that does not reach the clip\'s frames is not measured; one that covers them is off until switched on', () => {
    const far = setup({ from: 300 });
    expect(stabiliseView(far.doc, far.clip)!.kind).toBe('not-measured');
    const s = setup();
    const v = stabiliseView(s.doc, s.clip)!;
    expect(v.kind).toBe('off');
    expect(v.switchable).toBe(true);
    expect(v.plan).toBeNull();
  });
  it('a file measured under half is not switchable (the operation would refuse tooLittle)', () => {
    const st = [SST.start, ...Array.from({ length: 239 }, (_, i) => (i % 3 === 0 ? SST.ok : SST.unknown))];
    const s = setup({ st });
    expect(stabiliseView(s.doc, s.clip)!.switchable).toBe(false);
    expect(switchableFrom({ frames: 10, ok: 5, weak: 0, unknown: 5, outside: 0 })).toBe(true);
    expect(switchableFrom({ frames: 10, ok: 4, weak: 0, unknown: 6, outside: 0 })).toBe(false);
    expect(switchableFrom({ frames: 10, ok: 10, weak: 0, unknown: 0, outside: 1 })).toBe(false);
  });
  it('a still picture and a multicam segment are not offered', () => {
    const base = tx(createProject({ id: 'prj_sl', name: 'S', width: 1280, height: 720 }), [{ op: 'import_asset', args: { asset: video(1, 'image') } }], true);
    const assetId = base.results[0]!.output!.assetId as string;
    const d = tx(base.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, R30), duration: T.frameTime(30, R30) } }]).doc;
    const v = stabiliseView(d, clips(d).find((c) => c.type === 'media'))!;
    expect(v.kind).toBe('still');
    expect(panelState(v, { measuring: true, refused: true })).toBe('not-offered');
    const s = setup();
    const mc = { ...s.clip, multicam: { groupId: 'g', angleId: 'a' } } as unknown as MediaClip;
    expect(stabiliseView(s.doc, mc)!.kind).toBe('multicam');
  });
  it('on: the stored strength and the crop of the stored zoom; measuring and refused win over the rest', () => {
    const s = on(setup());
    const v = stabiliseView(s.doc, s.clip)!;
    expect(v.kind).toBe('on');
    expect(v.stored).toEqual(s.clip.stabilise);
    expect(v.plan!.zoomPm).toBe(s.clip.stabilise!.zoomPm);
    expect(panelState(v, { measuring: false, refused: false })).toBe('on');
    expect(panelState(v, { measuring: false, refused: true })).toBe('refused');
    expect(panelState(v, { measuring: true, refused: true })).toBe('measuring');
  });
});

describe('the slider preview equals what the operation stores', () => {
  it('at 12 strengths, previewPlan\'s zoom and crop are the operation\'s output', () => {
    const s = setup();
    for (const strength of [1, 5, 13, 25, 37, 50, 61, 75, 88, 95, 99, 100]) {
      const r = tx(s.doc, [strengthOp(s.clip, strength)]);
      const out = r.results[0]!.output as { stabilise: { strength: number; zoomPm: number }; crop: { zoomPm: number; areaPercent: number } };
      const p = previewPlan(s.doc, s.clip, strength);
      expect(previewValue(p)).toEqual(out.stabilise);
      expect({ zoomPm: p.zoomPm, areaPercent: p.areaPercent }).toEqual(out.crop);
    }
  });
  it('the crop line says one decimal and two decimals of zoom', () => {
    expect(percentText(12)).toBe('12.0');
    expect(zoomText(1075)).toBe('1.07');
    expect(zoomText(1000)).toBe('1.00');
  });
});

describe('the operations the block commits', () => {
  it('switching on uses the remembered strength as it was, else strength 50 with the 15 % crop limit; off is null', () => {
    const s = setup();
    expect(switchOnOp(s.clip).args).toEqual({ clipId: s.clipId, stabilise: { strength: 50, maxCrop: 15 } });
    rememberStrength(s.clipId, 80);
    expect(switchOnOp(s.clip).args).toEqual({ clipId: s.clipId, stabilise: { strength: 80 } });
    expect(switchOffOp(s.clip).args).toEqual({ clipId: s.clipId, stabilise: null });
    expect(strengthToUse(s.clip)).toBe(80);
  });
  it('the three operations are accepted by the real operations; one undo step each', () => {
    const s = setup();
    const a = tx(s.doc, [switchOnOp(s.clip)]).doc;
    const c = clips(a).find((x) => x.id === s.clipId) as MediaClip;
    expect(c.stabilise).toBeTruthy();
    const off = tx(a, [switchOffOp(c)]).doc;
    expect((clips(off).find((x) => x.id === s.clipId) as MediaClip).stabilise).toBeUndefined();
    expect(off.analyses?.[s.assetId]?.cameraMotion).toBeTruthy(); // the measurement stays
  });
  it('removal: this clip alone using the measurement unbinds it; another stabilised clip makes the operation refuse with the count', () => {
    const s = on(setup());
    expect(removeOp(s.doc, s.clip).args).toEqual({ assetId: s.assetId, mode: 'unbind' });
    const r = tx(s.doc, [removeOp(s.doc, s.clip)]).doc;
    expect(r.analyses?.[s.assetId]?.cameraMotion).toBeUndefined();
    expect((clips(r).find((x) => x.id === s.clipId) as MediaClip).stabilise).toBeUndefined();
    const second = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.assetId, start: T.frameTime(200, R30), sourceIn: T.frameTime(100, R30), duration: T.frameTime(60, R30) } }]).doc;
    const other = clips(second).filter((c): c is MediaClip => c.type === 'media').find((c) => c.id !== s.clipId)!;
    const both = tx(second, [{ op: 'set_clip_stabilise', args: { clipId: other.id, stabilise: { strength: 50 } } }]).doc;
    expect(removeOp(both, s.clip).args).toEqual({ assetId: s.assetId, mode: 'if-unused' });
  });
});

describe('the report', () => {
  it('lists weak, unknown and cut runs inside the clip\'s frames, clipped, with the rest counted', () => {
    const st = [SST.start, ...Array<number>(239).fill(SST.ok)];
    st[90] = SST.weak; st[91] = SST.weak; st[120] = SST.unknown; st[150] = SST.start; st[10] = SST.weak; // frames 115, 116, 145, 175 and 35 of the file
    const s = setup({ st });
    const r = reportItems(s.doc.analyses![s.assetId]!.cameraMotion!, 100, 189);
    expect(r.items).toEqual([{ kind: 'weak', from: 115, to: 117 }, { kind: 'unknown', from: 145, to: 146 }, { kind: 'cut', from: 175, to: 176 }]);
    const v = stabiliseView(s.doc, s.clip)!;
    expect(v.report).toEqual(r.items);
    expect(reportItems(s.doc.analyses![s.assetId]!.cameraMotion!, 0, 599, 2).more).toBe(2);
  });
  it('a jump goes to the first timeline frame at which this clip shows the frames, honouring speed; null when it shows none', () => {
    const s = setup();
    expect(jumpFrameIn(s.doc, s.clip, 115, 117)).toBe(15);
    expect(jumpFrameIn(s.doc, s.clip, 300, 301)).toBeNull();
    const fast = tx(s.doc, [{ op: 'set_clip_speed', args: { clipId: s.clipId, speed: 2 } }]).doc;
    expect(jumpFrameIn(fast, clips(fast).find((c) => c.id === s.clipId) as MediaClip, 120, 122)).toBe(10);
  });
  it('weaker near the edges: shown when the clip starts at the start of the measured stretch, not when the margin holds', () => {
    const near = setup({ from: 100 });
    expect(stabiliseView(near.doc, near.clip)!.kind).toBe('off');
    const n2 = on(near);
    expect(stabiliseView(n2.doc, n2.clip)!.weakerNearEdges).toBe(true);
    const far = on(setup({ from: 0, frames: 400 }));
    expect(stabiliseView(far.doc, far.clip)!.weakerNearEdges).toBe(false);
  });
  it('the speed hint shows for a sped-up clip only', () => {
    const s = on(setup());
    expect(stabiliseView(s.doc, s.clip)!.sped).toBe(false);
    const fast = tx(s.doc, [{ op: 'set_clip_speed', args: { clipId: s.clipId, speed: 2 } }]).doc;
    expect(stabiliseView(fast, clips(fast).find((c) => c.id === s.clipId))!.sped).toBe(true);
  });
});

describe('keys and progress', () => {
  it('PageUp and PageDown move ten, Home and End the ends, clamped; arrows are the native step', () => {
    expect(sliderKey('PageUp', 50)).toBe(60);
    expect(sliderKey('PageDown', 50)).toBe(40);
    expect(sliderKey('PageUp', 95)).toBe(100);
    expect(sliderKey('PageDown', 4)).toBe(1);
    expect(sliderKey('Home', 50)).toBe(1);
    expect(sliderKey('End', 50)).toBe(100);
    expect(sliderKey('ArrowRight', 50)).toBeNull();
  });
  it('progress from the job stage', () => {
    expect(stabiliseProgress(null)).toEqual({ phase: null, percent: null });
    expect(stabiliseProgress('reading frames')).toEqual({ phase: 'reading', percent: null });
    expect(stabiliseProgress('measuring camera motion 30/120')).toEqual({ phase: 'measuring', percent: 25 });
    expect(stabiliseProgress('measuring camera motion 5/0')).toEqual({ phase: 'measuring', percent: 0 });
    expect(stabiliseProgress('saving camera motion')).toEqual({ phase: 'saving', percent: 100 });
    expect(stabiliseProgress('something else')).toEqual({ phase: null, percent: null });
  });
});
