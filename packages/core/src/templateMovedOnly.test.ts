/**
 * "Only its place in time changed" (ADR-0016 decision 6, amendment of 2026-11-24): apply_template records where it placed each
 * clip when asked (recordRanges), and movedOnly tells a clip of the run that was only moved along its own track from one that
 * was edited by hand. The planner says which moved items it made again (notice moved_back).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, derivedRanges, findClip, fingerprint, movedOnly, onOtherTrack, planTemplate, TEMPLATE_NOTICE_CODES, validateProject,
  type ApplyTemplateArgs, type ApplyTemplateOutput, type OpCall, type ProjectDocument, type TemplateDef, type TemplateStep,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `mo${n++}_`, actor: 'test', allowInternal: true }).doc;
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const picture = (c: string) => ({ kind: 'image' as const, name: `${c}.png`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance });
const video = (c: string) => ({ kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance });

/** Three pictures of 30 frames on one track (the second and third on the first one's track), the middle one with its own sound, and a title. */
const PLAN: TemplateStep[] = [
  { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(0), duration: f(30) }, bind: 's1' },
  { op: 'add_clip', args: { assetId: { $asset: 'vid' }, start: f(30), duration: f(30), sourceIn: f(15), trackId: { $ref: 's1', out: 'trackId' }, withLinkedAudio: true }, bind: 's2' },
  { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(60), duration: f(30), trackId: { $ref: 's1', out: 'trackId' } }, bind: 's3' },
  { op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(45) }, bind: 'title' },
];
const SLOTS: ApplyTemplateArgs['slots'] = [...['s1', 's2', 's3'].map((key) => ({ key, kind: 'picture' as const, clipId: { $ref: key } })), { key: 'title', kind: 'text', clipId: { $ref: 'title' } }];
const call = (extra: Partial<ApplyTemplateArgs> = {}): OpCall => ({
  op: 'apply_template',
  args: { templateId: 'tpl.moved', templateVersion: 1, params: {}, steps: ['p'], assets: [{ key: 'pic', asset: picture('a') }, { key: 'vid', asset: video('b') }], ops: PLAN, slots: SLOTS, ...extra },
});
function applied(extra: Partial<ApplyTemplateArgs> = { recordRanges: true }) {
  const r = applyTransaction(createProject({ id: 'prj_moved', name: 'M', width: 640, height: 360 }), [call(extra)], { idSeed: `mo${n++}_`, actor: 'test', allowInternal: true });
  const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
  const id = (key: string) => out.slots.find((s) => s.key === key)!.clipId;
  return { doc: r.doc, runId: out.runId, id, live: out.createdIds.filter((x) => !!findClip(r.doc, x)) };
}
const moved = (doc: ProjectDocument, runId: string, live: readonly string[]) => movedOnly(doc, doc.recipeRuns[runId]!, live);

describe('apply_template records where it placed each clip, when asked', () => {
  it('recordRanges: every live clip of the run has its start, end and track; without it the run records none, as before', () => {
    const a = applied();
    const run = a.doc.recipeRuns[a.runId]!;
    expect(Object.keys(run.ranges!).sort()).toEqual([...a.live].sort());
    for (const cid of a.live) {
      const found = findClip(a.doc, cid)!;
      expect(run.ranges![cid]).toEqual({ start: found.clip.start, end: T.add(found.clip.start, found.clip.duration), trackId: found.track.id });
    }
    expect(validateProject(a.doc)).toEqual([]);
    const old = applied({});
    expect(old.doc.recipeRuns[old.runId]).not.toHaveProperty('ranges');
  });

  it('a clip kept on regeneration keeps the place recorded with its fingerprint; a new clip gets its own', () => {
    const a = applied();
    const run0 = a.doc.recipeRuns[a.runId]!;
    const s3 = a.id('s3');
    // s3 is edited and moved by hand, then kept by a regeneration that replaces the title only
    let doc = tx(a.doc, [{ op: 'set_clip_transform', args: { clipId: s3, transform: { rotation: 5 } } }, { op: 'move_clip', args: { clipId: s3, start: f(120) } }]);
    const keep = a.live.filter((x) => x !== a.id('title'));
    doc = tx(doc, [call({ runId: a.runId, removeClipIds: [a.id('title')], keepIds: keep, keepSlots: run0.slots!.filter((s) => s.key !== 'title'), ops: [PLAN[3]!], slots: [SLOTS[3]!], recordRanges: true, assets: [] })]);
    const run = doc.recipeRuns[a.runId]!;
    expect(run.ranges![s3]).toEqual(run0.ranges![s3]);
    expect(run.fingerprints[s3]).toBe(run0.fingerprints[s3]);
    const title = run.slots!.find((s) => s.key === 'title')!.clipId;
    expect(title).not.toBe(a.id('title'));
    expect(run.ranges![title]).toMatchObject({ start: f(0), end: f(45) });
    expect(run.ranges).not.toHaveProperty(a.id('title'));
    // moved back to its recorded start with the rotation undone, s3 is untouched again; the rotation alone keeps it edited
    expect(moved(doc, a.runId, keep)).toEqual([]);
  });
});

