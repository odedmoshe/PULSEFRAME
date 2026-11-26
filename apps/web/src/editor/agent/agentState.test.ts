import { describe, expect, it } from 'vitest';
import { AGENT_RUN_STATUSES, AGENT_STOP_REASONS, summarizeNotUndone, type AgentRun, type AgentStep } from '@pulseframe/core';
import { canContinue, canUndo, conflictsOf, costLines, counterLine, dollars, failureText, framesOf, isActive, notUndoneTexts, pickRun, probeText, statusWords, tr } from './agentState.ts';

const run = (o: Partial<AgentRun> = {}): AgentRun => ({ id: 'run_abcdefgh', projectId: 'p', actor: 'agent:run_abcdefgh', startedBy: 'user:local', goal: 'g', providerId: 'anthropic', model: 'm', status: 'running', stopReason: null, stepsUsed: 3, stepLimit: 100, spendLimitCents: null, spentCents: 0, unknownCostCalls: 0, tokens: { input: 1200, output: 300 }, plan: [], startRevision: 0, jobId: 'j', summary: null, createdAt: '', endedAt: null, undoneBy: null, ...o });
const modelStep = (cents: number | null): Pick<AgentStep, 'model'> => ({ model: { text: null, toolCalls: [], finish: 'tool', usage: null, cost: { cents, unknown: false }, providerId: 'anthropic', model: 'm' } });

describe('agent tab wording (both languages, no DOM)', () => {
  it('the counter says N of M, or no limit', () => {
    expect(counterLine('he', run())).toBe('צעד 3 מתוך 100');
    expect(counterLine('en', run({ stepLimit: null }))).toBe('Step 3 (no limit)');
  });
  it('a stopped run says WHY with its limit, a waiting one says why from its last note', () => {
    expect(statusWords('he', run({ status: 'stopped_at_limit', stopReason: 'step_limit' })).why).toContain('100');
    expect(statusWords('en', run({ status: 'waiting' }), [{ kind: 'note', note: { code: 'paused', text: 'Paused by the editor' } }]).why).toBe('Paused by the editor');
    expect(statusWords('en', run({ status: 'waiting' })).why).toMatch(/paused/i);
  });
  it('every status and stop reason resolves to a sentence, never to its key', () => {
    for (const lang of ['he', 'en'] as const) {
      for (const s of AGENT_RUN_STATUSES) expect(tr(lang, `agent.status.${s}`)).not.toBe(`agent.status.${s}`);
      for (const s of AGENT_STOP_REASONS) expect(statusWords(lang, run({ stopReason: s })).why).not.toMatch(/^agent\./);
    }
  });
  it('shows cost only when a call was priced; otherwise tokens; and the lost-answer calls', () => {
    expect(costLines('en', run({ spentCents: 150 }), [modelStep(150)])[0]).toContain('1.50');
    expect(costLines('en', run(), [modelStep(null)])[0]).toContain('1,500 tokens');
    expect(costLines('he', run({ unknownCostCalls: 2 }), [])).toHaveLength(2);
    expect(dollars(0.5)).toBe('0.005');
    expect(dollars(0)).toBe('0.00');
  });
  it('which buttons a status allows', () => {
    expect(isActive('waiting')).toBe(true);
    expect(canContinue('stopped_at_limit')).toBe(true);
    expect(canContinue('succeeded')).toBe(false);
    expect(canUndo(run({ status: 'succeeded' }))).toBe(true);
    expect(canUndo(run({ status: 'running' }))).toBe(false);
    expect(canUndo(run({ status: 'succeeded', undoneBy: 'tx' }))).toBe(false);
  });
  it('«לא בוטל» has one line per class from summarizeNotUndone, with money unpriced worded as such', () => {
    const items = summarizeNotUndone([
      { kind: 'tool', status: 'done', tool: { tool: 'export_project', isError: false, jobIds: ['a', 'b'] }, model: null },
      { kind: 'model', status: 'done', tool: null, model: { cost: { cents: null, unknown: false }, providerId: 'openai' } },
    ]);
    const t = notUndoneTexts('he', items);
    expect(t.map((x) => x.kind)).toEqual(['export_file', 'money_spent', 'data_sent']);
    expect(t[0]!.text).toContain('2');
    expect(t[1]!.text).toContain('בלי מחיר');
    expect(t[2]!.text).toContain('openai');
  });
  it('reads the pictures a step listed and the conflicts of a 409', () => {
    // the editor's real answers (mcp.ts render_frame / render_contact_sheet), not a made-up shape
    expect(framesOf('render_frame', '{"revision":7,"frameIndex":12,"time":{"value":"2","timescale":5},"width":1920,"height":1080,"variantId":"var_1","scale":0.5}')).toEqual([{ frame: 12, revision: 7, variantId: 'var_1' }]);
    expect(framesOf('render_contact_sheet', '{"revision":9,"scale":0.25,"frames":[0, 30,60],"width":640,"height":360}')).toEqual([0, 30, 60].map((frame) => ({ frame, revision: 9 })));
    expect(framesOf('render_frame', '{"revision":3,"frameIndex":4,"sequenceId":"seq_2","width":64')).toEqual([{ frame: 4, revision: 3, sequenceId: 'seq_2' }]); // a summary cut short still names them
    expect(framesOf('get_summary', '{"revision":7,"frameIndex":12}')).toEqual([]);
    expect(framesOf('render_frame', null)).toEqual([]);
    expect(conflictsOf({ conflicts: [{ entityId: 'c1', changedAtRevision: 5, by: 'user:local' }, 3] })).toHaveLength(1);
    expect(conflictsOf(undefined)).toEqual([]);
  });
  it('failures: owner floor, a worded code, the probe answer by code', () => {
    expect(failureText('en', { code: 'owner_required' })).toMatch(/owner/);
    expect(failureText('he', { code: 'agent_not_built' })).toContain('לא נבנה');
    expect(failureText('en', { code: 'weird', message: 'raw words' })).toBe('raw words');
    expect(probeText('he', { ok: false, code: 'unauthorized', model: null })).toContain('המפתח');
    expect(probeText('en', { ok: false, code: 'bad_config', model: null })).toMatch(/address/);
    expect(probeText('en', { ok: true, code: null, model: 'm1' })).toContain('m1');
  });
  it('opens the active run, else the newest', () => {
    expect(pickRun([{ status: 'succeeded' }, { status: 'running' }])?.status).toBe('running');
    expect(pickRun([{ status: 'failed' }, { status: 'succeeded' }])?.status).toBe('failed');
    expect(pickRun([])).toBeNull();
  });
});
