/**
 * The family film's pearls hook (wave 7, .artifacts/wave7/pearls-decisions.md §2.7–§2.9, verifier C9–C14, first pearl of a file only):
 * - C14: without picks.pearls nothing about pearls is read: every plan equals the plan of the same document with no ranges, its
 *   params carry no `pearls`, and a battery of the existing kinds of plans hashes to the golden digest taken from the planner as it
 *   was before this change (byte-identical).
 * - C9: a pearl pick starts at the pearl's first frame (sourceFrameOfTime(span.start)), never centred; its slot is the smallest
 *   allowed span of at least the pearl's frames, else the largest (pearl_cut_short); a file too short after the pearl starts earlier.
 * - C10/C11/C12: a pearl is class A and never dropped for room; every pearl of a chosen file not in the film is in pearl_left_out
 *   with why; the first pearl by span start (then range id) is the pick.
 * - C13: a pearl pick deleted by hand leaves out that pearl only; the file gives its next pearl or its measured window.
 * Documents are synthetic (familyFilm.testDouble.ts); ranges are put straight into doc.sourceRanges (the ops are builder A's).
 *
 * TEST DOUBLE (labelled): until builder A's core filmWindowOfRange is merged it throws SourceRangesNotBuilt; the mock below then
 * uses `windowDouble`, the contract's rule written out (sourceFrameOfTime of the start; the first frame shown at or after the end).
 * Once A's body is in, the real function answers and the double is only compared with it (the last test).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { canonical, sourceFrameOfTime, sourceTimeOfFrame, validateProject, videoFrames, type Asset, type FamilyFilmPlan, type FilmPlanContext, type ProjectDocument, type SourceRange } from './index.ts';
import { filmPearlKey, planFamilyFilm } from './familyFilm.ts';
import { applyFilm, beatTimes, edit, emptyCtx, project, regenerateFilm, regenerationPlan, song, still, video, win, withBeats, withMoments, type Rate } from './familyFilm.testDouble.ts';
import * as SR from './sourceRanges.ts';

const windowDouble = vi.hoisted(() => ({ used: 0 }));
vi.mock('./sourceRanges.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sourceRanges.ts')>();
  const speed = await import('./speed.ts');
  /** TEST DOUBLE of filmWindowOfRange (the contract's rule), used only while the real one is not built. */
  const double = (asset: Pick<Asset, 'kind' | 'video' | 'duration'>, range: SourceRange) => {
    if (asset.kind === 'image' || !asset.video || range.span === null) return null;
    const from = speed.sourceFrameOfTime(asset, range.span.start);
    let to = speed.sourceFrameOfTime(asset, range.span.end);
    if (T.lt(speed.sourceTimeOfFrame(asset, to), range.span.end)) to++;
    return { fromFrame: from, toFrame: Math.max(from + 1, to) };
  };
  return {
    ...real,
    filmWindowOfRange: (asset: Pick<Asset, 'kind' | 'video' | 'duration'>, range: SourceRange) => {
      try { return real.filmWindowOfRange(asset, range); } catch (e) {
        if (!(e instanceof real.SourceRangesNotBuilt)) throw e;
        windowDouble.used++;
        return double(asset, range);
      }
    },
    __double: double,
  };
});

