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
import { own } from '@pulseframe/core';
import {
  BUILTIN_CAPABILITIES, CapabilityError, ComfyUIAdapter, expectedOutputSize, importComfyWorkflow, ImportError, ProviderError, publicationBlockers, resolveGraph,
  type Blocker, type CapabilityDescriptor, type ComfyDescriptor, type PixelSize, type ProviderAdapter,
} from '@pulseframe/providers';
import type { CapabilityEstimate, CapabilityService, RunRequest } from './aiContracts.ts';
import type { Config } from './config.ts';
import { describeMedia, ffprobe } from './ingest.ts';
import { ModelStore, type ModelStatus } from './models.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { assertStorageRoom } from './storage.ts';
import type { Principal } from './auth.ts';

const TYPE = 'capability';
/**
 * Dimensions that can only be earned from actual outputs. They never stop a run (otherwise nothing could be
 * evaluated), but while any is open the capability is EXPERIMENTAL: listed as such, and every result is labelled.
 * Structural, dependency, licence and egress blockers always stop execution.
 */
const EARNED_BY_RUNNING = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);
/** Run-earned dimensions that a recorded run does NOT satisfy by itself: they need a human review. */
const NEEDS_REVIEW = new Set(['not_qualityReviewed', 'not_hebrewQualified']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Capabilities implements CapabilityService {
  private adapter: ProviderAdapter | null = null;
  private configError: string | null = null;
  private active = new Map<string, Promise<void>>();
  private stopped = false;
  readonly models: ModelStore;
  /** Set by the server so job results respect Pause Agent. */
  governance: { isPaused(projectId: string): boolean; reserve(p: Principal, jobId: string, cents: number): void } | null = null;

  constructor(private store: Store, private cfg: Config, adapter?: ProviderAdapter) {
    this.models = new ModelStore(cfg.comfyuiModelsDir, cfg.modelHosts);
    if (adapter) this.adapter = adapter;
    else if (cfg.comfyuiUrl) {
      try { this.adapter = new ComfyUIAdapter(cfg.comfyuiUrl, { allowRemote: cfg.comfyuiAllowRemote }); } catch (e: any) { this.configError = e.message; }
    }
  }

  // L0 compile bridge: still only the ComfyUI built-ins. The capability work (W1) looks descriptors up in ALL_CAPABILITIES and
  // dispatches provider 'local' to the LocalToolRunner.
  private descriptor(id: string): ComfyDescriptor {
    const d = BUILTIN_CAPABILITIES.find((c) => c.id === id);
    if (!d) throw new ApiError(404, 'capability_not_found', `capability ${id} is not in the reviewed registry`, {}, 'Call list_capabilities.');
    return d;
  }
  /** Descriptor with run-earned evidence filled in from recorded successful jobs. */
  private withEvidence(d: ComfyDescriptor): ComfyDescriptor {
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
      capabilities: await Promise.all(BUILTIN_CAPABILITIES.map(async (raw) => {
        const d = this.withEvidence(raw);
        const blockers = publicationBlockers(d, this.cfg.distributionProfile);
        const modelStatus = await this.modelStatus(d);
        const modelsReady = modelStatus.every((m) => m.state === 'ready');
        return {
          id: d.id, version: d.version, state: d.state, title: d.title, description: d.description, graphDigest: d.graphDigest,
          inputs: d.inputs.map(({ binding: _b, reviewed: _r, ...i }) => i), outputs: d.outputs.map((o) => ({ name: o.name, role: o.role, mediaType: o.mediaType, encoding: o.encoding })),
          models: d.models.map((m, i) => ({ ...m, status: modelStatus[i] })), modelsReady, missingDownloadBytes: modelStatus.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0), resources: d.resources, limits: d.limits, limitations: d.limitations, qualification: d.qualification,
          blockers, runnable: !!this.adapter && modelsReady && this.executionBlockers(blockers).length === 0,
          experimental: blockers.some((b) => NEEDS_REVIEW.has(b.code)), openReviews: blockers.filter((b) => NEEDS_REVIEW.has(b.code)).map((b) => b.code.slice(4)),
        };
      })),
    };
  }
  modelStatus(d: CapabilityDescriptor): Promise<ModelStatus[]> {
    return Promise.all(d.models.map((m) => this.models.status(m)));
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

  /**
   * Explicit, human-authorised model download (FF-05). `confirmBytes` must equal the exact missing byte count
   * the caller was shown, so an approval cannot silently cover a different (larger) download.
   */
  async startDownload(projectId: string, capabilityId: string, confirmBytes: number, actor: string): Promise<JobRow> {
    const d = this.descriptor(capabilityId);
    const status = await this.modelStatus(d);
    const missing = status.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0);
    if (missing === 0) throw new ApiError(409, 'models_already_ready', 'all model files for this capability are present and verified');
    const lic = publicationBlockers(d, this.cfg.distributionProfile).filter((b) => /model|license|unresolved/i.test(b.code));
    if (lic.length) throw new ApiError(409, 'capability_blocked', 'model files for this capability may not be downloaded in this profile', { blockers: lic });
    if (confirmBytes !== missing) throw new ApiError(409, 'download_size_mismatch', `this download is ${missing} bytes; confirmBytes was ${confirmBytes}`, { missingDownloadBytes: missing }, 'Re-read the capability and confirm the exact size shown.');
    const job = this.store.createJob(projectId, 'model-download', actor, { capabilityId: d.id, capabilityVersion: d.version, approvedBytes: missing, models: d.models.map((m) => ({ path: m.path, sha256: m.sha256, bytes: m.bytes, source: m.source })) });
    void this.driveDownload(job.id, d);
    return job;
  }
  private async driveDownload(jobId: string, d: CapabilityDescriptor) {
    const started = Date.now();
    try {
      this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt: 1 });
      const done: ModelStatus[] = [];
      for (const m of d.models) {
        let last = 0;
        done.push(await this.models.download(m, (got, total) => {
          if (got - last < 8 << 20 && got !== total) return;
          last = got;
          this.store.updateJob(jobId, { stage: `downloading ${m.path}: ${got}/${total} bytes (measured)` });
        }));
        this.store.updateJob(jobId, { stage: `verified ${m.path}` });
      }
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { models: done, wallSeconds: (Date.now() - started) / 1000 } });
    } catch (e: any) {
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'model_download_failed', message: String(e?.message ?? e), retryable: true } });
    }
  }

  /**
   * Run estimate (ADR-0017): frames, scratch, missing downloads and a measured-or-none time. L0 contract stub: answers 501 until the
   * frame-job work (W1) implements it; it never guesses a figure.
   */
  async estimate(req: RunRequest): Promise<CapabilityEstimate> {
    this.descriptor(req.capabilityId);
    throw new ApiError(501, 'not_implemented', 'run estimates are not implemented yet');
  }

  /** The single entry point used by UI, REST and MCP. */
  start(req: RunRequest): JobRow {
    const d = this.descriptor(req.capabilityId);
    // L0 contract bridge: a source range or an apply mode other than the library needs the frame-job work (W1); refused, never ignored.
    if (req.source || (req.apply && req.apply !== 'library')) throw new ApiError(501, 'not_implemented', 'running a tool on a clip or source range, or placing its result in the clip, is not implemented yet');
    if (req.idempotencyKey) {
      const prior = this.store.findJobByKey(TYPE, req.actor, req.idempotencyKey);
      if (prior) return prior;
    }
    // A run stores its results in the library: past the storage ceiling it is refused before a job exists, as exports, sounds and narration are.
    assertStorageRoom(this.store, 1, 'run this tool');
    if (d.state !== 'published') throw new ApiError(409, 'capability_is_draft', 'drafts cannot be executed');
    const blockers = this.executionBlockers(publicationBlockers(d, this.cfg.distributionProfile));
    if (blockers.length) throw new ApiError(409, 'capability_blocked', `capability ${d.id} is not eligible to run in the ${this.cfg.distributionProfile} profile`, { blockers });
    const notReady = this.cfg.comfyuiModelsDir || d.models.length === 0 ? [] : d.models.map((m) => m.path);
    if (notReady.length) throw new ApiError(409, 'model_not_ready', 'model files cannot be verified because PF_COMFYUI_MODELS_DIR is not set', { models: notReady });
    if (!this.adapter) throw new ApiError(503, 'provider_not_configured', `the ComfyUI provider is not configured (${this.configError ?? 'PF_COMFYUI_URL is not set'})`, {}, 'Start ComfyUI and set PF_COMFYUI_URL, e.g. http://127.0.0.1:8188. See docs/INTEGRATIONS.md.');
    let resolved;
    try {
      resolved = resolveGraph(d, req.params);
    } catch (e) {
      if (e instanceof CapabilityError) throw new ApiError(422, e.code, e.message, e.details);
      throw e;
    }
    const { doc, revision } = this.store.getProject(req.projectId);
    // Media inputs are project assets. Bind a content-addressed name now; the bytes are staged when the job runs.
    const sources = resolved.media.map((m) => {
      if (m.nodeId === null || m.input === null) throw new ApiError(422, 'dangling_binding', `parameter "${m.name}" is not bound to a field of the graph`, { parameter: m.name });
      const a = own(doc.assets, m.assetId);
      if (!a) throw new ApiError(404, 'asset_not_found', `asset ${m.assetId} is not in this project`, { parameter: m.name });
      if (a.kind !== m.type || !a.image) throw new ApiError(422, 'incompatible', `parameter "${m.name}" needs an ${m.type} asset; ${m.assetId} is ${a.kind}`, { parameter: m.name });
      if (d.limits.maxPixels && a.image.width * a.image.height > d.limits.maxPixels) throw new ApiError(422, 'input_too_large', `source is ${a.image.width}x${a.image.height}; this capability is qualified up to ${d.limits.maxPixels} pixels`, { parameter: m.name });
      const stagedName = `pf_${a.contentHash.slice(7, 39)}.${a.container === 'jpeg' ? 'jpg' : a.container}`;
      resolved.graph[m.nodeId]!.inputs[m.input] = stagedName;
      return { input: m.name, assetId: a.id, contentHash: a.contentHash, mimeType: a.mimeType, width: a.image.width, height: a.image.height, bytes: a.byteSize, stagedName };
    });
    // Submission intent, including the id we will give the provider, is durable before anything is dispatched.
    const job = this.store.createJob(req.projectId, TYPE, req.actor, {
      capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, params: resolved.resolved, graph: resolved.graph,
      clientRequestId: randomUUID(), projectRevision: revision, idempotencyKey: req.idempotencyKey ?? null, sources,
      attach: req.attach ?? null,
      // Stale-result protection (SPEC §20, FFG-09): remember the version of everything the placement depends on.
      preconditions: [...new Set([...(req.dependsOn ?? []), ...(req.attach?.trackId ? [req.attach.trackId] : [])])].map((entityId) => ({ entityId, version: this.store.entityVersion(req.projectId, entityId)?.revision ?? 0 })),
    });
    // Paid capabilities: reserve the declared cost against the caller's budget BEFORE anything is dispatched.
    // No budget, wrong mode or not enough left -> the job is closed as refused and nothing is submitted.
    if (d.cost.cents > 0) {
      try {
        if (!req.principal || !this.governance) throw new ApiError(403, 'insufficient_scope', 'paid work needs an identified caller with a budget');
        this.governance.reserve(req.principal, job.id, d.cost.cents);
      } catch (e) {
        this.store.updateJob(job.id, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'budget_error', message: String(e) } });
        throw e;
      }
    }
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
  /**
   * Bring the validated primary output into the project through normal operations.
   * 1. Always: import it as a derived asset (provenance + recipe), so the result is never lost.
   * 2. If a placement was requested: re-check every recorded precondition against current entity
   *    versions. Unchanged -> add the clip. Changed, deleted or no longer fitting -> leave the asset
   *    in the library as a proposal and say why. A late result never overwrites newer edits.
   */
  private async attach(job: JobRow, bundle: any[], recipe: any) {
    const primary = bundle.find((o) => o.role === 'primary' && o.mediaType !== 'audio') ?? bundle.find((o) => o.role === 'primary');
    if (!primary) return { status: 'not-attached', reason: 'capability declares no primary output' };
    const meta = await describeMedia(this.store.blobPath(primary.contentHash));
    const asset = {
      ...meta, name: `${job.input.capabilityId} · ${job.id}`.slice(0, 256), contentHash: primary.contentHash, byteSize: primary.bytes,
      provenance: { origin: 'derived' as const, importedAt: new Date().toISOString(), importedBy: job.actor, derived: { jobId: job.id, capabilityId: recipe.capabilityId, capabilityVersion: recipe.capabilityVersion, graphDigest: recipe.graphDigest, params: recipe.params, sourceAssetIds: (job.input.sources as any[]).map((x) => x.assetId), outputName: primary.name, outputRole: primary.role, encoding: primary.encoding, provider: recipe.provider } },
    };
    const imp = this.store.commit({ projectId: job.projectId, actor: job.actor, allowInternal: true, label: `Result of ${job.input.capabilityId}`, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = imp.results[0]!.output!.assetId as string;
    const base = { assetId, deduplicated: !!imp.results[0]!.output!.deduplicated };
    const want = job.input.attach;
    if (!want) return { status: 'imported', ...base, reason: 'no placement requested; the asset is in the library' };
    const conflicts = (job.input.preconditions as { entityId: string; version: number }[]).flatMap((p) => {
      const v = this.store.entityVersion(job.projectId, p.entityId);
      return (v?.revision ?? 0) !== p.version ? [{ entityId: p.entityId, expectedVersion: p.version, currentVersion: v?.revision ?? 0, deleted: v?.deleted ?? false, by: v?.actor ?? null }] : [];
    });
    if (conflicts.length) return { status: 'proposed', ...base, reason: 'items this placement depended on changed while the job ran; nothing was placed', conflicts, proposal: want };
    // Pause Agent: a job that was already running finishes, but an agent's result is not placed while agents are paused.
    if (job.actor.startsWith('agent:') && this.governance?.isPaused(job.projectId)) return { status: 'proposed', ...base, reason: 'agents are paused on this project; the result is kept in the library and was not placed', proposal: want };
    try {
      const r = this.store.commit({ projectId: job.projectId, actor: job.actor, label: `Place result of ${job.input.capabilityId}`, ops: [{ op: 'add_clip', args: { assetId, start: want.start, ...(want.duration ? { duration: want.duration } : {}), ...(want.trackId ? { trackId: want.trackId } : {}) } }] });
      return { status: 'attached', ...base, clipId: r.results[0]!.output!.clipId, trackId: r.results[0]!.output!.trackId, revision: r.revision, transactionId: r.transactionId };
    } catch (e) {
      if (e instanceof ApiError) return { status: 'proposed', ...base, reason: `placement no longer valid: ${e.message}`, error: e.code, proposal: want };
      throw e;
    }
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
        const ms = await this.modelStatus(d);
        const bad = ms.filter((m) => m.state !== 'ready');
        if (bad.length) throw new ApiError(409, 'model_not_ready', `model files are not ready: ${bad.map((m) => `${m.path} (${m.state})`).join(', ')}`, { models: bad }, 'Download and verify the models for this capability first.');
        lap('preparing');
        // Stage only the selected sources, streamed from the blob store (FF-08: bounded transfer, no whole-project upload).
        for (const src of job.input.sources as any[]) {
          this.store.updateJob(jobId, { stage: `transfer (staging input "${src.input}", ${src.bytes} bytes)` });
          const ref = await adapter.stage(this.store.blobPath(src.contentHash), src.stagedName, src.mimeType);
          if (ref !== src.stagedName) throw new ApiError(502, 'stage_failed', `provider stored the source as "${ref}", expected "${src.stagedName}"`);
        }
        lap('staging');
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
      const destDir = path.join(this.store.tmpDir, `cap_${randomUUID()}`);
      const files = await adapter.collect(d, providerJobId, destDir).catch((e) => { fs.rmSync(destDir, { recursive: true, force: true }); throw e; });
      lap('transfer');
      const bundle = [];
      try {
      for (const f of files) {
        // L0 compile bridge: size and digest are read from the stored file rather than taken from the adapter (W1 decides the streamed path).
        const tmp = f.path;
        const size = fs.statSync(tmp).size;
        if (size === 0) throw new ApiError(502, 'output_invalid', `output "${f.name}" is empty`);
        const contentHash = `sha256:${createHash('sha256').update(fs.readFileSync(tmp)).digest('hex')}`;
        let probe;
        try { probe = await ffprobe(tmp); } catch { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" (${f.fileName}) is not decodable media`); }
        const v = probe.streams?.find((x: any) => x.codec_type === 'video');
        const a = probe.streams?.find((x: any) => x.codec_type === 'audio');
        if ((f.mediaType === 'audio' && !a) || (f.mediaType !== 'audio' && !v)) { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" does not contain ${f.mediaType}`); }
        // Declared size contract from the reviewed descriptor, every variant; one that cannot be computed fails the job (never skipped).
        const exp = d.outputs.find((o) => o.name === f.name)?.expectSize ?? null;
        if (exp) {
          let want: PixelSize;
          try {
            want = expectedOutputSize(exp, job.input.params, (input) => {
              const s = (job.input.sources as { input: string; width: number; height: number }[]).find((x) => x.input === input);
              return s ? { width: s.width, height: s.height } : null;
            });
          } catch (e) {
            fs.rmSync(tmp, { force: true });
            if (e instanceof CapabilityError) throw new ApiError(502, 'output_invalid', `output "${f.name}": ${e.message}`, { sizeContract: e.code });
            throw e;
          }
          if (!v || v.width !== want.width || v.height !== want.height) { fs.rmSync(tmp, { force: true }); throw new ApiError(502, 'output_invalid', `output "${f.name}" is ${v ? `${v.width}x${v.height}` : 'not a picture'}, expected ${want.width}x${want.height}`); }
        }
        const mime = f.mediaType === 'image' ? `image/${v.codec_name === 'mjpeg' ? 'jpeg' : v.codec_name}` : f.mediaType === 'video' ? 'video/mp4' : 'audio/wav';
        // the result is stored only if it fits under the ceiling; otherwise the job fails with that reason and nothing is kept
        if (!fs.existsSync(this.store.blobPath(contentHash))) { try { assertStorageRoom(this.store, size, 'store this result'); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; } }
        this.store.putBlob(contentHash, tmp, size, mime);
        bundle.push({ name: f.name, role: f.role, mediaType: f.mediaType, encoding: f.encoding, contentHash, bytes: size, mimeType: mime, codec: (v ?? a).codec_name, width: v?.width ?? null, height: v?.height ?? null, pixFmt: v?.pix_fmt ?? null, hasAlpha: /a/.test(String(v?.pix_fmt ?? '').replace(/^(gray|pal|ya)/, '')) && /rgba|bgra|ya|yuva|gbrap/.test(String(v?.pix_fmt)), durationSeconds: probe.format?.duration ? Number(probe.format.duration) : null });
      }
      } finally { fs.rmSync(destDir, { recursive: true, force: true }); }
      lap('validation');
      const openReviews = publicationBlockers(d, this.cfg.distributionProfile).filter((b) => NEEDS_REVIEW.has(b.code)).map((b) => b.code.slice(4));
      const recipe = { experimental: openReviews.length > 0, openReviews, capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, params: job.input.params, sources: job.input.sources, provider: { id: adapter.id, runtimeVersion: readiness?.runtimeVersion ?? null, device: readiness?.device ?? null } };
      const attachment = await this.attach(job, bundle, recipe);
      lap('attachment');
      const final = this.store.getJob(jobId);
      this.store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: {
          ...final.output, providerJobId, bundle, recipe,
          stageSeconds: { ...t, basis: 'measured (wall clock, includes 200 ms polling granularity)' },
          attachment,
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
