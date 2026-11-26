/**
 * Autonomy, families B and I (approvals, money, AI caps) in BOTH modes (autonomy.ts; verifier C13, C14). Guarded = the
 * refusals of today (their own tests stay in governance.test.ts, framePlan.test.ts and capabilities.test.ts); open = the same
 * call goes ahead, told rather than refused where the decision says warn.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VIDEO_ENHANCE } from '@pulseframe/providers';
import { stampOpen, OPEN_AGENTS_LEDGER } from './autonomy.ts';
import { admitFramePlan, buildFramePlan } from './framePlan.ts';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';

const agent: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] };
const code = (f: () => unknown) => { try { f(); return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : String(e); } };

describe('B5/I3 paid work: an open agent spends from the owner-wide agents\' budget', () => {
  const gov = () => new Governance(new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-auto-money-'))));
  it('guarded: the built-in agent token is refused paid work (no Autopilot grant), as today', () => {
    expect(code(() => gov().reserve(stampOpen(agent, 'guarded'), 'job_1', 5))).toBe('403:insufficient_scope');
  });
  it('open: no budget set = no ceiling; the row is held under open-agents', () => {
    const g = gov();
    expect(code(() => g.reserve(stampOpen(agent, 'open'), 'job_1', 500))).toBe('ok');
    expect(g.spend(OPEN_AGENTS_LEDGER)).toEqual({ spentCents: 0, reservedCents: 500 });
  });
  it('open with the owner\'s budget of 1 cent: 402 budget_exceeded with the next step', () => {
    const g = gov();
    g.openAgentBudgetCents = () => 1;
    expect(code(() => g.reserve(stampOpen(agent, 'open'), 'job_1', 2))).toBe('402:budget_exceeded');
    expect(code(() => g.reserve(stampOpen(agent, 'open'), 'job_2', 1))).toBe('ok');
  });
});

describe('B11/B12/I6 AI admission: told, not refused, for an open caller', () => {
  const GiB = 1024 ** 3;
  const limits = { agentMaxFramesPerJob: 300, aiFirstRunMaxFrames: 60, aiConfirmMinutes: 10, aiScratchBytes: 100 * GiB };
  const big = { ...VIDEO_ENHANCE, limits: { ...VIDEO_ENHANCE.limits, maxFrames: 1000 } };
  const plan = (frames: number) => buildFramePlan({ mode: big.frames!.mode, firstFrame: 0, frameCount: frames, rate: { num: 30, den: 1 }, width: 320, height: 180, chunkFrames: big.frames!.chunkFrames, multiplier: 1, cuts: [] } as any);
  const admit = (o: { frames: number; agent: boolean; warnOnly?: boolean; measured?: boolean; seconds?: number | null }) => { let w: string[] = []; const r = code(() => { w = admitFramePlan({ d: big, plan: plan(o.frames), agent: o.agent, warnOnly: o.warnOnly, limits, measured: o.measured ?? true, seconds: o.seconds ?? null, scratchBytes: 1, freeBytes: null }); }); return { r, w }; };
  it('guarded: first_run_limit and confirm_long_run refuse (today)', () => {
    expect(admit({ frames: 61, agent: true, measured: false }).r).toBe('409:first_run_limit');
    expect(admit({ frames: 30, agent: true, seconds: 601 }).r).toBe('409:confirm_long_run');
  });
  it('open: both become warnings on the job and the run goes ahead; the agent frame cap is not applied (agent: false)', () => {
    const a = admit({ frames: 61, agent: false, warnOnly: true, measured: false });
    expect(a.r).toBe('ok');
    expect(a.w.join(' ')).toMatch(/first_run_limit/);
    const b = admit({ frames: 30, agent: false, warnOnly: true, seconds: 601 });
    expect(b.r).toBe('ok');
    expect(b.w.join(' ')).toMatch(/confirm_long_run/);
    expect(admit({ frames: 301, agent: false, warnOnly: true }).r).toBe('ok');
    expect(admit({ frames: 301, agent: true }).r).toBe('409:agent_limit');
  });
});
