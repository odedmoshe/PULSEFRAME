/**
 * Adjustment clips in the operation layer (ADR-0016): where they go, what they may carry, how the timing edits treat them
 * (like a title: no source), and the plain refusals of every edit that needs a source or a picture of the clip's own.
 * Each accepted edit leaves a valid project, and its entity diff applied backwards restores the previous one exactly (undo).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, OpError, projectVariant, restoreEntities, validateProject,
  type AdjustmentClip, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `adj${n++}_`, actor: 'test', allowInternal });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };

const tracksOf = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks;
const adjustments = (doc: ProjectDocument) => tracksOf(doc).flatMap((t) => t.clips.filter((c): c is AdjustmentClip => c.type === 'adjustment').map((clip) => ({ track: t, clip })));
const range = (c: { start: T.RationalTime; duration: T.RationalTime }) => [T.frameIndexAt(c.start, R), T.frameIndexAt(T.add(c.start, c.duration), R)];

/**
 * A video (with its linked sound) at 0…90, a still at 90…150, a title at 30…180, and an adjustment over the whole edit
 * (0…180) with a black-and-white look.
 */
function edit() {
  let r = tx(createProject({ id: 'prj_adj', name: 'A', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  const vid = r.results[0]!.output!.assetId as string, pic = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: vid, start: f(0), duration: f(90) } },
    { op: 'add_clip', args: { assetId: pic, start: f(90), duration: f(60) } },
    { op: 'add_text', args: { text: 'שלום', start: f(30), duration: f(150) } },
  ]);
  const clipId = r.results[0]!.output!.clipId as string, stillId = r.results[1]!.output!.clipId as string, titleId = r.results[2]!.output!.clipId as string;
  const base = r.doc;
  r = tx(base, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] } }]);
  const adj = r.results[0]!.output as { clipId: string; trackId: string; effectIds: string[] };
  return { base, doc: r.doc, vid, pic, clipId, stillId, titleId, adjId: adj.clipId, fxTrack: adj.trackId, fxId: adj.effectIds[0]! };
}

/** Applies the calls, checks the result is valid, and that the step's entity diff applied backwards restores `doc` exactly. */
function acceptAndUndo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

describe('adjustment tracks and the span of the whole edit', () => {
  it('a new video track lands below an adjustment track and a new text track above it', () => {
    const { doc, fxTrack } = edit();
    const r = acceptAndUndo(doc, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'text' } }]);
    const ids = tracksOf(r.doc).map((t) => t.id);
    const v2 = r.results[0]!.output!.trackId as string, t2 = r.results[1]!.output!.trackId as string;
    expect(ids.indexOf(v2)).toBeLessThan(ids.indexOf(fxTrack));
    expect(ids.indexOf(t2)).toBeGreaterThan(ids.indexOf(fxTrack));
    expect(tracksOf(r.doc).map((t) => t.kind)).toEqual(['video', 'video', 'adjustment', 'text', 'text', 'audio']);
  });
  it('span "edit" is [0, end of the last video or title clip); sound and adjustments do not count', () => {
    const { base, vid } = edit();
    const r = acceptAndUndo(base, [{ op: 'add_adjustment', args: { span: 'edit' } }]);
    expect(range(adjustments(r.doc)[0]!.clip)).toEqual([0, 180]);
    // a sound alone after the end (the video's sound, unlinked from a picture) does not extend the edit
    const song = { ...video, kind: 'audio' as const, name: 's.wav', contentHash: `sha256:${'c'.repeat(64)}`, video: undefined };
    const imported = tx(base, [{ op: 'import_asset', args: { asset: song } }], true);
    const sound = tx(imported.doc, [{ op: 'add_clip', args: { assetId: imported.results[0]!.output!.assetId as string, start: f(200), duration: f(60) } }]).doc;
    void vid;
    expect(range(adjustments(tx(sound, [{ op: 'add_adjustment', args: { span: 'edit' } }]).doc)[0]!.clip)).toEqual([0, 180]);
    // nor does an adjustment that reaches further: a second whole-edit adjustment still covers 0…180
    const a2 = tx(r.doc, [{ op: 'add_adjustment', args: { span: { start: f(170), duration: f(60) } } }, { op: 'add_adjustment', args: { span: 'edit' } }]);
    expect(adjustments(a2.doc).map((x) => range(x.clip)).sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!)).toEqual([[0, 180], [0, 180], [170, 230]]);
    expect(validateProject(a2.doc)).toEqual([]);
  });
});

