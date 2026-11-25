/**
 * Story regeneration (W1; storyRegeneration.ts with core planStory): what a rebuild keeps, puts back and leaves out, applied through
 * the REAL apply_template exactly as the server commits it (removeClipIds, keepIds, keepSlots, the run record with removedPicks).
 * Hand edits are ordinary public ops; "the editor" is imitated with the ops it sends when the main track's magnet and ripple are on
 * (trim then move the later clips; ripple_delete_clips). Media are labelled test builders (core familyFilm.testDouble.ts).
 * Includes the property run of S18 and one real Store undo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, clipEnd, findClip, fingerprint, flashGapFrames, planStory, STORY_BINDS, STORY_BLOCKING_TEXT, STORY_RUN_RECIPE_ID, STORY_TEMPLATE_ID, STORY_VERSION, storyRunParams, storyRunPicked, storyRunRecordParams, storyRunRemovedPicks, validateProject,
  type ProjectDocument, type StoryPlan, type StoryPlanContext,
} from '@pulseframe/core';
import { project, R30, song, still, video } from '../../../packages/core/src/familyFilm.testDouble.ts';
import { STORY_REGEN_BUILT, storyRegeneration, storyRegenRecordParams } from './storyRegeneration.ts';
import { Store } from './store.ts';

const base: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };
const fr = (f: number) => T.frameTime(f, R30);
const TAPS = [4000, 8000, 12_000, 16_000, 20_000];
const PICS = ['s0', 's1', 's2', 's3', 's4', 's5'];
function storyDoc(more: (d: ProjectDocument) => void = () => {}): ProjectDocument {
  const d = project(R30);
  d.assets.nar = song('nar', 24);
  d.assets.mus = song('mus', 60);
  d.assets.mus2 = song('mus2', 60);
  for (const id of [...PICS, 'x']) d.assets[id] = still(id);
  more(d);
  return d;
}
const applyArgs = (plan: StoryPlan, extra: Record<string, unknown> = {}, removed: Parameters<typeof storyRunRecordParams>[1] = []) =>
  ({ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, removed), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true, ...extra } });
function build(doc: ProjectDocument, params: Record<string, unknown> = {}) {
  const plan = planStory(doc, { narrationAssetId: 'nar', assetIds: PICS, cutsMs: TAPS, musicAssetId: 'mus', ...params }, base);
  const out = applyTransaction(doc, [applyArgs(plan)], { idSeed: 'st_', actor: 'test', allowInternal: true }).doc;
  expect(validateProject(out)).toEqual([]);
  return { doc: out, runId: Object.keys(out.recipeRuns)[0]!, plan };
}
let seq = 0;
function rebuild(doc: ProjectDocument, runId: string, newParams: Record<string, unknown> = {}, restoreRemoved = false) {
  const run = doc.recipeRuns[runId]!;
  const params = { ...storyRunParams(run.params), ...newParams };
  const g = storyRegeneration(doc, run, params, { restoreRemoved });
  const plan = planStory(g.without, params, { ...base, ...g.ctx });
  if (plan.blocking.length) return { g, plan, doc: null };
  // the server's key-clash guard: a new slot never takes a key a kept slot holds
  expect(plan.slots.filter((s) => g.keepSlots.some((k) => k.key === s.key))).toEqual([]);
  const out = applyTransaction(doc, [applyArgs(plan, { runId, removeClipIds: g.removable, keepIds: g.keepIds, keepSlots: g.keepSlots, params: storyRegenRecordParams(plan, g) })], { idSeed: `rg${seq++}_`, actor: 'test', allowInternal: true }).doc;
  expect(validateProject(out)).toEqual([]);
  return { g, plan, doc: out };
}
const edit = (doc: ProjectDocument, ops: { op: string; args: unknown }[]) => applyTransaction(doc, ops, { idSeed: `hand${seq++}_`, actor: 'person' }).doc;
/** The run's picture slots on the timeline, [start, end) frames, in time order. */
function pictures(doc: ProjectDocument, runId: string) {
  return (doc.recipeRuns[runId]!.slots ?? []).filter((s) => s.kind === 'picture').flatMap((s) => {
    const f = findClip(doc, s.clipId);
    if (!f) return [];
    return [{ key: s.key, clipId: s.clipId, s: T.nearestFrameIndex(f.clip.start, R30), e: T.nearestFrameIndex(clipEnd(f.clip), R30), assetId: f.clip.type === 'media' ? f.clip.assetId : '' }];
  }).sort((a, b) => a.s - b.s);
}
const clipOf = (doc: ProjectDocument, runId: string, assetId: string) => pictures(doc, runId).find((p) => p.assetId === assetId)!.clipId;
const narrationOf = (doc: ProjectDocument, runId: string) => doc.recipeRuns[runId]!.slots!.find((s) => s.key === STORY_BINDS.narration)!.clipId;
/** No frame without a picture from `from` to `to`, and no two pictures over each other. */
function tiles(pics: { s: number; e: number }[], from: number, to: number) {
  let at = from;
  for (const p of pics) { expect(p.s).toBe(at); at = p.e; }
  expect(at).toBe(to);
}

