/**
 * The craft routes through the real app and the real MCP handler (wave 7 craft, W2; craft/routes.ts): who may do what with
 * versions (observe lists and diffs; save and restore need edit and are refused to propose mode; rename and delete are the owner's
 * session's), the privacy gate on diff, still and restore, no birth date in any versions or find answer to a credential without
 * the people scope (V6), each server refusal provoked through its route with its fixed sentence and a Hebrew wording, and find:
 * REST = MCP = core findText over the reader document, cut at CRAFT_LIMITS.findMatches with the total.
 * The still's renderer is a LABELLED TEST STUB (exporter.renderStill replaced): it records the document it is handed and answers
 * fixed bytes; the real still is proof V2 (craft-proof.versions.ts). Fixtures typed here.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { CRAFT_LIMITS, findClip, findText, type FindQuery, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { translateRefusal } from '../../../../packages/i18n/src/index.ts';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { docForPrincipal } from '../peoplePrivacy.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { CRAFT_SERVER_REFUSALS, type CraftServerRefusalKey } from './contract.ts';
import { findTextFor } from './findText.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const BIRTH = '2016-11-04';
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const VIDEO = { kind: 'video' as const, name: 'ים.mp4', contentHash: `sha256:${'ab'.repeat(32)}`, byteSize: 4, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov };
const region = { shape: 'rect', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0, feather: 0, style: 'blur', strength: 1, color: '#000000', onLoss: 'frame', motionTrackId: null };
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, exporter: Exporter, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', proposeGrant = '', limitedGrant = '', pid = '', clipA = '', titleId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), proposer = bearer(() => proposeGrant), limited = bearer(() => limitedGrant);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  const text = type.includes('json') ? await r.text() : '';
  return { status: r.status, text, body: text ? (JSON.parse(text) as any) : null, bytes: type.includes('png') ? Buffer.from(await r.arrayBuffer()) : null };
};
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string; data: any }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const raw = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : raw);
  const text = msg.result.content[0].text as string;
  let data: unknown = text; try { data = JSON.parse(text); } catch { /* a plain message */ }
  return { isError: !!msg.result?.isError, text, data };
}
const commit = (ops: OpCall[]) => store.commit({ projectId: pid, actor: 'user:local', ops, allowInternal: true });
/** Every refusal provoked below, by key, with the sentence it answered. */
const provoked = new Map<CraftServerRefusalKey, string>();
const expectRefusal = (r: { status: number; body: any }, key: CraftServerRefusalKey) => {
  const x = CRAFT_SERVER_REFUSALS[key];
  expect({ key, status: r.status, code: r.body?.error?.code }).toEqual({ key, status: x.status, code: x.code });
  provoked.set(key, r.body.error.message as string);
};
/** The documents the still stub was handed. */
const stills: ProjectDocument[] = [];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-craft-routes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  // TEST STUB (labelled): no browser here; record the document and answer fixed bytes
  exporter.renderStill = async (doc: ProjectDocument) => { stills.push(doc); return Buffer.from('PNG-STUB'); };
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  limitedGrant = gov.createGrant({ name: 'one-track', mode: 'edit', trackIds: ['trk_none'] }, OWNER).token;
  pid = store.createProject({ name: 'craft routes', width: 640, height: 360, frameRate: R }).doc.id;
  commit([{ op: 'import_asset', args: { asset: VIDEO } }]);
  const sea = Object.keys(store.wholeProject(pid).doc.assets)[0]!;
  clipA = (commit([{ op: 'add_clip', args: { assetId: sea, start: f(0), sourceIn: f(0), duration: f(30) } }]).results[0]!.output as any).clipId;
  titleId = (commit([{ op: 'add_text', args: { text: 'שלום נעה', start: f(10), duration: f(30) } }]).results[0]!.output as any).clipId;
  commit([{ op: 'add_text', args: { text: 'נעה בים', start: f(40), duration: f(10) } }]);
  commit([{ op: 'add_person', args: { name: 'נועה', birthDate: BIRTH, form: 'f' } }]);
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('versions through REST', () => {
  let v1 = '';
  it('the owner saves (201), an observer lists and diffs; neither an observer nor propose mode saves; agents cannot rename or delete', async () => {
    const saved = await rest(owner, 'POST', '/versions', { name: 'לפני הקיצור' });
    expect(saved.status).toBe(201);
    v1 = saved.body.version.id;
    expect(saved.body.version).toMatchObject({ name: 'לפני הקיצור', sameAsCurrent: true, privacyChanged: false, frames: 50 });
    expect((await rest(observer, 'POST', '/versions', { name: 'x' })).status).toBe(403);
    expectRefusal(await rest(proposer, 'POST', '/versions', { name: 'x' }), 'proposeOnly');
    expectRefusal(await rest(proposer, 'POST', `/versions/${v1}/restore`, {}), 'proposeOnly');
    expect((await rest(observer, 'POST', `/versions/${v1}/restore`, {})).status).toBe(403);
    const list = await rest(observer, 'GET', '/versions');
    expect(list.status).toBe(200);
    expect(list.body.versions.map((v: any) => v.id)).toEqual([v1]);
    expect(list.text).not.toContain('"sequences"'); // never a document
    expectRefusal(await rest(agent, 'PUT', `/versions/${v1}`, { name: 'x' }), 'ownerOnly');
    expectRefusal(await rest(agent, 'DELETE', `/versions/${v1}`), 'ownerOnly');
    expect((await rest(owner, 'PUT', `/versions/${v1}`, { name: '' })).status).toBe(400);
    expect((await rest(owner, 'PUT', `/versions/${v1}`, { name: 'לפני' })).body.version.name).toBe('לפני');
    expectRefusal(await rest(owner, 'GET', '/versions/ver_none/diff'), 'versionNotFound');
  });
  it('diff and still after known edits; the still is drawn from the copy; past the end is version_frame_out_of_range', async () => {
    commit([{ op: 'trim_clip', args: { clipId: clipA, edge: 'end', to: f(18) } }, { op: 'update_text', args: { clipId: titleId, text: 'שלום נועה' } }]);
    const d = await rest(observer, 'GET', `/versions/${v1}/diff?against=current`);
    expect(d.status).toBe(200);
    expect(d.body.diff.counts).toEqual({ added: 0, removed: 0, changed: 2 });
    expect(d.body.diff.rows.map((r: any) => r.name)).toEqual(['ים.mp4', 'שלום נועה']);
    const v2 = (await rest(owner, 'POST', '/versions', { name: 'אחרי' })).body.version.id;
    expect((await rest(observer, 'GET', `/versions/${v1}/diff?against=${v2}`)).body.diff.counts.changed).toBe(2);
    stills.length = 0;
    const still = await rest(observer, 'GET', `/versions/${v1}/frame?index=20`);
    expect([still.status, still.bytes?.toString()]).toEqual([200, 'PNG-STUB']);
    expect(T.frameCount(findClip(stills[0]!, clipA)!.clip.duration, R)).toBe(30); // the version's clip, not today's (18)
    expect(stills[0]!.people?.[Object.keys(stills[0]!.people!)[0]!]?.birthDate).toBeNull(); // drawn as the observer may read it
    expectRefusal(await rest(observer, 'GET', `/versions/${v1}/frame?index=50`), 'frameOutOfRange');
  });
  it('restore: stale_revision, nothing_to_restore, one undoable step; a clip-limited grant is refused', async () => {
    const now = store.wholeProject(pid).revision;
    expectRefusal(await rest(owner, 'POST', `/versions/${v1}/restore`, { expectRevision: now - 1 }), 'staleRevision');
    expect((await rest(limited, 'POST', `/versions/${v1}/restore`, {})).body.error.code).toBe('out_of_scope');
    const r = await rest(agent, 'POST', `/versions/${v1}/restore`, { expectRevision: now });
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(now + 1);
    expect(T.frameCount(findClip(store.wholeProject(pid).doc, clipA)!.clip.duration, R)).toBe(30);
    expectRefusal(await rest(owner, 'POST', `/versions/${v1}/restore`, {}), 'nothingToRestore');
    const undo = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/undo`, { method: 'POST', headers: agent(), body: '{}' }));
    expect(undo.status).toBe(200);
    expect(T.frameCount(findClip(store.wholeProject(pid).doc, clipA)!.clip.duration, R)).toBe(18);
  });
  it('the privacy gate: after a region is added an agent and an observer are refused diff, still and restore; the owner must confirm', async () => {
    commit([{ op: 'set_redact_region', args: { clipId: clipA, region } }]);
    const list = (await rest(observer, 'GET', '/versions')).body.versions;
    expect(list.find((v: any) => v.id === v1).privacyChanged).toBe(true);
    for (const [who, method, p] of [[observer, 'GET', `/versions/${v1}/diff`], [agent, 'GET', `/versions/${v1}/frame?index=0`], [agent, 'POST', `/versions/${v1}/restore`]] as const)
      expectRefusal(await rest(who, method, p, method === 'POST' ? { confirmPrivacy: true } : undefined), 'privacyChanged');
    expect((await rest(owner, 'GET', `/versions/${v1}/diff`)).body.diff.privacy).toEqual({ added: 0, removed: 1, changed: 0 });
    expect((await rest(owner, 'GET', `/versions/${v1}/frame?index=0`)).status).toBe(200);
    expectRefusal(await rest(owner, 'POST', `/versions/${v1}/restore`, {}), 'needsConfirmation');
    const ok = await rest(owner, 'POST', `/versions/${v1}/restore`, { confirmPrivacy: true });
    expect(ok.status).toBe(200);
    expect((findClip(store.wholeProject(pid).doc, clipA)!.clip as any).redact).toBeUndefined();
  });
  it('V6: no birth date in any versions or find answer to a credential without the people scope; the owner reads it in the copy', async () => {
    const v = (await rest(owner, 'POST', '/versions', { name: 'people' })).body.version.id;
    commit([{ op: 'update_text', args: { clipId: titleId, text: 'נעה' } }]);
    const answers = [
      await rest(agent, 'GET', '/versions'), await rest(agent, 'GET', `/versions/${v}/diff`), await rest(observer, 'GET', `/versions/${v}/diff`),
      await rest(agent, 'POST', '/text/find', { text: 'נעה', wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false }),
      await rest(agent, 'POST', `/versions/${v}/restore`, {}), await rest(agent, 'POST', '/versions', { name: 'by agent' }),
    ];
    for (const a of answers) {
      expect(a.status).toBeLessThan(300);
      expect(a.text).not.toContain(BIRTH);
      expect(a.text).not.toContain('2016');
    }
    stills.length = 0;
    await rest(agent, 'GET', `/versions/${v}/frame?index=0`);
    expect(JSON.stringify(stills)).not.toContain(BIRTH);
    await rest(owner, 'GET', `/versions/${v}/frame?index=0`);
    expect(JSON.stringify(stills[1])).toContain(BIRTH); // the plant is there for the owner
  });
});

describe('find through REST and MCP', () => {
  const q = { text: 'נעה', wholeWord: true, ignoreMarks: true, finalsEqual: true, ignoreCase: false };
  it('REST = MCP = core findText over the reader document, with the total', async () => {
    const r = await rest(observer, 'POST', '/text/find', q);
    expect(r.status).toBe(200);
    const m = await tool(agent, 'find_text', { projectId: pid, ...q });
    expect(m.isError).toBe(false);
    const whole = store.wholeProject(pid);
    const core = findText(docForPrincipal(whole.doc, { actor: 'agent:observer', kind: 'agent', scopes: ['observe'] }), { ...q, scope: 'project', formats: 'all' } as FindQuery);
    expect(core.length).toBeGreaterThan(0);
    const want = { revision: whole.revision, matches: core, total: core.length, truncated: false };
    expect(r.body).toEqual(JSON.parse(JSON.stringify(want)));
    expect(m.data).toEqual(r.body);
    expect((await rest(observer, 'POST', '/text/find', { ...q, text: '' })).status).toBe(400);
  });
  it(`lists at most CRAFT_LIMITS.findMatches (${CRAFT_LIMITS.findMatches}) and counts them all`, () => {
    const all = findTextFor(store, OWNER, pid, { ...q, scope: 'project', formats: 'all' });
    expect(all.total).toBeGreaterThan(1);
    const cut = findTextFor(store, OWNER, pid, { ...q, scope: 'project', formats: 'all' }, 1);
    expect([cut.matches.length, cut.total, cut.truncated]).toEqual([1, all.total, true]);
    expect(cut.matches[0]).toEqual(all.matches[0]);
  });
});

describe('the wording of every server refusal provoked here', () => {
  it('has the fixed English sentence and a Hebrew wording with a next step', () => {
    expect([...provoked.keys()].sort()).toEqual(['frameOutOfRange', 'needsConfirmation', 'nothingToRestore', 'ownerOnly', 'privacyChanged', 'proposeOnly', 'staleRevision', 'versionNotFound']);
    for (const [key, en] of provoked) {
      const x = CRAFT_SERVER_REFUSALS[key] as { message: (...a: number[]) => string };
      const shaped = [x.message(), x.message(1), x.message(1, 1)].some((s) => s.replace(/\d+/g, 'N') === en.replace(/\d+/g, 'N'));
      expect({ key, shaped }).toEqual({ key, shaped: true });
      const he = translateRefusal('he', en);
      expect({ key, hebrew: !!he && /[֐-׿]/.test(he) }).toEqual({ key, hebrew: true });
    }
  });
});
