/**
 * «גדלים מול העיניים» on the server (wave 8 growing pre-pass), through the real app and the real MCP handler:
 * - every growing call (plan, apply, rebuild through both regenerate routes, and the three MCP recipe tools) answers 403
 *   owner_required to every agent credential (the bootstrap agent token, an edit grant with people 'full', a propose grant), and
 *   nothing is committed;
 * - the owner's own session gets 501 growing_not_built while GROWING_SERVER_BUILT is false (W2 replaces those rows);
 * - THE EYES ARE REQUEST DATA ONLY (verifier C8): a planted coordinate sent in every request appears in no stored document, no
 *   event (the outbox and eventsSince), no transaction record, no entity version and no summary, whatever the calls answered. This
 *   row stays when W2 builds the bodies: it is the privacy rule.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { GROWING, GROWING_TEMPLATE_ID, GROWING_VERSION, growingPickKey, growingRunRecordParams } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { GROWING_SERVER_BUILT } from './growing.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const PLANTED = 0.123457;
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', fullGrant = '', proposeGrant = '', pid = '', runId = '', stillIds: string[] = [], videoId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const AGENTS: [string, Who][] = [['the agent token', bearer(() => auth.tokens.agent)], ['an edit grant with people full', bearer(() => fullGrant)], ['a propose grant', bearer(() => proposeGrant)]];
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? ((await r.json()) as any) : null };
};
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return { isError: !!msg.result?.isError, text: String(msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg)) };
}
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const params = () => ({
  picks: [
    { assetId: stillIds[0], frame: null, eyes: [{ u: PLANTED, v: 0.41 }, { u: 0.62, v: PLANTED }] },
    { assetId: stillIds[1], frame: null, eyes: [{ u: 0.3, v: PLANTED }, { u: PLANTED + 0.5, v: 0.4 }] },
    { assetId: videoId, frame: 12, eyes: [{ u: PLANTED, v: PLANTED }, { u: 0.7, v: 0.5 }] },
  ],
  holdFrames: 30, dissolve: 'short', caption: { date: true, age: false },
});
const calls = () => [
  ['POST', `/api/v1/projects/${pid}/recipes/growing/plan`, { params: params() }],
  ['POST', `/api/v1/projects/${pid}/recipes/growing/apply`, { params: params() }],
  ['POST', `/api/v1/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: params(), restoreRemoved: true }],
  ['POST', `/api/v1/projects/${pid}/template-runs/${runId}/regenerate`, { params: params(), restoreRemoved: true }],
] as const;
const revision = () => store.getProject(pid).revision;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-growing-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 29, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  pid = store.createProject({ name: 'growing', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const still = (k: number) => ({ kind: 'image', name: `p${k}.jpg`, contentHash: `sha256:${String(k).repeat(64)}`, byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 480, height: 640, codec: 'mjpeg', hasAlpha: false }, provenance: prov });
  const video = { kind: 'video', name: 'v.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(2, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 60 }, provenance: prov };
  const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [still(1), still(2), video].map((asset) => ({ op: 'import_asset', args: { asset } })) });
  [stillIds[0], stillIds[1], videoId] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  // a growing run as apply would record it (its params are growingRunRecordParams: no coordinate), so the rebuild routes have a run
  const record = growingRunRecordParams({ sort: 'capture', holdFrames: 30, dissolve: 'short', faceSize: GROWING.faceSize.default, eyeLine: GROWING.eyeLine.default, fill: 'colour', caption: null, personId: null, at: T.ZERO }, stillIds.map((assetId) => ({ key: growingPickKey(assetId, null), assetId, frame: null })));
  const run = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: record, steps: ['Place the pictures'], ops: [{ op: 'add_clip', args: { assetId: stillIds[0], start: T.ZERO, duration: T.rt(1, 1) }, bind: 'p0' }], slots: [{ key: growingPickKey(stillIds[0]!, null), kind: 'picture', clipId: { $ref: 'p0' } }], recordRanges: true } }] });
  runId = run.results[0]!.output!.runId as string;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('growing: owner\'s own session only', () => {
  for (const [name, who] of AGENTS) {
    it(`${name}: plan, apply and both rebuild routes answer 403 owner_required; nothing is committed`, async () => {
      const before = revision();
      for (const [method, url, body] of calls()) {
        const r = await rest(who, method, url, body);
        expect([url, r.status, r.body?.error?.code ?? r.body?.code]).toEqual([url, 403, 'owner_required']);
      }
      expect(revision()).toBe(before);
    });
    it(`${name}: the MCP recipe tools are refused owner_required`, async () => {
      for (const [toolName, args] of [['plan_recipe', { projectId: pid, recipeId: 'growing', params: params() }], ['apply_recipe', { projectId: pid, recipeId: 'growing', params: params() }], ['regenerate_recipe', { projectId: pid, runId, params: params() }]] as const) {
        const r = await tool(who, toolName, args as Record<string, unknown>);
        expect([toolName, r.isError]).toEqual([toolName, true]);
        expect(r.text).toContain('owner_required');
      }
    });
  }
  it('the owner\'s session gets 501 growing_not_built until W2 builds the bodies, and nothing is committed', async () => {
    if (GROWING_SERVER_BUILT) return;
    const before = revision();
    for (const [method, url, body] of calls()) {
      const r = await rest(owner, method, url, body);
      expect([url, r.status, r.body?.error?.code ?? r.body?.code]).toEqual([url, 501, 'growing_not_built']);
    }
    expect(revision()).toBe(before);
  });
});

describe('growing: the eye marks are request data only (verifier C8)', () => {
  it('after every call by everyone, the planted coordinate is in no stored document, event, transaction, entity version or summary', async () => {
    for (const [, who] of [...AGENTS, ['owner', owner] as [string, Who]]) for (const [method, url, body] of calls()) await rest(who, method, url, body);
    const planted = String(PLANTED);
    const tables = ['projects', 'transactions', 'outbox', 'entity_versions'] as const;
    for (const t of tables) {
      const rows = store.db.prepare(`SELECT * FROM ${t}`).all();
      expect(rows.length, t).toBeGreaterThan(0);
      expect(JSON.stringify(rows).includes(planted), t).toBe(false);
    }
    expect(JSON.stringify(store.getProject(pid).doc)).not.toContain(planted);
    expect(JSON.stringify(store.eventsSince(pid, 0))).not.toContain(planted);
    const summary = await rest(owner, 'GET', `/api/v1/projects/${pid}/summary`);
    expect(summary.status).toBe(200);
    expect(JSON.stringify(summary.body)).not.toContain(planted);
    // the run record holds picks and settings, never a coordinate
    expect(Object.keys(store.getProject(pid).doc.recipeRuns[runId]!.params).sort()).toEqual(['at', 'caption', 'dissolve', 'eyeLine', 'faceSize', 'fill', 'holdFrames', 'picked', 'sort', 'templateVersion']);
  });
});

// W2 (growing server bodies) makes these pass; named after the plan's checks
describe('growing server (W2)', () => {
  it.todo('plan: the view has no ops and its params are the run record (no eyes); warnings and exclusions in words');
  it.todo('apply: ONE apply_template with recordRanges against the plan\'s revision; one undo restores the document hash (G12)');
  it.todo('rebuild: an untouched pick keeps its eyes through eyesFromTransform; a hand-rotated pick is kept exactly; a moved pick goes back (moved_back); a deleted pick stays out, and with restoreRemoved comes back only with eyes in the request, else needs_marks (G13, C8)');
  it.todo('a stale expectedRevision is 409 and nothing is committed');
});
