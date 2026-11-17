/**
 * The people of a project never reach an agent that may not read them (ADR-0021, people section; the owner's conditions of
 * 2026-11-17). Two halves:
 *  1. peopleSurfaces.ts lists EVERY surface an agent credential can reach (each REST route, MCP tool, resource and prompt)
 *     with how people data is filtered on it; this test keeps the list complete both ways.
 *  2. THE WALK: a birth date and a word choice are planted (in the document, in a proposal's operation arguments and entity
 *     states, in an export job's snapshot, in server-sent events), and every listed surface is called with agent
 *     credentials that have no people scope (the built-in agent and observer tokens, a grant left at its default). Every
 *     key, string and number of every answer is searched for the birth date in any spelling, the age it gives at the
 *     capture date under the title (in Hebrew and English), and the word choice; so is every document the renderer is
 *     handed for those credentials. Controls prove the plant: the owner and a grant with people 'full' do read it.
 * The people operations are W1's: until they are built the plant is made as an archive or a later build would hold it.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeOps, type OpCall, type Person, type ProjectDocument } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { PEOPLE_FILTERS, PEOPLE_MCP_RESOURCES, PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { stopTrackingJobs } from './tracking.ts';

// ---------- the plant ----------
/** Born 4 November 2014; the picture under the title was taken on 15 January 2023: she is 8 then («בת 8», "8 years old"). */
const NOA: Person = { id: 'per_noa', name: 'נועה', birthDate: '2014-11-04', form: 'f' };
const CAPTURE = '2023-01-15';
const NEEDLES: readonly RegExp[] = [
  /2014/, /14-11-04|11-04|04-11/, /\b4[./]11\b|\b11[./]4\b|04[./]11|11[./]04/,
  /בת 8|בן 8|גיל 8|בת שמונה|8 years|8½|שמונה וחצי/, /כ״?ב בחשוון|חשוון תשע״ה|תשע״ה/, // the age, and the birth date on the Hebrew calendar (22 Heshvan 5775)
];
/** The first place in these values where the birth date, the age or the word choice shows, or null. */
function familyLeak(...values: unknown[]): string | null {
  let found: string | null = null;
  const text = (s: string, where: string) => { for (const re of NEEDLES) { const m = s.match(re); if (m && found === null) found = `"${m[0]}" in ${where}: ${JSON.stringify(s.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60))}`; } };
  const walk = (v: unknown, where: string): void => {
    if (found !== null) return;
    if (typeof v === 'string') text(v, where);
    else if (typeof v === 'number') { if ([2014, 20141104, 1104, 411].includes(v)) found = `${v} in ${where}`; }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v !== null && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      // the word choice: a `form` of a person, wherever a person sits
      if (Object.hasOwn(o, 'form') && (o.form === 'f' || o.form === 'm') && (Object.hasOwn(o, 'birthDate') || Object.hasOwn(o, 'name'))) found = `form "${String(o.form)}" in ${where}`;
      if (Object.hasOwn(o, 'birthDate') && typeof o.birthDate === 'string') found = `birthDate in ${where}`; // (a JSON Schema of the argument is not one)
      for (const [k, x] of Object.entries(o)) { text(k, `a key of ${where}`); walk(x, `${where}.${k}`); }
    }
  };
  values.forEach((v, i) => walk(v, `value ${i}`));
  return found;
}

