/**
 * Perform capture (ADR-0025). The state machine, pad status, asset resolution and the plan/live helpers. The planner functions
 * of core moves.ts are not in this tree's worker branch yet, so the plan helpers run against a labelled stand-in planner (test
 * only) that returns fixed args; the op that applies them (apply_take) and the documents are real.
 */
import { describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, DEFAULT_QUANTISE, MAX_TAKE_HITS, type Chip, type MoveSpec, type PadBank, type PlannedTake, type ProjectDocument, type Tap } from '@pulseframe/core';
import { countChips, liveDocument, markStrobeHolds, moveChangesLight, moveNeedsGpu, padStatus, planTake, resolvePadAssets, TapCapture, type CaptureEnv, type Planner, type TakeContext } from './capture.ts';

const key = (code: string, extra: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean; timeStamp: number }> = {}) => ({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, timeStamp: 1000, ...extra });
function mk(over: Partial<CaptureEnv> = {}) {
  const state = { now: 10, changes: 0, downs: [] as number[], ctx: { performActive: true, multicamDigitsLive: false, typing: false, modalOpen: false }, offset: 0 };
  const env: CaptureEnv = {
    timelineSecondsAt: (ms) => (ms === -1 ? null : state.now + (ms - 1000) / 1000), // the audio clock stand-in: 1000 ms of performance time is timeline second `now`
    offsetSeconds: () => state.offset, keyContext: () => state.ctx, onChange: () => { state.changes++; }, onPadDown: (p) => state.downs.push(p), ...over,
  };
  const c = new TapCapture(env);
  c.recording = true;
  return { c, state };
}

