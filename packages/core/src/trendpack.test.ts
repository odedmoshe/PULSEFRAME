/**
 * Trend pack contracts in core (ADR-0012): the transition registry rows, the transition options and their one check
 * (set_transition and set_transition_options), validation, undo, migration, and the text look fields (normalised on the
 * master, kept as "off" in a format override, owned by text presets).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, describeCatalog, diffEntities, findClip, GPU_TRANSITION_IDS, hasTextLook, migrateProject, normaliseTextStyle, OpError, projectVariant,
  TEXT_LOOK_FIELDS, TextStyleSchema, TRANSITION_CATEGORIES, TRANSITION_IDS, TRANSITION_OPTIONS, TransitionColor, transitionDef, TRANSITIONS, TransitionSchema,
  validateProject, velocityLimit, velocityNeeds, type MediaClip, type OpCall, type ProjectDocument, type TextStyle, type TransitionDef,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `tp${n++}_`, actor: 'test', allowInternal });
/** The refusal, with the transaction's own bookkeeping (op name and index) taken out of its details. */
const failure = (fn: () => unknown) => {
  try { fn(); } catch (e) { if (e instanceof OpError) { const { op: _op, index: _index, ...details } = e.details; e.details = details; return e; } throw e; }
  throw new Error('expected an OpError');
};
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
/** 8 s of 30 fps video: source frames 0 … 239. */
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };

/**
 * Two touching video clips: A at frames 0–60 and B at 60–120. `outHandle` source frames are left after A's end and
 * `head` source frames before B's start.
 */
