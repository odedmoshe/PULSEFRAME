/** The in-editor agent's contract (wave 8 autonomy Part 2, lead pre-pass): schemas, ids, what undo-all cannot undo, transcript paging. */
import { describe, expect, it } from 'vitest';
import {
  AGENT_EFFECT_CLASSES, AGENT_RUN_CONTINUABLE, AGENT_RUN_FINAL, AGENT_RUN_STATUSES, AgentRunSchema, AgentStartBodySchema, AgentStepSchema,
  agentIdempotencyKey, agentJobStage, agentRunActor, isReservedAgentName, summarizeNotUndone, TOOL_EFFECTS, transcriptPage, type NotUndoneStep, type TranscriptView,
} from './index.ts';

const tool = (name: string, ok = true, jobIds: string[] = []): NotUndoneStep => ({ kind: 'tool', status: ok ? 'done' : 'failed', tool: { tool: name, isError: !ok, jobIds }, model: null });
const model = (cents: number | null, providerId = 'anthropic'): NotUndoneStep => ({ kind: 'model', status: 'done', tool: null, model: { cost: { cents, unknown: false }, providerId } });

describe('agent contract', () => {
  it('ids, actor, stage and idempotency key have one shape', () => {
    expect(agentRunActor('run_abc12345')).toBe('agent:run_abc12345');
    expect(agentJobStage(7, 'running')).toBe('step:7:running');
    expect(agentIdempotencyKey('run_abc12345', 3, 0)).toBe('run_abc12345.3.0');
    expect(isReservedAgentName('run_x')).toBe(true);
    expect(isReservedAgentName('claude-code')).toBe(false);
  });
  it('final and continuable statuses are statuses; continuable ones are final', () => {
    for (const s of AGENT_RUN_FINAL) expect(AGENT_RUN_STATUSES).toContain(s);
    for (const s of AGENT_RUN_CONTINUABLE) expect(AGENT_RUN_FINAL).toContain(s);
  });
  it('the start body is strict and bounded', () => {
    expect(AgentStartBodySchema.safeParse({ goal: 'תחתכו את השקטים' }).success).toBe(true);
    expect(AgentStartBodySchema.safeParse({ goal: '' }).success).toBe(false);
    expect(AgentStartBodySchema.safeParse({ goal: 'x', key: 'sk-1' }).success).toBe(false);
  });
  it('a run and a step record parse', () => {
    const run = { id: 'run_abc12345', projectId: 'prj_1', actor: 'agent:run_abc12345', startedBy: 'user:local', goal: 'g', providerId: 'anthropic', model: 'm', status: 'running', stopReason: null, stepsUsed: 0, stepLimit: 100, spendLimitCents: null, spentCents: 0, unknownCostCalls: 0, tokens: { input: 0, output: 0 }, plan: [{ title: 'לחתוך שקטים', status: 'pending' }], startRevision: 3, jobId: 'job_1', summary: null, createdAt: 'now', endedAt: null, undoneBy: null };
    expect(AgentRunSchema.parse(run).plan[0]!.status).toBe('pending');
    const step = { runId: run.id, n: 2, kind: 'tool', status: 'done', model: null, note: null, startedAt: 'a', endedAt: 'b', revisionAfter: 4, tool: { callId: 'toolu_1', tool: 'apply_transaction', input: { ops: [] }, resultSummary: '{"revision":4}', isError: false, errorCode: null, transactionIds: ['tx_1'], jobIds: [], idempotencyKey: 'run_abc12345.1.0' } };
    expect(AgentStepSchema.parse(step).tool!.tool).toBe('apply_transaction');
  });
  it('C7: what undo-all cannot undo is counted from the steps, in class order; failed steps have no effect', () => {
    const steps = [model(1.25), tool('apply_transaction'), tool('export_batch', true, ['job_a', 'job_b']), tool('export_project', false), model(0.5), tool('start_model_download'), model(null, 'local')];
    expect(summarizeNotUndone(steps)).toEqual([
      { kind: 'export_file', count: 2 }, { kind: 'model_download', count: 1 },
      { kind: 'money_spent', count: 3, cents: 1.75 },
      { kind: 'data_sent', count: 2, providerId: 'anthropic' }, { kind: 'data_sent', count: 1, providerId: 'local' },
    ]);
    expect(summarizeNotUndone([tool('apply_transaction')])).toEqual([]);
    expect(summarizeNotUndone([model(null)])).toEqual([{ kind: 'money_spent', count: 1, cents: null }, { kind: 'data_sent', count: 1, providerId: 'anthropic' }]);
    for (const k of Object.values(TOOL_EFFECTS)) expect(AGENT_EFFECT_CLASSES).toContain(k);
  });
});

describe('transcriptPage (get_transcript paging, C11)', () => {
  const seg = (i: number) => ({ id: `seg_${i}`, startSeconds: i * 2, endSeconds: i * 2 + 1.5, text: `משפט ${i}`, speaker: null, timing: 'word', words: [{ id: `w_${i}`, text: 'משפט', startSeconds: i * 2, endSeconds: i * 2 + 1 }] });
  const view = { assetId: 'a', language: 'he', origin: { kind: 'typed' }, note: 'n', segments: [0, 1, 2, 3, 4].map(seg) } as unknown as TranscriptView;
  it('without options the view is unchanged (the answer of before)', () => { expect(transcriptPage(view, {})).toBe(view); });
  it('a window keeps overlapping segments, a limit pages with nextFromSeconds', () => {
    const p = transcriptPage(view, { fromSeconds: 3, toSeconds: 9, limit: 2 }) as any;
    expect(p.segments.map((s: any) => s.id)).toEqual(['seg_1', 'seg_2']);
    expect(p.page).toEqual({ fromSeconds: 3, toSeconds: 9, segments: 2, totalSegments: 5, nextFromSeconds: 6 });
  });
  it('compact is one line per segment without words', () => {
    const p = transcriptPage(view, { compact: true }) as any;
    expect(p.segments).toBeUndefined();
    expect(p.lines[1]).toBe('seg_1 2.00-3.50 משפט 1');
    expect(p.page.nextFromSeconds).toBeNull();
  });
});
