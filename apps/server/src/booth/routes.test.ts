/**
 * The booth routes with their REAL handlers (wave 8 booth), mounted with `built = true` on a small Hono app whose principal comes from a
 * test header (the product app keeps the flag BOOTH_BUILT until the lead flips it; boothContracts.test.ts covers the real app both
 * ways). Plan checks 7 and 9, verify C4b/L2: PUT stores one row, refuses an old recipe and a bad body, scrubs the note on the server
 * with this machine's literals and answers how many people-sheet names it holds without storing the match; GET marks changes.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOTH_BLOCK_BEGIN, BOOTH_BLOCK_END, BOOTH_FIRST_SITTING_CARDS, BOOTH_SCRUB_MARK, boothReport, parseBoothBlock, type BoothAnswerResult, type BoothCheckRow, type BoothSay, type BoothView } from '@pulseframe/core';
import { BOOTH_EN, BOOTH_HE } from '../../../../packages/i18n/src/booth.ts';
import { loadConfig, type Config } from '../config.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { ApiError, Store } from '../store.ts';
import { BOOTH_ROUTES, BOOTH_SERVER_REFUSALS, type BoothEnv } from './contract.ts';
import { registerBoothRoutes } from './routes.ts';
import { ownerReviewPath, readOwnerReview } from './store.ts';

const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const AGENT: Principal = { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] } as Principal;
let dir: string, libDir: string, cfg: Config, store: Store, app: Hono<BoothEnv>, built: Hono<BoothEnv>;
const mk = (isBuilt: boolean) => {
  const a = new Hono<BoothEnv>();
  a.onError((e, c) => (e instanceof ApiError ? c.json(e.toJSON(), e.status as never) : c.json({ error: { code: 'internal_error', message: String(e) } }, 500)));
  a.use('*', async (c, next) => { c.set('principal', c.req.header('x-who') === 'agent' ? AGENT : OWNER); await next(); });
  registerBoothRoutes(a, {
    cfg, store, gov: new Governance(store), need: (c) => c.var.principal, exporter: new Exporter(store, null as never, () => '', path.join(dir, 'no-dist')), renderHost: null,
    speech: { status: async () => ({ transcription: { ready: false, reason: 'engine_not_configured' }, narration: { ready: false, reason: 'engine_not_configured' } }) } as never,
    assistant: { status: () => ({ setup: 'provider_not_configured' }) }, search: { setup: async () => ({ code: 'not_built', detail: 'x' }) } as never, door: null,
  }, isBuilt);
  return a;
};
const call = async (a: Hono<BoothEnv>, method: string, p: string, body?: unknown, who: 'owner' | 'agent' = 'owner') => {
  const r = await a.fetch(new Request(`http://127.0.0.1${p}`, { method, headers: { 'x-who': who, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }));
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, headers: r.headers, json: ct.includes('json') ? ((await r.json()) as any) : null, bytes: ct.includes('json') ? null : Buffer.from(await r.arrayBuffer()) };
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-booth-routes-'));
  libDir = path.join(dir, 'Family Library');
  cfg = { ...loadConfig({}), dataDir: dir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: libDir };
  store = new Store(dir);
  const { doc } = store.createProject({ name: 'גן של נועה 2026' });
  store.commit({ projectId: doc.id, ops: [{ op: 'add_person', args: { name: 'נועה', birthDate: '2021-03-04', form: 'f' } }], actor: 'user:local' });
  app = mk(true);
  built = app;
});
afterAll(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const view = async () => (await call(built, 'GET', '/api/v1/booth')).json as BoothView;

describe('GET /api/v1/booth', () => {
  it('answers the view: the 14 first-sitting items, build and machine, every item unanswered at first', async () => {
    const v = await view();
    expect(v.firstSitting.cards).toBe(BOOTH_FIRST_SITTING_CARDS);
    expect(v.items.filter((i) => v.firstSitting.groups.includes(i.item.group)).length).toBe(14);
    expect(v.items.every((i) => i.state === 'unanswered')).toBe(true);
    expect(v.build.commit).toMatch(/^(?:[0-9a-f]{7,40}|unknown)$/);
    expect(Object.keys(v.machine).sort()).toEqual(['cpus', 'memGiB', 'os']);
  });
  it('an agent gets 403 owner_required on every route, before the id or the body is read; unbuilt routes answer 501 after the owner check', async () => {
    const unbuilt = mk(false);
    for (const route of BOOTH_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const url = p.replace(':id', 'nope').replace(':which', 'zz').replace(':rowId', 'nope');
      const r = await call(app, method, url, method === 'PUT' ? '{"bogus":' : undefined, 'agent');
      expect({ route, status: r.status, code: r.json?.error?.code }).toEqual({ route, status: 403, code: 'owner_required' });
      const u = await call(unbuilt, method, url, method === 'PUT' ? '{"bogus":' : undefined);
      expect({ route, status: u.status, code: u.json?.error?.code }).toEqual({ route, status: 501, code: 'booth_not_built' });
    }
  });
});

describe('answers', () => {
  it('PUT stores one row per id; 404 for an unknown item; 400 booth_invalid_answer; 409 booth_stale_recipe; DELETE clears', async () => {
    const v = await view();
    const calm = v.items.find((i) => i.item.id === 'music:music.calm')!.item;
    const url = `/api/v1/booth/answers/${encodeURIComponent(calm.id)}`;
    const ok = await call(built, 'PUT', url, { verdict: 'ok', recipe: calm.recipe, played: calm.expected });
    expect(ok.status).toBe(200);
    expect((ok.json as BoothAnswerResult).answer).toMatchObject({ id: calm.id, verdict: 'ok', recipe: calm.recipe, played: calm.expected });
    expect((await call(built, 'PUT', url, { verdict: 'skip', recipe: calm.recipe })).status).toBe(200);
    expect(readOwnerReview(dir).answers.filter((a) => a.id === calm.id).map((a) => a.verdict)).toEqual(['skip']);
    if (process.platform !== 'win32') expect(fs.statSync(ownerReviewPath(dir)).mode & 0o777).toBe(0o600);
    expect((await call(built, 'PUT', '/api/v1/booth/answers/music%3Amusic.nope', { verdict: 'ok', recipe: calm.recipe })).json.error.code).toBe('booth_unknown_item');
    for (const bad of ['{"verdict":', { verdict: 'heard', recipe: calm.recipe }, { verdict: 'ok', recipe: calm.recipe, extra: 1 }, { verdict: 'ok' }]) {
      const r = await call(built, 'PUT', url, bad);
      expect({ status: r.status, code: r.json.error.code, message: r.json.error.message }).toEqual({ status: 400, code: 'booth_invalid_answer', message: BOOTH_SERVER_REFUSALS.invalidAnswer.message() });
    }
    const stale = await call(built, 'PUT', url, { verdict: 'ok', recipe: `sha256:${'0'.repeat(64)}` });
    expect({ status: stale.status, code: stale.json.error.code }).toEqual({ status: 409, code: 'booth_stale_recipe' });
    expect((await call(built, 'DELETE', url)).status).toBe(204);
    expect(readOwnerReview(dir).answers.some((a) => a.id === calm.id)).toBe(false);
  });
  it('the note is scrubbed on the SERVER (user, home, host, data and library folders, paths, OneDrive, e-mail) and the people-sheet name is counted, not stored', async () => {
    const v = await view();
    const pop = v.items.find((i) => i.item.id === 'music:music.pop')!.item;
    const user = os.userInfo().username, home = os.homedir(), host = os.hostname();
    const note = `נועה: ${user} ${host} ${home}/a.wav ${libDir}\\x C:/Users/x/a.mp4 C:\\Users\\x\\OneDrive - Cohen Family\\b.mov x@y.z`.slice(0, 280);
    const r = await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(pop.id)}`, { verdict: 'bad', problems: ['too-loud'], note, recipe: pop.recipe });
    const res = r.json as BoothAnswerResult;
    expect(res.namesInNote).toBe(1);
    const stored = fs.readFileSync(ownerReviewPath(dir), 'utf8');
    for (const bit of [user, host, home, libDir, 'Family Library', 'Users', 'OneDrive', 'Cohen', 'x@y.z', 'a.mp4'].filter((b) => b.length >= 2)) {
      expect({ bit, inAnswer: res.answer.note!.includes(bit), inFile: stored.includes(bit) }).toEqual({ bit, inAnswer: false, inFile: false });
    }
    expect(res.answer.note).toContain(BOOTH_SCRUB_MARK);
    // L2: the name stays (warn, never replace) and nothing about the match is stored
    expect(res.answer.note!.startsWith('נועה')).toBe(true);
    expect(stored).not.toMatch(/namesInNote|people|per_/);
    const plain = await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(pop.id)}`, { verdict: 'bad', note: 'רועש מדי', recipe: pop.recipe });
    expect((plain.json as BoothAnswerResult).namesInNote).toBe(0);
  });
  it('GET marks a row changed on another adapter (picture, from the query) and on another recipe in the file', async () => {
    const v = await view();
    const burn = v.items.find((i) => i.item.id === 'gpu-transition:film-burn')!.item;
    await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(burn.id)}`, { verdict: 'ok', recipe: burn.recipe, browserAdapter: 'intel|gen-12lp||', browserSoftware: false });
    const same = (await call(built, 'GET', '/api/v1/booth?browserAdapter=intel%7Cgen-12lp%7C%7C')).json as BoothView;
    expect(same.items.find((i) => i.item.id === burn.id)!.state).toBe('answered');
    const other = (await call(built, 'GET', '/api/v1/booth?browserAdapter=nvidia%7Campere%7C%7C')).json as BoothView;
    expect(other.items.find((i) => i.item.id === burn.id)).toMatchObject({ state: 'changed', changedWhy: 'adapter' });
    // an older build's recipe in the file
    const f = JSON.parse(fs.readFileSync(ownerReviewPath(dir), 'utf8'));
    for (const a of f.answers) if (a.id === burn.id) a.recipe = `sha256:${'9'.repeat(64)}`;
    fs.writeFileSync(ownerReviewPath(dir), JSON.stringify(f));
    expect((await view()).items.find((i) => i.item.id === burn.id)).toMatchObject({ state: 'changed', changedWhy: 'recipe' });
  });
});

describe('pictures, audio and checks', () => {
  it('test pictures a and b are PNGs with their hash; another name is 404', async () => {
    const a = await call(built, 'GET', '/api/v1/booth/test-picture/a');
    expect(a.status).toBe(200);
    expect(a.headers.get('content-type')).toBe('image/png');
    expect(a.headers.get('x-pf-content-sha256')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.bytes!.subarray(1, 4).toString()).toBe('PNG');
    expect((await call(built, 'GET', '/api/v1/booth/test-picture/c')).status).toBe(404);
  });
  it('audio of an SFX item; a picture item has no audio (404)', async () => {
    const r = await call(built, 'GET', `/api/v1/booth/items/${encodeURIComponent('sfx:sfx.click')}/audio`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/wav');
    expect(r.headers.get('x-pf-content-sha256')).toMatch(/^sha256:/);
    expect((await call(built, 'GET', `/api/v1/booth/items/${encodeURIComponent('gpu-transition:flash')}/audio`)).status).toBe(404);
  }, 30_000);
  it('POST a server row answers it; a browser row or an unknown one is 404 booth_unknown_check', async () => {
    const r = await call(built, 'POST', '/api/v1/booth/checks/assistant');
    expect(r.json).toEqual({ id: 'assistant', state: 'setup', code: 'not_installed', data: { setup: 'provider_not_configured' } });
    for (const id of ['browser-gpu', 'mic', 'nope']) expect((await call(built, 'POST', `/api/v1/booth/checks/${id}`)).json.error.code).toBe('booth_unknown_check');
    const lib = await call(built, 'POST', '/api/v1/booth/checks/library');
    expect(JSON.stringify(lib.json)).not.toContain('Family');
  });
});

describe('integration: the copied report on a realistic fixture (lead point 6)', () => {
  const sayOf = (dict: Record<string, string>): BoothSay => (key, vars) => (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? `{${k}}`));
  it('holds no absolute path, user, host, project or media file name; the machine block holds no note text; the mic numbers are there', async () => {
    const v0 = await view();
    const user = os.userInfo().username, home = os.homedir(), host = os.hostname();
    const project = 'גן של נועה 2026', media = 'נועה-גן-2026.mp4';
    const ink = v0.items.find((i) => i.item.id === 'gpu-transition:ink-bleed')!.item;
    const mic = v0.items.find((i) => i.item.kind === 'task')!.item;
    // what an owner might really type: a Windows path into OneDrive with the family name, the project and the media file, a home path
    // with a space, a forward-slash path, the data and library folders, the host and the user name as words
    const note = `ב-${home}/Videos/${media} וגם C:\\Users\\${user}\\OneDrive - Cohen Family\\${project}\\${media}\nC:/Users/${user}/Desktop/${media} ${dir}/x ${libDir}/y המחשב ${host} של ${user}`;
    const r1 = await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(ink.id)}`, { verdict: 'bad', problems: ['flicker'], note: note.slice(0, 280), recipe: ink.recipe, browserAdapter: 'intel|gen-12lp||', browserSoftware: false });
    expect(r1.status).toBe(200);
    const r2 = await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(mic.id)}`, { verdict: 'ok', recipe: mic.recipe, mic: { peakDbfs: -14.2, clipped: 0 } });
    expect(r2.status).toBe(200);
    expect(readOwnerReview(dir).answers.find((a) => a.id === mic.id)!.mic).toEqual({ peakDbfs: -14.2, clipped: 0 });
    // a PUT that tries to carry audio with the measurement is refused
    expect((await call(built, 'PUT', `/api/v1/booth/answers/${encodeURIComponent(mic.id)}`, { verdict: 'ok', recipe: mic.recipe, mic: { peakDbfs: -1, clipped: 0, wav: 'UklGRg==' } })).status).toBe(400);
    const v = (await call(built, 'GET', '/api/v1/booth?browserAdapter=intel%7Cgen-12lp%7C%7C')).json as BoothView;
    const checks: BoothCheckRow[] = [];
    for (const id of ['ffmpeg', 'svg', 'library', 'kit', 'assistant', 'disk', 'drop']) checks.push((await call(built, 'POST', `/api/v1/booth/checks/${id}`)).json as BoothCheckRow);
    for (const say of [sayOf(BOOTH_HE), sayOf(BOOTH_EN)]) {
      const text = boothReport({ view: v, checks, date: '2026-11-26' }, say);
      const word = (w: string) => new RegExp(`(^|[^\\p{L}\\p{N}_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'iu');
      for (const bit of [home, dir, libDir, 'Family Library', 'OneDrive', 'Cohen', 'Users', 'Videos', 'Desktop', project, media, 'נועה-גן'].filter((b) => b.length >= 2)) {
        expect({ bit, inReport: text.includes(bit) }).toEqual({ bit, inReport: false });
      }
      for (const w of [user, host].filter((b) => b.length >= 2)) expect({ w, inReport: word(w).test(text) }).toEqual({ w, inReport: false });
      // no absolute path at all: no drive letter path, no POSIX path from the root, no UNC
      expect(text).not.toMatch(/(?<![\p{L}\p{N}])[A-Za-z]:[\\/]|(?:^|\s)\/[A-Za-z]|\\\\[A-Za-z]/u);
      // the bad answer is listed with its scrubbed note; the mic numbers are in the human part
      const human = text.slice(0, text.indexOf(BOOTH_BLOCK_BEGIN));
      expect(human).toContain(ink.id);
      expect(human).toContain(BOOTH_SCRUB_MARK);
      expect(human).toMatch(/-14\.2 dBFS/);
      // the machine block: no note text (not the mark, not a word of it), the numbers present, the checksum passes
      const block = text.slice(text.indexOf(BOOTH_BLOCK_BEGIN), text.indexOf(BOOTH_BLOCK_END));
      expect(block).not.toMatch(/[\u0590-\u05FF]|\\u05|note/u);
      const p = parseBoothBlock(text);
      expect(p.ok).toBe(true);
      if (!p.ok) return;
      expect(JSON.stringify(p.block)).not.toMatch(/note|\\u05|הוסר|המחשב/);
      expect(p.block.answers.find((a) => a.id === mic.id)!.mic).toEqual({ peakDbfs: -14.2, clipped: 0 });
    }
  }, 60_000);
});