function pair(outHandle = 100, head = 100) {
  let r = tx(createProject({ id: 'prj_tp', name: 'TP', frameRate: R }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  const assetId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(240 - outHandle - 60), duration: f(60) } },
    { op: 'add_clip', args: { assetId, start: f(60), sourceIn: f(head), duration: f(60) } },
  ]);
  return { doc: r.doc, a: r.results[0]!.output!.clipId as string, b: r.results[1]!.output!.clipId as string, assetId, stillId };
}
const trOf = (doc: ProjectDocument, clipId: string) => (findClip(doc, clipId)!.clip as MediaClip).transition;
const undoable = (before: ProjectDocument, ops: OpCall[]) => {
  const after = tx(before, ops).doc;
  const changes = diffEntities(before, after);
  const undone = tx(after, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
  return { after, undone, changes };
};

describe('transition registry (ADR-0012)', () => {
  const rows = TRANSITIONS as readonly TransitionDef[];
  it('69 unique ids, 46 of them GPU passes, the 51 legacy rows first and in their old order', () => {
    expect(rows.length).toBe(69);
    expect(new Set(rows.map((t) => t.id)).size).toBe(69);
    expect(TRANSITION_IDS.length).toBe(69);
    expect(GPU_TRANSITION_IDS.length).toBe(46);
    expect(rows.filter((t) => !t.gpu).length).toBe(23);
    expect(rows.slice(0, 12).every((t) => !t.gpu)).toBe(true);
    expect(rows.slice(0, 51).map((t) => t.id).slice(-6)).toEqual(['whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw']);
    expect(rows.slice(51).map((t) => t.id)).toEqual(['punch-in', 'punch-out', 'blur-dissolve', 'split-open-h', 'split-open-v', 'shape-heart', 'shape-star', 'block-left', 'block-right', 'slices-h', 'slices-v', 'film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right']);
    expect(rows.slice(51).filter((t) => t.gpu).map((t) => t.id)).toEqual(['film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right']);
  });
  it('every row has Hebrew and English names, a known category, known options, and defaults only for options it declares', () => {
    for (const t of rows) {
      expect(t.name.he, t.id).toMatch(/[֐-׿]/);
      expect(t.name.en.length, t.id).toBeGreaterThan(2);
      expect(TRANSITION_CATEGORIES, t.id).toContain(t.category);
      for (const o of t.options) expect(TRANSITION_OPTIONS, t.id).toContain(o);
      for (const k of Object.keys(t.defaults ?? {})) expect(t.options, t.id).toContain(k);
      if (t.defaults?.color) expect(TransitionColor.safeParse(t.defaults.color).success, t.id).toBe(true);
      expect(t.usesOutgoing).toBe(true);
      expect(transitionDef(t.id)).toBe(t);
    }
    expect(transitionDef('nope')).toBeUndefined();
    // every category is used
    for (const c of TRANSITION_CATEGORIES) expect(rows.some((t) => t.category === c), c).toBe(true);
  });
  it('flags: only film-burn and light-leak are light; flash and dip are cover but not light; whip and spin depend on the frame shape', () => {
    expect(rows.filter((t) => t.light).map((t) => t.id)).toEqual(['film-burn', 'light-leak']);
    expect(rows.filter((t) => t.cover).map((t) => t.id)).toEqual(['dip-black', 'dip-white', 'flash', 'block-left', 'block-right']);
    expect(transitionDef('flash')).toMatchObject({ category: 'light', cover: true, options: [] });
    expect(transitionDef('flash')!.light).toBeUndefined();
    expect(rows.filter((t) => t.shapeDependent).map((t) => t.id)).toEqual(['whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw', 'shape-heart', 'shape-star', 'page-turn-left', 'page-turn-right']);
    expect(rows.slice(0, 51).every((t) => t.options.length === 0 && !t.defaults && !t.light && !t.singleCrossing)).toBe(true);
  });
  it('the catalogue says what each type accepts and that sound stays a hard cut', () => {
    const cat = describeCatalog().transitions;
    expect(cat.length).toBe(69);
    for (const t of cat) {
      expect(t.accepts).toEqual({ sync: ['beat'], velocity: [2, 3, 4], options: transitionDef(t.id)!.options });
      expect(t.audio).toBe('unchanged (hard cut); velocity remaps the picture only');
      expect(t.implementation).toBe(t.gpu ? 'webgpu pass (needs a graphics adapter)' : 'canvas2d');
    }
  });
  it('the transition schema is strict; a colour has no alpha; seeds are whole numbers 0…9999', () => {
    expect(TransitionSchema.safeParse({ type: 'dissolve', frames: 10 }).success).toBe(true);
    expect(TransitionSchema.safeParse({ type: 'dissolve', frames: 10, wobble: 1 }).success).toBe(false);
    expect(TransitionSchema.safeParse({ type: 'film-burn', frames: 10, sync: 'beat', velocity: 3, color: '#FF9A4A', seed: 9999 }).success).toBe(true);
    for (const bad of [{ velocity: 5 }, { velocity: 1 }, { sync: 'bar' }, { color: '#FF9A4A80' }, { color: 'red' }, { seed: -1 }, { seed: 10000 }, { seed: 1.5 }])
      expect(TransitionSchema.safeParse({ type: 'film-burn', frames: 10, ...bad }).success, JSON.stringify(bad)).toBe(false);
  });
});

describe('set_transition with options (ADR-0012)', () => {
  it('a transition without options is stored exactly as before: { type, frames }', () => {
    const p = pair();
    const d = tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 20 } }]).doc;
    expect(trOf(d, p.b)).toStrictEqual({ type: 'dissolve', frames: 20 });
  });
  it('changing the type keeps the beat lock and the velocity, and keeps colour and seed only where the new type has them', () => {
    const p = pair();
    let d = tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'film-burn', frames: 15 } }, { op: 'set_transition_options', args: { clipId: p.b, sync: 'beat', velocity: 2, color: '#112233', seed: 5 } }]).doc;
    expect(trOf(d, p.b)).toStrictEqual({ type: 'film-burn', frames: 15, sync: 'beat', velocity: 2, color: '#112233', seed: 5 });
    d = tx(d, [{ op: 'set_transition', args: { clipId: p.b, type: 'ink-bleed', frames: 15 } }]).doc;
    expect(trOf(d, p.b)).toStrictEqual({ type: 'ink-bleed', frames: 15, sync: 'beat', velocity: 2, seed: 5 });
    d = tx(d, [{ op: 'set_transition', args: { clipId: p.b, type: 'shape-heart', frames: 12 } }]).doc;
    expect(trOf(d, p.b)).toStrictEqual({ type: 'shape-heart', frames: 12, sync: 'beat', velocity: 2 });
    d = tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, color: '#FF0000', sync: null } }, { op: 'set_transition', args: { clipId: p.b, type: 'dissolve' } }]).doc;
    expect(trOf(d, p.b)).toStrictEqual({ type: 'dissolve', frames: 15, velocity: 2 });
    d = tx(d, [{ op: 'set_transition', args: { clipId: p.b, type: null } }]).doc;
    expect(trOf(d, p.b)).toBeUndefined();
  });
  it('the kept options are checked again: a kept beat lock refuses a 2-frame transition, a kept velocity a transition the handle cannot feed', () => {
    const p = pair(22);
    const d = tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 15 } }, { op: 'set_transition_options', args: { clipId: p.b, sync: 'beat', velocity: 2 } }]).doc;
    expect(failure(() => tx(d, [{ op: 'set_transition', args: { clipId: p.b, type: 'wipe-left', frames: 2 } }])).details).toEqual({ minFrames: 3 });
    const e = failure(() => tx(d, [{ op: 'set_transition', args: { clipId: p.b, type: 'wipe-left', frames: 16 } }]));
    expect([e.code, e.details.maxVelocity, e.details.maxFrames]).toEqual(['out_of_bounds', 1, 15]);
  });
  it('the refusals without options keep their codes, messages and maxFrames', () => {
    const p = pair(10);
    const long = failure(() => tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 61 } }]));
    expect([long.code, long.message, long.details]).toEqual(['out_of_bounds', 'the transition (61 frames) is longer than the clip (60 frames)', { maxFrames: 60 }]);
    const short = failure(() => tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 11 } }]));
    expect([short.code, short.message, short.details.maxFrames, short.details.previousClipId]).toEqual(['out_of_bounds', 'the previous clip has only 10 unused source frames after its end; the transition needs 11', 10, p.a]);
    const none = pair(0);
    expect(failure(() => tx(none.doc, [{ op: 'set_transition', args: { clipId: none.b, type: 'dissolve', frames: 5 } }])).details.maxFrames).toBe(0);
  });
});

