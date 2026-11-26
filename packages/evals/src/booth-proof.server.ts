/**
 * proof:booth — the server part (builder W1, wave 8 booth): B1–B11 of booth-proof.ts. Imported by the lead's entry point at
 * integration; run alone (`tsx packages/evals/src/booth-proof.server.ts`) it prints its rows and exits 0 only when all pass.
 *
 * In this process: the REST app and the MCP endpoint through their fetch handlers (no port). Fixtures are SYNTHETIC, made here and
 * deleted at exit: a temporary data dir; a project named after a child with an asset `נועה-גן-2026.mp4` (ffmpeg testsrc, 1 s) and a
 * person «נועה» with a birth date; a library root «Family Library»; music-kits-heard.json with one row; planted note strings (a home
 * path with a space, a forward-slash path, a OneDrive - <family> folder, a UNC share, an e-mail, loopback and LAN addresses).
 * The export worker is the product's RenderHost (Chromium); on this container its GPU search finds no hardware adapter.
 *
 * HARNESS (labelled): while BOOTH_BUILT is false (before integration) the product app answers 501 on every booth route after the owner
 * check, so the owner's booth calls go to the SAME handlers (apps/server/src/booth/routes.ts boothHarness: registerBoothRoutes with
 * built = true) mounted on a small app whose principal is the owner. Once the lead flips BOOTH_BUILT every call goes through the product app and its owner cookie. The 403 rows
 * (B5) always go through the product app.
 * Nobody here hears or sees anything: every check is an equality, a parse or a search of text.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BOOTH_CHECKS, BOOTH_FIRST_SITTING_CARDS, BOOTH_SCRUB_MARK, BoothCheckRowSchema, boothReport, parseBoothBlock,
  type BoothAnswerResult, type BoothCheckRow, type BoothSay, type BoothView,
} from '@pulseframe/core';
import { Auth } from '@pulseframe/server/auth.ts';
import { planArchive } from '@pulseframe/server/archive.ts';
import { backupDataDir } from '@pulseframe/server/backup.ts';
import { BOOTH_BUILT, BOOTH_ROUTES, OWNER_REVIEW_FILE } from '@pulseframe/server/booth/contract.ts';
import { BOOTH_SERVER_CHECK_IDS } from '@pulseframe/server/booth/checks.ts';
import { BOOTH_LATER, boothItems, boothRegistry, ffmpegFirstLine, sfxSource } from '@pulseframe/server/booth/registry.ts';
import { boothHarness } from '@pulseframe/server/booth/routes.ts';
import { readOwnerReview, writeOwnerReview } from '@pulseframe/server/booth/store.ts';
import { boothPictures } from '@pulseframe/server/booth/testPicture.ts';
import { Capabilities } from '@pulseframe/server/capabilities.ts';
import { loadConfig, type Config } from '@pulseframe/server/config.ts';
import { Derivatives } from '@pulseframe/server/derive.ts';
import { Exporter } from '@pulseframe/server/export.ts';
import { Governance, type Principal } from '@pulseframe/server/governance.ts';
import { createApp } from '@pulseframe/server/http.ts';
import { DROP_ROUTES } from '@pulseframe/server/importContracts.ts';
import { buildImportedAsset, describeMedia } from '@pulseframe/server/ingest.ts';
import { markKitHeard } from '@pulseframe/server/instruments/heard.ts';
import { KITS_HEARD_FILE } from '@pulseframe/server/instruments/contract.ts';
import { createMcp } from '@pulseframe/server/mcp.ts';
import { Presence } from '@pulseframe/server/presence.ts';
import { SFX } from '@pulseframe/server/sfx.ts';
import { Speech } from '@pulseframe/server/speech.ts';
import { Store } from '@pulseframe/server/store.ts';
import { RenderHost } from '../../../apps/renderer/src/index.ts';
import { BOOTH_HE } from '../../i18n/src/booth.ts';
import type { BoothProofStatus } from './booth-proof.ts';

export interface BoothProofRow { id: string; status: BoothProofStatus; sample: string }
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const root = path.resolve(import.meta.dirname, '../../..');
const golden = JSON.parse(fs.readFileSync(path.join(root, 'apps/server/src/music.golden.json'), 'utf8')) as { sha256: Record<string, string> };
const sha = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** The planted values (verify C4c and plan §5 check 10); none may reach the report. */
interface Planted { dataDir: string; libraryRoot: string; projectName: string; assetName: string; person: string; birthDate: string; agentToken: string; strings: string[] }

