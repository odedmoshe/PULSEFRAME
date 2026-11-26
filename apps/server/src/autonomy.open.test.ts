/**
 * Autonomy, the swapped policy sites in BOTH modes over REST (autonomy.ts; verifier C14): the same call with the built-in agent
 * token answers today's refusal in `guarded` and gets past the gate in `open` (it may then meet an honest setup state such as
 * 404 or 409, never an owner refusal). The existing refusal tests stay as they are and run in guarded (vitest.config.ts).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from './index.ts';

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
