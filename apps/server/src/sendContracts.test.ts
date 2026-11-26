/**
 * Lead contracts of track send on the server (wave 7): the clip-loudness route and MCP tool answer an honest 501 not_built until
 * worker A builds the measurement (after the body and existence checks); a target size is an honest blocker until worker B builds
 * the fit; the browser route refuses a target size and the limiter; the options of older jobs parse as before; programmeLoudness
 * moved to its own file and is still the one REST and MCP use. What A and B built is tested in clipLoudness.test.ts, sizeFit.test.ts and exportMetadata.test.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { SEND_API_REFUSALS, SIZE_FIT_BUILT } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter, ExportOptionsSchema } from './export.ts';
import { Governance } from './governance.ts';
import { createApp, programmeLoudness as fromHttp } from './http.ts';
import { programmeLoudness } from './programmeLoudness.ts';
import { CLIP_LOUDNESS_BUILT } from './clipLoudness.ts';
import { createMcp } from './mcp.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const R = { num: 30, den: 1 };
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, exporter: Exporter;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t: string) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, text: msg.result.content[0].text as string };
};
function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(60, R) } }] });
  return pid;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-send-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('send: server contracts (wave 7 pre-pass)', () => {
  it('POST …/analysis/clip-loudness: 400 for a bad body, 404 for an unknown project, then 501 not_built while unbuilt', async () => {
    const pid = seed('cl');
    expect((await rest('POST', `/projects/${pid}/analysis/clip-loudness`, { clipIds: [] }, auth.tokens.agent)).status).toBe(400);
    expect((await rest('POST', `/projects/${pid}/analysis/clip-loudness`, { clipIds: ['a'], extra: 1 }, auth.tokens.agent)).status).toBe(400);
    expect((await rest('POST', `/projects/prj_none/analysis/clip-loudness`, { clipIds: ['a'] }, auth.tokens.agent)).status).toBe(404);
    const r = await rest('POST', `/projects/${pid}/analysis/clip-loudness`, { clipIds: ['clp_x'] }, auth.tokens.agent);
    if (!CLIP_LOUDNESS_BUILT) { expect(r.status).toBe(501); expect(r.body.error.code).toBe('not_built'); expect(r.body.error.message).toBe(SEND_API_REFUSALS.clipLoudnessNotBuilt.message()); }
  });
  it('MCP measure_clip_loudness answers the same honest state', async () => {
    const pid = seed('cl-mcp');
    const r = await tool('measure_clip_loudness', { projectId: pid, clipIds: ['clp_x'] }, auth.tokens.agent);
    if (!CLIP_LOUDNESS_BUILT) { expect(r.isError).toBe(true); expect(r.text).toContain('not_built'); }
  });
  it('a target size: older options parse unchanged; out-of-range targets are 400; until built the plan blocks with size_fit_not_built', async () => {
    expect('sizeFit' in ExportOptionsSchema.parse({})).toBe(false);
    expect(ExportOptionsSchema.safeParse({ sizeFit: { targetBytes: 999_999 } }).success).toBe(false);
    expect(ExportOptionsSchema.safeParse({ sizeFit: { targetBytes: 16_000_000, extra: 1 } }).success).toBe(false);
    const pid = seed('fit');
    const plan = await rest('POST', `/projects/${pid}/exports/plan`, { sizeFit: { targetBytes: 16_000_000 } }, auth.tokens.agent);
    if (!SIZE_FIT_BUILT) expect(plan.body.blockers.map((b: { code: string }) => b.code)).toContain('size_fit_not_built');
  });
  it('the browser route refuses a target size and a project with a master limiter (409 unsupported_in_browser_export)', async () => {
    const pid = seed('br');
    const a = await rest('POST', `/projects/${pid}/exports/browser`, { sessionId: 'session-1234', sizeFit: { targetBytes: 16_000_000 } }, auth.tokens.agent);
    expect([a.status, a.body.error.code]).toEqual([409, 'unsupported_in_browser_export']);
    store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'set_master_limiter', args: { ceiling: -1 } }] });
    const b = await rest('POST', `/projects/${pid}/exports/browser`, { sessionId: 'session-1234' }, auth.tokens.agent);
    expect([b.status, b.body.error.code, b.body.error.message]).toEqual([409, 'unsupported_in_browser_export', SEND_API_REFUSALS.browserRoute.message()]);
  });
  it('programmeLoudness lives in its own file and http.ts re-exports the same function; the new surfaces are classified for the people walk', () => {
    expect(fromHttp).toBe(programmeLoudness);
    expect(PEOPLE_REST_SURFACES['POST /api/v1/projects/:id/analysis/clip-loudness']).toEqual(['reader-document']);
    expect(PEOPLE_MCP_TOOLS.measure_clip_loudness).toEqual(['reader-document']);
    expect(exporter.fitFault).toBeNull();
  });
});
