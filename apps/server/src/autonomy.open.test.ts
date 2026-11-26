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