// ---------- the server ----------
/** Records every document handed to the renderer (render_frame, contact sheets, proposal frames, colour measurement) and draws a 1×1 picture. */
class RecordingExporter extends Exporter {
  rendered: ProjectDocument[] = [];
  override async renderStill(doc: ProjectDocument, _revision: number, _frameIndex: number, _scale: 1 | 0.5 | 0.25 = 1): Promise<Buffer> {
    this.rendered.push(doc);
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  }
}
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, exporter: RecordingExporter;
let capabilities: Capabilities, derivatives: Derivatives, speech: Speech, presence: Presence;
let pid = '', assetId = '', titleId = '', proposalId = '', exportJobId = '', ownerCookie = '', namesGrant = '', fullGrant = '';
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = { name: string; headers: () => Record<string, string> };
const bearer = (name: string, token: () => string): Who => ({ name, headers: () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' }) });
const AGENT = bearer('agent token', () => auth.tokens.agent), OBSERVER = bearer('observer token', () => auth.tokens.observer), NAMES = bearer('grant with people left at its default', () => namesGrant);
const FULL = bearer('grant with people full', () => fullGrant);
const OWNER_WHO: Who = { name: 'owner session', headers: () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }) };
const WITHOUT_SCOPE = [AGENT, OBSERVER, NAMES];

