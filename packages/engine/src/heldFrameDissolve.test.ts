/**
 * What the engine draws on both sides of a dissolve OUT OF a freeze frame (wave 8 growing, verifier C1). Checked before the
 * freeze-handle rule changed (core speed.ts spareAfter): the transition is written into the document directly here, so this test
 * does not depend on set_transition accepting it, and it passed on the engine as it was. The outgoing side is the held clip
 * drawn by clipLayer past its end: a freeze shows its sourceIn at every time, so its picture is the held frame on every frame of
 * the dissolve; the incoming side plays forward from its own sourceIn; both carry the transition with complementary roles.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import { evaluate, type VideoLayer } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const asset = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: f(240), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };

/** A freeze of source frame 200 at frames 0–30, then a clip from source 0 at 30–90 with a 20-frame dissolve written in directly. */
function doc(): { doc: ProjectDocument; held: string; next: string } {
  const r0 = applyTransaction(createProject({ id: 'prj_hd', name: 'HD', frameRate: R }), [{ op: 'import_asset', args: { asset } }], { idSeed: 'hd0_', actor: 'test', allowInternal: true });
  const assetId = r0.results[0]!.output!.assetId as string;
  const r = applyTransaction(r0.doc, [
    { op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(200), duration: f(30), withLinkedAudio: false } },
    { op: 'add_clip', args: { assetId, start: f(30), sourceIn: f(0), duration: f(60), withLinkedAudio: false } },
  ], { idSeed: 'hd1_', actor: 'test' });
  const d = structuredClone(r.doc);
  const clips = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips) as MediaClip[];
  const held = clips.find((c) => c.id === r.results[0]!.output!.clipId)!, next = clips.find((c) => c.id === r.results[1]!.output!.clipId)!;
  held.freeze = true;
  next.transition = { type: 'dissolve', frames: 20 };
  return { doc: d, held: held.id, next: next.id };
}
const videoLayers = (d: ProjectDocument, frame: number) => evaluate(d, f(frame)).layers.filter((x): x is VideoLayer => x.kind === 'video');

describe('engine: a dissolve out of a freeze frame', () => {
  it('the outgoing side shows the held frame on every frame of the dissolve; the incoming side plays forward', () => {
    const { doc: d, held, next } = doc();
    for (let l = 0; l < 20; l++) {
      const layers = videoLayers(d, 30 + l);
      const out = layers.find((x) => x.transition?.role === 'out'), inn = layers.find((x) => x.transition?.role === 'in');
      expect(out?.clipId, `frame ${l}`).toBe(held);
      expect(out!.sourceFrameIndex, `frame ${l}`).toBe(200);
      expect(inn?.clipId).toBe(next);
      expect(inn!.sourceFrameIndex).toBe(l);
      expect(out!.transition!.progress).toBe(inn!.transition!.progress);
    }
    // after the dissolve only the incoming clip is drawn
    expect(videoLayers(d, 50).map((x) => x.clipId)).toEqual([next]);
    // the held frame itself, before the dissolve, is the same picture
    expect(videoLayers(d, 29).map((x) => x.sourceFrameIndex)).toEqual([200]);
  });
});