describe('effects on an adjustment', () => {
  it('add_adjustment and add_effect refuse a time effect, chroma key and drop shadow with incompatible; other effects are accepted', () => {
    const { doc, base, adjId } = edit();
    for (const type of ['time.echo', 'key.chroma', 'stylize.shadow']) {
      const a = refusal(() => tx(base, [{ op: 'add_adjustment', args: { span: 'edit', effects: [{ type }] } }]));
      const b = refusal(() => tx(doc, [{ op: 'add_effect', args: { clipId: adjId, type } }]));
      for (const e of [a, b]) {
        expect(e.code).toBe('incompatible');
        expect(e.message.startsWith(`${type} cannot go on an adjustment: `)).toBe(true);
      }
    }
    for (const type of ['blur.gaussian', 'color.adjust', 'light.vignette', 'overlay.confetti', 'stylize.grain']) acceptAndUndo(doc, [{ op: 'add_effect', args: { clipId: adjId, type } }]);
  });
  it('update_effect, keyframes of an effect, blend, a colour look and a colour table work on an adjustment', () => {
    const { doc, adjId, fxId } = edit();
    acceptAndUndo(doc, [{ op: 'update_effect', args: { clipId: adjId, effectId: fxId, params: { amount: 0.5 }, enabled: false } }]);
    acceptAndUndo(doc, [{ op: 'set_effect_keyframe', args: { clipId: adjId, effectId: fxId, param: 'amount', time: f(10), value: 0.2 } }]);
    acceptAndUndo(doc, [{ op: 'set_clip_blend', args: { clipId: adjId, mode: 'multiply' } }]);
    acceptAndUndo(doc, [{ op: 'apply_look', args: { clipId: adjId, lookId: 'warm-sun' } }]);
    acceptAndUndo(doc, [{ op: 'remove_effect', args: { clipId: adjId, effectId: fxId } }]);
  });
});

describe('opacity only', () => {
  it('set_clip_transform refuses a position, size or turn and accepts opacity (and identity values)', () => {
    const { doc, adjId } = edit();
    for (const transform of [{ x: 0.1 }, { y: -0.2 }, { scale: 1.5 }, { rotation: 10 }, { opacity: 0.5, scale: 2 }]) {
      const e = refusal(() => tx(doc, [{ op: 'set_clip_transform', args: { clipId: adjId, transform } }]));
      expect([e.code, e.message]).toEqual(['incompatible', 'only the opacity of an adjustment clip can be set: it has no picture of its own to move, scale or turn']);
    }
    const r = acceptAndUndo(doc, [{ op: 'set_clip_transform', args: { clipId: adjId, transform: { opacity: 0.4 } } }]);
    expect(adjustments(r.doc)[0]!.clip.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.4 });
    acceptAndUndo(doc, [{ op: 'set_clip_transform', args: { clipId: adjId, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.7 } } }]);
  });
  it('set_keyframe animates opacity only; delete_keyframe and clear_keyframes keep working', () => {
    const { doc, adjId } = edit();
    for (const property of ['x', 'y', 'scale', 'rotation'] as const) {
      const e = refusal(() => tx(doc, [{ op: 'set_keyframe', args: { clipId: adjId, property, time: f(0), value: property === 'scale' ? 1 : 0 } }]));
      expect([e.code, e.message]).toEqual(['incompatible', 'only the opacity of an adjustment clip can be animated: it has no picture of its own to move, scale or turn']);
    }
    const keyed = acceptAndUndo(doc, [{ op: 'set_keyframe', args: { clipId: adjId, property: 'opacity', time: f(0), value: 0 } }, { op: 'set_keyframe', args: { clipId: adjId, property: 'opacity', time: f(15), value: 1 } }]).doc;
    acceptAndUndo(keyed, [{ op: 'delete_keyframe', args: { clipId: adjId, property: 'opacity', time: f(0) } }]);
    acceptAndUndo(keyed, [{ op: 'clear_keyframes', args: { clipId: adjId } }]);
  });
  it('motions: only those that change opacity alone', () => {
    const { doc, adjId } = edit();
    for (const presetId of ['motion.in.fade', 'motion.out.fade', 'motion.loop.fade-pulse']) acceptAndUndo(doc, [{ op: 'apply_motion_preset', args: { clipId: adjId, presetId } }]);
    for (const presetId of ['motion.in.pop', 'motion.move.ken-burns-in', 'motion.loop.shake', 'motion.out.slide-left']) {
      const e = refusal(() => tx(doc, [{ op: 'apply_motion_preset', args: { clipId: adjId, presetId } }]));
      expect(e.code).toBe('incompatible');
      expect(e.message).toMatch(new RegExp(`^an adjustment clip can only change its opacity; ${presetId.replace(/\./g, '\\.')} also changes `));
    }
    acceptAndUndo(doc, [{ op: 'animate_clip', args: { clipId: adjId, in: 'fade', out: 'fade' } }]);
    expect(refusal(() => tx(doc, [{ op: 'animate_clip', args: { clipId: adjId, in: 'pop' } }])).message).toBe('an adjustment clip can only change its opacity; pop also changes scale');
  });
  it('a mask on an adjustment is in frame space; per-format overrides may hide it or change its opacity only', () => {
    const { doc, adjId } = edit();
    const masked = acceptAndUndo(doc, [{ op: 'set_clip_mask', args: { clipId: adjId, mask: { shape: 'ellipse', width: 0.5, height: 0.5, invert: true } } }]);
    expect(adjustments(masked.doc)[0]!.clip.mask).toMatchObject({ shape: 'ellipse', width: 0.5, height: 0.5, invert: true });
    acceptAndUndo(masked.doc, [{ op: 'set_clip_mask', args: { clipId: adjId, mask: null } }]);
    const v = tx(doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const hidden = acceptAndUndo(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: adjId, hidden: true } }]).doc;
    expect(adjustments(projectVariant(hidden, variantId))).toEqual([]);
    const faded = acceptAndUndo(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: adjId, transform: { opacity: 0.5 } } }]).doc;
    expect(validateProject(projectVariant(faded, variantId))).toEqual([]);
    expect(refusal(() => tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: adjId, transform: { x: 0.2 } } }])).message).toBe('only the opacity of an adjustment clip can be set: it has no picture of its own to move, scale or turn');
  });
});

