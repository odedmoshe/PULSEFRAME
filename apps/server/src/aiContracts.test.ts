/**
 * ADR-0017 server contracts: run request schemas, the AI configuration variables and their defaults, and the honest refusals of the
 * L0 bridge in Capabilities (estimates and source/apply runs answer 501 until the frame-job work lands). No port is opened.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LocalToolDescriptor } from '@pulseframe/providers';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { ApplyModeSchema, RunSourceSchema, SETUP_CODES, type CapabilityService, type LocalToolRunner, type SetupCode } from './aiContracts.ts';
import { Capabilities } from './capabilities.ts';
import { DEFAULT_MODEL_HOSTS, loadConfig } from './config.ts';
import { ApiError, Store, type JobRow } from './store.ts';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

describe('run request schemas', () => {
  it('a source is a clip or a library asset with an optional frame range; nothing else', () => {
    for (const ok of [{ clipId: 'clp_1' }, { assetId: 'ast_abc' }, { assetId: 'ast_abc', range: { firstFrame: 0, frameCount: 60 } }]) expect(RunSourceSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true);
    for (const bad of [{}, { assetId: '/etc/passwd' }, { clipId: '' }, { assetId: 'ast_a', range: { firstFrame: -1, frameCount: 1 } }, { assetId: 'ast_a', range: { firstFrame: 0, frameCount: 0 } }, { clipId: 'clp_1', assetId: 'ast_a' }, { path: '/tmp/x' }])
      expect(RunSourceSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(ApplyModeSchema.options).toEqual(['library', 'replace-clip', 'new-track']);
  });
  it('lists every setup code once', () => {
    const all: Record<SetupCode, true> = { ready: true, provider_not_configured: true, provider_unreachable: true, engine_not_configured: true, engine_not_working: true, engine_unverified: true, model_missing: true, licence_blocked: true, host_not_allowed: true, disk_insufficient: true };
    expect([...SETUP_CODES].sort()).toEqual(Object.keys(all).sort());
  });
});

describe('AI configuration (PF_TOOLS_*, PF_DENOISE_BIN, PF_AI_*)', () => {
  it('defaults: engines unset, the stated budgets, exact publisher hosts for model files', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ toolsPython: null, denoiseBin: null, toolsKeepSeconds: 60, aiScratchBytes: 2 * 1024 ** 3, aiHostRamBudgetBytes: 3 * 1024 ** 3, aiConfirmMinutes: 10, aiFirstRunMaxFrames: 60, agentMaxFramesPerJob: 300, agentMaxQueuedJobs: 2 });
    expect(c.toolsModelsDir).toBe(path.join(c.dataDir, 'tool-models'));
    expect(c.modelHosts).toEqual(DEFAULT_MODEL_HOSTS);
    expect(c.modelHosts).toEqual(['huggingface.co', '.hf.co', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'raw.githubusercontent.com']);
    expect(c.modelHosts.some((h) => h.includes('*'))).toBe(false);
  });
  it('reads the variables; a bad number keeps the default; an explicit host list replaces the default', () => {
    const c = loadConfig({ PF_TOOLS_PYTHON: '/opt/venv/bin/python', PF_DENOISE_BIN: '/opt/bin/deep-filter', PF_TOOLS_KEEP_SECONDS: '0', PF_AI_SCRATCH_BYTES: '1000', PF_AI_AGENT_MAX_FRAMES: 'lots', PF_AI_FIRST_RUN_FRAMES: '0', PF_MODEL_HOSTS: 'huggingface.co' });
    expect(c).toMatchObject({ toolsPython: '/opt/venv/bin/python', denoiseBin: '/opt/bin/deep-filter', toolsKeepSeconds: 0, aiScratchBytes: 1000, agentMaxFramesPerJob: 300, aiFirstRunMaxFrames: 1, modelHosts: ['huggingface.co'] });
  });
});

describe('Capabilities: the L0 bridge refuses what it cannot do yet, never guesses', () => {
  it('estimate and runs on a source or with a placement mode answer 501 not_implemented; an unknown capability is still 404', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aicontracts-'));
    dirs.push(dir);
    const store = new Store(dir);
    try {
      const caps = new Capabilities(store, { ...loadConfig({}), dataDir: dir });
      const code = async (fn: () => unknown) => { try { await fn(); } catch (e) { if (e instanceof ApiError) return `${e.status}:${e.code}`; throw e; } return 'ok'; };
      const req = { projectId: 'prj_x', capabilityId: 'comfy.image.soft-blur', params: {}, actor: 'user:owner' };
      expect(await code(() => caps.estimate(req))).toBe('501:not_implemented');
      expect(await code(() => caps.start({ ...req, source: { clipId: 'clp_1' } }))).toBe('501:not_implemented');
      expect(await code(() => caps.start({ ...req, apply: 'replace-clip' }))).toBe('501:not_implemented');
      expect(await code(() => caps.estimate({ ...req, capabilityId: 'nope.nope' }))).toBe('404:capability_not_found');
    } finally { store.close(); }
  });
});

describe('contract shape: a run is refused or created in one synchronous step', () => {
  it('LocalToolRunner.prepare returns its job.input additions synchronously, so CapabilityService.start can call it and stay synchronous', () => {
    // Job input is immutable once Store.createJob has run (updateJob has no input patch; recover restarts from it). start must therefore
    // get prepare's additions BEFORE createJob, and W3's REST and MCP callers use start's JobRow directly.
    expectTypeOf<LocalToolRunner['prepare']>().returns.toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<CapabilityService['start']>().returns.toEqualTypeOf<JobRow>();
  });
  it('the composition W1 writes: a prepare refusal leaves no job row; its additions land in job.input in the same tick', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aicontracts-'));
    dirs.push(dir);
    const store = new Store(dir);
    try {
      const pid = store.createProject({ name: 'shape' }).doc.id;
      // Labelled fake: a LocalToolRunner.prepare that reads only the request (a real one reads the document and the configuration).
      const prepare: LocalToolRunner['prepare'] = (_d, req) => {
        if (!req.source) throw new ApiError(422, 'source_required', 'this tool reads a clip or a library asset');
        return { range: { from: 0, samples: 48_000 } };
      };
      const d = { id: 'test.local.shape', provider: 'local' } as LocalToolDescriptor; // the fake reads nothing from it
      const start: CapabilityService['start'] = (req) => store.createJob(req.projectId, 'capability', req.actor, { capabilityId: req.capabilityId, ...prepare(d, req) });
      const jobs = () => (store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
      const req = { projectId: pid, capabilityId: d.id, params: {}, actor: 'user:owner' };
      expect(() => start(req)).toThrow(expect.objectContaining({ code: 'source_required' }));
      expect(jobs()).toBe(0);
      const job = start({ ...req, source: { assetId: 'ast_a' } });
      expect(store.getJob(job.id).input).toEqual({ capabilityId: d.id, range: { from: 0, samples: 48_000 } });
    } finally { store.close(); }
  });
});
