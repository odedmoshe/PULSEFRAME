/**
 * The routes and agent tools of the content packs and built-in music (ADR-0022, plan §7), through the real app and the real
 * MCP handler: GET /api/v1/packs, GET /api/v1/packs/suggest, GET /api/v1/music, GET /api/v1/music/:styleId/audio,
 * POST /api/v1/projects/:id/music, list_catalog → packs and music, add_builtin_music and suggest_packs.
 * - the music add is ONE commit (asset, known grid, clip) that one undo takes back exactly; the same request again is
 *   deduplicated and commits nothing; the storage ceiling, observe and propose modes refuse it with nothing committed;
 * - the preview is exactly the synthesiser's bytes; its refusals are the worded ones;
 * - suggestions come from the caller's day; with a project, the birthdays of its people count only for a credential that may
 *   read birth dates (the owner, a grant with people 'full'), never for one without the people scope.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { birthdayHints, canonical, listMusicStyles, MUSIC_METHOD, musicLayout, PACKS, summarizePack } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { renderMusic } from './music/render.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', proposeGrant = '', namesGrant = '', fullGrant = '';
const R = { num: 30, den: 1 };
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), propose = bearer(() => proposeGrant), names = bearer(() => namesGrant), full = bearer(() => fullGrant);
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}/api/v1${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, type, body: type.includes('json') ? ((await r.json()) as any) : Buffer.from(await r.arrayBuffer()) };
};
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return { isError: !!msg.result?.isError, data: JSON.parse(msg.result.content[0].text) };
}
const hash = (pid: string) => canonical(store.wholeProject(pid).doc);
const newProject = (name: string) => store.createProject({ name, width: 540, height: 960, frameRate: R }).doc.id;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-pack-routes-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 23, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  namesGrant = gov.createGrant({ name: 'names', mode: 'edit' }, OWNER).token;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the lists: packs, music styles and the catalogue', () => {
  it('GET /packs and list_catalog → packs are the packs of this build; GET /music and list_catalog → music are the styles, each unheard', async () => {
    const packs = await rest(observer, 'GET', '/packs');
    expect(packs.status).toBe(200);
    expect(packs.body.packs).toEqual(JSON.parse(JSON.stringify(PACKS.map(summarizePack))));
    expect(packs.body.packs.map((p: { id: string }) => p.id)).toEqual(['pack.hanukkah', 'pack.birthday']);
    const music = await rest(observer, 'GET', '/music');
    expect(music.status).toBe(200);
    expect(music.body.styles).toEqual(JSON.parse(JSON.stringify(listMusicStyles())));
    expect(music.body.styles.length).toBe(6);
    expect(music.body.styles.every((s: { review: string }) => s.review === 'unheard')).toBe(true);
    const cat = await tool(agent, 'list_catalog', {});
    expect(cat.data.packs.map((p: { id: string }) => p.id)).toEqual(['pack.hanukkah', 'pack.birthday']);
    expect(cat.data.music.map((m: { id: string }) => m.id)).toEqual(listMusicStyles().map((m) => m.id));
    expect((await rest(owner, 'GET', '/catalog')).body.music[0].note).toContain('add_builtin_music');
  });
});

describe('GET /music/:styleId/audio', () => {
  it('plays exactly the bytes the synthesiser makes; its refusals are worded', async () => {
    const r = await rest(observer, 'GET', '/music/music.pop/audio?bars=4&seed=2');
    expect([r.status, r.type]).toEqual([200, 'audio/wav']);
    expect((r.body as Buffer).equals((await renderMusic('music.pop', 4, 2)).wav)).toBe(true);
    expect((r.body as Buffer).length).toBe(44 + 16 * 4 * musicLayout('music.pop', 4).samplesPerBeat);
    const refused = async (q: string) => { const x = await rest(observer, 'GET', q); return [x.status, x.body.error?.code, x.body.error?.message]; };
    expect(await refused('/music/music.nope/audio')).toEqual([404, 'not_found', 'there is no built-in music style "music.nope"']);
    expect(await refused('/music/music.pop/audio?bars=33')).toEqual([400, 'invalid_option', 'a preview is 1 to 32 whole bars']);
    expect(await refused('/music/music.pop/audio?bars=x')).toEqual([400, 'invalid_option', 'a preview is 1 to 32 whole bars']);
    expect(await refused('/music/music.pop/audio?bars=2')).toEqual([400, 'invalid_option', 'music.pop is made in whole bars, at least 4; got 2']);
    expect(await refused('/music/music.pop/audio?bars=4&seed=-1')).toEqual([400, 'invalid_option', 'a seed is a whole number from 0 to 1000000']);
  }, 60_000);
});

describe('POST /projects/:id/music and add_builtin_music', () => {
  it('one commit adds the track, its known grid and a clip; the same request again commits nothing; one undo gives the document back exactly', async () => {
    const pid = newProject('music-add');
    const before = hash(pid), rev0 = store.getProject(pid).revision;
    const add = await rest(owner, 'POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, seed: 3, start: T.ZERO });
    expect(add.status).toBe(201);
    const L = musicLayout('music.calm', 4);
    expect(add.body).toMatchObject({ bars: 4, seconds: T.toSeconds(L.duration), revision: rev0 + 1 });
    expect(add.body.clipId).toEqual(expect.any(String));
    const doc = store.getProject(pid).doc;
    const asset = doc.assets[add.body.assetId]!;
    expect(asset.byteSize).toBe(44 + 16 * 4 * L.samplesPerBeat);
    expect(T.eq(asset.duration, L.duration)).toBe(true);
    expect(doc.analyses[add.body.assetId]!.beats!.origin.method).toBe(MUSIC_METHOD);
    expect(doc.analyses[add.body.assetId]!.beats!.sections!.length).toBeGreaterThan(0);
    const again = await rest(owner, 'POST', `/projects/${pid}/music`, { styleId: 'music.calm', bars: 4, seed: 3 });
    expect([again.status, again.body.assetId, again.body.revision, again.body.clipId]).toEqual([201, add.body.assetId, add.body.revision, null]);
    // measuring the beats of the track the route added is refused, and changes nothing
    const analyse = await rest(owner, 'POST', `/projects/${pid}/assets/${add.body.assetId}/analyze`, { kind: 'beats' });
    expect([analyse.status, analyse.body.error.code]).toEqual([409, 'known_by_construction']);
    expect(store.getProject(pid).revision).toBe(add.body.revision);
    expect((await rest(owner, 'POST', `/projects/${pid}/undo`, {})).status).toBe(200);
    expect(hash(pid)).toBe(before);
  }, 60_000);

  it('fitSeconds is rounded up to whole bars; both lengths, neither, or too long are refused with nothing committed', async () => {
    const pid = newProject('music-fit');
    const fit = await rest(owner, 'POST', `/projects/${pid}/music`, { styleId: 'music.pop', fitSeconds: '10' });
    expect([fit.status, fit.body.bars]).toEqual([201, 6]); // 10 s at 128 BPM = 5.33 bars
    const rev = store.getProject(pid).revision;
    const refused = async (b: unknown) => { const x = await rest(owner, 'POST', `/projects/${pid}/music`, b); return [x.status, x.body.error.code, x.body.error.message]; };
    expect(await refused({ styleId: 'music.pop' })).toEqual([400, 'invalid_option', 'give exactly one of bars and fitSeconds']);
    expect(await refused({ styleId: 'music.pop', bars: 600 })).toEqual([400, 'invalid_option', '600 bars of music.pop last 1125 s; a built-in track is at most 300 s (160 bars)']);
    expect(await refused({ styleId: 'music.none', bars: 4 })).toEqual([404, 'not_found', 'there is no built-in music style "music.none"']);
    expect(store.getProject(pid).revision).toBe(rev);
  }, 60_000);

  it('the storage ceiling refuses it (507) and nothing is stored or committed', async () => {
    const pid = newProject('music-ceiling');
    const before = hash(pid);
    const saved = store.maxStorageBytes;
    store.maxStorageBytes = 1;
    try {
      const r = await rest(owner, 'POST', `/projects/${pid}/music`, { styleId: 'music.lofi', bars: 4, seed: 9 });
      expect([r.status, r.body.error.code]).toEqual([507, 'storage_quota_exceeded']);
      const t = await tool(agent, 'add_builtin_music', { projectId: pid, styleId: 'music.lofi', bars: 4, seed: 9 });
      expect([t.isError, t.data.error.code]).toEqual([true, 'storage_quota_exceeded']);
    } finally { store.maxStorageBytes = saved; }
    expect(hash(pid)).toBe(before);
  }, 60_000);

  it('credentials in observe and propose mode are refused with the reason, before anything is made; an edit grant and the agent tool add it', async () => {
    const pid = newProject('music-modes');
    const before = hash(pid);
    const o = await rest(observer, 'POST', `/projects/${pid}/music`, { styleId: 'music.pop', bars: 4 });
    expect([o.status, o.body.error.code]).toEqual([403, 'insufficient_scope']);
    const p = await rest(propose, 'POST', `/projects/${pid}/music`, { styleId: 'music.pop', bars: 4 });
    expect([p.status, p.body.error.code, p.body.error.message]).toEqual([403, 'insufficient_scope', 'this credential may only propose edits, and built-in music cannot be proposed: it is added through an internal step that a proposal does not carry']);
    const pt = await tool(propose, 'add_builtin_music', { projectId: pid, styleId: 'music.pop', bars: 4 });
    expect([pt.isError, pt.data.error.code]).toEqual([true, 'insufficient_scope']);
    expect(hash(pid)).toBe(before);
    const t = await tool(names, 'add_builtin_music', { projectId: pid, styleId: 'music.pop', bars: 4, seed: 1, start: T.ZERO });
    expect(t.isError).toBe(false);
    expect(t.data.clipId).toEqual(expect.any(String));
    const doc = store.getProject(pid).doc;
    expect(doc.assets[t.data.assetId]!.provenance.importedBy).toBe('agent:names');
    expect(store.eventsSince(pid, 0).at(-1)!.actor).toBe('agent:names');
  }, 60_000);
});

describe('GET /packs/suggest and suggest_packs', () => {
  let pid = '';
  beforeAll(async () => {
    pid = newProject('birthdays');
    const r = await rest(owner, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2014-11-04', form: 'f' } }] });
    expect(r.status).toBe(200);
  });
  it('by the date alone: Hanukkah on 2026-11-17 (17 days to the evening of 4 December); nothing on 2027-01-05; a day that is not real is refused', async () => {
    const r = await rest(observer, 'GET', '/packs/suggest?date=2026-11-17');
    expect(r.status).toBe(200);
    expect(r.body.suggestions.map((s: any) => [s.packId, s.daysAway])).toEqual([['pack.hanukkah', 17]]);
    expect(r.body.suggestions[0].reason.he).toBe('חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים');
    expect(r.body.birthdays).toBe('none');
    expect((await rest(observer, 'GET', '/packs/suggest?date=2027-01-05')).body.suggestions).toEqual([]);
    for (const q of ['', '?date=2026-02-30', '?date=17.11.2026']) expect((await rest(observer, 'GET', `/packs/suggest${q}`)).status, q).toBe(400);
    expect((await tool(agent, 'suggest_packs', { date: '2026-11-17' })).data.suggestions[0].packId).toBe('pack.hanukkah');
  });
  it('with a project: its people\'s birthdays count for the owner and a grant with people "full", and never for a credential without the people scope', async () => {
    const q = `/packs/suggest?date=2026-11-01&projectId=${pid}`;
    for (const who of [owner, full]) {
      const r = await rest(who, 'GET', q);
      expect(r.body.birthdays).toBe('used');
      expect(r.body.suggestions.map((s: any) => [s.packId, s.daysAway, s.reason.he])).toEqual([['pack.birthday', 3, 'יום ההולדת של נועה בעוד 3 ימים · 4 בנובמבר']]);
    }
    for (const who of [agent, observer, names]) {
      const r = await rest(who, 'GET', q);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ suggestions: [], birthdays: 'not_readable', note: expect.stringContaining('may not read birth dates') });
      expect(JSON.stringify(r.body)).not.toMatch(/נובמבר|November|11-04/);
    }
    const t = await tool(names, 'suggest_packs', { date: '2026-11-01', projectId: pid });
    expect([t.isError, t.data.suggestions, t.data.birthdays]).toEqual([false, [], 'not_readable']);
    const tf = await tool(full, 'suggest_packs', { date: '2026-11-01', projectId: pid });
    expect(tf.data.suggestions.map((s: any) => s.packId)).toEqual(['pack.birthday']);
  });
  it('birthdayHints: the nearest anniversary, never one before the birth; 29 February is 1 March in common years', () => {
    const P = (birthDate: string | null) => ({ p: { id: 'per_a', name: 'א', birthDate } });
    expect(birthdayHints({ per_a: P('2014-11-04').p }, { y: 2027, m: 1, d: 2 })).toEqual([{ kind: 'birthday', on: { y: 2026, m: 11, d: 4 }, name: 'א' }]);
    expect(birthdayHints({ per_a: P('2020-02-29').p }, { y: 2027, m: 3, d: 1 })).toEqual([{ kind: 'birthday', on: { y: 2027, m: 3, d: 1 }, name: 'א' }]);
    expect(birthdayHints({ per_a: P('2026-12-20').p }, { y: 2026, m: 12, d: 1 })).toEqual([{ kind: 'birthday', on: { y: 2026, m: 12, d: 20 }, name: 'א' }]);
    expect(birthdayHints({ per_a: P('2027-12-20').p }, { y: 2026, m: 12, d: 1 })).toEqual([{ kind: 'birthday', on: { y: 2027, m: 12, d: 20 }, name: 'א' }]);
    expect(birthdayHints({ per_a: P(null).p }, { y: 2026, m: 12, d: 1 })).toEqual([]);
  });
});
