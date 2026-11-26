/**
 * The validation rules of a lesson (wave 8 teach; lessonContract.ts; teach-verify C5, C6, C7, C12). COMPLETE in the pre-pass: the
 * op apply_lesson runs it before anything else, and so does the derive route's answer test (W2) on every lesson it hands out.
 * - Every step's op is a lesson STEP op (LESSON_STEP_OPS), else forbidden_op; it belongs to its part's kind.
 * - Every argument key is classified for that op (LEARN args); never-carried kinds (position, words, measured) are absent.
 * - clipId is a slot binding {$slot:'clip'|'sound'}, never a literal clip id (C12).
 * - A `$`-key is accepted only at the argument kind that owns it, in its exact shape ($edge with the step's own edge, $dur,
 *   $frames, $ref to an earlier step of the same part with out 'effectId'); any other `$`-key anywhere is refused (C12:
 *   resolveBindings would otherwise pass {$edge:…} through to zod).
 * - Effect params by the catalogues' classes (C5, C6): frame params are $frames; enum and colour strings are values; words, asset
 *   and measured strings are absent. A font family is a FONT_CATALOG family (C5).
 * - At most 64 steps, unique part keys, targets × steps ≤ 2,000 (C12). The source clip is not a target.
 * Pure; no document (targets' existence is the op's own check).
 */
import { findFont } from './fonts.ts';
import {
  ApplyLessonArgsSchema, CARRIED_STRING_CLASSES, DurBindingSchema, EdgeBindingSchema, FramesBindingSchema, isFrameParam, LESSON_LIMITS, learnRow, lessonRefusal,
  LessonRefSchema, NEVER_CARRIED_KINDS, SlotBindingSchema, stringParamClass, type ApplyLessonArgs, type ArgClass, type LessonPart, type LessonStep,
} from './lessonContract.ts';
import { OpError } from './ops.ts';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
/** Any object key starting with `$` anywhere inside `x` is refused. */
function noBinding(x: unknown, op: string, where: string): void {
  if (Array.isArray(x)) { for (const e of x) noBinding(e, op, where); return; }
  if (!isObj(x)) return;
  for (const [k, e] of Object.entries(x)) {
    if (k.startsWith('$')) throw lessonRefusal('unknownBinding', { op, at: where, key: k }, op, k);
    noBinding(e, op, `${where}.${k}`);
  }
}
const shaped = (schema: { safeParse(v: unknown): { success: boolean } }, x: unknown, op: string, key: string, want: string) => {
  if (!schema.safeParse(x).success) throw lessonRefusal('badBinding', { op, key }, op, key, want);
};

interface StepCtx { op: string; part: LessonPart; bound: Map<string, LessonStep>; step: LessonStep }
/** The effect type a step's params belong to: its own `type`, or the type of the step its $ref names. */
function effectTypeOf(c: StepCtx): string | null {
  const t = c.step.args.type;
  if (typeof t === 'string') return t;
  const ref = c.step.args.effectId;
  if (isObj(ref) && typeof ref.$ref === 'string') { const s = c.bound.get(ref.$ref); return typeof s?.args.type === 'string' ? s.args.type : null; }
  return null;
}

