/**
 * Lead contracts of the family film (ADR-0026): the moments record in the document (schema, validation, the internal op
 * attach_moments with its refusals and exact undo, the document budget), the one frame-to-time conversion, the reasons a clip
 * states, the recipe row and the template planner's exported grid helpers. The planner's own behaviour is W1's
 * (familyFilm.test.ts); nothing here pins the stubs.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  AnalysisSchema, applyTransaction, createProject, creativeProjection, describeRecipes, diffEntities, FAMILY_FILM_RECIPE_ID, FamilyFilmParamsSchema, FILM_FORBIDDEN_WORDS, FILM_PICK_KEY, FILM_REASON_CODES, FILM_WARNING_CODES,
  filmMix, filmReasonsFor, filmRunParams, filmRunPicked, hopOfBucket, listGrid, MOMENTS_ALGO, MOMENTS_GATES, MOMENTS_METHOD, MOMENTS_RECORD_BUDGET_BYTES, MOMENTS_REFUSALS, momentsCacheState, momentsExpectedSamples, momentsStep,
  OpError, placedMusicGrid, planRecipe, RecipeError, restoreEntities, sourceFrameOfTime, sourceTimeOfFrame, steadyGrid, TemplateError, validateProject,
  type Asset, type MomentsItem, type MomentWindow, type ProjectDocument,
} from './index.ts';

const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = (id: string, frames: number, opts: { startTime?: T.RationalTime; image?: boolean } = {}): Asset => ({
  id, kind: 'video', name: `${id}.mp4`, contentHash: `sha256:${id.charCodeAt(id.length - 1).toString(16).padStart(2, '0').repeat(32)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4',
  duration: T.frameTime(frames, { num: 30, den: 1 }), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: frames, ...(opts.startTime ? { startTime: opts.startTime } : {}) },
  audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov,
} as Asset);
const still = (id: string): Asset => ({ id, kind: 'image', name: `${id}.png`, contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Asset);
const sound = (id: string): Asset => ({ id, kind: 'audio', name: `${id}.wav`, contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Asset);
function doc(): ProjectDocument {
  const d = createProject({ id: 'prj_ff', name: 'FF', width: 640, height: 360, frameRate: { num: 30, den: 1 } });
  d.assets.v1 = video('v1', 360);
  d.assets.v2 = video('v2', 300, { startTime: T.rt(1, 10) });
  d.assets.img = still('img');
  d.assets.snd = sound('snd');
  return d;
}
const win = (o: Partial<MomentWindow> = {}): MomentWindow => ({ peakFrame: 150, fromFrame: 90, toFrame: 240, basis: ['inner-motion', 'sound'], motion: 62, level: 9.4, sharp: 1.32, luma: 128, burstFrame: 156, ...o });
const item = (assetId: string, o: Partial<MomentsItem> = {}): MomentsItem => ({ assetId, algo: MOMENTS_ALGO, data: `sha256:${'a'.repeat(64)}`, measured: { picture: true, sound: true }, file: { motion: 12, level: -284 }, flat: false, windows: [win()], ...o });
let seed = 0;
const attach = (d: ProjectDocument, items: unknown[]) => applyTransaction(d, [{ op: 'attach_moments', args: { method: MOMENTS_METHOD, createdAt: '2026-11-18T10:00:00Z', items } }], { idSeed: `mo${seed++}_`, actor: 'server:moments', allowInternal: true });
const refused = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

describe('the one conversion from a source frame to source time', () => {
  it('counts the picture start offset of a file whose picture starts late, and the inverse floors', () => {
    const d = doc();
    expect(sourceTimeOfFrame(d.assets.v1!, 30)).toEqual(T.frameTime(30, { num: 30, den: 1 }));
    // 0.1 s late = 3 frames at 30 fps: frame 30 is shown at 33/30 s
    expect(T.eq(sourceTimeOfFrame(d.assets.v2!, 30), T.rt(33, 30))).toBe(true);
    expect(sourceFrameOfTime(d.assets.v2!, T.rt(33, 30))).toBe(30);
    expect(sourceFrameOfTime(d.assets.v2!, T.ZERO)).toBe(0);
    expect(() => sourceTimeOfFrame(d.assets.img!, 0)).toThrow(RangeError);
    expect(() => sourceTimeOfFrame(d.assets.v1!, -1)).toThrow(RangeError);
  });
  it('sampling and hop rules of the measurement are exact integers', () => {
    expect(momentsStep({ num: 30, den: 1 })).toBe(6);
    expect(momentsStep({ num: 30000, den: 1001 })).toBe(6);
    expect(momentsStep({ num: 1, den: 1 })).toBe(1);
    expect(momentsExpectedSamples(360, 54000, 6)).toBe(60);
    expect(momentsExpectedSamples(361, 54000, 6)).toBe(61);
    expect(momentsExpectedSamples(100000, 54000, 6)).toBe(9000);
    // 4800 samples per hop = 18.75 buckets: bucket 18 straddles hops 0 and 1 and belongs to hop 0
    expect([0, 18, 19, 37, 38].map(hopOfBucket)).toEqual([0, 0, 1, 1, 2]);
    expect(MOMENTS_GATES.shiftSearch).toBe(12);
  });
  it('a cached data file is a hit, needs only its sound, or is measured again', () => {
    expect(momentsCacheState(null, true)).toBe('miss');
    expect(momentsCacheState({ algo: 2 as never, picture: 'proxy', sound: true }, true)).toBe('miss');
    expect(momentsCacheState({ algo: 1, picture: 'proxy', sound: true }, true)).toBe('hit');
    expect(momentsCacheState({ algo: 1, picture: 'proxy', sound: false }, false)).toBe('hit');
    expect(momentsCacheState({ algo: 1, picture: 'proxy', sound: false }, true)).toBe('add-sound');
  });
});

describe('attach_moments: one measurement is one revision and one undo', () => {
  it('attaches several files in one op, keeps their beat analysis, and undo restores the document exactly', () => {
    const d = doc();
    d.analyses.v1 = { assetId: 'v1', scenes: { origin: { method: 'm', params: {}, createdAt: 'x', createdBy: 'y', edited: false }, cuts: [T.rt(1, 1)] } };
    const r = attach(d, [item('v1'), item('v2', { flat: true, windows: [], file: { motion: 40, level: null }, measured: { picture: true, sound: false } })]);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.output).toEqual({ assetIds: ['v1', 'v2'] });
    expect(r.affectedIds.sort()).toEqual(['analysis:v1', 'analysis:v2']);
    const m = r.doc.analyses.v1!.moments!;
    expect(r.doc.analyses.v1!.scenes!.cuts).toHaveLength(1);
    expect(m.origin).toEqual({ method: MOMENTS_METHOD, params: { algo: 1 }, createdAt: '2026-11-18T10:00:00Z', createdBy: 'server:moments', edited: false });
    expect(AnalysisSchema.safeParse(r.doc.analyses.v1).success).toBe(true);
    expect(validateProject(r.doc)).toEqual([]);
    // undo through entity states, as the store does
    const changes = diffEntities(d, r.doc);
    const back = structuredClone(r.doc);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(creativeProjection(back)).toBe(creativeProjection(d));
    // a second measurement replaces the first record whole
    const again = attach(r.doc, [item('v1', { windows: [win({ peakFrame: 20, fromFrame: 0, toFrame: 60, burstFrame: undefined })] })]);
    expect(again.doc.analyses.v1!.moments!.windows).toHaveLength(1);
    expect(again.doc.analyses.v1!.moments!.windows[0]!.peakFrame).toBe(20);
  });
  it('a full record (4 windows, both bases, a burst) fits the document budget', () => {
    const r = attach(doc(), [item('v1', { windows: [0, 1, 2, 3].map((i) => win({ peakFrame: 30 + 80 * i, fromFrame: 10 + 80 * i, toFrame: 80 + 80 * i, burstFrame: 31 + 80 * i, motion: 999, level: -59.9, sharp: 9.99, luma: 255 })), truncated: true })]);
    const bytes = Buffer.byteLength(JSON.stringify(r.doc.analyses.v1!.moments));
    expect(bytes).toBeLessThanOrEqual(MOMENTS_RECORD_BUDGET_BYTES);
  });
  it('refuses each case with its fixed sentence, and nothing is attached', () => {
    const d = doc();
    expect(refused(() => attach(d, [item('nope')])).message).toBe(MOMENTS_REFUSALS.assetMissing.message('nope'));
    expect(refused(() => attach(d, [item('__proto__')])).code).toBe('not_found');
    expect(refused(() => attach(d, [item('img')])).message).toBe(MOMENTS_REFUSALS.noVideo.message('img'));
    expect(refused(() => attach(d, [item('snd')])).message).toBe(MOMENTS_REFUSALS.noVideo.message('snd'));
    expect(refused(() => attach(d, [item('v1'), item('v1')])).message).toBe(MOMENTS_REFUSALS.twice.message('v1'));
    const outside = refused(() => attach(d, [item('v1', { windows: [win({ toFrame: 361 })] })]));
    expect(outside.code).toBe('out_of_bounds');
    expect(outside.message).toMatch(/^the moments of asset v1 do not fit the file: window 0 must keep fromFrame <= peakFrame < toFrame <= 360/);
    expect(refused(() => attach(d, [item('v1', { windows: [win({ peakFrame: 240 })] })])).code).toBe('out_of_bounds');
    expect(refused(() => attach(d, [item('v1', { windows: [win({ burstFrame: 300 })] })])).message).toMatch(/burst must lie inside the window/);
    expect(refused(() => attach(d, [item('v1', { measured: { picture: true, sound: false } })])).message).toMatch(/sound that was not measured/);
    expect(refused(() => attach(d, [item('v1', { flat: true })])).message).toMatch(/flat record holds no window/);
    expect(refused(() => applyTransaction(d, [{ op: 'attach_moments', args: { method: 'x', createdAt: 'y', items: [item('v1')] } }], { idSeed: 'x', actor: 'agent' })).code).toBe('forbidden_op');
  });
  it('validateProject flags a stored record that does not fit its file (analysis_moments)', () => {
    const d = attach(doc(), [item('v1')]).doc;
    d.analyses.v1!.moments!.windows[0]!.toFrame = 999;
    expect(validateProject(d).map((i) => i.code)).toContain('analysis_moments');
  });
});

describe('reasons a clip states (filmReasonsFor): measured values only, at most three', () => {
  const d = doc();
  const rec = { algo: MOMENTS_ALGO, flat: false, file: { motion: 12, level: -284 }, windows: [win()] };
  it('names the moment, the burst, sharpness, in seconds of the file', () => {
    const r = filmReasonsFor(d.assets.v1!, rec, 102, 120);
    expect(r.map((x) => x.code)).toEqual(['inner_motion', 'sound_burst', 'sharp']);
    expect(r[0]).toMatchObject({ fromSecond: 3.5, toSecond: 6.5, value: 62, unit: 'permille' });
    expect(r[1]).toEqual({ code: 'sound_burst', fromSecond: 5.2 });
  });
  it('counts the late picture start in its seconds', () => {
    expect(filmReasonsFor(d.assets.v2!, { ...rec, windows: [win({ toFrame: 240 })] }, 102, 120)[1]).toEqual({ code: 'sound_burst', fromSecond: 5.3 });
  });
  it('a clip reading outside the clean stretch says so; chosen windows come first; never more than three', () => {
    const r = filmReasonsFor(d.assets.v1!, rec, 60, 200, { chosenByYou: true });
    expect(r.map((x) => x.code)).toEqual(['chosen_by_you', 'inner_motion', 'sound_burst']);
    expect(filmReasonsFor(d.assets.v1!, { ...rec, windows: [win({ burstFrame: undefined, sharp: 1, motion: 3 })] }, 60, 200).map((x) => x.code)).toEqual(['loud_sound', 'past_clean_stretch']);
  });
  it('unmeasured, flat, active throughout, a still, and a clip that shows none of the moments', () => {
    expect(filmReasonsFor(d.assets.img!, null, 0, 0)).toEqual([{ code: 'still' }]);
    expect(filmReasonsFor(d.assets.v1!, null, 120, 120).map((x) => x.code)).toEqual(['not_measured', 'default_middle']);
    expect(filmReasonsFor(d.assets.v1!, null, 0, 360).map((x) => x.code)).toEqual(['not_measured', 'whole_clip']);
    expect(filmReasonsFor(d.assets.v1!, { ...rec, flat: true, windows: [] }, 120, 120).map((x) => x.code)).toEqual(['no_clear_moment', 'default_middle']);
    expect(filmReasonsFor(d.assets.v1!, { ...rec, flat: true, windows: [], file: { motion: 40, level: null } }, 7, 120)).toEqual([{ code: 'active_throughout', value: 40, unit: 'permille' }]);
    expect(filmReasonsFor(d.assets.v1!, { ...rec, algo: 99 }, 120, 120)[0]!.code).toBe('not_measured');
    expect(filmReasonsFor(d.assets.v1!, rec, 300, 60)).toEqual([]);
  });
  it('a window whose values lie under the wording thresholds (a quiet file) still states its measured moment, never nothing', () => {
    // z is centred on the file's 20th percentile, so a quiet file has real windows with motion < 15 permille and level < 6 dB
    const quiet = { algo: MOMENTS_ALGO, flat: false, file: { motion: 4, level: -300 }, windows: [win({ motion: 11, level: 4.2, sharp: 1.05, burstFrame: undefined })] };
    expect(filmReasonsFor(d.assets.v1!, quiet, 102, 120)).toEqual([{ code: 'measured_moment', fromSecond: 3.5, toSecond: 6.5 }]);
    expect(filmReasonsFor(d.assets.v1!, quiet, 60, 200, { chosenByYou: true }).map((x) => x.code)).toEqual(['chosen_by_you', 'measured_moment', 'past_clean_stretch']);
    // a moment that is said keeps its own wording, without measured_moment
    expect(filmReasonsFor(d.assets.v1!, { ...quiet, windows: [win({ motion: 11, level: 4.2, sharp: 1.05 })] }, 102, 120).map((x) => x.code)).toEqual(['sound_burst']);
  });
});

describe('the mix a film sounds with (filmMix): what regeneration compares, not the parameter alone', () => {
  it('under lowers the clips only under music; lead ducks only music; mute and no music change nothing', () => {
    expect(filmMix('under', true)).toEqual({ ownGain: 0.25, duckDb: null });
    expect(filmMix('under', false)).toEqual({ ownGain: 1, duckDb: null });
    expect(filmMix('lead', true)).toEqual({ ownGain: 1, duckDb: 9 });
    expect(filmMix('lead', false)).toEqual({ ownGain: 1, duckDb: null });
    expect(filmMix('mute', true)).toEqual({ ownGain: 1, duckDb: null });
    // the same ownSound with music added on regeneration is a different mix, so the reused own-sound track is set again
    expect(filmMix('under', true)).not.toEqual(filmMix('under', false));
  });
});

describe('the family film params, codes and recipe row', () => {
  it('the params schema takes include, refuses unknown keys, and the run record is stripped before parsing', () => {
    expect(FamilyFilmParamsSchema.safeParse({ assetIds: ['a'], picks: { include: ['b'], exclude: ['c'], window: { a: 1 } } }).success).toBe(true);
    expect(FamilyFilmParamsSchema.safeParse({ assetIds: ['a'], picked: [] }).success).toBe(false);
    expect(FamilyFilmParamsSchema.safeParse({ assetIds: ['a'], targetSeconds: 45 }).success).toBe(false);
    const run = { assetIds: ['a'], targetSeconds: 30, picked: [{ key: 'm0123456789ab', assetId: 'a', kind: 'still', windowIndex: null, reasons: [{ code: 'still' }] }, 'junk'], templateVersion: 1 };
    expect(FamilyFilmParamsSchema.safeParse(filmRunParams(run)).success).toBe(true);
    expect(filmRunPicked(run)).toHaveLength(1);
    expect(filmRunPicked({})).toEqual([]);
    expect('m0123456789ab').toMatch(FILM_PICK_KEY);
  });
  it('codes carry no forbidden words; the verifier\'s additions are there', () => {
    for (const c of [...FILM_REASON_CODES, ...FILM_WARNING_CODES]) expect(c).not.toMatch(FILM_FORBIDDEN_WORDS);
    expect(FILM_REASON_CODES).toContain('active_throughout');
    expect(FILM_WARNING_CODES).toContain('longer_than_target');
    expect(FILM_REASON_CODES).not.toContain('steady_camera' as never);
  });
  it('is listed as a recipe with its parameter schema, and planRecipe sends it to its own planner', () => {
    const row = describeRecipes().find((r) => r.id === FAMILY_FILM_RECIPE_ID)!;
    expect(row.name).toEqual({ he: 'סרט משפחתי בלחיצה', en: 'Family film in one click' });
    expect(row.regenerable).toBe(true);
    expect(row.aiInput).toBeNull();
    expect((row.paramsSchema as { type?: string }).type).toBe('object');
    expect(row.description).not.toMatch(FILM_FORBIDDEN_WORDS);
    let e: unknown;
    try { planRecipe(doc(), FAMILY_FILM_RECIPE_ID, { assetIds: ['v1'] }); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(RecipeError);
    expect((e as RecipeError).message).toMatch(/planned by planFamilyFilm/);
  });
});

describe('the template grid helpers the film reuses (exported, unchanged)', () => {
  it('placedMusicGrid maps the music\'s beats onto the timeline exactly and refuses what templates refuse', () => {
    const d = doc();
    d.analyses.snd = { assetId: 'snd', beats: { origin: { method: 'm', params: {}, createdAt: 'x', createdBy: 'y', edited: false }, bpm: 120, confidence: 0.9, beats: [T.rt(1, 4), T.rt(3, 4), T.rt(5, 4), T.rt(7, 4)], downbeats: [T.rt(3, 4)], meter: 4 } };
    const m = placedMusicGrid(d, 'snd', T.rt(2, 1), 'first-downbeat', true);
    expect(T.eq(m.sourceIn, T.rt(3, 4))).toBe(true);
    expect(T.eq(m.grid.beatAfter(T.rt(2, 1), 1)!, T.rt(5, 2))).toBe(true);
    expect(m.beatCount).toBe(3);
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as TemplateError).code; } return 'none'; };
    expect(code(() => placedMusicGrid(d, 'nope', T.ZERO, 'zero', false))).toBe('not_found');
    expect(code(() => placedMusicGrid(d, 'v1', T.ZERO, 'zero', false))).toBe('invalid_args');
    expect(code(() => placedMusicGrid(doc(), 'snd', T.ZERO, 'zero', false))).toBe('needs_analysis');
    const g = listGrid([T.rt(1, 1), T.rt(2, 1)], null, 4);
    expect(g.last).toEqual(T.rt(2, 1));
    expect(T.eq(steadyGrid(T.ZERO, 100).beatAfter(T.ZERO, 1)!, T.rt(3, 5))).toBe(true);
  });
});
