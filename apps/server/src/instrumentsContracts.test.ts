/**
 * Lead contracts of the instruments track on the server (wave 7 «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md §4): the kit
 * routes answer their honest states; the owner's «שמעתי» mark is the owner's own session only (agents, observers and the phone drop get
 * 403 owner_required before anything else; there is no MCP tool); a recorded request is refused BEFORE anything is made (501 until built,
 * never silently synthesised) through REST, the preview and MCP; a request without `instruments` is today's. The it.todo rows name
 * what builder W2 must make pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MUSIC_KITS } from '@pulseframe/core';
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
import { INSTRUMENTS_BUILT, KITS_HEARD_FILE } from './instruments/contract.ts';
import { markKitHeard, readKitsHeard } from './instruments/heard.ts';
import { listMusicKits } from './instruments/routes.ts';
import { closeLibraryService } from './library/index.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };

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

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-instruments-contracts-'));
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


describe('recorded instruments: routes and refusals (lead)', () => {
  it('GET /music/kits: every kit with its honest state; no library set → library_not_set; a kit without its checked files → not_calibrated', async () => {
    const r = await rest('GET', '/music/kits', undefined, headers(grant({ mode: 'observe' })));
    expect(r.status).toBe(200);
    expect(r.body.kits.map((k: any) => [k.kitId, k.version, k.styleId, k.state, k.reason, k.heard])).toEqual([['kit.calm.vsco', 1, 'music.calm', 'library_not_set', 'instruments_library_not_set', null]]);
    expect(r.body.kits[0].label.he).toBe('כלים מוקלטים — עוד לא הושמעו לאף אחד');
    expect(r.body.kits[0].parts.map((p: any) => p.part).sort()).toEqual(['arp', 'double', 'lead', 'pad']);
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-instruments-lib-'));
    try {
      const cfg2 = { ...cfg, dataDir: path.join(dir, 'other'), libraryDir: lib };
      fs.mkdirSync(cfg2.dataDir, { recursive: true });
      expect((await listMusicKits(cfg2)).kits.map((k) => [k.state, k.reason])).toEqual([['not_calibrated', 'instruments_kit_not_ready']]);
      closeLibraryService(cfg2.dataDir);
    } finally { fs.rmSync(lib, { recursive: true, force: true }); }
  });
  it('the heard mark: 403 owner_required for agents of every mode (REST), no MCP tool; the owner marks and unmarks; the file is 0600', async () => {
    for (const mode of ['observe', 'propose', 'edit']) {
      const r = await rest('POST', '/music/kits/kit.calm.vsco/heard', { heard: true }, headers(grant({ mode })));
      expect([r.status, r.body.error?.code], mode).toEqual([403, 'owner_required']);
    }
    // the agent learns nothing else: an unknown kit is 403 too, and a bad body is not read
    expect((await rest('POST', '/music/kits/kit.none/heard', 'not json', headers(grant({ mode: 'edit' })))).status).toBe(403);
    const tools = await mcpCall('tools/list', {}, grant({ mode: 'edit' }));
    expect(tools.result.tools.map((t: any) => t.name).filter((n: string) => /kit|heard|instrument/.test(n))).toEqual([]);
    const ok = await rest('POST', '/music/kits/kit.calm.vsco/heard', { heard: true }, ownerHeaders());
    expect(ok.status).toBe(200);
    expect([ok.body.kitId, ok.body.version, typeof ok.body.heard.at]).toEqual(['kit.calm.vsco', 1, 'string']);
    const file = path.join(dir, KITS_HEARD_FILE);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const listed = await rest('GET', '/music/kits', undefined, headers(grant({ mode: 'observe' })));
    expect(listed.body.kits[0].heard).toEqual(ok.body.heard);
    expect(listed.body.kits[0].label.en).toMatch(/^Recorded instruments — the owner listened \(\d{4}-\d{2}-\d{2}\)$/);
    expect((await rest('POST', '/music/kits/kit.none/heard', { heard: true }, ownerHeaders())).status).toBe(404);
    const off = await rest('POST', '/music/kits/kit.calm.vsco/heard', { heard: false }, ownerHeaders());
    expect(off.body.heard).toBeNull();
    expect(readKitsHeard(dir).size).toBe(0);
  });
  it('the phone drop and an agent are not the owner (unit): markKitHeard refuses them before reading the kit', () => {
    const phone: Principal = { actor: 'phone:drp_1', kind: 'user', scopes: ['observe'] };
    expect(() => markKitHeard(dir, phone, 'kit.calm.vsco', true, '2026-11-25T00:00:00Z')).toThrow(/only the owner/);
    const agent: Principal = { actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'], mode: 'edit' } as Principal;
    expect(() => markKitHeard(dir, agent, 'kit.none', true, '2026-11-25T00:00:00Z')).toThrow(/only the owner/);
    expect(markKitHeard(dir, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }, MUSIC_KITS[0]!.id, false, '2026-11-25T00:00:00Z').heard).toBeNull();
  });
  it('a recorded request is refused before anything is made (REST add, preview, MCP); nothing is stored; a bad value is 400', async () => {
    expect(INSTRUMENTS_BUILT).toBe(false);
    const pid = store.createProject({ name: 'ins', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const before = store.getProject(pid);
    const add = await rest('POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, instruments: 'recorded' }, ownerHeaders());
    expect([add.status, add.body.error?.code]).toEqual([501, 'instruments_not_built']);
    expect(add.body.error.hint).toMatch(/synthesised/);
    const pre = await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&instruments=recorded`, { headers: headers(grant({ mode: 'observe' })) }));
    expect(pre.status).toBe(501);
    expect((await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&instruments=sampled`, { headers: headers(grant({ mode: 'observe' })) }))).status).toBe(400);
    expect((await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&match=2`, { headers: headers(grant({ mode: 'observe' })) }))).status).toBe(400);
    const t = await mcpCall('tools/call', { name: 'add_builtin_music', arguments: { projectId: pid, styleId: 'music.calm', bars: 4, instruments: 'recorded' } }, grant({ mode: 'edit' }));
    expect(t.result.isError).toBe(true);
    expect(JSON.stringify(t.result.content)).toMatch(/recorded instruments are not built/);
    const after = store.getProject(pid);
    expect([after.revision, Object.keys(after.doc.assets).length]).toEqual([before.revision, 0]);
  });
  it.todo('W2: with a synthetic library and the labelled test kit, a recorded request makes one asset with MUSIC_RECORDED_GENERATOR and provenance.instruments (one commit, one undo), and the same request again gives the same bytes (I15)');
  it.todo('W2: library not set / item missing / other commit / a file changed by one byte / a licence the table refuses → the named 409, nothing stored (I10, I11, L-D3)');
  it.todo('W2: match=1 answers x-pf-level-scale ≤ 1, scale × rms equal within 0.1 dB, the bytes equal the un-matched preview; every header value is ASCII (I16, I18)');
  it.todo('W2: GET /music/kits reports ready and the sources\' duties for a checked synthetic kit, and no answer holds an absolute path (I18)');
  it.todo('W2: music fit of a recorded track answers 409 instruments_not_fittable and changes nothing');
});