describe('story regeneration', () => {
  it('is built; an untouched rebuild with other music places every picture on its recorded cut and keeps the narration clip', () => {
    expect(STORY_REGEN_BUILT).toBe(true);
    const { doc, runId } = build(storyDoc());
    const nar = narrationOf(doc, runId);
    const r = rebuild(doc, runId, { musicAssetId: 'mus2' });
    expect(r.g.keepIds).toContain(nar);
    expect(r.g.removable).not.toContain(nar);
    expect(r.g.keepSlots.map((s) => s.key)).toEqual([STORY_BINDS.narration]);
    expect(pictures(r.doc!, runId).map((p) => [p.assetId, p.s, p.e])).toEqual(pictures(doc, runId).map((p) => [p.assetId, p.s, p.e]));
    expect(narrationOf(r.doc!, runId)).toBe(nar);
    expect(r.doc!.recipeRuns[runId]!.recipeId).toBe(STORY_RUN_RECIPE_ID);
    expect(storyRunPicked(r.doc!.recipeRuns[runId]!.params)).toEqual(storyRunPicked(doc.recipeRuns[runId]!.params));
    const music = r.doc!.sequences[r.doc!.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'media' && c.assetId.startsWith('mus'));
    expect(music.map((c) => c.type === 'media' && c.assetId)).toEqual(['mus2']);
    // nothing was added: the same tracks
    expect(r.doc!.sequences[r.doc!.mainSequenceId]!.tracks.map((t) => t.id)).toEqual(doc.sequences[doc.mainSequenceId]!.tracks.map((t) => t.id));
  });

  it('S11 with bare ops: trim 3, replace 4, delete 2, rebuild with other music; restoreRemoved brings 2 back at its cut', () => {
    const { doc, runId } = build(storyDoc());
    const [p1, , p3, p4] = [clipOf(doc, runId, 's0'), clipOf(doc, runId, 's1'), clipOf(doc, runId, 's2'), clipOf(doc, runId, 's3')];
    let d = edit(doc, [{ op: 'trim_clip', args: { clipId: p3, edge: 'start', to: fr(270) } }]);
    d = edit(d, [{ op: 'replace_clip_media', args: { clipId: p4, assetId: 'x' } }]);
    d = edit(d, [{ op: 'delete_clip', args: { clipId: clipOf(d, runId, 's1') } }]);
    const before3 = canonical(findClip(d, p3)!.clip), before4 = canonical(findClip(d, p4)!.clip);
    const r = rebuild(d, runId, { musicAssetId: 'mus2' });
    expect(canonical(findClip(r.doc!, p3)!.clip)).toBe(before3);
    expect(canonical(findClip(r.doc!, p4)!.clip)).toBe(before4);
    const codes = r.plan.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(['kept_by_hand', 'removed_by_hand']));
    expect(r.plan.warnings.find((w) => w.code === 'removed_by_hand')!.message).toContain('"s1.jpg"');
    const pics = pictures(r.doc!, runId);
    expect(pics.map((p) => [p.assetId, p.s, p.e])).toEqual([['s0', 0, 270], ['s2', 270, 360], ['x', 360, 480], ['s4', 480, 600], ['s5', 600, 720]]);
    expect(findClip(r.doc!, p1)).toBeUndefined(); // the first picture was untouched: made again, running on over the deleted one's frames
    tiles(pics, 0, 720);
    expect(storyRunRemovedPicks(r.doc!.recipeRuns[runId]!.params)).toEqual([{ key: expect.any(String), assetId: 's1', cutMs: 4000, how: 'tap' }]);
    // restore: s1 comes back at its own cut (4 s = frame 120), s0 ends there again
    const back = rebuild(r.doc!, runId, {}, true);
    expect(pictures(back.doc!, runId).map((p) => [p.assetId, p.s, p.e])).toEqual([['s0', 0, 120], ['s1', 120, 270], ['s2', 270, 360], ['x', 360, 480], ['s4', 480, 600], ['s5', 600, 720]]);
    expect(storyRunRemovedPicks(back.doc!.recipeRuns[runId]!.params)).toEqual([]);
  });

  it('S11 through the editor (magnet and ripple on): later pictures go back to their cuts (moved_back); the one after a kept clip fills up to it', () => {
    const { doc, runId } = build(storyDoc());
    const [p3, p4] = [clipOf(doc, runId, 's2'), clipOf(doc, runId, 's3')];
    // trim the end of 3 by one second: the magnet closes the gap (the later pictures move one second earlier)
    let d = edit(doc, [{ op: 'trim_clip', args: { clipId: p3, edge: 'end', to: fr(330) } }, { op: 'move_clips', args: { clipIds: [p4, clipOf(doc, runId, 's4'), clipOf(doc, runId, 's5')], delta: fr(-30) } }]);
    d = edit(d, [{ op: 'replace_clip_media', args: { clipId: p4, assetId: 'x' } }]);
    d = edit(d, [{ op: 'ripple_delete_clips', args: { clipIds: [clipOf(d, runId, 's1')] } }]);
    const before3 = canonical(findClip(d, p3)!.clip), before4 = canonical(findClip(d, p4)!.clip);
    const r = rebuild(d, runId, { musicAssetId: 'mus2' });
    expect(canonical(findClip(r.doc!, p3)!.clip)).toBe(before3);
    expect(canonical(findClip(r.doc!, p4)!.clip)).toBe(before4);
    expect(r.g.movedKeys.length).toBe(2);
    expect(r.plan.warnings.find((w) => w.code === 'moved_back')!.details).toEqual({ keys: [...r.g.movedKeys].sort() });
    const pics = pictures(r.doc!, runId);
    expect(pics.map((p) => [p.assetId, p.s, p.e])).toEqual([['s0', 0, 120], ['s2', 120, 210], ['x', 210, 330], ['s4', 330, 600], ['s5', 600, 720]]);
    expect(r.plan.warnings.find((w) => w.code === 'filled_next_to_kept')!.details).toEqual({ items: [{ assetId: 's4', seconds: -5 }] });
    tiles(pics, 0, 720);
  });

  it('S12: the narration dragged 2 s later moves every cut exactly 2 s later; reversed or deleted it blocks, with the fixed sentences', () => {
    const { doc, runId } = build(storyDoc());
    const nar = narrationOf(doc, runId);
    const moved = edit(doc, [{ op: 'move_clip', args: { clipId: nar, start: fr(60) } }]);
    const r = rebuild(moved, runId);
    expect(pictures(r.doc!, runId).map((p) => [p.assetId, p.s, p.e])).toEqual(pictures(doc, runId).map((p) => [p.assetId, p.s + 60, p.e + 60]));
    expect(T.eq(findClip(r.doc!, nar)!.clip.start, fr(60))).toBe(true);
    const reversed = rebuild(edit(doc, [{ op: 'set_clip_reverse', args: { clipId: nar, reverse: true } }]), runId);
    expect(reversed.doc).toBeNull();
    expect(reversed.plan.blocking).toEqual([{ code: 'kept_narration_not_followable', message: STORY_BLOCKING_TEXT.kept_narration_not_followable, details: { clipId: nar } }]);
    const fast = rebuild(edit(doc, [{ op: 'set_clip_speed', args: { clipId: nar, speed: 2 } }]), runId);
    expect(fast.plan.blocking.map((b) => b.code)).toEqual(['kept_narration_not_followable']);
    const deleted = rebuild(edit(doc, [{ op: 'delete_clip', args: { clipId: nar } }]), runId);
    expect(deleted.plan.blocking).toEqual([{ code: 'narration_removed', message: STORY_BLOCKING_TEXT.narration_removed, details: { clipId: nar } }]);
    expect(deleted.plan.ops).toEqual([]);
  });

  it('a level or ducking set by hand on the story\'s tracks survives a rebuild that does not change the mix', () => {
    const d0 = storyDoc((x) => { x.assets.v = video('v', 30); });
    const { doc, runId } = build(d0, { assetIds: ['v', 's1', 's2'], cutsMs: [8000, 16_000] });
    const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
    const own = tracks.find((t) => t.audio?.gain === 0.25)!, music = tracks.find((t) => t.audio?.duck)!;
    const d = edit(doc, [{ op: 'set_track_audio', args: { trackId: own.id, gain: 0.5 } }, { op: 'set_ducking', args: { trackId: music.id, sourceTrackIds: music.audio!.duck!.sourceTrackIds, reductionDb: 6 } }]);
    const r = rebuild(d, runId, { musicAssetId: 'mus2' });
    expect(r.plan.ops.filter((o) => o.op === 'set_track_audio' || o.op === 'set_ducking')).toEqual([]);
    const after = r.doc!.sequences[r.doc!.mainSequenceId]!.tracks;
    expect(after.find((t) => t.id === own.id)!.audio!.gain).toBe(0.5);
    expect(after.find((t) => t.id === music.id)!.audio!.duck!.reductionDb).toBe(6);
    expect(after.find((t) => t.id === own.id)!.clips).toHaveLength(1);
  });

  it('S18 property run: random trims, replaces, deletes and moves; a rebuild keeps every changed clip byte-equal, lays no two pictures over each other and no cut under the gap', () => {
    const { doc, runId } = build(storyDoc());
    const gap = flashGapFrames(30);
    const editArb = fc.record({ kind: fc.constantFrom('trimStart', 'trimEnd', 'replace', 'delete', 'ripple', 'move'), pick: fc.integer({ min: 0, max: 5 }), amount: fc.integer({ min: 1, max: 40 }) });
    fc.assert(fc.property(fc.array(editArb, { minLength: 1, maxLength: 5 }), fc.boolean(), (edits, restore) => {
      let d = doc;
      for (const e of edits) {
        const pics = pictures(d, runId);
        const p = pics[e.pick % Math.max(1, pics.length)];
        if (!p) continue;
        const ops = e.kind === 'trimStart' ? [{ op: 'trim_clip', args: { clipId: p.clipId, edge: 'start', to: fr(Math.min(p.s + e.amount, p.e - gap)) } }]
          : e.kind === 'trimEnd' ? [{ op: 'trim_clip', args: { clipId: p.clipId, edge: 'end', to: fr(Math.max(p.e - e.amount, p.s + gap)) } }]
          : e.kind === 'replace' ? [{ op: 'replace_clip_media', args: { clipId: p.clipId, assetId: 'x' } }]
          : e.kind === 'delete' ? [{ op: 'delete_clip', args: { clipId: p.clipId } }]
          : e.kind === 'ripple' ? [{ op: 'ripple_delete_clips', args: { clipIds: [p.clipId] } }]
          : [{ op: 'move_clip', args: { clipId: p.clipId, start: fr(p.s + e.amount) } }];
        try { d = edit(d, ops); } catch { /* an edit the editor would refuse (overlap, too short): skip it */ }
      }
      const run = d.recipeRuns[runId]!;
      const changed = run.createdIds.filter((id) => { const f = findClip(d, id); return !!f && fingerprint(f.clip) !== run.fingerprints[id]; });
      const before = canonical(d);
      const r = rebuild(d, runId, { musicAssetId: 'mus2' }, restore);
      expect(canonical(d)).toBe(before); // pure: the document before is untouched, so one undo of the one transaction gives it back
      const out = r.doc!;
      for (const id of changed) {
        const moved = r.g.removable.includes(id);
        if (!moved) expect(canonical(findClip(out, id)!.clip)).toBe(canonical(findClip(d, id)!.clip));
      }
      const all = out.sequences[out.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips.map((c) => [T.nearestFrameIndex(c.start, R30), T.nearestFrameIndex(clipEnd(c), R30)] as const)).sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < all.length; i++) expect(all[i]![0]).toBeGreaterThanOrEqual(all[i - 1]![1]);
      for (const k of r.plan.picks) expect(k.frames).toBeGreaterThanOrEqual(gap);
      const kept = new Set(r.g.protectedIds);
      const pics = pictures(out, runId);
      for (let i = 1; i < pics.length; i++) if (!kept.has(pics[i]!.clipId) || !kept.has(pics[i - 1]!.clipId)) expect(pics[i]!.s - pics[i - 1]!.s).toBeGreaterThanOrEqual(gap);
    }), { numRuns: 60, seed: 20261125 });
  });

  it('one Store undo returns the exact hash from before the rebuild', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-story-regen-'));
    const store = new Store(dir);
    try {
      const d0 = storyDoc();
      const pid = store.importProject(d0).doc.id;
      const first = planStory(store.getProject(pid).doc, { narrationAssetId: 'nar', assetIds: PICS, cutsMs: TAPS, musicAssetId: 'mus' }, base);
      store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [applyArgs(first)] });
      const runId = Object.keys(store.getProject(pid).doc.recipeRuns)[0]!;
      store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: clipOf(store.getProject(pid).doc, runId, 's1') } }] });
      const p = store.getProject(pid), before = canonical(p.doc);
      const run = p.doc.recipeRuns[runId]!, params = { ...storyRunParams(run.params), musicAssetId: 'mus2' };
      const g = storyRegeneration(p.doc, run, params);
      const plan = planStory(g.without, params, { ...base, ...g.ctx });
      const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, expectedRevision: p.revision, ops: [applyArgs(plan, { runId, removeClipIds: g.removable, keepIds: g.keepIds, keepSlots: g.keepSlots }, g.removedPicks)] });
      expect(r.revision).toBe(p.revision + 1);
      expect(canonical(store.getProject(pid).doc)).not.toBe(before);
      store.undo(pid, 'user:owner', 'undo');
      expect(canonical(store.getProject(pid).doc)).toBe(before);
    } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('story regeneration: a second rebuild (integration)', () => {
  it('a picture replaced by hand stays the only place of its pick: a second rebuild (restoreRemoved) does not place its old file again, and the picture deleted by hand comes back', () => {
    const { doc, runId } = build(storyDoc());
    const [p3, p4] = [clipOf(doc, runId, 's2'), clipOf(doc, runId, 's3')];
    // as the editor does it with ripple on: W ripple-trims the end of 3 (later pictures one second earlier), replace 4, Delete 2 ripples
    let d = edit(doc, [{ op: 'trim_clip', args: { clipId: p3, edge: 'end', to: fr(330) } }, { op: 'move_clips', args: { clipIds: [p4, clipOf(doc, runId, 's4'), clipOf(doc, runId, 's5')], delta: fr(-30) } }]);
    d = edit(d, [{ op: 'replace_clip_media', args: { clipId: p4, assetId: 'x' } }]);
    d = edit(d, [{ op: 'ripple_delete_clips', args: { clipIds: [clipOf(d, runId, 's1')] } }]);
    const first = rebuild(d, runId, { musicAssetId: 'mus2' });
    expect(pictures(first.doc!, runId).map((p) => p.assetId)).not.toContain('s3');
    const before3 = canonical(findClip(first.doc!, p3)!.clip), before4 = canonical(findClip(first.doc!, p4)!.clip);
    // the second rebuild: the run record of the first must still say which picks the kept clips hold
    const second = rebuild(first.doc!, runId, {}, true);
    const pics = pictures(second.doc!, runId);
    expect(pics.map((p) => p.assetId)).not.toContain('s3');
    expect(pics.map((p) => p.assetId)).toContain('s1');
    expect(canonical(findClip(second.doc!, p3)!.clip)).toBe(before3);
    expect(canonical(findClip(second.doc!, p4)!.clip)).toBe(before4);
    tiles(pics, 0, 720);
    // and once more without restoring: still no old file of the replaced picture
    const third = rebuild(second.doc!, runId, { musicAssetId: 'mus' });
    expect(pictures(third.doc!, runId).map((p) => p.assetId)).not.toContain('s3');
  });
});