interface World {
  art: string; cfg: Config; store: Store; auth: Auth; gov: Governance; app: ReturnType<typeof createApp>; mcp: ReturnType<typeof createMcp>; host: RenderHost;
  speech: Speech; capabilities: Capabilities; derivatives: Derivatives; ownerCookie: string; planted: Planted; pid: string;
  rest: (who: 'owner' | 'agent' | 'observer' | 'propose', method: string, p: string, body?: string) => Promise<{ status: number; headers: Headers; json: any; bytes: Buffer }>;
  booth: (method: string, p: string, body?: unknown) => Promise<{ status: number; headers: Headers; json: any; bytes: Buffer }>;
  close: () => Promise<void>;
}

async function makeWorld(): Promise<World> {
  const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-booth-proof-${process.pid}-`));
  const dataDir = path.join(art, 'data'), libraryRoot = path.join(art, 'Family Library');
  fs.mkdirSync(libraryRoot, { recursive: true });
  const cfg: Config = { ...loadConfig({}), dataDir, port: 0, speechPython: null, voicePython: null, backupDir: null, libraryDir: libraryRoot };
  const store = new Store(dataDir);
  const auth = new Auth(cfg);
  const host = new RenderHost();
  const exporter = new Exporter(store, host, () => 'http://127.0.0.1:1/render.html', cfg.webDist);
  const capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  const speech = new Speech(store, cfg);
  const mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  const derivatives = new Derivatives(store);
  const app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { renderHost: host });
  const base = `http://127.0.0.1:${cfg.port}`;
  const ownerCookie = auth.issueSession(new Request(`${base}/api/v1/session`, { headers: { origin: base, 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  const propose = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  // the planted family data
  const projectName = 'הגן של נועה 2026';
  const { doc } = store.createProject({ name: projectName });
  const pid = doc.id;
  const person = 'נועה', birthDate = '2021-03-04';
  store.commit({ projectId: pid, ops: [{ op: 'add_person', args: { name: person, birthDate, form: 'f' } }], actor: 'user:local' });
  const assetName = 'נועה-גן-2026.mp4';
  const clip = path.join(art, 'clip.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=1', '-pix_fmt', 'yuv420p', clip]);
  const bytes = fs.readFileSync(clip), contentHash = sha(bytes);
  const meta = await describeMedia(clip);
  const tmp = path.join(store.tmpDir, 'proof-clip.mp4');
  fs.mkdirSync(store.tmpDir, { recursive: true });
  fs.copyFileSync(clip, tmp);
  store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
  store.commit({ projectId: pid, ops: [{ op: 'import_asset', args: { asset: buildImportedAsset({ meta, name: assetName, contentHash, byteSize: bytes.length, provenance: { origin: 'upload', importedAt: '2026-11-26T00:00:00Z', importedBy: 'user:local' }, capture: null }) } }], actor: 'user:local', allowInternal: true });
  // the kit's own mark file, untouched by the booth (verify C2)
  markKitHeard(dataDir, OWNER, 'kit.calm.vsco', true, '2026-11-26T09:00:00.000Z');
  const planted: Planted = {
    dataDir, libraryRoot, projectName, assetName, person, birthDate, agentToken: auth.tokens.agent,
    strings: ['C:\\Users\\Dana Cohen\\Videos\\גן 2026\\a.mp4', 'C:/Users/dana/Desktop/סרט/b.mov', 'C:\\Users\\dana\\OneDrive - Cohen Family\\Pictures\\c.heic', '\\\\FAMILY-NAS\\photos\\d.jpg', 'dana.cohen@gmail.com', '127.0.0.1', '192.168.1.23'],
  };
  const who = { owner: () => ({ cookie: ownerCookie, origin: base }), agent: () => ({ authorization: `Bearer ${auth.tokens.agent}` }), observer: () => ({ authorization: `Bearer ${auth.tokens.observer}` }), propose: () => ({ authorization: `Bearer ${propose}` }) };
  const answer = async (r: Response) => {
    const ct = r.headers.get('content-type') ?? '';
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, json: ct.includes('json') && buf.length ? JSON.parse(buf.toString('utf8')) : null, bytes: buf };
  };
  const rest: World['rest'] = async (w, method, p, body) => answer(await app.fetch(new Request(`${base}${p}`, { method, headers: { host: `127.0.0.1:${cfg.port}`, 'content-type': 'application/json', ...who[w]() }, ...(body === undefined ? {} : { body }) })));
  // HARNESS while BOOTH_BUILT is false: the same handlers, mounted with built = true, the owner as principal (routes.ts boothHarness)
  const harness = boothHarness({ cfg, store, gov, need: () => OWNER, exporter, renderHost: host, speech, assistant: { status: () => ({ setup: 'provider_not_configured' }) }, search: { setup: async () => ({ code: 'not_built', detail: '' }) } as never, door: null }, OWNER);
  const booth: World['booth'] = async (method, p, body) => {
    const b = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    return BOOTH_BUILT ? rest('owner', method, p, b) : answer(await harness(new Request(`http://127.0.0.1${p}`, { method, headers: { 'content-type': 'application/json' }, ...(b === undefined ? {} : { body: b }) })));
  };
  return {
    art, cfg, store, auth, gov, app, mcp, host, speech, capabilities, derivatives, ownerCookie, planted, pid, rest, booth,
    close: async () => {
      await derivatives.stop(); await mcp.close(); await speech.stop(); await capabilities.stop(); await host.close().catch(() => {}); store.close();
      fs.rmSync(art, { recursive: true, force: true });
    },
  };
}

type Check = (w: World) => Promise<string>; // the sample on a pass; throws Fail on a failure
class Fail extends Error {}
const must = (ok: unknown, why: string) => { if (!ok) throw new Fail(why); };

const sayHe: BoothSay = (key, vars) => {
  const t = (BOOTH_HE as Record<string, string>)[key];
  return t === undefined ? key : t.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? ''));
};

