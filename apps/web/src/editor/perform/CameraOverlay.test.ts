import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, DEFAULT_CAMERA, planCamera, type Asset, type CameraGeometry, type MediaClip } from '@pulseframe/core';
import { cameraSample, cameraSourceDocument, centreFromPointer, clampCentre, localFrame, sourceFrameAt, stepZoom, windowFractions, ZOOM_STEP } from './CameraOverlay.tsx';

const R = { num: 30, den: 1 };
const wide: CameraGeometry = { frameW: 1080, frameH: 1920, srcW: 1920, srcH: 1080, fit: 'contain' }; // a 16:9 source in a 9:16 frame
const same: CameraGeometry = { frameW: 1920, frameH: 1080, srcW: 1920, srcH: 1080, fit: 'contain' };

describe('camera geometry (display only; the plan is core planCamera)', () => {
  it('at the fill scale one axis of the window is the whole source and the other is the part the frame shows', () => {
    const w = windowFractions(wide, 1);
    expect(w.wv).toBeCloseTo(1, 9);
    expect(w.wu).toBeCloseTo(0.31640625, 6);
    expect(windowFractions(same, 1)).toEqual({ wu: 1, wv: 1 });
  });
  it('zooming in shrinks the window by the zoom factor', () => {
    const a = windowFractions(wide, 1), b = windowFractions(wide, 2);
    expect(b.wu).toBeCloseTo(a.wu / 2, 9);
    expect(b.wv).toBeCloseTo(a.wv / 2, 9);
  });
  it('the centre never lets the window leave the source', () => {
    expect(clampCentre(0, 0, 0.4, 0.5)).toEqual({ u: 0.2, v: 0.25 });
    expect(clampCentre(2, 2, 0.4, 0.5)).toEqual({ u: 0.8, v: 0.75 });
    expect(clampCentre(0.5, 0.5, 1, 1)).toEqual({ u: 0.5, v: 0.5 });
  });
  it('the pointer maps to the centre inside the picture box and is clamped', () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    expect(centreFromPointer(300, 150, box, 0.2, 0.2)).toEqual({ u: 0.5, v: 0.5 });
    expect(centreFromPointer(100, 50, box, 0.2, 0.2)).toEqual({ u: 0.1, v: 0.1 });
    expect(centreFromPointer(900, 900, box, 0.2, 0.2)).toEqual({ u: 0.9, v: 0.9 });
  });
  it('zoom steps by ×1.1 to the ceiling and back down to 1, and never past either', () => {
    expect(stepZoom(1, 1, 4)).toBeCloseTo(ZOOM_STEP, 6);
    expect(stepZoom(ZOOM_STEP, -1, 4)).toBe(1);
    expect(stepZoom(1, -1, 4)).toBe(1);
    expect(stepZoom(3.9, 1, 4)).toBe(4);
    expect(stepZoom(4, 1, 4)).toBe(4);
    let z = 1, n = 0;
    while (z < 2.85 && n < 100) { z = stepZoom(z, 1, 2.85); n++; }
    expect(z).toBe(2.85);
    expect(n).toBe(11); // 1.1^10 = 2.594 and 1.1^11 = 2.853: the eleventh step is clamped to the ceiling
  });
  const clip = (over: Partial<MediaClip> = {}) => ({ type: 'media', id: 'clp_a', assetId: 'ast_a', start: T.rt(2, 1), sourceIn: T.rt(10, 1), duration: T.rt(4, 1), ...over }) as MediaClip;
  it('clip-local frames and the source frame the whole-clip picture shows', () => {
    expect(localFrame(clip(), 90, R)).toBe(30);
    expect(localFrame(clip(), 30, R)).toBe(-30);
    expect(sourceFrameAt(clip(), 30, R)).toBe(11 * 30);
    expect(sourceFrameAt(clip({ speed: { num: 2, den: 1 } }), 30, R)).toBe(12 * 30);
    expect(sourceFrameAt(clip({ reverse: true }), 30, R)).toBe(13 * 30);
    expect(sourceFrameAt(clip(), -500, R)).toBe(0);
  });
});

