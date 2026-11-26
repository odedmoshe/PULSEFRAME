/**
 * ComfyUI adapter over ComfyUI's own HTTP API (ADR-0007). The base URL is operator configuration,
 * never taken from a graph or a request. Local-only policy: non-loopback hosts must be explicitly allowed.
 */
import { createHash } from 'node:crypto';
import fs, { openAsBlob } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DEFAULT_ADAPTER_TIMEOUTS, type AdapterTimeouts, type CancelOutcome, type CollectedOutput, type Estimate, type ProviderAdapter, type Readiness, type RemoteState, type Submission } from './contract.ts';
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
  private timeouts: AdapterTimeouts;
  /**
   * `timeoutMs` bounds the small JSON calls (default 15 s). `timeouts` bounds transfers (stage and /view alike):
   * baseMs + bytes / bytesPerSecond, so a large chunk or output gets the time its size needs and a stalled one still ends (ADR-0017).
   */
  constructor(baseUrl: string, private opts: { allowRemote?: boolean; timeoutMs?: number; timeouts?: Partial<AdapterTimeouts>; fetch?: typeof fetch } = {}) {
    this.timeouts = { ...DEFAULT_ADAPTER_TIMEOUTS, ...opts.timeouts };
    const u = new URL(baseUrl);
    if (!['http:', 'https:'].includes(u.protocol)) throw new ProviderError('bad_provider_url', 'ComfyUI URL must be http(s)');
    if (!LOOPBACK.has(u.hostname) && !opts.allowRemote) throw new ProviderError('remote_provider_not_allowed', `ComfyUI host ${u.hostname} is not loopback; remote execution must be enabled explicitly (media would leave this machine)`);
    this.base = u.origin;
  }
  /** Transfer budget for `bytes`: baseMs + bytes / bytesPerSecond. */
  transferTimeoutMs(bytes: number): number {
    return Math.ceil(this.timeouts.baseMs + (Math.max(0, bytes) / this.timeouts.bytesPerSecond) * 1000);
  }
  private async call(path: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
    try {
      return await (this.opts.fetch ?? fetch)(`${this.base}${path}`, { ...init, signal: init?.signal ?? AbortSignal.timeout(timeoutMs ?? this.opts.timeoutMs ?? 15_000) });
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
    // The upload may be a chunk of many frames: the time allowed follows its size (15 s + bytes / 20 MB/s by default).
    const r = await this.call('/upload/image', { method: 'POST', body: form }, this.transferTimeoutMs(fs.statSync(localPath).size));
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
   * Download every file of every declared output into `destDir`, in the order the provider lists them (a frame job's PreviewImage
   * batch is in frame order). Each file is streamed to disk through a SHA-256 hash and a byte counter; nothing is buffered whole.
   * The time allowed per file is baseMs + bytes / bytesPerSecond: from Content-Length when the provider states it, otherwise
   * re-armed as bytes arrive, so a transfer that stalls ends with output_missing instead of hanging (ADR-0017).
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
        const file = path.join(destDir, `out_${String(out.length).padStart(6, '0')}_${String(f.filename).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80)}`);
        const { bytes, sha256 } = await this.download(`/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type ?? 'output' })}`, file, f.filename);
        out.push({ name: o.name, role: o.role, mediaType: o.mediaType, encoding: o.encoding, fileName: f.filename, path: file, bytes, sha256 });
      }
    }
    return out;
  }
  /** Stream one /view response into `file` (mode 0600) while hashing it. A failed or stalled transfer removes the partial file. */
  private async download(viewPath: string, file: string, name: string): Promise<{ bytes: number; sha256: string }> {
    const ctl = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const arm = (budgetMs: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; ctl.abort(); }, Math.max(1, budgetMs - (Date.now() - started)));
    };
    arm(this.timeouts.baseMs); // until the headers arrive
    try {
      const r = await this.call(viewPath, { signal: ctl.signal });
      if (!r.ok || !r.body) throw new ProviderError('output_missing', `could not download ${name}: HTTP ${r.status}`);
      const stated = Number(r.headers.get('content-length'));
      const known = Number.isFinite(stated) && stated > 0;
      arm(this.transferTimeoutMs(known ? stated : 0));
      const hash = createHash('sha256');
      let bytes = 0;
      const self = this;
      const meter = new Transform({
        transform(chunk: Buffer, _e, cb) {
          bytes += chunk.length;
          hash.update(chunk);
          if (!known) arm(self.transferTimeoutMs(bytes)); // no stated size: the allowance grows with what has arrived
          cb(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(r.body as any), meter, fs.createWriteStream(file, { mode: 0o600 }));
      if (known && bytes !== stated) throw new ProviderError('output_missing', `download of ${name} ended after ${bytes} of ${stated} bytes`);
      return { bytes, sha256: hash.digest('hex') };
    } catch (e: any) {
      fs.rmSync(file, { force: true });
      if (timedOut) throw new ProviderError('output_missing', `download of ${name} exceeded its time allowance (${this.timeouts.baseMs} ms + bytes / ${this.timeouts.bytesPerSecond} B/s)`);
      if (e instanceof ProviderError) throw e;
      throw new ProviderError('output_missing', `download of ${name} failed: ${e?.message ?? e}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  /**
   * Prompts ComfyUI is running now, with the request id we stored in their extra_data (null for prompts that are not ours).
   * The compute lane sends the global /interrupt only when every running prompt is one of the job's own (ADR-0017).
   */
  async running(): Promise<{ promptId: string; clientRequestId: string | null }[]> {
    const q = await this.json('/queue');
    return (q.queue_running ?? []).map((e: any[]) => ({ promptId: String(e?.[1]), clientRequestId: typeof e?.[3]?.pulseframe_request === 'string' ? e[3].pulseframe_request : null }));
  }
}