describe('set_transition_options: every refusal', () => {
  const withTransition = (p: ReturnType<typeof pair>, type = 'dissolve', frames = 15) => tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type, frames } }]).doc;
  it('no transition, or not a picture clip on a video track', () => {
    const p = pair();
    const e = failure(() => tx(p.doc, [{ op: 'set_transition_options', args: { clipId: p.b, sync: 'beat' } }]));
    expect([e.code, e.message]).toEqual(['not_found', `clip ${p.b} has no transition`]);
    const t = tx(p.doc, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(30) } }]);
    expect(failure(() => tx(t.doc, [{ op: 'set_transition_options', args: { clipId: t.results[0]!.output!.clipId as string, sync: 'beat' } }])).code).toBe('incompatible');
    expect(failure(() => tx(p.doc, [{ op: 'set_transition_options', args: { clipId: 'clp_none', sync: 'beat' } }])).code).toBe('not_found');
  });
  it('arguments: unknown keys, velocity outside 2…4, a colour with alpha and seeds outside 0…9999 are invalid', () => {
    const p = pair(), d = withTransition(p, 'film-burn');
    for (const bad of [{ wobble: 1 }, { velocity: 5 }, { velocity: 1 }, { color: '#11223344' }, { seed: 10000 }, { seed: -1 }, { sync: 'bar' }])
      expect(failure(() => tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, ...bad } }])).code, JSON.stringify(bad)).toBe('invalid_args');
  });
  it('velocity: the previous clip\'s handle, with maxVelocity and maxFrames by the velocityNeeds arithmetic (22 / 29 / 36 frames for n = 15)', () => {
    expect([2, 3, 4].map((v) => velocityNeeds(15, v))).toEqual([{ outFrames: 22, headFrames: 7 }, { outFrames: 29, headFrames: 14 }, { outFrames: 36, headFrames: 21 }]);
    for (const [handle, maxVelocity] of [[21, 1], [22, 2], [28, 2], [29, 3], [35, 3], [36, 4]] as const) {
      const p = pair(handle), d = withTransition(p);
      expect(velocityLimit(d, p.b), `handle ${handle}`).toEqual({ maxVelocity, haveOutFrames: handle, haveHeadFrames: 100, refusal: maxVelocity > 1 ? null : expect.stringContaining('the previous clip has only 21 unused source frames') });
      for (const v of [2, 3, 4] as const) {
        if (v <= maxVelocity) { expect(trOf(tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: v } }]).doc, p.b)!.velocity).toBe(v); continue; }
        const e = failure(() => tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: v } }]));
        const need = velocityNeeds(15, v).outFrames;
        let maxFrames = 0; for (let m = 1; m <= 60; m++) if (velocityNeeds(m, v).outFrames <= handle) maxFrames = m;
        expect([e.code, e.message], `handle ${handle} ×${v}`).toEqual(['out_of_bounds', `the previous clip has only ${handle} unused source frames after its end; the transition at velocity ×${v} needs ${need}`]);
        expect(e.details).toEqual({ maxFrames, previousClipId: p.a, maxVelocity, needOutFrames: need, haveOutFrames: handle });
      }
    }
  });
  it('velocity: the incoming clip\'s head before its sourceIn', () => {
    const p = pair(100, 10), d = withTransition(p);
    expect(velocityLimit(d, p.b)).toEqual({ maxVelocity: 2, haveOutFrames: 100, haveHeadFrames: 10, refusal: null });
    const e = failure(() => tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 3 } }]));
    expect([e.code, e.message]).toEqual(['out_of_bounds', 'the clip has only 10 source frames before its start; the transition at velocity ×3 needs 14']);
    expect(e.details).toEqual({ maxVelocity: 2, needOutFrames: 29, needHeadFrames: 14, haveOutFrames: 100, haveHeadFrames: 10 });
    expect(trOf(tx(d, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }]).doc, p.b)).toStrictEqual({ type: 'dissolve', frames: 15, velocity: 2 });
  });
  it('velocity: refused on a reversed or frozen side, on a side whose first effect is a time effect, and when neither side is video', () => {
    const p = pair();
    const revA = tx(p.doc, [{ op: 'set_clip_reverse', args: { clipId: p.a, reverse: true } }, { op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 15 } }]).doc;
    const e1 = failure(() => tx(revA, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }]));
    expect([e1.code, e1.message, e1.details]).toEqual(['incompatible', 'a velocity ramp cannot remap a clip that plays backwards or is a freeze frame', { clipId: p.a }]);
    expect(velocityLimit(revA, p.b)).toMatchObject({ maxVelocity: 1, refusal: 'a velocity ramp cannot remap a clip that plays backwards or is a freeze frame' });
    const revB = tx(p.doc, [{ op: 'set_clip_reverse', args: { clipId: p.b, reverse: true } }, { op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 15 } }]).doc;
    expect(failure(() => tx(revB, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }])).details).toEqual({ clipId: p.b });
    const frozen = structuredClone(withTransition(p));
    (findClip(frozen, p.b)!.clip as MediaClip).freeze = true;
    expect(failure(() => tx(frozen, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }])).message).toBe('a velocity ramp cannot remap a clip that plays backwards or is a freeze frame');
    const echoed = tx(withTransition(p), [{ op: 'add_effect', args: { clipId: p.a, type: 'time.echo' } }]).doc;
    const e2 = failure(() => tx(echoed, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }]));
    expect([e2.code, e2.message, e2.details]).toEqual(['incompatible', 'a velocity ramp cannot remap a clip whose first effect is a time effect', { clipId: p.a }]);
    // a time effect that is turned off does not count
    const fx = findClip(echoed, p.a)!.clip.effects![0]!.id;
    const off = tx(echoed, [{ op: 'update_effect', args: { clipId: p.a, effectId: fx, enabled: false } }]).doc;
    expect(trOf(tx(off, [{ op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }]).doc, p.b)!.velocity).toBe(2);
    // two stills: nothing to speed up
    const s = tx(p.doc, [{ op: 'add_clip', args: { assetId: p.stillId, start: f(300), duration: f(30) } }, { op: 'add_clip', args: { assetId: p.stillId, start: f(330), duration: f(30) } }]);
    const second = s.results[1]!.output!.clipId as string;
    const stills = tx(s.doc, [{ op: 'set_transition', args: { clipId: second, type: 'dissolve', frames: 10 } }]).doc;
    const e3 = failure(() => tx(stills, [{ op: 'set_transition_options', args: { clipId: second, velocity: 2 } }]));
    expect([e3.code, e3.message]).toEqual(['incompatible', 'a velocity ramp needs a video on at least one side of the transition']);
    expect(velocityLimit(stills, second)).toMatchObject({ maxVelocity: 1, haveOutFrames: null, haveHeadFrames: null });
  });
  it('sync needs at least 3 frames; colour and seed only where the type declares them', () => {
    const p = pair();
    const two = withTransition(p, 'dissolve', 2);
    const e = failure(() => tx(two, [{ op: 'set_transition_options', args: { clipId: p.b, sync: 'beat' } }]));
    expect([e.code, e.message, e.details]).toEqual(['out_of_bounds', 'a transition locked to the beat needs at least 3 frames; this one has 2', { minFrames: 3 }]);
    expect(trOf(tx(withTransition(p, 'dissolve', 3), [{ op: 'set_transition_options', args: { clipId: p.b, sync: 'beat' } }]).doc, p.b)!.sync).toBe('beat');
    const c = failure(() => tx(withTransition(p, 'dissolve'), [{ op: 'set_transition_options', args: { clipId: p.b, color: '#FF0000' } }]));
    expect([c.code, c.message, c.details]).toEqual(['incompatible', 'the dissolve transition has no color option', { option: 'color', type: 'dissolve', options: [] }]);
    const sd = failure(() => tx(withTransition(p, 'shape-heart'), [{ op: 'set_transition_options', args: { clipId: p.b, seed: 3 } }]));
    expect(sd.details).toEqual({ option: 'seed', type: 'shape-heart', options: ['color'] });
    expect(trOf(tx(withTransition(p, 'slices-h'), [{ op: 'set_transition_options', args: { clipId: p.b, seed: 3 } }]).doc, p.b)).toStrictEqual({ type: 'slices-h', frames: 15, seed: 3 });
  });
  it('null removes an option; the result passes validation and the schema; one undo restores the previous document exactly', () => {
    const p = pair();
    const before = withTransition(p, 'film-burn');
    const { after, undone, changes } = undoable(before, [{ op: 'set_transition_options', args: { clipId: p.b, sync: 'beat', velocity: 3, color: '#00FF00', seed: 42 } }]);
    expect(changes.map((c) => c.id)).toEqual([p.b]);
    expect(validateProject(after)).toEqual([]);
    expect(undone).toEqual(before);
    const cleared = tx(after, [{ op: 'set_transition_options', args: { clipId: p.b, sync: null, velocity: null, color: null, seed: null } }]).doc;
    expect(trOf(cleared, p.b)).toStrictEqual({ type: 'film-burn', frames: 15 });
    // migration: a document with every option round-trips unchanged
    expect(migrateProject(JSON.parse(JSON.stringify(after)))).toEqual(after);
  });
});

