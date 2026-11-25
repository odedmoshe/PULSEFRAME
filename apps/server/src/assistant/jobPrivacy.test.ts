/**
 * A request to the language assistant is the owner's own (ADR-0027, note of 2026-11-25; assistant/visibility.ts): the job it runs
 * and the proposal it leaves are whole only for the owner's own session. THE WALK: words are planted in what the owner typed, in
 * the labelled MOCK adapter's explanation, in the operations it proposes, in a service error and in an invalid answer; then every
 * surface an agent credential can reach is called (every REST route of peopleSurfaces.ts, whose table peopleSurfaces.test.ts keeps
 * equal to the registered routes; every MCP tool that reads, names a job or a proposal; every resource; the event stream) with an
 * observer, the agent token and grants of every mode, and the planted words must be nowhere. Controls prove the plant: the owner's
 * session reads them. Before the rule, GET /jobs/:jobId, MCP get_job and the event stream handed the explanation, the proposal id,
 * the cost and the error text to any observer of the project, and the proposals routes handed over the operations.
 * Also here: exactly what a job row keeps of a request (never the typed text), and where the explanation is stored.
 * The assistant is the labelled MOCK adapter (testAdapter.ts); the key is a labelled test double. No provider, no port, no network.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASSISTANT_ACTOR, ASSISTANT_JOB_TYPE } from '@pulseframe/core';
import { ChatProviderError } from '@pulseframe/providers';
import { Auth } from '../auth.ts';
import { archiveBlobs } from '../archive.ts';
import { backupDataDir } from '../backup.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { PEOPLE_REST_SURFACES } from '../peopleSurfaces.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { f, plantedProject } from './assistantFixture.ts';
import { mockToolAnswer, TestChatAdapter } from './testAdapter.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-job-privacy-7e42';
const HOST = 'api.example.test';
// ---------- the plant: words found nowhere else in the fixture ----------
const TYPED_MARK = 'קישקושון', EXPL_MARK = 'זרזיפון', OPS_MARK = 'אבטיחונת', ERR_MARK = 'צפרדעונת', BAD_MARK = 'op_gvinonet';
const TYPED = `הוסף סמן בשם ${TYPED_MARK} אחרי השיר`;
const MARKS = [TYPED_MARK, EXPL_MARK, OPS_MARK, ERR_MARK, BAD_MARK] as const;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let derivatives: Derivatives, capabilities: Capabilities, speech: Speech;
let pid = '', ownerCookie = '', okJob = '', errJob = '', badJob = '', proposalId = '';
const adapter = new TestChatAdapter();
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = { name: string; headers: () => Record<string, string> };
const tokens: Record<string, string> = {};
const bearer = (name: string, token: () => string): Who => ({ name, headers: () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' }) });
const OWNER_WHO: Who = { name: 'the owner\'s session', headers: () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }) };
/** Every kind of credential that is not the owner's session: none of them reads the assistant's work, whatever its grant. */
const OTHERS: Who[] = [
  bearer('the observer token', () => auth.tokens.observer), bearer('the agent token', () => auth.tokens.agent),
  bearer('an observe grant', () => tokens.observe!), bearer('a propose grant', () => tokens.propose!), bearer('an edit grant', () => tokens.edit!),
  bearer('an autopilot grant of this project', () => tokens.autopilot!), bearer('an edit grant with people full', () => tokens.full!),
];
const fetchRaw = async (who: Who, method: string, url: string, body?: unknown) => {
  const r = await app.fetch(new Request(url, { method, headers: who.headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get('content-type') ?? '', buf, headers: JSON.stringify(Object.fromEntries(r.headers.entries())) };
};
const rest = async (who: Who, method: string, p: string, body?: unknown) => { const r = await fetchRaw(who, method, `${base()}/api/v1${p}`, body); return { status: r.status, body: (r.type.includes('json') && r.buf.length ? JSON.parse(r.buf.toString('utf8')) : null) as any }; };
let rpcId = 0;
const rpc = async (who: Who, method: string, params: unknown): Promise<{ text: string; result: any }> => {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who.headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const raw = await r.text();
  const text = (r.headers.get('content-type') ?? '').includes('text/event-stream') ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : raw;
  const msg = JSON.parse(text);
  return { text, result: msg.result ?? { protocolError: msg.error } };
};
/** The planted word a text holds, in the bytes as sent and with JSON's \u escapes undone, or null. */
const markIn = (text: string): string | null => {
  const plain = text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return MARKS.find((m) => text.includes(m) || plain.includes(m)) ?? null;
};
const ask = async (text = TYPED) => { const r = await rest(OWNER_WHO, 'POST', `/projects/${pid}/assistant/requests`, { text, selection: [], playheadFrame: 0 }); expect(r.status).toBe(202); return r.body.jobId as string; };
const settled = async (jobId: string) => {
  for (let i = 0; i < 400; i++) { const j = store.getJob(jobId); if (['succeeded', 'failed', 'submission-unknown', 'canceled'].includes(j.status)) return j; await new Promise((res) => setTimeout(res, 10)); }
  return store.getJob(jobId);
};
const answers = {
  ok: () => mockToolAnswer([{ op: 'add_marker', args: { time: f(45), label: OPS_MARK } }], `MOCK ${EXPL_MARK}`),
  err: () => ({ throw: new ChatProviderError('bad_request', false, `MOCK: ${ERR_MARK}`) }),
  bad: () => mockToolAnswer([{ op: BAD_MARK, args: {} }], `MOCK ${EXPL_MARK}`),
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ajp-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, backupDir: null, assistantHosts: [HOST] };
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
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { assistant: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null } });
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = plantedProject(store).pid;
  for (const [name, mode, extra] of [['observe', 'observe', {}], ['propose', 'propose', {}], ['edit', 'edit', {}], ['autopilot', 'autopilot', { projectIds: [pid] }], ['full', 'edit', { people: 'full' }]] as const)
    tokens[name] = gov.createGrant({ name: `walk-${name}`, mode, ...extra }, OWNER).token;
  expect((await rest(OWNER_WHO, 'PUT', '/assistant/config', { adapter: adapter.id, host: HOST, model: 'mock-model', pricesCentsPerMTok: { input: 300, output: 1500 }, monthlyLimitCents: 100_000, perRequestCapCents: 10_000, toggles: { titlesAndMarkers: false, peopleNames: false } })).status).toBe(200);
  expect((await rest(OWNER_WHO, 'PUT', '/assistant/key', { key: KEY })).status).toBe(200);
  // three requests of the owner: one answered with a proposal, one the service refuses, one whose answer is not valid
  adapter.queue(answers.ok()); okJob = await ask(); expect((await settled(okJob)).status).toBe('succeeded');
  adapter.queue(answers.err()); errJob = await ask(); expect((await settled(errJob)).status).toBe('failed');
  adapter.queue(answers.bad()); badJob = await ask(); expect((await settled(badJob)).status).toBe('failed');
  proposalId = store.getJob(okJob).output.proposalId as string;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('controls: the plant is there to be found', () => {
  it('the owner\'s session reads the explanation, the error texts and the proposed operations', async () => {
    const ok = await rest(OWNER_WHO, 'GET', `/jobs/${okJob}`);
    expect(ok.body).toMatchObject({ status: 'succeeded', actor: ASSISTANT_ACTOR, output: { proposalId, explanation: `MOCK ${EXPL_MARK}`, opsCount: 1, costBasis: 'reported' } });
    expect((await rest(OWNER_WHO, 'GET', `/jobs/${errJob}`)).body.error.message).toContain(ERR_MARK);
    expect((await rest(OWNER_WHO, 'GET', `/jobs/${badJob}`)).body.error.message).toContain(BAD_MARK);
    const viaTool = await rpc(OWNER_WHO, 'tools/call', { name: 'get_job', arguments: { jobId: okJob } });
    expect(viaTool.text).toContain(EXPL_MARK);
    const listed = await rest(OWNER_WHO, 'GET', `/projects/${pid}/proposals`);
    expect(listed.body.proposals.map((p: { id: string }) => p.id)).toContain(proposalId);
    expect(JSON.stringify(listed.body)).toContain(OPS_MARK);
    expect((await rest(OWNER_WHO, 'GET', `/projects/${pid}/proposals/${proposalId}`)).body.proposal).toMatchObject({ id: proposalId, actor: ASSISTANT_ACTOR, status: 'open' });
    expect((await rpc(OWNER_WHO, 'tools/call', { name: 'list_proposals', arguments: { projectId: pid } })).text).toContain(proposalId);
  });
});

