/**
 * The story planner (W1; story.ts): every plan here is applied through the REAL internal op apply_template in one transaction (which
 * runs validateProject). Documents come from the film's labelled test builders (familyFilm.testDouble.ts); the voice measure comes
 * from voiceActivity on synthetic peaks of the proof's narration table (labelled test data). Regeneration is tested on the server
 * (apps/server/src/storyRegeneration.test.ts), which owns it.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, clipEnd, findClip, flashGapFrames, STORY, STORY_BINDS, STORY_DRAFT_LABEL, STORY_FORBIDDEN_WORDS, STORY_REFUSALS, STORY_TEMPLATE_ID, STORY_VERSION, StoryError, storyRunPicked, storyRunRecordParams, validateProject, VOICE_RATE,
  type ProjectDocument, type StoryPlan, type StoryPlanContext, type VoiceMeasure,
} from './index.ts';
import { planStory, STORY_PLANNER_BUILT, storyLiveDocument } from './story.ts';
import { voiceActivity } from './voiceActivity.ts';
import { project, R30, song, still, video, withMoments, win, type Rate } from './familyFilm.testDouble.ts';

const R25: Rate = { num: 25, den: 1 }, R2997: Rate = { num: 30000, den: 1001 };
const pending: StoryPlanContext = { voice: null, voiceState: 'pending', capture: {}, title: null };
const measured = (voice: VoiceMeasure): StoryPlanContext => ({ voice, voiceState: 'measured', capture: {}, title: null });
/** The proof's narration table as waveform peaks (labelled test data). */
function narrationVoice(): VoiceMeasure {
  const bursts = [[0.5, 3.0], [4.5, 7.0], [8.2, 13.0], [15.0, 18.0], [18.3, 23.5]];
  const total = 24 * VOICE_RATE, buckets = total / 256, peaks = new Int16Array(2 * buckets);
  for (let b = 0; b < buckets; b++) {
    const from = b * 256, to = from + 256;
    const v = bursts.some(([s, e]) => s! * VOICE_RATE < to && from < e! * VOICE_RATE) ? 12_000 : 30 + (b % 7);
    peaks[2 * b] = -v; peaks[2 * b + 1] = v;
  }
  return voiceActivity(peaks, total);
}
/** A project with the 24 s narration 'nar', six stills s0..s5 and anything `more` adds. */
function story(rate: Rate = R30, more: (d: ProjectDocument) => void = () => {}): ProjectDocument {
  const d = project(rate);
  d.assets.nar = song('nar', 24);
  for (let i = 0; i < 6; i++) d.assets[`s${i}`] = still(`s${i}`);
  more(d);
  return d;
}
const stills = ['s0', 's1', 's2', 's3', 's4', 's5'];
const texts: string[] = [];
const plan = (doc: ProjectDocument, params: Record<string, unknown>, ctx: StoryPlanContext = pending) => {
  const p = planStory(doc, { narrationAssetId: 'nar', assetIds: stills, ...params }, ctx);
  texts.push(...p.steps, ...p.basis, ...p.warnings.map((w) => w.message), ...p.alternatives.map((a) => a.label));
  return p;
};
const apply = (doc: ProjectDocument, p: StoryPlan, seed = 'st_') => {
  const r = applyTransaction(doc, [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(p, []), steps: p.steps, ops: p.ops, slots: p.slots, recordRanges: true } }], { idSeed: seed, actor: 'test', allowInternal: true });
  expect(validateProject(r.doc)).toEqual([]);
  return r.doc;
};
/** The pictures of the only run as [start, end) frames, in time order. */
const pictures = (doc: ProjectDocument) => {
  const run = Object.values(doc.recipeRuns)[0]!;
  return (run.slots ?? []).filter((s) => s.kind === 'picture').map((s) => {
    const c = findClip(doc, s.clipId)!.clip;
    return { key: s.key, s: T.nearestFrameIndex(c.start, doc.settings.frameRate), e: T.nearestFrameIndex(clipEnd(c), doc.settings.frameRate), assetId: c.type === 'media' ? c.assetId : '' };
  }).sort((a, b) => a.s - b.s);
};
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof StoryError) return `${e.code}: ${e.message}`; throw e; } return 'none'; };

