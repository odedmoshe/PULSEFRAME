/**
 * ComfyUI adapter over ComfyUI's own HTTP API (ADR-0007). The base URL is operator configuration,
 * never taken from a graph or a request. Local-only policy: non-loopback hosts must be explicitly allowed.
 */
import { createHash } from 'node:crypto';
import fs, { openAsBlob } from 'node:fs';
import path from 'node:path';
import type { CancelOutcome, CollectedOutput, Estimate, ProviderAdapter, Readiness, RemoteState, Submission } from './contract.ts';
import type { CapabilityDescriptor, ComfyDescriptor } from './descriptor.ts';

export class ProviderError extends Error {
  constructor(public code: string, message: string, public ambiguous = false) {
    super(message);
  }
}
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class ComfyUIAdapter implements ProviderAdapter {
  readonly id = 'comfyui';
  private base: string;
  constructor(baseUrl: string, private opts: { allowRemote?: boolean; timeoutMs?: number; fetch?: typeof fetch } = {}) {
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new ProviderError('bad_provider_url', 'ComfyUI URL must be http(s)');
    if (!LOOPBACK.has(u.hostname) && !opts.allowRemote) throw new ProviderError('remote_provider_not_allowed', `ComfyUI host ${u.hostname} is not loopback; remote execution must be enabled explicitly (media would leave this machine)`);
    this.base = u.origin;
  }
  private async call(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await (this.opts.fetch ?? fetch)(`${this.base}${path}`, { ...init, signal: AbortSignal.timeout(this.opts.timeoutMs ?? 15_000) });
    } catch (e: any) {
      // A transport failure on submit means we do not know whether the provider accepted the job.
      throw new ProviderError('provider_unreachable', `ComfyUI request ${path} failed: ${e?.message ?? e}`, init?.method === 'POST');
    }
  }
  private async json(path: string, init?: RequestInit) {
    const r = await this.call(path, init);
    if (!r.ok) throw new ProviderError('provider_error', `ComfyUI ${path} answered HTTP ${r.status}: ${(await r.text()).slice(0, 400)}`);
    return r.json() as Promise<any>;
  }

  async probe(d?: ComfyDescriptor): Promise<Readiness> {
    const out: Readiness = { reachable: false, wokeWorker: false, runtimeVersion: null, device: null, hostRamBytes: null, missingNodeClasses: [], missingModels: [], problems: [] };
    try {
      const s = await this.json('/system_stats');
      out.reachable = true;
      out.runtimeVersion = s.system?.comfyui_version ?? null;
      out.hostRamBytes = s.system?.ram_total ?? null;
      const dev = s.devices?.[0];
      if (dev) out.device = { name: dev.name, type: dev.type, vramTotalBytes: dev.type === 'cpu' ? null : (dev.vram_total ?? null) };
      if (d) {
        const info = await this.json('/object_info');
        out.missingNodeClasses = d.requiredNodes.map((n) => n.classType).filter((c) => !(c in info));
        if (out.missingNodeClasses.length) out.problems.push(`node classes not installed: ${out.missingNodeClasses.join(', ')}`);
        // Model readiness is decided by the Studio (digest-verified files, FF-05), not by listing provider file names.
      }
    } catch (e: any) {
      out.problems.push(e.message);
    }
    return out;
  }
  estimate(d: CapabilityDescriptor): Estimate {
    const p = d.resources.measuredProfiles[0];
    return { downloadBytes: d.resources.downloadBytes, durationSeconds: p?.wallSeconds ?? null, costUsd: null, basis: p ? 'measured-profile' : 'none' };
  }
  async stage(localPath: string, name: string, mimeType: string): Promise<string> {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name)) throw new ProviderError('bad_stage_name', 'staged file name must be a plain file name');
    const form = new FormData();
    // openAsBlob is file-backed: the upload streams from disk instead of buffering the whole source in memory.
    form.append('image', await openAsBlob(localPath, { type: mimeType }), name);
    form.append('overwrite', 'true');
    form.append('type', 'input');
    const r = await this.call('/upload/image', { method: 'POST', body: form });
    const body = await r.json().catch(() => null);
    if (!r.ok || typeof body?.name !== 'string') throw new ProviderError('stage_failed', `ComfyUI did not accept the source file: HTTP ${r.status}`);
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  }
  async submit(graph: Record<string, unknown>, clientRequestId: string): Promise<Submission> {
    const r = await this.call('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: clientRequestId, extra_data: { pulseframe_request: clientRequestId } }) });
    const body = await r.json().catch(() => null);
    if (!r.ok || !body?.prompt_id) throw new ProviderError('provider_rejected', `ComfyUI rejected the graph: ${JSON.stringify(body?.error ?? body?.node_errors ?? body).slice(0, 600)}`);
    return { providerJobId: body.prompt_id, clientRequestId };
  }
  async status(id: string): Promise<RemoteState> {
    const h = (await this.json(`/history/${encodeURIComponent(id)}`))[id];
    if (h) {
      if (h.status?.status_str === 'error') return { state: 'failed', message: JSON.stringify(h.status?.messages?.at(-1) ?? 'execution error').slice(0, 600) };
      if (h.status?.completed) return { state: 'succeeded' };
    }
    const q = await this.json('/queue');
    if ((q.queue_running ?? []).some((e: any[]) => e[1] === id)) return { state: 'running' };
    const pos = (q.queue_pending ?? []).findIndex((e: any[]) => e[1] === id);
    return pos >= 0 ? { state: 'queued', position: pos } : { state: 'unknown' };
  }
  async findByClientRequestId(clientRequestId: string): Promise<string | null> {
    const match = (e: any[]) => e?.[3]?.pulseframe_request === clientRequestId || e?.[3]?.client_id === clientRequestId;
    const q = await this.json('/queue');
    for (const e of [...(q.queue_running ?? []), ...(q.queue_pending ?? [])]) if (match(e)) return e[1];
    const h = await this.json('/history?max_items=200');
    for (const [id, v] of Object.entries<any>(h)) if (match(v.prompt)) return id;
    return null;
  }
  async cancel(id: string): Promise<CancelOutcome> {
    const s = await this.status(id);
    if (s.state === 'queued') { await this.call('/queue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [id] }) }); return 'removed-from-queue'; }
    // ComfyUI's interrupt is global. It is only safe while this job is the one running; multi-tenant ownership needs a worker lease (FF-07).
    if (s.state === 'running') { await this.call('/interrupt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt_id: id }) }); return 'interrupt-requested'; }
    return 'not-found';
  }
  /**
   * L0 compile bridge (ADR-0017 contract): writes each declared output into `destDir` and hashes it. This version still reads each
   * file into memory before writing it, with the fixed 15 s timeout; the frame-job work (W1) replaces it with the streamed,
   * size-aware collect the contract describes.
   */
  async collect(d: ComfyDescriptor, id: string, destDir: string): Promise<CollectedOutput[]> {
    const h = (await this.json(`/history/${encodeURIComponent(id)}`))[id];
    if (!h) throw new ProviderError('output_missing', 'provider has no record of the finished job');
    const out: CollectedOutput[] = [];
    fs.mkdirSync(destDir, { recursive: true });
    for (const o of d.outputs) {
      if (o.nodeId === null || o.mediaType === 'data') throw new ProviderError('output_missing', `declared output "${o.name}" is not a ComfyUI node output`);
      const files: any[] = Object.values(h.outputs?.[o.nodeId] ?? {}).flat().filter((f: any) => f && typeof f.filename === 'string');
      if (files.length === 0) throw new ProviderError('output_missing', `declared output "${o.name}" (node ${o.nodeId}) produced no file`);
      for (const f of files) {
        const r = await this.call(`/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })}`);
        if (!r.ok) throw new ProviderError('output_missing', `could not download ${f.filename}: HTTP ${r.status}`);
        const bytes = new Uint8Array(await r.arrayBuffer());
        const file = path.join(destDir, `out_${out.length}_${String(f.filename).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)}`);
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        out.push({ name: o.name, role: o.role, mediaType: o.mediaType, encoding: o.encoding, fileName: f.filename, path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
      }
    }
    return out;
  }
  /** Contract member for the compute lane's interrupt rule. Not implemented in L0 (the frame-job work, W1, adds it): it refuses rather than answer "nothing is running". */
  async running(): Promise<{ promptId: string; clientRequestId: string | null }[]> {
    throw new ProviderError('not_implemented', 'listing running prompts is not implemented yet');
  }
}
