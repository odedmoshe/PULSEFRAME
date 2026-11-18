/**
 * The family film planner (ADR-0026, familyFilm.ts): every plan here is applied through the REAL internal op apply_template in
 * one transaction (which runs validateProject). Documents, moments records and beat analyses come from the labelled test
 * builders in familyFilm.testDouble.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  canonical, clipEnd, FAMILY_FILM_DRAFT_LABEL, FAMILY_FILM_FACES_NOTE, FamilyFilmParamsSchema, FILM, FILM_BINDS, FILM_FORBIDDEN_WORDS, FILM_FORBIDDEN_WORDS_HE, FILM_PICK_KEY, FilmError, findClip, flashGapFrames, sourceTimeOfFrame, validateProject, videoFrames,
  type FamilyFilmPlan, type FilmPlanContext, type ProjectDocument,
} from './index.ts';
import { FAMILY_FILM_BUILT, filmPickKey, planFamilyFilm } from './familyFilm.ts';
import { applyFilm, beatTimes, edit, emptyCtx, project, R30, regenerateFilm, regenerationPlan, seeded, song, still, video, win, withBeats, withMoments, type Rate } from './familyFilm.testDouble.ts';

const fr = (f: number, rate: Rate = R30) => T.frameTime(f, rate);
/** A project with n videos of `seconds` each (measured: one window around the middle unless `measuredEvery` says otherwise). */
function clips(n: number, seconds = 12, o: { rate?: Rate; measured?: boolean; audio?: boolean } = {}): ProjectDocument {
  let doc = project(o.rate ?? R30);
  for (let i = 0; i < n; i++) {
    const id = `v${i}`;
    doc.assets[id] = video(id, seconds, { audio: o.audio });
    if (o.measured !== false) {
      const frames = videoFrames(doc.assets[id]!)!;
      doc = withMoments(doc, id, { windows: [win({ peakFrame: Math.floor(frames / 2), fromFrame: Math.floor(frames / 4), toFrame: Math.floor((3 * frames) / 4), motion: 20 + i, basis: i % 3 === 0 ? ['inner-motion', 'sound'] : ['inner-motion'], level: i % 3 === 0 ? 7 : null })], measured: { picture: true, sound: i % 3 === 0 } });
    }
  }
  return doc;
}
const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
const withSong = (doc: ProjectDocument, bpm = 120, seconds = 200, o: { drift?: number; seed?: number; meter?: number; downFrom?: number | null; confidence?: number | null } = {}) => {
  doc.assets.mus = song('mus', seconds);
  return withBeats(doc, 'mus', beatTimes(bpm, Math.floor((seconds * bpm) / 60) - 1, { first: 500, drift: o.drift, seed: o.seed }), { meter: o.meter, downFrom: o.downFrom, bpm, confidence: o.confidence });
};
const applied = (doc: ProjectDocument, plan: FamilyFilmPlan) => {
  const r = applyFilm(doc, plan);
  expect(validateProject(r.doc)).toEqual([]);
  return r;
};
const textOf = (plan: FamilyFilmPlan) => [...plan.steps, ...plan.basis, ...plan.warnings.map((w) => w.message), ...plan.blocking.map((w) => w.message), ...plan.alternatives.map((a) => a.label)];

const RATES: Rate[] = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
const allText: string[] = [];
const keep = (plan: FamilyFilmPlan) => { allText.push(...textOf(plan)); return plan; };
const plan = (doc: ProjectDocument, params: Record<string, unknown>, ctx: FilmPlanContext = emptyCtx()) => keep(planFamilyFilm(doc, params, ctx));
const opsOf = (p: FamilyFilmPlan, op: string) => p.ops.filter((o) => o.op === op);
const argsOf = (o: { args: unknown }) => o.args as Record<string, unknown>;
const runIdOf = (doc: ProjectDocument) => Object.keys(doc.recipeRuns)[0]!;
/** Picture clips of a run on the timeline, as [start, end) frames, in time order. */
const pictureRanges = (doc: ProjectDocument, runId: string) => (doc.recipeRuns[runId]!.slots ?? []).filter((s) => s.kind === 'picture').map((s) => {
  const c = findClip(doc, s.clipId)!.clip;
  return { key: s.key, clipId: s.clipId, s: T.nearestFrameIndex(c.start, doc.settings.frameRate), e: T.nearestFrameIndex(clipEnd(c), doc.settings.frameRate), assetId: c.type === 'media' ? c.assetId : null };
}).sort((a, b) => a.s - b.s);
function deepFreeze<X>(x: X): X { if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) deepFreeze(v); } return x; }

describe('the planner is built', () => {
  it('says so, and keys are stable, distinct and never a bind name', () => {
    expect(FAMILY_FILM_BUILT).toBe(true);
    expect(filmPickKey('v1', 0)).toMatch(FILM_PICK_KEY);
    expect(filmPickKey('v1', 0)).toBe(filmPickKey('v1', 0));
    expect(filmPickKey('v1', 0)).not.toBe(filmPickKey('v1', 1));
    expect(Object.values(FILM_BINDS)).not.toContain(filmPickKey('v1', 0));
  });
  it('refuses bad parameters and a film with nothing in it, with FilmError codes', () => {
    const doc = clips(2);
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof FilmError) return e.code; throw e; } return 'none'; };
    expect(code(() => planFamilyFilm(doc, { assetIds: [] }, emptyCtx()))).toBe('invalid_args');
    expect(code(() => planFamilyFilm(doc, { assetIds: ['v0'], targetSeconds: 45 }, emptyCtx()))).toBe('invalid_args');
    expect(code(() => planFamilyFilm(doc, { assetIds: ['v0'], at: fr(1, { num: 7, den: 1 }) }, emptyCtx()))).toBe('invalid_args');
    doc.assets.snd = song('snd', 10);
    expect(code(() => planFamilyFilm(doc, { assetIds: ['snd', 'ghost'] }, emptyCtx()))).toBe('nothing_to_do');
    expect(code(() => planFamilyFilm(doc, { assetIds: ['v0'], musicAssetId: 'ghost' }, emptyCtx()))).toBe('not_found');
    const p = plan(doc, { assetIds: ['snd', 'ghost', 'v0', 'v0'] });
    expect(p.excluded.map((e) => [e.assetId, e.code])).toEqual([['snd', 'no_picture'], ['ghost', 'no_picture']]);
    expect(p.picks.map((k) => k.assetId)).toEqual(['v0']);
  });
});