function checkArg(cls: ArgClass, x: unknown, c: StepCtx, key: string): void {
  const { op } = c;
  if (typeof cls === 'object') {
    if (x === null && cls.nullable) return;
    if (!isObj(x)) { noBinding(x, op, key); return; } // the op's own zod parse says what is wrong with it
    for (const [k, e] of Object.entries(x)) {
      if (k.startsWith('$')) throw lessonRefusal('unknownBinding', { op, at: key, key: k }, op, k);
      if (!Object.hasOwn(cls.sub, k)) throw lessonRefusal('unknownArg', { op, key: `${key}.${k}` }, op, `${key}.${k}`);
      checkArg(cls.sub[k]!, e, c, `${key}.${k}`);
    }
    return;
  }
  if (NEVER_CARRIED_KINDS.includes(cls)) throw lessonRefusal('neverCarried', { op, key }, op, key);
  switch (cls) {
    case 'slot': if (!SlotBindingSchema.safeParse(x).success) throw lessonRefusal('literalClip', { op, key }, op); return;
    case 'edgeTime': {
      shaped(EdgeBindingSchema, x, op, key, '{"$edge":"start"|"end","by":<time>}');
      if ((x as { $edge: string }).$edge !== c.step.args.edge) throw lessonRefusal('badBinding', { op, key }, op, key, 'an $edge equal to the step\'s own edge');
      return;
    }
    case 'duration': shaped(DurBindingSchema, x, op, key, '{"$dur":<time>}'); return;
    case 'frames': shaped(FramesBindingSchema, x, op, key, '{"$frames":<n>,"rate":<rate>}'); return;
    case 'ownRef': {
      const r = LessonRefSchema.safeParse(x);
      if (!r.success || r.data.out !== 'effectId' || r.data.at !== undefined) throw lessonRefusal('badBinding', { op, key }, op, key, '{"$ref":<bind of the step that added the effect>,"out":"effectId"}');
      if (!c.bound.has(r.data.$ref)) throw lessonRefusal('unboundRef', { op, name: r.data.$ref }, op, r.data.$ref);
      return;
    }
    case 'font': {
      noBinding(x, op, key);
      if (typeof x === 'string' && !findFont(x)) throw lessonRefusal('fontNotInCatalogue', { family: x.slice(0, 64) }, x.slice(0, 64));
      return;
    }
    case 'effectParams': {
      if (!isObj(x)) { noBinding(x, op, key); return; }
      const type = effectTypeOf(c);
      const catalogue = c.part.kind === 'soundFx' ? 'audio' : 'effect';
      for (const [k, e] of Object.entries(x)) {
        if (k.startsWith('$')) throw lessonRefusal('unknownBinding', { op, at: key, key: k }, op, k);
        if (type !== null && catalogue === 'effect' && isFrameParam(type, k)) { shaped(FramesBindingSchema, e, op, `${key}.${k}`, '{"$frames":<n>,"rate":<rate>}'); continue; }
        const sc = type === null ? undefined : stringParamClass(catalogue, type, k);
        if (sc && !CARRIED_STRING_CLASSES.includes(sc)) throw lessonRefusal('neverCarried', { op, key: `${key}.${k}`, class: sc }, op, `${key}.${k}`);
        noBinding(e, op, `${key}.${k}`);
      }
      return;
    }
    case 'value': noBinding(x, op, key); return;
  }
}

/**
 * Parse and validate apply_lesson's arguments (the whole-op rules above). Returns the parsed args with targets named twice counted
 * once. Throws OpError (lessonRefusal, or invalid_args from the schema).
 */
export function validateLessonArgs(raw: unknown): ApplyLessonArgs {
  const parsed = ApplyLessonArgsSchema.safeParse(raw);
  if (!parsed.success) throw new OpError('invalid_args', `apply_lesson: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')}`, { op: 'apply_lesson' });
  const a = parsed.data;
  const targets = [...new Set(a.targets)];
  if (targets.includes(a.sourceClipId)) throw lessonRefusal('sourceIsTarget', { clipId: a.sourceClipId }, a.sourceClipId);
  const steps = a.parts.reduce((n, p) => n + p.steps.length, 0);
  if (steps > LESSON_LIMITS.steps) throw lessonRefusal('tooManySteps', { steps }, steps);
  if (steps * targets.length > LESSON_LIMITS.opRuns) throw lessonRefusal('tooBig', { runs: steps * targets.length }, steps * targets.length);
  const keys = new Set<string>();
  for (const part of a.parts) {
    if (keys.has(part.key)) throw lessonRefusal('duplicatePart', { key: part.key }, part.key);
    keys.add(part.key);
    const bound = new Map<string, LessonStep>();
    for (const step of part.steps) {
      const row = learnRow(step.op);
      if (!row || row.learn !== 'yes' || !row.step) throw lessonRefusal('notStepOp', { op: step.op.slice(0, 64) }, step.op.slice(0, 64));
      if (row.part !== part.kind) throw lessonRefusal('wrongPart', { op: step.op, kind: part.kind }, step.op, part.kind);
      if (!Object.hasOwn(step.args, 'clipId')) throw lessonRefusal('literalClip', { op: step.op }, step.op);
      const c: StepCtx = { op: step.op, part, bound, step };
      for (const [k, x] of Object.entries(step.args)) {
        if (k.startsWith('$')) throw lessonRefusal('unknownBinding', { op: step.op, key: k.slice(0, 64) }, step.op, k.slice(0, 64));
        if (!Object.hasOwn(row.args, k)) throw lessonRefusal('unknownArg', { op: step.op, key: k.slice(0, 64) }, step.op, k.slice(0, 64));
        checkArg(row.args[k]!, x, c, k);
      }
      if (step.bind) {
        if (bound.has(step.bind)) throw lessonRefusal('badBinding', { op: step.op, key: 'bind' }, step.op, 'bind', 'a name not used by an earlier step of the part');
        bound.set(step.bind, step);
      }
    }
  }
  return { ...a, targets };
}