describe('movedOnly: the only change is the place in time, on the same track', () => {
  it('a ripple delete moves the later pictures (and a linked sound with its picture): they are moved-only; the untouched ones are not named', () => {
    const a = applied();
    const doc = tx(a.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [a.id('s1')] } }]);
    const s2 = findClip(doc, a.id('s2'))!.clip, sound = a.live.find((x) => x !== a.id('s2') && !!(findClip(doc, x)?.clip as { linkGroupId?: string | null } | undefined)?.linkGroupId);
    expect(sound).toBeTruthy();
    expect(T.eq(s2.start, f(0))).toBe(true);
    const live = a.live.filter((x) => !!findClip(doc, x));
    expect(moved(doc, a.runId, live).sort()).toEqual([a.id('s2'), a.id('s3'), sound!].sort());
    // every one of them differs from its recorded fingerprint, and by its start alone
    const run = doc.recipeRuns[a.runId]!;
    for (const cid of [a.id('s2'), a.id('s3'), sound!]) {
      const c = findClip(doc, cid)!.clip;
      expect(fingerprint(c)).not.toBe(run.fingerprints[cid]);
      expect(fingerprint({ ...c, start: run.ranges![cid]!.start })).toBe(run.fingerprints[cid]);
    }
  });

  it('moved and trimmed, moved and re-sourced, moved and restyled: not moved-only (edited by hand)', () => {
    // after the ripple delete of s1: s2 (the video, with its sound) lies on frames 0..30 and s3 on 30..60
    const edits: [string, 's2' | 's3', (clipId: string) => OpCall][] = [
      ['trimmed', 's3', (clipId) => ({ op: 'trim_clip', args: { clipId, edge: 'end', to: f(50) } })],
      ['re-sourced', 's2', (clipId) => ({ op: 'slip_clip', args: { clipId, by: f(30) } })],
      ['transformed', 's3', (clipId) => ({ op: 'set_clip_transform', args: { clipId, transform: { scale: 0.5 } } })],
      ['given an effect', 's3', (clipId) => ({ op: 'add_effect', args: { clipId, type: 'color.grayscale' } })],
    ];
    for (const [what, key, edit] of edits) {
      const a = applied();
      const target = a.id(key), other = a.id(key === 's3' ? 's2' : 's3');
      const doc = tx(a.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [a.id('s1')] } }, edit(target)]);
      const names = moved(doc, a.runId, a.live.filter((x) => !!findClip(doc, x)));
      expect(names, what).not.toContain(target);
      expect(names, what).toContain(other); // the other shifted picture is still moved-only
    }
  });

  it('moved to another track (with or without a time shift) is not moved-only; moved back onto its own track at another time it is', () => {
    const a = applied();
    const withTrack = applyTransaction(a.doc, [{ op: 'add_track', args: { kind: 'video' } }], { idSeed: `mo${n++}_`, actor: 'test' });
    const other = withTrack.results[0]!.output!.trackId as string;
    const s3 = a.id('s3'), own = findClip(a.doc, s3)!.track.id;
    const away = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: s3, start: f(150), trackId: other } }]);
    expect(moved(away, a.runId, a.live)).toEqual([]);
    const sameTime = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: s3, start: f(60), trackId: other } }]);
    expect(moved(sameTime, a.runId, a.live)).toEqual([]);
    const back = tx(away, [{ op: 'move_clip', args: { clipId: s3, start: f(200), trackId: own } }]);
    expect(moved(back, a.runId, a.live)).toEqual([s3]);
    // and back on its recorded start it is simply untouched
    const home = tx(back, [{ op: 'move_clip', args: { clipId: s3, start: f(60) } }]);
    expect(moved(home, a.runId, a.live)).toEqual([]);
    expect(fingerprint(findClip(home, s3)!.clip)).toBe(home.recipeRuns[a.runId]!.fingerprints[s3]);
  });

  it('a moved title is moved-only; a run that recorded no places (an older run) names nothing', () => {
    const a = applied();
    const doc = tx(a.doc, [{ op: 'move_clip', args: { clipId: a.id('title'), start: f(15) } }]);
    expect(moved(doc, a.runId, a.live)).toEqual([a.id('title')]);
    const old = applied({});
    const oldDoc = tx(old.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [old.id('s1')] } }]);
    expect(moved(oldDoc, old.runId, old.live.filter((x) => !!findClip(oldDoc, x)))).toEqual([]);
  });
});