/** A project as an archive (or a build with the people operations) holds it: a dated picture, a title over it that shows Noa's name and age, a plain title. */
function plantedDocument(contentHash: string): ProjectDocument {
  const prov = { origin: 'upload' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'user:local' };
  const video = { kind: 'video' as const, name: 'birthday.mp4', contentHash, byteSize: 64, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov, capture: { at: CAPTURE, utcOffsetMinutes: null, source: 'manual' as const } };
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `walk${n++}_`, actor: 'user:local', allowInternal });
  const a = tx(createProject({ id: 'prj_walk', name: 'משפחה', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], true);
  assetId = a.results[0]!.output!.assetId as string;
  const withNoa: ProjectDocument = { ...a.doc, people: { [NOA.id]: NOA } };
  const t = tx(withNoa, [
    { op: 'add_clip', args: { assetId, start: f(0), duration: f(120) } },
    { op: 'add_text', args: { text: 'x', start: f(0), duration: f(120) } },
    { op: 'add_text', args: { text: 'כותרת רגילה', start: f(120), duration: f(30) } },
  ]);
  titleId = t.results[1]!.output!.clipId as string;
  return tx(t.doc, [{ op: 'update_text', args: { clipId: titleId, text: '{name:per_noa} {age:per_noa} · {age:per_noa:en} · {date}' } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]).doc;
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-people-walk-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  exporter = new RecordingExporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  // the media file, so that an archive can be written
  let bytes = randomBytes(64), contentHash = '';
  // a hash that does not spell a needle by chance
  for (;;) { contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`; if (!familyLeak(contentHash)) break; bytes = randomBytes(64); }
  const tmp = path.join(store.tmpDir, `walk_${randomBytes(4).toString('hex')}`);
  fs.writeFileSync(tmp, bytes);
  store.putBlob(contentHash, tmp, bytes.length, 'video/mp4');
  const doc = plantedDocument(contentHash);
  pid = store.importProject(doc).doc.id;
  const whole = store.wholeProject(pid).doc;
  // a proposal by a credential that had people 'full': its operation arguments and entity states hold the birth date
  proposalId = `prp_walk${randomBytes(3).toString('hex')}`;
  const ops: OpCall[] = [{ op: 'update_person', args: { personId: NOA.id, birthDate: NOA.birthDate, form: NOA.form } }, { op: 'add_person', args: { name: 'איתי', birthDate: '2014-11-04', form: 'm' } }];
  const changes = [{ id: NOA.id, before: { kind: 'person', person: { ...NOA, birthDate: null } }, after: { kind: 'person', person: NOA } }];
  store.db.prepare('INSERT INTO proposals (id, project_id, actor, grant_id, base_revision, label, ops, changes, summary, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(proposalId, pid, 'agent:full', null, 0, 'ages', JSON.stringify(ops), JSON.stringify(changes), 'Changed the details of "נועה"', 'open', new Date().toISOString());
  // the owner's finished export: its snapshot is the whole document
  const job = store.createJob(pid, 'export', 'user:local', { snapshot: whole, revision: 0, manifest: { options: { format: 'mp4-h264-aac' }, estimate: null }, warnings: [] });
  store.updateJob(job.id, { status: 'succeeded', output: { file: 'walk.mp4', mimeType: 'video/mp4' } });
  exportJobId = job.id;
  namesGrant = gov.createGrant({ name: 'names', mode: 'edit' }, OWNER).token;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
});
afterAll(async () => {
  await stopTrackingJobs(store);
  (app as any).browserExport?.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- calling the surfaces ----------
const PARAMS: Record<string, () => string> = {
  id: () => pid, jobId: () => exportJobId, proposalId: () => proposalId, assetId: () => assetId, token: () => 'rnd_none', kind: () => 'thumb', motionTrackId: () => 'mtk_none',
  capabilityId: () => 'none.cap', recipeId: () => 'none', runId: () => 'run_none', templateId: () => 'none', variantId: () => 'var_none', approvalId: () => 'apr_none', grantId: () => 'grt_none',
  sfxId: () => 'none', modelId: () => 'none', index: () => '0',
};
/** Queries and bodies that reach the part of a route that reads the project; any other POST gets a body its schema refuses. */
const QUERY: Record<string, string> = { [`GET /api/v1/projects/:id/frame`]: '?index=10', 'GET /api/v1/on-this-day': '?date=2024-11-04', [`GET /api/v1/projects/:id/proposals/:proposalId/frame`]: '?index=10' };
const RENAME: OpCall = { op: 'update_person', args: { personId: NOA.id, name: 'נועה' } };
const BODIES: Record<string, unknown> = {
  'POST /api/v1/projects/:id/transactions': { ops: [RENAME] },
  'POST /api/v1/projects/:id/operations': { ops: [RENAME] },
  'POST /api/v1/projects/:id/operations/validate': { ops: [RENAME] },
  'POST /api/v1/projects/:id/proposals': { ops: [RENAME] },
  'POST /api/v1/projects/:id/exports': {},
  'POST /api/v1/projects/:id/exports/plan': {},
  'POST /api/v1/projects/:id/exports/batch': { variantIds: ['var_none'] },
  'POST /api/v1/projects/:id/exports/browser': { sessionId: 'walk-session-1' },
  'POST /api/v1/projects/:id/undo': {}, 'POST /api/v1/projects/:id/redo': {},
  'POST /api/v1/jobs/:jobId/retry': {},
};
const urlOf = (key: string) => { const [method, route] = key.split(' ') as [string, string]; return { method, url: `${base()}${route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(PARAMS[k]!()))}${QUERY[key] ?? ''}` }; };
async function call(who: Who, key: string): Promise<{ status: number; body: unknown }> {
  const { method, url } = urlOf(key);
  const body = method === 'GET' ? undefined : JSON.stringify(Object.hasOwn(BODIES, key) ? BODIES[key] : { __walk: 1 });
  const r = await app.fetch(new Request(url, { method, headers: who.headers(), ...(body === undefined ? {} : { body }) }));
  const type = r.headers.get('content-type') ?? '';
  const buf = Buffer.from(await r.arrayBuffer());
  const headers = Object.fromEntries(r.headers.entries());
  // JSON parsed (so keys are searched); anything else as text, both encodings a reader could use
  const content = type.includes('json') ? JSON.parse(buf.toString('utf8') || 'null') : { utf8: buf.toString('utf8'), latin1: buf.toString('latin1') };
  return { status: r.status, body: { headers, content } };
}
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who.headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return msg.error ? { protocolError: msg.error } : msg.result;
}
/** Tool answers: the JSON of each text part parsed when it is JSON, so its keys are searched too. */
const unpack = (res: any) => ({ ...res, content: (res?.content ?? []).map((c: any) => (c.type === 'text' ? (() => { try { return JSON.parse(c.text); } catch { return c.text; } })() : c)) });
const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  describe_moment: { frameIndex: 10 }, render_frame: { frameIndex: 10 }, render_contact_sheet: { frames: [0, 10, 60] }, get_job: { jobId: '' }, retry_job: { jobId: '' },
  get_transcript: { assetId: '' }, get_analysis: { assetId: '' }, apply_transaction: { ops: [RENAME], dryRun: true }, propose_transaction: { ops: [RENAME] }, export_captions: {},
  export_project: {}, plan_export: {}, preflight: {}, list_proposals: {}, set_view: { frame: 10 }, update_person: { personId: NOA.id, name: 'נועה' }, remove_person: { personId: NOA.id },
  add_person: { name: 'איתי' },
};
const toolArgs = (name: string) => {
  const extra = { ...(TOOL_ARGS[name] ?? {}) };
  if ('jobId' in extra) extra.jobId = exportJobId;
  if ('assetId' in extra) extra.assetId = assetId;
  return { projectId: pid, ...extra };
};

describe('every surface an agent can reach is classified (peopleSurfaces.ts)', () => {
  it('the REST table lists exactly the registered routes', () => {
    const registered = new Set<string>();
    for (const r of app.routes) {
      if (!r.path.startsWith('/api/v1/') && r.path !== '/mcp') continue;
      if (r.path.includes('*') || (r.method === 'ALL' && r.path !== '/mcp')) continue; // middleware (credential, project scope), not a surface
      registered.add(`${r.method.toUpperCase()} ${r.path}`);
    }
    const listed = new Set(Object.keys(PEOPLE_REST_SURFACES));
    expect({ unlisted: [...registered].filter((k) => !listed.has(k)).sort(), gone: [...listed].filter((k) => !registered.has(k)).sort() }).toEqual({ unlisted: [], gone: [] });
    for (const [k, filters] of Object.entries(PEOPLE_REST_SURFACES)) { expect(filters.length, k).toBeGreaterThan(0); for (const x of filters) expect(PEOPLE_FILTERS, k).toContain(x); }
  });
  it('the MCP table lists exactly the registered tools (one per public operation besides), resources and resource templates', async () => {
    const tools: string[] = (await rpc(OWNER_WHO, 'tools/list', {})).tools.map((t: { name: string }) => t.name);
    const ops = new Set(describeOps().map((o) => o.name));
    const fixed = tools.filter((t) => !ops.has(t));
    expect({ unlisted: fixed.filter((t) => !Object.hasOwn(PEOPLE_MCP_TOOLS, t)).sort(), gone: Object.keys(PEOPLE_MCP_TOOLS).filter((t) => !tools.includes(t)).sort() }).toEqual({ unlisted: [], gone: [] });
    for (const op of ops) expect(tools, op).toContain(op);
    const resources: string[] = (await rpc(OWNER_WHO, 'resources/list', {})).resources.map((r: { uri: string }) => r.uri.replace(pid, '{projectId}'));
    const templates: string[] = (await rpc(OWNER_WHO, 'resources/templates/list', {})).resourceTemplates.map((r: { uriTemplate: string }) => r.uriTemplate);
    const listed = Object.keys(PEOPLE_MCP_RESOURCES).filter((k) => k !== 'prompts/*');
    for (const uri of [...new Set([...resources, ...templates])]) expect(listed, uri).toContain(uri);
    for (const uri of listed) expect([...resources, ...templates], uri).toContain(uri);
  });
});

describe('the walk: a planted birth date never reaches a credential without the people scope', () => {
  it('controls: the owner and a grant with people "full" read the birth date, so the plant is there to be found', async () => {
    for (const who of [OWNER_WHO, FULL]) {
      const r = await call(who, `GET /api/v1/projects/:id`);
      expect(r.status, who.name).toBe(200);
      expect(familyLeak(r.body), who.name).not.toBeNull();
    }
    const asProposal = await call(OWNER_WHO, `GET /api/v1/projects/:id/proposals/:proposalId`);
    expect(familyLeak(asProposal.body)).not.toBeNull();
  });

  it('a credential without the scope reads each person\'s id and name (birth date null, no word choice), and is told why ages are empty', async () => {
    for (const who of WITHOUT_SCOPE) {
      const r = await call(who, `GET /api/v1/projects/:id`);
      const content = (r.body as { content: any }).content;
      expect(r.status, who.name).toBe(200);
      expect(content.project.people, who.name).toEqual({ [NOA.id]: { id: NOA.id, name: NOA.name, birthDate: null } });
      expect(content.peopleAccess?.access, who.name).toBe('names');
      const s = (await call(who, `GET /api/v1/projects/:id/summary`)).body as { content: any };
      expect(s.content.people, who.name).toEqual([{ id: NOA.id, name: NOA.name }]);
    }
  });

  for (const who of WITHOUT_SCOPE)
    it(`REST, every route, as the ${who.name}`, async () => {
      exporter.rendered = [];
      const leaks: string[] = [];
      let answered = 0;
      for (const key of Object.keys(PEOPLE_REST_SURFACES)) {
        if (PEOPLE_REST_SURFACES[key]!.includes('renderer-only') || key === 'ALL /mcp' || key === `GET /api/v1/projects/:id/events`) continue;
        const r = await call(who, key);
        if (r.status < 300) answered++;
        const leak = familyLeak(r.body);
        if (leak) leaks.push(`${key} → ${r.status}: ${leak}`);
      }
      expect(answered, 'routes that answered with content, not a refusal').toBeGreaterThan(25);
      if (who !== OBSERVER) expect(exporter.rendered.length, 'documents handed to the renderer').toBeGreaterThan(0);
      const rendered = familyLeak(exporter.rendered);
      if (rendered) leaks.push(`a document handed to the renderer: ${rendered}`);
      expect(leaks).toEqual([]);
    }, 120_000);

  for (const who of WITHOUT_SCOPE)
    it(`MCP, every tool, resource and prompt, as the ${who.name}`, async () => {
      exporter.rendered = [];
      const leaks: string[] = [];
      const tools: string[] = (await rpc(who, 'tools/list', {})).tools.map((t: { name: string }) => t.name);
      for (const name of tools) {
        const res = unpack(await rpc(who, 'tools/call', { name, arguments: toolArgs(name) }));
        const leak = familyLeak(res);
        if (leak) leaks.push(`tool ${name}: ${leak}`);
      }
      const uris = [...(await rpc(who, 'resources/list', {})).resources.map((r: { uri: string }) => r.uri), 'pulseframe://guide', 'pulseframe://ops', 'pulseframe://catalog'];
      for (const uri of new Set(uris)) { const leak = familyLeak(unpack({ content: ((await rpc(who, 'resources/read', { uri })).contents ?? []).map((c: any) => ({ type: 'text', text: c.text })) })); if (leak) leaks.push(`resource ${uri}: ${leak}`); }
      for (const p of (await rpc(who, 'prompts/list', {})).prompts ?? []) { const leak = familyLeak(await rpc(who, 'prompts/get', { name: p.name, arguments: { projectId: pid } })); if (leak) leaks.push(`prompt ${p.name}: ${leak}`); }
      const rendered = familyLeak(exporter.rendered);
      if (rendered) leaks.push(`a document handed to the renderer: ${rendered}`);
      expect(leaks).toEqual([]);
    }, 120_000);

  it('server-sent events: each event is reduced for the credential that listens', async () => {
    const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/events`, { headers: AGENT.headers() }));
    expect(r.status).toBe(200);
    const reader = r.body!.getReader();
    let text = '';
    const read = async (until: (t: string) => boolean) => { const end = Date.now() + 5000; while (!until(text) && Date.now() < end) { const c = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 200))]); if (c && !c.done) text += Buffer.from(c.value).toString('utf8'); } };
    await read((t) => t.includes('event: hello'));
    // events as a request of a credential WITH the scope would emit them, carrying people
    store.events.emit('job', { projectId: pid, id: 'job_walk', type: 'export', status: 'running', stage: null, output: { snapshot: { people: { [NOA.id]: NOA } } }, error: null });
    store.events.emit('proposal', { projectId: pid, id: 'prp_walk', status: 'open', actor: 'agent:full', ops: [{ op: 'add_person', args: { name: 'איתי', birthDate: '2014-11-04', form: 'm' } }], changes: [{ before: { kind: 'person', person: NOA } }] });
    presence.events.emit('presence', { projectId: pid, sessionId: 's', actor: 'agent:full', person: NOA });
    await read((t) => (t.match(/event: (job|proposal|presence)/g) ?? []).length >= 3);
    await reader.cancel();
    expect(text).toMatch(/event: job[\s\S]*event: proposal[\s\S]*event: presence/);
    const events = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)));
    expect(familyLeak(events)).toBeNull();
  });

  it('films and the documents a browser renders them from are refused to a credential without the scope while a title shows an age, and say why', async () => {
    for (const who of WITHOUT_SCOPE) {
      for (const key of [`POST /api/v1/projects/:id/exports`, `POST /api/v1/projects/:id/exports/batch`, `POST /api/v1/projects/:id/exports/browser`, 'GET /api/v1/jobs/:jobId/output', 'POST /api/v1/jobs/:jobId/retry']) {
        const r = await call(who, key);
        const content = (r.body as { content: any }).content;
        // the observer token may not start jobs at all; everyone else meets the people rule
        if (who === OBSERVER && r.status === 403 && content?.error?.code !== 'people_scope_required') continue;
        expect([key, who.name, r.status, content?.error?.code]).toEqual([key, who.name, 403, 'people_scope_required']);
      }
      const tool = unpack(await rpc(who, 'tools/call', { name: 'export_project', arguments: { projectId: pid } }));
      expect(tool.isError, who.name).toBe(true);
    }
  });

  it('a credential without the scope may not GIVE a birth date or a word choice (so a refusal cannot answer a guess), on any path', async () => {
    const give: OpCall = { op: 'update_person', args: { personId: NOA.id, birthDate: '2014-11-05' } };
    for (const who of [AGENT, NAMES]) {
      for (const route of ['transactions', 'operations/validate', 'proposals']) {
        const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/${route}`, { method: 'POST', headers: who.headers(), body: JSON.stringify({ ops: [give] }) }));
        const b = (await r.json()) as any;
        expect([route, r.status, b.error?.code]).toEqual([route, 403, 'people_scope_required']);
        expect(familyLeak(b)).toBeNull();
      }
      const tool = unpack(await rpc(who, 'tools/call', { name: 'update_person', arguments: { projectId: pid, personId: NOA.id, form: 'm' } }));
      expect(tool.isError).toBe(true);
      expect(tool.content[0].error.code).toBe('people_scope_required');
    }
  });

  it('the archive of a credential without the scope holds the names and no birth date; the owner\'s holds them', async () => {
    const tar = async (who: Who) => { const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/archive`, { headers: who.headers() })); return { status: r.status, text: Buffer.from(await r.arrayBuffer()).toString('utf8') }; };
    const agent = await tar(AGENT);
    expect(agent.status).toBe(200);
    expect(agent.text).toContain('נועה');
    expect(familyLeak(agent.text)).toBeNull();
    expect(agent.text).toMatch(/"people": "names"/);
    const owner = await tar(OWNER_WHO);
    expect(owner.text).toContain('2014-11-04');
  });

  it.todo('W2: family=omit (withoutFamily) gives an archive without people whose titles are plain text, for every credential; the family-check lists varying and empty titles');
  it.todo('W1: after PEOPLE_OPS_BUILT, the same walk with the people planted by real add_person / update_person commits of a grant with people "full" (history, undo entries and idempotent replays included)');
});
