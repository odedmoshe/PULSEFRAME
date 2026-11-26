/**
 * Perform mode W1 (ADR-0025): the pad catalogue and the planner, tested through the REAL op apply_take (applyTransaction with
 * allowInternal): no second step runner. Quantise is in moves.quantise.test.ts, the properties in moves.property.test.ts.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, defaultBank, ELEMENT_IDS, findEffect, flashGapFrames, GPU_EFFECT_IDS, lightChanges, MOTION_PRESETS, MOVES, MoveSpecSchema, PadBankSchema,
  PAD_COUNT, PERFORM_PLANNER_BUILT, PERFORM_RECIPE_ID, planPerformance, adjustmentRefusal, sampleKeyframes, TAKE_STEP_OPS, TRANSFORM_RANGE, validateProject,
  type Hit, type MoveSpec, type OpCall, type PadBank, type PlanInput, type ProjectDocument, type QuantiseSettings,
} from './index.ts';

const R30 = { num: 30, den: 1 };
const f = (n: number, rate = R30) => T.frameTime(n, rate);
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const hash = (c: string) => `sha256:${c.repeat(64).slice(0, 64)}`;
const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: hash('a'), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R30, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance };
const SOUND = (seconds: number | T.RationalTime, c = 'b') => ({ kind: 'audio' as const, name: 's.wav', contentHash: hash(c), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: typeof seconds === 'number' ? T.fromSeconds(seconds) : seconds, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance });
const STILL = { kind: 'image' as const, name: 'star.png', contentHash: hash('c'), byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 200, height: 200, codec: 'png', hasAlpha: true }, provenance };
const SETTINGS: QuantiseSettings = { snap: 'beat', tempo: 'normal', strength: 1, parity: 0 };
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `m${seed++}_`, actor: 'test', allowInternal: true });
const out = (r: ReturnType<typeof tx>, i = 0) => r.results[i]!.output as Record<string, string>;

/** A 30 fps (or `rate`) project with one video clip over [0, frames) on V1 (and its sound), plus a sound and a still in the library. */
function project(o: { rate?: T.Rate; frames?: number; video?: boolean } = {}) {
  const rate = o.rate ?? R30;
  let doc = createProject({ id: 'prj_moves', name: 'moves', width: 640, height: 360, frameRate: rate });
  const ids: Record<string, string> = {};
  for (const [k, a] of [['video', VIDEO], ['sound', SOUND(0.9)], ['still', STILL]] as const) { const r = tx(doc, [{ op: 'import_asset', args: { asset: a } }]); doc = r.doc; ids[k] = out(r).assetId!; }
  let clipId = '';
  if (o.video !== false) { const r = tx(doc, [{ op: 'add_clip', args: { assetId: ids.video!, start: T.ZERO, duration: f(o.frames ?? 600, rate) } }]); doc = r.doc; clipId = out(r).clipId!; }
  else doc = tx(doc, [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: f(o.frames ?? 600, rate) } }]).doc;
  return { doc, ids, clipId };
}
const hit = (tap: number, pad: number, frame: number, frames = 6): Hit => ({ tap, pad, frame, frames, snapped: true, movedMs: 0 });
const bankWith = (pads: Partial<Record<number, MoveSpec>>): PadBank => Array.from({ length: PAD_COUNT }, (_, i) => pads[i] ?? null);
const move = (id: string) => structuredClone(MOVES.find((m) => m.id === id)!);
const input = (hits: Hit[], bank: PadBank, o: Partial<PlanInput> = {}): PlanInput => ({ hits, bank, assets: Array(PAD_COUNT).fill(null), settings: SETTINGS, gpu: false, ...o });
/** Plan, then apply through the real op; returns the plan and the document after it. */
function take(doc: ProjectDocument, inp: PlanInput) {
  const plan = planPerformance(doc, inp);
  const after = plan.args ? tx(doc, [{ op: 'apply_take', args: plan.args }]).doc : doc;
  return { plan, after };
}
const clipsOf = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips.map((c) => ({ track: t, clip: c })));