describe('story planner: refusals', () => {
  it('is built; refuses a missing, non-sound or too long narration, nothing to show and bad parameters with the table\'s sentences', () => {
    expect(STORY_PLANNER_BUILT).toBe(true);
    const d = story();
    d.assets.long = song('long', 20 * 60 + 1);
    expect(code(() => plan(d, { narrationAssetId: 'ghost' }))).toBe(`not_found: ${STORY_REFUSALS.narrationMissing.message()}`);
    expect(code(() => plan(d, { narrationAssetId: 's0' }))).toBe(`incompatible: ${STORY_REFUSALS.narrationNotSound.message()}`);
    expect(code(() => plan(d, { narrationAssetId: 'long' }))).toBe(`out_of_bounds: ${STORY_REFUSALS.narrationTooLong.message()}`);
    expect(code(() => plan(d, { assetIds: ['nar', 'ghost'] }))).toBe(`nothing_to_do: ${STORY_REFUSALS.nothingToShow.message()}`);
    expect(code(() => plan(d, { assetIds: [] }))).toMatch(/^invalid_args: the story parameters are not valid: assetIds: /);
    expect(code(() => plan(d, { cutsMs: [1.5] }))).toMatch(/^invalid_args: the story parameters are not valid: cutsMs/);
    expect(code(() => plan(d, { at: T.rt(1, 7) }))).toMatch(/^invalid_args: the story parameters are not valid: at: /);
    expect(code(() => plan(d, { musicAssetId: 's1' }))).toMatch(/^invalid_args: .*musicAssetId/);
  });
});

