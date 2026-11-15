import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, planRecipe, RecipeError, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `r${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const music = { kind: 'audio' as const, name: 'm.wav', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(20, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };

describe('beat montage recipe: cutting on beats or on bar starts', () => {
  function setup(downbeats: boolean) {
    let r = tx(createProject({ id: 'prj_r', name: 'R' }), [{ op: 'import_asset', args: { asset: music } }, { op: 'import_asset', args: { asset: video } }], true);
    const musicId = r.results[0]!.output!.assetId as string, videoId = r.results[1]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: musicId, start: f(0), duration: f(300) } }]);
    const clipId = (r.results[0]!.output as any).clipId as string;
    const beats = Array.from({ length: 19 }, (_, k) => f(15 * (k + 1))); // every half second from 0.5 s
    const d = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: musicId, kind: 'beats', method: 'test', params: {}, createdAt: 'now', times: beats, bpm: 120, ...(downbeats ? { downbeats: beats.filter((_, k) => k % 4 === 2), meter: 4 } : {}) } }], true).doc;
    return { d, clipId, videoId };
  }
  const starts = (plan: { ops: OpCall[] }) => plan.ops.map((o) => T.frameIndexAt((o.args as any).start, R));
  it('on beats it counts from the first beat in the clip; on bars it cuts on the bar starts, wherever in the count they fall', () => {
    const { d, clipId, videoId } = setup(true);
    expect(starts(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 4 }))).toEqual([15, 75, 135, 195, 255]);
    // bar starts are beats 3, 7, 11, 15, 19 → frames 45, 105, 165, 225, 285
    const bars = planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 1, cutOn: 'bars' });
    expect(starts(bars)).toEqual([45, 105, 165, 225, 285]);
    expect(bars.steps[0]).toMatch(/every 1 bar/);
    expect(starts(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], everyBeats: 2, cutOn: 'bars' }))).toEqual([45, 165, 285]);
    expect(bars.alternatives.some((x) => x.label === 'Cut on beats')).toBe(true);
    // the planned operations apply cleanly
    expect(() => tx(d, bars.ops)).not.toThrow();
  });
  it('asking for bars when the analysis has none is refused with a way forward; on beats no bar alternative is offered', () => {
    const { d, clipId, videoId } = setup(false);
    let err: unknown;
    try { planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId], cutOn: 'bars' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RecipeError);
    expect((err as RecipeError).code).toBe('needs_analysis');
    expect(planRecipe(d, 'beat-montage', { musicClipId: clipId, assetIds: [videoId] }).alternatives.some((x) => /bar/.test(x.label))).toBe(false);
  });
});
