/**
 * Optional provider capabilities (Amendment A1, G0). The Studio job row is the authority:
 *   intent persisted -> submit -> poll -> download -> digest + probe -> succeeded.
 * A provider "finished" is not success until every declared output is stored and validated (FF-08).
 * Results are derived blobs listed on the job; attaching them to a timeline goes through operations
 * and is not implemented yet (needs image/derived-asset support).
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUILTIN_CAPABILITIES, CapabilityError, ComfyUIAdapter, importComfyWorkflow, ImportError, ProviderError, publicationBlockers, resolveGraph,
  type Blocker, type CapabilityDescriptor, type ProviderAdapter,
} from '@pulseframe/providers';
import type { Config } from './config.ts';
import { ffprobe } from './ingest.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

const TYPE = 'capability';
/** These two dimensions can only be earned by running; they do not stop a diagnostic/first run. */
const EARNED_BY_RUNNING = new Set(['not_executed', 'not_hardwareQualified']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Capabilities {
  private adapter: ProviderAdapter | null = null;
  private configError: string | null = null;
  private active = new Map<string, Promise<void>>();
  private stopped = false;

  constructor(private store: Store, private cfg: Config, adapter?: ProviderAdapter) {
    if (adapter) this.adapter = adapter;
    else if (cfg.comfyuiUrl) {
      try { this.adapter = new ComfyUIAdapter(cfg.comfyuiUrl, { allowRemote: cfg.comfyuiAllowRemote }); } catch (e: any) { this.configError = e.message; }
    }
  }

  private descriptor(id: string): CapabilityDescriptor {
    const d = BUILTIN_CAPABILITIES.find((c) => c.id === id);
    if (!d) throw new ApiError(404, 'capability_not_found', `capability ${id} is not in the reviewed registry`, {}, 'Call list_capabilities.');
    return d;
  }
  /** Descriptor with run-earned evidence filled in from recorded successful jobs. */
  private withEvidence(d: CapabilityDescriptor): CapabilityDescriptor {
    const run = this.store.lastSucceeded(TYPE, d.id, d.graphDigest);
    if (!run) return d;
    const p = run.output.recipe.provider;
    const evidence = `job ${run.id}: ${p.device?.name ?? 'unknown device'} (${p.device?.type ?? '?'}), ComfyUI ${p.runtimeVersion}, ${run.updatedAt}`;
    return { ...d, qualification: { ...d.qualification, executed: { status: 'pass', evidence, at: run.updatedAt }, hardwareQualified: { status: 'pass', evidence: `only for this profile — ${evidence}`, at: run.updatedAt } } };
  }
  async providerStatus() {
    if (!this.adapter) return { id: 'comfyui', configured: false, reason: this.configError ?? 'PF_COMFYUI_URL is not set', readiness: null };
    return { id: 'comfyui', configured: true, reason: null, readiness: await this.adapter.probe() };
  }
  async list() {
    return {
      profile: this.cfg.distributionProfile,
      provider: await this.providerStatus(),
      capabilities: BUILTIN_CAPABILITIES.map((raw) => {
        const d = this.withEvidence(raw);
        const blockers = publicationBlockers(d, this.cfg.distributionProfile);
        return {
          id: d.id, version: d.version, state: d.state, title: d.title, description: d.description, graphDigest: d.graphDigest,
          inputs: d.inputs.map(({ binding: _b, reviewed: _r, ...i }) => i), outputs: d.outputs.map((o) => ({ name: o.name, role: o.role, mediaType: o.mediaType, encoding: o.encoding })),
          models: d.models, resources: d.resources, limits: d.limits, limitations: d.limitations, qualification: d.qualification,
          blockers, runnable: !!this.adapter && this.executionBlockers(blockers).length === 0,
        };
      }),
    };
  }
  private executionBlockers = (b: Blocker[]) => b.filter((x) => !EARNED_BY_RUNNING.has(x.code));

  /** Parse-only import (FF-03): returns a draft and why it is not publishable. Nothing is stored, fetched, installed or run. */
  importDraft(graph: unknown, meta: { id: string; title: string }) {
    try {
      const r = importComfyWorkflow(graph, meta);
      const { graph: _g, ...summary } = r.draft;
      return { state: 'draft' as const, persisted: false, nodeCount: Object.keys(r.draft.graph).length, draft: summary, blockers: r.blockers, findings: r.findings };
    } catch (e) {
      if (e instanceof ImportError) throw new ApiError(422, e.code, e.message, {}, e.hint);
      throw e;
    }
  }

  /** The single entry point used by UI, REST and MCP. */
  start(req: { projectId: string; capabilityId: string; params: Record<string, unknown>; actor: string; idempotencyKey?: string }): JobRow {
    const d = this.descriptor(req.capabilityId);
    if (req.idempotencyKey) {
      const prior = this.store.findJobByKey(TYPE, req.actor, req.idempotencyKey);
      if (prior) return prior;
    }
    if (d.state !== 'published') throw new ApiError(409, 'capability_is_draft', 'drafts cannot be executed');
    const blockers = this.executionBlockers(publicationBlockers(d, this.cfg.distributionProfile));
    if (blockers.length) throw new ApiError(409, 'capability_blocked', `capability ${d.id} is not eligible to run in the ${this.cfg.distributionProfile} profile`, { blockers });
    if (!this.adapter) throw new ApiError(503, 'provider_not_configured', `the ComfyUI provider is not configured (${this.configError ?? 'PF_COMFYUI_URL is not set'})`, {}, 'Start ComfyUI and set PF_COMFYUI_URL, e.g. http://127.0.0.1:8188. See docs/INTEGRATIONS.md.');
    let resolved;
    try {
      resolved = resolveGraph(d, req.params);
    } catch (e) {
      if (e instanceof CapabilityError) throw new ApiError(422, e.code, e.message, e.details);
      throw e;
    }
    const { revision } = this.store.getProject(req.projectId);
    // Submission intent, including the id we will give the provider, is durable before anything is dispatched.
    const job = this.store.createJob(req.projectId, TYPE, req.actor, {
      capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, params: resolved.resolved, graph: resolved.graph,
      clientRequestId: randomUUID(), projectRevision: revision, idempotencyKey: req.idempotencyKey ?? null, sources: [],
    });
    void this.run(job.id);
    return job;
  }

  async cancel(jobId: string, actor: string) {
    const job = this.store.getJob(jobId);
    if (job.type !== TYPE) throw new ApiError(409, 'cancel_not_supported', `cancelling ${job.type} jobs is not implemented yet`);
    if (['succeeded', 'failed', 'canceled'].includes(job.status)) return { jobId, status: job.status, outcome: 'already-finished' };
    const providerJobId = job.output?.providerJobId as string | undefined;
    if (!providerJobId || !this.adapter) {
      // Nothing reached the provider that we know of: a purely local cancellation.
      this.store.updateJob(jobId, { status: job.status === 'submission-unknown' ? 'submission-unknown' : 'canceled', stage: null, output: { ...job.output, cancel: { by: actor, outcome: 'local' } } });
      return { jobId, status: this.store.getJob(jobId).status, outcome: 'local' };
    }
    this.store.updateJob(jobId, { status: 'cancel-requested', output: { ...job.output, cancel: { by: actor, outcome: 'requested' } } });
    const outcome = await this.adapter.cancel(providerJobId).catch(() => 'not-supported' as const);
    const j = this.store.getJob(jobId);
    if (j.status === 'cancel-requested') this.store.updateJob(jobId, { output: { ...j.output, cancel: { by: actor, outcome } }, ...(outcome === 'removed-from-queue' ? { status: 'canceled', stage: null } : {}) });
    return { jobId, status: this.store.getJob(jobId).status, outcome };
  }

  /** After a restart: resume what we can prove, never blindly resubmit (FF-08). */
  async recover() {
    for (const job of this.store.openJobs(TYPE)) {
      if (job.output?.providerJobId) { void this.run(job.id); continue; }
      if (job.status === 'queued') { void this.run(job.id); continue; } // never dispatched
      const found = this.adapter ? await this.adapter.findByClientRequestId(job.input.clientRequestId).catch(() => null) : null;
      if (found) { this.store.updateJob(job.id, { output: { ...job.output, providerJobId: found, reconciled: true } }); void this.run(job.id); }
      else this.store.updateJob(job.id, { status: 'submission-unknown', stage: null, error: { code: 'submission_unknown', message: 'the server stopped while submitting; the provider has no record under our request id. Not retried automatically.', retryable: true } });
    }
  }

  /** Stop driving jobs (shutdown). Job rows keep their last durable state and are reconciled by recover() on the next start. */
  async stop() {
    this.stopped = true;
    await Promise.allSettled([...this.active.values()]);
  }
  private run(jobId: string): Promise<void> {
    if (this.active.has(jobId) || !this.adapter || this.stopped) return Promise.resolve();
    const p = this.drive(jobId).finally(() => this.active.delete(jobId));
    this.active.set(jobId, p);
    return p;
  }
  private async drive(jobId: string) {
    if (!this.adapter) return;
    const adapter = this.adapter;
    const t: Record<string, number> = {};
    let mark = Date.now();
    const lap = (k: string) => { t[k] = (t[k] ?? 0) + (Date.now() - mark) / 1000; mark = Date.now(); };
    try {
      let job = this.store.getJob(jobId);
      const d = this.descriptor(job.input.capabilityId);
      let providerJobId = job.output?.providerJobId as string | undefined;
      let readiness = job.output?.readiness;
      if (!providerJobId) {
        this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt: job.attempt + 1 });
        readiness = await adapter.probe(d);
        if (!readiness.reachable) throw new ApiError(503, 'provider_unreachable', `ComfyUI is not reachable: ${readiness.problems.join('; ')}`);
        if (readiness.missingNodeClasses.length || readiness.missingModels.length) throw new ApiError(409, 'dependency_missing', readiness.problems.join('; '), { missingNodeClasses: readiness.missingNodeClasses, missingModels: readiness.missingModels });
        lap('preparing');
        this.store.updateJob(jobId, { stage: 'submitting', output: { readiness } });
        try {
          providerJobId = (await adapter.submit(job.input.graph, job.input.clientRequestId)).providerJobId;
        } catch (e) {
          if (!(e instanceof ProviderError) || !e.ambiguous) throw e;
          // The request may or may not have been accepted. Look for it; otherwise leave it visibly unresolved.
          providerJobId = (await adapter.findByClientRequestId(job.input.clientRequestId).catch(() => null)) ?? undefined;
          if (!providerJobId) {
            this.store.updateJob(jobId, { status: 'submission-unknown', stage: null, error: { code: 'submission_unknown', message: e.message, retryable: true } });
            return;
          }
        }
        this.store.updateJob(jobId, { stage: 'queued', output: { readiness, providerJobId } });
        lap('submit');
      }
      for (;;) {
        if (this.stopped) return;
        job = this.store.getJob(jobId);
        const s = await adapter.status(providerJobId);
        if (s.state === 'succeeded') break;
        if (s.state === 'failed') throw new ApiError(502, 'provider_execution_failed', s.message);
        if (job.status === 'cancel-requested' && s.state === 'unknown') { this.store.updateJob(jobId, { status: 'canceled', stage: null }); return; }
        if (s.state === 'unknown' && Date.now() - mark > 30_000) throw new ApiError(502, 'provider_lost_job', 'the provider no longer lists this job');
        const stage = s.state === 'queued' ? `queued (position ${s.position ?? '?'}, measured)` : s.state === 'running' ? 'inference (progress unknown)' : 'awaiting-provider';
        if (job.stage !== stage && job.status !== 'cancel-requested') this.store.updateJob(jobId, { stage });
        await sleep(200);
      }
      if (this.stopped) return;
      lap('providerQueueAndInference');
      job = this.store.getJob(jobId);
      if (job.status !== 'cancel-requested') this.store.updateJob(jobId, { stage: 'transfer (downloading outputs)' });
      const files = await adapter.collect(d, providerJobId);
      lap('transfer');
      const bundle = [];
      for (const f of files) {
        if (f.bytes.length === 0) throw new ApiError(502, 'output_invalid', `output "${f.name}" is empty`);
        const contentHash = `sha256:${createHash('sha256').update(f.bytes).digest('hex')}`;
        const tmp = path.join(this.store.tmpDir, `cap_${randomUUID()}`);
        fs.writeFileSync(tmp, f.bytes, { mode: 0o600 });
        let probe;
        try { probe = await ffprobe(tmp); } catch { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" (${f.fileName}) is not decodable media`); }
        const v = probe.streams?.find((x: any) => x.codec_type === 'video');
        const a = probe.streams?.find((x: any) => x.codec_type === 'audio');
        if ((f.mediaType === 'audio' && !a) || (f.mediaType !== 'audio' && !v)) { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" does not contain ${f.mediaType}`); }
        // Declared-parameter checks where the capability defines them (the smoke graph declares its exact size).
        const p = job.input.params;
        if (v && typeof p.width === 'number' && typeof p.height === 'number' && (v.width !== p.width || v.height !== p.height)) { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" is ${v.width}x${v.height}, expected ${p.width}x${p.height}`); }
        const mime = f.mediaType === 'image' ? `image/${v.codec_name === 'mjpeg' ? 'jpeg' : v.codec_name}` : f.mediaType === 'video' ? 'video/mp4' : 'audio/wav';
        this.store.putBlob(contentHash, tmp, f.bytes.length, mime);
        bundle.push({ name: f.name, role: f.role, mediaType: f.mediaType, encoding: f.encoding, contentHash, bytes: f.bytes.length, mimeType: mime, codec: (v ?? a).codec_name, width: v?.width ?? null, height: v?.height ?? null, pixFmt: v?.pix_fmt ?? null, hasAlpha: /a/.test(String(v?.pix_fmt ?? '').replace(/^(gray|pal|ya)/, '')) && /rgba|bgra|ya|yuva|gbrap/.test(String(v?.pix_fmt)), durationSeconds: probe.format?.duration ? Number(probe.format.duration) : null });
      }
      lap('validation');
      const final = this.store.getJob(jobId);
      this.store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: {
          ...final.output, providerJobId, bundle,
          recipe: { capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, params: job.input.params, sources: job.input.sources, provider: { id: adapter.id, runtimeVersion: readiness?.runtimeVersion ?? null, device: readiness?.device ?? null } },
          stageSeconds: { ...t, basis: 'measured (wall clock, includes 200 ms polling granularity)' },
          attachment: { status: 'not-attached', reason: 'derived output is stored and validated; timeline attachment requires image/derived-asset operations (Phase 2)' },
          ...(final.status === 'cancel-requested' ? { cancel: { ...final.output?.cancel, outcome: 'completed-before-cancel-took-effect' } } : {}),
        },
      });
    } catch (e: any) {
      if (this.stopped) return; // shutting down: leave the durable state for recover()
      const cur = this.store.getJob(jobId);
      const interrupted = cur.status === 'cancel-requested';
      this.store.updateJob(jobId, interrupted ? { status: 'canceled', stage: null } : { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: e instanceof ProviderError ? e.code : 'capability_failed', message: String(e?.message ?? e) } });
    }
  }
}