const CHECKS: Record<string, Check> = {
  B1: async () => {
    const items = await boothRegistry();
    const ids = new Set(items.map((i) => i.id));
    must(ids.size === items.length, 'duplicate item ids');
    const first = items.filter((i) => i.group.startsWith('first.'));
    must(first.length === BOOTH_FIRST_SITTING_CARDS, `first sitting has ${first.length} items`);
    const later = Object.keys(BOOTH_LATER);
    must(Object.values(BOOTH_LATER).every((r) => r.length > 20), 'a BOOTH_LATER row without a reason');
    const n = (s: string) => items.filter((i) => i.source === s).length;
    return `${items.length} items (music ${n('music')}, sfx ${n('sfx')}, gpu transitions ${n('gpu-transition')}, gpu effects ${n('gpu-effect')}, task ${n('task')}), ${later.length} later rows, first sitting ${first.length}`;
  },
  B2: async (w) => {
    // two server starts = two separate processes, each computing the registry from scratch
    const script = path.join(w.art, 'recipes.mts');
    fs.writeFileSync(script, `import { boothRegistry } from ${JSON.stringify(pathToFileURL(path.join(root, 'apps/server/src/booth/registry.ts')).href)};\nconst r = await boothRegistry();\nconsole.log(JSON.stringify(r.map((i) => [i.id, i.recipe])));\n`);
    const run = () => execFileSync(path.join(root, 'node_modules/.bin/tsx'), [script], { cwd: root, encoding: 'utf8', timeout: 120_000 }).trim();
    const a = run(), b = run();
    must(a === b, 'the recipes differ between two starts');
    const here = JSON.stringify((await boothRegistry()).map((i) => [i.id, i.recipe]));
    must(here === a, 'this process and a fresh one disagree');
    // LABELLED SYNTHETIC registry: the SFX source with one graph changed
    const env = { ffmpegLine: await ffmpegFirstLine(), picturesRgba: boothPictures().rgbaSha256 };
    const base = boothItems(env);
    const def = SFX.find((s) => s.id === 'sfx.whoosh')! as { graph: string };
    const saved = def.graph;
    let changed: string[];
    try { def.graph = `${saved},volume=0.8`; changed = boothItems(env, undefined).filter((i, k) => i.recipe !== base[k]!.recipe).map((i) => i.id); } finally { def.graph = saved; }
    must(JSON.stringify(changed) === '["sfx:sfx.whoosh"]', `a changed graph changed ${changed.join(', ')}`);
    const other = boothItems({ ...env, ffmpegLine: 'ffmpeg version 0-other' });
    const sources = [...new Set(other.filter((i, k) => i.recipe !== base[k]!.recipe).map((i) => i.source))];
    must(JSON.stringify(sources) === '["sfx"]' && sfxSource.items(env).length === 80, `another ffmpeg line changed ${sources.join(', ')}`);
    return `${JSON.parse(a).length} recipes equal across 2 process starts; one SFX graph changed -> only sfx:sfx.whoosh; ffmpeg line in every SFX recipe ("${env.ffmpegLine.slice(0, 40)}…")`;
  },
  B3: async (w) => {
    const items = (await boothRegistry()).filter((i) => i.source === 'music');
    const out: string[] = [];
    for (const it of items) {
      const b = await w.booth('GET', `/api/v1/booth/items/${encodeURIComponent(it.id)}/audio`);
      must(b.status === 200, `${it.id}: ${b.status}`);
      const m = await w.rest('owner', 'GET', `/api/v1/music/${it.id.slice(6)}/audio?bars=8&seed=1`);
      const g = `sha256:${golden.sha256[it.id.slice(6)]}`;
      must(sha(b.bytes) === g && b.headers.get('x-pf-content-sha256') === g, `${it.id}: the booth bytes are not the golden ones`);
      must(b.bytes.equals(m.bytes), `${it.id}: the booth bytes differ from the music preview`);
      must(b.headers.get('x-pf-expected-match') === '1', `${it.id}: x-pf-expected-match is not 1`);
      out.push(it.id.slice(12));
    }
    return `${out.length}/6 styles equal music.golden.json and GET /music/:id/audio?bars=8&seed=1, x-pf-expected-match 1 (${out.join(', ')})`;
  },
  B4: async (w) => {
    const items = (await boothRegistry()).filter((i) => i.group === 'more.auto-sounds');
    for (const it of items) {
      const b = await w.booth('GET', `/api/v1/booth/items/${encodeURIComponent(it.id)}/audio`);
      const s = await w.rest('owner', 'GET', `/api/v1/sfx/${it.id.slice(4)}/audio`);
      must(b.status === 200 && s.status === 200 && b.bytes.equals(s.bytes), `${it.id}: the booth bytes differ from GET /api/v1/sfx/:id/audio`);
    }
    return `${items.length} auto-used SFX equal GET /api/v1/sfx/:id/audio byte for byte`;
  },
  B5: async (w) => {
    let n = 0;
    for (const who of ['agent', 'observer', 'propose'] as const) {
      for (const route of BOOTH_ROUTES) {
        const [method, p] = route.split(' ') as [string, string];
        const url = p.replace(':id', encodeURIComponent('music:music.calm')).replace(':which', 'a').replace(':rowId', 'ffmpeg');
        const r = await w.rest(who, method, url, method === 'PUT' ? '{"verdict":"heard","x":' : undefined);
        must(r.status === 403 && r.json?.error?.code === 'owner_required', `${who} ${route}: ${r.status} ${r.json?.error?.code}`);
        n++;
      }
    }
    must(DROP_ROUTES.every((r) => !/booth/i.test(r)), 'a booth path in DROP_ROUTES');
    const m = await w.mcp(new Request(`http://127.0.0.1:${w.cfg.port}/mcp`, { method: 'POST', headers: { host: `127.0.0.1:${w.cfg.port}`, authorization: `Bearer ${w.auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) }));
    const t = await m.text();
    const msg = JSON.parse((m.headers.get('content-type') ?? '').includes('text/event-stream') ? t.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : t);
    const tools: string[] = msg.result.tools.map((x: { name: string }) => x.name);
    must(tools.length > 10 && !tools.some((x) => /booth|owner_review/i.test(x)), 'an MCP booth tool');
    return `${n} calls (3 credentials × ${BOOTH_ROUTES.length} routes, PUT with an invalid body) → 403 owner_required; DROP_ROUTES and ${tools.length} MCP tools have no booth entry`;
  },
  B6: async (w) => {
    const labels = async () => JSON.stringify((await w.rest('owner', 'GET', '/api/v1/music')).json);
    const before = await labels();
    const v = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const calm = v.items.find((i) => i.item.id === 'music:music.calm')!.item, pop = v.items.find((i) => i.item.id === 'music:music.pop')!.item;
    must((await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent(calm.id)}`, { verdict: 'ok', recipe: calm.recipe, played: calm.expected })).status === 200, 'PUT ok refused');
    must((await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent(pop.id)}`, { verdict: 'bad', problems: ['too-loud'], recipe: pop.recipe, played: pop.expected })).status === 200, 'PUT bad refused');
    must((await labels()) === before, 'GET /api/v1/music changed after booth answers');
    const after = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const report = boothReport({ view: after, checks: [], date: '2026-11-27' }, sayHe);
    must(report.includes(`- ${pop.id} «${pop.title.he}» — עוצמה גבוהה מדי`), 'the report does not list the bad answer');
    return `2 rows stored; GET /api/v1/music byte-equal before/after (${before.length} bytes); the report lists ${pop.id} under «לא טוב»`;
  },
  B7: async (w) => {
    const v = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const burn = v.items.find((i) => i.item.id === 'gpu-transition:film-burn')!.item;
    must((await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent(burn.id)}`, { verdict: 'ok', recipe: burn.recipe, browserAdapter: 'intel|gen-12lp||', browserSoftware: false })).status === 200, 'PUT refused');
    const other = (await w.booth('GET', `/api/v1/booth?browserAdapter=${encodeURIComponent('nvidia|ampere||')}`)).json as BoothView;
    const pv = other.items.find((i) => i.item.id === burn.id)!;
    must(pv.state === 'changed' && pv.changedWhy === 'adapter', `another adapter: ${pv.state}/${pv.changedWhy}`);
    const f = readOwnerReview(w.cfg.dataDir);
    writeOwnerReview(w.cfg.dataDir, { version: 1, answers: f.answers.map((a) => (a.id === 'music:music.calm' ? { ...a, recipe: `sha256:${'9'.repeat(64)}` } : a)) });
    const now = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const cv = now.items.find((i) => i.item.id === 'music:music.calm')!;
    must(cv.state === 'changed' && cv.changedWhy === 'recipe', `old recipe: ${cv.state}`);
    const stale = await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent('music:music.calm')}`, { verdict: 'ok', recipe: `sha256:${'9'.repeat(64)}` });
    must(stale.status === 409 && stale.json.error.code === 'booth_stale_recipe', `old recipe PUT: ${stale.status}`);
    return `film-burn on another adapter: changed (adapter, «${sayHe('booth.changed.adapter')}»); calm with an old recipe: changed (recipe), counted unanswered; PUT old recipe → 409 booth_stale_recipe`;
  },
  B8: async (w) => {
    const f = path.join(w.cfg.dataDir, KITS_HEARD_FILE);
    const before = fs.readFileSync(f);
    const v = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const mic = v.items.find((i) => i.item.id === 'task:mic')!.item;
    await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent(mic.id)}`, { verdict: 'ok', recipe: mic.recipe });
    await w.booth('POST', '/api/v1/booth/checks/kit');
    must(fs.readFileSync(f).equals(before), 'music-kits-heard.json changed');
    must(!v.items.some((i) => i.item.id.startsWith('kit:')), 'a kit card');
    return `music-kits-heard.json byte-equal after booth answers and the kit row (${before.length} bytes); no kit card (proof:instruments I16/I17 run separately)`;
  },
  B9: async (w) => {
    const file = path.join(w.cfg.dataDir, OWNER_REVIEW_FILE);
    const mode = process.platform === 'win32' ? null : fs.statSync(file).mode & 0o777;
    must(mode === null || mode === 0o600, `mode ${mode?.toString(8)}`);
    const before = fs.readFileSync(file, 'utf8');
    try { writeOwnerReview(w.cfg.dataDir, { version: 1, answers: [] }, () => { throw new Error('killed'); }); } catch { /* the kill */ }
    must(fs.readFileSync(file, 'utf8') === before, 'a kill between write and rename changed the file');
    fs.rmSync(`${file}.tmp`, { force: true });
    const plan = planArchive(w.store, w.pid);
    const archived = JSON.stringify({ doc: plan.doc, manifest: plan.manifest, project: plan.project });
    must(!archived.includes('owner-review') && !archived.includes('music:music.calm') && !archived.includes('booth'), 'the archive mentions the booth');
    const proj = JSON.stringify(w.store.getProject(w.pid).doc);
    must(!proj.includes('music:music.pop'), 'the project document holds an answer');
    const dest = path.join(w.art, 'backup');
    await backupDataDir(w.cfg.dataDir, dest);
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [e.name]));
    must(!walk(dest).includes(OWNER_REVIEW_FILE), 'owner-review.json in the backup');
    return `mode ${mode === null ? 'n/a (Windows)' : `0${mode.toString(8)}`}; a kill before rename left the old file; not in the project, its archive plan or a backup (${walk(dest).length} files copied)`;
  },
  B10: async (w) => {
    const v0 = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const lofi = v0.items.find((i) => i.item.id === 'music:music.lofi')!.item;
    const note = `${w.planted.strings.join(' ')} ${w.planted.libraryRoot}\\x ${os.homedir()}/y ${os.userInfo().username}`.slice(0, 280);
    const put = (await w.booth('PUT', `/api/v1/booth/answers/${encodeURIComponent(lofi.id)}`, { verdict: 'bad', problems: ['harsh'], note, recipe: lofi.recipe })).json as BoothAnswerResult;
    must(put.answer.note?.includes(BOOTH_SCRUB_MARK), 'the note was not scrubbed');
    const checks: BoothCheckRow[] = [];
    for (const id of BOOTH_SERVER_CHECK_IDS.filter((x) => x !== 'export-gpu')) checks.push((await w.booth('POST', `/api/v1/booth/checks/${id}`)).json);
    const view = (await w.booth('GET', '/api/v1/booth')).json as BoothView;
    const report = boothReport({ view, checks, date: '2026-11-27' }, sayHe);
    const bits = [w.planted.dataDir, w.art, os.userInfo().username, os.hostname(), w.planted.projectName, w.planted.assetName, 'נועה-גן', w.planted.person, w.planted.birthDate, w.planted.agentToken, w.planted.libraryRoot, 'Family Library',
      '127.0.0.1', '192.168', 'Dana Cohen', 'Users', 'OneDrive', 'Cohen Family', 'FAMILY-NAS', 'gmail', os.homedir()].filter((b) => b.length >= 3);
    const found = bits.filter((b) => report.toLowerCase().includes(b.toLowerCase()));
    must(found.length === 0, `the report holds ${found.join(' | ')}`);
    const p = parseBoothBlock(report);
    must(p.ok && p.block.answers.length === view.items.filter((i) => i.answer).length, 'the block does not round-trip');
    const lines = report.split('\n');
    const i = lines.findIndex((l) => l.startsWith('-----BEGIN')) + 2;
    const marked = [...lines]; marked[i] = `\u200f${marked[i]}`;
    const one = [...lines]; one[i] = one[i]!.replace(/[0-9a-f](?=[^0-9a-f]*$)/, (c) => (c === '0' ? '1' : '0'));
    const pm = parseBoothBlock(marked.join('\n')), po = parseBoothBlock(one.join('\n'));
    must(!pm.ok && pm.code === 'not_ascii' && !po.ok && po.code === 'checksum', 'a bidi mark or one changed character was accepted');
    return `${bits.length} planted values absent from the ${report.length}-character report; the note stored as «${put.answer.note!.slice(0, 40)}…»; block round-trips ${p.ok ? p.block.answers.length : 0} answers; U+200F → not_ascii, one character → checksum`;
  },
  B11: async (w) => {
    const rows: BoothCheckRow[] = [];
    const times: string[] = [];
    for (const id of BOOTH_SERVER_CHECK_IDS) {
      const t0 = Date.now();
      const r = (await w.booth('POST', `/api/v1/booth/checks/${id}`)).json as BoothCheckRow;
      const ms = Date.now() - t0;
      must(BoothCheckRowSchema.safeParse(r).success, `${id}: not a BoothCheckRowSchema row`);
      must(ms <= BOOTH_CHECKS.find((c) => c.id === id)!.timeoutMs + 2_000, `${id}: ${ms} ms`);
      rows.push(r);
      times.push(`${id} ${r.state}${r.code ? `/${r.code}` : ''} ${ms}ms`);
    }
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    must(by['export-gpu']!.state !== 'ok' || by['export-gpu']!.data.software !== true, 'export-gpu ok on a software adapter');
    must(typeof by.ffmpeg!.data.version === 'string' && /^ffmpeg version/.test(String(by.ffmpeg!.data.version)), 'ffmpeg without its version line');
    const hw = ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc', 'h264_qsv', 'h264_amf'].some((e) => by.ffmpeg!.data[e] === true);
    must(by.ffmpeg!.code === (hw ? 'encoder_present' : 'encoder_absent'), 'the ffmpeg code does not follow the encoders');
    must(!JSON.stringify(by.library).includes('Family'), 'the library row holds the root');
    // heavy rows while an export is queued
    const job = w.store.createJob(w.pid, 'export', 'user:local', {});
    try {
      for (const id of ['export-gpu', 'speech', 'search']) { const r = (await w.booth('POST', `/api/v1/booth/checks/${id}`)).json as BoothCheckRow; must(r.state === 'skipped', `${id} ran during an export`); }
      const s = await w.booth('GET', `/api/v1/booth/items/${encodeURIComponent('gpu-transition:film-burn')}/export-still`);
      must(s.status === 409 && s.json.error.code === 'booth_busy', `export still during an export: ${s.status}`);
    } finally { w.store.updateJob(job.id, { status: 'canceled' }); }
    return `${times.join('; ')}; ffmpeg h264_nvenc ${by.ffmpeg!.data.h264_nvenc} (${by.ffmpeg!.code}); during an export: 3 heavy rows skipped, export still 409 booth_busy (one sample each)`;
  },
};