describe('story planner: cuts from taps (S3)', () => {
  for (const rate of [R25, R2997, R30]) it(`five taps, six pictures at ${rate.num}/${rate.den} fps: each picture starts on its tap's own frame; lengths add up exactly`, () => {
    const d = story(rate);
    const taps = [3100, 7450, 11_999, 15_033, 19_250];
    const p = plan(d, { cutsMs: taps, at: T.frameTime(10, rate) });
    expect(p.chips.every((c) => c.state === 'kept')).toBe(true);
    const doc = apply(d, p);
    const pics = pictures(doc);
    const S = 10, E = 10 + T.frameCount(T.fromSeconds(24), rate);
    expect(pics.map((x) => x.assetId)).toEqual(stills);
    expect(pics[0]!.s).toBe(S);
    // independently: the frame nearest (start + tap) for each tap
    for (const [i, ms] of taps.entries()) expect(pics[i + 1]!.s).toBe(T.nearestFrameIndex(T.add(T.frameTime(S, rate), T.rt(ms, 1000)), rate));
    expect(pics.at(-1)!.e).toBe(E);
    for (let i = 1; i < pics.length; i++) expect(pics[i]!.s).toBe(pics[i - 1]!.e);
    expect(pics.reduce((n, x) => n + (x.e - x.s), 0)).toBe(E - S);
    const run = Object.values(doc.recipeRuns)[0]!;
    expect(storyRunPicked(run.params)).toEqual(p.picks.map((k) => ({ key: k.key, assetId: k.assetId, cutMs: k.cutMs, how: k.how })));
    expect(storyRunPicked(run.params).map((k) => [k.how, k.cutMs])).toEqual([['first', null], ...taps.map((t) => ['tap', t])]);
    expect(p.predicted).toMatchObject({ startFrame: S, endFrame: E, tapCuts: 5, pauseCuts: 0, evenCuts: 0, gapFrames: 0 });
  });
  it('the narration is placed whole with an explicit length; the music is fitted to the end plus the tail and ducked 12 dB under the voice track', () => {
    const d = story(R30, (x) => { x.assets.mus = song('mus', 60); });
    const p = plan(d, { cutsMs: [5000], musicAssetId: 'mus' });
    const nar = p.ops.find((o) => o.bind === STORY_BINDS.narration)!;
    expect(nar.args).toMatchObject({ assetId: 'nar', duration: T.frameTime(720, R30), sourceIn: T.ZERO, withLinkedAudio: false });
    expect(p.slots.find((s) => s.key === STORY_BINDS.narration)!.kind).toBe('sound');
    const fit = p.ops.find((o) => o.op === 'fit_music')!;
    expect((fit.args as { to: T.RationalTime }).to).toEqual(T.frameTime(720 + 15, R30));
    expect(p.ops.find((o) => o.op === 'set_ducking')!.args).toMatchObject({ reductionDb: STORY.duckDb, attackMs: STORY.duckAttackMs, releaseMs: STORY.duckReleaseMs });
    const doc = apply(d, p);
    const tracks = doc.sequences[doc.mainSequenceId]!.tracks;
    const music = tracks.find((t) => t.clips.some((c) => c.type === 'media' && c.assetId === 'mus'))!;
    const voiceTrack = tracks.find((t) => t.clips.some((c) => c.type === 'media' && c.assetId === 'nar'))!;
    expect(music.audio?.duck).toMatchObject({ sourceTrackIds: [voiceTrack.id], reductionDb: 12, attackMs: 200, releaseMs: 800 });
    const mc = music.clips[0]!;
    expect(T.nearestFrameIndex(clipEnd(mc), R30)).toBe(735);
    expect(p.warnings.map((w) => w.code)).not.toContain('music_short');
    // a short music file is said before building, in seconds
    d.assets.short = song('short', 10);
    const s = plan(d, { musicAssetId: 'short' });
    expect(s.warnings.find((w) => w.code === 'music_short')!.details).toMatchObject({ seconds: 14.5 });
    apply(d, s);
  });
  it('the videos\' own sound sits 12 dB under the narration on its own track, with fades; ownSound mute leaves it out', () => {
    const d = story(R30, (x) => { x.assets.v0 = video('v0', 30); });
    const p = plan(d, { assetIds: ['v0', 's1'], cutsMs: [8000] });
    expect(p.picks[0]!.ownSound).toBe(true);
    expect(p.ops.find((o) => o.op === 'set_track_audio')!.args).toMatchObject({ gain: STORY.ownGainUnder });
    expect(p.ops.filter((o) => o.op === 'set_clip_fades')).toHaveLength(1);
    expect(p.basis.join(' ')).toMatch(/whether or not there is music/);
    const doc = apply(d, p);
    const own = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'audio' && t.audio?.gain === STORY.ownGainUnder)!;
    expect(own.clips).toHaveLength(1);
    const m = plan(d, { assetIds: ['v0', 's1'], cutsMs: [8000], ownSound: 'mute' });
    expect(m.picks[0]!.ownSound).toBe(false);
    expect(m.ops.some((o) => o.op === 'set_track_audio' || o.op === 'set_clip_fades')).toBe(false);
  });
  it('stills get Ken Burns and the title sits over the first pictures (motion full); reduced motion leaves both still', () => {
    const d = story();
    const p = plan(d, { cutsMs: [1000, 5000] });
    expect(p.ops.filter((o) => o.op === 'apply_motion_preset')).toHaveLength(6);
    const title = p.ops.find((o) => o.op === 'add_text')!;
    expect(title.args).toMatchObject({ text: 'הסיפור שלנו', start: T.ZERO, duration: T.frameTime(150, R30) });
    expect(p.ops.some((o) => o.op === 'set_text_animation')).toBe(true);
    expect(p.warnings.map((w) => w.code)).toContain('title_resolved_static');
    apply(d, p);
    const n = plan(d, { cutsMs: [1000, 5000], motion: 'none', openingTitle: false, lang: 'en' });
    expect(n.ops.some((o) => ['apply_motion_preset', 'add_text', 'set_text_animation'].includes(o.op))).toBe(false);
  });
});

