/**
 * Model files for a local provider (Amendment A1 FF-05, gate FFG-04).
 * A model is READY only if the file at its pinned path has exactly the reviewed byte size and SHA-256.
 * Existing-with-nonzero-size proves nothing. Downloads are explicit, resumable, host-restricted and
 * verified before the file is moved into place; a wrong or partial file is never visible as ready.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { CapabilityModel } from '@pulseframe/providers';
import { ApiError } from './store.ts';

/** The fields of a reviewed model record the store reads (ComfyUI, speech and local-tool records all have them). */
type Model = Pick<CapabilityModel, 'path' | 'sha256' | 'bytes' | 'source'>;
export type ModelState = 'ready' | 'missing' | 'partial-download' | 'corrupt' | 'unverifiable' | 'unresolved';
export interface ModelStatus { path: string; state: ModelState; expectedBytes: number | null; presentBytes: number; missingBytes: number; detail: string }

export class ModelStore {
  private digests = new Map<string, string>();
  constructor(private dir: string | null, private allowedHosts: string[], private fetchImpl: typeof fetch = fetch) {}

  private file(m: Model) {
    const p = path.resolve(this.dir!, m.path);
    if (!p.startsWith(this.dir! + path.sep)) throw new ApiError(400, 'bad_model_path', 'model path escapes the models directory');
    return p;
  }
  private async sha256(file: string): Promise<string> {
    const st = fs.statSync(file);
    const key = `${file}|${st.size}|${st.mtimeMs}`;
    let d = this.digests.get(key);
    if (!d) {
      const h = createHash('sha256');
      await pipeline(fs.createReadStream(file), h);
      d = h.digest('hex');
      this.digests.set(key, d);
    }
    return d;
  }
  async status(m: Model): Promise<ModelStatus> {
    const base = { path: m.path, expectedBytes: m.bytes, presentBytes: 0, missingBytes: m.bytes ?? 0 };
    if (!m.sha256 || !m.bytes) return { ...base, state: 'unresolved', detail: 'no reviewed digest/size for this model' };
    if (!this.dir) return { ...base, state: 'unverifiable', detail: 'PF_COMFYUI_MODELS_DIR is not set, so the file cannot be verified' };
    const f = this.file(m);
    const part = `${f}.part`;
    if (!fs.existsSync(f)) {
      const got = fs.existsSync(part) ? fs.statSync(part).size : 0;
      return { ...base, presentBytes: got, missingBytes: Math.max(0, m.bytes - got), state: got ? 'partial-download' : 'missing', detail: got ? `${got} of ${m.bytes} bytes downloaded` : 'file not present' };
    }
    const size = fs.statSync(f).size;
    if (size !== m.bytes) return { ...base, presentBytes: size, missingBytes: m.bytes, state: 'corrupt', detail: `file is ${size} bytes, reviewed artifact is ${m.bytes}` };
    const digest = await this.sha256(f);
    if (digest !== m.sha256) return { ...base, presentBytes: size, missingBytes: m.bytes, state: 'corrupt', detail: 'SHA-256 does not match the reviewed artifact' };
    return { ...base, presentBytes: size, missingBytes: 0, state: 'ready', detail: 'size and SHA-256 verified' };
  }
  private hostAllowed(u: URL) {
    return u.protocol === 'https:' && this.allowedHosts.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h));
  }
  /** The hosts of these sources (and only those) that the allowed list does not name (a leading dot allows subdomains). */
  unlistedHosts(sources: readonly (string | null)[]): string[] {
    const out = new Set<string>();
    for (const src of sources) {
      if (!src) continue;
      let host: string;
      try { host = new URL(src).hostname; } catch { continue; }
      if (!this.allowedHosts.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h))) out.add(host);
    }
    return [...out];
  }
  /**
   * Resumable, verified download. Throws ApiError; leaves a `.part` file for resume unless the digest is wrong.
   * `open.anyHost` (open server mode, decided at admission; autonomy-mode.ts warnsOpen, row D1): a host outside the list is used
   * and reported through `open.onHost`; https is still required on every hop, no credential is ever sent, and the pinned size and
   * SHA-256 are checked as always.
   */
  async download(m: Model, onProgress: (got: number, total: number) => void, signal?: AbortSignal, open: { anyHost?: boolean; onHost?: (host: string) => void } = {}): Promise<ModelStatus> {
    if (!this.dir) throw new ApiError(409, 'models_dir_not_configured', 'set PF_COMFYUI_MODELS_DIR to the local ComfyUI models directory');
    if (!m.source || !m.sha256 || !m.bytes) throw new ApiError(409, 'unresolved_model', `model ${m.path} has no pinned source, digest and size`);
    if ((await this.status(m)).state === 'ready') return this.status(m);
    const f = this.file(m);
    const part = `${f}.part`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) fs.rmSync(f); // present but wrong: never keep serving it
    let offset = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (offset > m.bytes) { fs.rmSync(part); offset = 0; }
    if (offset < m.bytes) {
      let url = new URL(m.source);
      let res: Response | undefined;
      for (let hop = 0; hop < 6; hop++) {
        if (!this.hostAllowed(url)) {
          if (!open.anyHost || url.protocol !== 'https:') throw new ApiError(403, 'model_host_not_allowed', `download host ${url.hostname} is not in the allowed list`, { allowed: this.allowedHosts });
          open.onHost?.(url.hostname);
        }
        res = await this.fetchImpl(url, { redirect: 'manual', signal, headers: offset ? { range: `bytes=${offset}-` } : {} });
        const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
        if (!loc) break;
        url = new URL(loc, url);
      }
      if (!res || !(res.status === 200 || res.status === 206) || !res.body) throw new ApiError(502, 'model_download_failed', `download answered HTTP ${res?.status}`);
      if (res.status === 200 && offset) { fs.rmSync(part); offset = 0; } // server ignored the range: start over
      let got = offset;
      const meter = new Transform({ transform(chunk, _e, cb) { got += chunk.length; if (got > m.bytes!) return cb(new ApiError(502, 'model_download_failed', 'server sent more bytes than the reviewed size')); onProgress(got, m.bytes!); cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body as any), meter, fs.createWriteStream(part, { flags: offset ? 'a' : 'w', mode: 0o600 }), { signal });
    }
    const size = fs.statSync(part).size;
    if (size !== m.bytes) throw new ApiError(502, 'model_download_incomplete', `have ${size} of ${m.bytes} bytes; retry to resume`, { presentBytes: size });
    const digest = await this.sha256(part);
    if (digest !== m.sha256) { fs.rmSync(part); throw new ApiError(502, 'model_digest_mismatch', 'downloaded bytes do not match the reviewed SHA-256; the file was discarded', { got: digest }); }
    fs.renameSync(part, f);
    return this.status(m);
  }
}