describe('order', () => {
  const dated = () => { const d = clips(4); return { d, capture: { v0: '2026-09-12T18:00:00', v1: '2026-09-12T09:30:00', v2: null, v3: '2026-09-11' } }; };
  it('capture: by capture time, which differs from the given order; undated files last, in the given order', () => {
    const { d, capture } = dated();
    const p = plan(d, { assetIds: ['v0', 'v1', 'v2', 'v3'], targetSeconds: 30 }, emptyCtx(capture));
    expect([...new Set(p.picks.map((k) => k.assetId))]).toEqual(['v3', 'v1', 'v0', 'v2']);
    expect(p.picks.find((k) => k.assetId === 'v1')!.captureAt).toBe('2026-09-12T09:30:00');
    expect(p.warnings.map((w) => w.code)).toContain('no_capture_time');
    expect(p.basis.join(' ')).toMatch(/without a capture time/);
    const g = plan(d, { assetIds: ['v0', 'v1', 'v2', 'v3'], targetSeconds: 30, order: 'given' }, emptyCtx(capture));
    expect([...new Set(g.picks.map((k) => k.assetId))]).toEqual(['v0', 'v1', 'v2', 'v3']);
    expect(g.warnings.map((w) => w.code)).not.toContain('no_capture_time');
  });
  it('arc: calm first, the most active at two thirds, unimodal; stills and unmeasured files at the end', () => {
    let d = project();
    const motion = [5, 90, 30, 60, 10, 45, 75, 20, 120];
    motion.forEach((mo, i) => { d.assets[`v${i}`] = video(`v${i}`, 14); d = withMoments(d, `v${i}`, { windows: [win({ peakFrame: 200, fromFrame: 100, toFrame: 400, motion: mo })] }); });
    d.assets.s = still('s');
    d.assets.u = video('u', 14);
    const p = plan(d, { assetIds: ['s', 'u', ...motion.map((_, i) => `v${i}`)], targetSeconds: 90, order: 'arc' });
    const firsts = p.picks.filter((k) => !k.reasons.some((r) => r.code === 'second_moment'));
    const order = firsts.map((k) => k.assetId);
    expect(order.slice(-2)).toEqual(['s', 'u']);
    const vals = order.slice(0, -2).map((id) => motion[Number(id.slice(1))]!);
    const top = vals.indexOf(Math.max(...vals));
    expect(top).toBe(Math.round(((vals.length - 1) * 2) / 3));
    for (let i = 1; i <= top; i++) expect(vals[i]!).toBeGreaterThanOrEqual(vals[i - 1]!);
    for (let i = top + 1; i < vals.length; i++) expect(vals[i]!).toBeLessThanOrEqual(vals[i - 1]!);
    applied(d, p);
  });
});

describe('property: 200 seeded grids with +-3 % tempo drift', () => {
  it('every cut is the nearest frame of a bar start or half-bar, no two cuts closer than the flash gap, lengths are differences of snapped boundaries, and every plan applies', () => {
    fc.assert(fc.property(fc.record({
      seed: fc.integer({ min: 1, max: 1_000_000 }), bpm: fc.integer({ min: 60, max: 180 }), meter: fc.constantFrom(3, 4, 6), n: fc.integer({ min: 2, max: 12 }),
      target: fc.constantFrom(30, 60, 90), rate: fc.constantFrom(...RATES), stills: fc.integer({ min: 0, max: 2 }), music: fc.boolean(),
    }), (r) => {
      const rnd = seeded(r.seed);
      let d = project(r.rate);
      const list: string[] = [];
      for (let i = 0; i < r.n; i++) {
        const id = `v${i}`;
        d.assets[id] = video(id, 3 + Math.floor(rnd() * 25), { rate: rnd() < 0.3 ? RATES[Math.floor(rnd() * RATES.length)]! : r.rate, audio: rnd() < 0.8 });
        const frames = videoFrames(d.assets[id]!)!;
        if (rnd() < 0.7) {
          const peak = Math.floor(rnd() * (frames - 1));
          const from = Math.max(0, peak - Math.floor(rnd() * 200)), to = Math.min(frames, peak + 1 + Math.floor(rnd() * 200));
          d = withMoments(d, id, { windows: rnd() < 0.15 ? [] : [win({ peakFrame: peak, fromFrame: from, toFrame: to })], flat: undefined });
        }
        list.push(id);
      }
      for (let i = 0; i < r.stills; i++) { d.assets[`s${i}`] = still(`s${i}`); list.push(`s${i}`); }
      if (r.music) withSong(d, r.bpm, r.target + 40, { drift: 0.03, seed: r.seed, meter: r.meter });
      const p = plan(d, { assetIds: list, targetSeconds: r.target, ...(r.music ? { musicAssetId: 'mus' } : {}), order: 'given' });
      const rate = d.settings.frameRate, gap = flashGapFrames(rate.num / rate.den);
      // the grid: music beats from the first bar start, or 100 BPM from 0; a cut lies on every half bar (even meter) or bar
      const meter = r.music ? r.meter : 4, h = meter % 2 === 0 ? meter / 2 : meter;
      const an = d.analyses.mus?.beats;
      const grid = new Set<number>();
      if (r.music) an!.beats.forEach((b, k) => { if (k % h === 0) grid.add(T.nearestFrameIndex(T.sub(b, an!.beats[0]!), rate)); });
      else for (let k = 0; k < 400; k += h) grid.add(T.nearestFrameIndex(T.rt(k * 60, FILM.fallbackBpm), rate));
      for (const c of p.predicted.cuts) expect(grid.has(c)).toBe(true);
      expect(p.predicted.offGridCuts).toEqual([]);
      const all = [...p.predicted.cuts, p.predicted.endFrame].sort((a, b) => a - b);
      for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(gap);
      expect(p.ops.length).toBeLessThanOrEqual(FILM.maxOps);
      expect(p.slots.length).toBeLessThanOrEqual(FILM.maxSlots);
      const out = applied(d, p);
      const ranges = pictureRanges(out.doc, runIdOf(out.doc));
      expect(ranges.length).toBe(p.picks.length);
      for (const [i, x] of ranges.entries()) {
        expect(grid.has(x.s) && grid.has(x.e)).toBe(true);
        if (i) expect(x.s).toBe(ranges[i - 1]!.e);
        const c = findClip(out.doc, x.clipId)!.clip;
        expect(T.eq(c.duration, T.sub(T.frameTime(x.e, rate), T.frameTime(x.s, rate)))).toBe(true);
        if (c.type === 'media' && out.doc.assets[c.assetId]!.kind !== 'image') expect(T.lte(T.add(c.sourceIn, c.duration), out.doc.assets[c.assetId]!.duration)).toBe(true);
      }
    }), { numRuns: 200, seed: 20261118 });
  }, 120_000);
});

