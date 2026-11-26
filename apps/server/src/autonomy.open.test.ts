/**
 * Autonomy, the swapped policy sites in BOTH modes over REST (autonomy.ts; verifier C14): the same call with the built-in agent
 * token answers today's refusal in `guarded` and gets past the gate in `open` (it may then meet an honest setup state such as
 * 404 or 409, never an owner refusal). The existing refusal tests stay as they are and run in guarded (vitest.config.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IMAGE_UPSCALE, LOCAL_TOOLS, SMOKE_SOLID_IMAGE, type CapabilityDescriptor, type ComfyDescriptor, type LocalToolDescriptor, type ProviderAdapter } from '@pulseframe/providers';
import { AssistantFiles } from './assistant/credential.ts';
import { assistantSetup } from './assistant/job.ts';
import { libraryExportWarnings } from './export.ts';
import { ingestUpload } from './ingest.ts';
import { FifoComputeLane } from './lane.ts';
import { LocalTools } from './localtools.ts';
import { createSearchRuntime } from './search/runtime.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { startServer, type RunningServer } from './index.ts';
import { ModelStore } from './models.ts';
import { ApiError, Store } from './store.ts';

const OWNER_REFUSALS = ['owner_required', 'human_approval_required', 'lesson_owner_only', 'human_tag_required', 'people_scope_required', 'version_privacy_changed', 'not_your_job'];
const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

export type Case = { family: string; id: string; method: string; path: string; body?: unknown; guarded: string };
/** {pid} is a project the agent itself created. */
export const FAMILY_A: Case[] = [
  { family: 'A', id: 'A19 grants list', method: 'GET', path: '/api/v1/grants', guarded: 'owner_required' },
  { family: 'A', id: 'A19 backup now', method: 'POST', path: '/api/v1/backup', body: {}, guarded: 'owner_required' },
  { family: 'A', id: 'A19 on this day', method: 'GET', path: '/api/v1/on-this-day', guarded: 'owner_required' },
  { family: 'A', id: 'A19 people suggestions', method: 'GET', path: '/api/v1/people-suggestions', guarded: 'owner_required' },
  { family: 'A', id: 'A19 family check', method: 'GET', path: '/api/v1/projects/{pid}/archive/family-check', guarded: 'owner_required' },
  { family: 'A', id: 'A20 storage gc', method: 'POST', path: '/api/v1/storage/gc', body: { apply: false }, guarded: 'owner_required' },
  { family: 'A', id: 'A20 render cache clear', method: 'DELETE', path: '/api/v1/storage/render-cache', guarded: 'owner_required' },
  { family: 'A', id: 'A18 library folder', method: 'PUT', path: '/api/v1/library/root', body: { root: null }, guarded: 'owner_required' },
  { family: 'A', id: 'A16 booth', method: 'GET', path: '/api/v1/booth', guarded: 'owner_required' },
  { family: 'A', id: 'A17 own template preview', method: 'POST', path: '/api/v1/projects/{pid}/own-templates/preview', body: {}, guarded: 'owner_required' },
  { family: 'A', id: 'A17 search index', method: 'GET', path: '/api/v1/projects/{pid}/search/index', guarded: 'owner_required' },
  { family: 'A', id: 'A17 eyes', method: 'POST', path: '/api/v1/projects/{pid}/eyes/propose', body: {}, guarded: 'owner_required' },
  { family: 'A', id: 'A21 speech engine', method: 'GET', path: '/api/v1/speech/engine', guarded: 'owner_required' },
  { family: 'A', id: 'A14 version rename', method: 'PUT', path: '/api/v1/projects/{pid}/versions/ver_none', body: { name: 'x' }, guarded: 'owner_required' },
  { family: 'A', id: 'A14 version delete', method: 'DELETE', path: '/api/v1/projects/{pid}/versions/ver_none', guarded: 'owner_required' },
  { family: 'A', id: 'A13 lesson of a clip', method: 'GET', path: '/api/v1/projects/{pid}/clips/clip_none/lesson', guarded: 'owner_required' },
];

