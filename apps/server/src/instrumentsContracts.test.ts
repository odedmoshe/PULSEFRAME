/**
 * Lead contracts of the instruments track on the server (wave 7 «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md §4): the kit
 * routes answer their honest states; the owner's «שמעתי» mark is the owner's own session only (agents, observers and the phone drop get
 * 403 owner_required before anything else; there is no MCP tool); a recorded request is refused BEFORE anything is made (409 with the
 * kit's state, never silently synthesised) through REST, the preview and MCP; a request without `instruments` is today's. With the
 * LABELLED synthetic test kit (packages/fixtures/src/instruments.ts, injected as the app's kit list) the same routes make a recorded
 * track, answer the matched preview and report the kit ready.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MUSIC_KITS, MUSIC_RECORDED_GENERATOR } from '@pulseframe/core';
import { SYNTHETIC_SOURCES, writeSyntheticKit, type SyntheticKit } from '../../../packages/fixtures/src/instruments.ts';
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
import { closeLibraryService, libraryServiceFor } from './library/index.ts';

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
  it('GET /music/kits: every kit with its honest state; no library set → library_not_set; a library without the kit\'s download → item_missing', async () => {
    const r = await rest('GET', '/music/kits', undefined, headers(grant({ mode: 'observe' })));
    expect(r.status).toBe(200);
    expect(r.body.kits.map((k: any) => [k.kitId, k.version, k.styleId, k.state, k.reason, k.heard])).toEqual([['kit.calm.vsco', 1, 'music.calm', 'library_not_set', 'instruments_library_not_set', null]]);
    expect(r.body.kits[0].label.he).toBe('כלים מוקלטים — עוד לא הושמעו לאף אחד');
    expect(r.body.kits[0].parts.map((p: any) => p.part).sort()).toEqual(['arp', 'double', 'lead', 'pad']);
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-instruments-lib-'));
    try {
      const cfg2 = { ...cfg, dataDir: path.join(dir, 'other'), libraryDir: lib };
      fs.mkdirSync(cfg2.dataDir, { recursive: true });
      expect((await listMusicKits(cfg2)).kits.map((k) => [k.state, k.reason])).toEqual([['item_missing', 'instruments_item_missing']]);
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
    expect(INSTRUMENTS_BUILT).toBe(true);
    // no library folder in this world: the kit's own state is the refusal (it was 501 instruments_not_built before integration)
    const pid = store.createProject({ name: 'ins', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const before = store.getProject(pid);
    const add = await rest('POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, instruments: 'recorded' }, ownerHeaders());
    expect([add.status, add.body.error?.code]).toEqual([409, 'instruments_library_not_set']);
    expect(add.body.error.hint).toMatch(/synthesised/);
    const pre = await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&instruments=recorded`, { headers: headers(grant({ mode: 'observe' })) }));
    expect([pre.status, ((await pre.json()) as any).error.code]).toEqual([409, 'instruments_library_not_set']);
    const matched = await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&match=1`, { headers: headers(grant({ mode: 'observe' })) }));
    expect(matched.status).toBe(409); // the pair needs the recorded version too
    expect((await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&instruments=sampled`, { headers: headers(grant({ mode: 'observe' })) }))).status).toBe(400);
    expect((await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=4&match=2`, { headers: headers(grant({ mode: 'observe' })) }))).status).toBe(400);
    const t = await mcpCall('tools/call', { name: 'add_builtin_music', arguments: { projectId: pid, styleId: 'music.calm', bars: 4, instruments: 'recorded' } }, grant({ mode: 'edit' }));
    expect(t.result.isError).toBe(true);
    expect(JSON.stringify(t.result.content)).toMatch(/no library folder is set/);
    const after = store.getProject(pid);
    expect([after.revision, Object.keys(after.doc.assets).length]).toEqual([before.revision, 0]);
  });
  // The rows "library not set / item missing / other commit / a file changed by one byte / a licence the table refuses" and "music fit
  // of a recorded track answers 409 instruments_not_fittable" are real tests in instruments/loader.test.ts (the kit check rows, the
  // fail-closed licence rows and "music fit of a recorded track …"); the other three rows are the describe block below.
});

describe('recorded instruments through the routes, with the LABELLED synthetic test kit as the app\'s kit list (integration)', () => {
  let w: { dir: string; cfg: Config; store: Store; gov: Governance; app: ReturnType<typeof createApp>; mcp: ReturnType<typeof createMcp>; caps: Capabilities; der: Derivatives; lib: SyntheticKit; cookie: string };
  beforeAll(() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-instruments-routes-'));
    const lib = writeSyntheticKit(path.join(d, 'lib'), { strings: SYNTHETIC_SOURCES.ccBy });
    const c: Config = { ...loadConfig({}), dataDir: path.join(d, 'data'), libraryDir: lib.root, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(d, 'speech-models'), backupDir: null };
    fs.mkdirSync(c.dataDir, { recursive: true });
    libraryServiceFor(c, { noStartupBuild: true });
    const st = new Store(c.dataDir);
    const a = new Auth(c);
    const g = new Governance(st);
    a.resolveGrant = (t) => g.principalForToken(t);
    const ex = new Exporter(st, null as never, () => '', path.join(d, 'no-web-dist'));
    const caps = new Capabilities(st, c), der = new Derivatives(st), sp = new Speech(st, c);
    const m = createMcp(st, a, ex, caps, new Presence(), g, sp, der);
    const ap = createApp(c, st, a, ex, caps, der, new Presence(), m, g, undefined, sp, { musicKits: [lib.kit] });
    const cookie = a.issueSession(new Request(`http://127.0.0.1:9/api/v1/session`, { headers: { origin: 'http://127.0.0.1:9', 'x-pf-owner-key': a.tokens.owner } })).split(';')[0]!;
    w = { dir: d, cfg: c, store: st, gov: g, app: ap, mcp: m, caps, der, lib, cookie };
  });
  afterAll(async () => {
    (w.app as any).browserExport?.stop();
    await w.mcp.close(); await w.caps.stop(); await w.der.stop();
    closeLibraryService(w.cfg.dataDir);
    w.store.close();
    fs.rmSync(w.dir, { recursive: true, force: true });
  });
  const h = (t: string) => ({ host: '127.0.0.1:9', authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const roots = () => [w.lib.root, fs.realpathSync(w.lib.root), w.cfg.dataDir];
  const call = async (method: string, p: string, body?: unknown, hd: Record<string, string> = { host: '127.0.0.1:9', origin: 'http://127.0.0.1:9', cookie: w.cookie, 'content-type': 'application/json' }) => {
    const r = await w.app.fetch(new Request(`http://127.0.0.1:9/api/v1${p}`, { method, headers: hd, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
    return { status: r.status, headers: r.headers, bytes: Buffer.from(await r.arrayBuffer()) };
  };
  it('GET /music/kits reports the synthetic kit ready with its sources\' duties; no answer holds an absolute path (I18)', async () => {
    const r = await call('GET', '/music/kits');
    const text = r.bytes.toString('utf8');
    const kits = JSON.parse(text).kits;
    expect(kits.map((k: any) => [k.kitId, k.state, k.reason, k.sources.map((s: any) => [s.licenceId, s.credit])])).toEqual([['kit.calm.synthetic', 'ready', null, [['CC-BY-4.0', true], ['CC0-1.0', false]]]]);
    for (const root of roots()) expect(text.includes(root)).toBe(false);
  });
  it('a recorded add through REST: one asset with MUSIC_RECORDED_GENERATOR and provenance.instruments, one commit, one undo; the same request again gives the same bytes (I15)', async () => {
    const pid = w.store.createProject({ name: 'rec', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const rev0 = w.store.getProject(pid).revision;
    const r = await call('POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' });
    expect(r.status).toBe(201);
    const out = JSON.parse(r.bytes.toString('utf8'));
    expect(out.recorded).toMatchObject({ kitId: 'kit.calm.synthetic', version: 1, label: { en: 'Recorded instruments — nobody has listened yet' } });
    for (const root of roots()) expect(r.bytes.toString('utf8').includes(root)).toBe(false);
    const p = w.store.getProject(pid);
    expect(p.revision).toBe(rev0 + 1);
    const a = p.doc.assets[out.assetId]!;
    expect([a.provenance.procedural?.generator, a.provenance.instruments?.kitId, a.name.endsWith(' · recorded instruments.wav')]).toEqual([MUSIC_RECORDED_GENERATOR, 'kit.calm.synthetic', true]);
    w.store.undo(pid, 'user:local', 'undo');
    expect(Object.keys(w.store.getProject(pid).doc.assets)).toEqual([]);
    const again = await call('POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' });
    const b = w.store.getProject(pid).doc.assets[JSON.parse(again.bytes.toString('utf8')).assetId]!;
    expect(b.contentHash).toBe(a.contentHash);
  }, 60_000);
  it('match=1: x-pf-level-scale ≤ 1 on both versions, scale × rms equal within 0.1 dB, the bytes equal the un-matched preview; every header value is ASCII (I16, I18)', async () => {
    const tok = w.gov.createGrant({ name: 'obs', mode: 'observe' }, USER).token;
    const get = (q: string) => call('GET', `/music/music.calm/audio?bars=4&seed=2${q}`, undefined, h(tok));
    const s0 = await get(''), r0 = await get('&instruments=recorded'), s1 = await get('&match=1'), r1 = await get('&instruments=recorded&match=1');
    expect([s0.status, r0.status, s1.status, r1.status]).toEqual([200, 200, 200, 200]);
    expect([s0.headers.get('x-pf-instruments'), r0.headers.get('x-pf-instruments'), s0.headers.get('x-pf-level-scale'), r1.headers.get('x-pf-instruments')]).toEqual(['synth', 'recorded', null, 'recorded']);
    expect(s1.bytes.equals(s0.bytes) && r1.bytes.equals(r0.bytes)).toBe(true);
    expect(r0.bytes.equals(s0.bytes)).toBe(false);
    const ss = Number(s1.headers.get('x-pf-level-scale')), rs = Number(r1.headers.get('x-pf-level-scale'));
    expect(ss > 0 && ss <= 1 && rs > 0 && rs <= 1 && (ss === 1 || rs === 1)).toBe(true);
    const rms = (b: Buffer) => { let s = 0; for (let i = 44; i < b.length; i += 2) s += b.readInt16LE(i) ** 2; return Math.sqrt(s / ((b.length - 44) / 2)); };
    expect(Math.abs(20 * Math.log10((ss * rms(s1.bytes)) / (rs * rms(r1.bytes))))).toBeLessThan(0.1);
    for (const r of [s0, r0, s1, r1]) r.headers.forEach((v) => expect(/^[\x20-\x7e]*$/.test(v)).toBe(true));
  }, 60_000);
  it('MCP add_builtin_music with instruments recorded reports the kit and the label, and holds no absolute path (I18)', async () => {
    const pid = w.store.createProject({ name: 'mcp', width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
    const tok = w.gov.createGrant({ name: 'ed', mode: 'edit' }, USER).token;
    const r = await w.mcp(new Request('http://127.0.0.1:9/mcp', { method: 'POST', headers: { ...h(tok), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'add_builtin_music', arguments: { projectId: pid, styleId: 'music.calm', bars: 4, seed: 1, instruments: 'recorded' } } }) }));
    const text = await r.text();
    expect(text).toMatch(/kit\.calm\.synthetic/);
    expect(text).toMatch(/nobody has listened yet/);
    expect(text).not.toMatch(/"isError":true/);
    for (const root of roots()) expect(text.includes(root)).toBe(false);
    expect(Object.values(w.store.getProject(pid).doc.assets).map((a) => a.provenance.procedural?.generator)).toEqual([MUSIC_RECORDED_GENERATOR]);
  }, 60_000);
});