/** Replace the bar starts of `mus` by a hand-corrected, irregular list: bar i lasts lens(i) beats, from the first beat. */
const irregularBars = (d: ProjectDocument, lens: (i: number) => number) => {
  const an = d.analyses.mus!.beats!;
  const downs: T.RationalTime[] = [];
  for (let k = 0, i = 0; k < an.beats.length; k += lens(i++)) downs.push(an.beats[k]!);
  d.analyses.mus = { ...d.analyses.mus!, beats: { ...an, downbeats: downs, origin: { ...an.origin, edited: true } } };
  return d;
};
/**
 * The measured bars of the music as the planner must cut on them (the music starts at its first bar start, at the film start):
 * per bar start and half-bar (the middle beat of a bar of an even number of beats, even meter) its frame, bar index and beat index.
 */
const measuredBars = (d: ProjectDocument, meter: number, start: T.RationalTime = T.ZERO) => {
  const an = d.analyses.mus!.beats!, rate = d.settings.frameRate;
  const first = an.downbeats![0]!;
  const beats = an.beats.filter((b) => !T.lt(b, first));
  const idx = (t: T.RationalTime) => beats.findIndex((b) => T.eq(b, t));
  const starts = an.downbeats!.map(idx);
  const frame = (k: number) => T.nearestFrameIndex(T.add(start, T.sub(beats[k]!, first)), rate);
  const bars = new Map<number, { bar: number; beat: number }>(), halves = new Map<number, number>();
  starts.forEach((p, i) => {
    bars.set(frame(p), { bar: i, beat: p });
    const len = (starts[i + 1] ?? p + meter) - p;
    if (meter % 2 === 0 && len % 2 === 0 && p + len / 2 < beats.length) halves.set(frame(p + len / 2), p + len / 2);
  });
  const beatOf = (f: number) => bars.get(f)?.beat ?? halves.get(f);
  return { bars, halves, beatOf };
};
/** Every cut, pick span and slot record of `p` against the measured bars. */
const expectOnMeasuredBars = (p: FamilyFilmPlan, mb: ReturnType<typeof measuredBars>) => {
  for (const c of p.predicted.cuts) expect(mb.beatOf(c), `cut at frame ${c} is neither a measured bar start nor a half-bar`).not.toBeUndefined();
  for (const [i, k] of p.picks.entries()) {
    if (!k.span) continue;
    const a = k.startFrame, b = k.startFrame + k.frames;
    if (k.span.unit === 'bar') {
      expect(mb.bars.has(a) && mb.bars.has(b), `pick ${i} is labelled in bars but does not run from bar start to bar start`).toBe(true);
      expect(k.span.count).toBe(mb.bars.get(b)!.bar - mb.bars.get(a)!.bar);
      expect(p.slots.find((s) => s.key === k.key)!.beats).toEqual({ from: mb.bars.get(a)!.bar, count: k.span.count, unit: 'bar' });
    } else {
      expect(k.span.count).toBe(mb.beatOf(b)! - mb.beatOf(a)!);
      expect(p.slots.find((s) => s.key === k.key)!.beats).toEqual({ from: mb.beatOf(a)!, count: k.span.count, unit: 'beat' });
    }
  }
};

describe('hand-corrected, irregular bar starts', () => {
  it('one bar of three beats in 4/4: every cut is still on a measured bar start or half-bar, and the spans count the real bars', () => {
    const d = irregularBars(withSong(clips(12, 12), 120, 200), (i) => (i === 2 ? 3 : 4));
    expect(d.analyses.mus!.beats!.downbeats!.slice(0, 6).map((b) => d.analyses.mus!.beats!.beats.findIndex((x) => T.eq(x, b)))).toEqual([0, 4, 8, 11, 15, 19]);
    const p = plan(d, { assetIds: ids(12), musicAssetId: 'mus', targetSeconds: 60, order: 'given' });
    expect(p.predicted.cuts.length).toBeGreaterThan(8);
    expectOnMeasuredBars(p, measuredBars(d, 4));
    expect(p.basis.join(' ')).toMatch(/1 bar\(s\) of the music do not have 4 beats/);
    applied(d, p);
  });
  it('property: 150 seeded irregular bar lists (meter 3, 4, 6; bars one beat shorter or longer), with tempo drift', () => {
    fc.assert(fc.property(fc.record({
      seed: fc.integer({ min: 1, max: 1_000_000 }), bpm: fc.integer({ min: 60, max: 180 }), meter: fc.constantFrom(3, 4, 6), n: fc.integer({ min: 2, max: 12 }),
      target: fc.constantFrom(30, 60, 90), rate: fc.constantFrom(...RATES), odd: fc.integer({ min: 2, max: 6 }),
    }), (r) => {
      const rnd = seeded(r.seed);
      let d = project(r.rate);
      const list: string[] = [];
      for (let i = 0; i < r.n; i++) {
        const id = `v${i}`;
        d.assets[id] = video(id, 3 + Math.floor(rnd() * 25), { rate: r.rate });
        const frames = videoFrames(d.assets[id]!)!;
        if (rnd() < 0.7) d = withMoments(d, id, { windows: [win({ peakFrame: Math.floor(frames / 2), fromFrame: Math.floor(frames / 4), toFrame: Math.floor((3 * frames) / 4) })] });
        list.push(id);
      }
      withSong(d, r.bpm, r.target + 40, { drift: 0.03, seed: r.seed, meter: r.meter });
      const lens = Array.from({ length: 400 }, () => (rnd() < 1 / r.odd ? r.meter + (rnd() < 0.5 ? -1 : 1) : r.meter));
      irregularBars(d, (i) => lens[i % lens.length]!);
      const p = plan(d, { assetIds: list, targetSeconds: r.target, musicAssetId: 'mus', order: 'given' });
      expectOnMeasuredBars(p, measuredBars(d, r.meter));
      expect(p.predicted.offGridCuts).toEqual([]);
      const all = [...p.predicted.cuts, p.predicted.endFrame].sort((a, b) => a - b);
      const gap = flashGapFrames(r.rate.num / r.rate.den);
      for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(gap);
      applied(d, p);
    }), { numRuns: 150, seed: 20261119 });
  }, 120_000);
});