export async function modeServer(mode: 'open' | 'guarded') {
  const s = await startServer({ port: 0, dataDir: tmp(`pf-auto-${mode}-`), mode, modeFromEnv: true, libraryDir: null, backupDir: null });
  const call = async (method: string, p: string, body?: unknown, token = s.auth.tokens.agent) => {
    const r = await fetch(`${s.url}${p}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json, code: json?.error?.code as string | undefined };
  };
  const created = await call('POST', '/api/v1/projects', { name: 'autonomy' });
  const pid = created.json?.project?.id ?? created.json?.id;
  return { s, call, pid: pid as string };
}

export function bothModes(cases: Case[]) {
  for (const mode of ['guarded', 'open'] as const)
    describe(`${mode} mode`, () => {
      let m: Awaited<ReturnType<typeof modeServer>>;
      beforeAll(async () => { m = await modeServer(mode); }, 60_000);
      afterAll(async () => { await m?.s.close(); });
      it('the agent created its project', () => { expect(m.pid).toMatch(/\w+/); });
      for (const c of cases)
        it(`${c.id}: ${mode === 'guarded' ? `refused ${c.guarded} (today)` : 'gets past the gate'}`, async () => {
          const r = await m.call(c.method, c.path.replace('{pid}', m.pid), c.body);
          if (mode === 'guarded') { expect(r.status, JSON.stringify(r.json)).toBe(403); expect(r.code).toBe(c.guarded); }
          else { expect(OWNER_REFUSALS, `${r.status} ${JSON.stringify(r.json)}`).not.toContain(r.code); expect(r.status).not.toBe(403); }
        });
    });
}

describe('family A — who may act', () => { bothModes(FAMILY_A); });

/** The owner's own browser session (the launch secret plus an allowed Origin), as the editor gets it. */
export async function ownerCall(s: RunningServer) {
  const r = await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, 'x-pf-owner-key': s.auth.tokens.owner, connection: 'close' } });
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]!;
  return async (method: string, p: string, body?: unknown) => {
    const x = await fetch(`${s.url}${p}`, { method, headers: { cookie, origin: s.url, 'content-type': 'application/json', connection: 'close' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: x.status, json: await x.json().catch(() => null) as any };
  };
}

describe('family A — undo anyone\'s edit (A9), in both modes', () => {
  for (const mode of ['guarded', 'open'] as const)
    it(`${mode}: the agent undoes the owner's transaction by id ${mode === 'guarded' ? 'is refused (today)' : 'and it is undone (one undo transaction, undoable again)'}`, async () => {
      const m = await modeServer(mode);
      try {
        const owner = await ownerCall(m.s);
        const tx = await owner('POST', `/api/v1/projects/${m.pid}/transactions`, { ops: [{ op: 'add_track', args: { kind: 'video', name: 'owner track' } }] });
        expect(tx.status, JSON.stringify(tx.json)).toBe(200);
        const r = await m.call('POST', `/api/v1/projects/${m.pid}/undo`, { transactionId: tx.json.transactionId });
        if (mode === 'guarded') expect(r.status).toBeGreaterThanOrEqual(400);
        else {
          expect(r.status, JSON.stringify(r.json)).toBe(200);
          const doc = (await m.call('GET', `/api/v1/projects/${m.pid}`)).json;
          expect(JSON.stringify(doc)).not.toContain('owner track');
        }
      } finally { await m.s.close(); }
    }, 60_000);
});

export const FAMILY_B: Case[] = [
  { family: 'B', id: 'B4/D2 capability model download', method: 'POST', path: '/api/v1/projects/{pid}/capabilities/image.upscale/models/download', body: { confirmBytes: 1 }, guarded: 'human_approval_required' },
  { family: 'B', id: 'B4/D2 speech model download', method: 'POST', path: '/api/v1/projects/{pid}/speech/models/none/download', body: { confirmBytes: 1 }, guarded: 'human_approval_required' },
];
describe('family B — approvals (the download gate)', () => { bothModes(FAMILY_B); });

describe('family C — what agents see (C1, C2): a planted birth date, in both modes', () => {
  for (const mode of ['guarded', 'open'] as const)
    it(`${mode}: the agent ${mode === 'guarded' ? 'reads the name only and may not write a birth date (today)' : 'reads the birth date the owner entered and may write one'}`, async () => {
      const m = await modeServer(mode);
      try {
        const owner = await ownerCall(m.s);
        const tx = await owner('POST', `/api/v1/projects/${m.pid}/transactions`, { ops: [{ op: 'add_person', args: { name: 'Noa', birthDate: '2019-03-04' } }] });
        expect(tx.status, JSON.stringify(tx.json)).toBe(200);
        const read = JSON.stringify((await m.call('GET', `/api/v1/projects/${m.pid}`)).json);
        expect(read).toContain('Noa');
        const write = await m.call('POST', `/api/v1/projects/${m.pid}/transactions`, { ops: [{ op: 'add_person', args: { name: 'Dan', birthDate: '2021-05-06' } }] });
        if (mode === 'guarded') { expect(read).not.toContain('2019-03-04'); expect(write.status).toBe(403); }
        else { expect(read).toContain('2019-03-04'); expect(write.status, JSON.stringify(write.json)).toBe(200); }
      } finally { await m.s.close(); }
    }, 60_000);
});