describe('onOtherTrack: a clip on another track than the run recorded', () => {
  it('names a clip taken to another track, with or without a time shift, and no other; a run that recorded no track names none', () => {
    const a = applied();
    const withTrack = applyTransaction(a.doc, [{ op: 'add_track', args: { kind: 'video' } }], { idSeed: `mo${n++}_`, actor: 'test' });
    const other = withTrack.results[0]!.output!.trackId as string;
    const s3 = a.id('s3');
    expect(onOtherTrack(withTrack.doc, withTrack.doc.recipeRuns[a.runId]!, a.live)).toEqual([]);
    const sameTime = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: s3, start: f(60), trackId: other } }]);
    expect(fingerprint(findClip(sameTime, s3)!.clip)).toBe(sameTime.recipeRuns[a.runId]!.fingerprints[s3]); // the fingerprint holds no track
    expect(onOtherTrack(sameTime, sameTime.recipeRuns[a.runId]!, a.live)).toEqual([s3]);
    const away = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: s3, start: f(150), trackId: other } }]);
    expect(onOtherTrack(away, away.recipeRuns[a.runId]!, a.live)).toEqual([s3]);
    // moved along its own track only: not on another track
    const along = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: s3, start: f(150) } }]);
    expect(onOtherTrack(along, along.recipeRuns[a.runId]!, a.live)).toEqual([]);
    const old = applied({});
    const oldTrack = applyTransaction(old.doc, [{ op: 'add_track', args: { kind: 'video' } }], { idSeed: `mo${n++}_`, actor: 'test' });
    const oldMoved = tx(oldTrack.doc, [{ op: 'move_clip', args: { clipId: old.id('s3'), start: f(60), trackId: oldTrack.results[0]!.output!.trackId as string } }]);
    expect(onOtherTrack(oldMoved, oldMoved.recipeRuns[old.runId]!, old.live)).toEqual([]);
  });
});

