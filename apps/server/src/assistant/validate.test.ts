/**
 * What a model answer must be before it may become a proposal (ADR-0027, plan §7.4 step 4). The nine invalid answers of
 * plan §8 are refused here, each with its own first reason; job.test.ts runs them through the job (no proposal row).
 */
import { describe, expect, it } from 'vitest';
import { MAX_ASSISTANT_OPS } from '@pulseframe/core';
import type { ChatResponse } from '@pulseframe/providers';
import { invalidMockAnswers, type MockStep } from './testAdapter.ts';
import { checkModelAnswer, ModelProposalSchema } from './validate.ts';

const T1 = { value: '1', timescale: 1 };
const respond = (s: MockStep): ChatResponse => { if (!('respond' in s)) throw new Error('fixture'); return { ...s.respond, providerRequestId: 'MOCK-0' }; };
const split = { op: 'split_clip', args: { clipId: 'clp_a', at: T1 } };

describe('checkModelAnswer', () => {
  it('refuses each of the nine invalid answers with its own first reason', () => {
    const cases = invalidMockAnswers('clp_a');
    expect(cases).toHaveLength(9);
    for (const c of cases) {
      const r = checkModelAnswer(respond(c.step));
      expect(r.ok, c.name).toBe(false);
      if (!r.ok) expect(r.reason, c.name).toMatch(c.reason);
    }
  });
  it('accepts a tool answer and a JSON text answer of the same shape; the ops are passed on as given', () => {
    const tool = checkModelAnswer({ toolInput: { ops: [split], explanation: 'cut' }, text: null, finish: 'tool', usage: null, providerRequestId: null });
    expect(tool).toEqual({ ok: true, ops: [split], explanation: 'cut' });
    const text = checkModelAnswer({ toolInput: null, text: ` ${JSON.stringify({ ops: [split] })}\n`, finish: 'stop', usage: null, providerRequestId: null });
    expect(text).toEqual({ ok: true, ops: [split], explanation: null });
  });
  it('refuses the other unfinished answers, a too-long explanation, excluded ops and an empty ops list', () => {
    const base = { text: null, usage: null, providerRequestId: null } as const;
    for (const finish of ['filtered', 'other'] as const) expect(checkModelAnswer({ ...base, toolInput: { ops: [split] }, finish }).ok).toBe(false);
    expect(checkModelAnswer({ ...base, toolInput: { ops: [split], explanation: 'x'.repeat(601) }, finish: 'tool' }).ok).toBe(false);
    expect(checkModelAnswer({ ...base, toolInput: { ops: [] }, finish: 'tool' }).ok).toBe(false);
    for (const op of ['import_captions', 'update_cue', 'set_redact_region', 'set_project_format', 'add_event']) {
      const r = checkModelAnswer({ ...base, toolInput: { ops: [{ op, args: {} }] }, finish: 'tool' });
      expect(r.ok, op).toBe(false);
      if (!r.ok) expect(r.reason, op).toMatch(/not one the assistant may propose/);
    }
    expect(checkModelAnswer({ ...base, toolInput: { ops: [split], projectId: 'p' }, finish: 'tool' }).ok).toBe(false); // strict shape
    expect(checkModelAnswer({ ...base, toolInput: null, text: '   ', finish: 'stop' }).ok).toBe(false);
  });
  it('the shape allows 1 to MAX_ASSISTANT_OPS ops', () => {
    expect(ModelProposalSchema.safeParse({ ops: Array.from({ length: MAX_ASSISTANT_OPS }, () => split) }).success).toBe(true);
    expect(ModelProposalSchema.safeParse({ ops: Array.from({ length: MAX_ASSISTANT_OPS + 1 }, () => split) }).success).toBe(false);
  });
});
