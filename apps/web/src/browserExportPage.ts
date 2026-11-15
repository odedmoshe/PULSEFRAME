/**
 * Standalone utility page around `runBrowserExport`. A test/utility surface (the proof drives it; the editor UI
 * will call `runBrowserExport` directly). It obtains the owner cookie the same way the editor does.
 */
import './strictPage.ts';
import { BrowserExportError, probeCapabilities, probeSound, runBrowserExport, type BrowserCapabilities } from './browserExport.ts';
import { ownerKeyHeader } from './api.ts';

interface PageResult { jobId: string; videoCodec: string; audioCodec: string; container: string; frames: number; sha256: string; bytes: number; substitutions: string[]; capabilities: BrowserCapabilities; wallMs: number; base64: string }
type Api = {
  ready: Promise<void>;
  /** Job id and session id of the most recent export, available as soon as its lease exists. */
  last: { jobId: string | null; sessionId: string | null; progress: unknown };
  capabilities(width: number, height: number, frameRate: number, sampleRate: number): Promise<BrowserCapabilities>;
  run(projectId: string, options?: Record<string, unknown>): Promise<PageResult>;
  /** Renders `frames` frames, then stalls forever: heartbeats continue (the lease stays alive) until the caller closes the page, and nothing is abandoned. The promise never settles. */
  runAndAbandonAfter(projectId: string, options: Record<string, unknown>, frames: number): Promise<never>;
  /** Like run, but returns the typed error instead of throwing across the evaluate boundary. */
  /** Raw authenticated POST with the tab's own cookie (test utility: used to attempt calls as another session). */
  post(path: string, body: unknown): Promise<{ status: number; code?: string; body: any }>;
  tryRun(projectId: string, options?: Record<string, unknown>): Promise<{ ok: true; result: PageResult } | { ok: false; code: string; message: string; missing?: string[] }>;
  /** Test utility: decoder timing of one asset's sound. */
  probeSound(projectId: string, assetId: string): ReturnType<typeof probeSound>;
};
declare global { interface Window { __pfBrowserExport: Api } }

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const last: Api['last'] = { jobId: null, sessionId: null, progress: null };
const hooks = { onJob: (jobId: string, sessionId: string) => { last.jobId = jobId; last.sessionId = sessionId; }, onProgress: (p: unknown) => { last.progress = p; } };
const run: Api['run'] = async (projectId, options = {}) => {
  const r = await runBrowserExport({ projectId, options, ...hooks });
  const { blob, ...rest } = r;
  return { ...rest, base64: await toBase64(blob) };
};
window.__pfBrowserExport = {
  // Same owner-cookie handshake as the editor.
  ready: fetch('/api/v1/session', { credentials: 'same-origin', headers: ownerKeyHeader() }).then((r) => { if (!r.ok) throw new Error(`session: HTTP ${r.status}`); }),
  last,
  capabilities: probeCapabilities,
  run,
  runAndAbandonAfter: (projectId, options, frames) => runBrowserExport({ projectId, options, freezeAfterFrames: frames, ...hooks }).then(() => { throw new Error('unreachable'); }),
  async post(path, body) {
    const r = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, code: j?.error?.code, body: j };
  },
  probeSound: (projectId, assetId) => probeSound(`/api/v1/projects/${projectId}/assets/${assetId}/content`),
  async tryRun(projectId, options = {}) {
    try { return { ok: true, result: await run(projectId, options) }; } catch (e: any) { return { ok: false, code: e instanceof BrowserExportError ? e.code : 'error', message: String(e?.message ?? e), missing: e?.missing }; }
  },
};
