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
  it('duplicate_clips copies everything on a clip, keeps pairs linked to each other, and finds a free place', () => {
    const { doc, clipId, titleId, variantId } = project();
    let d = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.sepia' } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(10), value: 0.2 } }, { op: 'set_variant_override', args: { variantId, clipId, transform: { scale: 1.3 } } }, { op: 'trim_clip', args: { clipId, edge: 'end', to: f(60) } }]).doc;
    const audioId = d.sequences[d.mainSequenceId]!.tracks.find((t) => t.kind === 'audio')!.clips[0]!.id;
    const r = tx(d, [{ op: 'duplicate_clips', args: { clipIds: [clipId, audioId], at: f(90) } }]);
    const [v2, a2] = (r.results[0]!.output!.createdClipIds as string[]).map((id) => findClip(r.doc, id)!);
    const orig = findClip(r.doc, clipId)!.clip as any;
    expect(v2!.clip).toMatchObject({ start: f(90), duration: f(60), effects: [{ type: 'color.sepia' }], keyframes: orig.keyframes });
    expect((v2!.clip as any).linkGroupId).toBe((a2!.clip as any).linkGroupId);
    expect((v2!.clip as any).linkGroupId).not.toBe(orig.linkGroupId);
    expect(r.doc.variants[variantId]!.overrides[v2!.clip.id]).toEqual({ transform: { scale: 1.3 } });
    expect(validateProject(r.doc)).toEqual([]);
    // no room on the same track -> a compatible track is used or made; nothing overlaps
    const again = tx(r.doc, [{ op: 'duplicate_clips', args: { clipIds: [clipId], offset: f(10) } }]);
    expect(validateProject(again.doc)).toEqual([]);
    expect(findClip(again.doc, (again.results[0]!.output!.createdClipIds as string[])[0]!)!.track.id).not.toBe(findClip(again.doc, clipId)!.track.id);
    expect((findClip(again.doc, (again.results[0]!.output!.createdClipIds as string[])[0]!)!.clip as any).linkGroupId).toBeNull();
    expect(code(() => tx(d, [{ op: 'duplicate_clips', args: { clipIds: [titleId] } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'duplicate_clips', args: { clipIds: [titleId], offset: f(-500) } }]))).toBe('out_of_bounds');
  });
  it('caption style can differ per format: fields set for a format replace the master there only, merge on repeated edits, and null follows the master again', () => {
    const { doc, variantId } = project();
    let d = tx(doc, [{ op: 'add_caption_track', args: { mode: 'manual', style: { sizeFrac: 0.05, position: 'bottom' } } }, { op: 'add_cue', args: { start: f(0), duration: f(60), text: 'שלום' } }]).doc;
    const trackOf = (x: ProjectDocument) => Object.values(x.sequences)[0]!.tracks.find((t) => t.kind === 'caption')!;
    d = tx(d, [{ op: 'update_variant', args: { variantId, captionStyle: { sizeFrac: 0.09 } } }]).doc;
    d = tx(d, [{ op: 'update_variant', args: { variantId, captionStyle: { position: 'top' } } }]).doc; // merges with the size already set
    expect(validateProject(d)).toEqual([]);
    expect(d.variants[variantId]!.captionStyle).toEqual({ sizeFrac: 0.09, position: 'top' });
    expect(trackOf(d).caption!.style).toMatchObject({ sizeFrac: 0.05, position: 'bottom' }); // master untouched
    expect(trackOf(projectVariant(d, variantId)).caption!.style).toMatchObject({ sizeFrac: 0.09, position: 'top', color: trackOf(d).caption!.style.color });
    // a later master change to another field shows in the format too; the format keeps its own size and position
    d = tx(d, [{ op: 'set_caption_style', args: { trackId: trackOf(d).id, style: { color: '#FFEE00', sizeFrac: 0.06 } } }]).doc;
    expect(trackOf(projectVariant(d, variantId)).caption!.style).toMatchObject({ sizeFrac: 0.09, position: 'top', color: '#FFEE00' });
    d = tx(d, [{ op: 'update_variant', args: { variantId, captionStyle: null } }]).doc;
    expect(d.variants[variantId]!.captionStyle).toBeUndefined();
    expect(trackOf(projectVariant(d, variantId)).caption!.style).toMatchObject({ sizeFrac: 0.06, position: 'bottom' });
    expect(code(() => tx(d, [{ op: 'update_variant', args: { variantId, captionStyle: { sizeFrac: 9 } } }]))).toBe('invalid_args');
  });
  it('a title can have other wording and style in one format only; the master, other formats and later master edits are unaffected; clearing restores the master', () => {
    const { doc, clipId, titleId, variantId } = project();
    let d = tx(doc, [{ op: 'add_variant', args: { width: 360, height: 360, name: 'sq' } }]);
    const square = d.results[0]!.output!.variantId as string;
    d = tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: 'קצר', textStyle: { sizeFrac: 0.12 } } }]);
    const title = (x: ProjectDocument) => { const c = findClip(x, titleId)!.clip; if (c.type !== 'text') throw new Error('not text'); return c; };
    expect(validateProject(d.doc)).toEqual([]);
    expect(title(d.doc).text).toBe('כותרת'); // master
    expect(title(projectVariant(d.doc, square)).text).toBe('כותרת'); // other format
    const v = title(projectVariant(d.doc, variantId));
    expect([v.text, v.style.sizeFrac, v.style.fontFamily]).toEqual(['קצר', 0.12, title(d.doc).style.fontFamily]);
    // a master edit of the wording and of another style field reaches the format, except where it is overridden
    d = tx(d.doc, [{ op: 'update_text', args: { clipId: titleId, text: 'כותרת חדשה', style: { color: '#ff0000', sizeFrac: 0.05 } } }]);
    const v2 = title(projectVariant(d.doc, variantId));
    expect([v2.text, v2.style.sizeFrac, v2.style.color]).toEqual(['קצר', 0.12, '#ff0000']);
    expect(title(projectVariant(d.doc, square)).text).toBe('כותרת חדשה');
    // a second call merges style fields and keeps the wording; the position override is independent
    d = tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, textStyle: { align: 'end' }, transform: { y: 0.2 } } }]);
    expect(d.doc.variants[variantId]!.overrides[titleId]).toEqual({ text: 'קצר', textStyle: { sizeFrac: 0.12, align: 'end' }, transform: { y: 0.2 } });
    // clearing parts, then everything
    d = tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: null } }]);
    expect(title(projectVariant(d.doc, variantId)).text).toBe('כותרת חדשה');
    d = tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, textStyle: null, transform: null } }]);
    expect(d.doc.variants[variantId]!.overrides[titleId]).toBeUndefined();
    // refused: wording on a picture clip, empty wording, an unknown style field
    expect(code(() => tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId, text: 'x' } }]))).toBe('incompatible');
    expect(code(() => tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: '' } }]))).toBe('invalid_args');
    expect(code(() => tx(d.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, textStyle: { blink: true } } }]))).toBe('invalid_args');
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