describe('anyone but the owner\'s session reads of an assistant job its id, project, type, status and times, and nothing else of it', () => {
  for (const who of OTHERS) it(`GET /jobs/:jobId and MCP get_job as ${who.name}`, async () => {
    for (const [jobId, status] of [[okJob, 'succeeded'], [errJob, 'failed'], [badJob, 'failed']] as const) {
      const row = store.getJob(jobId);
      const want = { id: jobId, projectId: pid, type: ASSISTANT_JOB_TYPE, actor: ASSISTANT_ACTOR, status, createdAt: row.createdAt, updatedAt: row.updatedAt };
      const viaRest = await rest(who, 'GET', `/jobs/${jobId}`);
      expect(viaRest.status).toBe(200);
      expect(viaRest.body).toEqual(want); // no output, no error, no stage, no attempt, no revision (the actor is the same for every assistant job)
      const viaTool = await rpc(who, 'tools/call', { name: 'get_job', arguments: { jobId } });
      expect(JSON.parse(viaTool.result.content[0].text)).toEqual(want);
    }
  });
  it('the assistant\'s proposal is not listed, not answered by id (as an id that does not exist), not rendered; other proposals still are', async () => {
    const edit = OTHERS.find((w) => w.name === 'an edit grant')!, propose = OTHERS.find((w) => w.name === 'a propose grant')!;
    const own = await rest(propose, 'POST', `/projects/${pid}/proposals`, { ops: [{ op: 'add_marker', args: { time: f(90), label: 'an agent\'s own' } }] });
    expect(own.status).toBe(201);
    for (const who of OTHERS) {
      const listed = await rest(who, 'GET', `/projects/${pid}/proposals`);
      expect(listed.body.proposals.map((p: { id: string }) => p.id), who.name).toEqual([own.body.proposalId]);
      const byId = await rest(who, 'GET', `/projects/${pid}/proposals/${proposalId}`), missing = await rest(who, 'GET', `/projects/${pid}/proposals/prp_does_not_exist`);
      expect([byId.status, byId.body.error.code], who.name).toEqual([404, 'proposal_not_found']);
      expect(byId.body.error.message.replace(proposalId, 'ID')).toBe(missing.body.error.message.replace('prp_does_not_exist', 'ID'));
      expect((await rest(who, 'GET', `/projects/${pid}/proposals/${proposalId}/frame`)).status, who.name).toBe(404);
      const viaTool = await rpc(who, 'tools/call', { name: 'list_proposals', arguments: { projectId: pid } });
      expect(JSON.parse(viaTool.result.content[0].text).proposals.map((p: { id: string }) => p.id), who.name).toEqual([own.body.proposalId]);
    }
    expect((await rest(edit, 'POST', `/projects/${pid}/proposals/${proposalId}/accept`)).status).toBe(404);
    expect(store.db.prepare('SELECT status FROM proposals WHERE id = ?').get(proposalId)).toEqual({ status: 'open' });
  });
});