/** B1–B11, one row each, in order. A check that throws something other than a Fail is a fail with its class name only. */
export async function runBoothServerProof(): Promise<BoothProofRow[]> {
  const w = await makeWorld();
  const rows: BoothProofRow[] = [];
  try {
    for (const [id, check] of Object.entries(CHECKS)) {
      try { rows.push({ id, status: 'pass', sample: await check(w) }); } catch (e) { rows.push({ id, status: 'fail', sample: e instanceof Fail ? e.message : `${(e as Error)?.name ?? 'error'}: ${String((e as Error)?.message ?? e).slice(0, 200)}` }); }
    }
  } finally { await w.close(); }
  if (!BOOTH_BUILT) for (const r of rows) if (r.id !== 'B5' && r.id !== 'B1' && r.id !== 'B2') r.sample = `[harness: BOOTH_BUILT false, booth calls through the same handlers mounted directly] ${r.sample}`;
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const rows = await runBoothServerProof();
  for (const r of rows) console.log(`${r.status.toUpperCase().padEnd(8)} ${r.id.padEnd(4)} ${r.sample}`);
  process.exitCode = rows.every((r) => r.status === 'pass') ? 0 : 1;
  // the render host and the MCP server may keep handles open
  setTimeout(() => process.exit(process.exitCode), 500).unref();
}