/** An MCP tool call over HTTP with the agent token (stateless JSON-RPC, as an outside agent sends it). */
export async function mcpTool(s: RunningServer, name: string, args: Record<string, unknown>, token = s.auth.tokens.agent) {
  const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', connection: 'close' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  let body: any; try { body = JSON.parse(msg.result.content[0].text); } catch { body = { error: { code: 'mcp_text', message: msg.result.content[0].text } }; }
  return { isError: msg.result.isError === true, body, code: body?.error?.code as string | undefined };
}

describe('decision 2 — the new MCP tools, in both modes (one authority with their REST routes)', () => {
  for (const mode of ['guarded', 'open'] as const)
    it(`${mode}: start_model_download, speech engine, versions, storage, lessons`, async () => {
      const m = await modeServer(mode);
      try {
        const pid = m.pid;
        const owned = [
          ['start_model_download', { projectId: pid, kind: 'capability', id: 'image.upscale', confirmBytes: 1 }, 'human_approval_required'],
          ['get_speech_engine', {}, 'owner_required'],
          ['install_speech_engine', { projectId: pid, confirmBytes: 1 }, 'owner_required'],
          ['rename_version', { projectId: pid, versionId: 'ver_none', name: 'x' }, 'owner_required'],
          ['delete_version', { projectId: pid, versionId: 'ver_none' }, 'owner_required'],
          ['collect_storage', { apply: false }, 'owner_required'],
          ['get_storage', {}, 'owner_required'],
          ['derive_lesson', { projectId: pid, clipId: 'clip_none' }, 'owner_required'],
        ] as const;
        for (const [name, args, refusal] of owned) {
          const r = await mcpTool(m.s, name, args as Record<string, unknown>);
          if (mode === 'guarded') expect([name, r.code]).toEqual([name, refusal]);
          else expect([name, OWNER_REFUSALS.includes(r.code ?? '')]).toEqual([name, false]);
        }
        // the same in both modes: list, save and restore were never owner-only (an editing agent)
        const saved = await mcpTool(m.s, 'save_version', { projectId: pid, name: 'before agent' });
        expect(saved.isError, JSON.stringify(saved.body)).toBe(false);
        const listed = await mcpTool(m.s, 'list_versions', { projectId: pid });
        expect(listed.body.versions.map((v: any) => v.name)).toContain('before agent');
        if (mode === 'open') {
          const renamed = await mcpTool(m.s, 'rename_version', { projectId: pid, versionId: saved.body.version.id, name: 'renamed by agent' });
          expect(renamed.body.version?.name, JSON.stringify(renamed.body)).toBe('renamed by agent');
          const deleted = await mcpTool(m.s, 'delete_version', { projectId: pid, versionId: saved.body.version.id });
          expect(deleted.isError, JSON.stringify(deleted.body)).toBe(false);
          const controls = await mcpTool(m.s, 'get_controls', { projectId: pid });
          expect(controls.body).toMatchObject({ serverMode: 'open', actsAsOwner: true, people: 'full', mode: 'autopilot' });
        }
      } finally { await m.s.close(); }
    }, 90_000);
});

describe('the mode switch (C4): owner only, reaches the next request, closes agent event streams', () => {
  it('GET /autonomy says the mode in words; an agent cannot switch it (both modes); the owner switches open → guarded; the agent stream gets `mode` and ends; the next agent call is guarded', async () => {
    const m = await modeServer('open');
    try {
      const st = await m.call('GET', '/api/v1/autonomy');
      expect(st.json).toMatchObject({ mode: 'open', source: 'env', words: { he: { name: 'מצב פתוח' }, en: { name: 'Open mode' } } });
      expect(st.json.floor).toEqual(expect.arrayContaining(['A5', 'mode', 'C9', 'A23']));
      expect((await m.call('PUT', '/api/v1/autonomy', { mode: 'guarded' })).code).toBe('owner_required');
      expect((await m.call('GET', '/api/v1/grants')).status).toBe(200);
      // the agent listens
      const ctl = new AbortController();
      const res = await fetch(`${m.s.url}/api/v1/projects/${m.pid}/events`, { headers: { authorization: `Bearer ${m.s.auth.tokens.agent}` }, signal: ctl.signal });
      const reader = res.body!.getReader();
      let seen = '';
      const read = (async () => { for (;;) { const { done, value } = await reader.read(); if (done) return 'ended'; seen += new TextDecoder().decode(value); } })();
      await new Promise((r) => setTimeout(r, 300));
      const owner = await ownerCall(m.s);
      const sw = await owner('PUT', '/api/v1/autonomy', { mode: 'guarded' });
      expect(sw.json).toMatchObject({ mode: 'guarded', source: 'stored' });
      const outcome = await Promise.race([read, new Promise((r) => setTimeout(() => r('still open'), 5000))]);
      ctl.abort();
      expect(outcome).toBe('ended');
      expect(seen).toContain('event: mode');
      expect((await m.call('GET', '/api/v1/grants')).code).toBe('owner_required');
      expect((await m.call('PUT', '/api/v1/autonomy', { mode: 'open' })).code).toBe('owner_required');
      expect((await owner('PUT', '/api/v1/autonomy', { mode: 'sideways' })).status).toBe(400);
    } finally { await m.s.close(); }
  }, 60_000);
});