describe('story planner: held taps (S6)', () => {
  it('too_close, no_picture_left, outside_narration and kept_by_hand are held with their reasons; no two cuts closer than the gap', () => {
    const d = story();
    const gap = flashGapFrames(30);
    // 0 ms: at the start (too close); 2000 and 2100: the second too close; 30000: after the narration ends
    const p = plan(d, { assetIds: ['s0', 's1', 's2'], cutsMs: [0, 2000, 2100, 23_900, 9000, 15_000, 30_000] });
    expect(p.chips.map((c) => [c.cutMs, c.state, c.reason ?? null])).toEqual([
      [0, 'held', 'too_close'], [2000, 'kept', null], [2100, 'held', 'too_close'], [9000, 'kept', null], [15_000, 'held', 'no_picture_left'], [23_900, 'held', 'no_picture_left'], [30_000, 'held', 'outside_narration'],
    ]);
    const near = plan(d, { assetIds: ['s0', 's1', 's2'], cutsMs: [23_900] });
    expect(near.chips[0]).toMatchObject({ state: 'held', reason: 'too_close' });
    const kept = plan(d, { assetIds: ['s0', 's1', 's2'], cutsMs: [5000, 7000] }, { ...pending, picked: undefined, kept: [{ key: 'mffffffffffff', clipId: 'clp_x', assetId: 'other', kind: 'picture', startFrame: 180, endFrame: 240 }] });
    expect(kept.chips.map((c) => c.reason ?? c.state)).toEqual(['kept', 'kept_by_hand']);
    for (const pl of [p, near, kept]) {
      const all = [pl.predicted.startFrame, ...pl.predicted.cuts, pl.predicted.endFrame];
      for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(gap);
    }
  });
});

describe('story planner: cuts without taps (S5)', () => {
  it('six pictures and no taps: cuts near 4.5, 8.2 and 15.0 s fall on pauses in the voice, near 12 and 20 s evenly', () => {
    const d = story();
    const p = plan(d, {}, measured(narrationVoice()));
    expect(p.picks.map((k) => k.how)).toEqual(['first', 'pause', 'pause', 'even', 'pause', 'even']);
    const at = p.picks.slice(1).map((k) => k.startFrame / 30);
    expect(at[0]).toBeGreaterThan(4.35); expect(at[0]).toBeLessThan(4.5);
    expect(at[1]).toBeGreaterThan(8.05); expect(at[1]).toBeLessThan(8.2);
    expect(at[2]).toBe(12);
    expect(at[3]).toBeGreaterThan(14.85); expect(at[3]).toBeLessThan(15.0);
    expect(at[4]).toBe(20);
    expect(p.warnings.find((w) => w.code === 'auto_cuts')!.details).toEqual({ pause: 3, even: 2 });
    expect(p.narration.measured).toBe(true);
    expect(p.narration.onsetsMs).toHaveLength(4);
    // the recorded cut of each picture maps back to its own frame
    for (const k of p.picks.slice(1)) expect(T.nearestFrameIndex(T.rt(k.cutMs!, 1000), R30)).toBe(k.startFrame);
    apply(d, p);
  });
  it('taps first, then the untapped pictures share the last stretch; a flat or unmeasured voice gives even cuts only', () => {
    const d = story();
    const p = plan(d, { cutsMs: [2000, 6000] }, measured(narrationVoice()));
    expect(p.picks.map((k) => k.how)).toEqual(['first', 'tap', 'tap', 'even', 'pause', 'even']);
    const flat: VoiceMeasure = { algo: 1, noiseDb10: -300, voiceDb10: -280, flat: true, ranges: [] };
    const f = plan(d, {}, measured(flat));
    expect(f.picks.slice(1).every((k) => k.how === 'even')).toBe(true);
    expect(f.picks.slice(1).map((k) => k.startFrame)).toEqual([120, 240, 360, 480, 600]);
    expect(f.warnings.find((w) => w.code === 'voice_flat')!.details).toEqual({ noiseDb10: -300, voiceDb10: -280 });
    const u = plan(d, {});
    expect(u.warnings.map((w) => w.code)).toContain('voice_pending');
    expect(u.picks.slice(1).every((k) => k.how === 'even')).toBe(true);
    expect(plan(d, {}, { ...pending, voiceState: 'no_sound' }).warnings.map((w) => w.code)).toContain('voice_no_sound');
  });
  it('parts shorter than 1.5 s leave the last pictures out (no_room, named)', () => {
    const d = story(R30, (x) => { for (let i = 6; i < 20; i++) x.assets[`s${i}`] = still(`s${i}`); });
    const ids = Array.from({ length: 20 }, (_, i) => `s${i}`);
    const p = plan(d, { assetIds: ids, cutsMs: [] });
    expect(p.picks).toHaveLength(16);
    expect(p.excluded.map((e) => [e.assetId, e.code])).toEqual(['s16', 's17', 's18', 's19'].map((id) => [id, 'no_room']));
    for (let i = 1; i < p.picks.length; i++) expect(p.picks[i]!.startFrame - p.picks[i - 1]!.startFrame).toBeGreaterThanOrEqual(45);
    apply(d, p);
  });
});