describe('derivedRanges: the places of a run that recorded none, from its own plan made again', () => {
  const words = (en: string) => ({ he: `${en} (he)`, en });
  const DEF: TemplateDef = {
    id: 'tpl.moved-derived', version: 1, name: words('Derived'), hint: words('Derived'), genre: 'montage', designedFor: 'wide', tempo: { fallbackBpm: 120 }, music: { need: 'none', startAt: 'zero' },
    slots: ['s1', 's2', 's3'].map((key) => ({ key, role: words(key), accept: 'any' as const, span: { beats: 2 }, keepAudio: key === 's2' })), slotUse: { mode: 'all', min: 1 },
    texts: [{ key: 'title', role: words('Title'), default: words('Hello'), maxChars: 20, presetId: 'clean-white', at: { slot: 's1' }, place: { x: 0, y: 0 } }], elements: [], sfx: [],
    adjust: [{ key: 'look', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1 } }] }],
  };
  /** A run of DEF committed without recordRanges, as before the amendment. */
  function olderRun() {
    const doc0 = createProject({ id: 'prj_derived', name: 'D', width: 640, height: 360, frameRate: R });
    doc0.assets.vid = { id: 'vid', ...video('d') };
    const params = { media: ['vid'] };
    const plan = planTemplate(doc0, DEF, params);
    const r = applyTransaction(doc0, [{ op: 'apply_template', args: { templateId: DEF.id, templateVersion: DEF.version, params: plan.params, steps: plan.steps, ops: plan.ops, slots: plan.slots } }], { idSeed: `mo${n++}_`, actor: 'test', allowInternal: true });
    const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
    const run = r.doc.recipeRuns[out.runId]!;
    const id = (key: string) => run.slots!.find((x) => x.key === key)!.clipId;
    return { doc: r.doc, run, runId: out.runId, id, live: run.createdIds.filter((x) => !!findClip(r.doc, x)) };
  }
  const replan = (doc: ProjectDocument, runId: string, live: readonly string[]) => {
    const run = doc.recipeRuns[runId]!;
    const base = structuredClone(doc);
    for (const cid of live) { const found = findClip(base, cid); if (found) found.track.clips.splice(found.index, 1); }
    const { templateVersion: _v, ...own } = run.params;
    return derivedRanges(doc, planTemplate(base, DEF, own), run);
  };

  it('pictures get their start and the track the plan names; a picture\'s own sound its picture\'s start; titles and looks get no track (not covered)', () => {
    const a = olderRun();
    expect(a.run).not.toHaveProperty('ranges');
    const places = replan(a.doc, a.runId, a.live);
    const track = findClip(a.doc, a.id('s1'))!.track.id;
    expect([places[a.id('s1')], places[a.id('s2')], places[a.id('s3')]]).toEqual([{ start: f(0), end: f(30), trackId: track }, { start: f(30), end: f(60), trackId: track }, { start: f(60), end: f(90), trackId: track }]);
    const sound = a.live.find((x) => x !== a.id('s2') && (findClip(a.doc, x)!.clip as { linkGroupId?: string | null }).linkGroupId)!;
    expect(places[sound]).toEqual({ start: f(30), end: f(60), trackId: findClip(a.doc, sound)!.track.id });
    expect([places[a.id('title')], places[a.id('look')]]).toEqual([{ start: f(0), end: f(30) }, { start: f(0), end: f(90) }]);
  });

  it('with them movedOnly tells the clips a ripple delete moved (pictures, a sound with its picture); an edited one, one on another track and a moved title are not named', () => {
    const a = olderRun();
    const sound = a.live.find((x) => x !== a.id('s2') && (findClip(a.doc, x)!.clip as { linkGroupId?: string | null }).linkGroupId)!;
    const rippled = tx(a.doc, [{ op: 'ripple_delete_clips', args: { clipIds: [a.id('s1')] } }, { op: 'move_clip', args: { clipId: a.id('title'), start: f(15) } }]);
    const live = a.live.filter((x) => !!findClip(rippled, x));
    const named = (doc: ProjectDocument) => movedOnly(doc, { fingerprints: a.run.fingerprints, ranges: replan(doc, a.runId, live) }, live).sort();
    expect(named(rippled)).toEqual([a.id('s2'), a.id('s3'), sound].sort());
    expect(named(tx(rippled, [{ op: 'set_clip_transform', args: { clipId: a.id('s3'), transform: { rotation: 3 } } }]))).toEqual([a.id('s2'), sound].sort());
    const withTrack = applyTransaction(rippled, [{ op: 'add_track', args: { kind: 'video' } }], { idSeed: `mo${n++}_`, actor: 'test' });
    const away = tx(withTrack.doc, [{ op: 'move_clip', args: { clipId: a.id('s3'), start: f(200), trackId: withTrack.results[0]!.output!.trackId as string } }]);
    expect(named(away)).toEqual([a.id('s2'), sound].sort());
  });
});

