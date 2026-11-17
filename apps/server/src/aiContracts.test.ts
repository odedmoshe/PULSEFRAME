/**
 * ADR-0017 server contracts: run request schemas, the AI configuration variables and their defaults, and the honest refusals of the
 * L0 bridge in Capabilities (estimates and source/apply runs answer 501 until the frame-job work lands; size contracts fail closed).
 * No port is opened and no provider is contacted.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { BUILTIN_CAPABILITIES, IMAGE_SOFT_BLUR, type ComfyDescriptor, type LocalToolDescriptor, type ProviderAdapter } from '@pulseframe/providers';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { ApplyModeSchema, RunSourceSchema, SETUP_CODES, type CapabilityService, type LocalToolRunner, type SetupCode } from './aiContracts.ts';
import { Capabilities } from './capabilities.ts';
import { DEFAULT_MODEL_HOSTS, loadConfig } from './config.ts';
import { ingestUpload } from './ingest.ts';
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

/**
 * The L0 bridge checks every declared size contract on the stored file before a job may succeed (ADR-0007), and a contract it cannot
 * compute fails the job: it is never skipped. Test-only descriptors (labelled `test.size.*`) are copies of the soft-blur built-in with
 * another size contract, added to the registry for this block and removed after it. The adapter is a labelled fake that writes a PNG of
 * the size the test asks for; no ComfyUI runs.
 */
describe('Capabilities: the size contract of every expectSize variant is enforced (fails closed)', () => {
  const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args]);
  it('scaleOfInput and scaleOfInputByParam: the exact size succeeds, any other size fails with output_invalid; a contract naming no recorded input fails too', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aicontracts-size-'));
    dirs.push(dir);
    const png = (w: number, h: number) => { const f = path.join(dir, `in_${w}x${h}.png`); if (!fs.existsSync(f)) ff(['-f', 'lavfi', '-i', `color=c=gray:s=${w}x${h}`, '-frames:v', '1', f]); return f; };
    let produce = { width: 0, height: 0 };
    const fakeAdapter: ProviderAdapter = { // labelled fake: never contacts a provider
      id: 'fake-size-adapter',
      probe: async () => ({ reachable: true, wokeWorker: false, runtimeVersion: 'fake', device: { name: 'fake', type: 'cpu', vramTotalBytes: null }, hostRamBytes: null, missingNodeClasses: [], missingModels: [], problems: [] }),
      estimate: () => ({ downloadBytes: 0, durationSeconds: null, costUsd: null, basis: 'none' }),
      stage: async (_p, name) => name,
      submit: async (_g, clientRequestId) => ({ providerJobId: `fake_${clientRequestId}`, clientRequestId }),
      status: async () => ({ state: 'succeeded' }),
      findByClientRequestId: async () => null,
      cancel: async () => 'not-supported',
      running: async () => [],
      collect: async (_d, _id, destDir) => {
        fs.mkdirSync(destDir, { recursive: true });
        const out = path.join(destDir, 'out.png');
        fs.copyFileSync(png(produce.width, produce.height), out);
        const bytes = fs.readFileSync(out);
        return [{ name: 'image', role: 'primary', mediaType: 'image', encoding: 'display', fileName: 'out.png', path: out, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }];
      },
    };
    const sigmaAllowed = { ...IMAGE_SOFT_BLUR.inputs[2]!, default: 1, allowed: [0.5, 0.75, 1] };
    const withSize = (id: string, expectSize: NonNullable<ComfyDescriptor['outputs'][number]['expectSize']>, inputs = IMAGE_SOFT_BLUR.inputs): ComfyDescriptor =>
      ({ ...IMAGE_SOFT_BLUR, id, inputs, outputs: [{ ...IMAGE_SOFT_BLUR.outputs[0]!, expectSize }] });
    const testDescriptors = [
      withSize('test.size.same', { sameAsInput: 'image' }),
      withSize('test.size.x4', { scaleOfInput: { input: 'image', factor: 4 } }),
      withSize('test.size.by-param', { scaleOfInputByParam: { input: 'image', param: 'sigma', base: 4 } }, [IMAGE_SOFT_BLUR.inputs[0]!, IMAGE_SOFT_BLUR.inputs[1]!, sigmaAllowed]),
      withSize('test.size.unknown-input', { sameAsInput: 'picture' }),
    ];
    BUILTIN_CAPABILITIES.push(...testDescriptors);
    const store = new Store(path.join(dir, 'data'));
    const caps = new Capabilities(store, { ...loadConfig({}), dataDir: path.join(dir, 'data') }, fakeAdapter);
    try {
      const pid = store.createProject({ name: 'sizes', width: 640, height: 360 }).doc.id;
      const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(png(32, 24))) as any, 'source.png', 'user:owner', 1 << 20);
      const assetId = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
      const outcome = async (capabilityId: string, size: { width: number; height: number }, params: Record<string, unknown> = {}) => {
        produce = size;
        let job;
        try { job = caps.start({ projectId: pid, capabilityId, params: { image: assetId, ...params }, actor: 'user:owner' }); } catch (e) { if (e instanceof ApiError) return `refused:${e.code}:${JSON.stringify((e.details as any)?.blockers?.map((b: any) => b.code) ?? [])}`; throw e; }
        for (let i = 0; i < 400; i++) {
          const j = store.getJob(job.id);
          if (j.status === 'succeeded') return 'succeeded';
          if (j.status === 'failed' || j.status === 'canceled') return `${j.status}:${j.error?.code}${j.error?.code === 'output_invalid' ? ` (${j.error.message})` : ''}`;
          await new Promise((r) => setTimeout(r, 25));
        }
        return `still ${store.getJob(job.id).status}`;
      };
      expect(await outcome('test.size.same', { width: 50, height: 50 })).toBe('failed:output_invalid (output "image" is 50x50, expected 32x24)');
      expect(await outcome('test.size.same', { width: 32, height: 24 })).toBe('succeeded');
      expect(await outcome('test.size.x4', { width: 50, height: 50 })).toBe('failed:output_invalid (output "image" is 50x50, expected 128x96)');
      expect(await outcome('test.size.x4', { width: 128, height: 96 })).toBe('succeeded');
      // 32x24 at base 4 and 0.75: round(128 × 0.75) × round(96 × 0.75) = 96 × 72
      expect(await outcome('test.size.by-param', { width: 128, height: 96 }, { sigma: 0.75 })).toBe('failed:output_invalid (output "image" is 128x96, expected 96x72)');
      expect(await outcome('test.size.by-param', { width: 96, height: 72 }, { sigma: 0.75 })).toBe('succeeded');
      expect(await outcome('test.size.by-param', { width: 64, height: 48 }, { sigma: 0.5 })).toBe('succeeded');
      // A contract that names no recorded input is refused before a job exists, never skipped at validation.
      expect(await outcome('test.size.unknown-input', { width: 50, height: 50 })).toBe('refused:capability_blocked:["invalid_size_contract"]');
    } finally {
      await caps.stop();
      store.close();
      BUILTIN_CAPABILITIES.splice(BUILTIN_CAPABILITIES.length - testDescriptors.length, testDescriptors.length);
    }
  }, 60_000);
});