// =====================================================================================================================
// Warn and continue (ADR-0036 rows D1, D5, D6, D8, H1, H2, I9, I11): these read the SERVER mode (autonomy-mode.ts warnsOpen),
// for the owner and agents alike. Guarded keeps today's refusal byte for byte; open goes ahead and records a warning the caller
// sees (on the job, in the route's answer, and in get_controls where it is a standing state). No real host is ever contacted.
// =====================================================================================================================
const W_MODES = ['guarded', 'open'] as const;
const wcode = async (f: () => unknown) => { try { await f(); return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : String(e); } };
/** LABELLED TEST DOUBLE of ComfyUI: answers the probe only (reachable, every node class present); nothing is ever submitted to it. */
const probeOnlyComfy = (): ProviderAdapter => ({
  id: 'probe-only (test double)', probe: async () => ({ reachable: true, wokeWorker: false, runtimeVersion: 'fake', device: { name: 'fake-cpu', type: 'cpu', vramTotalBytes: null }, hostRamBytes: null, missingNodeClasses: [], missingModels: [], problems: [] }),
  estimate: () => ({ downloadBytes: 0, durationSeconds: null, costUsd: null, basis: 'none' }),
  stage: async () => { throw new Error('test double: nothing is staged'); }, submit: async () => { throw new Error('test double: nothing is submitted'); },
  status: async () => ({ state: 'failed', error: 'test double' }) as any, findByClientRequestId: async () => null, cancel: async () => 'not-supported', collect: async () => [], running: async () => [],
});
/** LABELLED FAKE model host: records every URL asked for and answers 404 (so nothing is downloaded and no real host is reached). */
const fakeHost = () => { const urls: string[] = []; const f = (async (u: any) => { urls.push(String(u)); return new Response(null, { status: 404 }); }) as unknown as typeof fetch; return { f, urls }; };
async function capsIn(mode: 'open' | 'guarded', over: Partial<Config> = {}, deps: { adapter?: ProviderAdapter | null; fetch?: typeof fetch; comfyFetch?: typeof fetch; registry?: CapabilityDescriptor[] } = {}) {
  const dir = tmp(`pf-warn-${mode}-`);
  const cfg: Config = { ...loadConfig({}), dataDir: path.join(dir, 'data'), comfyuiModelsDir: path.join(dir, 'models'), toolsModelsDir: path.join(dir, 'tool-models'), ...over, mode };
  const store = new Store(cfg.dataDir);
  const caps = new Capabilities(store, cfg, deps.adapter === null ? undefined : (deps.adapter ?? probeOnlyComfy()), { freeBytes: () => 1e13, providerInputDir: null, pollMs: 10, ...(deps.fetch ? { modelFetch: deps.fetch } : {}), ...(deps.comfyFetch ? { comfyFetch: deps.comfyFetch } : {}), ...(deps.registry ? { registry: () => deps.registry! } : {}) });
  const pid = store.createProject({ name: 'warn', width: 64, height: 36 }).doc.id;
  return { cfg, store, caps, pid, close: async () => { await caps.stop(); store.close(); } };
}
const settled = async (store: Store, id: string) => { for (let i = 0; i < 2000; i++) { const j = store.getJob(id); if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await new Promise((r) => setTimeout(r, 10)); } throw new Error('job did not settle'); };