describe('the catalogue and the banks', () => {
  it('is built: every move parses, ids are unique, effects exist and may go on an adjustment', () => {
    expect(PERFORM_PLANNER_BUILT).toBe(true);
    expect(new Set(MOVES.map((m) => m.id)).size).toBe(MOVES.length);
    for (const m of MOVES) {
      expect(MoveSpecSchema.safeParse(m).success, m.id).toBe(true);
      if (m.kind === 'adjust') for (const fx of m.effects) {
        expect(findEffect(fx.type), fx.type).toBeTruthy();
        expect(adjustmentRefusal(fx.type), fx.type).toBeNull();
        expect(findEffect(fx.type)!.params.safeParse(fx.params ?? {}).success, fx.type).toBe(true);
        if (fx.envelope) for (const v of [fx.envelope.from, fx.envelope.to]) expect(findEffect(fx.type)!.params.safeParse({ ...fx.params, [fx.envelope.param]: v }).success, `${fx.type} ${v}`).toBe(true);
      }
      if (m.kind === 'sticker') { expect(ELEMENT_IDS).toContain(m.source.elementId); expect(MOTION_PRESETS.some((p) => p.id === m.motionId)).toBe(true); }
    }
  });
  it('has two named banks of eight pads; the canvas bank (the default) needs no graphics adapter; the strobe is in neither', () => {
    for (const id of ['canvas', 'gpu'] as const) {
      const bank = defaultBank(id);
      expect(PadBankSchema.safeParse(bank).success).toBe(true);
      expect(bank.some((m) => m?.kind === 'adjust' && m.effects.some((e) => e.type === 'light.strobe'))).toBe(false);
    }
    const canvas = defaultBank('canvas');
    expect(canvas.every((m) => m && (m.kind !== 'adjust' || m.effects.every((e) => !GPU_EFFECT_IDS.includes(e.type))))).toBe(true);
    expect(defaultBank('gpu').some((m) => m?.kind === 'adjust' && m.effects.some((e) => GPU_EFFECT_IDS.includes(e.type)))).toBe(true);
    // a bank is a copy: changing it changes nothing else
    (canvas[0] as { minSeconds: number }).minSeconds = 9;
    expect(defaultBank('canvas')[0]!.minSeconds).not.toBe(9);
  });
});