describe('window placement', () => {
  const one = (w: Parameters<typeof win>[0] | null, o: { seconds?: number; flat?: boolean; file?: { motion: number | null; level: number | null } } = {}) => {
    let d = project();
    d.assets.v = video('v', o.seconds ?? 20);
    if (w !== null || o.flat) d = withMoments(d, 'v', { windows: w ? [win(w)] : [], ...(o.file ? { file: o.file } : {}) });
    withSong(d, 120);
    const p = plan(d, { assetIds: ['v'], musicAssetId: 'mus', targetSeconds: 30 });
    applied(d, p);
    return p.picks[0]!;
  };
  it('inside the clean stretch, containing the peak, with a 0.4 lead-in when it fits', () => {
    const k = one({ peakFrame: 300, fromFrame: 200, toFrame: 420 });
    const ls = k.sourceFrames!;
    expect(k.kind).toBe('measured');
    expect(k.sourceInFrame).toBe(300 - Math.round(0.4 * ls));
    expect(k.sourceInFrame!).toBeGreaterThanOrEqual(200);
    expect(k.sourceInFrame! + ls).toBeLessThanOrEqual(420);
    expect(k.reasons[0]!.code).toBe('inner_motion');
  });
  it('clamps to the stretch at both ends', () => {
    const a = one({ peakFrame: 210, fromFrame: 200, toFrame: 420 });
    expect(a.sourceInFrame).toBe(200);
    const b = one({ peakFrame: 410, fromFrame: 200, toFrame: 420 });
    expect(b.sourceInFrame).toBe(420 - b.sourceFrames!);
    expect(b.sourceInFrame!).toBeLessThanOrEqual(410);
  });
  it('a stretch shorter than the slot: centred on it, and the reason says so', () => {
    const k = one({ peakFrame: 300, fromFrame: 290, toFrame: 330 });
    expect(k.sourceInFrame).toBe(Math.round((290 + 330 - k.sourceFrames!) / 2));
    expect(k.reasons.map((r) => r.code)).toContain('past_clean_stretch');
  });
  it('unmeasured, flat and active-throughout files: the middle of the file', () => {
    const u = one(null);
    expect(u.kind).toBe('default-middle');
    expect(u.sourceInFrame).toBe(Math.floor((600 - u.sourceFrames!) / 2));
    expect(u.reasons.map((r) => r.code)).toEqual(['not_measured', 'default_middle']);
    const f = one(null, { flat: true });
    expect(f.reasons.map((r) => r.code)).toEqual(['no_clear_moment', 'default_middle']);
    const a = one(null, { flat: true, file: { motion: 40, level: -200 } });
    expect(a.reasons[0]).toMatchObject({ code: 'active_throughout', value: 40 });
  });
  it('a clip exactly as long as its slot is used whole', () => {
    const k = one(null, { seconds: 4 });
    expect(k.frames).toBe(120);
    expect(k.kind).toBe('whole-clip');
    expect(k.sourceInFrame).toBe(0);
    expect(k.reasons.map((r) => r.code)).toContain('whole_clip');
  });
  it('never reads past the file, with mixed frame rates and a picture that starts late', () => {
    for (const rate of [{ num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 60, den: 1 }]) {
      let d = project(R30);
      d.assets.v = video('v', 9, { rate, startTime: T.rt(1, 5) });
      const frames = videoFrames(d.assets.v)!;
      d = withMoments(d, 'v', { windows: [win({ peakFrame: frames - 2, fromFrame: frames - 40, toFrame: frames })] });
      d.assets.w = video('w', 6, { rate });
      const p = plan(d, { assetIds: ['v', 'w'], targetSeconds: 30 });
      const out = applied(d, p);
      for (const k of p.picks) {
        const a = d.assets[k.assetId]!;
        expect(k.sourceInFrame! + k.sourceFrames!).toBeLessThanOrEqual(videoFrames(a)!);
        const op = argsOf(p.ops.find((o) => o.bind === k.key)!);
        expect(T.eq(op.sourceIn as T.RationalTime, sourceTimeOfFrame(a, k.sourceInFrame!))).toBe(true);
        expect(k.sourceFrames).toBe(Math.ceil((k.frames * rate.num * 1) / (rate.den * 30) - 1e-9));
      }
      expect(validateProject(out.doc)).toEqual([]);
    }
  });
  it('a still: Ken Burns in, unless motion is none', () => {
    const d = clips(2);
    d.assets.s = still('s');
    const p = plan(d, { assetIds: ['s', 'v0', 'v1'], order: 'given', targetSeconds: 30 });
    const k = p.picks.find((x) => x.assetId === 's')!;
    expect(k).toMatchObject({ kind: 'still', sourceInFrame: null, sourceFrames: null, reasons: [{ code: 'still' }] });
    expect(opsOf(p, 'apply_motion_preset').map((o) => argsOf(o).presetId)).toEqual(['motion.move.ken-burns-in']);
    applied(d, p);
    const n = plan(d, { assetIds: ['s', 'v0', 'v1'], order: 'given', targetSeconds: 30, motion: 'none' });
    expect(opsOf(n, 'apply_motion_preset')).toEqual([]);
    expect(opsOf(n, 'set_text_animation')).toEqual([]);
    applied(d, n);
  });
});

