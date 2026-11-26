/**
 * Optional provider capabilities (Amendment A1; ADR-0017). The Studio job row is the authority:
 *   intent persisted -> submit -> poll -> download -> digest + probe -> succeeded.
 * A provider "finished" is not success until every declared output is stored and validated (FF-08).
 *
 * One registry (ALL_CAPABILITIES: the reviewed ComfyUI built-ins, then the reviewed local tools), one job type ('capability'),
 * dispatched by provider: ComfyUI stills run here, ComfyUI frame jobs run in framejobs.ts, local tools run in the injected
 * LocalToolRunner. Results enter the project only through operations: import_asset (internal), then, as asked and only while
 * everything the placement depends on is unchanged, replace_clip_asset (+ set_clip_speed(1/m) for slow motion, one transaction)
 * or add_clip. Otherwise the result stays in the library as a proposal with its reason.
 */
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { findClip, ownSceneCuts, sourceEnd, speedOf, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import {
  BUILTIN_CAPABILITIES, CapabilityError, ComfyUIAdapter, expectedOutputSize, importComfyWorkflow, ImportError, LOCAL_TOOLS, logicDigest, ProviderError, publicationBlockers, resolveGraph, resolveParams,
  type Blocker, type CapabilityDescriptor, type ComfyDescriptor, type LocalToolDescriptor, type PixelSize, type ProviderAdapter, type Readiness,
} from '@pulseframe/providers';
import type { ApplyMode, CapabilityEstimate, CapabilityService, ComputeLane, LocalToolRunner, RunRequest, RunSource, SetupState } from './aiContracts.ts';
import type { Config } from './config.ts';
import { FrameJobDriver } from './framejobs.ts';
import { admitFramePlan, buildFramePlan, frameOutputSize, outFactor, ramChunkFrames, resolveFrameSource, scratchBytes, type FrameSource } from './framePlan.ts';
import { describeMedia, ffprobe, NeedsConform, type MediaMeta } from './ingest.ts';
import { ModelStore, type ModelStatus } from './models.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { assertStorageRoom } from './storage.ts';
import type { Principal } from './auth.ts';
import { actsAsOwner } from './autonomy.ts';

const TYPE = 'capability';
/**
 * Dimensions that can only be earned from actual outputs. They never stop a run (otherwise nothing could be
 * evaluated), but while any is open the capability is EXPERIMENTAL: listed as such, and every result is labelled.
 * Structural, dependency, licence and egress blockers always stop execution.
 */
const EARNED_BY_RUNNING = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);
/** Run-earned dimensions that a recorded run does NOT satisfy by itself: they need a human review. */
const NEEDS_REVIEW = new Set(['not_qualityReviewed', 'not_hebrewQualified']);
/** Blockers that make a model file ineligible to download or run in this profile (setup state licence_blocked). */
const LICENCE_CODES = new Set(['model_not_commercially_eligible', 'model_license_unknown', 'unresolved_model']);
/** Free space kept on the models volume beyond a download (ADR-0017). */
const DOWNLOAD_MARGIN_BYTES = 2 * 1024 ** 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The agent caps apply (I5, I6, B11, B12) unless the caller acts as the owner: the owner, or an agent stamped open, as recorded at admission (C2: not keyed on the actor prefix alone). */
const actsOpen = (req: { open?: boolean; principal?: Principal }) => req.open === true || (!!req.principal && actsAsOwner(req.principal));
const isAgent = (req: { actor: string; open?: boolean; principal?: Principal }) => !actsOpen(req) && (req.actor.startsWith('agent:') || req.principal?.kind === 'agent');

/** Where a validated result goes, fixed when the job is created (job.input.placement). */
export interface Placement {
  mode: ApplyMode;
  /** replace-clip: the clip that gets the result; new-track: the clip it was made from (or null for a library asset). */
  clipId: string | null;
  /** new-track: where the new clip starts, from which source time of the result, and for how long. */
  start?: T.RationalTime; sourceIn?: T.RationalTime; duration?: T.RationalTime;
  /** replace-clip with slow motion: the clip's new speed (its speed divided by m), applied in the same transaction. */
  speed?: number;
}
export interface CapabilityDeps {
  lane?: ComputeLane | null;
  localTools?: LocalToolRunner | null;
  /** Registry override (the proofs inject labelled test-only descriptors). Default: the built-ins then the local tools, read at call time. */
  registry?: () => CapabilityDescriptor[];
  /** Free bytes on the volume that holds `dir` (default fs.statfsSync of its nearest existing folder); tests inject low values. */
  freeBytes?: (dir: string) => number | null;
  /** ComfyUI's input folder when it runs on this machine (staged chunks are deleted there). Default: <PF_COMFYUI_MODELS_DIR>/../input when it exists. */
  providerInputDir?: string | null;
  /** Provider poll interval in ms (default 200). */
  pollMs?: number;
}
type Output = { name: string; role: string; mediaType: string; encoding: string; contentHash: string; bytes: number; mimeType: string; [k: string]: unknown };
/**
 * The scene cuts a pairwise frame job (frame interpolation) must not blend across, as decoded-frame indices of the source asset:
 * the asset's own scene cuts, or those of the nearest time-preserving source it is a copy of, on its own clock (core lineage
 * ownSceneCuts: an enhanced copy has its source's shots, so it is not interpolated across them either). A copy made without a
 * recorded time mapping has none, like a file that was never analysed.
 */
export const sceneCutFrames = (doc: ProjectDocument, src: Pick<FrameSource, 'assetId' | 'rate' | 'startFrames'>): number[] =>
  (ownSceneCuts(doc, src.assetId)?.cuts ?? []).map((t) => T.frameIndexAt(t, src.rate) - src.startFrames);
export class Capabilities implements CapabilityService {
  private adapter: ProviderAdapter | null = null;
  private configError: string | null = null;
  private active = new Map<string, Promise<void>>();
  private laneWaits = new Map<string, AbortController>();
  private stopped = false;
  private frames: FrameJobDriver;
  readonly models: ModelStore;
  /** Set by the server so job results respect Pause Agent. */
  governance: { isPaused(projectId: string): boolean; reserve(p: Principal, jobId: string, cents: number): void } | null = null;
  /** The compute lane (ADR-0017); set by the server. Without one, nothing is serialised (tests). */
  lane: ComputeLane | null;
  /** Runs provider 'local' descriptors (W2, localtools.ts); set by the server. Without one, local tools report engine_not_configured. */
  localTools: LocalToolRunner | null;

