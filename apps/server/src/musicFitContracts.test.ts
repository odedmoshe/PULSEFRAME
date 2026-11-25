/**
 * Lead contracts of the musicfit track on the server (wave 7; .artifacts/wave7/musicfit-decisions.md §4): the four routes and two MCP
 * tools exist; the checks that come BEFORE any work answer as decided (a propose-mode agent and a limited grant are refused at apply;
 * every agent is refused at the heard mark before its body is read; there is no MCP tool for it); until the builders build the bodies
 * every call answers 501 musicfit_not_built after those checks and changes nothing. A built-in music request with an ending other
 * than one bar answers 501 until A builds the synthesiser (never a wrong track).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
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
import { MUSICFIT_JOIN_BUILT, MUSICFIT_SERVER_BUILT } from './musicfit/routes.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'test' };
const song: Omit<Asset, 'id'> = { kind: 'audio', name: 'song.wav', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Omit<Asset, 'id'>;

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives, ownerCookie: string;
const base = () => `http://127.0.0.1:${cfg.port}`;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const ownerHeaders = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, h: Record<string, string>) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers: h, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
let rpc = 0;
const mcpCall = async (method: string, params: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
};
let n = 1;
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;
const revision = (pid: string) => store.getProject(pid).revision;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-musicfit-contracts-'));
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
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: song } }] });
  const assetId = r.results[0]!.output!.assetId as string;
  const c = store.commit({ projectId: pid, actor: 'user:owner', ops: [{ op: 'add_clip', args: { assetId, start: T.ZERO } }] });
  return { pid, assetId, clipId: c.results[0]!.output!.clipId as string };
}
const planBody = (clipId: string) => ({ target: { clipId }, music: { keep: true }, tailor: true });

describe('the musicfit routes and tools (lead)', () => {
  it('plan answers 501 musicfit_not_built after the observe check; an unknown project is 404; a bad body is 400', async () => {
    const s = seed('mf-plan');
    expect(MUSICFIT_SERVER_BUILT).toBe(false);
    const ok = await rest('POST', `/projects/${s.pid}/music-fit/plan`, planBody(s.clipId), headers(grant({ mode: 'edit' })));
    expect([ok.status, ok.body.error?.code]).toEqual([501, 'musicfit_not_built']);
    expect((await rest('POST', `/projects/prj_none/music-fit/plan`, planBody(s.clipId), headers(grant({ mode: 'edit' })))).status).toBe(404);
    expect((await rest('POST', `/projects/${s.pid}/music-fit/plan`, { target: { clipId: s.clipId }, music: { keep: true } }, headers(grant({ mode: 'edit' })))).status).toBe(400);
  });
  it('apply refuses a propose-mode agent and a limited grant (REST and MCP) before anything; an edit grant reaches 501; nothing changes', async () => {
    const s = seed('mf-apply');
    const before = revision(s.pid);
    const body = { ...planBody(s.clipId), expectedRevision: before };
    const propose = grant({ mode: 'propose' });
    const pr = await rest('POST', `/projects/${s.pid}/music-fit/apply`, body, headers(propose));
    expect([pr.status, pr.body.error?.code]).toEqual([403, 'insufficient_scope']);
    expect(pr.body.error.message).toMatch(/fitting music adds a file to the library/);
    const lr = await rest('POST', `/projects/${s.pid}/music-fit/apply`, body, headers(grant({ mode: 'edit', trackIds: ['trk_none'] })));
    expect(lr.status).toBe(403);
    const pt = await mcpCall('tools/call', { name: 'apply_music_fit', arguments: { projectId: s.pid, ...body } }, propose);
    expect(pt.result.isError).toBe(true);
    const ed = await rest('POST', `/projects/${s.pid}/music-fit/apply`, body, headers(grant({ mode: 'edit' })));
    expect([ed.status, ed.body.error?.code]).toEqual([501, 'musicfit_not_built']);
    expect(revision(s.pid)).toBe(before);
  });
  it('the join preview answers 501 after the observe check', async () => {
    const s = seed('mf-join');
    expect(MUSICFIT_JOIN_BUILT).toBe(false);
    const r = await app.fetch(new Request(`${base()}/api/v1/projects/${s.pid}/music-fit/join.wav?assetId=${s.assetId}&from=x&to=y`, { headers: headers(auth.tokens.observer) }));
    expect(r.status).toBe(501);
  });
  it('the heard mark: every agent credential is refused 403 human_approval_required before its body is read; the owner reaches 501; nothing changes', async () => {
    const s = seed('mf-heard');
    const before = revision(s.pid);
    for (const t of [auth.tokens.agent, grant({ mode: 'edit' })]) {
      const bad = await rest('POST', `/projects/${s.pid}/assets/${s.assetId}/music-join/heard`, 'not json', headers(t));
      expect([bad.status, bad.body.error?.code]).toEqual([403, 'human_approval_required']);
      const r = await rest('POST', `/projects/${s.pid}/assets/${s.assetId}/music-join/heard`, { heard: true }, headers(t));
      expect([r.status, r.body.error?.code]).toEqual([403, 'human_approval_required']);
    }
    const owner = await rest('POST', `/projects/${s.pid}/assets/${s.assetId}/music-join/heard`, { heard: true }, ownerHeaders());
    expect([owner.status, owner.body.error?.code]).toEqual([501, 'musicfit_not_built']);
    expect(revision(s.pid)).toBe(before);
  });
  it('MCP lists plan_music_fit and apply_music_fit, the two public ops reach agents as ordinary op tools, and no tool marks a join heard', async () => {
    const list = await mcpCall('tools/list', {}, auth.tokens.agent);
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['plan_music_fit', 'apply_music_fit']));
    expect(names.filter((x) => /heard/.test(x))).toEqual([]);
    const s = seed('mf-mcp');
    const viaTx = await mcpCall('tools/call', { name: 'apply_transaction', arguments: { projectId: s.pid, ops: [{ op: 'mark_join_heard', args: { assetId: s.assetId, heard: true, at: 'x' } }] } }, auth.tokens.agent);
    expect(viaTx.result.isError).toBe(true);
  });
  it('built-in music with an ending other than one bar answers 501 (never a wrong track); with one bar it is today\'s request', async () => {
    const s = seed('mf-builtin');
    const r = await rest('POST', `/projects/${s.pid}/music`, { styleId: 'music.birthday', bars: 4, endFrames: 60000 }, headers(grant({ mode: 'edit' })));
    expect([r.status, r.body.error?.code]).toEqual([501, 'musicfit_not_built']);
    const both = await rest('POST', `/projects/${s.pid}/music`, { styleId: 'music.birthday', fitSeconds: '8', endFrames: 96000 }, headers(grant({ mode: 'edit' })));
    expect([both.status, both.body.error?.code]).toEqual([400, 'invalid_option']);
  });
  it.todo('B: plan and apply for a free clip, a film and a template (two commits; the plan made twice; fit_unstable; flash_gap only for cuts this plan makes)');
  it.todo('A: join.wav equals the made file\'s samples around the join; the owner\'s heard mark commits mark_join_heard as one undoable revision');
});