describe('fitting the target', () => {
  const plenty = () => {
    let d = project();
    for (let i = 0; i < 30; i++) { d.assets[`v${i}`] = video(`v${i}`, 20); d = withMoments(d, `v${i}`, { windows: [win({ peakFrame: 150, fromFrame: 60, toFrame: 300 }), win({ peakFrame: 450, fromFrame: 360, toFrame: 590 })] }); }
    return withSong(d, 120, 200);
  };
  it('the film is within one bar of 30, 60 and 90 seconds when there is material enough', () => {
    const d = plenty();
    for (const t of [30, 60, 90] as const) {
      const p = plan(d, { assetIds: ids(30), musicAssetId: 'mus', targetSeconds: t, order: 'given' });
      expect(Math.abs(p.predicted.seconds - t)).toBeLessThanOrEqual(2 + 1e-6);
      expect(p.warnings.map((w) => w.code)).not.toContain('shorter_than_target');
      applied(d, p);
    }
  });
  it('shorter_than_target when the material does not suffice', () => {
    const d = withSong(clips(2, 6), 120);
    const p = plan(d, { assetIds: ids(2), musicAssetId: 'mus', targetSeconds: 90 });
    expect(p.warnings.map((w) => w.code)).toContain('shorter_than_target');
    applied(d, p);
  });
  it('picks left out for lack of room are spread over the order, never a run from the end; include pins one', () => {
    const d = withSong(clips(40, 10, { measured: false }), 120);
    const p = plan(d, { assetIds: ids(40), musicAssetId: 'mus', targetSeconds: 30, order: 'given' });
    const out = p.excluded.filter((e) => e.code === 'no_room').map((e) => Number(e.assetId.slice(1)));
    expect(out.length).toBeGreaterThan(10);
    expect(Math.min(...out)).toBeLessThan(5);
    expect(Math.max(...out)).toBeGreaterThan(35);
    expect(out.filter((i) => i < 20).length).toBeGreaterThan(out.length / 3);
    const pinned = `v${out[0]}`;
    const q = plan(d, { assetIds: ids(40), musicAssetId: 'mus', targetSeconds: 30, order: 'given', picks: { include: [pinned] } });
    expect(q.picks.map((k) => k.assetId)).toContain(pinned);
    applied(d, q);
  });
  it('second windows of the same file are at least 4 s apart and in source order', () => {
    let d = project();
    for (let i = 0; i < 3; i++) { d.assets[`v${i}`] = video(`v${i}`, 20); d = withMoments(d, `v${i}`, { windows: [win({ peakFrame: 400, fromFrame: 330, toFrame: 520 }), win({ peakFrame: 340, fromFrame: 300, toFrame: 380 }), win({ peakFrame: 120, fromFrame: 40, toFrame: 230 })] }); }
    withSong(d, 120);
    const p = plan(d, { assetIds: ids(3), musicAssetId: 'mus', targetSeconds: 30, order: 'given' });
    for (const id of ids(3)) {
      const mine = p.picks.filter((k) => k.assetId === id);
      expect(mine.length).toBe(2);
      expect(mine.map((k) => k.windowIndex)).toEqual([2, 0]);
      expect(mine[0]!.reasons[0]!.code).toBe('second_moment');
      expect(new Set(mine.map((k) => k.key)).size).toBe(2);
    }
    applied(d, p);
  });
});

describe('overrides', () => {
  it('another window by index says chosen_by_you; exclude leaves a file out', () => {
    let d = project();
    d.assets.v = video('v', 20); d.assets.w = video('w', 20);
    d = withMoments(d, 'v', { windows: [win({ peakFrame: 150, fromFrame: 60, toFrame: 300 }), win({ peakFrame: 450, fromFrame: 360, toFrame: 590 })] });
    const p = plan(d, { assetIds: ['v', 'w'], picks: { window: { v: 1 }, exclude: ['w'] }, targetSeconds: 30 });
    const first = p.picks.find((k) => k.assetId === 'v' && k.windowIndex === 1)!;
    expect(first.reasons[0]!.code).toBe('chosen_by_you');
    expect(first.sourceInFrame!).toBeGreaterThanOrEqual(360);
    expect(p.excluded).toEqual([{ assetId: 'w', code: 'excluded_by_you', details: {} }]);
    expect(p.picks.some((k) => k.assetId === 'w')).toBe(false);
    // an id naming an Object.prototype member finds nothing
    expect(() => plan(d, { assetIds: ['v'], picks: { window: { constructor: 1, __proto__: 2 } } })).not.toThrow();
    applied(d, p);
  });
});