const R30: Rate = { num: 30, den: 1 };
const LABEL = 'אני רוצה סופגנייה עם ריבה של דינוזאורים';
const ms = (x: number) => T.rt(x, 1000);
const pearl = (id: string, assetId: string, from: T.RationalTime, to: T.RationalTime, over: Partial<SourceRange> = {}): SourceRange => ({ id, assetId, kind: 'pearl', span: { start: from, end: to }, label: `${LABEL} ${id}`, createdBy: 'user:local', ...over });
// people named by a range are put in the project too: the document must be valid for apply (validateSourceRanges)
const withRanges = (doc: ProjectDocument, ranges: SourceRange[]): ProjectDocument => {
  const named = [...new Set(ranges.flatMap((r) => r.people ?? []))].filter((id) => !doc.people?.[id]);
  return { ...doc, ...(named.length ? { people: { ...doc.people, ...Object.fromEntries(named.map((id) => [id, { id, name: id, birthDate: null }])) } } : {}), sourceRanges: Object.fromEntries(ranges.map((r) => [r.id, r])) };
};
const withoutRanges = (doc: ProjectDocument): ProjectDocument => { const { sourceRanges: _r, ...rest } = doc; return rest as ProjectDocument; };
const plan = (doc: ProjectDocument, params: Record<string, unknown>, ctx: FilmPlanContext = emptyCtx()) => planFamilyFilm(doc, params, ctx);
const applied = (doc: ProjectDocument, p: FamilyFilmPlan) => { const r = applyFilm(doc, p); expect(validateProject(r.doc)).toEqual([]); return r; };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
function clips(n: number, seconds = 12, o: { rate?: Rate; audio?: boolean } = {}): ProjectDocument {
  let doc = project(R30);
  for (let i = 0; i < n; i++) {
    const id = `v${i}`;
    doc.assets[id] = video(id, seconds, { audio: o.audio, rate: o.rate });
    const frames = videoFrames(doc.assets[id]!)!;
    doc = withMoments(doc, id, { windows: [win({ peakFrame: Math.floor(frames / 2), fromFrame: Math.floor(frames / 4), toFrame: Math.floor((3 * frames) / 4), motion: 20 + i, basis: i % 3 === 0 ? ['inner-motion', 'sound'] : ['inner-motion'], level: i % 3 === 0 ? 7 : null })], measured: { picture: true, sound: i % 3 === 0 } });
  }
  return doc;
}
const withSong = (doc: ProjectDocument, bpm = 120, seconds = 200) => {
  doc.assets.mus = song('mus', seconds);
  return withBeats(doc, 'mus', beatTimes(bpm, Math.floor((seconds * bpm) / 60) - 1, { first: 500 }), { bpm });
};
const addClipOf = (p: FamilyFilmPlan, key: string) => p.ops.find((o) => o.op === 'add_clip' && o.bind === key)!.args as Record<string, unknown>;
const leftOut = (p: FamilyFilmPlan) => (p.warnings.find((w) => w.code === 'pearl_left_out')?.details.items ?? []) as { rangeId: string; why: string }[];
const runIdOf = (doc: ProjectDocument) => Object.keys(doc.recipeRuns)[0]!;
const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/**
 * Every kind of plan the existing film tests make (rates, music or none, stills, orders, mixes, a regeneration after a hand delete
 * and after a hand trim), with or without planted ranges (pearls on several files, a presence tag, a whole-file pearl).
 */