describe('planPerformance through the real apply_take', () => {
  it('plans the canvas bank on a picture: one run, a valid document, every step op from TAKE_STEP_OPS, no live field', () => {
    const { doc, ids } = project();
    const assets = Array(PAD_COUNT).fill(null); assets[6] = ids.sound;
    const hits = Array.from({ length: 8 }, (_, p) => hit(p, p, 20 + p * 40, 9));
    const { plan, after } = take(doc, input(hits, defaultBank('canvas'), { assets }));
    expect(plan.chips.map((c) => c.state)).toEqual(Array(8).fill('kept'));
    expect(plan.args!.steps.every((s) => (TAKE_STEP_OPS as readonly string[]).includes(s.op))).toBe(true);
    expect(plan.args!.steps.filter((s) => s.op === 'add_text').every((s) => !('fields' in (s.args as object)))).toBe(true);
    expect(validateProject(after)).toEqual([]);
    const runs = Object.values(after.recipeRuns).filter((r) => r.recipeId === PERFORM_RECIPE_ID);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.params).toMatchObject({ hits: 8, held: 0, taps: 8, snap: 'beat' });
  });
  it('identical input gives byte-identical arguments', () => {
    const { doc, ids } = project();
    const assets = Array(PAD_COUNT).fill(null); assets[6] = ids.sound;
    const hits = Array.from({ length: 40 }, (_, i) => hit(i, (i * 5) % 8, 3 + i * 13, 4 + (i % 9)));
    const a = JSON.stringify(planPerformance(doc, input(hits, defaultBank('canvas'), { assets })));
    const b = JSON.stringify(planPerformance(structuredClone(doc), input([...hits].reverse(), defaultBank('canvas'), { assets })));
    expect(b).toBe(a);
  });
  it('merges a same-pad hit that overlaps or abuts, and cuts the previous one when the new hit starts inside its release', () => {
    const { doc } = project();
    const punch = move('move.punch'); // release 0.12 s = 4 frames at 30 fps
    const bank = bankWith({ 0: punch });
    // overlap: 30..40 and 35..45 merge into 30..45; abut: 50..60 and 60..66 merge
    const merged = planPerformance(doc, input([hit(0, 0, 30, 10), hit(1, 0, 35, 10), hit(2, 0, 50, 10), hit(3, 0, 60, 6)], bank)).chips;
    expect(merged.map((c) => [c.tap, c.state, c.frame, c.frames])).toEqual([[0, 'kept', 30, 15], [1, 'merged', 30, 15], [2, 'kept', 50, 16], [3, 'merged', 50, 16]]);
    // retrigger inside the release (frames 36..39 of 30..40): the first ends one frame early, at 37, and the second is its own hit
    const cut = planPerformance(doc, input([hit(0, 0, 30, 10), hit(1, 0, 38, 10)], bank)).chips;
    expect(cut.map((c) => [c.state, c.frame, c.frames])).toEqual([['kept', 30, 7], ['kept', 38, 10]]);
    // the same retrigger on a hit that would be left shorter than 3 frames merges
    expect(planPerformance(doc, input([hit(0, 0, 30, 4), hit(1, 0, 32, 10)], bank)).chips.map((c) => c.state)).toEqual(['kept', 'merged']);
    // a light-changing move retriggered within the flash gap merges (it lasts the gap anyway)
    const bw = planPerformance(doc, input([hit(0, 0, 30, 2), hit(1, 0, 35, 2)], bankWith({ 0: move('move.black-white') }))).chips;
    expect(bw.map((c) => c.state)).toEqual(['kept', 'merged']);
  });
  it('merges only into what the previous hit really plays: a punch ends at its cut, a fallback pulse at its cap', () => {
    // two pictures [0, 100) and [100, 200) on V1, then a gap and a third from 230: a punch held past a cut stops at the cut,
    // so a tap on the next picture is its own hit on that picture (and not a "merged" chip that did nothing)
    const { doc, ids, clipId } = project({ frames: 100 });
    const trackId = clipsOf(doc).find((x) => x.clip.id === clipId)!.track.id;
    const r = tx(doc, [{ op: 'add_clip', args: { assetId: ids.video!, trackId, start: f(100), duration: f(100) } }, { op: 'add_clip', args: { assetId: ids.video!, trackId, start: f(230), duration: f(100) } }]);
    const second = out(r, 0).clipId!, third = out(r, 1).clipId!;
    const punch = bankWith({ 0: move('move.punch') });
    const { plan } = take(r.doc, input([hit(0, 0, 95, 20), hit(1, 0, 104, 6)], punch));
    expect(plan.chips.map((c) => [c.tap, c.state, c.frame, c.frames])).toEqual([[0, 'kept', 95, 5], [1, 'kept', 104, 6]]);
    expect(plan.args!.steps.map((s) => (s.args as { clipId: string }).clipId)).toEqual([clipId, second]);
    // a tap exactly on the cut does not abut-merge into the punch that ended there
    expect(planPerformance(r.doc, input([hit(0, 0, 95, 20), hit(1, 0, 100, 6)], punch)).chips.map((c) => [c.tap, c.state, c.frame])).toEqual([[0, 'kept', 95], [1, 'kept', 100]]);
    // a punch with no picture under it ends where the next picture starts: a tap there is its own hit
    const gap = planPerformance(r.doc, input([hit(0, 0, 210, 40), hit(1, 0, 235, 6)], punch));
    expect(gap.chips.map((c) => [c.tap, c.state, c.frame, c.reason ?? null])).toEqual([[0, 'held', 210, 'no_picture'], [1, 'kept', 235, null]]);
    expect(gap.args!.steps.every((s) => (s.args as { clipId: string }).clipId === third)).toBe(true);
    // a pulse with no followed music is capped at PULSE_MAX_HOLD_SECONDS (90 frames): a tap after the cap is its own hit
    const { doc: long } = project();
    const pulse = bankWith({ 0: move('move.pulse') });
    const p = planPerformance(long, input([hit(0, 0, 10, 150), hit(1, 0, 105, 6)], pulse, { gpu: true }));
    expect(p.chips.map((c) => [c.tap, c.state, c.frame, c.frames])).toEqual([[0, 'kept', 10, 90], [1, 'kept', 105, 15]]);
    expect(p.args!.steps.filter((s) => s.op === 'add_adjustment')).toHaveLength(2);
    // inside the cap it still merges, and the merged chip covers the tap
    const m = planPerformance(long, input([hit(0, 0, 10, 150), hit(1, 0, 60, 6)], pulse, { gpu: true }));
    expect(m.chips.map((c) => [c.tap, c.state, c.frame, c.frames])).toEqual([[0, 'kept', 10, 90], [1, 'merged', 10, 90]]);
  });
  it('holds what the op would refuse: needs_gpu, missing_asset, no_music, outside_edit, empty pads (a warning, no chip)', () => {
    const { doc } = project({ frames: 100 });
    const bank = bankWith({ 0: move('move.shake'), 1: move('move.sound-impact'), 2: move('move.sticker-star'), 3: move('move.beat-strobe'), 4: move('move.blur-hit') });
    const plan = planPerformance(doc, input([hit(0, 0, 10), hit(1, 1, 20), hit(2, 2, 30), hit(3, 3, 40), hit(4, 4, 120), hit(5, 5, 50)], bank, { gpu: false }));
    expect(plan.chips.map((c) => [c.tap, c.reason])).toEqual([[0, 'needs_gpu'], [1, 'missing_asset'], [2, 'missing_asset'], [3, 'needs_gpu'], [4, 'outside_edit']]);
    expect(plan.args).toBeNull();
    expect(plan.warnings.join(' ')).toMatch(/empty pad/);
    expect(planPerformance(doc, input([hit(0, 3, 40)], bank, { gpu: true })).chips[0]!.reason).toBe('no_music');
  });
  it('hit 201 is held take_full', () => {
    const { doc } = project({ frames: 1800 });
    const hits = Array.from({ length: 201 }, (_, i) => hit(i, 0, i * 8, 3));
    const plan = planPerformance(doc, input(hits, bankWith({ 0: move('move.punch') })));
    expect(plan.chips.filter((c) => c.state === 'kept')).toHaveLength(200);
    expect(plan.chips.find((c) => c.tap === 200)!.reason).toBe('take_full');
    expect(plan.args!.take).toMatchObject({ hits: 200, held: 1, taps: 201 });
    expect(validateProject(take(doc, input(hits, bankWith({ 0: move('move.punch') }))).after)).toEqual([]);
  });
  it('spaces changes of light by the gap, from each other and from those already in the sequence, and says how far', () => {
    const { doc } = project();
    const old = tx(doc, [{ op: 'add_adjustment', args: { span: { start: f(100), duration: f(30) }, effects: [{ type: 'color.sepia' }] } }]).doc;
    const gap = flashGapFrames(30);
    const bank = bankWith({ 0: move('move.black-white'), 1: move('move.colour-split'), 2: move('move.blur-hit'), 3: move('move.speed-lines') });
    const hits = [hit(0, 0, 20), hit(1, 1, 25), hit(2, 3, 20 + gap), hit(3, 0, 95), hit(4, 2, 96)];
    const { plan, after } = take(old, input(hits, bank));
    const byTap = new Map(plan.chips.map((c) => [c.tap, c]));
    expect(byTap.get(0)!.state).toBe('kept');
    expect([byTap.get(1)!.reason, byTap.get(1)!.since]).toEqual(['flash_limit', 5]);
    expect(byTap.get(2)!.state).toBe('kept'); // exactly the gap after the first
    expect([byTap.get(3)!.reason, byTap.get(3)!.since]).toEqual(['flash_limit', 5]); // 5 frames before the owner's sepia
    expect(byTap.get(4)!.state).toBe('kept'); // a blur changes no light
    expect(validateProject(after)).toEqual([]);
  });
  it('a strobe claims its light first: a colour hit inside its widened range is held, and the op agrees', () => {
    const { doc, ids } = project();
    const music = tx(doc, [{ op: 'import_asset', args: { asset: { ...SOUND(20, 'd'), name: 'song.wav' } } }]);
    const songId = out(music).assetId!;
    let d = tx(music.doc, [{ op: 'attach_analysis', args: { assetId: songId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z', times: Array.from({ length: 40 }, (_, i) => T.rt(i * 500, 1000)), bpm: 120 } }]).doc;
    d = tx(d, [{ op: 'add_clip', args: { assetId: songId, start: T.ZERO, duration: f(600) } }]).doc;
    void ids;
    const bank = bankWith({ 0: move('move.beat-strobe'), 1: move('move.black-white') });
    const gap = flashGapFrames(30);
    const plan = planPerformance(d, input([hit(0, 1, 60), hit(1, 0, 62, 30), hit(2, 1, 92 + gap), hit(3, 1, 92 + gap - 1 + 20)], bank, { gpu: true }));
    const byTap = new Map(plan.chips.map((c) => [c.tap, c]));
    expect(byTap.get(1)!.state).toBe('kept'); // the strobe 62..92
    expect(byTap.get(0)!.reason).toBe('flash_limit'); // 2 frames before the strobe
    expect(byTap.get(2)!.state).toBe('kept'); // the gap after the strobe's end
    const after = tx(d, [{ op: 'apply_take', args: plan.args! }]).doc;
    expect(validateProject(after)).toEqual([]);
  });
});

describe('envelopes and fades on light channels (lead: held flash_limit, never stretched)', () => {
  const gap = flashGapFrames(30); // 11
  type Adjust = Extract<MoveSpec, { kind: 'adjust' }>;
  const custom = (over: Partial<Adjust>, envelope?: { shape: 'decay' | 'release'; seconds: number }): Adjust => ({
    id: 'move.custom', kind: 'adjust', minSeconds: 0.1, fadeOutSeconds: 0,
    effects: [{ type: 'color.grayscale', params: { amount: 1 }, ...(envelope ? { envelope: { param: 'amount', from: 1, to: 0, ...envelope } } : {}) }], ...over,
  });
  const one = (spec: MoveSpec, frames = 30) => { const { doc } = project(); return take(doc, input([hit(0, 0, 60, frames)], bankWith({ 0: spec }))); };
  it('a decay, a release or a fade-out whose inner key would sit inside the gap is held flash_limit with how close it came; nothing is planned', () => {
    // decay of 3 frames: its end key would be 3 frames after the hit starts
    const decay = one(custom({}, { shape: 'decay', seconds: 0.1 }));
    expect([decay.plan.chips[0]!.state, decay.plan.chips[0]!.reason, decay.plan.chips[0]!.since]).toEqual(['held', 'flash_limit', 3]);
    expect(decay.plan.args).toBeNull();
    // release of 3 frames over a 30-frame hit: its first key would be 3 frames before the hit ends
    const release = one(custom({}, { shape: 'release', seconds: 0.1 }));
    expect([release.plan.chips[0]!.state, release.plan.chips[0]!.reason, release.plan.chips[0]!.since]).toEqual(['held', 'flash_limit', 3]);
    // a fade-out of 3 frames on a light-changing adjustment: never widened to the gap
    const fade = one(custom({ fadeOutSeconds: 0.1 }));
    expect([fade.plan.chips[0]!.state, fade.plan.chips[0]!.reason, fade.plan.chips[0]!.since]).toEqual(['held', 'flash_limit', 3]);
    // each of them is named a shape hold on its chip (the editor words it «pv.held.shape»)
    for (const r of [decay, release, fade]) expect(r.plan.chips[0]!.why).toBe('shape');
  });
  it('names a shape hold (why: shape) and not a gap hold: a start too soon after another change, or a hit shorter than the gap', () => {
    const { doc } = project();
    const plain = custom({ minSeconds: 0.5 });
    const shaped = custom({ minSeconds: 0.5 }, { shape: 'decay', seconds: 0.1 });
    // tap 0: plain at 30 (kept); tap 1: shaped at 33 (its start 3 frames after tap 0); tap 2: shaped at 120 (its start fits, its decay does not)
    // tap 3: plain at 200 clamped by the edit's end to fewer frames than the gap
    const { doc: short } = project({ frames: 205 });
    const plan = planPerformance(doc, input([hit(0, 0, 30, 15), hit(1, 1, 33, 15), hit(2, 1, 120, 15)], bankWith({ 0: plain, 1: shaped })));
    const byTap = new Map(plan.chips.map((c) => [c.tap, c]));
    expect(byTap.get(0)).toMatchObject({ state: 'kept' });
    expect(byTap.get(0)!.why).toBeUndefined();
    expect(byTap.get(1)).toMatchObject({ state: 'held', reason: 'flash_limit', since: 3 });
    expect(byTap.get(1)!.why).toBeUndefined();
    expect(byTap.get(2)).toMatchObject({ state: 'held', reason: 'flash_limit', since: 3, why: 'shape' });
    const tooShort = planPerformance(short, input([hit(0, 0, 200, 15)], bankWith({ 0: plain }))).chips[0]!;
    expect(tooShort).toMatchObject({ state: 'held', reason: 'flash_limit' });
    expect(tooShort.since).toBeLessThan(gap);
    expect(tooShort.why).toBeUndefined();
    // the op's arguments carry no chip: the take it plans is unchanged by the field
    expect(JSON.stringify(plan.args)).not.toContain('"why"');
  });
  it('the same shapes that keep the gap are kept exactly as designed (keys where the shape puts them), and the op agrees', () => {
    const decay = one(custom({}, { shape: 'decay', seconds: 0.5 })); // 15 frames: 15 after the start, 15 before the end
    expect(decay.plan.chips[0]!.state).toBe('kept');
    const keys = decay.plan.args!.steps.filter((s) => s.op === 'set_effect_keyframe').map((s) => T.frameIndexAt((s.args as { time: T.RationalTime }).time, R30));
    expect(keys).toEqual([0, 15]);
    const fade = one(custom({ fadeOutSeconds: 0.5 }));
    expect(fade.plan.chips[0]!.state).toBe('kept');
    expect(fade.plan.args!.steps.filter((s) => s.op === 'set_keyframe').map((s) => T.frameIndexAt((s.args as { time: T.RationalTime }).time, R30))).toEqual([15, 30]);
    for (const r of [decay, fade]) expect(validateProject(r.after)).toEqual([]);
    // a neutral effect (blur) is not judged: its fast decay is kept as designed
    const blur = one({ ...custom({}, { shape: 'decay', seconds: 0.1 }), effects: [{ type: 'blur.gaussian', params: { radius: 0.04 }, envelope: { param: 'radius', from: 0.04, to: 0, shape: 'decay', seconds: 0.1 } }] });
    expect(blur.plan.chips[0]!.state).toBe('kept');
    expect(gap).toBeGreaterThan(3);
  });
});

describe('the zoom punch', () => {
  const punchKeys = (doc: ProjectDocument, clipId: string) => clipsOf(doc).find((x) => x.clip.id === clipId)!.clip.keyframes?.scale ?? [];
  it('reproduces the exact envelope on a constant stretch: rest on a − 1, zoomed from a, eased back to rest at b', () => {
    const { doc, clipId } = project();
    const { plan, after } = take(doc, input([hit(0, 0, 60, 12)], bankWith({ 0: move('move.punch') })));
    expect(plan.chips[0]!.state).toBe('kept');
    const keys = punchKeys(after, clipId);
    expect(keys.map((k) => [T.frameIndexAt(k.time, R30), k.value, k.easing])).toEqual([[59, 1, 'hold'], [60, 1.18, 'hold'], [68, 1.18, 'ease-out'], [72, 1, 'linear']]);
    const at = (n: number) => sampleKeyframes(keys, f(n), TRANSFORM_RANGE.scale);
    expect([at(0), at(59), at(60), at(67), at(72), at(500)]).toEqual([1, 1, 1.18, 1.18, 1, 1]);
    expect(at(70)).toBeGreaterThan(1); expect(at(70)).toBeLessThan(1.18);
  });
  it('zooms about the frame centre: x and y get the same keys times the zoom when they are not 0; no a − 1 key on the first frame', () => {
    const { doc, clipId } = project();
    const moved = tx(doc, [{ op: 'set_clip_transform', args: { clipId, transform: { x: 0.1, y: -0.05, scale: 1.5 } } }]).doc;
    const { after } = take(moved, input([hit(0, 0, 0, 10)], bankWith({ 0: move('move.punch') })));
    const c = clipsOf(after).find((x) => x.clip.id === clipId)!.clip;
    expect(c.keyframes!.scale!.map((k) => k.value)).toEqual([1.77, 1.77, 1.5]);
    expect(c.keyframes!.x!.map((k) => k.value)).toEqual([0.118, 0.118, 0.1]);
    expect(c.keyframes!.y!.map((k) => k.value)).toEqual([-0.059, -0.059, -0.05]);
    expect(T.frameIndexAt(c.keyframes!.scale![0]!.time, R30)).toBe(0);
  });
  it('is held has_motion on a moving stretch, and the last key copies the easing of the segment it lands in (hold stays hold)', () => {
    const { doc, clipId } = project();
    const ramp = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 1 } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(100), value: 2 } }]).doc;
    expect(planPerformance(ramp, input([hit(0, 0, 40, 10)], bankWith({ 0: move('move.punch') }))).chips[0]!.reason).toBe('has_motion');
    const hold = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 1, easing: 'hold' } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(100), value: 2 } }]).doc;
    const { plan, after } = take(hold, input([hit(0, 0, 40, 10)], bankWith({ 0: move('move.punch') })));
    expect(plan.chips[0]!.state).toBe('kept');
    const keys = punchKeys(after, clipId);
    expect(keys.find((k) => T.frameIndexAt(k.time, R30) === 50)!.easing).toBe('hold');
    for (const n of [0, 39, 50, 80, 99, 100, 200]) expect(sampleKeyframes(keys, f(n), TRANSFORM_RANGE.scale)).toBe(sampleKeyframes(punchKeys(hold, clipId), f(n), TRANSFORM_RANGE.scale));
    // a curve that depends on its neighbours (smooth) next to the hit counts as motion
    const smooth = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 1, easing: 'smooth' } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(100), value: 1 } }]).doc;
    expect(planPerformance(smooth, input([hit(0, 0, 40, 10)], bankWith({ 0: move('move.punch') }))).chips[0]!.reason).toBe('has_motion');
  });
  it('is clamped where a picture on a higher track begins over it; a tap on that picture is its own hit', () => {
    const { doc, ids, clipId } = project();
    const v2 = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]);
    const over = tx(v2.doc, [{ op: 'add_clip', args: { assetId: ids.video!, trackId: out(v2).trackId!, start: f(70), duration: f(60) } }]);
    const upper = out(over).clipId!;
    const bank = bankWith({ 0: move('move.punch') });
    const { plan, after } = take(over.doc, input([hit(0, 0, 60, 20), hit(1, 0, 74, 6)], bank));
    const byTap = new Map(plan.chips.map((c) => [c.tap, c]));
    expect([byTap.get(0)!.state, byTap.get(0)!.frame, byTap.get(0)!.frames]).toEqual(['kept', 60, 10]); // 60..70, where V2 begins
    expect(byTap.get(1)!.state).toBe('kept'); // its own hit, on the higher picture
    const lower = punchKeys(after, clipId);
    expect(Math.max(...lower.map((k) => T.frameIndexAt(k.time, R30)))).toBe(70);
    for (const n of [70, 75, 100, 500]) expect(sampleKeyframes(lower, f(n), TRANSFORM_RANGE.scale)).toBe(1);
    expect(punchKeys(after, upper).length).toBeGreaterThan(0);
    expect(validateProject(after)).toEqual([]);
    // a hidden higher track does not cover it
    const hidden = tx(over.doc, [{ op: 'update_track', args: { trackId: out(v2).trackId!, hidden: true } }]).doc;
    expect(planPerformance(hidden, input([hit(0, 0, 60, 20)], bank)).chips[0]!.frames).toBe(20);
  });
  it('is clamped to its clip, and held no_picture, locked, follows_track or too_many_keys', () => {
    const { doc, clipId } = project({ frames: 100 });
    const bank = bankWith({ 0: move('move.punch') });
    const end = planPerformance(doc, input([hit(0, 0, 95, 20)], bank)).chips[0]!;
    expect([end.state, end.frame, end.frames]).toEqual(['kept', 95, 5]);
    expect(planPerformance(project({ video: false }).doc, input([hit(0, 0, 10)], bank)).chips[0]!.reason).toBe('no_picture');
    const trackId = clipsOf(doc).find((x) => x.clip.id === clipId)!.track.id;
    expect(planPerformance(tx(doc, [{ op: 'update_track', args: { trackId, locked: true } }]).doc, input([hit(0, 0, 10)], bank)).chips[0]!.reason).toBe('locked');
    const followed = structuredClone(doc);
    (clipsOf(followed).find((x) => x.clip.id === clipId)!.clip as { follow?: unknown }).follow = { motionTrackId: 'trk_x', offset: { x: 0, y: 0 } };
    expect(planPerformance(followed, input([hit(0, 0, 10)], bank)).chips[0]!.reason).toBe('follows_track');
    const many = structuredClone(doc);
    (clipsOf(many).find((x) => x.clip.id === clipId)!.clip).keyframes = { scale: Array.from({ length: 1998 }, (_, i) => ({ time: T.rt(-(2000 - i), 30), value: 1, easing: 'linear' as const })) };
    expect(planPerformance(many, input([hit(0, 0, 10)], bank)).chips[0]!.reason).toBe('too_many_keys');
  });
});

