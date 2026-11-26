/**
 * The made routes and MCP tools (made/routes.ts, W2) against a LABELLED FAKE runner (job rows in the real store; no browser, nothing is
 * drawn): the order of checks (scope → project → who may act → body → capacity → runner), the page kept as a blob named by its sha256,
 * submit_made_clip and view_made_clip over MCP sharing the routes' service (three images to the submitter, made_not_yours to another
 * agent), and the resource pulseframe://made/contract built from the core tables.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MADE_JOB_TYPE, MADE_LIMITS, type MadeJobReport } from '@pulseframe/core';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { madeContractText } from '../mcpResources.ts';
import { Presence } from '../presence.ts';
import { Store } from '../store.ts';
import { madeError, MADE_MCP_RESOURCE, type MadeRunner } from './contract.ts';

const OWNER = { actor: 'user:local', kind: 'user' as const, scopes: ['observe', 'edit'] as ('observe' | 'edit')[] };
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities;
let pid = '', other = '';
const tokens: Record<string, string> = {};
const started: string[] = [];
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const as = (t: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t()}`, 'content-type': 'application/json' });
const a = as(() => tokens.a!), b = as(() => tokens.b!), proposer = as(() => tokens.proposer!), narrow = as(() => tokens.narrow!), observer = as(() => auth.tokens.observer);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
}

/** LABELLED FAKE runner: start records a running job row; finish() marks it succeeded; stills are 8 fake bytes. */
const fake: MadeRunner & { finish(jobId: string): void } = {
  async start(p, projectId) { const j = store.createJob(projectId, MADE_JOB_TYPE, p.actor, { FAKE: true }); store.updateJob(j.id, { status: 'running' }); started.push(j.id); return { jobId: j.id }; },
  report(_p, projectId, jobId) { const j = store.getJob(jobId); if (j.projectId !== projectId) throw madeError('jobNotFound', { jobId }); return { jobId, status: j.status, stage: 'done', progress: null, submittedBy: j.actor, warnings: [] } as MadeJobReport; },
  still() { return { png: Buffer.from('FAKE-PNG') }; },
  file() { throw madeError('notBuilt'); },
  async apply() { throw madeError('notBuilt'); },
  dismiss() { /* fake */ },
  finish(jobId) { store.updateJob(jobId, { status: 'succeeded', output: { FAKE: true } }); },
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-made-routes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  capabilities = new Capabilities(store, cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), new Presence(), mcp, gov, undefined, undefined, { made: fake });
  pid = store.createProject({ name: 'made routes' }).doc.id;
  other = store.createProject({ name: 'other' }).doc.id;
  tokens.a = gov.createGrant({ name: 'a', mode: 'edit' }, OWNER).token;
  tokens.b = gov.createGrant({ name: 'b', mode: 'edit' }, OWNER).token;
  tokens.proposer = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  tokens.narrow = gov.createGrant({ name: 'narrow', mode: 'edit', projectIds: [other] }, OWNER).token;
});
afterAll(async () => { await mcp.close(); await capabilities.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const finishAll = () => { for (const j of started.splice(0)) if (store.getJob(j).status === 'running') fake.finish(j); };

describe('the order of checks: scope → project → who may act → body', () => {
  it('an observer with a broken body is refused for its scope, not its body', async () => {
    expect((await rest(observer, 'POST', `/api/v1/projects/${pid}/made/render`, 'not json')).status).toBe(403);
  });
  it('an unknown project answers 404 before the body is read; a grant for another project answers out_of_scope', async () => {
    expect((await rest(a, 'POST', '/api/v1/projects/prj_none/made/render', 'not json')).status).toBe(404);
    expect((await rest(narrow, 'POST', `/api/v1/projects/${pid}/made/render`, 'not json')).body.error.code).toBe('out_of_scope');
  });
  it('a credential that may only propose cannot render (governance \'job\'), before its body is read', async () => {
    const r = await rest(proposer, 'POST', `/api/v1/projects/${pid}/made/render`, 'not json');
    expect({ status: r.status, code: r.body.error.code }).toEqual({ status: 403, code: 'insufficient_scope' });
  });
  it('a body that is not JSON, an unknown key, an unknown built-in page, values that do not fit and files not in the project are 400 with what to fix', async () => {
    const r = (body: unknown) => rest(a, 'POST', `/api/v1/projects/${pid}/made/render`, body);
    expect((await r('not json')).body.error.code).toBe('invalid_request');
    expect((await r({ page: '<p>x</p>', seconds: 1, name: 'x', extra: 1 })).status).toBe(400);
    expect((await r({ page: { templateId: 'no-such-page' }, seconds: 1, name: 'x' })).body.error.details.templates).toContain('rising-title');
    expect((await r({ page: { templateId: 'counter' }, seconds: 1, name: 'x', values: { from: 'many', colour: 'red' } })).body.error.details.fields).toEqual([{ key: 'from', why: 'number' }, { key: 'colour', why: 'colour' }]);
    expect((await r({ page: '<p>x</p>', seconds: 1, name: 'x', assetIds: ['ast_none'] })).body.error.details.assetIds).toEqual(['ast_none']);
    expect(started).toEqual([]);
  });
});

describe('the page is kept as a blob named by its sha256', () => {
  it('a pasted page is stored as text/html before the runner starts; the 422 carries every problem and the warnings at once', async () => {
    const html = `<canvas></canvas><script>PF.render = (f) => { /* ${'שלום'} */ };</script>`;
    const r = await rest(a, 'POST', `/api/v1/projects/${pid}/made/render`, { page: html, seconds: 1, name: 'x' });
    expect(r.status).toBe(202);
    const hex = createHash('sha256').update(html, 'utf8').digest('hex');
    expect(fs.readFileSync(store.blobPath(`sha256:${hex}`), 'utf8')).toBe(html);
    finishAll();
    const bad = await rest(a, 'POST', `/api/v1/projects/${pid}/made/render`, { page: `﻿x\u0000y�<script>fetch(1)</script>`, seconds: 1, name: 'x' });
    expect(bad.body.error.details).toMatchObject({ problems: [{ what: 'nul', at: 2 }, { what: 'not_utf8', at: 4 }], warnings: [{ what: 'fetch', at: 13 }] });
    expect(started).toEqual([]);
  });
});

describe('MCP: submit_made_clip and view_made_clip share the routes\' service', () => {
  it('submit answers jobId and warnings; view gives the report and three images to the submitter once done, made_not_yours to another agent', async () => {
    const s = await rpc(a, 'tools/call', { name: 'submit_made_clip', arguments: { projectId: pid, page: '<script>PF.render = () => Math.random();</script>', seconds: 1, name: 'm' } });
    const out = JSON.parse(s.result.content[0].text);
    expect(out.warnings.map((w: { what: string }) => w.what)).toEqual(['Math.random']);
    const running = await rpc(a, 'tools/call', { name: 'view_made_clip', arguments: { projectId: pid, jobId: out.jobId } });
    expect(running.result.content.map((c: { type: string }) => c.type)).toEqual(['text']);
    fake.finish(out.jobId); started.splice(0);
    const v = await rpc(a, 'tools/call', { name: 'view_made_clip', arguments: { projectId: pid, jobId: out.jobId } });
    expect(v.result.content.map((c: { type: string }) => c.type)).toEqual(['text', 'image', 'image', 'image']);
    expect(Buffer.from(v.result.content[1].data, 'base64').toString()).toBe('FAKE-PNG');
    const nope = await rpc(b, 'tools/call', { name: 'view_made_clip', arguments: { projectId: pid, jobId: out.jobId } });
    expect(nope.result.isError).toBe(true);
    expect(nope.result.content[0].text).toContain('made_not_yours');
    const obs = await rpc(observer, 'tools/call', { name: 'submit_made_clip', arguments: { projectId: pid, page: { templateId: 'counter' }, seconds: 1, name: 'm' } });
    expect(obs.result.isError).toBe(true);
  });
  it('the resource pulseframe://made/contract is the page contract from the core tables', async () => {
    const r = await rpc(a, 'resources/read', { uri: MADE_MCP_RESOURCE });
    const text = r.result.contents[0].text as string;
    expect(r.result.contents[0].mimeType).toBe('text/markdown');
    expect(text).toBe(madeContractText());
    expect(text).toContain(`${MADE_LIMITS.pageBytes} UTF-8 bytes`);
    for (const id of ['rising-title', 'lower-third', 'counter', 'intro-plate', 'end-card', 'made_flash', 'made_frame_timeout', 'PF.render']) expect(text).toContain(id);
    expect(text).not.toMatch(/\bsafe\b|verified/i);
  });
});