describe('validation of transition options', () => {
  const doc = () => { const p = pair(); return { p, d: structuredClone(tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 2 } }]).doc) }; };
  const codes = (d: ProjectDocument) => validateProject(d).map((i) => i.code);
  it('reports an option the type does not declare, a beat lock under 3 frames, and a velocity on a reversed, frozen or time-remapped side', () => {
    let { p, d } = doc();
    (findClip(d, p.b)!.clip as MediaClip).transition = { type: 'dissolve', frames: 2, color: '#FF0000', seed: 1, sync: 'beat' };
    expect(codes(d).sort()).toEqual(['invalid_transition_option', 'invalid_transition_option', 'invalid_transition_sync']);
    ({ p, d } = doc());
    (findClip(d, p.b)!.clip as MediaClip).transition = { type: 'dissolve', frames: 10, velocity: 2 };
    expect(codes(d)).toEqual([]);
    (findClip(d, p.a)!.clip as MediaClip).reverse = true;
    expect(codes(d)).toEqual(['incompatible_velocity']);
    expect(validateProject(d)[0]!.ids).toEqual([p.b, p.a]);
  });
  it('is the backstop for other operations: reversing a side of a velocity ramp, or giving it a time effect first, is refused', () => {
    const p = pair();
    const d = tx(p.doc, [{ op: 'set_transition', args: { clipId: p.b, type: 'dissolve', frames: 15 } }, { op: 'set_transition_options', args: { clipId: p.b, velocity: 2 } }]).doc;
    expect(failure(() => tx(d, [{ op: 'set_clip_reverse', args: { clipId: p.b, reverse: true } }])).code).toBe('invalid_result');
    expect(failure(() => tx(d, [{ op: 'add_effect', args: { clipId: p.a, type: 'time.stutter' } }])).code).toBe('invalid_result');
  });
});

