/**
 * Lead contracts of «למדו אותי פעם אחת» (wave 8 teach; lessonContract.ts, lessonValidate.ts, lessonOps.ts, pairRun.ts).
 * THE TABLE test: every registered op has a LEARN row and every argument key of a learnable op (also inside merged and whole
 * objects) has a kind, so a new op or a new argument fails here until someone classifies it (plan §3.3, verifier C4–C9).
 * THE CATALOGUE test (verifier C5, C6): every string parameter of EFFECTS and AUDIO_EFFECTS is classified carried or never carried,
 * and every frame-count parameter is $frames. Then the validation rules (C12) through validateLessonArgs and through the op.
 * W1 owns the todo rows at the end (they name the plan's checks) and turns them into tests when lesson.ts is built.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, ASSISTANT_EXCLUDED_OPS, assistantOps, AUDIO_EFFECTS, AUDIO_EFFECT_STRING_PARAMS, createProject, EFFECTS, EFFECT_FRAME_PARAMS, EFFECT_NOT_FRAME_PARAMS,
  EFFECT_STRING_PARAMS, getOp, inFixedOrder, LEARN, LEARNABLE_OPS, LESSON_LIMITS, LESSON_OPS_BUILT, LESSON_PART_ORDER, LESSON_REFUSALS, LESSON_STEP_OPS, listOps, OpError, PASTE_ORDER,
  PERSON_OPS, validateLessonArgs, type ArgClass, type LessonPart,
} from './index.ts';

type Zod = { def: { type: string; innerType?: Zod; shape?: Record<string, Zod>; entries?: Record<string, unknown>; checks?: unknown[] }; shape?: Record<string, Zod>; description?: string; regex?: unknown };
const base = (s: Zod): Zod => { let t = s; while (['optional', 'nullable', 'default', 'prefault', 'readonly'].includes(t.def.type) && t.def.innerType) t = t.def.innerType; return t; };
const shapeOf = (s: Zod): Record<string, Zod> | null => { const b = base(s); return b.def.type === 'object' ? (b.shape ?? b.def.shape ?? null) : null; };

describe('the LEARN table (exhaustive)', () => {
  it('every registered op has exactly one row, and no row names an op that does not exist', () => {
    const names = listOps().map((o) => o.name);
    expect(names.filter((n) => !Object.hasOwn(LEARN, n))).toEqual([]);
    expect(Object.keys(LEARN).filter((n) => !getOp(n))).toEqual([]);
  });
  it('a learnable op\'s argument keys equal its schema\'s keys, merged and whole objects too; clipId is the slot', () => {
    const check = (cls: ArgClass, schema: Zod, where: string) => {
      if (typeof cls !== 'object') return;
      const sh = shapeOf(schema);
      expect(sh, `${where} is an object`).toBeTruthy();
      expect(Object.keys(cls.sub).sort(), where).toEqual(Object.keys(sh!).sort());
      if (cls.nullable) expect(['nullable', 'optional'].includes(schema.def.type) || schema.def.type === 'nullable', `${where} nullable`).toBe(true);
      for (const [k, c] of Object.entries(cls.sub)) check(c, sh![k]!, `${where}.${k}`);
    };
    for (const name of LEARNABLE_OPS) {
      const row = LEARN[name]!;
      if (row.learn !== 'yes') continue;
      const sh = shapeOf(getOp(name)!.args as unknown as Zod)!;
      expect(Object.keys(row.args).sort(), name).toEqual(Object.keys(sh).sort());
      expect(row.args.clipId, name).toBe('slot');
      for (const [k, c] of Object.entries(row.args)) check(c, sh[k]!, `${name}.${k}`);
    }
  });
  it('the learnable set after the cuts: 26 ops read, 23 of them steps (the designer listed 29 as "28"; ripple_trim, set_audio_crossfade, apply_lut are cut)', () => {
    expect(listOps().length).toBeGreaterThanOrEqual(161);
    expect(LEARNABLE_OPS.length).toBe(26);
    expect(LESSON_STEP_OPS.length).toBe(23);
    for (const op of ['ripple_trim', 'set_audio_crossfade', 'apply_lut', 'clean_voice', 'set_clip_mask']) expect(LEARN[op], op).toEqual({ learn: 'no', why: 'not_v1' });
    expect([...LEARNABLE_OPS].filter((o) => !LESSON_STEP_OPS.includes(o)).sort()).toEqual(['remove_audio_effect', 'remove_effect', 'update_audio_effect']);
  });
  it('nothing learnable is internal, a person op, a marked-range op, a privacy region or a motion-track op; apply_lesson is excluded from the assistants', () => {
    const forbidden = new Set<string>([...listOps().filter((o) => o.internal).map((o) => o.name), ...PERSON_OPS, 'add_source_range', 'update_source_range', 'remove_source_range', 'set_redact_region', 'create_motion_track', 'attach_motion_track', 'edit_motion_track', 'remove_motion_track', 'set_clip_follow', 'paste_attributes', 'apply_lesson']);
    expect(LEARNABLE_OPS.filter((o) => forbidden.has(o))).toEqual([]);
    for (const o of listOps()) if (o.internal) expect(LEARN[o.name], o.name).toEqual({ learn: 'no', why: 'internal' });
    expect(ASSISTANT_EXCLUDED_OPS as readonly string[]).toContain('apply_lesson');
    expect(assistantOps()).not.toContain('apply_lesson');
  });
  it('C4: the ops that merge partial values are folded key by key (or as the colour grade); C6 frames; C7 positions dropped', () => {
    const fold = (op: string) => (LEARN[op] as { fold: string }).fold;
    for (const op of ['set_clip_transform', 'set_text_animation', 'set_transition_options', 'set_clip_fades', 'update_text', 'animate_clip']) expect(fold(op), op).toBe('keys');
    for (const op of ['apply_look', 'set_colour_grade']) expect(fold(op), op).toBe('grade');
    const args = (op: string) => (LEARN[op] as { args: Record<string, ArgClass> }).args;
    expect((args('set_clip_transform').transform as { kind: string }).kind).toBe('merge');
    expect((args('set_colour_grade').params as { kind: string }).kind).toBe('merge');
    expect((args('update_text').style as { kind: string; sub: Record<string, ArgClass> }).sub.fontFamily).toBe('font');
    expect(args('update_text').text).toBe('words');
    expect((args('set_text_animation').animation as { sub: Record<string, ArgClass> }).sub.inFrames).toBe('frames');
    expect((args('set_clip_stabilise').stabilise as { sub: Record<string, ArgClass> }).sub.zoomPm).toBe('measured');
    for (const op of ['add_effect', 'update_effect']) expect(args(op).index, op).toBe('position');
    for (const op of ['set_transition', 'apply_motion_preset']) expect(args(op).frames, op).toBe('frames');
    for (const op of ['add_effect', 'update_effect', 'remove_effect', 'set_effect_modulator']) expect(fold(op), op).toBe('effect');
    for (const op of ['add_audio_effect', 'update_audio_effect', 'remove_audio_effect', 'apply_audio_preset']) expect(fold(op), op).toBe('soundEffect');
  });
  it('the part order is fixed and every learnable op\'s part is one of it (C10)', () => {
    expect([...LESSON_PART_ORDER]).toEqual(['speed', 'trim', 'transform', 'motion', 'look', 'effect', 'title', 'gain', 'fades', 'soundFx', 'transition', 'stabilise']);
    for (const op of LEARNABLE_OPS) expect(LESSON_PART_ORDER, op).toContain((LEARN[op] as { part: string }).part);
  });
});

describe('the catalogues\' parameters (C5, C6, exhaustive)', () => {
  const walk = (list: readonly { id: string; params: unknown }[], table: Readonly<Record<string, Readonly<Record<string, string>>>>, name: string) => {
    const seen: Record<string, Record<string, string>> = {};
    for (const e of list) for (const [k, s] of Object.entries(shapeOf(e.params as Zod)!)) {
      const b = base(s);
      if (b.def.type === 'number' || b.def.type === 'boolean') continue;
      (seen[e.id] ??= {})[k] = b.def.type === 'enum' ? 'enum' : b.def.type === 'string' ? 'string' : b.def.type;
    }
    // every string or enum parameter has a row; no row names a parameter that is not one
    expect(Object.keys(table).sort(), name).toEqual(Object.keys(seen).sort());
    for (const [id, ps] of Object.entries(seen)) {
      expect(Object.keys(table[id]!).sort(), `${name} ${id}`).toEqual(Object.keys(ps).sort());
      for (const [k, t] of Object.entries(ps)) {
        if (t === 'enum') expect(table[id]![k], `${id}.${k} is an enum`).toBe('enum');
        else expect(['colour', 'words', 'asset', 'measured'], `${id}.${k}`).toContain(table[id]![k]);
      }
    }
  };
  it('every string parameter of EFFECTS is classified (color.lut lut: asset; the date stamp\'s text: words)', () => {
    walk(EFFECTS as unknown as { id: string; params: unknown }[], EFFECT_STRING_PARAMS, 'EFFECTS');
    expect(EFFECT_STRING_PARAMS['color.lut']!.lut).toBe('asset');
    expect(EFFECT_STRING_PARAMS['stylize.date-stamp']!.text).toBe('words');
  });
  it('every string parameter of AUDIO_EFFECTS is classified (the denoise profile and its source: measured)', () => {
    walk(AUDIO_EFFECTS as unknown as { id: string; params: unknown }[], AUDIO_EFFECT_STRING_PARAMS, 'AUDIO_EFFECTS');
    expect(AUDIO_EFFECT_STRING_PARAMS['cleanup.denoise']).toEqual({ profile: 'measured', source: 'measured' });
  });
  it('a colour is a #RRGGBB pattern, never free words', () => {
    for (const e of EFFECTS as unknown as { id: string; params: unknown }[]) for (const [k, s] of Object.entries(shapeOf(e.params as Zod)!))
      if (EFFECT_STRING_PARAMS[e.id]?.[k] === 'colour') {
        const p = base(s) as unknown as { safeParse(v: unknown): { success: boolean } };
        expect([p.safeParse('#1A2B3C').success, p.safeParse('נועה').success, p.safeParse('Noa 1.5.24').success], `${e.id}.${k}`).toEqual([true, false, false]);
      }
  });
  it('every numeric parameter described in frames is classified a frame count or not one, and frame counts are integers', () => {
    for (const e of EFFECTS as unknown as { id: string; params: unknown }[]) for (const [k, s] of Object.entries(shapeOf(e.params as Zod)!)) {
      const b = base(s);
      if (b.def.type !== 'number') continue;
      const desc = s.description ?? b.description ?? '';
      const mentions = /\bframes?\b/.test(desc) && !/fraction of (the )?frame/.test(desc);
      const isF = !!EFFECT_FRAME_PARAMS[e.id]?.includes(k), notF = !!EFFECT_NOT_FRAME_PARAMS[e.id]?.includes(k);
      if (mentions) expect(isF !== notF, `${e.id}.${k} classified once`).toBe(true);
      else expect(isF || notF, `${e.id}.${k} needs no row`).toBe(false);
      if (isF) expect(JSON.stringify(b.def), `${e.id}.${k} integer`).toMatch(/int|safeint/);
    }
  });
});

// ---------- validation (C12) ----------
const R30 = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R30);
const slot = { $slot: 'clip' } as const;
const part = (kind: LessonPart['kind'], key: string, steps: LessonPart['steps']): LessonPart => ({ key, kind, steps });
const ok = (parts: LessonPart[], targets = ['clp_b']) => ({ sourceClipId: 'clp_a', parts, targets });
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return `${e.code}: ${e.message}`; throw e; } return 'ok'; };

describe('lesson validation (lessonValidate.ts)', () => {
  const trim = part('trim', 'trim-start', [{ op: 'trim_clip', args: { clipId: slot, edge: 'start', to: { $edge: 'start', by: f(10) } } }]);
  const gain = part('gain', 'gain', [{ op: 'set_clip_gain', args: { clipId: { $slot: 'sound' }, gain: 0.7 } }]);
  const fades = part('fades', 'fades', [{ op: 'set_clip_fades', args: { clipId: { $slot: 'sound' }, fadeIn: { $dur: f(15) } } }]);
  const look = part('look', 'look', [{ op: 'apply_look', args: { clipId: slot, lookId: 'warm-sun' } }]);
  const fx = part('effect', 'effect-1', [
    { op: 'add_effect', args: { clipId: slot, type: 'time.echo', params: { delay: { $frames: 3, rate: R30 }, mode: 'trail' } }, bind: 'fx1' },
    { op: 'update_effect', args: { clipId: slot, effectId: { $ref: 'fx1', out: 'effectId' }, enabled: false } },
  ]);
  it('accepts the proof\'s example and an effect life with its own $ref; targets named twice count once', () => {
    expect(validateLessonArgs(ok([trim, look, gain, fades, fx], ['clp_b', 'clp_c', 'clp_b'])).targets).toEqual(['clp_b', 'clp_c']);
  });
  it('refuses a literal clip, a step op that is not learnable, a step in the wrong part, an unclassified or never-carried argument', () => {
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'set_clip_gain', args: { clipId: 'clp_x', gain: 1 } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.literalClip.message('set_clip_gain')}`);
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'set_clip_gain', args: { gain: 1 } }])])))).toMatch(/^invalid_args: set_clip_gain: a step names/);
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'add_person', args: { name: 'x' } }])])))).toBe(`forbidden_op: ${LESSON_REFUSALS.notStepOp.message('add_person')}`);
    expect(code(() => validateLessonArgs(ok([part('effect', 'e', [{ op: 'remove_effect', args: { clipId: slot, effectId: { $ref: 'x', out: 'effectId' } } }])])))).toMatch(/^forbidden_op/);
    expect(code(() => validateLessonArgs(ok([part('look', 'g', [{ op: 'set_clip_gain', args: { clipId: slot, gain: 1 } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.wrongPart.message('set_clip_gain', 'look')}`);
    expect(code(() => validateLessonArgs(ok([part('title', 't', [{ op: 'update_text', args: { clipId: slot, text: 'נועה' } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.neverCarried.message('update_text', 'text')}`);
    expect(code(() => validateLessonArgs(ok([part('effect', 'e', [{ op: 'add_effect', args: { clipId: slot, type: 'blur.gaussian', index: 0 } }])])))).toMatch(/never carried/);
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'set_clip_gain', args: { clipId: slot, gain: 1, extra: 1 } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.unknownArg.message('set_clip_gain', 'extra')}`);
    expect(code(() => validateLessonArgs(ok([part('stabilise', 's', [{ op: 'set_clip_stabilise', args: { clipId: slot, stabilise: { strength: 50, zoomPm: 1100 } } }])])))).toMatch(/stabilise.zoomPm is never carried/);
  });
  it('refuses every $-key except at its own kind, and each binding in its exact shape', () => {
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'set_clip_gain', args: { clipId: slot, gain: { $dur: f(1) } } }])])))).toMatch(/"\$dur" is not a binding/);
    expect(code(() => validateLessonArgs(ok([part('gain', 'g', [{ op: 'set_clip_gain', args: { clipId: slot, $edge: 'start' } }])])))).toMatch(/"\$edge" is not a binding/);
    expect(code(() => validateLessonArgs(ok([part('transform', 't', [{ op: 'set_clip_transform', args: { clipId: slot, transform: { x: { $frames: 1, rate: R30 } } } }])])))).toMatch(/"\$frames" is not a binding/);
    expect(code(() => validateLessonArgs(ok([part('trim', 't', [{ op: 'trim_clip', args: { clipId: slot, edge: 'start', to: f(10) } }])])))).toMatch(/to must be/);
    expect(code(() => validateLessonArgs(ok([part('trim', 't', [{ op: 'trim_clip', args: { clipId: slot, edge: 'end', to: { $edge: 'start', by: f(1) } } }])])))).toMatch(/equal to the step's own edge/);
    expect(code(() => validateLessonArgs(ok([part('trim', 't', [{ op: 'trim_clip', args: { clipId: slot, edge: 'start', to: { $edge: 'start', by: f(1), x: 1 } } }])])))).toMatch(/to must be/);
    expect(code(() => validateLessonArgs(ok([part('transition', 't', [{ op: 'set_transition', args: { clipId: slot, type: 'dissolve', frames: 12 } }])])))).toMatch(/frames must be/);
    expect(code(() => validateLessonArgs(ok([part('effect', 'e', [{ op: 'update_effect', args: { clipId: slot, effectId: { $ref: 'fx9', out: 'effectId' }, enabled: false } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.unboundRef.message('update_effect', 'fx9')}`);
    expect(code(() => validateLessonArgs(ok([part('effect', 'e', [{ op: 'update_effect', args: { clipId: slot, effectId: 'fx_literal', enabled: false } }])])))).toMatch(/effectId must be/);
  });
  it('C5, C6: effect params by the catalogue — frames as $frames, no asset id, no typed date, no measured profile, catalogue fonts only', () => {
    const add = (type: string, params: Record<string, unknown>, kind: LessonPart['kind'] = 'effect', op = 'add_effect') => () => validateLessonArgs(ok([part(kind, 'e', [{ op, args: { clipId: slot, type, params } }])]));
    expect(code(add('time.echo', { delay: 3 }))).toMatch(/params.delay must be/);
    expect(code(add('color.lut', { lut: 'ast_x', intensity: 1 }))).toMatch(/params.lut is never carried/);
    expect(code(add('stylize.date-stamp', { text: "'05 7 14" }))).toMatch(/params.text is never carried/);
    expect(code(add('stylize.date-stamp', { source: 'capture', corner: 'top-left', color: '#FFFFFF' }))).toBe('ok');
    expect(code(add('cleanup.denoise', { profile: 'x' }, 'soundFx', 'add_audio_effect'))).toMatch(/params.profile is never carried/);
    expect(code(add('cleanup.denoise', { source: 'ast_x' }, 'soundFx', 'add_audio_effect'))).toMatch(/params.source is never carried/);
    expect(code(add('space.reverb', { room: 'hall' }, 'soundFx', 'add_audio_effect'))).toBe('ok');
    expect(code(() => validateLessonArgs(ok([part('title', 't', [{ op: 'update_text', args: { clipId: slot, style: { fontFamily: 'Noa Handwriting' } } }])])))).toBe(`invalid_args: ${LESSON_REFUSALS.fontNotInCatalogue.message('Noa Handwriting')}`);
  });
  it('limits: 64 steps, targets × steps ≤ 2,000, unique part keys, the source is not a target', () => {
    const one = (k: number): LessonPart => part('gain', `g${k}`, [{ op: 'set_clip_gain', args: { clipId: slot, gain: 1 } }]);
    const many = (n: number, k: number) => Array.from({ length: n }, (_, i) => part('gain', `p${i}`, Array.from({ length: k }, () => ({ op: 'set_clip_gain', args: { clipId: slot, gain: 1 } }))));
    expect(code(() => validateLessonArgs(ok(many(5, 13))))).toBe(`out_of_bounds: ${LESSON_REFUSALS.tooManySteps.message(65)}`);
    expect(code(() => validateLessonArgs(ok(many(1, 11), Array.from({ length: 182 }, (_, i) => `clp_${i}`))))).toBe(`out_of_bounds: ${LESSON_REFUSALS.tooBig.message(2002)}`);
    expect(code(() => validateLessonArgs(ok(many(1, 10), Array.from({ length: 200 }, (_, i) => `clp_${i}`))))).toBe('ok');
    expect(code(() => validateLessonArgs(ok([one(1), one(1)])))).toBe(`invalid_args: ${LESSON_REFUSALS.duplicatePart.message('g1')}`);
    expect(code(() => validateLessonArgs(ok([one(1)], ['clp_a'])))).toBe(`invalid_args: ${LESSON_REFUSALS.sourceIsTarget.message('clp_a')}`);
    expect(LESSON_LIMITS.opRuns).toBe(2000);
  });
});

describe('apply_lesson (the op)', () => {
  it('is registered and public; after its validation it refuses not-built while lesson.ts is not built, and changes nothing', () => {
    expect(getOp('apply_lesson')?.internal).toBeFalsy();
    const doc = createProject({ id: 'prj_t', name: 't' });
    const add = applyTransaction(doc, [{ op: 'add_text', args: { text: 'a', start: f(0), duration: f(30) } }, { op: 'add_text', args: { text: 'b', start: f(30), duration: f(30) } }], { idSeed: 's', actor: 'user:local' });
    const [a, b] = add.results.map((r) => r.output!.clipId as string) as [string, string];
    const args = { sourceClipId: a, targets: [b], parts: [part('transform', 'transform', [{ op: 'set_clip_transform', args: { clipId: slot, transform: { scale: 1.2 } } }])] };
    const run = (x: unknown) => code(() => applyTransaction(add.doc, [{ op: 'apply_lesson', args: x as Record<string, unknown> }], { idSeed: 's2', actor: 'user:local' }));
    expect(run({ ...args, targets: ['clp_none'] })).toBe(`not_found: ${LESSON_REFUSALS.targetNotFound.message('clp_none')}`);
    expect(run({ ...args, targets: [a] })).toMatch(/^invalid_args: the clip the lesson was learned from/);
    expect(run({ ...args, parts: [part('gain', 'g', [{ op: 'add_person', args: { name: 'x' } }])] })).toMatch(/^forbidden_op/);
    if (!LESSON_OPS_BUILT) expect(run(args)).toBe(`unknown_op: ${LESSON_REFUSALS.notBuilt.message()}`);
  });
});

describe('the fixed order shared with paste attributes (pairRun.ts, C10, C16)', () => {
  it('inFixedOrder keeps the order list, whatever order the caller ticks; paste attributes walks PASTE_ORDER with it', () => {
    expect(inFixedOrder(PASTE_ORDER, ['sound', 'colour', 'transform'])).toEqual(['colour', 'transform', 'sound']);
    expect(inFixedOrder(LESSON_PART_ORDER, ['fades', 'trim', 'look', 'gain', 'trim'])).toEqual(['trim', 'look', 'gain', 'fades']);
  });
});

// ---------- W1 (lesson.ts) ----------
describe('W1: derive and apply (plan §5 checks as corrected by teach-verify)', () => {
  it.todo('check 2: trim A start 10 frames, look «חם», gain 0.7, sound fade-in 0.5 s, move A, type a title word → 4 parts trim-start, look, gain, fades in LESSON_PART_ORDER; move_clip `placement`, the word `words`; the planted word appears nowhere in the answer');
  it.todo('check 3: apply to B, C and a still: one transaction; starts exactly 10 frames later, source in-points advanced equally; grade equal to A\'s; gain 0.7 and fadeIn 0.5 s on the sound clips; the still skips gain and fades `no_sound` and takes the look');
  it.todo('check 4: planApplyLesson rows equal the commit\'s applied + skipped + rounded, field for field');
  it.todo('check 5: undo returns the canonical document byte-equal; redo equals the apply; replay from the op log equals the stored document');
  it.todo('check 7 (C15 fixed): two start trims of 3 frames at 30 fps folded to by = 1/5 s; applied in a 25 fps project the start moves exactly 5 frames with one `rounded` row (unmerged would be 6)');
  it.todo('check 9: a target on a locked track has its parts skipped track_locked, the others applied; the whole op refuses `nothing` only when no pair applied anywhere');
  it.todo('check 10 (crafted lesson, labelled): a strobe with rate 4 is refused per pair by the effect\'s own schema and the pair is put back exactly');
  it.todo('C1, C2 window stops: a version restore, paste_attributes, apply_lesson, an internal op (template / planner / take run), an accepted proposal (request_id prp_…) and the clip\'s creation each end the window; nothing at or before them is learned; undone rows are never learned; a redo learns the original row');
  it.todo('C4 folds: two partial set_colour_grade merge calls (exposure, then contrast) give one step with both; a replace resets; transform, text animation, transition options, fades and title style likewise');
  it.todo('C9 effect lives: add + update + modulator fold into one upsert; add then remove is `cancelled`; an edit of an effect from before the window is `made_before`; a target with one effect of the type has it replaced, not doubled; sound effects too');
  it.todo('C11: in a row with two trims of one clip each op\'s Δ is taken from its own before state; too short → out_of_bounds skip; at 2× speed Δ is timeline frames; reversed and still clips consistent');
  it.todo('C14 caps: at most 40 learning rows, 16 parts, 64 steps; the window says which stop ended it');
  it.todo('twin test: for every learnable op over fuzzed logs, derive → apply to a twin gives the same clip-local state as the same ops by hand (ids aside)');
  it.todo('touches: every step op changes only the target and its linked partners (diffEntities on a fuzz fixture), so saveTarget / restoreTarget put a refused pair back exactly');
});