describe('D1 model hosts: a host outside PF_MODEL_HOSTS', () => {
  const bytes = Buffer.alloc(4096, 7);
  const sha = createHash('sha256').update(bytes).digest('hex');
  const m = (source: string) => ({ path: 'x/test.bin', sha256: sha, bytes: bytes.length, source });
  const serve = (redirectTo?: string) => { const urls: string[] = []; const f = (async (u: any) => { const url = String(u); urls.push(url); if (redirectTo && !url.startsWith(redirectTo)) return new Response(null, { status: 302, headers: { location: redirectTo } }); return new Response(new Uint8Array(bytes), { status: 200 }); }) as unknown as typeof fetch; return { f, urls }; };
  it('the model store: refused without the open flag (today); with it, used over https and named; http and a credential are never sent', async () => {
    const h = serve();
    expect(await wcode(() => new ModelStore(tmp('pf-w-ms-'), ['huggingface.co'], h.f).download(m('https://models.example/t'), () => {}))).toBe('403:model_host_not_allowed');
    const seen: string[] = [];
    const st = await new ModelStore(tmp('pf-w-ms-'), ['huggingface.co'], h.f).download(m('https://models.example/t'), () => {}, undefined, { anyHost: true, onHost: (x) => seen.push(x) });
    expect(st.state).toBe('ready');
    expect(seen).toEqual(['models.example']);
    expect(await wcode(() => new ModelStore(tmp('pf-w-ms-'), ['huggingface.co'], h.f).download(m('http://models.example/t'), () => {}, undefined, { anyHost: true }))).toBe('403:model_host_not_allowed');
    const r = serve('https://cdn.other.example/x');
    const hops: string[] = [];
    expect((await new ModelStore(tmp('pf-w-ms-'), ['huggingface.co'], r.f).download(m('https://huggingface.co/t'), () => {}, undefined, { anyHost: true, onHost: (x) => hops.push(x) })).state).toBe('ready');
    expect(hops).toEqual(['cdn.other.example']);
  });
  for (const mode of W_MODES)
    it(`${mode}: the capability's setup state and its download ${mode === 'guarded' ? 'refuse host_not_allowed (today), no job, no request' : 'go ahead: the job carries the warning naming github.com'}`, async () => {
      const host = fakeHost();
      const c = await capsIn(mode, { modelHosts: ['huggingface.co'] }, { fetch: host.f });
      try {
        const bytes = IMAGE_UPSCALE.models[0]!.bytes!;
        const setup = (await c.caps.estimate({ projectId: c.pid, capabilityId: IMAGE_UPSCALE.id, params: {}, actor: 'user:local' })).setup;
        const start = await wcode(async () => c.caps.startDownload(c.pid, IMAGE_UPSCALE.id, bytes, 'user:local'));
        const jobs = c.store.db.prepare("SELECT id, input FROM jobs WHERE type = 'model-download'").all() as { id: string; input: string }[];
        if (mode === 'guarded') {
          expect(setup).toMatchObject({ code: 'host_not_allowed', hosts: ['github.com'] });
          expect(setup.warnings).toBeUndefined();
          expect(start).toBe('409:host_not_allowed');
          expect(jobs).toEqual([]);
          expect(host.urls).toEqual([]);
        } else {
          expect(setup).toMatchObject({ code: 'model_missing', warnings: [{ code: 'host_not_listed', host: 'github.com' }] });
          expect(setup.warnings![0]!.he).toContain('github.com');
          expect(start).toBe('ok');
          expect(jobs.length).toBe(1);
          expect(JSON.parse(jobs[0]!.input)).toMatchObject({ admittedOpen: true, openWarnings: [{ code: 'host_not_listed', host: 'github.com' }] });
          const j = await settled(c.store, jobs[0]!.id);
          expect(j.status).toBe('failed'); // the labelled fake host answered 404: nothing was downloaded, and nothing was called ready
          expect(new URL(host.urls[0]!).hostname).toBe('github.com');
        }
      } finally { await c.close(); }
    }, 60_000);
});

describe('D5 a ComfyUI on another computer (PF_COMFYUI_URL not loopback, no PF_COMFYUI_ALLOW_REMOTE)', () => {
  for (const mode of W_MODES)
    it(`${mode}: ${mode === 'guarded' ? 'not configured, with the refusal of today; nothing is contacted' : 'used, and the provider status and the standing warnings name gpu.example'}`, async () => {
      const host = fakeHost();
      const c = await capsIn(mode, { comfyuiUrl: 'http://gpu.example:8188', comfyuiAllowRemote: false }, { adapter: null, comfyFetch: host.f });
      try {
        const st = await c.caps.providerStatus();
        if (mode === 'guarded') {
          expect(st).toMatchObject({ configured: false });
          expect(st.reason).toContain('is not loopback');
          expect(c.caps.standingWarnings()).toEqual([]);
          expect(host.urls).toEqual([]);
        } else {
          expect(st).toMatchObject({ configured: true, warnings: [{ code: 'comfyui_remote', host: 'gpu.example' }] });
          expect(c.caps.standingWarnings().map((w) => w.host)).toEqual(['gpu.example']);
          expect(host.urls.every((u) => new URL(u).hostname === 'gpu.example')).toBe(true); // the labelled fake answered the probe
        }
      } finally { await c.close(); }
    }, 60_000);
});

