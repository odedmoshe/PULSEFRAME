/** The source viewer's one-clip document (sourceDocument.ts): a still gets its own shown shape as the frame (wave 8, verifier C4). */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { createProject, fitScale, type Asset, type MediaClip } from '@pulseframe/core';
import { evaluate, type ImageLayer } from '@pulseframe/engine';
import { sourceDocument } from './sourceDocument.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const project = createProject({ id: 'prj_p', name: 'p', frameRate: { num: 25, den: 1 } });
// a phone JPEG stored sideways with EXIF 6: ingest records the shown (upright) size, 3024 wide becomes 3024 tall
const portrait: Asset = { id: 'ast_jpg', kind: 'image', name: 'p.jpg', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 3023, height: 4031, codec: 'mjpeg', hasAlpha: false }, provenance: prov };
const video: Asset = { id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(2, 1), video: { width: 1920, height: 1080, frameRate: { num: 25, den: 1 }, codec: 'h264', rotation: 0, frameCount: 50 }, provenance: prov };

describe('sourceDocument', () => {
  it('a still: the frame is the picture as shown (even sizes), and the picture fills it', () => {
    const d = sourceDocument(project, portrait);
    expect([d.settings.width, d.settings.height]).toEqual([3024, 4032]);
    expect(fitScale(d.settings.width, d.settings.height, 3023, 4031, d.settings.fit ?? 'contain')).toBeCloseTo(1, 3);
    const clip = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips)[0] as MediaClip;
    expect(clip.assetId).toBe('ast_jpg');
    expect(evaluate(d, T.ZERO).layers.filter((l): l is ImageLayer => l.kind === 'image').map((l) => [l.clipId, l.sourceWidth, l.sourceHeight])).toEqual([[clip.id, 3023, 4031]]);
    expect(d.settings.frameRate).toEqual({ num: 25, den: 1 });
  });
  it('a video keeps its own shape as before', () => {
    const d = sourceDocument(project, video);
    expect([d.settings.width, d.settings.height]).toEqual([1920, 1080]);
  });
});