describe('timing edits treat an adjustment like a title (no source)', () => {
  const cases: [string, (e: ReturnType<typeof edit>) => OpCall[], (doc: ProjectDocument, e: ReturnType<typeof edit>) => void][] = [
    ['move_clip', (e) => [{ op: 'move_clip', args: { clipId: e.adjId, start: f(30) } }], (doc) => expect(range(adjustments(doc)[0]!.clip)).toEqual([30, 210])],
    ['move_clips', (e) => [{ op: 'move_clips', args: { clipIds: [e.adjId, e.titleId], delta: f(15) } }], (doc) => expect(range(adjustments(doc)[0]!.clip)).toEqual([15, 195])],
    ['trim_clip start', (e) => [{ op: 'trim_clip', args: { clipId: e.adjId, edge: 'start', to: f(20) } }], (doc) => expect(range(adjustments(doc)[0]!.clip)).toEqual([20, 180])],
    ['trim_clip end (longer than the edit)', (e) => [{ op: 'trim_clip', args: { clipId: e.adjId, edge: 'end', to: f(400) } }], (doc) => expect(range(adjustments(doc)[0]!.clip)).toEqual([0, 400])],
    ['split_clip', (e) => [{ op: 'split_clip', args: { clipId: e.adjId, at: f(60) } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 60], [60, 180]])],
    ['duplicate_clips', (e) => [{ op: 'duplicate_clips', args: { clipIds: [e.adjId], at: f(200) } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 180], [200, 380]])],
    ['duplicate_clips over itself (a new adjustment track)', (e) => [{ op: 'duplicate_clips', args: { clipIds: [e.adjId], offset: f(10) } }], (doc) => expect(adjustments(doc).map((x) => x.track.kind)).toEqual(['adjustment', 'adjustment'])],
    ['delete_clip', (e) => [{ op: 'delete_clip', args: { clipId: e.adjId } }], (doc) => expect(adjustments(doc)).toEqual([])],
    // like a title: the parts on either side of the cut stay two clips, the later one moved up against the earlier
    ['cut_range', () => [{ op: 'cut_range', args: { start: f(40), end: f(70) } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 40], [40, 150]])],
    ['cut_range without ripple', () => [{ op: 'cut_range', args: { start: f(40), end: f(70), ripple: false } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 40], [70, 180]])],
    ['insert_gap', () => [{ op: 'insert_gap', args: { at: f(50), duration: f(20) } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 50], [70, 200]])],
    ['close_gaps', (e) => [{ op: 'move_clips', args: { clipIds: [e.adjId, e.clipId, e.stillId, e.titleId], delta: f(30) } }, { op: 'close_gaps', args: {} }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 180]])],
    ['freeze_frame of the picture below', (e) => [{ op: 'freeze_frame', args: { clipId: e.clipId, at: f(45), duration: f(15) } }], (doc) => expect(adjustments(doc).map((x) => range(x.clip))).toEqual([[0, 195]])],
  ];
  for (const [name, ops, check] of cases)
    it(`${name} leaves a valid project and undoes exactly`, () => {
      const e = edit();
      const r = acceptAndUndo(e.doc, ops(e));
      check(r.doc, e);
      expect(adjustments(r.doc).every((x) => x.track.kind === 'adjustment')).toBe(true);
    });
  it('an adjustment moves onto another adjustment track, but not onto another kind; no other clip goes onto an adjustment track', () => {
    const e = edit();
    const two = tx(e.doc, [{ op: 'add_track', args: { kind: 'adjustment' } }]);
    const fx2 = two.results[0]!.output!.trackId as string;
    const moved = acceptAndUndo(two.doc, [{ op: 'move_clip', args: { clipId: e.adjId, start: f(0), trackId: fx2 } }]);
    expect(adjustments(moved.doc)[0]!.track.id).toBe(fx2);
    const video = tracksOf(e.doc).find((t) => t.kind === 'video')!.id, text = tracksOf(e.doc).find((t) => t.kind === 'text')!.id;
    for (const trackId of [video, text]) {
      const x = refusal(() => tx(e.doc, [{ op: 'move_clip', args: { clipId: e.adjId, start: f(0), trackId } }]));
      expect(x.code).toBe('incompatible');
      expect(x.message).toMatch(/^an adjustment goes on an adjustment track, not on (video|text) track \S+$/);
    }
    for (const clipId of [e.clipId, e.titleId]) {
      const x = refusal(() => tx(two.doc, [{ op: 'move_clip', args: { clipId, start: f(200), trackId: fx2, includeLinked: false } }]));
      expect([x.code, x.message]).toEqual(['incompatible', `only adjustment clips go on adjustment track ${fx2}`]);
    }
  });
});

