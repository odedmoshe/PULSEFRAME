/**
 * apply_made_clip (wave 8 motioncode; madeOps.ts): import with import_asset's dedup, place on a new top picture track, replace in every
 * sequence keeping clip ids, places, lengths and effects, library only, and each refusal from MADE_OP_REFUSALS — every accepted call
 * undone exactly by the generic entity diff (one transaction, one undo). Synthetic made assets; nothing is rendered here.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, OpError, restoreEntities, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const hash = (c: string) => `sha256:${c.repeat(64)}`;
const record = (frames: number) => ({ v: 1, pageSha256: hash('c'), pageBytes: 900, templateId: 'rising-title', templateVersion: 1, fields: [{ key: 'title', kind: 'text', label: { he: 'כותרת', en: 'Title' }, default: 'שלום' }], values: { title: 'טיול לגליל 2026' }, frames, width: 640, height: 360, browser: '153.0', sandbox: 'chromium', checks: { determinism: { frames: [0, frames >> 1, frames - 1] }, flash: { black: { general: 0, red: 0 }, white: { general: 0, red: 0 } }, alpha: true } });
const made = (frames: number, h = 'a', extra: Record<string, unknown> = {}) => ({ kind: 'video', name: 'title.webm', contentHash: hash(h), byteSize: 1000, container: 'webm', mimeType: 'video/webm', duration: f(frames),
  video: { width: 640, height: 360, frameRate: R, codec: 'vp9', rotation: 0, frameCount: frames, hasAlpha: true },
  provenance: { origin: 'generated', importedAt: '2026-11-26T00:00:00Z', importedBy: 'agent:x', made: record(frames) }, ...extra });
const base = () => createProject({ id: 'p', name: 'p', frameRate: R });
let seedN = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `t${seedN++}_`, actor: 'agent:a', allowInternal: true });
const call = (args: Record<string, unknown>): OpCall => ({ op: 'apply_made_clip', args });
const out = (r: ReturnType<typeof tx>, i = 0) => r.results[i]!.output as Record<string, any>;
function undoOf(before: ProjectDocument, after: ProjectDocument) {
  const back = structuredClone(after);
  restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before })));
  return back;
}
const refusal = (doc: ProjectDocument, ops: OpCall[]): OpError => { try { tx(doc, ops); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('accepted'); };
const videoTracks = (d: ProjectDocument, seq = d.mainSequenceId) => d.sequences[seq]!.tracks.filter((t) => t.kind === 'video');

describe('apply_made_clip', () => {
  it('library only: one asset with its record; the same bytes again are deduplicated; undo removes the asset', () => {
    const d0 = base();
    const r = tx(d0, [call({ asset: made(60) })]);
    const id = out(r).assetId as string;
    expect(out(r)).toEqual({ assetId: id, deduplicated: false });
    expect(r.doc.assets[id]!.provenance.made!.frames).toBe(60);
    expect(validateProject(r.doc)).toEqual([]);
    const again = tx(r.doc, [call({ asset: made(60) })]);
    expect(out(again)).toEqual({ assetId: id, deduplicated: true });
    expect(Object.keys(again.doc.assets)).toEqual(Object.keys(r.doc.assets));
    expect(creativeProjection(undoOf(d0, r.doc))).toBe(creativeProjection(d0));
  });
  it('place: one new picture track on top of the picture tracks and one clip at the exact start and length, no linked sound; one undo removes clip, track and asset', () => {
    const d0 = base();
    const before = videoTracks(d0).length;
    const r = tx(d0, [call({ asset: made(60), place: { start: f(30) } })]);
    const o = out(r);
    const vt = videoTracks(r.doc);
    expect(vt.length).toBe(before + 1);
    expect(vt.at(-1)!.id).toBe(o.trackId);
    const clips = r.doc.sequences[r.doc.mainSequenceId]!.tracks.flatMap((t) => t.clips);
    expect(clips.length).toBe(1);
    const c = clips[0]!;
    expect(c).toMatchObject({ id: o.clipId, type: 'media', assetId: o.assetId, linkGroupId: null });
    expect(T.eq(c.start, f(30)) && T.eq(c.duration, f(60))).toBe(true);
    expect(creativeProjection(undoOf(d0, r.doc))).toBe(creativeProjection(d0));
  });
  it('place on a named track uses it; a busy place or a start between frames is refused in add_clip\'s own words and changes nothing', () => {
    const d0 = base();
    const tr = videoTracks(d0)[0]!.id;
    const r = tx(d0, [call({ asset: made(60), place: { start: f(0), trackId: tr } })]);
    expect(out(r).trackId).toBe(tr);
    expect(videoTracks(r.doc).length).toBe(videoTracks(d0).length);
    expect(refusal(r.doc, [call({ asset: made(30, 'b'), place: { start: f(10), trackId: tr } })]).message).toMatch(/overlap|occupied|free/i);
    expect(refusal(d0, [call({ asset: made(30), place: { start: T.rt(1, 1000) } })]).code).toBe('invalid_args');
  });
  it('replace: every clip on a picture track in every sequence takes the new file and keeps its id, place, length and effects; one undo restores both', () => {
    let d = base();
    const a = tx(d, [call({ asset: made(60), place: { start: f(30) } })]);
    d = a.doc;
    const oldId = out(a).assetId as string, clipA = out(a).clipId as string;
    const fx = tx(d, [{ op: 'add_effect', args: { clipId: clipA, type: 'color.grayscale' } }, { op: 'add_sequence', args: { name: 'short' } }]);
    d = fx.doc;
    const seq2 = out(fx, 1).sequenceId as string;
    const b = tx(d, [{ op: 'add_clip', args: { sequenceId: seq2, assetId: oldId, start: f(0), duration: f(40) } }]);
    d = b.doc;
    const clipB = out(b).clipId as string;
    const snap = (doc: ProjectDocument, id: string) => { const c = Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).find((x) => x.id === id)!; return { start: c.start, duration: c.duration, effects: c.effects, assetId: (c as { assetId: string }).assetId }; };
    const r = tx(d, [call({ asset: made(60, 'e'), replaceAssetId: oldId })]);
    const o = out(r);
    expect(o.assetId).not.toBe(oldId);
    expect([...o.replacedClipIds].sort()).toEqual([clipA, clipB].sort());
    for (const id of [clipA, clipB]) expect(snap(r.doc, id)).toEqual({ ...snap(d, id), assetId: o.assetId });
    expect(r.doc.assets[oldId]).toBeTruthy();
    expect(creativeProjection(undoOf(d, r.doc))).toBe(creativeProjection(d));
  });
  it('replace with a shorter file names the clip and the frames it needs; a file nobody shows is refused; the same bytes replace nothing', () => {
    const a = tx(base(), [call({ asset: made(60), place: { start: f(0) } })]);
    const oldId = out(a).assetId as string, clipId = out(a).clipId as string;
    const short = refusal(a.doc, [call({ asset: made(40, 'e'), replaceAssetId: oldId })]);
    expect(short.details).toMatchObject({ why: 'made_too_short', clipId, frames: 60 });
    expect(short.code).toBe('out_of_bounds');
    expect(short.message).toBe(`the new file is shorter than clip ${clipId} that uses the old one (it needs 60 frames)`);
    const unused = refusal(a.doc, [call({ asset: made(60, 'e'), replaceAssetId: 'ast_none' })]);
    expect(unused.details).toMatchObject({ why: 'made_replace_unused', replaceAssetId: 'ast_none' });
    const same = tx(a.doc, [call({ asset: made(60), replaceAssetId: oldId })]);
    expect(out(same)).toMatchObject({ assetId: oldId, deduplicated: true, replacedClipIds: [] });
  });
  it('refusals: place and replace together, no made record, not a video, a record that disagrees with its file; nothing changes', () => {
    const d0 = base();
    expect(refusal(d0, [call({ asset: made(60), place: { start: f(0) }, replaceAssetId: 'ast_x' })]).details.why).toBe('made_place_and_replace');
    const noRec = made(60) as Record<string, any>;
    noRec.provenance = { origin: 'generated', importedAt: 'x', importedBy: 'x' };
    expect(refusal(d0, [call({ asset: noRec })]).details.why).toBe('made_no_record');
    expect(refusal(d0, [call({ asset: made(60, 'a', { kind: 'image' }) })]).details.why).toBe('made_not_video');
    const lying = made(60) as Record<string, any>;
    lying.video = { ...lying.video, frameCount: 61 };
    expect(refusal(d0, [call({ asset: lying })]).code).toBe('invalid_result');
    expect(refusal(d0, [call({ asset: { kind: 'video' } })]).code).toBe('invalid_args');
    expect(refusal(d0, [call({ asset: made(60), sequenceId: 'seq_none' })]).code).toBe('not_found');
  });
  it('is internal: a caller without allowInternal is refused; an inherited name as replaceAssetId is refused before the op runs', () => {
    const d0 = base();
    expect(() => applyTransaction(d0, [call({ asset: made(60) })], { idSeed: 'x', actor: 'agent:a' })).toThrow(/internal/);
    expect(refusal(d0, [call({ asset: made(60), replaceAssetId: 'constructor' })]).code).toBe('not_found');
  });
});
