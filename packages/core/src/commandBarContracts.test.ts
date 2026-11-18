/**
 * Lead contracts of the Hebrew command bar (ADR-0027): the contract's tables are complete and consistent, the plan hash is
 * the same for equal plans and different for different ones, the default title length has one source, the assistant's op
 * allowlist names only registered public ops and leaves people, the library and privacy out. Nothing here pins the grammar's
 * placeholder (W1's tests do the grammar).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  ASSISTANT_EXCLUDED_OPS, ASSISTANT_SUMMARY_FIELDS, ASSISTANT_TOGGLES_DEFAULT, assistantOps, BAR_ACTION_KINDS, BAR_NOTE_CODES, BAR_REFUSAL_CODES, barIdempotencyKey, barPlanHash,
  COMMAND_BAR_LABEL, DEFAULT_TITLE_SECONDS, defaultTitleDuration, EXPORT_DESTINATION_IDS, getOp, INTENT_COMMANDS, INTENT_IDS, MAX_ASSISTANT_OPS, MAX_BAR_OPS, PERSON_OPS,
  STEP_DETAIL_KINDS, TRANSITIONS_ALL_DEFAULT, type AssistantSummary, type BarAction, type StepDetail,
} from './index.ts';

describe('command bar contract tables', () => {
  it('intent ids are unique, each has a command entry, and a label never carries more than the id', () => {
    expect(new Set(INTENT_IDS).size).toBe(INTENT_IDS.length);
    expect(Object.keys(INTENT_COMMANDS).sort()).toEqual([...INTENT_IDS].sort());
    for (const id of INTENT_IDS) {
      expect(COMMAND_BAR_LABEL(id)).toBe(`Command bar: ${id}`);
      expect(COMMAND_BAR_LABEL(id).length).toBeLessThanOrEqual(200); // the REST label limit
    }
  });
  it('lists every kind of step, action, note and refusal exactly once', () => {
    for (const list of [STEP_DETAIL_KINDS, BAR_ACTION_KINDS, BAR_NOTE_CODES, BAR_REFUSAL_CODES, EXPORT_DESTINATION_IDS]) expect(new Set<string>(list).size).toBe(list.length);
    // completeness both ways, at the type level
    expectTypeOf<Exclude<StepDetail['kind'], (typeof STEP_DETAIL_KINDS)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<BarAction['kind'], (typeof BAR_ACTION_KINDS)[number]>>().toEqualTypeOf<never>();
    expectTypeOf<Exclude<keyof AssistantSummary, (typeof ASSISTANT_SUMMARY_FIELDS)[number]>>().toEqualTypeOf<never>();
  });
  it('limits: one request is at most 200 ops (one transaction), a model proposal at most 50', () => {
    expect(MAX_BAR_OPS).toBe(200);
    expect(MAX_ASSISTANT_OPS).toBe(50);
  });
  it('the soft dissolve of «הוסף מעבר בין כל הקליפים» is half a second, rounded once to frames', () => {
    expect(TRANSITIONS_ALL_DEFAULT.type).toBe('dissolve');
    const s = TRANSITIONS_ALL_DEFAULT.seconds;
    const frames = (rate: T.Rate) => T.nearestFrameIndex(T.rt(String(s.num), Number(s.den)), rate);
    expect([frames({ num: 25, den: 1 }), frames({ num: 30000, den: 1001 }), frames({ num: 24, den: 1 })]).toEqual([13, 15, 12]);
    expect(getOp('set_transition')).toBeTruthy();
  });
});

describe('plan hash and idempotency key', () => {
  const ops = [{ op: 'split_clip', args: { clipId: 'clp_a', at: T.frameTime(12, { num: 25, den: 1 }) } }];
  it('is the same for equal plans (key order and unreduced times do not matter) and differs by intent, ops or revision', () => {
    const h = barPlanHash('split_here', ops, 7);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(barPlanHash('split_here', [{ args: { at: { value: '24', timescale: 50 }, clipId: 'clp_a' }, op: 'split_clip' }], 7)).toBe(h);
    expect(barPlanHash('split_at', ops, 7)).not.toBe(h);
    expect(barPlanHash('split_here', ops, 8)).not.toBe(h);
    expect(barPlanHash('split_here', [{ op: 'split_clip', args: { clipId: 'clp_b', at: ops[0]!.args.at } }], 7)).not.toBe(h);
    expect(barIdempotencyKey(h)).toBe(`bar:${h}`);
    expect(barIdempotencyKey(h).length).toBeLessThanOrEqual(128); // the REST idempotencyKey limit
  });
});

describe('the default title length has one source (lead decision 4)', () => {
  it('is 2 s, rounded once to whole frames with ties up, as the editor rounded it before', () => {
    expect(DEFAULT_TITLE_SECONDS).toBe(2);
    for (const rate of [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }, { num: 24000, den: 1001 }])
      expect(T.eq(defaultTitleDuration(rate), T.frameTime(Math.round((2 * rate.num) / rate.den), rate))).toBe(true);
  });
});

describe('the assistant op allowlist', () => {
  it('excludes only registered ops (import_asset is internal anyway), and never lets people, the library or privacy regions through', () => {
    for (const name of ASSISTANT_EXCLUDED_OPS) expect(getOp(name), name).toBeTruthy();
    const allowed = new Set(assistantOps());
    for (const name of [...ASSISTANT_EXCLUDED_OPS, ...PERSON_OPS]) expect(allowed.has(name), name).toBe(false);
    for (const name of allowed) expect(getOp(name)?.internal, name).toBeFalsy();
  });
  it('keeps every op the grammar plans (the model may propose what the bar can do)', () => {
    const allowed = new Set(assistantOps());
    for (const name of ['split_clip', 'trim_clip', 'delete_clip', 'ripple_delete_clips', 'add_text', 'add_marker', 'set_track_audio', 'set_clip_gain', 'set_transition', 'set_clip_fades', 'set_clip_speed', 'freeze_frame', 'close_gaps', 'fit_music', 'rename_project', 'add_effect', 'apply_look', 'remove_track'])
      expect(allowed.has(name), name).toBe(true);
  });
  it('sends neither switch by default', () => expect(ASSISTANT_TOGGLES_DEFAULT).toEqual({ titlesAndMarkers: false, peopleNames: false }));
});