describe('the walk: the planted words reach no credential but the owner\'s session, on any surface', () => {
  const PARAMS = (jobId: string): Record<string, string> => ({ id: pid, jobId, proposalId, sequenceId: 'seq_main', index: '0', kind: 'thumb' });
  for (const who of OTHERS) it(`REST, every route, as ${who.name}`, async () => {
    const leaks: string[] = [];
    let called = 0, answered = 0;
    for (const key of Object.keys(PEOPLE_REST_SURFACES)) {
      const [method, route] = key.split(' ') as [string, string];
      if (PEOPLE_REST_SURFACES[key]!.includes('renderer-only') || key === 'ALL /mcp' || route.endsWith('/events')) continue; // the event stream has its own test below
      // every read; and every write that names a job, a proposal or the assistant (a refusal or an answer about them is searched too).
      // Other writes change the project and answer about their own change, never about a job.
      if (method !== 'GET' && !/:jobId|proposal|assistant/.test(route)) continue;
      for (const jobId of route.includes(':jobId') ? [okJob, errJob, badJob] : [okJob]) {
        const params = PARAMS(jobId);
        const url = `${base()}${route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? 'none'))}`;
        const r = await fetchRaw(who, method, url, method === 'GET' ? undefined : { __walk: 1 });
        called++;
        if (r.status < 300) answered++;
        const found = markIn(r.buf.toString('utf8')) ?? markIn(r.buf.toString('latin1')) ?? markIn(r.headers);
        if (found) leaks.push(`${key} → ${r.status}: ${found}`);
      }
    }
    expect(called, 'routes called').toBeGreaterThan(80);
    expect(answered, 'routes that answered with content, not a refusal').toBeGreaterThan(25);
    expect(leaks).toEqual([]);
  }, 120_000);
  for (const who of OTHERS) it(`MCP, every tool that reads or names a job or a proposal, every resource and prompt, as ${who.name}`, async () => {
    const leaks: string[] = [];
    const tools = (await rpc(who, 'tools/list', {})).result.tools as { name: string; annotations?: { readOnlyHint?: boolean }; inputSchema?: { properties?: Record<string, unknown> } }[];
    const walked = tools.filter((t) => t.annotations?.readOnlyHint || Object.hasOwn(t.inputSchema?.properties ?? {}, 'jobId') || /propos/.test(t.name));
    expect(walked.map((t) => t.name)).toEqual(expect.arrayContaining(['get_job', 'cancel_job', 'retry_job', 'list_proposals', 'get_summary', 'get_timeline']));
    for (const t of walked) for (const jobId of Object.hasOwn(t.inputSchema?.properties ?? {}, 'jobId') ? [okJob, errJob, badJob] : [okJob]) {
      const res = await rpc(who, 'tools/call', { name: t.name, arguments: { projectId: pid, jobId, frameIndex: 10, frames: [0, 10], ...(t.name === 'propose_transaction' ? { ops: [] } : {}) } });
      const found = markIn(res.text);
      if (found) leaks.push(`tool ${t.name}: ${found}`);
    }
    const uris = [...((await rpc(who, 'resources/list', {})).result.resources ?? []).map((r: { uri: string }) => r.uri), 'pulseframe://guide', 'pulseframe://ops', 'pulseframe://catalog', `pulseframe://projects/${pid}/summary`, `pulseframe://projects/${pid}/timeline`];
    for (const uri of new Set(uris)) { const found = markIn((await rpc(who, 'resources/read', { uri })).text); if (found) leaks.push(`resource ${uri}: ${found}`); }
    for (const p of (await rpc(who, 'prompts/list', {})).result.prompts ?? []) { const found = markIn((await rpc(who, 'prompts/get', { name: p.name, arguments: { projectId: pid } })).text); if (found) leaks.push(`prompt ${p.name}: ${found}`); }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('the event stream: a listener other than the owner\'s session gets an assistant job as id, type, status and times, and no word of its proposal', async () => {
    const listen = async (who: Who) => {
      const r = await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/events`, { headers: who.headers() }));
      expect(r.status).toBe(200);
      const reader = r.body!.getReader();
      const s = { text: '' };
      const read = async (until: (t: string) => boolean) => { const end = Date.now() + 5000; while (!until(s.text) && Date.now() < end) { const c = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), 100))]); if (c && !c.done) s.text += Buffer.from(c.value).toString('utf8'); } };
      await read((t) => t.includes('event: hello'));
      return { s, read, close: () => reader.cancel() };
    };
    const listeners = await Promise.all([OWNER_WHO, ...OTHERS].map(async (who) => ({ who, ...(await listen(who)) })));
    // while they listen: a request answered with a proposal, one the service refuses, one whose answer is not valid
    adapter.queue(answers.ok()); const a = await ask(); await settled(a);
    adapter.queue(answers.err()); const b = await ask(); await settled(b);
    adapter.queue(answers.bad()); const c = await ask(); await settled(c);
    const ended = (t: string) => [a, b, c].every((id) => new RegExp(`"id":"${id}"[^\\n]*"status":"(succeeded|failed)"`).test(t));
    for (const l of listeners) { await l.read(ended); await l.close(); }
    const events = (t: string, kind: string) => t.split('\n\n').filter((x) => x.includes(`event: ${kind}`)).map((x) => JSON.parse(x.split('\n').find((y) => y.startsWith('data:'))!.slice(5)));
    const [owner, ...others] = listeners;
    // control: the owner's own session is told everything, as before
    expect(owner!.s.text).toContain(EXPL_MARK);
    expect(owner!.s.text).toContain(ERR_MARK);
    expect(events(owner!.s.text, 'proposal').some((e) => e.actor === ASSISTANT_ACTOR)).toBe(true);
    for (const l of others) {
      expect(ended(l.s.text), `${l.who.name} heard the three jobs end`).toBe(true);
      expect(markIn(l.s.text), l.who.name).toBeNull();
      const jobs = events(l.s.text, 'job');
      expect(jobs.length, l.who.name).toBeGreaterThanOrEqual(6);
      for (const e of jobs) expect(Object.keys(e).sort(), l.who.name).toEqual(['actor', 'createdAt', 'id', 'projectId', 'status', 'type', 'updatedAt']);
      expect(events(l.s.text, 'proposal').filter((e) => e.actor === ASSISTANT_ACTOR), l.who.name).toEqual([]);
    }
  }, 60_000);
});

describe('what is kept of a request (ADR-0027 decision 12)', () => {
  it('the job row: digests and sizes, never the typed text; the explanation is stored in its output; the proposal holds the operations', async () => {
    const row = store.getJob(okJob);
    expect(Object.keys(row.input).sort()).toEqual(['adapter', 'estimate', 'host', 'kind', 'maxOutputTokens', 'model', 'projectRevision', 'promptDigest', 'requestedBy', 'reservationBasis', 'reservedCents', 'sequenceId', 'summary', 'text']);
    expect(Object.keys(row.input.text).sort()).toEqual(['chars', 'sha256']); // a digest and a length of what was typed
    expect(row.input.text.chars).toBe([...TYPED].length);
    expect(Object.keys(row.input.summary).sort()).toEqual(['bytes', 'folded', 'sent', 'sha256']);
    expect(Object.keys(row.output).sort()).toEqual(['costBasis', 'costCents', 'explanation', 'opsCount', 'proposalId']);
    expect(row.output.explanation).toBe(`MOCK ${EXPL_MARK}`); // stored, and read from here by the owner's tab
    expect(Object.keys(store.getJob(errJob).error).sort()).toEqual(['code', 'message', 'providerCode', 'retryable']);
  });
  it('on disk and in a backup: the typed text is in no file; the explanation, the error texts and the proposal are in the database (and so in its backups); the assistant\'s key and config are in no backup', async () => {
    store.db.pragma('wal_checkpoint(TRUNCATE)');
    const filesOf = (root: string): string[] => fs.readdirSync(root, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesOf(path.join(root, e.name)) : [path.join(root, e.name)]));
    const holding = (root: string, word: string) => filesOf(root).filter((file) => fs.readFileSync(file).includes(Buffer.from(word, 'utf8'))).map((file) => path.relative(root, file));
    expect(holding(dir, TYPED_MARK)).toEqual([]);
    const db = path.relative(dir, store.db.name);
    for (const word of [EXPL_MARK, ERR_MARK, BAD_MARK, OPS_MARK]) expect(holding(dir, word), word).toEqual([db]);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ajp-backup-'));
    try {
      await backupDataDir(dir, dest);
      expect(holding(dest, TYPED_MARK)).toEqual([]);
      expect(holding(dest, EXPL_MARK).length).toBe(1); // the database copy holds the job rows as they are
      expect(holding(dest, KEY)).toEqual([]);
      expect(filesOf(dest).map((x) => path.basename(x)).filter((n) => n.startsWith('assistant.'))).toEqual([]);
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
  });
  it('a project archive holds no job and no proposal: none of the planted words, for the owner too', async () => {
    // the fixture's two files have no stored bytes: a byte each stands in, so the archive can be written (it is not imported)
    for (const hash of archiveBlobs(store.getProject(pid).doc)) { const file = store.blobPath(hash); if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'x'); } }
    const r = await fetchRaw(OWNER_WHO, 'GET', `${base()}/api/v1/projects/${pid}/archive`);
    expect(r.status).toBe(200);
    expect(r.buf.length).toBeGreaterThan(1000);
    expect(r.buf.toString('utf8')).toContain('manifest.json');
    expect(markIn(r.buf.toString('utf8'))).toBeNull();
    for (const word of [okJob, proposalId, ASSISTANT_JOB_TYPE]) expect(r.buf.includes(Buffer.from(word))).toBe(false);
  });
});
