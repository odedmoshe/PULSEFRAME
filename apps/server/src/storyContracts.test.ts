/**
 * Lead contracts of the story track on the server (wave 7; .artifacts/wave7/story-decisions.md §4): the recipe routes and tools
 * dispatch 'story' and 'template:tpl.story' runs to story.ts; the refusals that come BEFORE planning (propose mode, limited grants,
 * an age field without the people scope) answer as decided (the rows that ran only until W1/W2 were built were removed at
 * integration). Also the route fix of this pre-pass: the recipe regenerate route passes expectedRevision.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { FAMILY_FILM_TEMPLATE_ID, type Asset } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
let n = 1;
const hash = () => `sha256:${(n++).toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00.000Z', importedBy: 'test' };
const video = (name: string, capture?: string): Omit<Asset, 'id'> => ({ kind: 'video', name, contentHash: hash(), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov, ...(capture ? { capture: { at: capture, utcOffsetMinutes: null, source: 'manual' } } : {}) } as Omit<Asset, 'id'>);

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t: string) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, raw: text };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;
const revision = (pid: string) => store.getProject(pid).revision;

function seed(name: string, captures: (string | undefined)[] = ['2026-12-05T18:00:00', '2026-12-05T18:10:00']) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: captures.map((c, i) => ({ op: 'import_asset', args: { asset: video(`v${i}.mp4`, c) } })) });
  return { pid, ids: r.results.map((x) => x.output!.assetId as string) };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-story-contracts-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  gov = new Governance(store);
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


const editor = () => grant({ mode: 'edit' });
const sound = (name: string): Omit<Asset, 'id'> => ({ kind: 'audio', name, contentHash: hash(), byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov } as Omit<Asset, 'id'>);
function seedStory(name: string) {
  const s = seed(name);
  const r = store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: sound('קריינות.wav') } }] });
  return { ...s, narration: r.results[0]!.output!.assetId as string };
}
const titleRun = (pid: string, templateId: string, params: Record<string, unknown>) => {
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId, templateVersion: 1, params, steps: ['A title'], ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.rt(2, 1) }, bind: 'title' }], slots: [{ key: 'title', kind: 'text', clipId: { $ref: 'title' } }] } }] });
  return r.results[0]!.output!.runId as string;
};

describe('the story through the recipe routes and tools (lead)', () => {
  const body = (s: { ids: string[]; narration: string }, extra: Record<string, unknown> = {}) => ({ params: { narrationAssetId: s.narration, assetIds: s.ids, cutsMs: [1500], ...extra } });
  it('refuses a propose-mode agent and a limited grant at apply (REST and MCP) before planning; nothing changes', async () => {
    const s = seedStory('st-perm');
    const before = revision(s.pid);
    const propose = grant({ mode: 'propose' });
    const pr = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, body(s), propose);
    expect([pr.status, pr.body.error?.code]).toEqual([403, 'insufficient_scope']);
    expect(pr.body.error.message).toMatch(/a story cannot be proposed/);
    const lr = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, body(s), grant({ mode: 'edit', trackIds: ['trk_none'] }));
    expect([lr.status, lr.body.error?.code]).toEqual([403, 'out_of_scope']);
    const pt = await tool('apply_recipe', { projectId: s.pid, recipeId: 'story', params: body(s).params }, propose);
    expect(pt.isError).toBe(true);
    expect(revision(s.pid)).toBe(before);
  });
  it('an agent without the people scope cannot plan or apply a story whose title shows an age', async () => {
    const s = seedStory('st-ages');
    for (const route of ['plan', 'apply']) {
      const r = await rest('POST', `/projects/${s.pid}/recipes/story/${route}`, body(s, { openingText: 'גיל {age:p1}' }), auth.tokens.agent);
      expect([route, r.status, r.body.error?.code]).toEqual([route, 403, 'people_scope_required']);
    }
  });
});

describe('the recipe regenerate route passes expectedRevision (pre-pass fix)', () => {
  it('a film run regenerated against a stale revision is refused 409 and nothing changes; against the current one it goes ahead', async () => {
    const s = seed('st-rev');
    const runId = titleRun(s.pid, FAMILY_FILM_TEMPLATE_ID, { assetIds: s.ids, picked: [], openingTitle: true, closingCard: false });
    const now = revision(s.pid);
    const stale = await rest('POST', `/projects/${s.pid}/recipe-runs/${runId}/regenerate`, { expectedRevision: now - 1 }, editor());
    expect(stale.status).toBe(409);
    expect(revision(s.pid)).toBe(now);
    const fresh = await rest('POST', `/projects/${s.pid}/recipe-runs/${runId}/regenerate`, { expectedRevision: now }, editor());
    expect([fresh.status, fresh.body?.error?.code]).toEqual([200, undefined]);
    expect(revision(s.pid)).toBe(now + 1);
  });
});
