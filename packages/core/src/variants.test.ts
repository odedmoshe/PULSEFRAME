import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, migrateProject, OpError, projectVariant, restoreEntities, transformAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `v${n++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_v', name: 'V', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60), transform: { y: 0.4 } } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string, titleId: r.results[1]!.output!.clipId as string, variantId: r.results[2]!.output!.variantId as string };
}

describe('linked format variants', () => {
  it('a variant is a small record; the projection has its frame, fill mode and nothing else changed', () => {
    const { doc, variantId } = project();
    expect(validateProject(doc)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const old = JSON.parse(JSON.stringify(doc)); delete old.variants; delete old.analyses;
    expect(migrateProject(old).variants).toEqual({});
    const v = projectVariant(doc, variantId);
    expect([v.settings.width, v.settings.height, v.settings.fit]).toEqual([1080, 1920, 'cover']);
    expect(v.sequences).toEqual(doc.sequences);
    expect(doc.settings.width).toBe(1920); // master untouched
    expect(validateProject(v)).toEqual([]);
  });
  it('overrides apply only in that format and survive master edits (move, trim, split, cut)', () => {
    const { doc, clipId, titleId, variantId } = project();
    let d = tx(doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, transform: { y: 0.25, scale: 1.4 } } }, { op: 'set_variant_override', args: { variantId, clipId, transform: { x: -0.2 } } }]).doc;
    expect(findClip(d, titleId)!.clip.transform.y).toBe(0.4); // master value kept
    expect(findClip(projectVariant(d, variantId), titleId)!.clip.transform).toMatchObject({ y: 0.25, scale: 1.4, x: 0 });
    // master edits: move the title, trim and split the picture
    d = tx(d, [{ op: 'move_clip', args: { clipId: titleId, start: f(30) } }, { op: 'trim_clip', args: { clipId, edge: 'end', to: f(200) } }]).doc;
    const s = tx(d, [{ op: 'split_clip', args: { clipId, at: f(100) } }]);
    const right = s.results[0]!.output!.rightClipId as string;
    const pv = projectVariant(s.doc, variantId);
    expect(findClip(pv, titleId)!.clip).toMatchObject({ start: f(30), transform: { y: 0.25, scale: 1.4 } });
    expect(findClip(pv, clipId)!.clip.transform.x).toBe(-0.2);
    expect(findClip(pv, right)!.clip.transform.x).toBe(-0.2); // the new piece keeps the framing
    const c = tx(d, [{ op: 'cut_range', args: { start: f(50), end: f(80) } }]);
    const pc = projectVariant(c.doc, variantId);
    const pieces = pc.sequences[pc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.clips;
    expect(pieces).toHaveLength(2);
    expect(pieces.every((p) => p.transform.x === -0.2)).toBe(true);
    expect(validateProject(c.doc)).toEqual([]);
  });
  it('an overridden property stops following the master animation in that format only; hide removes the clip there', () => {
    const { doc, titleId, variantId } = project();
    let d = tx(doc, [{ op: 'animate_clip', args: { clipId: titleId, in: 'slide-up', inFrames: 10 } }]).doc;
    d = tx(d, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, transform: { y: 0.1 } } }]).doc;
    const pv = findClip(projectVariant(d, variantId), titleId)!.clip;
    expect(transformAt(pv, f(0)).y).toBe(0.1); // fixed position in this format
    expect(transformAt(pv, f(0)).opacity).toBe(0); // the fade of the same preset still plays
    expect(transformAt(findClip(d, titleId)!.clip, f(0)).y).toBeGreaterThan(0.4); // master still slides
    d = tx(d, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, hidden: true } }]).doc;
    expect(findClip(projectVariant(d, variantId), titleId)).toBeUndefined();
    expect(findClip(d, titleId)).toBeDefined();
    d = tx(d, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, hidden: false, transform: null } }]).doc;
    expect(d.variants[variantId]!.overrides).toEqual({});
  });
  it('a variant is one undoable entity; bad input is refused', () => {
    const { doc, titleId, variantId } = project();
    const r = tx(doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, transform: { x: 0.1 } } }]);
    const diff = diffEntities(doc, r.doc);
    expect(diff.map((x) => x.id)).toEqual([variantId]);
    const back = structuredClone(r.doc);
    restoreEntities(back, diff.map((x) => ({ id: x.id, state: x.before })));
    expect(back).toEqual(doc);
    expect(code(() => tx(doc, [{ op: 'add_variant', args: { width: 1081, height: 1920 } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'add_variant', args: { profileId: 'imax' } }]))).toBe('not_found');
    expect(code(() => tx(doc, [{ op: 'add_variant', args: {} }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'set_variant_override', args: { variantId: 'var_x', clipId: titleId, hidden: true } }]))).toBe('not_found');
    const removed = tx(doc, [{ op: 'remove_variant', args: { variantId } }]).doc;
    expect(removed.variants).toEqual({});
    expect(() => projectVariant(removed, variantId)).toThrow();
  });
});
