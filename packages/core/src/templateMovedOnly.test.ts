/**
 * "Only its place in time changed" (ADR-0016 decision 6, amendment of 2026-11-24): apply_template records where it placed each
 * clip when asked (recordRanges), and movedOnly tells a clip of the run that was only moved along its own track from one that
 * was edited by hand. The planner says which moved items it made again (notice moved_back).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, findClip, fingerprint, movedOnly, planTemplate, TEMPLATE_NOTICE_CODES, validateProject,
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