  constructor(private store: Store, private cfg: Config, adapter?: ProviderAdapter, private deps: CapabilityDeps = {}) {
    this.models = new ModelStore(cfg.comfyuiModelsDir, cfg.modelHosts);
    this.lane = deps.lane ?? null;
    this.localTools = deps.localTools ?? null;
    if (adapter) this.adapter = adapter;
    else if (cfg.comfyuiUrl) {
      try { this.adapter = new ComfyUIAdapter(cfg.comfyuiUrl, { allowRemote: cfg.comfyuiAllowRemote }); } catch (e: any) { this.configError = e.message; }
    }
    this.frames = new FrameJobDriver({
      store, adapter: () => this.adapter, lane: () => this.lane, descriptor: (id) => this.comfy(id), modelStatus: (d) => this.modelStatus(d),
      providerInputDir: () => this.providerInputDir(), stopped: () => this.stopped, pollMs: deps.pollMs,
      openReviews: (d) => this.openReviews(d),
      attach: (job, bundle, recipe, extra) => this.attach(job, bundle, recipe, [extra.meta], extra.derived),
    });
  }

  // ---------------------------------------------------------------- registry
  /** The same entries as ALL_CAPABILITIES (built-ins, then local tools), read at call time so a test-only addition is seen. */
  private registry(): CapabilityDescriptor[] {
    return this.deps.registry?.() ?? [...BUILTIN_CAPABILITIES, ...LOCAL_TOOLS];
  }
  private descriptor(id: string): CapabilityDescriptor {
    const d = this.registry().find((c) => c.id === id);
    if (!d) throw new ApiError(404, 'capability_not_found', `capability ${id} is not in the reviewed registry`, {}, 'Call list_capabilities.');
    return d;
  }
  private comfy(id: string): ComfyDescriptor {
    const d = this.descriptor(id);
    if (d.provider !== 'comfyui') throw new ApiError(500, 'capability_failed', `${id} is not a ComfyUI capability`);
    return d;
  }
  /** Descriptor with run-earned evidence filled in from recorded successful jobs (matched by the reviewed-logic digest). */
  private withEvidence<D extends CapabilityDescriptor>(d: D): D {
    const run = this.store.lastSucceeded(TYPE, d.id, logicDigest(d));
    if (!run) return d;
    const p = run.output?.recipe?.provider ?? {};
    const evidence = `job ${run.id}: ${p.device?.name ?? 'unknown device'} (${p.device?.type ?? '?'}), ${p.id === 'comfyui' || p.runtimeVersion ? `ComfyUI ${p.runtimeVersion}` : `engine ${p.id ?? 'local'}`}, ${run.updatedAt}`;
    return { ...d, qualification: { ...d.qualification, executed: { status: 'pass', evidence, at: run.updatedAt }, hardwareQualified: { status: 'pass', evidence: `only for this profile — ${evidence}`, at: run.updatedAt } } };
  }
  private openReviews(d: CapabilityDescriptor) {
    return publicationBlockers(d, this.cfg.distributionProfile).filter((b) => NEEDS_REVIEW.has(b.code)).map((b) => b.code.slice(4));
  }
  private executionBlockers = (b: Blocker[]) => b.filter((x) => !EARNED_BY_RUNNING.has(x.code));