describe('sound', () => {
  const base = () => { const d = withSong(clips(4)); d.assets.q = video('q', 12, { audio: false }); return d; };
  const params = (o: Record<string, unknown>) => ({ assetIds: [...ids(4), 'q'], targetSeconds: 30, order: 'given', ...o });
  it('under with music: the own-sound track at 0.25, linked sound with 0.1 s fades; a file without sound gets none', () => {
    const d = base();
    const p = plan(d, params({ musicAssetId: 'mus' }));
    expect(opsOf(p, 'set_track_audio').map(argsOf)).toEqual([{ trackId: 'trk_audio', gain: 0.25 }]);
    expect(opsOf(p, 'set_ducking')).toEqual([]);
    const q = p.picks.find((k) => k.assetId === 'q')!;
    expect(q.ownSound).toBe(false);
    expect(argsOf(p.ops.find((o) => o.bind === q.key)!).withLinkedAudio).toBe(false);
    expect(opsOf(p, 'set_clip_fades').length).toBe(p.picks.filter((k) => k.ownSound).length);
    expect(argsOf(opsOf(p, 'set_clip_fades')[0]!).fadeIn).toEqual(fr(3));
    const out = applied(d, p);
    expect(out.doc.sequences[out.doc.mainSequenceId]!.tracks.find((t) => t.id === 'trk_audio')!.audio!.gain).toBe(0.25);
  });
  it('under without music: full level, no track setting, said in basis; lead without music: no ducking', () => {
    const d = base();
    const p = plan(d, params({}));
    expect(opsOf(p, 'set_track_audio')).toEqual([]);
    expect(p.basis.join(' ')).toMatch(/full level/);
    const l = plan(d, params({ ownSound: 'lead' }));
    expect(opsOf(l, 'set_ducking')).toEqual([]);
    applied(d, p); applied(d, l);
  });
  it('lead with music: the music track ducks 9 dB under the own-sound track, and says it rises over silent clips', () => {
    const d = base();
    const p = plan(d, params({ musicAssetId: 'mus', ownSound: 'lead' }));
    expect(opsOf(p, 'set_ducking').map(argsOf)).toEqual([{ trackId: { $ref: 'music-track', out: 'trackId' }, sourceTrackIds: ['trk_audio'], reductionDb: 9 }]);
    expect(opsOf(p, 'set_track_audio')).toEqual([]);
    expect(p.warnings.map((w) => w.code)).toContain('lead_music_rises');
    applied(d, p);
  });
  it('mute: no linked sound and no own-sound track', () => {
    const d = base();
    const p = plan(d, params({ musicAssetId: 'mus', ownSound: 'mute' }));
    expect(p.picks.every((k) => !k.ownSound)).toBe(true);
    expect(opsOf(p, 'add_clip').every((o) => argsOf(o).withLinkedAudio === false)).toBe(true);
    expect(opsOf(p, 'set_track_audio').length + opsOf(p, 'set_clip_fades').length).toBe(0);
    applied(d, p);
  });
});

describe('titles', () => {
  const d = () => clips(4);
  it('a live title from the context is added with fields on; a plain one without', () => {
    const live = plan(d(), { assetIds: ids(4), targetSeconds: 30 }, { capture: {}, title: { text: '{event} · {hebrewDate}', resolved: null, live: true }, closing: { text: 'להתראות {{1}}', resolved: null, live: false } });
    const [t, c] = opsOf(live, 'add_text').map(argsOf);
    expect(t).toMatchObject({ text: '{event} · {hebrewDate}', fields: true });
    expect(c!.text).toBe('להתראות {{1}}');
    expect('fields' in c!).toBe(false);
    expect(live.warnings.map((w) => w.code)).not.toContain('title_resolved_static');
    // over the first slot, at least FILM.titleMinSeconds
    expect(argsOf(opsOf(live, 'add_text')[0]!).duration).toEqual(fr(live.picks[0]!.frames));
    expect(live.picks[0]!.frames).toBeGreaterThanOrEqual(FILM.titleMinSeconds * 30);
    applied(d(), live);
  });
  it('without a context title: fixed words, warned; the default looks; an unknown look falls back', () => {
    const p = plan(d(), { assetIds: ids(4), targetSeconds: 30, lang: 'en' });
    expect(argsOf(opsOf(p, 'add_text')[0]!).text).toBe('Our film');
    expect(p.warnings.map((w) => w.code)).toContain('title_resolved_static');
    expect(opsOf(p, 'apply_text_preset').map((o) => argsOf(o).presetId)).toEqual(['title-card', 'end-card']);
    const q = plan(d(), { assetIds: ids(4), targetSeconds: 30 }, { ...emptyCtx(), titleLookId: 'no-such-look', closingLookId: 'title-card' });
    expect(opsOf(q, 'apply_text_preset').map((o) => argsOf(o).presetId)).toEqual(['title-card', 'title-card']);
    expect(q.basis.join(' ')).toMatch(/no-such-look/);
    const typed = plan(d(), { assetIds: ids(4), targetSeconds: 30, openingText: 'יום הולדת' });
    expect(argsOf(opsOf(typed, 'add_text')[0]!).text).toBe('יום הולדת');
    expect(typed.warnings.map((w) => w.code)).not.toContain('title_resolved_static');
    applied(d(), p); applied(d(), q);
  });
  it('animated unless motion is none; no title or closing card when switched off', () => {
    expect(opsOf(plan(d(), { assetIds: ids(4), targetSeconds: 30 }), 'set_text_animation').length).toBe(2);
    expect(opsOf(plan(d(), { assetIds: ids(4), targetSeconds: 30, motion: 'none' }), 'set_text_animation').length).toBe(0);
    const off = plan(d(), { assetIds: ids(4), targetSeconds: 30, openingTitle: false, closingCard: false });
    expect(opsOf(off, 'add_text')).toEqual([]);
    expect(off.predicted.endFrame).toBe(off.picks.at(-1)!.startFrame + off.picks.at(-1)!.frames);
    applied(d(), off);
  });
});

describe('without music, music too short, music not measured', () => {
  it('no music: a steady 100 BPM grid from the start', () => {
    const p = plan(clips(5), { assetIds: ids(5), targetSeconds: 30 });
    // a half bar of 100 BPM is 1.2 s = 36 frames at 30 fps, from the film's start
    expect(p.predicted.cuts.length).toBeGreaterThan(3);
    for (const c of p.predicted.cuts) expect(c % 36).toBe(0);
    expect(opsOf(p, 'fit_music')).toEqual([]);
    applied(clips(5), p);
    expect(p.basis[0]).toMatch(/no music: a steady grid of 100/);
  });
  it('music too short: the film ends with its beats, says music_short, and applies', () => {
    const d = withSong(clips(10), 120, 20);
    const p = plan(d, { assetIds: ids(10), musicAssetId: 'mus', targetSeconds: 60 });
    expect(p.warnings.map((w) => w.code)).toContain('music_short');
    expect(p.predicted.seconds).toBeLessThan(30);
    expect(p.excluded.some((e) => e.code === 'no_room')).toBe(true);
    applied(d, p);
  });
  it('music without beats: needs_analysis', () => {
    const d = clips(2);
    d.assets.mus = song('mus', 60);
    try { planFamilyFilm(d, { assetIds: ids(2), musicAssetId: 'mus' }, emptyCtx()); throw new Error('planned'); } catch (e) { expect(e).toBeInstanceOf(FilmError); expect((e as FilmError).code).toBe('needs_analysis'); }
  });
  it('low beat confidence is warned; videos without moments are listed to measure', () => {
    const d = withSong(clips(3, 12, { measured: false }), 120, 200, { confidence: 0.2 });
    const p = plan(d, { assetIds: ids(3), musicAssetId: 'mus', targetSeconds: 30 });
    expect(p.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['low_beat_confidence', 'not_measured']));
    expect(p.needsMeasurement).toEqual(ids(3));
  });
});

