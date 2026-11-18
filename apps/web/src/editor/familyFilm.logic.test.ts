/** Pure logic of the family film UI (ADR-0026): params, rows, window cycle, pick edits, the measure/plan state machine, the poller, sprite tile, strip geometry, swaps. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { ApiFailure } from '../api.ts';
import { FamilyFilmParamsSchema, type Asset, type FamilyFilmParams, type FamilyFilmPlanView, type FilmExclusion, type MediaClip, type MomentsData, type ProjectDocument } from '@pulseframe/core';
import {
  buildParams, choicesOf, defaultChoices, filmFailure, filmFlow, findFilmTransaction, formatCapture, nextBlocked, nextWindow, otherLengths, otherMomentsParams, parseStage, planRows, progressDue, runMeasurement, spriteStyle, spriteTileIndex, stripGeometry,
  windowSourceIn, withIncluded, withNextWindow, withOtherClip, withRemoved, MAX_FILM_ASSETS, FILM_PROGRESS_EVERY_MS,
  type FilmFlowEvent, type FilmFlowState,
} from './familyFilm.logic.ts';

const rate = { num: 30, den: 1 };
const base: FamilyFilmParams = { assetIds: ['a', 'b', 'c'], targetSeconds: 60, order: 'capture', ownSound: 'under', lang: 'he' };
const view = (over: Partial<FamilyFilmPlanView> = {}): FamilyFilmPlanView => ({ revision: 7, needsMeasurement: [], picks: [], excluded: [], warnings: [], blocking: [], alternatives: [], params: { assetIds: [] }, predicted: { offGridCuts: [], seconds: 60 }, ...over } as unknown as FamilyFilmPlanView);

describe('buildParams / choicesOf', () => {
  it('starts from defaults: everything chosen, 60 s, capture order, own sound under, no music; schema accepts it', () => {
    const c = defaultChoices({ assetIds: ['a', 'b', 'a'], event: { id: 'e1', name: 'יום הולדת', date: '2024-03-15' } }, 'he');
    expect(c).toMatchObject({ assetIds: ['a', 'b'], targetSeconds: 60, musicAssetId: null, ownSound: 'under', order: 'capture' });
    const p = buildParams(c);
    expect(p).toEqual({ assetIds: ['a', 'b'], event: { id: 'e1', name: 'יום הולדת', date: '2024-03-15' }, targetSeconds: 60, order: 'capture', ownSound: 'under', lang: 'he' });
    expect(FamilyFilmParamsSchema.safeParse(p).success).toBe(true);
  });
  it('round-trips: buildParams(choicesOf(p)) equals p (picks, music, text, event)', () => {
    const p: FamilyFilmParams = { ...base, event: { name: 'חג' }, musicAssetId: 'm', openingText: 'שלום', picks: { exclude: ['c'], include: ['b'], window: { a: 2 } }, ownSound: 'lead', order: 'arc', targetSeconds: 30 };
    expect(buildParams(choicesOf(p))).toEqual(p);
    expect(FamilyFilmParamsSchema.safeParse(p).success).toBe(true);
    expect(buildParams(choicesOf(base))).toEqual(base);
  });
  it('drops empty picks, blank text and out-of-range windows; include never repeats an exclude; keeps "__proto__" as an own key', () => {
    const c = { ...defaultChoices({ assetIds: ['a'], event: null }, 'en'), openingText: '   ', picks: { exclude: ['x', 'x'], include: ['x', 'y'], window: { a: 9, b: 1 } } };
    const p = buildParams(c);
    expect(p.openingText).toBeUndefined(); expect(p.picks).toEqual({ exclude: ['x'], include: ['y'], window: { b: 1 } });
    const q = withNextWindow(base, '__proto__', null, 3);
    expect(Object.hasOwn(q.picks!.window!, '__proto__')).toBe(true);
    expect(FamilyFilmParamsSchema.safeParse(q).success).toBe(true);
  });
  it('disables the next step with a Hebrew message that names the limit', () => {
    const many = { assetIds: Array.from({ length: MAX_FILM_ASSETS + 1 }, (_, i) => `a${i}`) };
    expect(nextBlocked(many, 'he')).toBe(`יותר מ־${MAX_FILM_ASSETS} קבצים: אפשר לבחור עד ${MAX_FILM_ASSETS}`);
    expect(nextBlocked({ assetIds: [] }, 'he')).toBeTruthy();
    expect(nextBlocked({ assetIds: ['a'] }, 'he')).toBeNull();
  });
});

describe('plan rows', () => {
  it('words the span, the seconds on the project rate and keeps film order', () => {
    const doc = { settings: { frameRate: rate }, assets: { a: { name: 'סבתא.mp4' } } } as unknown as ProjectDocument;
    const v = view({ picks: [
      { key: 'm2', assetId: 'a', order: 1, startFrame: 120, frames: 60, span: { count: 1, unit: 'bar' }, sourceInFrame: 0, sourceFrames: 60, kind: 'measured', windowIndex: 0, windowsAvailable: 2, reasons: [], captureAt: '2024-03-15T17:30:00', ownSound: true },
      { key: 'm1', assetId: 'z', order: 0, startFrame: 0, frames: 120, span: { count: 2, unit: 'beat' }, sourceInFrame: null, sourceFrames: null, kind: 'still', windowIndex: null, windowsAvailable: 0, reasons: [{ code: 'still' }], captureAt: null, ownSound: false },
    ] as never });
    const rows = planRows(v, doc, 'he');
    expect(rows.map((r) => r.key)).toEqual(['m1', 'm2']);
    expect(rows[0]).toMatchObject({ name: 'z', seconds: 4, span: '2 פעימות', still: true, canSwapWindow: false });
    expect(rows[1]).toMatchObject({ name: 'סבתא.mp4', seconds: 2, span: 'תיבה אחת', canSwapWindow: true });
    expect(formatCapture('2024-03-15T17:30:00', 'he')).toBe('15.3.2024 · 17:30');
    expect(formatCapture('2024-03-15', 'en')).toBe('2024-03-15');
    expect(formatCapture(null, 'he')).toBeNull();
  });
});

describe('the window cycle and the pick edits', () => {
  it('wraps over windowsAvailable and is null when there is no other', () => {
    expect(nextWindow(null, 3)).toBe(0); expect(nextWindow(0, 3)).toBe(1); expect(nextWindow(2, 3)).toBe(0);
    expect(nextWindow(0, 1)).toBeNull(); expect(nextWindow(null, 0)).toBeNull(); expect(nextWindow(5, 0)).toBeNull();
    expect(withNextWindow(base, 'a', 0, 1)).toBe(base);
    expect(withNextWindow(withNextWindow(base, 'a', null, 2), 'a', 0, 2).picks?.window).toEqual({ a: 1 });
    expect(withNextWindow(base, 'a', 1, 2).picks?.window).toEqual({ a: 0 });
  });
  it('removes, includes and swaps clips', () => {
    const removed = withRemoved({ ...base, picks: { window: { a: 1 }, include: ['a'] } }, 'a');
    expect(removed.picks).toEqual({ exclude: ['a'] });
    const noRoom: FilmExclusion = { assetId: 'c', code: 'no_room', details: {} };
    expect(withIncluded(base, noRoom)?.picks).toEqual({ include: ['c'] });
    expect(withIncluded({ ...base, picks: { exclude: ['c'] } }, { assetId: 'c', code: 'excluded_by_you', details: {} })).toEqual(base);
    for (const code of ['too_short', 'no_picture', 'kept_by_hand'] as const) expect(withIncluded(base, { assetId: 'c', code, details: {} })).toBeNull();
    const swapped = withOtherClip({ ...base, picks: { window: { a: 1, c: 2 } } }, 'a', 'c');
    expect(swapped.picks).toEqual({ exclude: ['a'], include: ['c'] });
    expect(withOtherClip(base, 'a', 'a')).toBe(base);
    expect(FamilyFilmParamsSchema.safeParse(swapped).success).toBe(true);
    expect(withOtherClip(base, 'a', 'new').assetIds).toEqual(['a', 'b', 'c', 'new']);
  });
  it('«רגעים אחרים» moves only the measured picks that have another window', () => {
    const doc = { analyses: { a: { moments: { windows: [{}, {}] } }, b: { moments: { windows: [{}] } } } } as unknown as ProjectDocument;
    const picked = [{ key: 'k1', assetId: 'a', kind: 'measured', windowIndex: 0, reasons: [] }, { key: 'k2', assetId: 'b', kind: 'measured', windowIndex: 0, reasons: [] }, { key: 'k3', assetId: 'c', kind: 'still', windowIndex: null, reasons: [] }] as never;
    expect(otherMomentsParams(base, picked, doc)?.picks?.window).toEqual({ a: 1 });
    expect(otherMomentsParams(base, [picked[1]], doc)).toBeNull();
    expect(otherLengths(60)).toEqual([30, 90]); expect(otherLengths(undefined)).toEqual([30, 90]);
  });
});

describe('the measure / plan state machine', () => {
  const run = (s: FilmFlowState, evs: FilmFlowEvent[]) => { let st = s; const effects: unknown[] = []; for (const e of evs) { const r = filmFlow(st, e); st = r.state; effects.push(r.effect); } return { st, effects }; };
  it('plan → measure → plan → ready', () => {
    const r = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'planned', view: view({ needsMeasurement: ['a', 'b'] }) }, { type: 'measure-started', jobId: 'j1', total: 2 }, { type: 'measure-progress', done: 1, total: 2 }, { type: 'measure-finished', ok: true }, { type: 'planned', view: view() }]);
    expect(r.effects).toEqual([{ kind: 'plan' }, { kind: 'measure', assetIds: ['a', 'b'] }, null, null, { kind: 'plan' }, null]);
    expect(r.st.phase).toBe('ready');
  });
  it('a file that fails to decode (still listed after the measurement) does not loop: it is measured once and planned as not measured', () => {
    const still = view({ needsMeasurement: ['a'] });
    const r = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'planned', view: still }, { type: 'measure-finished', ok: false }, { type: 'planned', view: still }]);
    expect(r.effects).toEqual([{ kind: 'plan' }, { kind: 'measure', assetIds: ['a'] }, { kind: 'plan' }, null]);
    expect(r.st).toMatchObject({ phase: 'ready', measured: ['a'] });
  });
  it('cancel asks for the job to be canceled; a canceled measurement plans again; a cached one too', () => {
    const m = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'planned', view: view({ needsMeasurement: ['a'] }) }, { type: 'measure-started', jobId: 'j', total: 1 }]);
    expect(filmFlow(m.st, { type: 'cancel' }).effect).toEqual({ kind: 'cancel', jobId: 'j' });
    expect(filmFlow(m.st, { type: 'measure-canceled' }).effect).toEqual({ kind: 'plan' });
    expect(filmFlow(m.st, { type: 'measure-cached' }).effect).toEqual({ kind: 'plan' });
    expect(filmFlow({ phase: 'measuring', jobId: null, done: 0, total: 1, measured: ['a'] }, { type: 'cancel' }).effect).toBeNull();
  });
  it('a job that starts after the dialog left measuring is canceled, not left running', () => {
    expect(filmFlow({ phase: 'ready', view: view(), measured: [] }, { type: 'measure-started', jobId: 'late', total: 1 }).effect).toEqual({ kind: 'cancel', jobId: 'late' });
  });
  it('refusals end in refused with the step they came from; the plan step can be entered again', () => {
    const a = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'refused', status: 501, code: 'film_not_built', message: 'm' }]);
    expect(a.st).toMatchObject({ phase: 'refused', code: 'film_not_built', at: 'plan' });
    expect(filmFlow(a.st, { type: 'enter-plan' }).effect).toEqual({ kind: 'plan' });
    const b = run({ phase: 'ready', view: view(), measured: [] }, [{ type: 'apply' }, { type: 'refused', status: 409, code: 'film_blocked', message: 'x' }]);
    expect(b.st).toMatchObject({ phase: 'refused', at: 'apply' });
    const c = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'planned', view: view({ needsMeasurement: ['a'] }) }, { type: 'measure-started', jobId: 'j', total: 1 }, { type: 'refused', status: 403, code: 'x', message: 'y' }]);
    expect(c.st).toMatchObject({ phase: 'refused', at: 'measure' }); expect(c.effects[3]).toEqual({ kind: 'cancel', jobId: 'j' });
  });
  it('a refused measurement start still plans the film, with the refusal as a note; every refusal can be retried', () => {
    const m = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'planned', view: view({ needsMeasurement: ['a'] }) }, { type: 'refused', status: 501, code: 'moments_not_built', message: 'nm' }]);
    expect(m.st).toEqual({ phase: 'planning', measured: ['a'], note: { code: 'moments_not_built', message: 'nm' } });
    expect(m.effects[2]).toEqual({ kind: 'plan' });
    const r = filmFlow(m.st, { type: 'planned', view: view({ needsMeasurement: ['a'] }) });
    expect(r.state).toMatchObject({ phase: 'ready', note: { code: 'moments_not_built' } }); expect(r.effect).toBeNull();
    const p = run({ phase: 'idle' }, [{ type: 'enter-plan' }, { type: 'refused', status: 500, code: 'x', message: 'y' }]);
    expect(filmFlow(p.st, { type: 'retry' })).toEqual({ state: { phase: 'planning', measured: [] }, effect: { kind: 'plan' } });
    expect(filmFlow({ phase: 'idle' }, { type: 'retry' }).effect).toBeNull();
  });
  it('a revision conflict on apply plans again, with the revision of the plan on a good apply, and closes', () => {
    const ready: FilmFlowState = { phase: 'ready', view: view({ revision: 12 }), measured: ['a'] };
    const ap = filmFlow(ready, { type: 'apply' });
    expect(ap.effect).toEqual({ kind: 'apply', revision: 12 });
    const stale = filmFlow(ap.state, { type: 'refused', status: 409, code: 'stale_revision', message: 's' });
    expect(stale.effect).toEqual({ kind: 'plan' }); expect(stale.state).toEqual({ phase: 'planning', measured: ['a'] });
    expect(filmFlow(ap.state, { type: 'applied' }).effect).toEqual({ kind: 'close' });
    // a stale answer while only planning is a refusal, never a loop
    expect(filmFlow({ phase: 'planning', measured: [] }, { type: 'refused', status: 409, code: 'stale_revision', message: 's' }).state.phase).toBe('refused');
  });
  it('a pick edit while ready plans again; while applying or measuring it waits', () => {
    expect(filmFlow({ phase: 'ready', view: view(), measured: [] }, { type: 'params-changed' }).effect).toEqual({ kind: 'plan' });
    expect(filmFlow({ phase: 'applying', view: view(), measured: [] }, { type: 'params-changed' }).effect).toBeNull();
  });
  it('progress updates at most twice a second', () => {
    expect(FILM_PROGRESS_EVERY_MS).toBeGreaterThanOrEqual(500);
    expect(progressDue(null, 0)).toBe(true); expect(progressDue(1000, 1200)).toBe(false); expect(progressDue(1000, 1500)).toBe(true);
  });
});

describe('the measurement poller', () => {
  const sleeper = () => { const slept: number[] = []; return { slept, sleep: async (ms: number) => { slept.push(ms); } }; };
  it('returns cached without a job; follows a job to its end with progress; reports failed and canceled', async () => {
    const s = sleeper();
    expect(await runMeasurement({ start: async () => ({ cached: true, revision: 3 }), job: async () => ({ status: 'x' }), sleep: s.sleep }, ['a'])).toBe('cached');
    const statuses = [{ status: 'running', stage: 'measuring moments 1/2' }, { status: 'running', stage: 'measuring moments 2/2' }, { status: 'succeeded' }];
    const seen: [number, number][] = []; let jobSeen = '';
    expect(await runMeasurement({ start: async () => ({ jobId: 'j', status: 'queued' }), job: async () => statuses.shift()!, sleep: s.sleep }, ['a', 'b'], { onJob: (id) => { jobSeen = id; }, onProgress: (d, t) => seen.push([d, t]) })).toBe('succeeded');
    expect(jobSeen).toBe('j'); expect(seen).toEqual([[1, 2], [2, 2]]); expect(s.slept.every((ms) => ms >= 500)).toBe(true);
    for (const end of ['failed', 'canceled'] as const) expect(await runMeasurement({ start: async () => ({ jobId: 'j', status: 'queued' }), job: async () => ({ status: end }), sleep: s.sleep }, ['a'])).toBe(end);
    expect(await runMeasurement({ start: async () => ({ jobId: 'j', status: 'queued' }), job: async () => ({ status: 'running' }), sleep: s.sleep }, ['a'], { stopped: () => true })).toBe('canceled');
  });
  it('lets a refusal of the start call through', async () => {
    await expect(runMeasurement({ start: async () => { throw new Error('501'); }, job: async () => ({ status: 'x' }), sleep: async () => undefined }, ['a'])).rejects.toThrow('501');
    expect(parseStage('measuring moments 3/10')).toEqual({ done: 3, total: 10 }); expect(parseStage(null)).toBeNull();
  });
});

describe('pictures', () => {
  it('finds the sprite tile nearest a source frame (evenly spaced tiles) and its CSS', () => {
    expect(spriteTileIndex(0, 300, 10)).toBe(0); expect(spriteTileIndex(150, 300, 10)).toBe(5); expect(spriteTileIndex(299, 300, 10)).toBe(9); expect(spriteTileIndex(900, 300, 10)).toBe(9); expect(spriteTileIndex(5, 300, 1)).toBe(0); expect(spriteTileIndex(-4, 300, 10)).toBe(0);
    expect(spriteStyle(5, 2, 0)).toEqual({ backgroundSize: '500% 200%', backgroundPosition: '0% 0%' });
    expect(spriteStyle(5, 2, 9)).toEqual({ backgroundSize: '500% 200%', backgroundPosition: '100% 100%' });
  });
  const data = (offset: number): MomentsData => ({
    algo: 1, method: 'm', asset: { contentHash: 'h', frames: 300, rate, startOffsetFrames: offset, measuredFrames: 300, truncated: false },
    picture: { source: 'proxy', step: 6, count: 50, width: 1, height: 1, luma: [], sharp: [], inner: Array.from({ length: 50 }, (_, i) => i * 10), pan: [], change: [], gated: [], digest: '' },
    sound: { source: 'waveform-peaks', hopMs: 100, count: 100, level: Array.from({ length: 100 }, () => -300) }, file: { motion: 10, level: -300 }, flat: false, windows: [],
  } as unknown as MomentsData);
  it('lays the strip out left to right with the chosen window marked, counting the picture\'s start offset', () => {
    const g = stripGeometry(data(0), { fromFrame: 60, toFrame: 120, peakFrame: 90 }, 200, 40);
    expect(g.inner.startsWith('M0 ')).toBe(true); expect(g.level.startsWith('M0 ')).toBe(true);
    expect(g.window).toEqual({ x: 40, width: 40, peakX: 60 });
    const late = stripGeometry(data(30), { fromFrame: 60, toFrame: 120, peakFrame: 90 }, 200, 40);
    // picture 30 frames late: frame f is at (f + 30) / 30 s of an 11 s file, so the window [60, 120) sits at 3–5 s, the peak at 4 s
    expect(late.window).toEqual({ x: 54.5, width: 36.4, peakX: 72.7 });
    expect(stripGeometry({ ...data(0), picture: null, sound: null }, null, 100, 20)).toEqual({ inner: '', level: '', window: null });
    expect(g.inner.split('L').length).toBeLessThanOrEqual(120);
  });
});

describe('swaps', () => {
  const asset = (frames: number): Asset => ({ id: 'a', kind: 'video', name: 'a', duration: T.frameTime(frames, rate), video: { width: 1, height: 1, frameRate: rate, codec: 'h264', rotation: 0, frameCount: frames } } as unknown as Asset);
  const clip = (frames: number): MediaClip => ({ id: 'c', type: 'media', assetId: 'a', start: T.ZERO, duration: T.frameTime(frames, rate), sourceIn: T.ZERO } as unknown as MediaClip);
  it('centres the clip on the window peak and keeps it inside the file and the clean stretch', () => {
    const at = (w: { fromFrame: number; toFrame: number; peakFrame: number } | null, a = asset(300)) => windowSourceIn(a, clip(60), w);
    expect(T.frameIndexAt(at({ fromFrame: 100, toFrame: 220, peakFrame: 160 })!, rate)).toBe(130);
    expect(T.frameIndexAt(at({ fromFrame: 100, toFrame: 220, peakFrame: 105 })!, rate)).toBe(100);
    expect(T.frameIndexAt(at({ fromFrame: 100, toFrame: 300, peakFrame: 299 })!, rate)).toBe(240);
    expect(T.frameIndexAt(at(null)!, rate)).toBe(0);
    expect(at({ fromFrame: 0, toFrame: 10, peakFrame: 5 }, asset(30))).toBeNull();
  });
  it('counts a late picture: sourceIn is the asset time of the frame', () => {
    const a = { ...asset(300), video: { ...asset(300).video!, startTime: T.frameTime(6, rate) } } as Asset;
    const t = windowSourceIn(a, clip(60), { fromFrame: 100, toFrame: 220, peakFrame: 160 })!;
    expect(T.frameIndexAt(t, rate)).toBe(136);
  });
});

describe('the film transaction', () => {
  it('finds the newest apply_template that touched the run\'s clips', () => {
    const ev = (transactionId: string, ops: string[], affectedIds: string[]) => ({ transactionId, ops, affectedIds, revision: 1 }) as never;
    expect(findFilmTransaction([ev('t3', ['trim_clip'], ['c1']), ev('t2', ['apply_template'], ['x', 'c1']), ev('t1', ['apply_template'], ['c1'])], ['c1'])).toBe('t2');
    expect(findFilmTransaction([ev('t1', ['apply_template'], ['other'])], ['c1'])).toBeNull();
    expect(findFilmTransaction([], ['c1'])).toBeNull(); // the bar then disables its undo instead of undoing the newest edit
  });
});

describe('refusal wording', () => {
  const f = (code: string, message: string, hint: string) => new ApiFailure(501, code, message, undefined, hint);
  it('Hebrew refusals carry no English hint and do not repeat the headline', () => {
    const m = filmFailure('he', f('film_not_built', 'the family film maker is not built in this version yet', 'Nothing was changed. Recipes and templates still work.')).message;
    expect(m).not.toMatch(/[A-Za-z]{4}/); expect(m.split('יצירת סרט משפחתי עדיין לא נבנתה').length).toBe(3 - 1); // the headline once
    const h = filmFailure('he', f('film_blocked', 'the plan has a blocking problem', 'See the plan: choose another length, other music or other clips.')).message;
    expect(h).not.toContain('See the plan');
  });
  it('English keeps the hint', () => { expect(filmFailure('en', f('film_blocked', 'm', 'See the plan.')).message).toContain('See the plan.'); });
});