  // ---------------------------------------------------------------- setup and listing
  async providerStatus() {
    if (!this.adapter) return { id: 'comfyui', configured: false, reason: this.configError ?? 'PF_COMFYUI_URL is not set', readiness: null };
    return { id: 'comfyui', configured: true, reason: null, readiness: await this.adapter.probe() };
  }
  /** The model store of the descriptor's provider: ComfyUI's models folder, or the local tools' (PF_TOOLS_MODELS_DIR). */
  private modelStoreFor(d: CapabilityDescriptor): ModelStore | null {
    return d.provider === 'comfyui' ? this.models : (this.localTools?.models() ?? null);
  }
  async modelStatus(d: CapabilityDescriptor): Promise<ModelStatus[]> {
    const store = this.modelStoreFor(d);
    if (!store) return d.models.map((m) => ({ path: m.path, state: 'unverifiable' as const, expectedBytes: m.bytes, presentBytes: 0, missingBytes: m.bytes ?? 0, detail: 'local tools are not available in this server, so the file cannot be verified' }));
    return Promise.all(d.models.map((m) => store.status(m)));
  }
  /** Free bytes of the volume that holds `dir` (its nearest existing folder), or null when it cannot be read. */
  private freeBytes(dir: string | null): number | null {
    if (!dir) return null;
    if (this.deps.freeBytes) return this.deps.freeBytes(dir);
    let p = path.resolve(dir);
    while (!fs.existsSync(p) && path.dirname(p) !== p) p = path.dirname(p);
    try { const s = fs.statfsSync(p); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
  }
  private modelsDir(d: CapabilityDescriptor): string | null {
    return d.provider === 'comfyui' ? this.cfg.comfyuiModelsDir : this.cfg.toolsModelsDir;
  }
  private providerInputDir(): string | null {
    if (this.deps.providerInputDir !== undefined) return this.deps.providerInputDir;
    if (!this.cfg.comfyuiModelsDir) return null;
    const dir = path.join(path.dirname(this.cfg.comfyuiModelsDir), 'input');
    return fs.existsSync(dir) ? dir : null;
  }
  /** Download hosts of these models that PF_MODEL_HOSTS does not allow (a leading dot allows subdomains, as in ModelStore). */
  private blockedHosts(models: { source: string | null }[]): string[] {
    const out = new Set<string>();
    for (const m of models) {
      if (!m.source) continue;
      let host: string;
      try { host = new URL(m.source).hostname; } catch { continue; }
      if (!this.cfg.modelHosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))) out.add(host);
    }
    return [...out];
  }
  /**
   * The setup state of one capability, in the order a person fixes it: the provider or engine, the licence, the model files (with the
   * hosts and the free space a download needs), then ready. `readiness` is the provider probe (ComfyUI), when it was made.
   */
  private async setupFor(d: CapabilityDescriptor, readiness: Readiness | null, status: ModelStatus[]): Promise<SetupState> {
    let device: string | null = null, versions: Record<string, string> | undefined;
    if (d.provider === 'comfyui') {
      if (!this.adapter) return { code: 'provider_not_configured', detail: this.configError ?? 'PF_COMFYUI_URL is not set' };
      if (!readiness?.reachable) return { code: 'provider_unreachable', detail: readiness ? readiness.problems.join('; ') : 'ComfyUI was not probed' };
      if (readiness.missingNodeClasses.length) return { code: 'engine_not_working', detail: `ComfyUI lacks node classes this capability needs: ${readiness.missingNodeClasses.join(', ')}` };
      device = readiness.device?.name ?? null;
      versions = readiness.runtimeVersion ? { comfyui: readiness.runtimeVersion } : undefined;
    } else {
      if (!this.localTools) return { code: 'engine_not_configured', detail: 'local tools are not available in this server' };
      const s = await this.localTools.setup(d);
      if (s.code !== 'ready' && s.code !== 'model_missing') return s;
      device = s.device ?? null;
      versions = s.versions;
    }
    const lic = publicationBlockers(d, this.cfg.distributionProfile).filter((b) => LICENCE_CODES.has(b.code));
    if (lic.length) return { code: 'licence_blocked', detail: lic.map((b) => b.message).join('; ') };
    const missing = d.models.filter((_m, i) => status[i]?.state !== 'ready');
    if (missing.length) {
      const missingBytes = status.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0);
      if (status.some((m) => m.state === 'unverifiable')) return { code: 'model_missing', detail: status.find((m) => m.state === 'unverifiable')!.detail, missingBytes };
      const hosts = this.blockedHosts(missing);
      if (hosts.length) return { code: 'host_not_allowed', detail: `the model files are published on ${hosts.join(', ')}, which PF_MODEL_HOSTS does not allow`, hosts, missingBytes };
      const free = this.freeBytes(this.modelsDir(d));
      if (free !== null && free < missingBytes + DOWNLOAD_MARGIN_BYTES) return { code: 'disk_insufficient', detail: `the download is ${missingBytes} bytes and needs ${DOWNLOAD_MARGIN_BYTES} more to spare; ${free} are free`, freeBytes: free, missingBytes };
      return { code: 'model_missing', detail: `${missing.length} model file(s) to download: ${missing.map((m) => m.path).join(', ')}`, missingBytes };
    }
    return { code: 'ready', detail: 'ready', device, ...(versions ? { versions } : {}) };
  }
  async list() {
    const provider = await this.providerStatus();
    return {
      profile: this.cfg.distributionProfile,
      provider,
      capabilities: await Promise.all(this.registry().map(async (raw) => {
        const d = this.withEvidence(raw);
        const blockers = publicationBlockers(d, this.cfg.distributionProfile);
        const modelStatus = await this.modelStatus(d);
        const modelsReady = modelStatus.every((m) => m.state === 'ready');
        const setup = await this.setupFor(d, provider.readiness, modelStatus);
        const engineAvailable = d.provider === 'comfyui' ? !!this.adapter : !!this.localTools;
        return {
          id: d.id, version: d.version, provider: d.provider, state: d.state, title: d.title, description: d.description, graphDigest: logicDigest(d), logicDigest: logicDigest(d),
          inputs: d.inputs.map(({ binding: _b, reviewed: _r, ...i }) => i), outputs: d.outputs.map((o) => ({ name: o.name, role: o.role, mediaType: o.mediaType, encoding: o.encoding, expectFrames: o.expectFrames })),
          frames: d.provider === 'comfyui' ? d.frames : null, task: d.provider === 'local' ? d.task : null,
          models: d.models.map((m, i) => ({ ...m, status: modelStatus[i] })), modelsReady, missingDownloadBytes: modelStatus.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0), resources: d.resources, limits: d.limits, limitations: d.limitations, qualification: d.qualification,
          blockers, setup, runnable: engineAvailable && modelsReady && this.executionBlockers(blockers).length === 0,
          experimental: blockers.some((b) => NEEDS_REVIEW.has(b.code)), openReviews: blockers.filter((b) => NEEDS_REVIEW.has(b.code)).map((b) => b.code.slice(4)),
        };
      })),
    };
  }

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

  // ---------------------------------------------------------------- model downloads
  /**
   * Explicit, human-authorised model download (FF-05). Only the owner's session starts one (an agent can only ask, through an
   * approval). `confirmBytes` must equal the exact missing byte count the caller was shown, so an approval cannot silently cover a
   * different (larger) download. Refused before any byte moves when a source host is not in PF_MODEL_HOSTS (host_not_allowed) or the
   * models volume lacks the download plus a 2 GiB margin (disk_insufficient). Each provider has its own model store.
   */
  async startDownload(projectId: string, capabilityId: string, confirmBytes: number, by: string | Principal): Promise<JobRow> {
    const actor = typeof by === 'string' ? by : by.actor;
    if (!actor.startsWith('user:') && !(typeof by !== 'string' && actsAsOwner(by))) throw new ApiError(403, 'human_approval_required', 'model downloads must be started from the owner\'s own session, not by an agent credential', {}, 'Ask for the download (request_model_download); the owner approves it.');
    const d = this.descriptor(capabilityId);
    const store = this.modelStoreFor(d);
    if (!store) throw new ApiError(503, 'engine_not_configured', 'local tools are not available in this server, so their model files cannot be downloaded');
    const status = await this.modelStatus(d);
    const missing = status.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0);
    if (missing === 0) throw new ApiError(409, 'models_already_ready', 'all model files for this capability are present and verified');
    const lic = publicationBlockers(d, this.cfg.distributionProfile).filter((b) => /model|license|unresolved/i.test(b.code));
    if (lic.length) throw new ApiError(409, 'capability_blocked', 'model files for this capability may not be downloaded in this profile', { blockers: lic });
    if (confirmBytes !== missing) throw new ApiError(409, 'download_size_mismatch', `this download is ${missing} bytes; confirmBytes was ${confirmBytes}`, { missingDownloadBytes: missing }, 'Re-read the capability and confirm the exact size shown.');
    const todo = d.models.filter((_m, i) => status[i]!.state !== 'ready');
    const hosts = this.blockedHosts(todo);
    if (hosts.length) throw new ApiError(409, 'host_not_allowed', `the model files are published on ${hosts.join(', ')}, which PF_MODEL_HOSTS does not allow`, { hosts, allowed: this.cfg.modelHosts }, 'Add exactly these hosts to PF_MODEL_HOSTS, or place the files by hand.');
    const free = this.freeBytes(this.modelsDir(d));
    if (free !== null && free < missing + DOWNLOAD_MARGIN_BYTES) throw new ApiError(409, 'disk_insufficient', `the download is ${missing} bytes and ${DOWNLOAD_MARGIN_BYTES} must stay free; ${free} are free`, { missingBytes: missing, marginBytes: DOWNLOAD_MARGIN_BYTES, freeBytes: free }, 'Free some disk space and try again.');
    const job = this.store.createJob(projectId, 'model-download', actor, { capabilityId: d.id, capabilityVersion: d.version, provider: d.provider, approvedBytes: missing, models: d.models.map((m) => ({ path: m.path, sha256: m.sha256, bytes: m.bytes, source: m.source })) });
    void this.driveDownload(job.id, d, store);
    return job;
  }
  private async driveDownload(jobId: string, d: CapabilityDescriptor, store: ModelStore) {
    const started = Date.now();
    try {
      this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt: 1 });
      const done: ModelStatus[] = [];
      for (const m of d.models) {
        let last = 0;
        done.push(await store.download(m, (got, total) => {
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

  // ---------------------------------------------------------------- estimates
  /** What a frame job would read and cost here, from the plan and a measurement of this machine (or none). */
  private measured(d: CapabilityDescriptor, outputFrames: number, pixels: number): { measured: boolean; seconds: number | null } {
    const run = this.store.lastSucceeded(TYPE, d.id, logicDigest(d));
    const m = run?.output?.measurement;
    if (m && m.outputFrames > 0 && m.pixels > 0 && m.chunkSeconds > 0) return { measured: true, seconds: Math.round((m.chunkSeconds * outputFrames * pixels) / (m.outputFrames * m.pixels)) };
    return { measured: d.resources.measuredProfiles.length > 0, seconds: null };
  }
  /**
   * Run estimate (ADR-0017): setup state, frames, chunks, scratch, missing downloads and a time measured on this machine (scaled
   * linearly by output frames × source pixels from the last recorded run) or null with basis 'none'. Never guesses a figure.
   * Refusals the run would meet are listed as blockers instead of thrown.
   */
  async estimate(req: RunRequest): Promise<CapabilityEstimate> {
    const d = this.descriptor(req.capabilityId);
    const { doc } = this.store.getProject(req.projectId);
    const blockers: { code: string; message: string }[] = this.executionBlockers(publicationBlockers(d, this.cfg.distributionProfile)).map(({ code, message }) => ({ code, message }));
    const status = await this.modelStatus(d);
    const readiness = d.provider === 'comfyui' && this.adapter ? await this.adapter.probe(d) : null;
    let setup = await this.setupFor(d, readiness, status);
    const est: CapabilityEstimate = { capabilityId: d.id, setup, frames: null, chunks: null, missingDownloadBytes: status.reduce((n, m) => n + (m.state === 'ready' ? 0 : m.missingBytes), 0), scratchBytes: 0, seconds: null, basis: 'none', needsConfirm: false, blockers };
    if (d.provider === 'comfyui' && d.frames) {
      try {
        const p = this.planFrameJob(d, req, doc);
        est.frames = p.plan.frameCount;
        est.chunks = p.plan.chunks.length;
        est.scratchBytes = p.scratch;
        est.seconds = p.seconds;
        est.basis = p.seconds === null ? 'none' : 'measured-profile';
        est.needsConfirm = p.seconds !== null && p.seconds > this.cfg.aiConfirmMinutes * 60;
        const free = this.freeBytes(this.store.tmpDir);
        try { admitFramePlan({ d, plan: p.plan, agent: isAgent(req), limits: this.cfg, measured: p.measured, seconds: p.seconds, confirmLongRun: true, scratchBytes: p.scratch, freeBytes: free }); } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          blockers.push({ code: e.code, message: e.message });
          if (e.code === 'disk_insufficient' && setup.code === 'ready') setup = est.setup = { code: 'disk_insufficient', detail: e.message, freeBytes: free ?? undefined };
        }
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        blockers.push({ code: e.code, message: e.message });
      }
    }
    return est;
  }

  // ---------------------------------------------------------------- starting runs
  /**
   * The single entry point used by UI, REST and MCP. Refuses (ApiError) or creates the durable job in one synchronous step: no await
   * between the checks, the idempotency lookup and Store.createJob (aiContracts.ts CapabilityService.start). Readiness that needs a probe
   * (provider, engine, model digests) is shown by estimate() and re-checked by the driver.
   */
  start(req: RunRequest): JobRow {
    const d = this.descriptor(req.capabilityId);
    if (req.idempotencyKey) {
      const prior = this.store.findJobByKey(TYPE, req.actor, req.idempotencyKey);
      if (prior) return prior;
    }
    // A run stores its results in the library: past the storage ceiling it is refused before a job exists, as exports, sounds and narration are.
    assertStorageRoom(this.store, 1, 'run this tool');
    if (d.state !== 'published') throw new ApiError(409, 'capability_is_draft', 'drafts cannot be executed');
    const blockers = this.executionBlockers(publicationBlockers(d, this.cfg.distributionProfile));
    if (blockers.length) throw new ApiError(409, 'capability_blocked', `capability ${d.id} is not eligible to run in the ${this.cfg.distributionProfile} profile`, { blockers });
    const apply: ApplyMode = req.apply ?? 'library';
    if (apply === 'replace-clip' && !(req.source && 'clipId' in req.source)) throw new ApiError(422, 'invalid_request', 'placing the result in a clip needs that clip as the source', { apply }, 'Give source: { clipId }.');
    if (apply === 'new-track' && !(req.source && 'clipId' in req.source) && !req.attach) throw new ApiError(422, 'invalid_request', 'placing the result on a new track needs the clip it is made from, or attach.start', { apply });
    // AI jobs (frame jobs, local tools, model-based stills) are capped per agent: how many may wait or run at once.
    const aiJob = d.provider === 'local' || !!d.frames || d.models.length > 0;
    if (aiJob && isAgent(req)) {
      const open = (this.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND actor = ? AND status IN ('queued','running','cancel-requested')").get(TYPE, req.actor) as { n: number }).n;
      if (open >= this.cfg.agentMaxQueuedJobs) throw new ApiError(409, 'agent_limit', `an agent may have at most ${this.cfg.agentMaxQueuedJobs} AI jobs waiting or running; ${open} are`, { open, limit: this.cfg.agentMaxQueuedJobs }, 'Wait for one to finish.');
    }
    if (d.provider === 'local') return this.startLocal(d, req, apply);
    if (d.frames) return this.startFrames(d, req, apply);
    return this.startStill(d, req, apply);
  }
  private assertComfyReady(d: ComfyDescriptor) {
    const notReady = this.cfg.comfyuiModelsDir || d.models.length === 0 ? [] : d.models.map((m) => m.path);
    if (notReady.length) throw new ApiError(409, 'model_not_ready', 'model files cannot be verified because PF_COMFYUI_MODELS_DIR is not set', { models: notReady });
    if (!this.adapter) throw new ApiError(503, 'provider_not_configured', `the ComfyUI provider is not configured (${this.configError ?? 'PF_COMFYUI_URL is not set'})`, {}, 'Start ComfyUI and set PF_COMFYUI_URL, e.g. http://127.0.0.1:8188. See docs/INTEGRATIONS.md.');
  }
  private resolve<R>(fn: () => R): R {
    try { return fn(); } catch (e) {
      if (e instanceof CapabilityError) throw new ApiError(422, e.code, e.message, e.details);
      throw e;
    }
  }
  /** Entity versions now, for everything the placement depends on (SPEC §20 stale-result protection). */
  private preconditions(projectId: string, ids: string[]) {
    return [...new Set(ids)].map((entityId) => ({ entityId, version: this.store.entityVersion(projectId, entityId)?.revision ?? 0 }));
  }
  /** Placement, and the ids it depends on, for a result made from `clip` (or from a library asset). */
  private placement(doc: ProjectDocument, apply: ApplyMode, req: RunRequest, opts: { m?: number | null; sourceRangeStart?: T.RationalTime | null; still?: boolean } = {}): { placement: Placement; dependsOn: string[] } {
    const clipId = req.source && 'clipId' in req.source ? req.source.clipId : null;
    const f = clipId ? findClip(doc, clipId) : undefined;
    const clip = f?.clip.type === 'media' ? (f.clip as MediaClip) : null;
    if (apply === 'library') return { placement: { mode: 'library', clipId }, dependsOn: [] };
    if (apply === 'replace-clip') {
      if (!clip) throw new ApiError(404, 'clip_not_found', `clip ${clipId} not found`, { clipId });
      let speed: number | undefined;
      const deps = [clip.id, f!.track.id];
      if (opts.m) {
        // slow motion: the clip's speed divided by m, which set_clip_speed must be able to state exactly (three decimals, 0.1–8)
        const s = speedOf(clip);
        const x = s.num / (s.den * opts.m);
        if ((s.num * 1000) % (s.den * opts.m) !== 0 || x < 0.1) throw new ApiError(422, 'incompatible', `the clip plays at ${s.num}/${s.den}; slowed ${opts.m} times that speed cannot be set exactly`, { clipId: clip.id, speed: s, multiplier: opts.m }, 'Set the clip to speed 1 first, or keep the result in the library.');
        speed = x;
        if (clip.linkGroupId) for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) for (const c of t.clips) if (c.type === 'media' && c.linkGroupId === clip.linkGroupId) deps.push(c.id, t.id);
      }
      return { placement: { mode: 'replace-clip', clipId: clip.id, ...(speed !== undefined ? { speed } : {}) }, dependsOn: deps };
    }
    // new-track
    if (opts.m) throw new ApiError(422, 'invalid_request', 'slow motion is placed in its clip (replace-clip) or kept in the library; on a new track it would need its own speed', { apply });
    if (!clip) {
      // Made from a library asset: placed where the caller said (attach.start), which no clip's later edit can make stale. The caller
      // records attach.trackId and its own dependsOn as preconditions.
      const a = req.attach!;
      return { placement: { mode: 'new-track', clipId: null, start: a.start as T.RationalTime, ...(a.duration ? { duration: a.duration as T.RationalTime } : {}) }, dependsOn: [] };
    }
    // The placement copies the clip's start, source in and length as they are now: moved, trimmed, re-timed or deleted while the job
    // runs, the clip no longer says where the result belongs, so the result stays a proposal (attach). Same entities as replace-clip.
    const deps = [clip.id, f!.track.id];
    if (opts.still) return { placement: { mode: 'new-track', clipId: clip.id, start: clip.start, duration: clip.duration }, dependsOn: deps };
    // a picture result keeps the source's timing: it shows the same stretch of source from the same moment, at speed 1
    const span = T.sub(sourceEnd(clip), clip.sourceIn);
    const frames = T.frameIndexAt(span, doc.settings.frameRate);
    if (frames < 1) throw new ApiError(422, 'incompatible', 'the clip shows less than one frame of its file', { clipId: clip.id });
    return { placement: { mode: 'new-track', clipId: clip.id, start: clip.start, sourceIn: T.sub(clip.sourceIn, opts.sourceRangeStart ?? T.ZERO), duration: T.frameTime(frames, doc.settings.frameRate) }, dependsOn: deps };
  }
  private reserveCost(job: JobRow, d: CapabilityDescriptor, req: RunRequest) {
    // Paid capabilities: reserve the declared cost against the caller's budget BEFORE anything is dispatched.
    // No budget, wrong mode or not enough left -> the job is closed as refused and nothing is submitted.
    if (d.cost.cents <= 0) return;
    try {
      if (!req.principal || !this.governance) throw new ApiError(403, 'insufficient_scope', 'paid work needs an identified caller with a budget');
      this.governance.reserve(req.principal, job.id, d.cost.cents);
    } catch (e) {
      this.store.updateJob(job.id, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'budget_error', message: String(e) } });
      throw e;
    }
  }

  /** A still-image ComfyUI capability (G0/G1 path): the source picture is given as a parameter, or as source { clipId | assetId }. */
  private startStill(d: ComfyDescriptor, req: RunRequest, apply: ApplyMode): JobRow {
    const { doc, revision } = this.store.getProject(req.projectId);
    const params = { ...req.params };
    if (req.source) {
      const img = d.inputs.find((i) => i.type === 'image');
      if (!img) throw new ApiError(422, 'invalid_request', `${d.id} does not read a picture, so it takes no source`, {});
      let assetId: string;
      if ('clipId' in req.source) {
        const f = findClip(doc, req.source.clipId);
        if (!f) throw new ApiError(404, 'clip_not_found', `clip ${req.source.clipId} not found`, { clipId: req.source.clipId });
        if (f.clip.type !== 'media') throw new ApiError(422, 'incompatible', 'only a clip that shows a file can be processed', { clipId: f.clip.id });
        assetId = f.clip.assetId;
      } else {
        if (req.source.range) throw new ApiError(422, 'invalid_request', 'a still picture has no frame range', {});
        assetId = req.source.assetId;
      }
      if (params[img.name] !== undefined && params[img.name] !== assetId) throw new ApiError(422, 'invalid_request', `parameter "${img.name}" names a different asset than the source`, { parameter: img.name });
      params[img.name] = assetId;
    }
    this.assertComfyReady(d);
    const resolved = this.resolve(() => resolveGraph(d, params));
    // Media inputs are project assets. Bind a content-addressed name now; the bytes are staged when the job runs.
    const sources = resolved.media.map((m) => {
      if (m.nodeId === null || m.input === null) throw new ApiError(422, 'dangling_binding', `parameter "${m.name}" is not bound to a field of the graph`, { parameter: m.name });
      const a = Object.hasOwn(doc.assets, m.assetId) ? doc.assets[m.assetId] : undefined;
      if (!a) throw new ApiError(404, 'asset_not_found', `asset ${m.assetId} is not in this project`, { parameter: m.name });
      if (a.kind !== m.type || !a.image) throw new ApiError(422, 'incompatible', `parameter "${m.name}" needs an ${m.type} asset; ${m.assetId} is ${a.kind}`, { parameter: m.name });
      if (d.limits.maxPixels && a.image.width * a.image.height > d.limits.maxPixels) throw new ApiError(422, 'input_too_large', `source is ${a.image.width}x${a.image.height}; this capability is qualified up to ${d.limits.maxPixels} pixels`, { parameter: m.name });
      const stagedName = `pf_${a.contentHash.slice(7, 39)}.${a.container === 'jpeg' ? 'jpg' : a.container}`;
      resolved.graph[m.nodeId]!.inputs[m.input] = stagedName;
      return { input: m.name, assetId: a.id, contentHash: a.contentHash, mimeType: a.mimeType, width: a.image.width, height: a.image.height, bytes: a.byteSize, stagedName };
    });
    if (apply !== 'library' && req.source && 'clipId' in req.source) {
      const f = findClip(doc, req.source.clipId)!;
      if (doc.assets[(f.clip as MediaClip).assetId]?.kind !== 'image') throw new ApiError(422, 'incompatible', 'this tool makes a still picture; it can only take the place of a still clip', { clipId: f.clip.id });
    }
    const { placement, dependsOn } = this.placement(doc, apply, req, { still: true });
    // Submission intent, including the id we will give the provider, is durable before anything is dispatched.
    const job = this.store.createJob(req.projectId, TYPE, req.actor, {
      capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, logicDigest: d.graphDigest, params: resolved.resolved, graph: resolved.graph,
      clientRequestId: randomUUID(), ...(actsOpen(req) ? { admittedOpen: true } : {}), projectRevision: revision, idempotencyKey: req.idempotencyKey ?? null, sources,
      attach: req.attach ?? null, placement,
      // Stale-result protection (SPEC §20, FFG-09): remember the version of everything the placement depends on.
      preconditions: this.preconditions(req.projectId, [...(req.dependsOn ?? []), ...(req.attach?.trackId ? [req.attach.trackId] : []), ...dependsOn]),
    });
    this.reserveCost(job, d, req);
    void this.run(job.id);
    return job;
  }

  /** The frame plan a run would have (shared by start and estimate). Throws ApiError on any refusal of the source or the plan shape. */
  private planFrameJob(d: ComfyDescriptor, req: RunRequest, doc: ProjectDocument) {
    const f = d.frames!;
    const given = req.params[f.input];
    const source: RunSource | null = req.source ?? (typeof given === 'string' ? { assetId: given } : null);
    if (!source) throw new ApiError(422, 'invalid_request', `${d.id} needs a source: a clip ({ clipId }) or a library video ({ assetId, range? })`, {});
    const src: FrameSource = resolveFrameSource(doc, source);
    if (given !== undefined && given !== src.assetId) throw new ApiError(422, 'invalid_request', `parameter "${f.input}" names a different asset than the source`, { parameter: f.input });
    const resolved = this.resolve(() => resolveGraph(d, { ...req.params, [f.input]: src.assetId }));
    const media = resolved.media.find((m) => m.name === f.input)!;
    const m = f.mode === 'pairwise' ? Number(resolved.resolved[f.multiplierParam!]) : null;
    let out: PixelSize;
    try { out = frameOutputSize(d, resolved.resolved, src); } catch (e) {
      if (e instanceof CapabilityError) throw new ApiError(409, 'capability_blocked', `the output size of ${d.id} cannot be computed: ${e.message}`, { sizeContract: e.code });
      throw e;
    }
    const ram = ramChunkFrames(this.cfg.aiHostRamBudgetBytes, src.width, src.height, outFactor(d, resolved.resolved));
    const chunkFrames = Math.min(f.chunkFrames, ram);
    if (chunkFrames < (f.mode === 'pairwise' ? 2 : 1)) throw new ApiError(422, 'input_too_large', `one frame at ${src.width}x${src.height} does not fit the provider memory budget (PF_AI_HOST_RAM_BUDGET ${this.cfg.aiHostRamBudgetBytes} bytes)`, { width: src.width, height: src.height, budgetBytes: this.cfg.aiHostRamBudgetBytes });
    const asset = doc.assets[src.assetId]!;
    const cuts = f.mode === 'pairwise' ? sceneCutFrames(doc, src) : [];
    const plan = buildFramePlan({ mode: f.mode, firstFrame: src.firstFrame, frameCount: src.frameCount, rate: src.rate, width: src.width, height: src.height, chunkFrames, multiplier: m, sampleFps: f.sampleFps, cuts });
    const scratch = scratchBytes(plan, out, !!src.audio);
    const { measured, seconds } = this.measured(d, plan.expectedOutputFrames, plan.width * plan.height);
    return { src, resolved, media, m, out, plan, scratch, measured, seconds, asset };
  }
  /** A frame job (ADR-0017, framejobs.ts). */
  private startFrames(d: ComfyDescriptor, req: RunRequest, apply: ApplyMode): JobRow {
    if (d.frames!.mode === 'sampled') throw new ApiError(501, 'not_implemented', 'sampled frame jobs are not implemented yet (no reviewed capability uses them)');
    const { doc, revision } = this.store.getProject(req.projectId);
    const p = this.planFrameJob(d, req, doc);
    this.assertComfyReady(d);
    const admissionWarnings = admitFramePlan({ d, plan: p.plan, agent: isAgent(req), warnOnly: actsOpen(req), limits: this.cfg, measured: p.measured, seconds: p.seconds, confirmLongRun: req.confirmLongRun, scratchBytes: p.scratch, freeBytes: this.freeBytes(this.store.tmpDir) });
    const { placement, dependsOn } = this.placement(doc, apply, req, { m: p.plan.multiplier, sourceRangeStart: p.src.sourceRangeStart });
    const job = this.store.createJob(req.projectId, TYPE, req.actor, {
      capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, logicDigest: d.graphDigest, params: p.resolved.resolved, graph: p.resolved.graph,
      frameBinding: { nodeId: p.media.nodeId, input: p.media.input },
      clientRequestId: randomUUID(), ...(actsOpen(req) ? { admittedOpen: true } : {}), projectRevision: revision, idempotencyKey: req.idempotencyKey ?? null,
      sources: [{ input: d.frames!.input, assetId: p.src.assetId, contentHash: p.asset.contentHash, mimeType: p.asset.mimeType, width: p.src.width, height: p.src.height, bytes: p.asset.byteSize }],
      frames: p.plan, frameSource: p.src, outputSize: p.out, scratchBytes: p.scratch, estimate: { seconds: p.seconds, basis: p.seconds === null ? 'none' : 'measured-profile' },
      ...(admissionWarnings.length ? { admissionWarnings } : {}), // open mode (B11, B12): told, not refused
      attach: req.attach ?? null, placement,
      preconditions: this.preconditions(req.projectId, [...(req.dependsOn ?? []), ...(req.attach?.trackId ? [req.attach.trackId] : []), ...dependsOn]),
    });
    this.reserveCost(job, d, req);
    void this.run(job.id);
    return job;
  }
  /** A local tool (provider 'local'): validated here and by the runner's synchronous prepare, then driven by the runner. */
  private startLocal(d: LocalToolDescriptor, req: RunRequest, apply: ApplyMode): JobRow {
    if (!this.localTools) throw new ApiError(503, 'engine_not_configured', 'local tools are not available in this server', {}, 'See docs/INTEGRATIONS.md (PF_TOOLS_PYTHON, PF_DENOISE_BIN).');
    const resolved = this.resolve(() => resolveParams(d, req.params));
    const { doc, revision } = this.store.getProject(req.projectId);
    const additions = this.localTools.prepare(d, req);
    const clipId = req.source && 'clipId' in req.source ? req.source.clipId : null;
    const f = clipId ? findClip(doc, clipId) : undefined;
    if (apply === 'replace-clip' && !f) throw new ApiError(404, 'clip_not_found', `clip ${clipId} not found`, { clipId });
    const job = this.store.createJob(req.projectId, TYPE, req.actor, {
      ...additions,
      provider: 'local', capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.codeDigest, logicDigest: d.codeDigest, params: resolved.resolved,
      source: req.source ?? null, apply, placement: { mode: apply, clipId } satisfies Placement,
      clientRequestId: randomUUID(), ...(actsOpen(req) ? { admittedOpen: true } : {}), projectRevision: revision, idempotencyKey: req.idempotencyKey ?? null, attach: req.attach ?? null,
      preconditions: this.preconditions(req.projectId, [...(req.dependsOn ?? []), ...(apply === 'replace-clip' && f ? [f.clip.id, f.track.id] : [])]),
    });
    this.reserveCost(job, d, req);
    void this.run(job.id);
    return job;
  }

  // ---------------------------------------------------------------- cancel, recover, stop
  async cancel(jobId: string, actor: string) {
    const job = this.store.getJob(jobId);
    if (job.type !== TYPE) throw new ApiError(409, 'cancel_not_supported', `cancelling ${job.type} jobs is not implemented yet`);
    if (['succeeded', 'failed', 'canceled'].includes(job.status)) return { jobId, status: job.status, outcome: 'already-finished' };
    if (job.input.provider === 'local') {
      if (this.localTools) return this.localTools.cancel(jobId, actor);
      this.store.updateJob(jobId, { status: 'canceled', stage: null, output: { ...job.output, cancel: { by: actor, outcome: 'local' } } });
      return { jobId, status: 'canceled', outcome: 'local' };
    }
    if (job.input.frames) return this.frames.cancel(jobId, actor, this.active.has(jobId));
    this.laneWaits.get(jobId)?.abort(new Error('canceled'));
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

  /** After a restart: resume what we can prove, never blindly resubmit (FF-08). Frame jobs resume after their last verified chunk. */
  async recover() {
    const open = this.store.openJobs(TYPE);
    const local = open.filter((j) => j.input.provider === 'local');
    if (local.length && this.localTools) this.localTools.recover(local);
    for (const job of open) {
      if (job.input.provider === 'local') continue;
      if (job.input.frames) { void this.run(job.id); continue; }
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
    this.frames.abortAll();
    for (const a of this.laneWaits.values()) a.abort(new Error('stopping'));
    await Promise.allSettled([...this.active.values()]);
  }
  private run(jobId: string): Promise<void> {
    if (this.active.has(jobId) || this.stopped) return Promise.resolve();
    const job = this.store.getJob(jobId);
    let p: Promise<void>;
    if (job.input.provider === 'local') {
      if (!this.localTools) return Promise.resolve();
      p = this.localTools.drive(jobId, this.descriptor(job.input.capabilityId) as LocalToolDescriptor);
    } else {
      if (!this.adapter) return Promise.resolve();
      p = job.input.frames ? this.frames.drive(jobId) : this.drive(jobId);
    }
    p = p.catch(() => {}).finally(() => this.active.delete(jobId));
    this.active.set(jobId, p);
    return p;
  }

  // ---------------------------------------------------------------- results into the project
  /**
   * Bring the validated outputs into the project through normal operations.
   * 1. Always: import every declared output as a derived asset (provenance + recipe), in one transaction, so no result is lost.
   * 2. If a placement was requested: re-check every recorded precondition against current entity versions. Unchanged -> place the
   *    primary output (replace_clip_asset, plus set_clip_speed for slow motion, in one transaction; or add_clip). Changed, deleted or
   *    no longer fitting -> leave it in the library as a proposal and say why. A late result never overwrites newer edits.
   */
  private async attach(job: JobRow, bundle: Output[], recipe: any, metas: (MediaMeta | undefined)[] = [], primaryDerived: Record<string, unknown> = {}) {
    if (bundle.length === 0) return { status: 'not-attached', reason: 'capability declares no output' };
    let primaryIdx = bundle.findIndex((o) => o.role === 'primary' && o.mediaType !== 'audio');
    if (primaryIdx < 0) primaryIdx = bundle.findIndex((o) => o.role === 'primary');
    const sourceAssetIds = (job.input.sources as { assetId: string }[]).map((x) => x.assetId);
    const d = this.descriptor(job.input.capabilityId);
    const assets = [];
    for (const [i, o] of bundle.entries()) {
      const meta = metas[i] ?? (await describeMedia(this.store.blobPath(o.contentHash)));
      assets.push({
        ...meta, name: `${job.input.capabilityId} · ${job.id}${bundle.length > 1 ? ` · ${o.name}` : ''}`.slice(0, 256), contentHash: o.contentHash, byteSize: o.bytes,
        provenance: {
          origin: 'derived' as const, importedAt: new Date().toISOString(), importedBy: job.actor,
          derived: {
            jobId: job.id, capabilityId: recipe.capabilityId, capabilityVersion: recipe.capabilityVersion, graphDigest: recipe.graphDigest, params: recipe.params, sourceAssetIds, outputName: o.name, outputRole: o.role, encoding: o.encoding, provider: recipe.provider,
            logicDigest: logicDigest(d), models: d.models.filter((m) => m.sha256).map((m) => ({ path: m.path, sha256: m.sha256! })),
            ...(i === primaryIdx ? primaryDerived : {}),
          },
        },
      });
    }
    const imp = this.store.commit({ projectId: job.projectId, actor: job.actor, allowInternal: true, label: `Result of ${job.input.capabilityId}`, ops: assets.map((asset) => ({ op: 'import_asset', args: { asset } })) });
    const imported = imp.results.map((r, i) => ({ name: bundle[i]!.name, role: bundle[i]!.role, assetId: r.output!.assetId as string, deduplicated: !!r.output!.deduplicated }));
    if (primaryIdx < 0) return { status: 'imported', assets: imported, reason: 'capability declares no primary output; the results are in the library' };
    const assetId = imported[primaryIdx]!.assetId;
    const base = { assetId, deduplicated: imported[primaryIdx]!.deduplicated, assets: imported };
    const placement: Placement | null = job.input.placement ?? null;
    const legacy = job.input.attach;
    if ((!placement || placement.mode === 'library') && !legacy) return { status: 'imported', ...base, reason: 'no placement requested; the asset is in the library' };
    const proposal = placement && placement.mode !== 'library' ? placement : legacy;
    const conflicts = (job.input.preconditions as { entityId: string; version: number }[]).flatMap((p) => {
      const v = this.store.entityVersion(job.projectId, p.entityId);
      return (v?.revision ?? 0) !== p.version ? [{ entityId: p.entityId, expectedVersion: p.version, currentVersion: v?.revision ?? 0, deleted: v?.deleted ?? false, by: v?.actor ?? null }] : [];
    });
    if (conflicts.length) return { status: 'proposed', ...base, reason: 'items this placement depended on changed while the job ran; nothing was placed', conflicts, proposal };
    // Pause Agent: a job that was already running finishes, but an agent's result is not placed while agents are paused.
    if (job.actor.startsWith('agent:') && this.governance?.isPaused(job.projectId)) return { status: 'proposed', ...base, reason: 'agents are paused on this project; the result is kept in the library and was not placed', proposal };
    try {
      if (placement?.mode === 'replace-clip') {
        const ops = [{ op: 'replace_clip_asset', args: { clipId: placement.clipId!, assetId } }, ...(placement.speed !== undefined ? [{ op: 'set_clip_speed', args: { clipId: placement.clipId!, speed: placement.speed } }] : [])];
        const r = this.store.commit({ projectId: job.projectId, actor: job.actor, label: `Use result of ${job.input.capabilityId} in the clip`, ops });
        return { status: 'attached', mode: 'replace-clip', ...base, clipId: placement.clipId, previousAssetId: r.results[0]!.output!.previousAssetId, ...(placement.speed !== undefined ? { speed: placement.speed } : {}), revision: r.revision, transactionId: r.transactionId };
      }
      const args = placement?.mode === 'new-track'
        ? { assetId, start: placement.start, ...(placement.sourceIn ? { sourceIn: placement.sourceIn } : {}), ...(placement.duration ? { duration: placement.duration } : {}), withLinkedAudio: false }
        : { assetId, start: legacy.start, ...(legacy.duration ? { duration: legacy.duration } : {}), ...(legacy.trackId ? { trackId: legacy.trackId } : {}) };
      const r = this.store.commit({ projectId: job.projectId, actor: job.actor, label: `Place result of ${job.input.capabilityId}`, ops: [{ op: 'add_clip', args }] });
      return { status: 'attached', ...(placement?.mode === 'new-track' ? { mode: 'new-track' } : {}), ...base, clipId: r.results[0]!.output!.clipId, trackId: r.results[0]!.output!.trackId, revision: r.revision, transactionId: r.transactionId };
    } catch (e) {
      if (e instanceof ApiError) return { status: 'proposed', ...base, reason: `placement no longer valid: ${e.message}`, error: e.code, proposal };
      throw e;
    }
  }

  /** A still job, holding the compute lane from preparation to collection. */
  private async drive(jobId: string) {
    if (!this.adapter) return;
    const lane = this.lane;
    let release: () => void = () => {};
    if (lane) {
      const ctl = new AbortController();
      this.laneWaits.set(jobId, ctl);
      const job = this.store.getJob(jobId);
      if (lane.busy().holder !== null && job.status === 'queued') this.store.updateJob(jobId, { stage: `queued (waiting for compute: ${lane.busy().holder})` });
      try { release = await lane.acquire(`${job.input.capabilityId} (${jobId})`, ctl.signal); } catch { this.laneWaits.delete(jobId); return; } // canceled or stopping while waiting
      this.laneWaits.delete(jobId);
    }
    try {
      const j = this.store.getJob(jobId);
      if (this.stopped || ['canceled', 'failed', 'succeeded'].includes(j.status)) return;
      await this.driveStill(jobId);
    } finally { release(); }
  }
  private async driveStill(jobId: string) {
    const adapter = this.adapter!;
    const t: Record<string, number> = {};
    let mark = Date.now();
    const lap = (k: string) => { t[k] = (t[k] ?? 0) + (Date.now() - mark) / 1000; mark = Date.now(); };
    try {
      let job = this.store.getJob(jobId);
      const d = this.comfy(job.input.capabilityId);
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
        this.store.updateJob(jobId, { stage: 'submitting', output: { ...this.store.getJob(jobId).output, readiness } });
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
        this.store.updateJob(jobId, { stage: 'queued', output: { ...this.store.getJob(jobId).output, readiness, providerJobId } });
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
        await sleep(this.deps.pollMs ?? 200);
      }
      if (this.stopped) return;
      lap('providerQueueAndInference');
      job = this.store.getJob(jobId);
      if (job.status !== 'cancel-requested') this.store.updateJob(jobId, { stage: 'transfer (downloading outputs)' });
      const destDir = path.join(this.store.tmpDir, `cap_${randomUUID()}`);
      const files = await adapter.collect(d, providerJobId, destDir).catch((e) => { fs.rmSync(destDir, { recursive: true, force: true }); throw e; });
      lap('transfer');
      const bundle: Output[] = [];
      const metas: MediaMeta[] = [];
      try {
        for (const f of files) {
          // Size and digest are read from the stored file, never taken from the adapter's record.
          const tmp = f.path;
          const size = fs.statSync(tmp).size;
          if (size === 0) throw new ApiError(502, 'output_invalid', `output "${f.name}" is empty`);
          const contentHash = `sha256:${createHash('sha256').update(fs.readFileSync(tmp)).digest('hex')}`;
          let probe;
          try { probe = await ffprobe(tmp); } catch { throw new ApiError(502, 'output_invalid', `output "${f.name}" (${f.fileName}) is not decodable media`); }
          const v = probe.streams?.find((x: any) => x.codec_type === 'video');
          const a = probe.streams?.find((x: any) => x.codec_type === 'audio');
          if ((f.mediaType === 'audio' && !a) || (f.mediaType !== 'audio' && !v)) throw new ApiError(502, 'output_invalid', `output "${f.name}" does not contain ${f.mediaType}`);
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
              if (e instanceof CapabilityError) throw new ApiError(502, 'output_invalid', `output "${f.name}": ${e.message}`, { sizeContract: e.code });
              throw e;
            }
            if (!v || v.width !== want.width || v.height !== want.height) throw new ApiError(502, 'output_invalid', `output "${f.name}" is ${v ? `${v.width}x${v.height}` : 'not a picture'}, expected ${want.width}x${want.height}`);
          }
          // The asset description decides the media type by container (and refuses what the editor could not use as it is).
          let meta: MediaMeta;
          try { meta = await describeMedia(tmp); } catch (e) {
            if (e instanceof NeedsConform) throw new ApiError(502, 'output_not_editable', `output "${f.name}" would need conforming before it can be edited (${e.reasons.join(', ')})`, { reasons: e.reasons });
            throw new ApiError(502, 'output_invalid', `output "${f.name}" cannot be described as editable media: ${(e as Error).message}`);
          }
          // the result is stored only if it fits under the ceiling; otherwise the job fails with that reason and nothing is kept
          if (!fs.existsSync(this.store.blobPath(contentHash))) assertStorageRoom(this.store, size, 'store this result');
          this.store.putBlob(contentHash, tmp, size, meta.mimeType);
          metas.push(meta);
          bundle.push({ name: f.name, role: f.role, mediaType: f.mediaType, encoding: f.encoding, contentHash, bytes: size, mimeType: meta.mimeType, codec: (v ?? a).codec_name, width: v?.width ?? null, height: v?.height ?? null, pixFmt: v?.pix_fmt ?? null, hasAlpha: /a/.test(String(v?.pix_fmt ?? '').replace(/^(gray|pal|ya)/, '')) && /rgba|bgra|ya|yuva|gbrap/.test(String(v?.pix_fmt)), durationSeconds: probe.format?.duration ? Number(probe.format.duration) : null });
        }
      } finally { fs.rmSync(destDir, { recursive: true, force: true }); }
      lap('validation');
      const openReviews = this.openReviews(d);
      const recipe = { experimental: openReviews.length > 0, openReviews, capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, logicDigest: d.graphDigest, params: job.input.params, sources: job.input.sources, provider: { id: adapter.id, runtimeVersion: readiness?.runtimeVersion ?? null, device: readiness?.device ?? null } };
      const attachment = await this.attach(job, bundle, recipe, metas);
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