/** Test copies (labelled) of a reviewed descriptor: one that reaches outside (egress), one whose model's licence is recorded as not commercial. */
const VOICE_CLEAN = LOCAL_TOOLS.find((d) => d.id === 'local.voice.clean')!;
const EGRESS_COPY: ComfyDescriptor = { ...SMOKE_SOLID_IMAGE, id: 'test.egress-copy', egress: 'graph-defined' };
const NC_MODEL = { role: 'm', path: 'test/nc.safetensors', publisher: 'p', revision: 'r', sha256: 'a'.repeat(64), bytes: 10, license: 'CC-BY-NC-4.0', licenseEvidence: 'model card: license cc-by-nc-4.0 (test copy)', commercialUse: 'prohibited' as const, gated: false, source: 'https://huggingface.co/x', attribution: null };
const NC_COPY: ComfyDescriptor = { ...SMOKE_SOLID_IMAGE, id: 'test.nc-copy', models: [NC_MODEL] };
describe('D8 egress and H1 licences: blockers that become warnings (the rest stay facts)', () => {
  for (const mode of W_MODES)
    it(`${mode}: an egress copy and a non-commercial-model copy ${mode === 'guarded' ? 'are refused capability_blocked / licence_blocked (today)' : 'are admitted; the job carries the warnings quoting the table, and the licence mark its result will carry'}`, async () => {
      const c = await capsIn(mode, {}, { registry: [EGRESS_COPY, NC_COPY] });
      try {
        const run = (id: string) => wcode(() => c.caps.start({ projectId: c.pid, capabilityId: id, params: {}, actor: 'user:local' }));
        const setup = (await c.caps.estimate({ projectId: c.pid, capabilityId: NC_COPY.id, params: {}, actor: 'user:local' })).setup;
        const egress = await run(EGRESS_COPY.id);
        const nc = await run(NC_COPY.id);
        const jobs = (c.store.db.prepare("SELECT input FROM jobs WHERE type = 'capability' ORDER BY rowid").all() as { input: string }[]).map((r) => JSON.parse(r.input));
        if (mode === 'guarded') {
          expect([egress, nc]).toEqual(['409:capability_blocked', '409:capability_blocked']);
          expect(setup.code).toBe('licence_blocked');
          expect(jobs).toEqual([]);
        } else {
          expect(setup.code).not.toBe('licence_blocked');
          expect(setup.warnings?.[0]).toMatchObject({ code: 'licence', model: 'test/nc.safetensors', licence: 'CC-BY-NC-4.0', use: 'prohibited' });
          expect(setup.warnings![0]!.he).toContain('model card: license cc-by-nc-4.0 (test copy)');
          expect(egress).toBe('ok');
          expect(jobs[0]).toMatchObject({ capabilityId: EGRESS_COPY.id, openWarnings: [{ code: 'egress', tool: EGRESS_COPY.id }] });
          expect(jobs[0].openLicences).toBeUndefined();
          // the model file is missing (a fact): the start is refused for that, never for the licence
          expect(nc).not.toBe('409:capability_blocked');
        }
        // a model with no pinned digest stays refused in both modes (a fact about the file, not a policy)
        const unresolved: ComfyDescriptor = { ...NC_COPY, id: 'test.unresolved', models: [{ ...NC_MODEL, sha256: null }] };
        const u = await capsIn(mode, {}, { registry: [unresolved] });
        try { expect(await wcode(() => u.caps.start({ projectId: u.pid, capabilityId: unresolved.id, params: {}, actor: 'user:local' }))).toBe('409:capability_blocked'); } finally { await u.close(); }
      } finally { await c.close(); }
    }, 60_000);
  for (const mode of W_MODES)
    it(`${mode}: a local tool whose model is "unknown" for commercial use ${mode === 'guarded' ? 'is licence_blocked and refused (today)' : 'goes past the licence (it then meets its honest engine state); prepare records the warning and the mark'}`, async () => {
      const dir = tmp(`pf-warn-lt-${mode}-`);
      const cfg: Config = { ...loadConfig({}), dataDir: path.join(dir, 'data'), toolsModelsDir: path.join(dir, 'tm'), denoiseBin: null, toolsPython: null, mode };
      const store = new Store(cfg.dataDir);
      try {
        const pid = store.createProject({ name: 'lt', width: 64, height: 36 }).doc.id;
        const tools = new LocalTools(store, cfg);
        const copy: LocalToolDescriptor = { ...VOICE_CLEAN, models: [{ ...VOICE_CLEAN.models[0]!, commercialUse: 'unknown' }] }; // TEST COPY
        const s = await tools.setup(copy);
        const prep = await wcode(() => tools.prepare(copy, { projectId: pid, capabilityId: copy.id, params: {}, actor: 'user:local', source: { assetId: 'ast_x' } }));
        if (mode === 'guarded') { expect(s.code).toBe('licence_blocked'); expect(prep).toBe('409:capability_blocked'); }
        else {
          expect(s.code).toBe('engine_not_configured');
          expect(s.warnings?.[0]).toMatchObject({ code: 'licence', use: 'unknown' });
          expect(prep).toBe('409:engine_not_configured'); // past the licence, stopped by the missing engine (a setup fact)
        }
      } finally { store.close(); }
    }, 60_000);
  it('a result carrying a licence mark makes the export show non_commercial_content; one without it shows nothing new', async () => {
    const dir = tmp('pf-warn-mark-');
    const store = new Store(path.join(dir, 'data'));
    try {
      const pid = store.createProject({ name: 'mark', width: 64, height: 36 }).doc.id;
      const derived = { jobId: 'job_x', capabilityId: NC_COPY.id, capabilityVersion: '1', graphDigest: 'g', params: {}, sourceAssetIds: [], outputName: 'image', outputRole: 'primary', encoding: 'png', provider: {} };
      const add = async (name: string, extra: Record<string, unknown>) => {
        const png = path.join(dir, `${name}.png`); // a different picture each time (the store keeps one asset per content)
        execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${name === 'plain' ? 'gray' : 'blue'}:s=16x16`, '-frames:v', '1', png]);
        const asset = await ingestUpload(store, Readable.toWeb(fs.createReadStream(png)) as any, `${name}.png`, 'user:local', 1 << 20);
        const id = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...asset, name, contentHash: asset.contentHash, provenance: { origin: 'derived', importedAt: new Date().toISOString(), importedBy: 'user:local', derived: { ...derived, ...extra } } } } }] }).results[0]!.output!.assetId as string;
        store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId: id, start: { value: '0', timescale: 30 } } }] });
        return id;
      };
      await add('plain', {});
      expect(libraryExportWarnings(store.getProject(pid).doc).filter((w) => w.code === 'non_commercial_content')).toEqual([]);
      const marked = await add('marked', { jobId: 'job_y', modelLicences: [{ path: NC_MODEL.path, licence: 'CC-BY-NC-4.0', commercialUse: 'prohibited' }] });
      const w = libraryExportWarnings(store.getProject(pid).doc).filter((x) => x.code === 'non_commercial_content');
      expect(w.length).toBe(1);
      expect(w[0]!.ids).toEqual([marked]);
      expect(w[0]!.message).toContain('CC-BY-NC-4.0');
    } finally { store.close(); }
  }, 60_000);
});

describe('D6 the language assistant\'s host outside PF_ASSISTANT_HOSTS', () => {
  for (const mode of W_MODES)
    it(`${mode}: ${mode === 'guarded' ? 'saving it is refused host_not_allowed and the setup state names it (today)' : 'it is saved and used, with a warning naming it; http and a non-host stay refused'}`, () => {
      const dir = tmp(`pf-warn-as-${mode}-`);
      const cfg: Config = { ...loadConfig({}), dataDir: dir, assistantHosts: ['api.example.com'], mode };
      const files = new AssistantFiles(dir, cfg.assistantHosts, cfg);
      const body = { adapter: 'x', host: 'api.other.example', model: 'm', pricesCentsPerMTok: { input: 1, output: 1 }, monthlyLimitCents: 100, perRequestCapCents: 10, toggles: { titlesAndMarkers: false, peopleNames: false } } as any;
      const saved = (() => { try { files.writeConfig(body); return 'ok'; } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : String(e); } })();
      const rt = { cfg, files: new AssistantFiles(dir, cfg.assistantHosts, cfg), deps: { adapters: new Map([['x', {}]]), endpoint: () => null }, store: null, gov: null } as any;
      if (mode === 'guarded') {
        expect(saved).toBe('409:host_not_allowed');
        new AssistantFiles(dir, cfg.assistantHosts, { ...cfg, mode: 'open' }).writeConfig(body); // stored while open, read guarded
        const s = assistantSetup(rt);
        expect(s.blockers.map((b) => b.code)).toContain('host_not_allowed');
        expect(s.warnings).toBeUndefined();
      } else {
        expect(saved).toBe('ok');
        const s = assistantSetup(rt);
        expect(s.blockers.map((b) => b.code)).not.toContain('host_not_allowed');
        expect(s.warnings).toMatchObject([{ code: 'assistant_host_not_listed', host: 'api.other.example' }]);
        expect(() => files.writeConfig({ ...body, host: 'http://api.other.example' })).toThrow(/https only/);
        expect(() => files.writeConfig({ ...body, host: 'api.other.example:8080' })).toThrow(/not a host name/);
      }
    });
});

describe('H2 the search picture model\'s licence outside LICENCES_ALLOWED (a labelled test licence row)', () => {
  for (const mode of W_MODES)
    it(`${mode}: ${mode === 'guarded' ? 'licence_blocked (today)' : 'quoted in a warning, and the setup goes on to its next honest state'}`, async () => {
      const dir = tmp(`pf-warn-h2-${mode}-`);
      const cfg: Config = { ...loadConfig({}), dataDir: path.join(dir, 'data'), toolsPython: null, searchModelDir: null, libraryDir: null, mode };
      const store = new Store(cfg.dataDir);
      try {
        const rtm = createSearchRuntime({ cfg, store, lane: new FifoComputeLane(), pictureLicence: { spdx: 'CC-BY-NC-4.0', evidence: 'test row' } });
        const s = await rtm.setup();
        if (mode === 'guarded') { expect(s.code).toBe('licence_blocked'); expect(s.warnings).toBeUndefined(); }
        else { expect(s.code).not.toBe('licence_blocked'); expect(s.warnings).toMatchObject([{ code: 'search_licence', licence: 'CC-BY-NC-4.0', evidence: 'test row' }]); }
      } finally { store.close(); }
    }, 60_000);
});

describe('I9 the upload cap, I11 narration batches, and the standing warnings in get_controls (REST and MCP, the agent token)', () => {
  const script = Array.from({ length: 61 }, (_, i) => `Sentence number ${i + 1}.`).join(' ');
  for (const mode of W_MODES)
    it(`${mode}: a file above PF_MAX_UPLOAD_BYTES's default and a 61-sentence script ${mode === 'guarded' ? 'are refused 413 upload_too_large and 422 script_too_long (today)' : 'go past the limits; get_controls names the remote ComfyUI and that uploads have no cap'}`, async () => {
      const s = await startServer({ port: 0, dataDir: tmp(`pf-warn-i9-${mode}-`), mode, modeFromEnv: true, libraryDir: null, backupDir: null, maxUploadBytes: 1000, maxUploadBytesSet: false, comfyuiUrl: 'http://gpu.example:8188', comfyuiAllowRemote: false });
      try {
        const token = s.auth.tokens.agent;
        const pid = (await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ name: 'i9' }) })).json() as any).project.id;
        const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-filename': 'big.bin', connection: 'close' }, body: Buffer.alloc(5000, 1) });
        const upJson: any = await up.json();
        const nar = await fetch(`${s.url}/api/v1/projects/${pid}/narration/script`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ text: script, start: { value: '0', timescale: 30 } }) });
        const narJson: any = await nar.json();
        const controls = await mcpTool(s, 'get_controls', { projectId: pid });
        if (mode === 'guarded') {
          expect([up.status, upJson.error?.code]).toEqual([413, 'upload_too_large']);
          expect([nar.status, narJson.error?.code]).toEqual([422, 'script_too_long']);
          expect(controls.body.openWarnings).toBeUndefined();
        } else {
          expect(upJson.error?.code).not.toBe('upload_too_large'); // past the cap: the bytes are no media, an honest import refusal follows
          expect(narJson.error?.code).not.toBe('script_too_long'); // past the batch limit: no voice model here, voice_not_ready follows
          expect(narJson.error?.code).toBe('voice_not_ready');
          expect(controls.body.openWarnings.map((w: any) => w.code).sort()).toEqual(['comfyui_remote', 'upload_uncapped']);
        }
      } finally { await s.close(); }
    }, 90_000);
  it('open with the owner\'s PF_MAX_UPLOAD_BYTES set: the owner\'s cap holds (413), and get_controls has no upload warning', async () => {
    const s = await startServer({ port: 0, dataDir: tmp('pf-warn-i9-own-'), mode: 'open', modeFromEnv: true, libraryDir: null, backupDir: null, maxUploadBytes: 1000, maxUploadBytesSet: true });
    try {
      const token = s.auth.tokens.agent;
      const pid = (await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ name: 'i9' }) })).json() as any).project.id;
      const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-filename': 'big.bin', connection: 'close' }, body: Buffer.alloc(5000, 1) });
      expect(up.status).toBe(413);
      expect((await mcpTool(s, 'get_controls', { projectId: pid })).body.openWarnings).toEqual([]);
    } finally { await s.close(); }
  }, 90_000);
});