describe('sounds, titles and stickers', () => {
  it('packs sounds greedily on at most four lanes, cut at the end of the edit; a sound shorter than a frame is held', () => {
    const { doc, ids } = project({ frames: 300 });
    const assets = Array(PAD_COUNT).fill(null); assets[0] = ids.sound;
    const bank = bankWith({ 0: move('move.sound-impact') });
    const hits = [0, 2, 4, 6, 8, 40, 290].map((fr, i) => hit(i, 0, fr, 2)); // the sound is 0.9 s = 27 frames
    const { plan, after } = take(doc, input(hits, bank, { assets }));
    expect(plan.chips.map((c) => c.reason ?? c.state)).toEqual(['kept', 'kept', 'kept', 'kept', 'too_many_sounds', 'kept', 'kept']);
    const lanes = after.sequences[after.mainSequenceId]!.tracks.filter((t) => t.kind === 'audio' && t.name === 'הופעה');
    expect(lanes).toHaveLength(4);
    const last = lanes.flatMap((t) => t.clips).find((c) => T.frameIndexAt(c.start, R30) === 290)!;
    expect(T.frameIndexAt(last.duration, R30)).toBe(10); // cut at the end of the edit
    expect(validateProject(after)).toEqual([]);
    // a later take reuses those lanes before it adds any
    const again = take(after, input([hit(0, 0, 100, 2), hit(1, 0, 101, 2)], bank, { assets }));
    expect(again.plan.args!.steps.filter((s) => s.op === 'add_track')).toHaveLength(0);
    // less than one frame of sound
    const tiny = tx(doc, [{ op: 'import_asset', args: { asset: SOUND(T.rt(1, 100), 'e') } }]);
    const tinyAssets = Array(PAD_COUNT).fill(null); tinyAssets[0] = out(tiny).assetId;
    expect(planPerformance(tiny.doc, input([hit(0, 0, 10)], bank, { assets: tinyAssets })).chips[0]!.reason).toBe('sound_too_short');
  });
  it('a sticker goes on a picture track above the topmost picture at the hit, with its entrance; titles are plain text', () => {
    const { doc, ids } = project();
    const assets = Array(PAD_COUNT).fill(null); assets[0] = ids.still;
    const bank = bankWith({ 0: move('move.sticker-star'), 1: move('move.title-wow') });
    const gap = flashGapFrames(30);
    const { plan, after } = take(doc, input([hit(0, 0, 30, 20), hit(1, 1, 30 + gap, 20), hit(2, 0, 30 + 2 * gap, 30)], bank, { assets }));
    expect(plan.chips.every((c) => c.state === 'kept')).toBe(true);
    const tracks = after.sequences[after.mainSequenceId]!.tracks;
    const picture = tracks.findIndex((t) => t.clips.some((c) => c.type === 'media' && c.assetId === ids.video));
    const stickers = tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.clips.some((c) => c.type === 'media' && c.assetId === ids.still));
    expect(stickers.length).toBe(1);
    expect(stickers[0]!.i).toBeGreaterThan(picture);
    expect(stickers[0]!.t.clips.every((c) => c.keyframes?.opacity?.[0]?.value === 0)).toBe(true);
    const title = clipsOf(after).find((x) => x.clip.type === 'text')!.clip;
    expect(title.type === 'text' && title.fields).toBeFalsy();
    // pictures and titles the take made each start a change of light, a gap apart
    const made = new Set(clipsOf(after).filter((x) => x.clip.type === 'text' || (x.clip.type === 'media' && x.clip.assetId === ids.still)).map((x) => x.clip.id));
    const frames = lightChanges(after, made).map((c) => c.frame);
    expect(frames).toEqual([30, 30 + gap, 30 + 2 * gap]);
    expect(validateProject(after)).toEqual([]);
  });
  it('a take on another sequence names it on every step that names a sequence', () => {
    const { doc, ids } = project();
    const short = tx(doc, [{ op: 'add_sequence', args: { name: 'short' } }]);
    const seqId = out(short).sequenceId!;
    let d = tx(short.doc, [{ op: 'add_clip', args: { sequenceId: seqId, assetId: ids.video, start: T.ZERO, duration: f(300) } }]).doc;
    const assets = Array(PAD_COUNT).fill(null); assets[6] = ids.sound;
    const plan = planPerformance(d, input(Array.from({ length: 8 }, (_, p) => hit(p, p, 10 + p * 30, 9)), defaultBank('canvas'), { assets, sequenceId: seqId }));
    expect(plan.args!.sequenceId).toBe(seqId);
    for (const s of plan.args!.steps) if (['add_track', 'add_adjustment', 'add_clip', 'add_text'].includes(s.op)) expect((s.args as { sequenceId?: string }).sequenceId, s.op).toBe(seqId);
    d = tx(d, [{ op: 'apply_take', args: plan.args! }]).doc;
    expect(validateProject(d)).toEqual([]);
    expect(d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips)).toHaveLength(clipsOf(doc).length);
  });
});