describe('edits that need a source or a picture of the clip\'s own are refused in plain words', () => {
  const cases: [string, (e: ReturnType<typeof edit>) => OpCall, string][] = [
    ['set_transition', (e) => ({ op: 'set_transition', args: { clipId: e.adjId, type: 'dissolve', frames: 10 } }), 'given a transition'],
    ['set_clip_speed', (e) => ({ op: 'set_clip_speed', args: { clipId: e.adjId, speed: 2 } }), 'given a speed'],
    ['set_clip_speed_ramp', (e) => ({ op: 'set_clip_speed_ramp', args: { clipId: e.adjId, from: 1, to: 2 } }), 'given a speed'],
    ['speed_ramp', (e) => ({ op: 'speed_ramp', args: { clipId: e.adjId, from: 1, to: 2 } }), 'given a speed'],
    ['apply_speed_curve', (e) => ({ op: 'apply_speed_curve', args: { clipId: e.adjId, preset: 'hero' } }), 'given a speed'],
    ['set_clip_gain', (e) => ({ op: 'set_clip_gain', args: { clipId: e.adjId, gain: 0.5 } }), 'given a sound level'],
    ['set_clip_reverse', (e) => ({ op: 'set_clip_reverse', args: { clipId: e.adjId, reverse: true } }), 'played backwards'],
    ['set_clip_pitch', (e) => ({ op: 'set_clip_pitch', args: { clipId: e.adjId, keepPitch: true } }), 'given a pitch setting'],
    ['slip_clip', (e) => ({ op: 'slip_clip', args: { clipId: e.adjId, by: f(5) } }), 'slipped'],
    ['freeze_frame', (e) => ({ op: 'freeze_frame', args: { clipId: e.adjId, at: f(10), duration: f(10) } }), 'held on a freeze frame'],
    ['split_at_scenes', (e) => ({ op: 'split_at_scenes', args: { clipId: e.adjId } }), 'split at scene cuts'],
    ['link_clips', (e) => ({ op: 'link_clips', args: { clipIds: [e.adjId, e.titleId] } }), 'linked'],
  ];
  for (const [name, call, action] of cases)
    it(name, () => {
      const e = edit();
      const x = refusal(() => tx(e.doc, [call(e)]));
      expect([x.code, x.message]).toEqual(['incompatible', `an adjustment clip has no source or picture of its own, so it cannot be ${action}`]);
      expect(x.hint).toBeTruthy();
    });
  it('apply_layout with an adjustment among its clips', () => {
    const e = edit();
    const x = refusal(() => tx(e.doc, [{ op: 'apply_layout', args: { layoutId: 'layout.side-by-side', clipIds: [e.clipId, e.adjId] } }]));
    expect([x.code, x.message]).toEqual(['incompatible', 'an adjustment clip has no source or picture of its own, so it cannot be arranged in a layout']);
  });
  it('title and sound operations refuse it as before', () => {
    const e = edit();
    for (const call of [{ op: 'update_text', args: { clipId: e.adjId, text: 'x' } }, { op: 'set_clip_fades', args: { clipId: e.adjId, fadeIn: f(5) } }, { op: 'add_audio_effect', args: { clipId: e.adjId, type: 'space.echo' } }])
      expect(refusal(() => tx(e.doc, [call])).code).toBe('incompatible');
  });
});
