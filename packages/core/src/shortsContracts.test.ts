/**
 * Lead contracts of the shorts track (ADR-0018): the registry rows of the sequence operations, their argument schemas, the
 * refusal tables, the request bodies and their defaults, the caps and the wording rules. Nothing here pins the behaviour of a
 * worker's stub: the bodies' own suites (W1 sequenceOps.test.ts, shortsPlan.test.ts, reframe.test.ts, quotes.test.ts; W2
 * statements.test.ts, highlights.test.ts) are listed as todo below until they exist.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  ApplySequencePlanArgsSchema, BuildShortsBodySchema, CANDIDATE_WARNINGS, describeOps, FindShortsBodySchema, getOp, JOIN_FADE, MAX_SEQUENCES, OpError, PLAN_WARNING_CODES,
  ReframePlanBodySchema, SCORE_COMPONENTS, SCORE_WEIGHTS, SEQUENCE_OPS, SEQUENCE_PLAN_OP, SEQUENCE_REFUSALS, SequenceOpArgs, sequenceRefusal, SHORT_REASON_CODES, SHORTS_CAPS,
  SHORTS_ERROR_CODES, SHORTS_RANK_METHOD, SHORTS_REFUSALS, SHORTS_RUN_ID, SHORTS_STATUS, ShortsError, shortsRefusal, AUDIO_FEATURES_METHOD,
} from './index.ts';

const t = (s: number) => T.rt(s, 1);

describe('sequence operations: registry rows', () => {
  it('four public operations and one internal plan op, all at version 1, with the contract schemas', () => {
    for (const name of SEQUENCE_OPS) {
      const def = getOp(name)!;
      expect(def, name).toBeDefined();
      expect(def.version).toBe(1);
      expect(def.internal).toBeFalsy();
      expect(def.args).toBe(SequenceOpArgs[name]);
    }
    const plan = getOp(SEQUENCE_PLAN_OP)!;
    expect(plan.internal).toBe(true);
    expect(plan.args).toBe(ApplySequencePlanArgsSchema);
    const pub = describeOps().map((o) => o.name);
    expect(pub).toEqual(expect.arrayContaining([...SEQUENCE_OPS]));
    expect(pub).not.toContain(SEQUENCE_PLAN_OP);
    expect(getOp('add_sequence')!.description).toContain(String(MAX_SEQUENCES));
  });
  it('argument schemas: strict, with the documented bounds', () => {
    const fmt = { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null };
    expect(SequenceOpArgs.add_sequence.safeParse({ name: 'Short', format: fmt, tracks: 'standard' }).success).toBe(true);
    expect(SequenceOpArgs.add_sequence.safeParse({ name: '' }).success).toBe(false);
    expect(SequenceOpArgs.add_sequence.safeParse({ name: 'x', origin: {} }).success).toBe(false); // no public op takes an origin
    expect(SequenceOpArgs.update_sequence.safeParse({ sequenceId: 'seq_1', format: null }).success).toBe(true);
    expect(SequenceOpArgs.remove_sequence.safeParse({ sequenceId: 'seq_1', withContents: true }).success).toBe(true);
    const key = { time: t(0), value: 0, easing: 'linear' };
    expect(SequenceOpArgs.replace_clip_keyframes.safeParse({ clipId: 'c', property: 'x', keys: [key] }).success).toBe(true);
    expect(SequenceOpArgs.replace_clip_keyframes.safeParse({ clipId: 'c', property: 'x', keys: null, at: t(1) }).success).toBe(true);
    expect(SequenceOpArgs.replace_clip_keyframes.safeParse({ clipId: 'c', property: 'x', keys: [] }).success).toBe(false);
    expect(SequenceOpArgs.replace_clip_keyframes.safeParse({ clipId: 'c', property: 'x', keys: Array.from({ length: 2001 }, () => key) }).success).toBe(false);
    expect(SequenceOpArgs.replace_clip_keyframes.safeParse({ clipId: 'c', property: 'blur', keys: [key] }).success).toBe(false);
  });
  it('apply_sequence_plan: at most 2000 steps, 10 origins and 10 rebuilt sequences; origins bind to an earlier step', () => {
    const origin = { kind: 'short', assetId: 'a', candidateId: null, excerpt: { start: t(0), end: t(30) }, kept: [{ start: t(0), end: t(30) }], score: null, reasons: [], reframe: 'centre', motionTrackId: null, method: SHORTS_RANK_METHOD, createdAt: '2026-11-18T00:00:00Z' };
    const ok = { planKind: 'shorts', params: {}, steps: ['x'], ops: [{ op: 'add_sequence', args: { name: 'S' }, bind: 's0' }], origins: [{ sequence: { $ref: 's0', out: 'sequenceId' }, origin }] };
    expect(ApplySequencePlanArgsSchema.safeParse(ok).success).toBe(true);
    expect(ApplySequencePlanArgsSchema.safeParse({ ...ok, ops: Array.from({ length: 2001 }, () => ok.ops[0]) }).success).toBe(false);
    expect(ApplySequencePlanArgsSchema.safeParse({ ...ok, origins: Array.from({ length: 11 }, () => ok.origins[0]) }).success).toBe(false);
    expect(ApplySequencePlanArgsSchema.safeParse({ ...ok, planKind: 'multicam' }).success).toBe(false);
    expect(ApplySequencePlanArgsSchema.safeParse({ ...ok, origins: [{ sequence: { $ref: 's0' }, origin: { ...origin, score: 'viral' } }] }).success).toBe(false);
  });
});

describe('refusal tables', () => {
  it('every sequence refusal is a typed OpError with a fixed English sentence', () => {
    for (const [key, r] of Object.entries(SEQUENCE_REFUSALS)) {
      const values = Array.from({ length: r.message.length }, (_, i) => (i === 0 ? 'x_1' : 2)) as never[];
      const e = (sequenceRefusal as (k: string, d: Record<string, unknown>, ...v: unknown[]) => OpError)(key, { k: 1 }, ...values);
      expect(e).toBeInstanceOf(OpError);
      expect(e.code).toBe(r.code);
      expect(e.message.length).toBeGreaterThan(5);
      expect(e.details).toEqual({ k: 1 });
    }
    expect(SEQUENCE_REFUSALS.tooManySequences.message()).toBe('a project holds at most 64 sequences');
  });
  it('every shorts refusal maps to an HTTP status; not_built is 501, never a made-up result', () => {
    expect(Object.keys(SHORTS_STATUS).sort()).toEqual([...SHORTS_ERROR_CODES].sort());
    expect(SHORTS_STATUS.not_built).toBe(501);
    expect(SHORTS_STATUS.needs_measurement).toBe(409);
    for (const [key, r] of Object.entries(SHORTS_REFUSALS)) {
      const values = Array.from({ length: r.message.length }, (_, i) => (i === 0 ? 1 : 'start')) as never[];
      const e = (shortsRefusal as (k: string, d: Record<string, unknown>, ...v: unknown[]) => ShortsError)(key, {}, ...values);
      expect(e).toBeInstanceOf(ShortsError);
      expect(SHORTS_ERROR_CODES).toContain(e.code);
    }
  });
});

describe('request bodies, caps and wording rules', () => {
  it('FindShortsBody defaults and bounds', () => {
    expect(FindShortsBodySchema.parse({ assetId: 'a' })).toEqual({ assetId: 'a', minSeconds: 20, maxSeconds: 60, count: 10, contextSeconds: 8, include: [], exclude: [], allowOverlap: false });
    expect(FindShortsBodySchema.safeParse({ assetId: 'a', minSeconds: 70, maxSeconds: 60 }).success).toBe(false);
    expect(FindShortsBodySchema.safeParse({ assetId: 'a', count: 41 }).success).toBe(false);
  });
  it('BuildShortsBody defaults: vertical 9:16, words snapping, no tightening, default captions, auto reframe, project loudness', () => {
    const b = BuildShortsBodySchema.parse({ picks: [{ assetId: 'a', start: t(10), end: t(40) }] });
    expect(b).toMatchObject({ format: { profileId: 'vertical-9x16' }, snap: 'words', tighten: { pauses: false, minPauseSeconds: 0.7, fillers: false }, captions: { lookId: null }, reframe: { source: 'auto', framing: 1 }, loudness: 'project' });
    expect(BuildShortsBodySchema.safeParse({ picks: Array.from({ length: 11 }, () => ({ assetId: 'a', start: t(0), end: t(30) })) }).success).toBe(false);
    expect(BuildShortsBodySchema.safeParse({ picks: [{ assetId: 'a', start: t(0), end: t(30), title: { text: 'x', origin: 'model' } }] }).success).toBe(false);
    expect(BuildShortsBodySchema.safeParse({ picks: [{ assetId: 'a', start: t(0), end: t(30), score: 99 }] }).success).toBe(false); // nobody types a score
    expect(ReframePlanBodySchema.parse({})).toEqual({ source: 'auto', framing: 1 });
  });
  it('caps accepted by the lead; weights sum to 100; joins fade exactly 1/100 s', () => {
    expect(SHORTS_CAPS).toMatchObject({ maxShortsPerApply: 10, maxPiecesPerShort: 40, maxOps: 2000, maxSequences: 64 });
    expect(SCORE_COMPONENTS.reduce((n, c) => n + SCORE_WEIGHTS[c], 0)).toBe(100);
    expect(T.eq(JOIN_FADE, T.rt(1, 100))).toBe(true);
    expect(SHORTS_RUN_ID).toBe('plan:shorts');
  });
  it('no contract word calls a score viral or a prediction; the method says heuristic', () => {
    const words = [SHORTS_RANK_METHOD, AUDIO_FEATURES_METHOD, ...SHORT_REASON_CODES, ...CANDIDATE_WARNINGS, ...PLAN_WARNING_CODES, ...Object.values(SHORTS_REFUSALS).map((r) => r.hint ?? '')].join(' ');
    expect(words).not.toMatch(/viral|virality|ויראל/i);
    expect(SHORTS_RANK_METHOD).toMatch(/heuristic/);
    expect(SHORTS_RANK_METHOD).toMatch(/not a prediction/);
  });
});

describe('worker suites (W1, W2)', () => {
  it.todo('sequenceOps.test.ts (W1): undo/redo of add/update/remove_sequence and apply_sequence_plan through diffEntities + restore_entities; undo_conflict for clips added later');
  it.todo('replace_clip_keyframes (W1): exact undo; unaligned, unsorted, 2001 keys, x = 4.5 and non-opacity adjustment keys refused; null freezes at `at`');
  it.todo('shortsPlan.test.ts (W1): outward whole frames, flash spacing, 1/100 s join fades, scene-cut pieces, plan_too_large');
  it.todo('reframe.test.ts (W1): coverage clamp, speed limit, ε bound, dead zone, backdropScale(1080×1920, 1920×1080) = 0.31640625');
  it.todo('quotes.test.ts (W1) and statements.test.ts / highlights.test.ts (W2)');
});