describe('story planner: videos (S7)', () => {
  it('a 3 s video in a 6 s part plays whole; the next picture starts at its end; a video shorter than the gap is too_short', () => {
    const d = story(R30, (x) => { x.assets.v3 = video('v3', 3, { audio: false }); x.assets.v0 = video('v0', 0.2, { audio: false }); x.assets.v12 = video('v12', 12, { audio: false }); });
    let doc = d;
    doc = withMoments(doc, 'v12', { windows: [win({ peakFrame: 200, fromFrame: 150, toFrame: 300 })] });
    const p = plan(doc, { assetIds: ['s0', 'v3', 's2', 'v12', 's4', 'v0'], cutsMs: [2000, 8000, 12_000, 18_000] });
    expect(p.excluded).toEqual([{ assetId: 'v0', code: 'too_short', details: expect.objectContaining({ seconds: expect.any(Number) }) }]);
    const v3 = p.picks[1]!;
    expect(v3).toMatchObject({ startFrame: 60, frames: 90, endedEarly: true, kind: 'whole-clip' });
    expect(p.picks[2]!.startFrame).toBe(150);
    expect(p.picks[2]!.cutMs).toBe(8000);
    expect(p.warnings.find((w) => w.code === 'clip_ended_early')!.details).toMatchObject({ items: [{ assetId: 'v3', seconds: 3, frames: 90 }] });
    const v12 = p.picks[3]!;
    expect(v12.kind).toBe('measured');
    expect(v12.frames).toBe(180);
    expect(v12.sourceInFrame! + v12.sourceFrames!).toBeLessThanOrEqual(360);
    apply(doc, p);
    // the last picture a short video: the pictures end before the voice, said in seconds
    const q = plan(d, { assetIds: ['s0', 'v3'], cutsMs: [18_000] });
    expect(q.warnings.find((w) => w.code === 'pictures_end_before_voice')!.details).toMatchObject({ frames: 90, seconds: 3 });
    expect(q.predicted.gapFrames).toBe(90);
  });
});

describe('the live picture (C3, C8)', () => {
  it('keeps the narration and music clip ids on every call, mutes the clips\' own sound, and a held tap changes nothing', () => {
    const d = story(R30, (x) => { x.assets.mus = song('mus', 60); x.assets.v0 = video('v0', 30); });
    const params = { narrationAssetId: 'nar', assetIds: ['v0', 's1', 's2', 's3'], musicAssetId: 'mus' };
    const before = canonical(d);
    const soundIds = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips.map((c) => `${t.id}:${c.id}:${c.type === 'media' ? c.assetId : ''}`));
    const a = storyLiveDocument(d, params, pending, [])!, b = storyLiveDocument(d, params, pending, [3000])!, c = storyLiveDocument(d, params, pending, [3000, 9000])!;
    expect(soundIds(a)).toEqual(soundIds(b));
    expect(soundIds(b)).toEqual(soundIds(c));
    expect(soundIds(a).some((x) => x.endsWith(':v0'))).toBe(false);
    expect(canonical(a.sequences)).not.toBe(canonical(b.sequences));
    // 3100 is too close to 3000; 40 000 lies after the narration: neither changes the picture or the record
    expect(canonical(storyLiveDocument(d, params, pending, [3000, 3100, 40_000]))).toBe(canonical(b));
    expect(storyLiveDocument(d, { ...params, narrationAssetId: 'ghost' }, pending, [])).toBeNull();
    expect(canonical(d)).toBe(before);
  });
});

describe('story planner: wording', () => {
  it('every plan carries the draft label and says nothing forbidden', () => {
    const d = story();
    expect(plan(d, {}).basis.join('\n')).toContain(STORY_DRAFT_LABEL.en);
    for (const s of texts) expect({ s, bad: STORY_FORBIDDEN_WORDS.test(s) }).toEqual({ s, bad: false });
  });
});