describe('regeneration', () => {
  const first = () => {
    const d0 = withSong(clips(12, 12), 120, 200);
    const p = plan(d0, { assetIds: ids(12), musicAssetId: 'mus', targetSeconds: 30, order: 'given' });
    const out = applied(d0, p);
    return { doc: out.doc, runId: runIdOf(out.doc), plan: p };
  };
  const check = (before: ProjectDocument, runId: string, r: ReturnType<typeof regenerateFilm>) => {
    const after = r.applied.doc;
    expect(validateProject(after)).toEqual([]);
    const opsText = JSON.stringify(r.plan.ops);
    for (const id of r.protectedIds) {
      expect(opsText.includes(id)).toBe(false);
      expect(canonical(findClip(after, id)!.clip)).toBe(canonical(findClip(before, id)!.clip));
    }
    const ranges = pictureRanges(after, runId);
    const assets = ranges.map((x) => x.assetId);
    expect(new Set(assets).size).toBe(assets.length);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.s).toBeGreaterThanOrEqual(ranges[i - 1]!.e);
    const keptEdges = new Set(r.kept.filter((k) => k.kind === 'picture').flatMap((k) => [k.startFrame, k.endFrame]));
    for (const c of r.plan.predicted.offGridCuts) expect(keptEdges.has(c)).toBe(true);
    const keys = (after.recipeRuns[runId]!.slots ?? []).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    return ranges;
  };
  it('a moved clip is kept where it was moved, and the film is laid around it', () => {
    const { doc, runId, plan: p } = first();
    const slot = doc.recipeRuns[runId]!.slots!.filter((s) => s.kind === 'picture')[3]!;
    const moved = edit(doc, [{ op: 'move_clip', args: { clipId: slot.clipId, start: fr(p.predicted.endFrame + 15) } }]);
    const r = regenerateFilm(moved, runId);
    const ranges = check(moved, runId, r);
    expect(r.plan.warnings.map((w) => w.code)).toContain('kept_by_hand');
    expect(ranges.some((x) => x.clipId === slot.clipId)).toBe(true);
    expect(r.plan.predicted.gapFrames).toBe(0);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.s).toBe(ranges[i - 1]!.e);
  });
  it('a trimmed clip is kept; the cuts next to it are off the grid and listed so', () => {
    const { doc, runId } = first();
    const slot = doc.recipeRuns[runId]!.slots!.filter((s) => s.kind === 'picture')[2]!;
    const c = findClip(doc, slot.clipId)!.clip;
    const trimmed = edit(doc, [{ op: 'trim_clip', args: { clipId: slot.clipId, edge: 'end', to: T.add(c.start, fr(30)) } }]);
    const r = regenerateFilm(trimmed, runId);
    check(trimmed, runId, r);
    expect(r.plan.predicted.gapFrames).toBe(0);
    expect(r.plan.predicted.offGridCuts.length).toBeGreaterThan(0);
    expect(r.plan.warnings.map((w) => w.code)).toContain('cut_off_grid_next_to_kept');
  });
  it('a clip moved to another track is kept and its range stays free on the film\'s track', () => {
    const { doc, runId } = first();
    const slot = doc.recipeRuns[runId]!.slots!.filter((s) => s.kind === 'picture')[1]!;
    const c = findClip(doc, slot.clipId)!.clip;
    let moved = edit(doc, [{ op: 'add_track', args: { kind: 'video' } }]);
    const track = moved.sequences[moved.mainSequenceId]!.tracks.find((t) => t.kind === 'video' && t.clips.length === 0)!;
    moved = edit(moved, [{ op: 'move_clip', args: { clipId: slot.clipId, start: T.add(c.start, fr(20)), trackId: track.id } }]);
    const r = regenerateFilm(moved, runId);
    check(moved, runId, r);
    expect(r.plan.predicted.gapFrames).toBe(0);
    expect(findClip(r.applied.doc, slot.clipId)!.track.id).toBe(track.id);
  });
  it('a kept title is not made again; a kept file given another file frees no key twice', () => {
    const { doc, runId } = first();
    const run = doc.recipeRuns[runId]!;
    const title = run.slots!.find((s) => s.key === FILM_BINDS.title)!;
    const pic = run.slots!.filter((s) => s.kind === 'picture')[0]!;
    const edited = edit(doc, [{ op: 'update_text', args: { clipId: title.clipId, text: 'כותרת שלי' } }, { op: 'replace_clip_media', args: { clipId: pic.clipId, assetId: 'v11' } }]);
    const r = regenerateFilm(edited, runId);
    check(edited, runId, r);
    expect(opsOf(r.plan, 'add_text').map((o) => o.bind)).toEqual([FILM_BINDS.closing]);
    expect(r.plan.slots.map((s) => s.key)).not.toContain(pic.key);
    expect(r.plan.picks.map((k) => k.assetId)).not.toContain('v11');
  });
  it('kept music moved by hand off the film start: the film start is not listed as a cut on the grid, and every cut is on its bars', () => {
    const { doc, runId } = first();
    const music = doc.recipeRuns[runId]!.slots!.find((s) => s.key === FILM_BINDS.music)!;
    const c = findClip(doc, music.clipId)!.clip;
    const moved = edit(doc, [{ op: 'move_clip', args: { clipId: music.clipId, start: T.add(c.start, fr(7)) } }]);
    const r = regenerateFilm(moved, runId);
    check(moved, runId, r);
    expect(r.plan.predicted.startFrame).toBe(0);
    expect(r.plan.predicted.cuts).not.toContain(0);
    expect(r.plan.predicted.offGridCuts).toEqual([]);
    expect(r.plan.picks[0]!.span).toBeNull();
    expectOnMeasuredBars(r.plan, measuredBars(moved, 4, fr(7)));
    expect(r.plan.basis.join(' ')).toMatch(/first bar start/);
  });
  it('kept music defines the grid; music played backwards blocks the plan', () => {
    const { doc, runId } = first();
    const music = doc.recipeRuns[runId]!.slots!.find((s) => s.key === FILM_BINDS.music)!;
    const louder = edit(doc, [{ op: 'set_clip_gain', args: { clipId: music.clipId, gain: 0.7 } }]);
    const r = regenerateFilm(louder, runId);
    check(louder, runId, r);
    expect(opsOf(r.plan, 'fit_music')).toEqual([]);
    expect(r.plan.slots.map((s) => s.key)).not.toContain(FILM_BINDS.music);
    expect(r.plan.predicted.cuts).toEqual(first().plan.predicted.cuts);
    const back = edit(doc, [{ op: 'set_clip_reverse', args: { clipId: music.clipId, reverse: true } }]);
    const b = regenerationPlan(back, runId).plan;
    expect(b.blocking.map((w) => w.code)).toEqual(['kept_music_not_followable']);
  });
  it('the mix is set again only where it changes (a gain set by hand survives)', () => {
    const { doc, runId } = first();
    const byHand = edit(doc, [{ op: 'set_track_audio', args: { trackId: 'trk_audio', gain: 0.6 } }]);
    const r = regenerateFilm(byHand, runId, {}, 'rg1_');
    expect(opsOf(r.plan, 'set_track_audio')).toEqual([]);
    // removing the music changes the mix as it sounds ('under' is full level without music): set again
    const noMusic = regenerateFilm(byHand, runId, { musicAssetId: null }, 'rg2_');
    expect(opsOf(noMusic.plan, 'set_track_audio').map(argsOf)).toEqual([{ trackId: 'trk_audio', gain: 1 }]);
    // and 'lead' now ducks the music track again under the reused own-sound track
    const lead = regenerateFilm(byHand, runId, { ownSound: 'lead' }, 'rg3_');
    expect(opsOf(lead.plan, 'set_track_audio').map(argsOf)).toEqual([{ trackId: 'trk_audio', gain: 1 }]);
    expect(opsOf(lead.plan, 'set_ducking').length).toBe(1);
    expect(opsOf(lead.plan, 'add_track')).toEqual([]);
  });
});

