/**
 * Delete and Shift+Delete (UX_REDESIGN §4.7, §5): a delete is one transaction; with ripple delete on, the clips of the main
 * track V1 after a deleted V1 clip move earlier by the length deleted before them, and the other tracks keep their gaps.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, getOp, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { deleteOps, mainTrackId, rippleDeleteOn } from './commands.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `d${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (name: string, hash: string) => ({
  kind: 'video' as const, name, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance,
});
const music = { kind: 'audio' as const, name: 'music.mp3', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp3', mimeType: 'audio/mpeg', duration: T.rt(30, 1), audio: { sampleRate: 48000, channels: 2, codec: 'mp3' }, provenance };

/** V1: three clips at 0–120, 120–210 and 240–300 (a 30-frame gap before the third); a song on its own track. */
function project() {
  let r = tx(createProject({ id: 'prj_d', name: 'D', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video('a.mp4', 'a') } }, { op: 'import_asset', args: { asset: video('b.mp4', 'b') } }, { op: 'import_asset', args: { asset: music } }], true);
  const [a, b, m] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: a, start: f(0), duration: f(120) } },
    { op: 'add_clip', args: { assetId: b, start: f(120), duration: f(90) } },
    { op: 'add_clip', args: { assetId: a, start: f(240), sourceIn: f(200), duration: f(60) } },
    { op: 'add_clip', args: { assetId: m, start: f(0), duration: f(300) } },
  ]);
  const ids = r.results.map((x) => x.output!.clipId as string);
  return { doc: r.doc, first: ids[0]!, second: ids[1]!, third: ids[2]!, song: ids[3]! };
}
const startOf = (doc: ProjectDocument, id: string) => fi(findClip(doc, id)!.clip.start);

describe('delete on the main track', () => {
  const p = project();
  it('finds V1 as the first video track', () => {
    expect(mainTrackId(p.doc)).toBe(findClip(p.doc, p.first)!.track.id);
  });
  it('keeps the gap when ripple is off (or for Shift+Delete)', () => {
    const plan = deleteOps(p.doc, [p.second], false)!;
    expect(plan.ops).toEqual([{ op: 'delete_clip', args: { clipId: p.second } }]);
    const out = tx(p.doc, plan.ops).doc;
    expect(startOf(out, p.third)).toBe(240);
  });
  it('closes the deleted length on V1 in one transaction, leaving the earlier gap and the other tracks alone', () => {
    const plan = deleteOps(p.doc, [p.second], true)!;
    expect(plan.moved).toBe(1);
    const out = tx(p.doc, plan.ops).doc;
    expect(findClip(out, p.second)).toBeUndefined();
    expect(startOf(out, p.third)).toBe(150); // 240 − 90: the 30-frame gap that was there stays
    expect(startOf(out, p.song)).toBe(0);
  });
  it('moves each later clip by the length deleted before it', () => {
    const plan = deleteOps(p.doc, [p.first, p.third], true)!;
    expect(plan.moved).toBe(1);
    const out = tx(p.doc, plan.ops).doc;
    expect(startOf(out, p.second)).toBe(0);
    const two = deleteOps(p.doc, [p.first, p.second], true)!;
    expect(startOf(tx(p.doc, two.ops).doc, p.third)).toBe(30);
  });
  it('does not ripple a delete on another track', () => {
    const plan = deleteOps(p.doc, [p.song], true)!;
    expect(plan.ops).toHaveLength(1);
    expect(plan.moved).toBe(0);
  });
  it('a mixed selection (V1 clips and a clip on another track) deletes every selected clip: V1 ripples, the other keeps its gap', () => {
    const plan = deleteOps(p.doc, [p.first, p.song], true)!;
    expect(plan.deleted).toBe(2);
    expect(plan.ops).toEqual([{ op: 'delete_clip', args: { clipId: p.song } }, { op: 'ripple_delete_clips', args: { clipIds: [p.first] } }]);
    const out = tx(p.doc, plan.ops).doc;
    expect(findClip(out, p.first)).toBeUndefined();
    expect(findClip(out, p.song)).toBeUndefined(); // before the fix the song was silently left in place while deleted said 2
    expect(startOf(out, p.second)).toBe(0);
    // every clip of the project at once (what «מחק את הקליפים» with nothing selected names): nothing is left behind
    const all = deleteOps(p.doc, [p.first, p.second, p.third, p.song], true)!;
    const empty = tx(p.doc, all.ops).doc;
    for (const id of [p.first, p.second, p.third, p.song]) expect(findClip(empty, id), id).toBeUndefined();
  });
  it('ripples only when the project turned it on and the op that stores it exists', () => {
    // a project made before the behaviour existed (no settings.timeline) never ripples; a new project has it on (core createProject)
    const legacy = { ...p.doc, settings: { ...p.doc.settings, timeline: undefined } } as ProjectDocument;
    expect(rippleDeleteOn(legacy)).toBe(false);
    expect(rippleDeleteOn(p.doc)).toBe(!!getOp('set_timeline_behaviour'));
    const on = { ...p.doc, settings: { ...p.doc.settings, timeline: { rippleDelete: true } } } as ProjectDocument;
    // without the core's set_timeline_behaviour op this build keeps today's delete
    expect(rippleDeleteOn(on)).toBe(!!getOp('set_timeline_behaviour'));
  });
});
