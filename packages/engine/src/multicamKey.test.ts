/**
 * Multicam and the render cache (ADR-0020 with ADR-0024): the segment tag is inert for rendering — a frame's key is the same
 * with or without it — and an angle switch (another file and source time on the same clip, which is what switch_angles writes)
 * changes the key of every frame it reaches and of no other frame. So the fast export never reuses a segment rendered from the
 * old angle. The switch is made here with replace_clip_media on an untagged clip (switch_angles is W1's); the evaluated graph
 * it leaves is the same shape.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import { frameKey } from './frameKey.ts';
import { ctxFor, R, f, video } from './frameKey.testDocs.ts';

let n = 0;
const tx = (doc: ProjectDocument, ops: Parameters<typeof applyTransaction>[1], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `mk${n++}_`, actor: 'test', allowInternal });

describe('multicam tags and switches in the frame key', () => {
  it('the tag does not change a key; a switch changes the keys of the switched frames only', () => {
    let r = tx(createProject({ id: 'prj_mk', name: 'MK', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video('a.mp4', 'a') } }, { op: 'import_asset', args: { asset: video('b.mp4', 'b') } }], true);
    const [A, B] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: A, start: f(0), duration: f(30), withLinkedAudio: false } }]);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: A, start: f(30), sourceIn: T.rt(1, 1), duration: f(30), trackId: r.results[0]!.output!.trackId, withLinkedAudio: false } }]);
    const base = r.doc;
    const second = r.results[0]!.output!.clipId as string;
    const keys = (doc: ProjectDocument) => [5, 29, 30, 45].map((i) => frameKey(doc, i, ctxFor(doc)));
    // tagged (by hand; the tag is validated against a group, which the key never reads)
    const tagged = structuredClone(base);
    for (const t of tagged.sequences.seq_main!.tracks) for (const c of t.clips) if (c.type === 'media') (c as MediaClip).multicam = { groupId: 'mcg_1', angleId: 'ang_a' };
    expect(keys(tagged)).toEqual(keys(base));
    // the second segment switched to camera B at another source time
    const switched = tx(base, [{ op: 'replace_clip_media', args: { clipId: second, assetId: B, sourceIn: T.rt(3, 1) } }]).doc;
    const [k0, k1, k2, k3] = keys(base), [s0, s1, s2, s3] = keys(switched);
    expect([s0, s1]).toEqual([k0, k1]);
    expect(s2).not.toBe(k2);
    expect(s3).not.toBe(k3);
  });
});
