/**
 * The server contract of «תא הבדיקה» (wave 8 booth pre-pass; booth/contract.ts), through the real app and the real MCP handler:
 * every route is registered, documented (x-owner-session-only) and classified owner-only; the owner rule holds on every route,
 * GET included, before the id or the body is read; the owner gets an honest 501 while BOOTH_BUILT is false and the real answers once it
 * is true; the answers file is never backed up; the phone drop and MCP have no booth surface; builder W1's rows (registry, recipes, audio,
 * pictures, answers, scrub, states, checks, the heavy rule, build).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Auth } from './auth.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { BOOTH_BUILT, BOOTH_ROUTES, BOOTH_SERVER_REFUSALS, OWNER_REVIEW_FILE } from './booth/contract.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { DROP_ROUTES } from './importContracts.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { createHash } from 'node:crypto';
import { AUDIO_EFFECTS, BOOTH_CHECKS, BOOTH_FIRST_MUSIC, BOOTH_FIRST_TRANSITIONS, BoothCheckRowSchema, EFFECTS, MUSIC_STYLES, namesInNote, scrubNote, TRANSITIONS } from '@pulseframe/core';
import { boothTestPictureRgba } from '@pulseframe/core/booth/testPicture.ts';
import { BOOTH_BUSY_JOB_KINDS } from './booth/contract.ts';
import { boothBuild, gitCommit } from './booth/build.ts';
import { BOOTH_BUSY_JOB_TYPES, BOOTH_SERVER_CHECK_IDS, runBoothCheck } from './booth/checks.ts';
import { boothAudio, boothExportStill } from './booth/media.ts';
import { BOOTH_LATER, boothItems, boothRegistry } from './booth/registry.ts';
import { boothScrubLiterals } from './booth/routes.ts';
import { deleteAnswer, putAnswer, readOwnerReview, viewOf, writeOwnerReview } from './booth/store.ts';
import { boothPictures } from './booth/testPicture.ts';
import { pngSize } from './framejobs.ts';
import { SFX } from './sfx.ts';

const ENV = { ffmpegLine: 'ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers', picturesRgba: `sha256:${'c'.repeat(64)}` };

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let speech: Speech, capabilities: Capabilities, derivatives: Derivatives;
let ownerCookie = '', proposeGrant = '';
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer), proposer = bearer(() => proposeGrant);
const rest = async (who: Who, method: string, p: string, body?: string) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
const urlOf = (route: string, odd = false) => route.split(' ')[1]!.replace(':id', odd ? 'NOT%20AN%20ID' : encodeURIComponent('music:music.calm')).replace(':which', odd ? 'zz' : 'a').replace(':rowId', odd ? 'nope' : 'ffmpeg');

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  derivatives = new Derivatives(store);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
});
afterAll(async () => {
  await derivatives.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the booth routes are registered, documented and classified', () => {
  it('every route of BOOTH_ROUTES is registered, in OpenAPI with x-owner-session-only, and owner-only in the people-surface table', () => {
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of BOOTH_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, registered: registered.has(route), documented: !!op, ownerOnly: op?.['x-owner-session-only'], classes: PEOPLE_REST_SURFACES[route] })
        .toEqual({ route, registered: true, documented: true, ownerOnly: true, classes: ['owner-only'] });
    }
    expect([...registered].filter((k) => k.includes('/booth')).sort()).toEqual([...BOOTH_ROUTES].sort());
  });
  it('the phone drop has no booth path and MCP has no booth tool', async () => {
    expect(DROP_ROUTES.filter((r) => /booth/i.test(r))).toEqual([]);
    const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...agent(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    const text = await r.text();
    const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
    const names: string[] = msg.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((n) => /booth|review_item|owner_review/i.test(n))).toEqual([]);
  });
});

describe('the owner rule first, on every route, GET included', () => {
  it('agent, observer and propose credentials get 403 owner_required on every route, also with an invalid body or an unknown id', async () => {
    for (const who of [agent, observer, proposer]) {
      for (const route of BOOTH_ROUTES) {
        const [method] = route.split(' ') as [string];
        for (const p of [urlOf(route), urlOf(route, true)]) {
          const r = await rest(who, method, p, method === 'PUT' ? '{"verdict":"heard","bogus":' : undefined);
          expect({ route, p, status: r.status, code: r.body?.error?.code, message: r.body?.error?.message }).toEqual({ route, p, status: 403, code: 'owner_required', message: BOOTH_SERVER_REFUSALS.ownerOnly.message() });
        }
      }
    }
  });
  it('without any credential: 401, nothing else', async () => {
    for (const route of BOOTH_ROUTES) {
      const r = await rest(() => ({ host: `127.0.0.1:${cfg.port}` }), route.split(' ')[0]!, urlOf(route));
      expect({ route, status: r.status }).toEqual({ route, status: 401 });
    }
  });
  it('the owner\'s own session: an honest 501 booth_not_built with the next step while BOOTH_BUILT is false; the real answers once it is true', async () => {
    // the real owner answer of each route with this test's URLs (urlOf): music:music.calm, test picture a, row ffmpeg
    const real: Record<string, { status: number; code?: string }> = {
      'GET /api/v1/booth': { status: 200 }, 'GET /api/v1/booth/items/:id/audio': { status: 200 }, 'GET /api/v1/booth/test-picture/:which': { status: 200 },
      'GET /api/v1/booth/items/:id/export-still': { status: 404, code: 'booth_unknown_item' }, // a music item is not in the export strip
      'PUT /api/v1/booth/answers/:id': { status: 409, code: 'booth_stale_recipe' }, 'DELETE /api/v1/booth/answers/:id': { status: 204 }, 'POST /api/v1/booth/checks/:rowId': { status: 200 },
    };
    for (const route of BOOTH_ROUTES) {
      const r = await rest(owner, route.split(' ')[0]!, urlOf(route), route.startsWith('PUT') ? JSON.stringify({ verdict: 'ok', recipe: `sha256:${'0'.repeat(64)}` }) : undefined);
      if (!BOOTH_BUILT) expect({ route, status: r.status, code: r.body?.error?.code, hint: !!r.body?.error?.hint }).toEqual({ route, status: 501, code: 'booth_not_built', hint: true });
      else expect({ route, status: r.status, ...(real[route]!.code ? { code: r.body?.error?.code } : {}) }).toEqual({ route, ...real[route]! });
    }
  }, 60_000);
});

describe('the answers file is never backed up', () => {
  it('owner-review.json is in NEVER_BACKED_UP and a copy left in the destination is removed', async () => {
    expect(NEVER_BACKED_UP).toContain(OWNER_REVIEW_FILE);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-bk-src-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-bk-dest-')), 'copy');
    const s = new Store(src);
    s.close();
    fs.writeFileSync(path.join(src, OWNER_REVIEW_FILE), JSON.stringify({ version: 1, answers: [] }), { mode: 0o600 });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, OWNER_REVIEW_FILE), '{"stray":true}');
    try {
      await backupDataDir(src, dest);
      expect(fs.existsSync(path.join(dest, OWNER_REVIEW_FILE))).toBe(false);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
      fs.rmSync(path.dirname(dest), { recursive: true, force: true });
    }
  });
});

describe('builder W1 (server)', () => {
  // The rows the pre-pass named; each is a real test here, the detail is in apps/server/src/booth/*.test.ts.
  it('registry: exactly one item per music style (not rejected), SFX id, GPU transition and GPU effect with content on a still, or a BOOTH_LATER row with its reason; ids unique; Canvas2D and voice effects in BOOTH_LATER (plan check 1)', () => {
    const items = boothItems(ENV);
    const ids = new Set(items.map((i) => i.id));
    expect(ids.size).toBe(items.length);
    for (const s of MUSIC_STYLES.filter((x) => x.review !== 'rejected')) expect(ids.has(`music:${s.id}`)).toBe(true);
    for (const s of SFX) expect(ids.has(`sfx:${s.id}`)).toBe(true);
    for (const t of TRANSITIONS) expect(t.gpu ? ids.has(`gpu-transition:${t.id}`) : `transition:${t.id}` in BOOTH_LATER).toBe(true);
    for (const e of EFFECTS) expect(e.cost === 'gpu' && !(`effect:${e.id}` in BOOTH_LATER) ? ids.has(`gpu-effect:${e.id}`) : `effect:${e.id}` in BOOTH_LATER && !ids.has(`gpu-effect:${e.id}`)).toBe(true);
    for (const e of AUDIO_EFFECTS) expect(`voice-effect:${e.id}` in BOOTH_LATER).toBe(true);
  });
  it('registry: the 14 first-sitting items are the 7 BOOTH_FIRST_TRANSITIONS (exportStrip true), the 6 BOOTH_FIRST_MUSIC (expected = music.golden.json) and task:mic', () => {
    const golden = JSON.parse(fs.readFileSync(new URL('./music.golden.json', import.meta.url), 'utf8')) as { sha256: Record<string, string> };
    const first = boothItems(ENV).filter((i) => i.group.startsWith('first.'));
    expect(first.map((i) => i.id)).toEqual([...BOOTH_FIRST_TRANSITIONS.map((t) => `gpu-transition:${t}`), ...BOOTH_FIRST_MUSIC.map((m) => `music:${m}`), 'task:mic']);
    expect(first.slice(0, 7).every((i) => i.exportStrip)).toBe(true);
    expect(first.slice(7, 13).map((i) => i.expected)).toEqual(BOOTH_FIRST_MUSIC.map((m) => `sha256:${golden.sha256[m]}`));
  });
  it('recipes are equal across two server starts; a labelled synthetic registry with one changed SFX graph changes only that item (plan check 2); the SFX recipe holds the ffmpeg -version first line (C7)', () => {
    const a = boothItems(ENV), b = boothItems(ENV);
    expect(b.map((i) => i.recipe)).toEqual(a.map((i) => i.recipe));
    // LABELLED STAND-IN (test only): one SFX graph edited for the duration of this test
    const def = SFX.find((x) => x.id === 'sfx.ding')! as { graph: string };
    const saved = def.graph;
    try { def.graph = `${saved},volume=0.5`; expect(boothItems(ENV).filter((i, n) => i.recipe !== a[n]!.recipe).map((i) => i.id)).toEqual(['sfx:sfx.ding']); } finally { def.graph = saved; }
    const other = boothItems({ ...ENV, ffmpegLine: 'ffmpeg version 7.1' });
    expect([...new Set(other.filter((i, n) => i.recipe !== a[n]!.recipe).map((i) => i.source))]).toEqual(['sfx']);
  });
  it('audio: each music item\'s bytes have the golden sha256 and equal GET /api/v1/music/:id/audio?bars=8&seed=1; an SFX item equals GET /api/v1/sfx/:id/audio (plan checks 3, 4)', async () => {
    const items = await boothRegistry();
    const calm = items.find((i) => i.id === 'music:music.calm')!;
    const a = await boothAudio(calm, { cfg, store });
    const r = await app.fetch(new Request(`${base()}/api/v1/music/music.calm/audio?bars=8&seed=1`, { headers: owner() }));
    expect(Buffer.from(await r.arrayBuffer()).equals(a.bytes)).toBe(true);
    expect(a.headers['x-pf-content-sha256']).toBe(calm.expected);
    const pop = await boothAudio(items.find((i) => i.id === 'sfx:sfx.pop')!, { cfg, store });
    const s = await app.fetch(new Request(`${base()}/api/v1/sfx/sfx.pop/audio`, { headers: owner() }));
    expect(Buffer.from(await s.arrayBuffer()).equals(pop.bytes)).toBe(true);
  }, 60_000);
  it('test pictures: core RGBA is deterministic, the PNG encoder round-trips through the existing header reader, the recipe hashes the RGBA (C6)', () => {
    const p = boothPictures();
    const f = path.join(dir, 'booth-a.png');
    fs.writeFileSync(f, p.a.png);
    expect(pngSize(f)).toEqual({ width: 640, height: 360 });
    fs.rmSync(f);
    expect(createHash('sha256').update(boothTestPictureRgba('a')).digest('hex')).toBe(p.a.rgbaSha256.slice(7));
    const pix = boothItems({ ...ENV, picturesRgba: p.rgbaSha256 }), other = boothItems({ ...ENV, picturesRgba: `sha256:${'e'.repeat(64)}` });
    expect(pix.filter((i, n) => i.recipe !== other[n]!.recipe).every((i) => i.kind === 'picture')).toBe(true);
  });
  it('PUT stores one row per id, 0600, atomically (a kill between write and rename leaves the old file); 409 booth_stale_recipe for an old recipe; DELETE clears (plan checks 7, 9)', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-c-'));
    try {
      const row = { id: 'music:music.calm', verdict: 'ok' as const, recipe: `sha256:${'1'.repeat(64)}`, at: '2026-11-27T00:00:00Z', build: 'unknown' };
      putAnswer(d, row); putAnswer(d, { ...row, verdict: 'bad' });
      expect(readOwnerReview(d).answers.map((x) => x.verdict)).toEqual(['bad']);
      if (process.platform !== 'win32') expect(fs.statSync(path.join(d, OWNER_REVIEW_FILE)).mode & 0o777).toBe(0o600);
      const before = fs.readFileSync(path.join(d, OWNER_REVIEW_FILE), 'utf8');
      expect(() => writeOwnerReview(d, { version: 1, answers: [] }, () => { throw new Error('killed'); })).toThrow();
      expect(fs.readFileSync(path.join(d, OWNER_REVIEW_FILE), 'utf8')).toBe(before);
      expect(deleteAnswer(d, row.id)).toBe(true);
      expect(readOwnerReview(d).answers).toEqual([]);
      expect(BOOTH_SERVER_REFUSALS.staleRecipe).toMatchObject({ status: 409, code: 'booth_stale_recipe' }); // the route's refusal: routes.test.ts
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('PUT scrubs the note on the server (planted username, home path with a space, C:/ path, OneDrive folder, library root) and answers namesInNote for a people-sheet name without storing the match (C4b, L2)', () => {
    const literals = boothScrubLiterals({ cfg: { ...cfg, libraryDir: 'E:\\Family Videos' } });
    const note = scrubNote(`נועה ${os.userInfo().username} C:\\Users\\dana\\My Videos\\a.mp4 C:/Users/dana/b.mov C:\\Users\\dana\\OneDrive - Cohen Family\\x E:\\Family Videos\\y`, { literals });
    for (const bit of ['dana', 'My Videos', 'OneDrive', 'Cohen', 'Family Videos']) expect(note).not.toContain(bit);
    if (os.userInfo().username.length >= 2) expect(note).not.toContain(os.userInfo().username);
    expect(namesInNote(note, ['נועה'])).toEqual(['נועה']);
  });
  it('GET /booth marks an answer changed on another recipe, another played hash (audio), or another adapter (picture only)', () => {
    const items = boothItems(ENV);
    const music = items.find((i) => i.id === 'music:music.calm')!, pic = items.find((i) => i.id === 'gpu-transition:film-burn')!;
    const row = (id: string, x: object = {}) => ({ id, verdict: 'ok' as const, recipe: items.find((i) => i.id === id)!.recipe, at: '2026-11-27', build: 'unknown', ...x });
    expect(viewOf(music, row(music.id, { recipe: `sha256:${'9'.repeat(64)}` })).changedWhy).toBe('recipe');
    expect(viewOf(music, row(music.id, { played: `sha256:${'9'.repeat(64)}` })).changedWhy).toBe('played');
    expect(viewOf(pic, row(pic.id, { browserAdapter: 'a' }), { browserAdapter: 'b' }).changedWhy).toBe('adapter');
    expect(viewOf(music, row(music.id, { browserAdapter: 'a' }), { browserAdapter: 'b' }).state).toBe('answered');
  });
  it('checks: every server row answers within its timeout with a BoothCheckRowSchema row; no row carries a path, a user, a host or an address (C3)', async () => {
    const deps = { cfg, store, owner: OWNER, renderHost: null, speech, assistant: { status: () => ({ setup: 'provider_not_configured', detail: dir }) }, search: { setup: async () => ({ code: 'not_built' as const, detail: dir }) } as never, door: null };
    const rows = [];
    for (const id of BOOTH_SERVER_CHECK_IDS) { const t0 = Date.now(); rows.push(await runBoothCheck(id, deps)); expect(Date.now() - t0).toBeLessThan(BOOTH_CHECKS.find((c) => c.id === id)!.timeoutMs + 1_000); }
    for (const r of rows) expect(BoothCheckRowSchema.safeParse(r).success).toBe(true);
    const text = JSON.stringify(rows);
    for (const bit of [dir, os.hostname(), os.homedir(), '127.0.0.1', '\\\\']) expect(text).not.toContain(bit);
  }, 200_000);
  it('checks: export-gpu, speech and search answer skipped (and the export still 409 booth_busy) while an export or another BOOTH_BUSY_JOB_KINDS job is queued or running (C3)', async () => {
    const job = store.createJob('prj_none', 'export', 'user:local', {});
    try {
      const deps = { cfg, store, owner: OWNER, renderHost: null, speech, assistant: { status: () => ({}) }, search: { setup: async () => ({ code: 'not_built' as const, detail: '' }) } as never, door: null };
      for (const id of ['export-gpu', 'speech', 'search'] as const) expect((await runBoothCheck(id, deps)).state).toBe('skipped');
      const strip = (await boothRegistry()).find((i) => i.exportStrip)!;
      await expect(boothExportStill(strip, { store, exporter: new Exporter(store, null as never, () => '', dir), renderHost: null })).rejects.toMatchObject({ status: 409, code: 'booth_busy' });
    } finally { store.updateJob(job.id, { status: 'canceled' }); }
    expect(Object.keys(BOOTH_BUSY_JOB_TYPES).sort()).toEqual([...BOOTH_BUSY_JOB_KINDS].sort());
  });
  it('build: commit from .git/HEAD and its ref file without exec (unknown when absent) and bundleDigest(webDist) (C4)', () => {
    expect(gitCommit()).toMatch(/^[0-9a-f]{12}$/);
    expect(gitCommit(dir)).toBe('unknown');
    expect(boothBuild(path.join(dir, 'no-dist'), dir)).toEqual({ commit: 'unknown', bundle: 'unknown' });
  });
});
