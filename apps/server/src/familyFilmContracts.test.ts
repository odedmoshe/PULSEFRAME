/**
 * Lead contracts of the family film on the server (ADR-0026): the derivative kind 'moments' and Derivatives.put, the routes and
 * tools the lead wired (POST /projects/:id/moments, measure_moments, the cancel branch, the recipe routes' dispatch of
 * 'family-film' and of film runs), the refusals that come BEFORE any planning or measuring (permission, propose mode, limited
 * grants, an age field from a credential without the people scope) and the planner's context built from the life line.
 * What the planner and the measurement do is W1's and W2's; nothing here pins their stubs (their success paths are todo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { FAMILY_FILM_RUN_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, MOMENTS_JOB_TYPE, type Asset } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { filmContext, holdsAgeField } from './familyFilm.ts';
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-film-contracts-'));
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

describe('the moments derivative', () => {
  it('put() stores a file as a ready row of kind moments, served by the derivative route; the queue\'s kinds are refused', async () => {
    const s = seed('deriv');
    const asset = store.getProject(s.pid).doc.assets[s.ids[0]!]!;
    const tmp = path.join(store.tmpDir, `mo_${n++}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ algo: 1 }));
    const row = await derivatives.put(asset.contentHash, 'moments', tmp, 'application/json', { algo: 1, picture: 'proxy', sound: true, samples: 50, hops: 100, truncated: false });
    expect(row).toMatchObject({ kind: 'moments', status: 'ready', mimeType: 'application/json', meta: { algo: 1, sound: true } });
    expect(fs.existsSync(tmp)).toBe(false);
    const got = await rest('GET', `/projects/${s.pid}/assets/${asset.id}/derivatives/moments`, undefined, auth.tokens.agent);
    expect(got.status).toBe(200);
    expect(JSON.parse(got.raw)).toEqual({ algo: 1 });
    fs.writeFileSync(tmp, 'x');
    await expect(derivatives.put(asset.contentHash, 'proxy', tmp, 'video/mp4', {})).rejects.toThrow(/made by the queue/);
    // importing never queues it: a fresh file gets the three queued kinds only, and ensure() leaves the stored moments row as it is
    const other = store.getProject(s.pid).doc.assets[s.ids[1]!]!;
    expect(derivatives.ensure(other).map((r) => r.kind).sort()).toEqual(['proxy', 'thumbnails', 'waveform']);
    derivatives.ensure(asset);
    expect(derivatives.get(asset.contentHash, 'moments')?.status).toBe('ready');
  });
});

describe('measuring moments: route, tool and cancel (wired by the lead)', () => {
  it('refuses an observe-only credential and a track-limited grant before anything runs; a bad body is 400', async () => {
    const s = seed('mo-perm');
    const before = revision(s.pid);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids }, auth.tokens.observer)).status).toBe(403);
    const limited = grant({ mode: 'edit', trackIds: ['trk_none'] });
    const r = await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids }, limited);
    expect([r.status, r.body.error?.code]).toEqual([403, 'out_of_scope']);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: [] }, auth.tokens.agent)).status).toBe(400);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids, extra: 1 }, auth.tokens.agent)).status).toBe(400);
    const t = await tool('measure_moments', { projectId: s.pid, assetIds: s.ids }, limited);
    expect(t.isError).toBe(true);
    expect(revision(s.pid)).toBe(before);
    expect(store.openJobs(MOMENTS_JOB_TYPE)).toEqual([]);
  });
  it('cancel_job and POST /jobs/:id/cancel reach a moments job', async () => {
    const s = seed('mo-cancel');
    const a = store.createJob(s.pid, MOMENTS_JOB_TYPE, 'agent:local', { assetIds: s.ids, projectRevision: revision(s.pid) });
    const r = await rest('POST', `/jobs/${a.id}/cancel`, undefined, auth.tokens.agent);
    expect(r.status).toBe(200);
    expect(store.getJob(a.id).status).toBe('canceled');
    const b = store.createJob(s.pid, MOMENTS_JOB_TYPE, 'agent:local', { assetIds: s.ids, projectRevision: revision(s.pid) });
    const t = await tool('cancel_job', { jobId: b.id }, auth.tokens.agent);
    expect(t.isError).toBe(false);
    expect(store.getJob(b.id).status).toBe('canceled');
  });
  it.todo('W2: a measurement runs as a durable job and attaches one revision (moments.test.ts)');
});

describe('the family film through the recipe routes and tools', () => {
  const params = (ids: string[], extra: Record<string, unknown> = {}) => ({ params: { assetIds: ids, ...extra } });
  it('refuses a propose-mode agent and a limited grant at apply (REST and MCP) before planning; nothing changes', async () => {
    const s = seed('ff-perm');
    const before = revision(s.pid);
    const propose = grant({ mode: 'propose' });
    const pr = await rest('POST', `/projects/${s.pid}/recipes/family-film/apply`, params(s.ids), propose);
    expect([pr.status, pr.body.error?.code]).toEqual([403, 'insufficient_scope']);
    expect(pr.body.error.message).toMatch(/a family film cannot be proposed/);
    const limited = grant({ mode: 'edit', trackIds: ['trk_none'] });
    const lr = await rest('POST', `/projects/${s.pid}/recipes/family-film/apply`, params(s.ids), limited);
    expect([lr.status, lr.body.error?.code]).toEqual([403, 'out_of_scope']);
    const pt = await tool('apply_recipe', { projectId: s.pid, recipeId: 'family-film', params: params(s.ids).params }, propose);
    expect(pt.isError).toBe(true);
    expect(revision(s.pid)).toBe(before);
  });
  it('an agent without the people scope cannot plan, apply or regenerate a film whose title shows an age; {name:…} is not refused for that reason', async () => {
    const s = seed('ff-ages');
    for (const [route, body] of [['plan', params(s.ids, { openingText: 'גיל {age:p1}' })], ['apply', params(s.ids, { closingText: '{age:p1:words}' })]] as const) {
      const r = await rest('POST', `/projects/${s.pid}/recipes/family-film/${route}`, body, auth.tokens.agent);
      expect([route, r.status, r.body.error?.code]).toEqual([route, 403, 'people_scope_required']);
    }
    const t = await tool('plan_recipe', { projectId: s.pid, recipeId: 'family-film', params: { assetIds: s.ids, openingText: '{age:p1}' } }, auth.tokens.agent);
    expect(t.isError).toBe(true);
    expect(JSON.stringify(t.body)).toMatch(/people_scope_required/);
    const named = await rest('POST', `/projects/${s.pid}/recipes/family-film/plan`, params(s.ids, { openingText: 'יום ההולדת של {name:p1}' }), auth.tokens.agent);
    expect(named.body?.error?.code).not.toBe('people_scope_required');
    expect(holdsAgeField('{age:p1}')).toBe(true);
    expect(holdsAgeField('{{age:p1}}')).toBe(false);
    expect(holdsAgeField('{name:p1} {hebrewDate}')).toBe(false);
  });
  it('a film run is regenerated by the film path, through the recipe route and the template route', async () => {
    const s = seed('ff-run');
    const r = store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params: { assetIds: s.ids, picked: [] }, steps: ['A title'], ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.rt(2, 1) }, bind: 'title' }], slots: [{ key: 'title', kind: 'text', clipId: { $ref: 'title' } }] } }] });
    const runId = r.results[0]!.output!.runId as string;
    expect(store.getProject(s.pid).doc.recipeRuns[runId]!.recipeId).toBe(FAMILY_FILM_RUN_RECIPE_ID);
    const propose = grant({ mode: 'propose' });
    for (const p of [`/projects/${s.pid}/recipe-runs/${runId}/regenerate`, `/projects/${s.pid}/template-runs/${runId}/regenerate`]) {
      const x = await rest('POST', p, { params: { targetSeconds: 30 } }, propose);
      expect([p, x.status, x.body.error?.code]).toEqual([p, 403, 'insufficient_scope']);
    }
    const bad = await rest('POST', `/projects/${s.pid}/recipe-runs/${runId}/regenerate`, { params: { openingText: '{age:p1}' } }, auth.tokens.agent);
    expect([bad.status, bad.body.error?.code]).toEqual([403, 'people_scope_required']);
    expect((await rest('POST', `/projects/${s.pid}/recipe-runs/run_none/regenerate`, {}, auth.tokens.agent)).status).toBe(404);
  });
  it.todo('W1 + lead: plan, apply as one revision and regenerate a film end to end (after the planner is built)');
});

describe('the planner context from the life line (filmContext)', () => {
  it('capture times by own property; live titles only when every file is dated; fixed text otherwise', () => {
    const s = seed('ctx', ['2026-12-05T18:00:00', '2026-12-05']);
    const doc = store.getProject(s.pid).doc;
    const ctx = filmContext(doc, { assetIds: [...s.ids, '__proto__', 'ast_none'], event: { name: 'חנוכה' } });
    expect(Object.keys(ctx.capture)).toEqual(s.ids);
    expect(ctx.capture[s.ids[0]!]).toBe('2026-12-05T18:00:00');
    expect(ctx.capture[s.ids[1]!]).toBe('2026-12-05');
    expect(ctx.title).toEqual({ text: 'חנוכה · {hebrewDate}', live: true, resolved: null });
    expect(ctx.closing).toEqual({ text: 'סוף', live: false, resolved: null });
    const partly = seed('ctx2', ['2026-12-05T18:00:00', undefined]);
    const c2 = filmContext(store.getProject(partly.pid).doc, { assetIds: partly.ids, lang: 'en' });
    expect(c2.title).toEqual({ text: 'Our film', live: false, resolved: null });
    expect(c2.capture[partly.ids[1]!]).toBeNull();
    expect(filmContext(doc, { assetIds: s.ids, openingTitle: false, closingCard: false })).toMatchObject({ title: null, closing: null });
    expect(filmContext(doc, { assetIds: s.ids, openingText: 'שלום {hebrewDate}' }).title).toEqual({ text: 'שלום {hebrewDate}', live: true, resolved: null });
    expect(filmContext(doc, { assetIds: s.ids, openingText: 'שלום' }).title).toEqual({ text: 'שלום', live: false, resolved: null });
    expect(() => filmContext(doc, { assetIds: s.ids, openingText: 'שלום {nope}' })).toThrow(/brace groups that are not fields: \{nope\}/);
  });
});