describe('apply_recipe records each clip\'s track when asked (recordTracks)', () => {
  it('with recordRanges and recordTracks a range holds the track; without recordTracks it does not, as before; a kept clip keeps the track recorded for it', () => {
    const doc0 = createProject({ id: 'prj_rt', name: 'R', width: 640, height: 360, frameRate: R });
    doc0.assets.img = { id: 'img', ...picture('e') };
    const ops = [{ op: 'add_clip', args: { assetId: 'img', start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: 'img', start: f(30), duration: f(30) } }];
    const run = (extra: Record<string, unknown>, doc = doc0) => applyTransaction(doc, [{ op: 'apply_recipe', args: { recipeId: 'beat-montage', params: {}, steps: ['s'], ops, recordRanges: true, ...extra } }], { idSeed: `mo${n++}_`, actor: 'test', allowInternal: true });
    const before = run({});
    const idB = before.results[0]!.output!.runId as string;
    for (const r of Object.values(before.doc.recipeRuns[idB]!.ranges!)) expect(r).not.toHaveProperty('trackId');
    const now = run({ recordTracks: true });
    const id = now.results[0]!.output!.runId as string, created = now.results[0]!.output!.createdIds as string[];
    const track = findClip(now.doc, created[0]!)!.track.id;
    expect(Object.values(now.doc.recipeRuns[id]!.ranges!).map((r) => r.trackId)).toEqual([track, track]);
    expect(validateProject(now.doc)).toEqual([]);
    // the first clip is taken to another track and kept by the next run: its range is where it lies, its track the recorded one
    const added = applyTransaction(now.doc, [{ op: 'add_track', args: { kind: 'video' } }], { idSeed: `mo${n++}_`, actor: 'test' });
    const other = added.results[0]!.output!.trackId as string;
    const movedDoc = tx(added.doc, [{ op: 'move_clip', args: { clipId: created[0]!, start: f(0), trackId: other } }]);
    const again = applyTransaction(movedDoc, [{ op: 'apply_recipe', args: { runId: id, recipeId: 'beat-montage', params: {}, steps: ['s'], removeClipIds: [created[1]!], keepIds: [created[0]!], ops: [ops[1]!], recordRanges: true, recordTracks: true } }], { idSeed: `mo${n++}_`, actor: 'test', allowInternal: true });
    expect(again.doc.recipeRuns[id]!.ranges![created[0]!]).toEqual({ start: f(0), end: f(30), trackId: track });
    expect(onOtherTrack(again.doc, again.doc.recipeRuns[id]!, [created[0]!])).toEqual([created[0]]);
  });
});

describe('the planner says which moved items it made again', () => {
  const words = (en: string) => ({ he: `${en} (he)`, en });
  const DEF: TemplateDef = {
    id: 'tpl.moved-notice', version: 1, name: words('Moved'), hint: words('Moved'), genre: 'montage', designedFor: 'wide', tempo: { fallbackBpm: 120 }, music: { need: 'none', startAt: 'zero' },
    slots: ['s1', 's2', 's3'].map((key) => ({ key, role: words(key), accept: 'any' as const, span: { beats: 2 } })), slotUse: { mode: 'all', min: 1 },
    texts: [{ key: 'title', role: words('Title'), default: words('Hello'), maxChars: 20, presetId: 'clean-white', at: { slot: 's1' }, place: { x: 0, y: 0 } }], elements: [], sfx: [], adjust: [],
  };
  it('notice moved_back names the moved keys the plan makes again (sorted, each once), and none that it keeps or leaves out', () => {
    const doc = createProject({ id: 'prj_notice', name: 'N', width: 640, height: 360 });
    doc.assets.img = { id: 'img', ...picture('c') };
    expect(TEMPLATE_NOTICE_CODES).toContain('moved_back');
    const plan = planTemplate(doc, DEF, { media: ['img'] }, { movedKeys: ['title', 's3', 's2', 's3'], keepKeys: ['s2'] });
    expect(plan.notices).toEqual([expect.objectContaining({ code: 'moved_back', details: { keys: ['s3', 'title'] } })]);
    expect(plan.notices[0]!.message).toMatch(/^2 item\(s\) that were only moved in time/);
    expect(planTemplate(doc, DEF, { media: ['img'] }).notices).toEqual([]);
    expect(planTemplate(doc, DEF, { media: ['img'] }, { movedKeys: ['s1'], removedKeys: ['s1'] }).notices.map((x) => x.code)).toEqual(['removed_by_hand']);
  });
});