function battery(planted: boolean): FamilyFilmPlan[] {
  const plant = (doc: ProjectDocument) => (planted ? withRanges(doc, [
    pearl('rng_1', 'v0', ms(2000), ms(4500)), pearl('rng_2', 'v1', ms(1033), ms(9000)), pearl('rng_3', 'v1', ms(500), ms(800)),
    { id: 'rng_4', assetId: 'v2', kind: 'presence', span: null, label: '', people: ['per_x'], createdBy: 'user:local' },
    pearl('rng_5', 'v3', ms(0), ms(0), { span: null }),
  ]) : doc);
  const out: FamilyFilmPlan[] = [];
  for (const rate of [{ num: 24, den: 1 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }]) {
    const d = clips(6, 12, { rate });
    out.push(plan(plant(d), { assetIds: ids(6), targetSeconds: 30 }));
  }
  for (const order of ['capture', 'given', 'arc'] as const) for (const ownSound of ['under', 'lead', 'mute'] as const) {
    const d = withSong(clips(8, 12), 120, 200);
    d.assets.ph = still('ph');
    out.push(plan(plant(d), { assetIds: [...ids(8), 'ph'], musicAssetId: 'mus', targetSeconds: 60, order, ownSound }, emptyCtx({ v0: '2025-12-16T10:01:00', v1: '2025-12-16T10:00:00' })));
  }
  out.push(plan(plant(withSong(clips(10), 120, 20)), { assetIds: ids(10), musicAssetId: 'mus', targetSeconds: 60 }));
  out.push(plan(plant(clips(12, 12)), { assetIds: ids(12), targetSeconds: 90, picks: { exclude: ['v4'], include: ['v5'], window: { v6: 0 } } }));
  // regenerations: a pick deleted by hand, a pick trimmed by hand
  const d0 = withSong(clips(6, 12), 120, 200);
  const p0 = plan(d0, { assetIds: ids(6), musicAssetId: 'mus', targetSeconds: 30, order: 'given' });
  const doc0 = applyFilm(d0, p0).doc, runId = runIdOf(doc0), slots = doc0.recipeRuns[runId]!.slots!.filter((s) => s.kind === 'picture');
  const del = edit(doc0, [{ op: 'delete_clip', args: { clipId: slots[1]!.clipId } }]);
  out.push(regenerationPlan(plant(del), runId).plan);
  const c = del.sequences[del.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((x) => x.id === slots[3]!.clipId)!;
  const trimmed = edit(del, [{ op: 'trim_clip', args: { clipId: slots[3]!.clipId, edge: 'end', to: T.add(c.start, T.frameTime(30, R30)) } }]);
  out.push(regenerationPlan(plant(trimmed), runId, { targetSeconds: 60 }).plan);
  return out;
}
/** sha256 of the battery's plans (no ranges), taken from the planner as it was before the pearls hook (commit 76f1a1e). */
const GOLDEN = '7912601e2d4ee3ca25d57bddee20c8aafac67622a1905e704e413bfe623cd930';

describe('C14: without picks.pearls nothing about pearls is read', () => {
  it('every plan of the battery equals the plan of the same document with no ranges, and the battery is byte-identical to the planner before the hook', () => {
    const plain = battery(false), planted = battery(true);
    expect(planted.length).toBe(plain.length);
    planted.forEach((p, i) => expect(canonical(p), `plan ${i}`).toBe(canonical(plain[i]!)));
    for (const p of plain) expect(Object.hasOwn(p.params.picks, 'pearls')).toBe(false);
    expect(sha(plain)).toBe(GOLDEN);
  });
  it('the resolved params and the run record carry pearls only when it was sent', () => {
    const d = withRanges(clips(3), [pearl('rng_1', 'v0', ms(2000), ms(3000))]);
    const off = applied(d, plan(d, { assetIds: ids(3), targetSeconds: 30 }));
    expect(JSON.stringify(off.doc.recipeRuns)).not.toContain('pearls');
    const on = plan(d, { assetIds: ids(3), targetSeconds: 30, picks: { pearls: 'prefer' } });
    expect(on.params.picks.pearls).toBe('prefer');
    expect((applied(d, on).doc.recipeRuns[runIdOf(applied(d, on).doc)]!.params.picks as { pearls?: string }).pearls).toBe('prefer');
  });
});

describe('C9: a pearl pick starts at the pearl\'s first frame', () => {
  it('the smallest allowed span of at least the pearl\'s frames, from sourceFrameOfTime(span.start), with mixed rates and a picture that starts late', () => {
    for (const vr of [R30, { num: 30000, den: 1001 }, { num: 25, den: 1 }]) {
      let d = project(R30);
      for (const id of ids(4)) { d.assets[id] = video(id, 12, { rate: vr, ...(id === 'v1' ? { startTime: T.rt(1, 5) } : {}) }); d = withMoments(d, id, { windows: [win({ peakFrame: 150, fromFrame: 90, toFrame: 250 })] }); }
      // a start between frames and an end between frames (a word edge)
      const r = pearl('rng_p', 'v1', ms(3017), ms(5003));
      d = withRanges(d, [r]);
      const p = plan(d, { assetIds: ids(4), targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
      const a = d.assets.v1!;
      const k = p.picks.find((x) => x.assetId === 'v1')!;
      const from = sourceFrameOfTime(a, r.span!.start);
      expect(k, `${vr.num}/${vr.den}`).toMatchObject({ kind: 'pearl', rangeId: 'rng_p', windowIndex: null, sourceInFrame: from, key: filmPearlKey('v1', 'rng_p') });
      expect(k.reasons).toEqual([{ code: 'pearl', rangeId: 'rng_p', fromSecond: 3, toSecond: 5 }]);
      expect(addClipOf(p, k.key).sourceIn).toEqual(sourceTimeOfFrame(a, from));
      // the clip shows the whole pearl (no pearl_cut_short), and its slot is the shortest allowed one that does
      expect(T.lte(r.span!.end, T.add(sourceTimeOfFrame(a, from), T.frameTime(k.frames, R30)))).toBe(true);
      expect(k.frames).toBe(72); // 100 BPM steady grid: 2.4 s and 4.8 s are allowed; the pearl is 1.99 s
      expect(p.warnings.map((w) => w.code)).not.toContain('pearl_cut_short');
      expect(p.basis.some((b) => b.startsWith('pearls: 1 clip(s) show a pearl you marked'))).toBe(true);
      applied(d, p);
    }
  });
  it('a pearl longer than the longest span takes the longest span from its first frame and warns pearl_cut_short with the seconds lost', () => {
    const d = withRanges(clips(3), [pearl('rng_long', 'v1', ms(1000), ms(10000))]);
    const p = plan(d, { assetIds: ids(3), targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
    const k = p.picks.find((x) => x.assetId === 'v1')!;
    expect(k.sourceInFrame).toBe(30);
    expect(k.frames).toBe(144);
    expect(p.warnings.find((w) => w.code === 'pearl_cut_short')!.details).toEqual({ rangeId: 'rng_long', assetId: 'v1', seconds: 4.2 });
    applied(d, p);
  });
  it('too little file after the pearl for the shortest slot: the start moves earlier to the latest start that fits, and the basis says so', () => {
    const d = withRanges(clips(3), [pearl('rng_end', 'v1', ms(11000), ms(11500))]);
    const p = plan(d, { assetIds: ids(3), targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
    const k = p.picks.find((x) => x.assetId === 'v1')!;
    expect(k.sourceInFrame).toBe(360 - k.sourceFrames!);
    expect(k.sourceInFrame!).toBeLessThan(330);
    expect(k.sourceInFrame! + k.sourceFrames!).toBeGreaterThanOrEqual(345);
    expect(p.basis.some((b) => b.includes('"v1.mp4" ends too soon after the pearl you marked'))).toBe(true);
    expect(p.warnings.map((w) => w.code)).not.toContain('pearl_cut_short');
    applied(d, p);
  });
});

describe('C10–C12: pearls are kept, the first of a file goes in, and every other one is named', () => {
  it('the first pearl by span start (then id) is the pick; the file\'s others are one_per_file; presence tags and whole-file pearls are not read', () => {
    const d = withRanges(clips(4), [
      pearl('rng_a', 'v2', ms(6000), ms(7000)), pearl('rng_z', 'v2', ms(2000), ms(3000)), pearl('rng_b', 'v2', ms(2000), ms(2500)),
      { id: 'rng_who', assetId: 'v0', kind: 'presence', span: null, label: '', people: ['per_x'], createdBy: 'user:local' },
      pearl('rng_whole', 'v3', ms(0), ms(0), { span: null }),
    ]);
    const p = plan(d, { assetIds: ids(4), targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
    expect(p.picks.filter((k) => k.kind === 'pearl').map((k) => [k.assetId, k.rangeId])).toEqual([['v2', 'rng_b']]);
    expect(leftOut(p)).toEqual([{ rangeId: 'rng_z', why: 'one_per_file' }, { rangeId: 'rng_a', why: 'one_per_file' }]);
    expect(p.picks.find((k) => k.assetId === 'v0')!.kind).toBe('measured');
    expect(p.picks.find((k) => k.assetId === 'v3')!.kind).toBe('measured');
    // no label anywhere in the plan or in the run record
    expect(JSON.stringify(p)).not.toContain('דינוזאורים');
    expect(JSON.stringify(applied(d, p).doc.recipeRuns)).not.toContain('דינוזאורים');
  });
  it('a pearl is never dropped for room: twelve files in 30 s keep every pearl file; the others give way', () => {
    const d = withRanges(clips(12), [pearl('rng_9', 'v9', ms(2000), ms(3000)), pearl('rng_11', 'v11', ms(4000), ms(5000))]);
    const p = plan(d, { assetIds: ids(12), targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
    expect(p.excluded.some((e) => e.code === 'no_room')).toBe(true);
    expect(p.picks.filter((k) => k.kind === 'pearl').map((k) => k.rangeId)).toEqual(['rng_9', 'rng_11']);
    expect(leftOut(p)).toEqual([]);
    applied(d, p);
  });
  it('why: too_short for a file shorter than every slot, music_end after the music\'s last beat, excluded files name their pearls', () => {
    let d = withSong(clips(14), 120, 20);
    d.assets.tiny = video('tiny', 1);
    d = withRanges(d, [...ids(14).map((id, i) => pearl(`rng_${i}`, id, ms(1000), ms(4500))), pearl('rng_t', 'tiny', ms(100), ms(500))]);
    const p = plan(d, { assetIds: [...ids(14), 'tiny'], musicAssetId: 'mus', targetSeconds: 60, order: 'given', picks: { pearls: 'prefer', exclude: ['v0'] } });
    expect(p.picks.filter((k) => k.kind === 'pearl').length).toBeGreaterThan(0);
    const why = Object.fromEntries(leftOut(p).map((x) => [x.rangeId, x.why]));
    expect(why.rng_t).toBe('too_short');
    expect(Object.values(why)).toContain('music_end');
    expect(p.excluded.find((e) => e.assetId === 'v0')).toEqual({ assetId: 'v0', code: 'excluded_by_you', details: { rangeIds: ['rng_0'] } });
    const inFilm = new Set(p.picks.map((k) => k.rangeId));
    for (const r of Object.keys(d.sourceRanges!)) if (r !== 'rng_0') expect(inFilm.has(r) || r in why, r).toBe(true);
    applied(d, p);
  });
  it('a pearl with sound under music in mix under says pearl_under_music; lead does not', () => {
    const d = withRanges(withSong(clips(4), 120, 200), [pearl('rng_1', 'v1', ms(2000), ms(3000))]);
    const under = plan(d, { assetIds: ids(4), musicAssetId: 'mus', targetSeconds: 30, picks: { pearls: 'prefer' } });
    expect(under.warnings.find((w) => w.code === 'pearl_under_music')!.details).toEqual({ rangeIds: ['rng_1'] });
    const lead = plan(d, { assetIds: ids(4), musicAssetId: 'mus', targetSeconds: 30, ownSound: 'lead', picks: { pearls: 'prefer' } });
    expect(lead.warnings.map((w) => w.code)).not.toContain('pearl_under_music');
    applied(d, under);
  });
  it('arc and capture orders take a pearl file by its file values; planning twice gives equal plans', () => {
    const d = withRanges(withSong(clips(6), 120, 200), [pearl('rng_1', 'v1', ms(2000), ms(3000)), pearl('rng_2', 'v4', ms(500), ms(1500))]);
    for (const order of ['arc', 'capture'] as const) {
      const a = plan(d, { assetIds: ids(6), musicAssetId: 'mus', targetSeconds: 30, order, picks: { pearls: 'prefer' } });
      expect(canonical(plan(d, { assetIds: ids(6), musicAssetId: 'mus', targetSeconds: 30, order, picks: { pearls: 'prefer' } }))).toBe(canonical(a));
      expect(a.picks.filter((k) => k.kind === 'pearl').map((k) => k.rangeId).sort()).toEqual(['rng_1', 'rng_2']);
      applied(d, a);
    }
  });
});

describe('C13: a pearl pick deleted by hand', () => {
  const film = () => {
    const d0 = withRanges(withSong(clips(4), 120, 200), [pearl('rng_first', 'v1', ms(1000), ms(2000)), pearl('rng_next', 'v1', ms(6000), ms(7000)), pearl('rng_only', 'v2', ms(3000), ms(4000))]);
    const p = plan(d0, { assetIds: ids(4), musicAssetId: 'mus', targetSeconds: 30, order: 'given', picks: { pearls: 'prefer' } });
    const doc = applied(d0, p).doc, runId = runIdOf(doc);
    const clipOf = (rangeId: string) => doc.recipeRuns[runId]!.slots!.find((s) => s.key === p.picks.find((k) => k.rangeId === rangeId)!.key)!.clipId;
    return { doc, runId, p, clipOf };
  };
  it('leaves out that pearl only: its file gives its next pearl; the run record carries the rangeId; restoreRemoved brings it back', () => {
    const { doc, runId, clipOf } = film();
    expect((doc.recipeRuns[runId]!.params.picked as { rangeId?: string }[]).filter((k) => k.rangeId).map((k) => k.rangeId)).toEqual(['rng_first', 'rng_only']);
    const r = regenerateFilm(edit(doc, [{ op: 'delete_clip', args: { clipId: clipOf('rng_first') } }]), runId);
    expect(validateProject(r.applied.doc)).toEqual([]);
    expect(r.plan.picks.filter((k) => k.assetId === 'v1').map((k) => k.rangeId)).toEqual(['rng_next']);
    expect(r.plan.excluded.filter((e) => e.assetId === 'v1')).toEqual([]);
    const w = r.plan.warnings.find((x) => x.code === 'removed_by_hand')!;
    expect(w.details.items).toEqual([]);
    expect(w.details.pearls).toEqual([{ rangeId: 'rng_first', assetId: 'v1', name: 'v1.mp4' }]);
    expect(w.message).toContain('a pearl you marked in "v1.mp4"');
    expect(leftOut(r.plan)).toEqual([]);
    expect((r.applied.doc.recipeRuns[runId]!.params.removedPicks as { rangeId?: string }[]).map((x) => x.rangeId)).toEqual(['rng_first']);
    const again = regenerateFilm(r.applied.doc, runId, { targetSeconds: 60 }, 'again_');
    expect(again.plan.picks.map((k) => k.rangeId)).not.toContain('rng_first');
    const back = regenerateFilm(again.applied.doc, runId, { targetSeconds: 30 }, 'back_', true);
    expect(back.plan.picks.filter((k) => k.assetId === 'v1').map((k) => k.rangeId)).toEqual(['rng_first']);
    expect(leftOut(back.plan)).toEqual([{ rangeId: 'rng_next', why: 'one_per_file' }]);
  });
  it('the file\'s only pearl deleted: the file stays in with its measured window, as a file without pearls', () => {
    const { doc, runId, clipOf } = film();
    const r = regenerateFilm(edit(doc, [{ op: 'delete_clip', args: { clipId: clipOf('rng_only') } }]), runId);
    const v2 = r.plan.picks.filter((k) => k.assetId === 'v2');
    expect(v2.length).toBe(1);
    expect(v2[0]!.kind).toBe('measured');
    expect(r.plan.excluded.filter((e) => e.assetId === 'v2')).toEqual([]);
  });
  it('a range no longer in the document leaves nothing out', () => {
    const { doc, runId, clipOf } = film();
    const del = edit(doc, [{ op: 'delete_clip', args: { clipId: clipOf('rng_first') } }]);
    const { rng_first: _gone, ...rest } = del.sourceRanges!;
    const r = regenerateFilm({ ...del, sourceRanges: rest }, runId);
    expect(r.plan.picks.filter((k) => k.assetId === 'v1').map((k) => k.rangeId)).toEqual(['rng_next']);
    expect(r.plan.warnings.find((x) => x.code === 'removed_by_hand')!.details.pearls).toBeUndefined();
    expect(r.plan.excluded.filter((e) => e.assetId === 'v1')).toEqual([]);
  });
  it('a pearl clip trimmed by hand is kept; its file\'s other pearls are kept_by_hand; the kept one is not named', () => {
    const { doc, runId, clipOf } = film();
    const id = clipOf('rng_first');
    const c = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((x) => x.id === id)!;
    const r = regenerateFilm(edit(doc, [{ op: 'trim_clip', args: { clipId: id, edge: 'end', to: T.add(c.start, T.frameTime(40, R30)) } }]), runId);
    expect(validateProject(r.applied.doc)).toEqual([]);
    expect(r.plan.excluded.find((e) => e.assetId === 'v1')!.code).toBe('kept_by_hand');
    expect(leftOut(r.plan)).toEqual([{ rangeId: 'rng_next', why: 'kept_by_hand' }]);
  });
});

const actual = await vi.importActual<typeof SR>('./sourceRanges.ts');
const aBuilt = (() => { try { actual.filmWindowOfRange({ kind: 'image', duration: T.ZERO }, pearl('r', 'a', T.ZERO, T.ZERO, { span: null })); return true; } catch { return false; } })();
describe('the window test double', () => {
  it.skipIf(!aBuilt)('agrees with core filmWindowOfRange once builder A has built it (skipped while that throws SourceRangesNotBuilt)', () => {
    const double = (SR as unknown as { __double: typeof SR.filmWindowOfRange }).__double;
    for (const vr of [R30, { num: 30000, den: 1001 }, { num: 25, den: 1 }]) for (const st of [undefined, T.rt(1, 5)]) {
      const a = video('v', 12, { rate: vr, ...(st ? { startTime: st } : {}) });
      for (const [s, e] of [[0, 1000], [3017, 5003], [1000, 10000], [11000, 11999]] as const) {
        const r = pearl('r', 'v', ms(s), ms(e));
        expect(actual.filmWindowOfRange(a, r)).toEqual(double(a, r));
      }
    }
  });
  it('is used only while core filmWindowOfRange is not built', () => { expect(windowDouble.used > 0).toBe(!aBuilt); });
});
