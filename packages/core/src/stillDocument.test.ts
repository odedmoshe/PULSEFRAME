/**
 * The one-clip document of a still (wave 8 cover W2; verify C5/C6). Replaces the W2 todo row of stillsContracts.test.ts
 * ("W2 stillDocument: the file's own size (odd kept) and rate, fit contain, default transform, sourceIn = sourceTimeOfFrame;
 * refusals over 8192 and outside the file").
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { evaluate } from '../../engine/src/evaluate.ts';
import { DEFAULT_TRANSFORM, ProjectSchema, sourceTimeOfFrame, stillDocument, StillsRefusal, STILL_MAX_SIDE, validateProject, type Asset } from './index.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const hash = `sha256:${'a'.repeat(64)}`;
const video = (o: Partial<NonNullable<Asset['video']>> = {}, a: Partial<Asset> = {}): Asset => ({
  id: 'ast_v', kind: 'video', name: 'IMG_0001.mp4', contentHash: hash, byteSize: 10, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1),
  video: { width: 1920, height: 1080, frameRate: { num: 60, den: 1 }, codec: 'h264', rotation: 0, frameCount: 600, ...o }, provenance: prov, ...a,
});
const picture = (w: number, h: number): Asset => ({ id: 'ast_p', kind: 'image', name: 'photo.png', contentHash: hash, byteSize: 10, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: prov });
const refusal = (f: () => unknown): StillsRefusal => { try { f(); } catch (e) { if (e instanceof StillsRefusal) return e; throw e; } throw new Error('not refused'); };

describe('stillDocument', () => {
  it('a video frame: the file\'s own size and rate, one clip of one frame, fit contain, default transform, sourceIn = sourceTimeOfFrame', () => {
    const a = video();
    const d = stillDocument(a, 137);
    expect(d.settings).toMatchObject({ width: 1920, height: 1080, frameRate: { num: 60, den: 1 }, fit: 'contain' });
    const seq = d.sequences[d.mainSequenceId]!;
    expect(seq.tracks).toHaveLength(1);
    expect(seq.tracks[0]!.kind).toBe('video');
    const clips = seq.tracks[0]!.clips;
    expect(clips).toHaveLength(1);
    const c = clips[0]!;
    if (c.type !== 'media') throw new Error('not a media clip');
    expect(c.assetId).toBe(a.id);
    expect(T.eq(c.start, T.ZERO)).toBe(true);
    expect(T.eq(c.duration, T.frameTime(1, { num: 60, den: 1 }))).toBe(true);
    expect(T.eq(c.sourceIn, T.rt(137, 60))).toBe(true);
    expect(c.transform).toEqual(DEFAULT_TRANSFORM);
    expect(c.effects ?? []).toEqual([]);
    expect([c.speed, c.freeze, c.reverse, c.redact, c.mask, c.transition, c.stabilise, c.blend]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(d.assets).toEqual({ [a.id]: a });
    expect(d.assets[a.id]).not.toBe(a); // a copy, so the snapshot cannot change with the project
    expect(ProjectSchema.safeParse(d).success).toBe(true);
    expect(validateProject(d)).toEqual([]);
  });
  it('the evaluator shows exactly the asked source frame, at the frame\'s centre, unscaled (one video layer, no text, no sound)', () => {
    const a = video({ frameRate: { num: 30000, den: 1001 }, frameCount: 300 });
    for (const frame of [0, 1, 150, 299]) {
      const g = evaluate(stillDocument(a, frame), T.ZERO);
      expect(g.layers).toHaveLength(1);
      const l = g.layers[0]!;
      if (l.kind !== 'video') throw new Error(`layer ${l.kind}`);
      expect(l.sourceFrameIndex).toBe(frame);
      expect([l.sourceWidth, l.sourceHeight, g.width, g.height, g.fit]).toEqual([1920, 1080, 1920, 1080, 'contain']);
      expect(l.transform).toEqual(DEFAULT_TRANSFORM);
      expect(g.audio).toEqual([]);
    }
  });
  it('a file whose picture starts after its time zero: sourceIn counts the start offset (speed.ts), and the frame still maps back', () => {
    const a = video({ frameRate: { num: 30, den: 1 }, frameCount: 300, startTime: T.rt(1, 10) }); // 3 frames later
    const d = stillDocument(a, 10);
    const c = d.sequences[d.mainSequenceId]!.tracks[0]!.clips[0]!;
    if (c.type !== 'media') throw new Error('not a media clip');
    expect(T.eq(c.sourceIn, sourceTimeOfFrame(a, 10))).toBe(true);
    expect(T.eq(c.sourceIn, T.rt(13, 30))).toBe(true);
    const l = evaluate(d, T.ZERO).layers[0]!;
    expect(l.kind === 'video' && l.sourceFrameIndex).toBe(10);
  });
  it('odd sizes are kept (no even rounding): 3001x2001 picture, 1919x1081 video', () => {
    expect(stillDocument(picture(3001, 2001), 0).settings).toMatchObject({ width: 3001, height: 2001, frameRate: { num: 30, den: 1 } });
    expect(stillDocument(video({ width: 1919, height: 1081 }), 0).settings).toMatchObject({ width: 1919, height: 1081 });
  });
  it('a picture file: rate 30/1, sourceIn 0, an image layer at its own size', () => {
    const d = stillDocument(picture(3000, 2000), 0);
    const c = d.sequences[d.mainSequenceId]!.tracks[0]!.clips[0]!;
    expect(c.type === 'media' && T.eq(c.sourceIn, T.ZERO)).toBe(true);
    const l = evaluate(d, T.ZERO).layers[0]!;
    expect(l.kind).toBe('image');
    expect(l.kind === 'image' && [l.sourceWidth, l.sourceHeight]).toEqual([3000, 2000]);
    expect(validateProject(d)).toEqual([]);
  });
  it('the same asset and frame give the same document (a retry renders the same thing)', () => {
    expect(JSON.stringify(stillDocument(video(), 42))).toBe(JSON.stringify(stillDocument(video(), 42)));
  });
  it('refusals: a side over 8192 still_too_large; a frame outside the file out_of_bounds; no picture still_no_picture', () => {
    expect(STILL_MAX_SIDE).toBe(8192);
    expect(stillDocument(picture(8192, 100), 0).settings.width).toBe(8192);
    const big = refusal(() => stillDocument(picture(8193, 100), 0));
    expect([big.code, big.status, big.message]).toEqual(['still_too_large', 422, 'the picture is 8193x100, larger than 8192 pixels on a side; it cannot be saved at full size']);
    expect(refusal(() => stillDocument(video({ width: 100, height: 9000 }), 0)).code).toBe('still_too_large');
    const out = refusal(() => stillDocument(video(), 600));
    expect([out.code, out.message]).toEqual(['out_of_bounds', 'frame 600 is outside the file\'s 600 frames']);
    expect(refusal(() => stillDocument(picture(10, 10), 1)).code).toBe('out_of_bounds');
    expect(refusal(() => stillDocument(video(), -1)).code).toBe('out_of_bounds');
    // without frameCount the frames come from the duration at the stream's rate (10 s at 60 fps = 600)
    expect(refusal(() => stillDocument(video({ frameCount: null }), 600)).code).toBe('out_of_bounds');
    expect(stillDocument(video({ frameCount: null }), 599).settings.width).toBe(1920);
    const audio: Asset = { ...video(), kind: 'audio', video: undefined, audio: { sampleRate: 48000, channels: 2, codec: 'aac' } };
    const none = refusal(() => stillDocument(audio, 0));
    expect([none.code, none.message]).toEqual(['still_no_picture', 'file ast_v has no picture to save']);
    expect(refusal(() => stillDocument({ ...video(), video: undefined }, 0)).code).toBe('still_no_picture');
  });
});
