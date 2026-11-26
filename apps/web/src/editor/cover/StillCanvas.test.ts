/**
 * The still canvas's own pool (wave 8 cover integration): every still document has the same clip id, and a pool keys its decoders
 * by clip id, so the tiles must not draw through the editor's shared pool (proof:stills U4 found them blank: "VideoSample is
 * closed"). Here: the pool options read the stored file only (no proxy), with one decoder; the clip id really is shared, which is
 * why one pool per canvas is needed. The draw itself is proven by U4 in Chromium.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { stillDocument, type Asset } from '@pulseframe/core';
import { stillPoolOptions } from './StillCanvas.tsx';

const asset: Asset = {
  id: 'ast_v', kind: 'video', name: 'v.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(5, 1),
  video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 150 }, provenance: { origin: 'fixture', importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' },
};
const clipIdOf = (frame: number) => stillDocument(asset, frame).sequences.seq_main!.tracks[0]!.clips[0]!.id;

describe('a still canvas draws through its own pool of the stored file', () => {
  it('two frames of one file make documents with the same clip id (so a shared pool would share one decoder)', () => {
    expect(clipIdOf(12)).toBe(clipIdOf(89));
  });
  it('the pool reads the stored file only, never the proxy, with one decoder', () => {
    const o = stillPoolOptions('prj_1');
    expect(o.assetUrl('ast_v')).toBe('/api/v1/projects/prj_1/assets/ast_v/content');
    expect(o.previewUrl).toBeUndefined();
    expect(o.maxDecoders).toBe(1);
  });
});