describe('text look fields (ADR-0012)', () => {
  const glow = { color: '#FF2BD6', radiusFrac: 0.6, intensity: 0.9 };
  const gradient = { colors: ['#FFD166', '#EF476F'], angle: 90 };
  const title = () => {
    const p = pair();
    const r = tx(p.doc, [{ op: 'add_text', args: { text: 'שָׁלוֹם עולם', start: f(0), duration: f(60) } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    return { doc: r.doc, id: r.results[0]!.output!.clipId as string, variantId: r.results[1]!.output!.variantId as string };
  };
  const styleOf = (d: ProjectDocument, id: string) => (findClip(d, id)!.clip as { style: TextStyle }).style;
  it('the six fields are optional; absent, null and tracking 0 are off; the default style has none', () => {
    expect(TEXT_LOOK_FIELDS).toEqual(['gradient', 'tracking', 'stroke2', 'glow', 'extrude', 'longShadow']);
    const t = title();
    expect(Object.keys(styleOf(t.doc, t.id)).some((k) => (TEXT_LOOK_FIELDS as readonly string[]).includes(k))).toBe(false);
    expect(hasTextLook(styleOf(t.doc, t.id))).toBe(false);
    expect(hasTextLook({ tracking: 0 })).toBe(false);
    expect(hasTextLook({ tracking: null, glow: null })).toBe(false);
    expect(hasTextLook({ tracking: 0.1 })).toBe(true);
    expect(hasTextLook({ gradient })).toBe(true);
    expect(normaliseTextStyle({ color: '#FFFFFF', tracking: 0, glow: null, gradient })).toStrictEqual({ color: '#FFFFFF', gradient });
  });
  it('the schema is strict and bounded', () => {
    const ok = (s: Record<string, unknown>) => TextStyleSchema.partial().safeParse(s).success;
    expect(ok({ gradient, glow, tracking: 0.25, stroke2: { color: '#111111', widthFrac: 0.08 }, extrude: { color: '#3A0CA3', depthFrac: 0.18, angle: 45, shade: 0.5 }, longShadow: { color: '#0000004D', lengthFrac: 2, angle: 45 } })).toBe(true);
    for (const bad of [{ gradient: { colors: ['#FFFFFF'], angle: 0 } }, { gradient: { colors: ['#FFFFFF', '#000000', '#111111', '#222222'], angle: 0 } }, { gradient: { ...gradient, angle: 360 } }, { tracking: 0.6 }, { tracking: -0.1 },
      { glow: { ...glow, radiusFrac: 2 } }, { glow: { ...glow, extra: 1 } }, { extrude: { color: '#000000', depthFrac: 0.7, angle: 0, shade: 0 } }, { longShadow: { color: '#000000', lengthFrac: 5, angle: 0 } }, { stroke2: { color: '#000000', widthFrac: 0 } }])
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
  });
  it('update_text normalises the master: null and tracking 0 remove the field; one undo restores the title', () => {
    const t = title();
    const { after, undone } = undoable(t.doc, [{ op: 'update_text', args: { clipId: t.id, style: { glow, gradient, tracking: 0.2 } } }]);
    expect(styleOf(after, t.id)).toMatchObject({ glow, gradient, tracking: 0.2 });
    expect(undone).toEqual(t.doc);
    const off = tx(after, [{ op: 'update_text', args: { clipId: t.id, style: { glow: null, tracking: 0 } } }]).doc;
    expect('glow' in styleOf(off, t.id)).toBe(false);
    expect('tracking' in styleOf(off, t.id)).toBe(false);
    expect(styleOf(off, t.id).gradient).toEqual(gradient);
    const added = tx(t.doc, [{ op: 'add_text', args: { text: 'x', start: f(60), duration: f(10), style: { glow: null, tracking: 0 } } }]);
    expect(Object.keys(styleOf(added.doc, added.results[0]!.output!.clipId as string)).sort()).toEqual(Object.keys(styleOf(t.doc, t.id)).sort());
  });
  it('a format override keeps null as "off in this format", and the projected style treats it as off', () => {
    const t = title();
    const d = tx(t.doc, [{ op: 'update_text', args: { clipId: t.id, style: { glow } } }, { op: 'set_variant_override', args: { variantId: t.variantId, clipId: t.id, textStyle: { glow: null } } }]).doc;
    expect(d.variants![t.variantId]!.overrides[t.id]!.textStyle).toEqual({ glow: null });
    expect(hasTextLook(styleOf(d, t.id))).toBe(true);
    const projected = projectVariant(d, t.variantId);
    expect(hasTextLook(styleOf(projected, t.id))).toBe(false);
    expect(validateProject(projected)).toEqual([]);
    expect(validateProject(d)).toEqual([]);
  });
  it('apply_text_preset clears every look field before it applies the preset', () => {
    const t = title();
    const d = tx(t.doc, [{ op: 'update_text', args: { clipId: t.id, style: { glow, gradient, tracking: 0.2, stroke2: { color: '#111111', widthFrac: 0.08 }, extrude: { color: '#3A0CA3', depthFrac: 0.18, angle: 45, shade: 0.5 }, longShadow: { color: '#0000004D', lengthFrac: 2, angle: 45 } } } }]).doc;
    expect(hasTextLook(styleOf(d, t.id))).toBe(true);
    const { after, undone } = undoable(d, [{ op: 'apply_text_preset', args: { clipId: t.id, presetId: 'classic-outline' } }]);
    const s = styleOf(after, t.id);
    for (const k of TEXT_LOOK_FIELDS) expect(k in s, k).toBe(false);
    expect(s).toMatchObject({ fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.06, color: '#FFFFFF', stroke: '#000000', strokeFrac: 0.08 });
    expect(undone).toEqual(d);
  });
});
