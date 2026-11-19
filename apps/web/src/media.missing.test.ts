/**
 * A stored file the server reports missing (GET …/missing-media, state.missingMedia): the editor's pool leaves that asset's pictures
 * out with the reason `missing_media`, as the compositor does for any picture it cannot have, instead of a rejection that fails the
 * whole frame; its sound is not opened; a file that comes back is decoded afresh. The decoders are stubs (labelled as such:
 * MediaPoolOptions.openDecoder is a test-only seam; no Mediabunny, no browser).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { VideoLayer } from '@pulseframe/engine';
import { MediaPool, MISSING_MEDIA, type PoolDecoder } from './media.ts';

const layer = (clipId: string, assetId: string): VideoLayer => ({
  kind: 'video', clipId, trackId: 'trk', assetId, sourceTime: T.frameTime(0, { num: 30, den: 1 }), sourceFrameIndex: 0, sourceSeekSeconds: 0.5 / 30,
  sourceWidth: 640, sourceHeight: 360, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
});

describe('assets whose stored file is missing', () => {
  it('get no picture and the reason missing_media, never a rejection; the others are drawn; a file put back is opened again', async () => {
    const opened: string[] = [];
    const disposed: string[] = [];
    const pool = new MediaPool({
      assetUrl: (id) => `/stub/${id}`,
      openDecoder: async (_src, w) => {
        opened.push(w.assetId);
        const dec: PoolDecoder = { frame: async () => ({ draw: () => {} }) as never, dispose: async () => { disposed.push(w.assetId); } };
        return dec;
      },
    });
    const gone = layer('clp_a', 'ast_gone'), here = layer('clp_b', 'ast_here');
    await pool.frames(gone);
    expect(opened).toEqual(['ast_gone']);
    expect(pool.setMissing(['ast_gone'])).toBe(true);
    expect(pool.setMissing(['ast_gone'])).toBe(false); // the same list again changes nothing
    await new Promise((r) => setTimeout(r, 0));
    expect(disposed).toEqual(['ast_gone']); // its decoder is let go
    const [a, b] = await Promise.all([pool.frames(gone), pool.frames(here)]);
    expect(a).toBeNull();
    expect(b).not.toBeNull();
    expect(pool.frames.refusal!(gone)).toBe(`${MISSING_MEDIA}: the stored file of asset ast_gone is missing`);
    expect(pool.frames.refusal!(here)).toBeNull();
    expect(pool.draftFrames.refusal!(gone)).toMatch(/^missing_media: /);
    expect(await pool.openAudio('ast_gone')).toBeNull();
    expect(opened).toEqual(['ast_gone', 'ast_here']); // nothing was asked of the missing file
    expect(pool.setMissing([])).toBe(true);
    expect(await pool.frames(gone)).not.toBeNull();
    expect(opened).toEqual(['ast_gone', 'ast_here', 'ast_gone']);
    expect(pool.isMissing('ast_gone')).toBe(false);
  });
});