describe('TapCapture keys', () => {
  it('a key down and up make one tap from the event time on the audio clock, less the calibration', () => {
    const { c, state } = mk();
    state.offset = 0.05;
    expect(c.keyDown(key('Digit3', { timeStamp: 1000 }))).toBe(true);
    expect(c.keyUp(key('Digit3', { timeStamp: 1500 }))).toBe(true);
    expect(c.snapshot()).toEqual([{ pad: 2, down: 9.95, up: 10.45 }]);
    expect(state.downs).toEqual([2]);
  });
  it('numpad keys press the same pads; Digit9, Digit0 and letters are not pads', () => {
    const { c } = mk();
    expect(c.keyDown(key('Numpad8'))).toBe(true);
    expect(c.keyDown(key('Digit9'))).toBe(false);
    expect(c.keyDown(key('Digit0'))).toBe(false);
    expect(c.keyDown(key('KeyA'))).toBe(false);
    expect(c.snapshot().map((t) => t.pad)).toEqual([7]);
  });
  it('auto-repeat is ignored: a held key is one tap', () => {
    const { c } = mk();
    expect(c.keyDown(key('Digit1', { timeStamp: 1000 }))).toBe(true);
    for (let i = 1; i < 6; i++) expect(c.keyDown(key('Digit1', { repeat: true, timeStamp: 1000 + i * 30 }))).toBe(false);
    expect(c.keyDown(key('Digit1', { timeStamp: 1200 }))).toBe(false); // a second down without an up (a stray event) does not start another tap
    expect(c.count).toBe(1);
  });
  it('a modifier makes it not a pad: Shift+7 (mode), Alt+digit (rail), Ctrl and Meta+digit', () => {
    const { c } = mk();
    for (const m of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'] as const) expect(c.keyDown(key('Digit1', { [m]: true }))).toBe(false);
    expect(c.count).toBe(0);
  });
  it('is ignored while typing, under a modal, while multicam owns the digits, and when the mode is not perform', () => {
    const { c, state } = mk();
    for (const k of ['typing', 'modalOpen', 'multicamDigitsLive'] as const) { state.ctx = { performActive: true, multicamDigitsLive: false, typing: false, modalOpen: false, [k]: true }; expect(c.keyDown(key('Digit1'))).toBe(false); }
    state.ctx = { performActive: false, multicamDigitsLive: false, typing: false, modalOpen: false };
    expect(c.keyDown(key('Digit1'))).toBe(false);
    expect(c.count).toBe(0);
  });
  it('is ignored when no take is recorded and when nothing plays (no audio clock reading)', () => {
    const { c } = mk();
    c.recording = false;
    expect(c.keyDown(key('Digit1'))).toBe(false);
    c.recording = true;
    expect(c.keyDown(key('Digit1', { timeStamp: -1 }))).toBe(false);
    expect(c.ignoredNotPlaying).toBe(1);
    expect(c.count).toBe(0);
  });
  it('key-up closes the hit it opened even with a modifier now down or the focus in a field; two pads overlap', () => {
    const { c } = mk();
    c.keyDown(key('Digit1', { timeStamp: 1000 }));
    c.keyDown(key('Digit2', { timeStamp: 1100 }));
    expect(c.heldPads()).toEqual(new Set([0, 1]));
    expect(c.keyUp({ code: 'Digit1', timeStamp: 1300 })).toBe(true);
    expect(c.heldPads()).toEqual(new Set([1]));
    expect(c.keyUp({ code: 'Digit2', timeStamp: 1600 })).toBe(true);
    expect(c.keyUp({ code: 'Digit2', timeStamp: 1700 })).toBe(false);
    expect(c.snapshot()).toEqual([{ pad: 0, down: 10, up: 10.3 }, { pad: 1, down: 10.1, up: 10.6 }]);
  });
  it('blur closes every open hit at the blur time (no key-up will come)', () => {
    const { c } = mk();
    c.keyDown(key('Digit1', { timeStamp: 1000 }));
    c.pointerDown(4, 7, 1100);
    expect(c.blur(1800)).toBe(2);
    expect(c.heldPads().size).toBe(0);
    expect(c.snapshot()).toEqual([{ pad: 0, down: 10, up: 10.8 }, { pad: 4, down: 10.1, up: 10.8 }]);
    expect(c.blur(2000)).toBe(0);
  });
  it('a pad that is not ready (empty, hidden, disabled with a reason) takes no tap', () => {
    const { c } = mk({ padUsable: (p) => p !== 2 });
    expect(c.keyDown(key('Digit3'))).toBe(false);
    expect(c.pointerDown(2, 1, 1000)).toBe(false);
    expect(c.keyDown(key('Digit4'))).toBe(true);
    expect(c.count).toBe(1);
  });
  it('a pad held by one source cannot be pressed again by another until it is released', () => {
    const { c } = mk();
    c.keyDown(key('Digit1', { timeStamp: 1000 }));
    expect(c.pointerDown(0, 3, 1100)).toBe(false);
    c.keyUp({ code: 'Digit1', timeStamp: 1200 });
    expect(c.pointerDown(0, 3, 1300)).toBe(true);
    expect(c.pointerUp(3, 1500)).toBe(true);
    expect(c.pointerDown(9, 4, 1600)).toBe(false);
  });
  it('the snapshot closes open hits provisionally at the clock without changing them; closeAll ends them at the stop', () => {
    const { c } = mk();
    c.keyDown(key('Digit5', { timeStamp: 1000 }));
    expect(c.snapshot(12)).toEqual([{ pad: 4, down: 10, up: 12 }]);
    expect(c.snapshot(11)).toEqual([{ pad: 4, down: 10, up: 11 }]);
    expect(c.snapshot(5)).toEqual([{ pad: 4, down: 10, up: 10 }]);
    c.closeAll(13);
    expect(c.snapshot()).toEqual([{ pad: 4, down: 10, up: 13 }]);
  });
  it('the 201st tap is marked (held take_full by the planner); the 200th is not', () => {
    const { c } = mk();
    for (let i = 0; i < MAX_TAKE_HITS + 3; i++) { c.pointerDown(i % 8, 1, 1000 + i * 10); c.pointerUp(1, 1005 + i * 10); }
    expect(c.count).toBe(MAX_TAKE_HITS + 3);
    expect(c.isOver(MAX_TAKE_HITS - 1)).toBe(false);
    expect(c.isOver(MAX_TAKE_HITS)).toBe(true);
    expect(c.overCount).toBe(3);
  });
  it('presses past the request limit (1000) are dropped and counted, never stored', () => {
    const { c } = mk();
    const taps: Tap[] = Array.from({ length: 1005 }, (_, i) => ({ pad: i % 8, down: i, up: i + 0.1 }));
    expect(c.inject(taps)).toBe(1000);
    expect(c.dropped).toBe(5);
  });
  it('inject keeps valid taps and tells the view (the proof hook)', () => {
    const { c, state } = mk();
    expect(c.inject([{ pad: 1, down: 2, up: 2.1 }, { pad: 8, down: 3, up: 3.1 }, { pad: 2, down: 5, up: 4 }])).toBe(1);
    expect(state.changes).toBe(1);
    c.reset();
    expect(c.count).toBe(0);
  });
  it('tells the view at most what changed: a press and a release are each one change', () => {
    const { c, state } = mk();
    c.keyDown(key('Digit1')); c.keyUp({ code: 'Digit1', timeStamp: 1100 });
    expect(state.changes).toBe(2);
  });
});

// ---- pads and assets
const adjust = (type: string, id = `move.${type.replace(/\./g, '-')}`): MoveSpec => ({ id, kind: 'adjust', minSeconds: 0.1, effects: [{ type }], fadeOutSeconds: 0.2 } as MoveSpec);
const punch: MoveSpec = { id: 'move.punch', kind: 'punch', minSeconds: 0.1, scale: 1.2, releaseSeconds: 0.2 };
const sound: MoveSpec = { id: 'move.hit', kind: 'sound', minSeconds: 0.1, source: { sfxId: 'sfx.boom' }, gain: 1 };
const sticker: MoveSpec = { id: 'move.star', kind: 'sticker', minSeconds: 0.5, source: { elementId: 'element.symbol.star' } };
const ctx0 = { gpu: true, hasBeats: true, noFlashes: false, asset: null as string | null };

describe('pad status', () => {
  it('empty, ready, and the three honest reasons', () => {
    expect(padStatus(null, ctx0)).toEqual({ state: 'empty' });
    expect(padStatus(punch, ctx0)).toEqual({ state: 'ready' });
    expect(padStatus(adjust('motion.shake'), { ...ctx0, gpu: false })).toEqual({ state: 'disabled', reason: 'needs_gpu' });
    expect(padStatus(adjust('motion.shake'), ctx0)).toEqual({ state: 'ready' });
    expect(padStatus(adjust('light.strobe'), { ...ctx0, hasBeats: false })).toEqual({ state: 'disabled', reason: 'no_music' });
    expect(padStatus(sound, ctx0)).toEqual({ state: 'disabled', reason: 'missing_asset' });
    expect(padStatus(sound, { ...ctx0, asset: 'ast_1' })).toEqual({ state: 'ready' });
    expect(padStatus(sticker, ctx0)).toEqual({ state: 'disabled', reason: 'missing_asset' });
  });
  it('the no-flashes switch hides pads that change light, derived from the planner\'s own classifier, and keeps the neutral ones', () => {
    expect(moveChangesLight(adjust('light.strobe'))).toBe(true);
    expect(moveChangesLight(adjust('color.invert'))).toBe(true);
    expect(moveChangesLight(adjust('blur.gaussian'))).toBe(false); // a neutral effect (FLASH_TABLE_V1)
    expect(moveChangesLight(punch)).toBe(false);
    expect(padStatus(adjust('color.invert'), { ...ctx0, noFlashes: true })).toEqual({ state: 'hidden' });
    expect(padStatus(adjust('blur.gaussian'), { ...ctx0, noFlashes: true })).toEqual({ state: 'ready' });
  });
  it('needs a graphics adapter is derived from the effects (cost gpu), never declared', () => {
    expect(moveNeedsGpu(adjust('motion.shake'))).toBe(true);
    expect(moveNeedsGpu(adjust('blur.gaussian'))).toBe(false);
    expect(moveNeedsGpu(punch)).toBe(false);
  });
});

const prov = (id: string) => ({ origin: 'generated' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test', procedural: { id, version: 1, generator: 'test' } });
const imgAsset = (name: string, id?: string) => ({ kind: 'image' as const, name, contentHash: `sha256:${(id ? 'c' : 'a').repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 36, codec: 'png', hasAlpha: true }, provenance: id ? prov(id) : { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' } });
const sndAsset = (id: string) => ({ kind: 'audio' as const, name: 'x.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(1, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov(id) });
let n = 0;
const R = { num: 30, den: 1 };
function project() {
  let r = applyTransaction(createProject({ id: 'prj_pc', name: 'PC', frameRate: R, width: 320, height: 180 }), [
    { op: 'import_asset', args: { asset: imgAsset('a.png') } }, { op: 'import_asset', args: { asset: sndAsset('sfx.boom') } }, { op: 'import_asset', args: { asset: imgAsset('star.png', 'element.symbol.star') } },
  ] as never, { idSeed: `pc${n++}_`, actor: 'test', allowInternal: true });
  const [I, S, E] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = applyTransaction(r.doc, [{ op: 'add_clip', args: { assetId: I, start: T.ZERO, duration: T.rt(10, 1) } }], { idSeed: `pc${n++}_`, actor: 'test' });
  return { doc: r.doc, clip: r.results[0]!.output!.clipId as string, S, E };
}

describe('resolvePadAssets', () => {
  it('finds the library asset a catalogue id was added as, by provenance; null when it is not there', () => {
    const { doc, S, E } = project();
    const bank: PadBank = [punch, sound, sticker, null, null, null, null, { ...sound, id: 'move.other', source: { sfxId: 'sfx.absent' } }];
    expect(resolvePadAssets(doc, bank)).toEqual([null, S, E, null, null, null, null, null]);
  });
});

// ---- plan helpers against a stand-in planner (labelled)
const takeCtx = (doc: ProjectDocument, bank: PadBank): TakeContext => ({ bank, assets: resolvePadAssets(doc, bank), settings: { ...DEFAULT_QUANTISE }, gpu: false });
function planner(clip: string, over: Partial<Planner> = {}): { p: Planner; calls: string[] } {
  const calls: string[] = [];
  const args = (frames = 3) => ({ take: { snap: 'off', tempo: 'normal', parity: 0, strength: 0, taps: 1, hits: 1, held: 0, summary: [] }, steps: [{ op: 'set_clip_transform', args: { clipId: clip, transform: { scale: 1 + frames / 10 } } }] });
  const plan: PlannedTake = { args: args() as never, chips: [{ tap: 0, pad: 0, moveId: 'move.punch', frame: 30, frames: 3, state: 'kept' }], warnings: [] };
  const p: Planner = {
    performGrid: (_d, s) => { calls.push(`grid:${s.snap}`); return [1, 2]; },
    quantiseTaps: (taps, grid, s) => { calls.push(`quantise:${taps.length}:${grid.length}:${s.snap}:${s.strength}`); return taps.map((t, i) => ({ tap: i, pad: t.pad, frame: 30, frames: 3, snapped: false, movedMs: 0 })); },
    planPerformance: (_d, input) => { calls.push(`plan:${input.hits.length}:${input.bank.filter(Boolean).length}`); return plan; },
    flashSchedule: () => ({ fps: 30, gapFrames: 11, shown: new Map(), runOf: new Map(), lights: new Map() }),
    ...over,
  };
  return { p, calls };
}

describe('liveDocument', () => {
  it('plans the RAW taps (snap off, no grid) without sound pads, applies them in memory, and keeps the length', () => {
    const { doc, clip } = project();
    const { p, calls } = planner(clip);
    const r = liveDocument(doc, [{ pad: 0, down: 1, up: 1.1 }, { pad: 1, down: 2, up: 2.1 }], takeCtx(doc, [punch, sound, null, null, null, null, null, null]), p);
    expect(r.doc).not.toBeNull();
    expect(calls).toEqual(['quantise:1:0:off:0', 'plan:1:1']); // the sound pad's tap and the sound pad itself are gone; no grid was asked for
    expect(r.doc!.sequences[r.doc!.mainSequenceId]!.tracks[0]!.clips[0]).toMatchObject({ transform: { scale: 1.3 } });
    expect(doc.sequences[doc.mainSequenceId]!.tracks[0]!.clips[0]).not.toMatchObject({ transform: { scale: 1.3 } }); // the committed document is untouched
  });
  it('is null when only sound pads were tapped, or when the plan keeps nothing', () => {
    const { doc, clip } = project();
    expect(liveDocument(doc, [{ pad: 1, down: 1, up: 1.1 }], takeCtx(doc, [punch, sound, null, null, null, null, null, null]), planner(clip).p).doc).toBeNull();
    const { p } = planner(clip, { planPerformance: () => ({ args: null, chips: [], warnings: [] }) });
    expect(liveDocument(doc, [{ pad: 0, down: 1, up: 1.1 }], takeCtx(doc, [punch, null, null, null, null, null, null, null]), p).doc).toBeNull();
  });
  it('says honestly when the planner is not built, and when a plan is refused; never throws', () => {
    const { doc, clip } = project();
    const built = planner(clip, { quantiseTaps: () => { throw new Error('quantiseTaps is not built yet (perform W1)'); } }).p;
    expect(liveDocument(doc, [{ pad: 0, down: 1, up: 1 }], takeCtx(doc, [punch, null, null, null, null, null, null, null]), built)).toEqual({ doc: null, failure: { kind: 'not_built' } });
    const bad = planner('clp_missing').p;
    const r = liveDocument(doc, [{ pad: 0, down: 1, up: 1 }], takeCtx(doc, [punch, null, null, null, null, null, null, null]), bad);
    expect(r.doc).toBeNull();
    expect(r.failure?.kind).toBe('refused');
  });
});

describe('planTake', () => {
  it('asks the grid, quantises with the settings, plans, and builds the ghost WITH sound pads', () => {
    const { doc, clip } = project();
    const { p, calls } = planner(clip);
    const r = planTake(doc, [{ pad: 0, down: 1, up: 1.1 }], takeCtx(doc, [punch, sound, null, null, null, null, null, null]), p);
    expect('ghost' in r).toBe(true);
    if ('ghost' in r) { expect(r.ghost).not.toBeNull(); expect(r.grid).toBe(2); expect(r.chips).toHaveLength(1); }
    expect(calls).toEqual(['grid:beat', 'quantise:1:2:beat:1', 'plan:1:2']);
  });
  it('snap off asks for no grid', () => {
    const { doc, clip } = project();
    const { p, calls } = planner(clip);
    planTake(doc, [{ pad: 0, down: 1, up: 1.1 }], { ...takeCtx(doc, [punch, null, null, null, null, null, null, null]), settings: { ...DEFAULT_QUANTISE, snap: 'off' } }, p);
    expect(calls[0]).toBe('quantise:1:0:off:1');
  });
  it('returns the failure instead of throwing when the planner is not built', () => {
    const { doc, clip } = project();
    const { p } = planner(clip, { performGrid: () => { throw new Error('performGrid is not built yet (perform W1)'); } });
    expect(planTake(doc, [{ pad: 0, down: 1, up: 1 }], takeCtx(doc, [punch, null, null, null, null, null, null, null]), p)).toEqual({ kind: 'not_built' });
  });
});

describe('markStrobeHolds and counts', () => {
  const strobeBank: PadBank = [adjust('light.strobe'), punch, null, null, null, null, null, null];
  it('a kept strobe chip whose clip shows no flash inside its range is held flash_limit; one that flashes stays kept; other pads are untouched', () => {
    const { doc } = project();
    // two strobe adjustments made by the take (stand-in documents: the strobe clip ids and frames are what is read)
    const withStrobes = structuredClone(doc);
    const seq = withStrobes.sequences[withStrobes.mainSequenceId]!;
    const mkClip = (id: string, startFrame: number) => ({ id, type: 'adjustment', start: T.frameTime(startFrame, R), duration: T.rt(1, 1), effects: [{ id: `${id}_e`, type: 'light.strobe', params: {} }], transform: {} });
    seq.tracks[0]!.clips.push(mkClip('clp_s1', 30) as never, mkClip('clp_s2', 90) as never);
    const chips: Chip[] = [
      { tap: 0, pad: 0, moveId: 'm', frame: 30, frames: 30, state: 'kept' }, { tap: 1, pad: 0, moveId: 'm', frame: 90, frames: 30, state: 'kept' },
      { tap: 2, pad: 1, moveId: 'p', frame: 100, frames: 3, state: 'kept' }, { tap: 3, pad: 0, moveId: 'm', frame: 150, frames: 30, state: 'held', reason: 'no_music' },
    ];
    const { p } = planner('x', { flashSchedule: () => ({ fps: 30, gapFrames: 11, shown: new Map([['clp_s1\nclp_s1_e', Float64Array.from([36, 48])]]), runOf: new Map(), lights: new Map() }) });
    const out = markStrobeHolds(doc, withStrobes, chips, strobeBank, p);
    expect(out.map((c) => [c.state, c.reason])).toEqual([['kept', undefined], ['held', 'flash_limit'], ['kept', undefined], ['held', 'no_music']]);
    expect(countChips(out)).toEqual({ kept: 2, merged: 0, held: 2, byReason: { flash_limit: 1, no_music: 1 } });
  });
  it('with no strobe pad in the bank the schedule is never asked', () => {
    const { doc } = project();
    const flashSchedule = vi.fn();
    const { p } = planner('x', { flashSchedule });
    markStrobeHolds(doc, doc, [{ tap: 0, pad: 0, moveId: 'p', frame: 1, frames: 1, state: 'kept' }], [punch, null, null, null, null, null, null, null], p);
    expect(flashSchedule).not.toHaveBeenCalled();
  });
});