describe('determinism, frozen input and caps', () => {
  it('two runs give deep-equal plans, and the document is never changed', () => {
    const d = deepFreeze(withSong(clips(9)));
    const before = canonical(d);
    const params = { assetIds: ids(9), musicAssetId: 'mus', order: 'arc' as const };
    expect(planFamilyFilm(d, params, emptyCtx())).toEqual(planFamilyFilm(d, params, emptyCtx()));
    expect(canonical(d)).toBe(before);
  });
  it('60 files: at most 48 picks, ops, slots and steps inside the caps', () => {
    let d = project();
    const list: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = i % 4 === 0 ? `s${i}` : `v${i}`;
      d.assets[id] = id.startsWith('s') ? still(id) : video(id, 30);
      if (id.startsWith('v')) d = withMoments(d, id, { windows: [win({ peakFrame: 100, fromFrame: 0, toFrame: 300 }), win({ peakFrame: 500, fromFrame: 400, toFrame: 700 }), win({ peakFrame: 800, fromFrame: 720, toFrame: 899 })] });
      list.push(id);
    }
    withSong(d, 120, 300);
    const p = plan(d, { assetIds: list, musicAssetId: 'mus', targetSeconds: 90 });
    expect(p.picks.length).toBeLessThanOrEqual(FILM.maxPicks);
    expect(p.ops.length).toBeLessThanOrEqual(FILM.maxOps);
    expect(p.slots.length).toBeLessThanOrEqual(FILM.maxSlots);
    expect(p.steps.length).toBeLessThanOrEqual(FILM.maxSteps);
    expect(p.basis.length).toBeLessThanOrEqual(FILM.maxSteps);
    for (const s of [...p.steps, ...p.basis]) expect(s.length).toBeLessThanOrEqual(FILM.maxStepChars);
    for (const k of p.picks) expect(k.reasons.length).toBeLessThanOrEqual(FILM.maxReasons);
    expect(FamilyFilmParamsSchema.safeParse(JSON.parse(JSON.stringify(p.params))).success).toBe(true);
    const picked = p.picks.map((k) => ({ key: k.key, assetId: k.assetId, kind: k.kind, windowIndex: k.windowIndex, reasons: k.reasons }));
    expect(JSON.stringify({ ...p.params, picked }).length).toBeLessThanOrEqual(FILM.runRecordBytes);
    applied(d, p);
  });
  it('60 stale window choices do not push the draft label, the heuristic line or the faces note out of the basis', () => {
    const d = clips(60, 12);
    const window = Object.fromEntries(ids(60).map((id) => [id, 2]));
    const p = plan(d, { assetIds: ids(60), targetSeconds: 90, picks: { window } });
    expect(p.basis.length).toBeLessThanOrEqual(FILM.maxSteps);
    expect(p.basis).toContain(FAMILY_FILM_FACES_NOTE);
    expect(p.basis.some((s) => s.includes(FAMILY_FILM_DRAFT_LABEL.en))).toBe(true);
    expect(p.basis.some((s) => /have measured moments \(heuristic/.test(s))).toBe(true);
    const notes = p.basis.filter((s) => /was asked for|were asked for/.test(s));
    expect(notes.length).toBe(1);
    expect(notes[0]).toMatch(/60 window choices/);
  });
});

describe('words', () => {
  it('no plan text says best, score, quality or viral, in English or Hebrew', () => {
    expect(allText.length).toBeGreaterThan(100);
    for (const s of allText) { expect(s).not.toMatch(FILM_FORBIDDEN_WORDS); expect(s).not.toMatch(FILM_FORBIDDEN_WORDS_HE); }
  });
});
