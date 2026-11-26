/**
 * «תמונה חיה» (wave 8 living, verifier C11): every clip copier, and whether it CARRIES or DROPS the drawn depth (`clip.depth`) and the
 * living picture (`depth.living`). A rule about existing code, so it is complete in the pre-pass; a new copier joins the table.
 * Carried: split, trim, cut_range, insert_gap, the freeze hold's split, duplicate/paste, cloneDocument, entity diffs (undo), format
 * variants, audience versions (stir 'none': the calm rules leave it on). Dropped: the portrait backdrop copy (a still blurred
 * backdrop), paste attributes (op-only effect; the depth is the target's own drawing). Refused: replace_clip_media to another file.
 * Not copiers of a clip (they make new clips from files, which never carry a depth): templates and their planner, the family film,
 * the story, the growing-up planner, the shorts, multicam's look copy (video only); checked by reading their source (below).
 * Server copiers (named versions, archives with and without family details): apps/server/src/living.sites.test.ts.
 * The owntemplate track (same wave) must LIST depth and depth.living as not kept: its own key-classification test.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, CALM_OFF_EFFECTS, diffEntities, findClip, LIVING_EFFECT, projectVariant, restoreEntities, type Clip, type MediaClip, type OpCall, type ProjectDocument } from './index.ts';
import { DEPTH, livingDoc, withLiving } from './living.testFixture.ts';
import { cloneDocument } from './clone.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seq = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ls${seq++}_`, actor: 'test', allowInternal: true });
const clipsOfAsset = (doc: ProjectDocument, assetId: string): MediaClip[] =>
  Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips)).filter((c): c is MediaClip => c.type === 'media' && c.assetId === assetId);
const carries = (c: Clip) => c.type === 'media' && JSON.stringify(c.depth) === JSON.stringify(DEPTH) && (c.effects ?? []).some((e) => e.type === LIVING_EFFECT);
const living = () => { const s = livingDoc(); return { ...s, doc: withLiving(s.doc, s.clip) }; };

describe('copiers that CARRY the depth and the living picture', () => {
  it('split_clip: both halves', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'split_clip', args: { clipId: s.clip, at: f(60) } }]);
    const parts = clipsOfAsset(r.doc, s.pic);
    expect(parts.length).toBe(2);
    expect(parts.every(carries)).toBe(true);
  });
  it('trim_clip: the clip keeps both (the move then ends earlier; preflight warns if it got faster)', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'trim_clip', args: { clipId: s.clip, edge: 'end', to: f(120) } }]);
    expect(carries(findClip(r.doc, s.clip)!.clip)).toBe(true);
  });
  it('cut_range through the clip: the part after the cut', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'cut_range', args: { start: f(40), end: f(50) } }]);
    const parts = clipsOfAsset(r.doc, s.pic);
    expect(parts.length).toBe(2);
    expect(parts.every(carries)).toBe(true);
  });
  it('insert_gap across the clip: both parts', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'insert_gap', args: { at: f(70), duration: f(10) } }]);
    expect(clipsOfAsset(r.doc, s.pic).filter(carries).length).toBe(2);
  });
  it('freeze_frame on another track splits a photo clip that crosses the hold: both parts', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'freeze_frame', args: { clipId: s.video, at: f(30), duration: f(15) } }]);
    expect(clipsOfAsset(r.doc, s.pic).filter(carries).length).toBe(2);
  });
  it('duplicate_clips (the editor\'s copy and paste): the copy', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'duplicate_clips', args: { clipIds: [s.clip], at: f(400) } }]);
    expect(clipsOfAsset(r.doc, s.pic).filter(carries).length).toBe(2);
  });
  it('cloneDocument, and an entity diff restored (undo): exact', () => {
    const s = living();
    expect(carries(findClip(cloneDocument(s.doc), s.clip)!.clip)).toBe(true);
    const after = tx(s.doc, [{ op: 'set_clip_depth', args: { clipId: s.clip2, depth: DEPTH } }]).doc;
    const changes = diffEntities(s.doc, after);
    expect(changes.map((c) => c.id)).toEqual([s.clip2]);
    const back = structuredClone(after);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect((findClip(back, s.clip2)!.clip as MediaClip).depth).toBeUndefined();
  });
  it('a format variant (projectVariant) carries both; the audience versions keep the living picture (stir none)', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const v = projectVariant(r.doc, r.results[0]!.output!.variantId as string);
    expect(carries(findClip(v, s.clip)!.clip)).toBe(true);
    expect(CALM_OFF_EFFECTS).not.toContain(LIVING_EFFECT);
  });
});

describe('copiers that DROP them, and the one that refuses', () => {
  it('the portrait backdrop copy drops both; the clip that shows the cut-out keeps them', () => {
    const s = living();
    const prov = (src: string) => ({ origin: 'derived' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_fixture', capabilityId: 'comfy.image.remove-background', capabilityVersion: '0.1.0', graphDigest: `sha256:${'d'.repeat(64)}`, params: {}, sourceAssetIds: [src], outputName: 'cutout', outputRole: 'primary', encoding: 'display', provider: {} } });
    const cutAsset = { kind: 'image' as const, name: 'cut.png', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: true }, provenance: prov(s.pic) };
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: cutAsset } }]);
    const cut = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'portrait_blur', args: { clipId: s.clip, cutoutAssetId: cut } }]);
    const out = r.results[0]!.output as { cutoutClipId: string; backgroundClipId: string };
    const copy = findClip(r.doc, out.backgroundClipId)!.clip as MediaClip;
    expect(copy.depth).toBeUndefined();
    expect((copy.effects ?? []).map((e) => e.type)).toEqual(['blur.gaussian']);
    expect(carries(findClip(r.doc, out.cutoutClipId)!.clip)).toBe(true);
  });
  it('paste attributes: neither the depth nor the living picture (livingContracts.test.ts has the effects group in full)', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'paste_attributes', args: { fromClipId: s.clip, toClipIds: [s.clip2], groups: ['effects', 'animation', 'transform', 'colour'] } }]);
    const t = findClip(r.doc, s.clip2)!.clip as MediaClip;
    expect([t.depth, (t.effects ?? []).some((e) => e.type === LIVING_EFFECT)]).toEqual([undefined, false]);
  });
});

describe('planners and templates make new clips from files: none of them reads or writes a depth', () => {
  const SOURCES = ['templatePlan.ts', 'applyTemplate.ts', 'familyFilm.ts', 'story.ts', 'growing.ts', 'shortsPlan.ts', 'multicam.ts', 'multicamOps.ts', 'moves.ts', 'packs/use.ts'];
  it.each(SOURCES)('%s names neither depth nor the living picture (a new reader or copier must be classified here first)', (file) => {
    const url = new URL(`./${file}`, import.meta.url);
    if (!fs.existsSync(url)) return; // a planner not in this build
    const text = fs.readFileSync(url, 'utf8');
    expect(/\.depth\b|depth\.living|set_clip_depth|set_living_picture|LIVING_EFFECT/.test(text), file).toBe(false);
  });
  it('add_clip makes a clip without a depth', () => {
    const s = living();
    const r = tx(s.doc, [{ op: 'add_clip', args: { assetId: s.pic, start: f(600), duration: f(60) } }]);
    expect((findClip(r.doc, r.results[0]!.output!.clipId as string)!.clip as MediaClip).depth).toBeUndefined();
  });
});
