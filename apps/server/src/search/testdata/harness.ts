/**
 * Test harness of builder B's search tests (labelled test code): a real Store, Auth, Governance, the real app (createApp) and MCP handler
 * with the search runtime built over the labelled TEST-DOUBLE embedder, requests through app.fetch (no port is opened), and tiny
 * synthetic colour videos made by ffmpeg (never anyone's footage).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { Auth } from '../../auth.ts';
import { Capabilities } from '../../capabilities.ts';
import { loadConfig, type Config } from '../../config.ts';
import { Derivatives } from '../../derive.ts';
import { Exporter } from '../../export.ts';
import { Governance, type Principal } from '../../governance.ts';
import { createApp } from '../../http.ts';
import { FifoComputeLane } from '../../lane.ts';
import { createMcp } from '../../mcp.ts';
import { Presence } from '../../presence.ts';
import { Speech } from '../../speech.ts';
import { Store } from '../../store.ts';
import { createSearchRuntime, type SearchRuntimeOptions } from '../runtime.ts';
import { createTestEmbedder, type TestEmbedder, type TestEmbedderOptions } from '../testEmbedder.ts';
import { CORE } from '../answer.ts';

export const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
export type Who = () => Record<string, string>;

/** A tiny synthetic video: colour segments (ffmpeg colour names) of `seconds` each at `fps`, 64×36, H.264. */
export function makeColourVideo(file: string, colours: string[], seconds: number, fps: number): { file: string; frames: number; fps: number } {
  const inputs = colours.flatMap((c) => ['-f', 'lavfi', '-i', `color=c=${c}:s=64x36:r=${fps}:d=${seconds}`]);
  const filter = `${colours.map((_, i) => `[${i}:v]`).join('')}concat=n=${colours.length}:v=1:a=0[v]`;
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...inputs, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', String(fps), file]);
  return { file, frames: colours.length * seconds * fps, fps };
}

export interface Harness {
  dir: string; cfg: Config; store: Store; auth: Auth; gov: Governance; lane: FifoComputeLane; embedder: TestEmbedder;
  runtime: ReturnType<typeof createSearchRuntime>;
  app: ReturnType<typeof createApp>; mcp: ReturnType<typeof createMcp>;
  owner: Who; agent: Who; observer: Who; bearer(token: string): Who;
  rest(who: Who, method: string, p: string, body?: unknown): Promise<{ status: number; text: string; body: any }>;
  rpc(who: Who, method: string, params: unknown): Promise<any>;
  importVideo(projectId: string, src: { file: string; frames: number; fps: number }, name?: string): { assetId: string; contentHash: string };
  newRuntime(opts?: Partial<SearchRuntimeOptions>): ReturnType<typeof createSearchRuntime>;
  close(): Promise<void>;
}

export function createHarness(opts: { embedder?: TestEmbedderOptions | null; runtime?: Partial<SearchRuntimeOptions>; cfg?: Partial<Config> } = {}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-searchB-'));
  const cfg: Config = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null, toolsPython: null, searchModelDir: null, libraryDir: null, ...opts.cfg };
  const store = new Store(dir);
  const auth = new Auth(cfg);
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  const lane = new FifoComputeLane();
  const embedder = createTestEmbedder(opts.embedder ?? {});
  const make = (o: Partial<SearchRuntimeOptions> = {}) => createSearchRuntime({ cfg, store, lane, core: CORE, ...(opts.embedder === null ? {} : { embedder }), ...opts.runtime, ...o });
  const runtime = make();
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, undefined, { search: runtime });
  const app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech, { search: runtime });
  const base = `http://127.0.0.1:${cfg.port}`;
  const cookie = auth.issueSession(new Request(`${base}/api/v1/session`, { headers: { origin: base, 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base, cookie, 'content-type': 'application/json' });
  const bearer = (token: string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  let rpcId = 0;
  const h: Harness = {
    dir, cfg, store, auth, gov, lane, embedder, runtime, app, mcp, owner,
    agent: bearer(auth.tokens.agent), observer: bearer(auth.tokens.observer), bearer,
    async rest(who, method, p, body) {
      const r = await app.fetch(new Request(`${base}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
      const text = await r.text();
      return { status: r.status, text, body: (r.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) : null };
    },
    async rpc(who, method, params) {
      const r = await mcp(new Request(`${base}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
      const text = await r.text();
      return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    },
    importVideo(projectId, src, name) {
      const bytes = fs.readFileSync(src.file);
      const hex = createHash('sha256').update(bytes).digest('hex');
      const tmp = path.join(store.tmpDir, `in-${hex.slice(0, 8)}-${Math.random().toString(36).slice(2)}`);
      fs.copyFileSync(src.file, tmp);
      store.putBlob(`sha256:${hex}`, tmp, bytes.length, 'video/mp4');
      const R = { num: src.fps, den: 1 };
      const asset = { kind: 'video' as const, name: name ?? path.basename(src.file), contentHash: `sha256:${hex}`, byteSize: bytes.length, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(src.frames, R),
        video: { width: 64, height: 36, frameRate: R, codec: 'h264', rotation: 0, frameCount: src.frames }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
      const r = store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
      return { assetId: r.results[0]!.output!.assetId as string, contentHash: asset.contentHash };
    },
    newRuntime: make,
    async close() {
      await runtime.stop();
      await mcp.close();
      await speech.stop();
      await capabilities.stop();
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

/** Wait until `cond` holds (polling every 20 ms), or fail after `ms`. */
export async function until(cond: () => boolean, ms = 20_000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