describe('the whole-clip picture keeps the clip\'s privacy regions (ADR-0015)', () => {
  const rate = { num: 30, den: 1 };
  const build = () => {
    const base = createProject({ id: 'prj_cam', name: 'C', width: 1920, height: 1080, frameRate: rate });
    base.assets['ast_a'] = { id: 'ast_a', kind: 'video', name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: { origin: 'import', createdAt: '2026-01-01T00:00:00.000Z' } } as unknown as Asset;
    const d = applyTransaction(base, [{ op: 'add_clip', args: { assetId: 'ast_a', start: T.rt(3, 1), sourceIn: T.rt(2, 1), duration: T.rt(4, 1) } }], { idSeed: 'c_', actor: 't' }).doc;
    const track = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.clips.length)!;
    return { d, clip: track.clips[0] as MediaClip };
  };
  const shownClip = (o: ReturnType<typeof cameraSourceDocument>) => o.sequences[o.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0] as MediaClip;
  it('a clip with a region shows it, with the motion track it follows', () => {
    const { d, clip } = build();
    const region = { id: 'rg_1', shape: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2, style: 'blur', strength: 1, motionTrackId: 'mtk_1' };
    const mt = { id: 'mtk_1', assetId: 'ast_a', kind: 'region', x: [], y: [] };
    (clip as { redact?: unknown }).redact = [region];
    d.motionTracks = { mtk_1: mt } as never;
    const out = cameraSourceDocument(d, clip, d.assets['ast_a']!);
    expect(shownClip(out).redact).toEqual([region]);
    expect(out.motionTracks['mtk_1']).toEqual(mt);
    expect(T.toSeconds(shownClip(out).sourceIn)).toBe(0);
    expect(d.motionTracks['mtk_1']).toBe(mt); // the project's own track is untouched
  });
  it('a clip without regions shows the plain source document', () => {
    const { d, clip } = build();
    expect(shownClip(cameraSourceDocument(d, clip, d.assets['ast_a']!)).redact).toBeUndefined();
  });
});

describe('camera samples are timeline frames (performContract.ts CameraSample), the range clip-local', () => {
  it('a take on a clip that starts at 3 s plans the frames the overlay filmed, not 90 frames later', () => {
    const rate = { num: 30, den: 1 };
    const base = createProject({ id: 'prj_cam2', name: 'C', width: 1920, height: 1080, frameRate: rate });
    base.assets['ast_a'] = { id: 'ast_a', kind: 'video', name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: 300 }, provenance: { origin: 'import', createdAt: '2026-01-01T00:00:00.000Z' } } as unknown as Asset;
    const d = applyTransaction(base, [{ op: 'add_clip', args: { assetId: 'ast_a', start: T.rt(3, 1), duration: T.rt(4, 1) } }], { idSeed: 'c_', actor: 't' }).doc;
    const clip = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0] as MediaClip;
    // the overlay films clip-local frames 0..20, panning right, zoomed in
    const samples = Array.from({ length: 21 }, (_, k) => cameraSample(clip, k, rate, { u: 0.4 + k * 0.005, v: 0.5, zoom: 2 }));
    expect(samples[0]!.frame).toBe(90);
    const plan = planCamera(d, { clipId: clip.id, from: 0, to: 20, samples, settings: DEFAULT_CAMERA });
    expect('refused' in plan).toBe(false);
    if ('refused' in plan) return;
    expect(plan.keys[0]!.frame).toBe(0);
    expect(plan.keys.at(-1)!.frame).toBe(20);
    expect(Math.max(...plan.keys.map((k) => k.scale))).toBeGreaterThan(1.2); // the zoom that was filmed shows inside the range (its edges hold the clip's framing)
    // the clip-local samples the overlay used to send name timeline frames 0..20, before the clip: nothing to plan
    const local = samples.map((x) => ({ ...x, frame: x.frame - 90 }));
    expect(planCamera(d, { clipId: clip.id, from: 0, to: 20, samples: local, settings: DEFAULT_CAMERA })).toEqual({ refused: 'no_samples' });
  });
});
