/**
 * The assistant's money and provider are the owner's (ADR-0027, note of 2026-11-25 "money and provider"; assistant/visibility.ts
 * assistantStatusFor and assertMayReleaseBudget). THE WALK, as in jobPrivacy.test.ts: distinctive values are planted in the
 * owner's settings (a service host, a model name, an adapter id, two prices, the monthly limit, the per-request cap) and in the
 * month's ledger (an amount spent, an amount held after a cancelled request); then every surface a credential can reach is
 * called (every REST route of peopleSurfaces.ts, every MCP tool that reads or names a job or a proposal, every resource and
 * prompt, the event stream) with the same seven kinds of credential, and the planted values must be nowhere. Controls: the
 * owner's own session reads every one of them. Before the rule GET /assistant/status handed all of them to any observer.
 * Also here: who may release a held amount (the owner's session only, on REST; no MCP tool does), what the refusal tells, a held
 * amount whose project was deleted, and the budget fact that stays visible to an agent: its OWN grant's.
 * The assistant is the labelled MOCK adapter (testAdapter.ts); the key is a labelled test double. No provider, no port, no network.
 * Last, the LOCAL assistant (wave 7): a planted port, time limit and model name (the labelled local MOCK reports it on the check)
 * are the owner's too; the same walk with the same seven credentials.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalMockAdapter } from './local/localTestAdapter.ts';
import { ASSISTANT_JOB_TYPE, ASSISTANT_PUBLIC_STATUS_KEYS } from '@pulseframe/core';
import { Auth } from '../auth.ts';
import { Capabilities } from '../capabilities.ts';
import { loadConfig, type Config } from '../config.ts';
import { Derivatives } from '../derive.ts';
import { Exporter } from '../export.ts';
import { Governance, type Principal } from '../governance.ts';
import { createApp } from '../http.ts';
import { createMcp } from '../mcp.ts';
import { buildOpenApi } from '../openapi.ts';
import { PEOPLE_REST_SURFACES } from '../peopleSurfaces.ts';
import { Presence } from '../presence.ts';
import { Speech } from '../speech.ts';
import { Store } from '../store.ts';
import { f, plantedProject } from './assistantFixture.ts';
import { mockToolAnswer, TestChatAdapter, type MockStep } from './testAdapter.ts';
import { PUBLIC_STATUS_DETAIL } from './visibility.ts';

const KEY = 'TEST-DOUBLE-NOT-A-KEY-status-privacy-51c8';
// ---------- the plant: values found nowhere else in the fixture ----------
const HOST = 'zarzir-7431.example.test', MODEL = 'mock-model-shkedia-9917', ADAPTER = 'MOCK-adapter-tavlin-3391';
const PRICE_IN = 613.25, PRICE_OUT = 1777.75, MONTHLY = 735_193, CAP = 48_713;
/** The MOCK answer reports this usage, so the request settles at ceil((37e6·613.25 + 11e6·1777.75) / 1e6) = 42246 cents. */
const USAGE = { inputTokens: 37_000_000, outputTokens: 11_000_000 }, SPENT = 42_246;
/** The adapter does not bound tokens by bytes, so a reservation is the whole per-request cap: the held amount is CAP. */
const HELD = CAP;
const GRANT_BUDGET = 31_337; // the autopilot grant's OWN budget: a different ledger, which that grant still reads
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let derivatives: Derivatives, capabilities: Capabilities, speech: Speech;
let pid = '', ownerCookie = '', okJob = '', heldJob = '', keyAddedAt = '';
const adapter = new TestChatAdapter({ id: ADAPTER, bytesBoundTokens: false });
// ---------- the LOCAL plant (wave 7): a port, a time limit and the model name the local server reports ----------
const L_PORT = 47_311, L_TIMEOUT = 593, L_MODEL = 'MOCK-tutonit-8823.gguf';
const localMock = createLocalMockAdapter({});
localMock.checkAnswer = { state: 'running', model: L_MODEL };
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = { name: string; headers: () => Record<string, string> };
const tokens: Record<string, string> = {};
const bearer = (name: string, token: () => string): Who => ({ name, headers: () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' }) });
const OWNER_WHO: Who = { name: 'the owner\'s session', headers: () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }) };
/** The same seven kinds of credential as jobPrivacy.test.ts: none of them is the owner's session. */
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
/** The planted values: the words as they are, the numbers as a number of their own (not digits inside an id, a hash or a longer number). */
const WORDS = () => [HOST, MODEL, ADAPTER, keyAddedAt].filter(Boolean);
const NUMBERS = [String(PRICE_IN), String(PRICE_OUT), String(MONTHLY), String(CAP), String(SPENT)];
const asNumber = (n: string) => new RegExp(`(?<![0-9A-Za-z_.-])${n.replace('.', '\\.')}(?![0-9A-Za-z_-]|\\.[0-9])`);
/** The planted value a text holds, or null. */
const plantIn = (text: string): string | null => WORDS().find((w) => text.includes(w)) ?? NUMBERS.find((n) => asNumber(n).test(text)) ?? null;
const ask = async (project = pid) => { const r = await rest(OWNER_WHO, 'POST', `/projects/${project}/assistant/requests`, { text: 'הוסף סמן', selection: [], playheadFrame: 0 }); expect(r.status).toBe(202); return r.body.jobId as string; };
const settled = async (jobId: string) => {
  for (let i = 0; i < 400; i++) { const j = store.getJob(jobId); if (['succeeded', 'failed', 'submission-unknown', 'canceled'].includes(j.status)) return j; await new Promise((res) => setTimeout(res, 10)); }
  return store.getJob(jobId);
};
/** The MOCK holds its answer back until the request is cancelled: the request was handed over, so its reservation stays counted. */
const heldBack = (): MockStep => ({ wait: (signal) => new Promise((_res, rej) => { signal.addEventListener('abort', () => rej(new Error('MOCK: aborted'))); }) });
const cancelAfterSend = async (project = pid) => {
  adapter.queue(heldBack());
  const jobId = await ask(project);
  for (let i = 0; i < 400 && store.getJob(jobId).status !== 'running'; i++) await new Promise((res) => setTimeout(res, 5));
  expect((await rest(OWNER_WHO, 'POST', `/jobs/${jobId}/cancel`)).body.outcome).toBe('requested');
  expect((await settled(jobId)).status).toBe('canceled');
  expect(gov.ledgerFor(jobId)).toEqual({ reservedCents: HELD, actualCents: null, state: 'unknown' });
  return jobId;
};
const CONFIG = { adapter: ADAPTER, host: HOST, model: MODEL, pricesCentsPerMTok: { input: PRICE_IN, output: PRICE_OUT }, monthlyLimitCents: MONTHLY, perRequestCapCents: CAP, toggles: { titlesAndMarkers: true, peopleNames: false } };

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-asp-'));
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
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech, { assistant: { adapters: new Map([[adapter.id, adapter]]), endpoint: () => null, local: localMock } });
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = plantedProject(store).pid;
  for (const [name, mode, extra] of [['observe', 'observe', {}], ['propose', 'propose', {}], ['edit', 'edit', {}], ['autopilot', 'autopilot', { projectIds: [pid], budgetCents: GRANT_BUDGET }], ['full', 'edit', { people: 'full' }]] as const)
    tokens[name] = gov.createGrant({ name: `walk-${name}`, mode, ...extra }, OWNER).token;
  expect((await rest(OWNER_WHO, 'PUT', '/assistant/config', CONFIG)).status).toBe(200);
  const key = await rest(OWNER_WHO, 'PUT', '/assistant/key', { key: KEY });
  expect(key.status).toBe(200);
  keyAddedAt = key.body.keyAddedAt as string;
  // the month's ledger: one request answered (spent, at the usage the MOCK reports) and one cancelled after it was sent (held)
  adapter.queue(mockToolAnswer([{ op: 'add_marker', args: { time: f(45), label: 'סמן' } }], 'MOCK proposal', USAGE));
  okJob = await ask();
  expect((await settled(okJob)).status).toBe('succeeded');
  heldJob = await cancelAfterSend();
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
  it('the owner\'s session reads the whole status: host, model, adapter, prices, limits, the month\'s spent and reserved amounts, the held amount and the key\'s date', async () => {
    const s = await rest(OWNER_WHO, 'GET', '/assistant/status');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      setup: 'ready', adapter: ADAPTER, host: HOST, model: MODEL, pricesCentsPerMTok: { input: PRICE_IN, output: PRICE_OUT }, monthlyLimitCents: MONTHLY, perRequestCapCents: CAP,
      spentCents: SPENT, reservedCents: HELD, toggles: { titlesAndMarkers: true, peopleNames: false }, keySet: true, keyAddedAt, adapters: [ADAPTER],
    });
    expect(s.body.held).toEqual([{ jobId: heldJob, cents: HELD, requestedAt: store.db.prepare('SELECT created_at AS at FROM budget_ledger WHERE job_id = ?').pluck().get(heldJob), status: 'canceled' }]);
    expect(JSON.stringify(s.body)).not.toContain(KEY);
    for (const v of [...WORDS(), ...NUMBERS]) expect(plantIn(JSON.stringify(s.body)), v).not.toBeNull();
    // and its own job with its cost (a job's input, which holds the host, the model and the reservation, is answered to no one)
    const job = await rest(OWNER_WHO, 'GET', `/jobs/${okJob}`);
    expect(job.body).toMatchObject({ output: { costCents: SPENT, costBasis: 'reported' } });
    expect(store.getJob(okJob).input).toMatchObject({ host: HOST, model: MODEL, adapter: ADAPTER, reservedCents: CAP });
  });
  it('the search finds a planted number as a number of its own, and not as digits inside an id or a longer number', () => {
    expect(plantIn(`{"monthlyLimitCents":${MONTHLY},"x":1}`)).toBe(String(MONTHLY));
    expect(plantIn(`"${CAP}¢"`)).toBe(String(CAP));
    expect(plantIn(`{"input":${PRICE_IN}}`)).toBe(String(PRICE_IN));
    expect(plantIn(`job_a${CAP}f prp_${MONTHLY}x 1${SPENT} ${SPENT}9 ${PRICE_IN}5`)).toBeNull();
  });
});

describe('anyone but the owner\'s session reads of the status whether the assistant is connected, and nothing else', () => {
  for (const who of OTHERS) it(`GET /assistant/status as ${who.name}: connected, in three fixed fields`, async () => {
    const s = await rest(who, 'GET', '/assistant/status');
    expect(s.status).toBe(200);
    expect(s.body).toEqual({ connected: true, setup: 'ready', detail: PUBLIC_STATUS_DETAIL.ready });
    expect(Object.keys(s.body).sort()).toEqual([...ASSISTANT_PUBLIC_STATUS_KEYS]);
  });
  it('not connected reads the same whatever is missing (the key, the limits, the prices, the model): which setting is missing is the owner\'s to know', async () => {
    const notConnected = { connected: false, setup: 'not_connected', detail: PUBLIC_STATUS_DETAIL.not_connected };
    const causes: [string, () => Promise<unknown>, string][] = [
      ['no key', () => rest(OWNER_WHO, 'DELETE', '/assistant/key'), 'provider_not_configured'],
      ['no limits', async () => { await rest(OWNER_WHO, 'PUT', '/assistant/key', { key: KEY }); return rest(OWNER_WHO, 'PUT', '/assistant/config', { ...CONFIG, monthlyLimitCents: 0, perRequestCapCents: 0 }); }, 'limit_missing'],
      ['no prices', () => rest(OWNER_WHO, 'PUT', '/assistant/config', { ...CONFIG, pricesCentsPerMTok: null }), 'prices_missing'],
      ['no model', () => rest(OWNER_WHO, 'PUT', '/assistant/config', { ...CONFIG, model: null }), 'provider_not_configured'],
    ];
    try {
      for (const [name, make, ownerReads] of causes) {
        await make();
        expect((await rest(OWNER_WHO, 'GET', '/assistant/status')).body.setup, name).toBe(ownerReads); // the owner is told which
        for (const who of OTHERS) expect((await rest(who, 'GET', '/assistant/status')).body, `${name}, ${who.name}`).toEqual(notConnected);
      }
    } finally {
      expect((await rest(OWNER_WHO, 'PUT', '/assistant/config', CONFIG)).status).toBe(200);
      keyAddedAt = (await rest(OWNER_WHO, 'PUT', '/assistant/key', { key: KEY })).body.keyAddedAt;
    }
    for (const who of OTHERS) expect((await rest(who, 'GET', '/assistant/status')).body.connected, who.name).toBe(true);
  });
  it('the settings routes answer none of them: a refusal with no value of the settings', async () => {
    for (const who of OTHERS) for (const [method, p, body] of [['PUT', '/assistant/config', CONFIG], ['PUT', '/assistant/key', { key: 'TEST-DOUBLE-NOT-A-KEY-other' }], ['DELETE', '/assistant/key', undefined], ['GET', `/projects/${pid}/assistant/summary?playheadFrame=0`, undefined], ['POST', `/projects/${pid}/assistant/requests`, { text: 'x', selection: [], playheadFrame: 0 }]] as const) {
      const r = await fetchRaw(who, method, `${base()}/api/v1${p}`, body);
      expect([r.status, JSON.parse(r.buf.toString('utf8')).error.code], `${method} ${p} as ${who.name}`).toEqual([403, 'owner_required']);
      expect(plantIn(r.buf.toString('utf8')), `${method} ${p} as ${who.name}`).toBeNull();
    }
    expect((await rest(OWNER_WHO, 'GET', '/assistant/status')).body).toMatchObject({ setup: 'ready', host: HOST, model: MODEL, keySet: true });
  });
  it('what a grant still reads about money is its OWN budget (MCP get_controls): another ledger, needed to know whether paid work can start', async () => {
    const autopilot = OTHERS.find((w) => w.name.startsWith('an autopilot grant'))!;
    const controls = JSON.parse((await rpc(autopilot, 'tools/call', { name: 'get_controls', arguments: { projectId: pid } })).result.content[0].text);
    expect(controls.limits).toMatchObject({ budgetCents: GRANT_BUDGET, spentCents: 0, reservedCents: 0 }); // the grant's own ledger: the assistant's 42246 and 48713 are not in it
    expect(plantIn(JSON.stringify(controls))).toBeNull();
    // the fixed tokens have no grant, so no budget of any kind
    expect(JSON.parse((await rpc(OTHERS[1]!, 'tools/call', { name: 'get_controls', arguments: { projectId: pid } })).result.content[0].text).limits).toBeNull();
  });
});

describe('the walk: the planted amounts, host and model reach no credential but the owner\'s session, on any surface', () => {
  const PARAMS = (jobId: string): Record<string, string> => ({ id: pid, jobId, proposalId: store.getJob(okJob).output.proposalId as string, sequenceId: 'seq_main', index: '0', kind: 'thumb' });
  for (const who of OTHERS) it(`REST, every route, as ${who.name}`, async () => {
    const leaks: string[] = [];
    let called = 0, answered = 0;
    for (const key of Object.keys(PEOPLE_REST_SURFACES)) {
      const [method, route] = key.split(' ') as [string, string];
      if (PEOPLE_REST_SURFACES[key]!.includes('renderer-only') || key === 'ALL /mcp' || route.endsWith('/events')) continue; // the event stream has its own test below
      // every read; and every write that names a job, a proposal, the assistant or a budget (a refusal or an answer about them is searched too)
      if (method !== 'GET' && !/:jobId|proposal|assistant|budget/.test(route)) continue;
      if (method === 'DELETE' && route.endsWith('/assistant/key')) continue; // refused for every one of them (tested above); never sent here as the owner
      for (const jobId of route.includes(':jobId') ? [okJob, heldJob] : [okJob]) {
        const params = PARAMS(jobId);
        const url = `${base()}${route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? 'none'))}`;
        const r = await fetchRaw(who, method, url, method === 'GET' ? undefined : { __walk: 1 });
        called++;
        if (r.status < 300) answered++;
        const found = plantIn(r.buf.toString('utf8')) ?? plantIn(r.headers);
        if (found) leaks.push(`${key} → ${r.status}: ${found}`);
      }
    }
    expect(called, 'routes called').toBeGreaterThan(70);
    expect(answered, 'routes that answered with content, not a refusal').toBeGreaterThan(25);
    expect(leaks).toEqual([]);
    expect(gov.ledgerFor(heldJob)!.state).toBe('unknown'); // the walk's POST …/budget/release released nothing
  }, 120_000);
  for (const who of OTHERS) it(`MCP, every tool that reads or names a job or a proposal, every resource and prompt, as ${who.name}`, async () => {
    const leaks: string[] = [];
    const tools = (await rpc(who, 'tools/list', {})).result.tools as { name: string; description?: string; annotations?: { readOnlyHint?: boolean }; inputSchema?: { properties?: Record<string, unknown> } }[];
    const walked = tools.filter((t) => t.annotations?.readOnlyHint || Object.hasOwn(t.inputSchema?.properties ?? {}, 'jobId') || /propos/.test(t.name));
    expect(walked.map((t) => t.name)).toEqual(expect.arrayContaining(['get_job', 'cancel_job', 'retry_job', 'list_proposals', 'get_summary', 'get_timeline', 'get_controls']));
    // no tool reads the assistant's status or its ledger, and none releases a reservation: the list itself says so
    expect(tools.map((t) => t.name).filter((n) => /assistant|ledger|budget|release|spend/.test(n))).toEqual([]);
    for (const t of walked) for (const jobId of Object.hasOwn(t.inputSchema?.properties ?? {}, 'jobId') ? [okJob, heldJob] : [okJob]) {
      const res = await rpc(who, 'tools/call', { name: t.name, arguments: { projectId: pid, jobId, frameIndex: 10, frames: [0, 10], ...(t.name === 'propose_transaction' ? { ops: [] } : {}) } });
      const found = plantIn(res.text);
      if (found) leaks.push(`tool ${t.name}: ${found}`);
    }
    const uris = [...((await rpc(who, 'resources/list', {})).result.resources ?? []).map((r: { uri: string }) => r.uri), 'pulseframe://guide', 'pulseframe://ops', 'pulseframe://catalog', `pulseframe://projects/${pid}/summary`, `pulseframe://projects/${pid}/timeline`];
    for (const uri of new Set(uris)) { const found = plantIn((await rpc(who, 'resources/read', { uri })).text); if (found) leaks.push(`resource ${uri}: ${found}`); }
    for (const p of (await rpc(who, 'prompts/list', {})).result.prompts ?? []) { const found = plantIn((await rpc(who, 'prompts/get', { name: p.name, arguments: { projectId: pid } })).text); if (found) leaks.push(`prompt ${p.name}: ${found}`); }
    expect(leaks).toEqual([]);
  }, 120_000);

  it('the event stream: while the owner asks, cancels and releases, a listener other than the owner\'s session hears no amount, host or model', async () => {
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
    adapter.queue(mockToolAnswer([{ op: 'add_marker', args: { time: f(75), label: 'סמן' } }], 'MOCK proposal', USAGE));
    const a = await ask(); await settled(a);
    const b = await cancelAfterSend();
    expect((await rest(OWNER_WHO, 'POST', `/jobs/${b}/budget/release`)).status).toBe(200);
    const ended = (t: string) => new RegExp(`"id":"${a}"[^\\n]*"status":"succeeded"`).test(t) && new RegExp(`"id":"${b}"[^\\n]*"status":"canceled"`).test(t);
    for (const l of listeners) { await l.read(ended); await l.close(); }
    const [owner, ...others] = listeners;
    expect(plantIn(owner!.s.text)).not.toBeNull(); // control: the owner's own session hears the cost
    for (const l of others) {
      expect(ended(l.s.text), `${l.who.name} heard the two jobs end`).toBe(true);
      expect(plantIn(l.s.text), l.who.name).toBeNull();
    }
    // the second answered request settled at the same usage: what the month spent is now twice the planted amount (the owner reads it)
    expect((await rest(OWNER_WHO, 'GET', '/assistant/status')).body).toMatchObject({ spentCents: 2 * SPENT, reservedCents: HELD });
  }, 60_000);

  it('the API description gives no example of the owner\'s values and says what each kind of credential reads', () => {
    const api = buildOpenApi() as any;
    expect(plantIn(JSON.stringify(api))).toBeNull();
    const status = api.paths['/api/v1/assistant/status'].get;
    expect(`${status.summary} ${status.description}`).toMatch(/owner's own session/);
    expect(`${status.summary} ${status.description}`).toMatch(/connected/);
    const forOthers = status.responses['200'].content['application/json'].schema.oneOf[1];
    expect([forOthers.additionalProperties, Object.keys(forOthers.properties).sort()]).toEqual([false, [...ASSISTANT_PUBLIC_STATUS_KEYS]]);
    const release = api.paths['/api/v1/jobs/{jobId}/budget/release'].post;
    expect(release['x-owner-session-only']).toBe(true);
    expect(release.description).toMatch(/does not undo a charge/);
  });
});

describe('releasing a held amount is the owner\'s session\'s alone', () => {
  it('every other credential is refused on REST with the reason and the next step, learns nothing of the ledger, and releases nothing; no MCP tool releases', async () => {
    for (const who of OTHERS) {
      const r = await rest(who, 'POST', `/jobs/${heldJob}/budget/release`);
      expect([r.status, r.body.error.code], who.name).toEqual([403, 'owner_required']);
      expect(r.body.error.details, who.name).toEqual({ jobId: heldJob });
      expect(r.body.error.hint, who.name).toMatch(/Ask the owner/);
      // the same answer for a job that holds nothing: the refusal does not say whether an amount is held
      const none = await rest(who, 'POST', `/jobs/${okJob}/budget/release`);
      expect({ ...none.body.error, details: 0 }, who.name).toEqual({ ...r.body.error, details: 0 });
      expect((await rest(who, 'POST', '/jobs/job_does_not_exist/budget/release')).status, who.name).toBe(404);
    }
    expect(gov.ledgerFor(heldJob)).toEqual({ reservedCents: HELD, actualCents: null, state: 'unknown' });
    expect((await rest(OWNER_WHO, 'GET', '/assistant/status')).body.held.map((h: { jobId: string }) => h.jobId)).toEqual([heldJob]);
  });
  it('the owner\'s session releases it: the row is released, the month\'s reserved amount drops by exactly that much, what was spent does not move, and a second release is refused with a next step', async () => {
    const before = (await rest(OWNER_WHO, 'GET', '/assistant/status')).body;
    const r = await rest(OWNER_WHO, 'POST', `/jobs/${heldJob}/budget/release`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ jobId: heldJob, ledger: { reservedCents: HELD, actualCents: null, state: 'released' } });
    const after = (await rest(OWNER_WHO, 'GET', '/assistant/status')).body;
    expect([after.reservedCents, after.spentCents, after.held]).toEqual([before.reservedCents - HELD, before.spentCents, []]);
    const again = await rest(OWNER_WHO, 'POST', `/jobs/${heldJob}/budget/release`);
    expect([again.status, again.body.error.code]).toEqual([409, 'nothing_to_release']);
    expect(again.body.error.hint).toBeTruthy();
    // a request that settled has nothing to release either
    expect((await rest(OWNER_WHO, 'POST', `/jobs/${okJob}/budget/release`)).body.error.code).toBe('nothing_to_release');
    expect(store.getJob(heldJob).status).toBe('canceled'); // the job is as it was: releasing changes the count, nothing else
  });
  it('a held amount whose project was deleted stays counted and listed, and the owner can still release it; for anyone else the job is simply not found', async () => {
    const other = plantedProject(store).pid;
    const orphan = await cancelAfterSend(other);
    expect((await rest(OWNER_WHO, 'POST', `/projects/${other}/delete`, { confirmName: store.getProject(other).doc.name })).status).toBe(200);
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE id = ?').get(orphan)).toEqual({ n: 0 });
    const listed = (await rest(OWNER_WHO, 'GET', '/assistant/status')).body;
    expect(listed.held).toMatchObject([{ jobId: orphan, cents: HELD, status: null }]);
    expect(listed.reservedCents).toBe(HELD);
    for (const who of OTHERS) expect((await rest(who, 'POST', `/jobs/${orphan}/budget/release`)).status, who.name).toBe(404);
    expect((await rest(OWNER_WHO, 'GET', `/jobs/${orphan}`)).status).toBe(404); // only the release reaches a ledger row without its job
    const r = await rest(OWNER_WHO, 'POST', `/jobs/${orphan}/budget/release`);
    expect([r.status, r.body.ledger.state]).toEqual([200, 'released']);
    expect((await rest(OWNER_WHO, 'GET', '/assistant/status')).body).toMatchObject({ reservedCents: 0, held: [] });
    expect(store.db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE type = ? AND project_id = ?').get(ASSISTANT_JOB_TYPE, other)).toEqual({ n: 0 });
  });
});

describe('the LOCAL assistant (wave 7): its port, time limit and model name are the owner\'s', () => {
  // the time limit is a 3-digit number that project data can hold by chance (a frame count, a size): it is searched as the settings'
  // own words (timeoutSeconds, lastCheck) instead; the port (5 digits) as a number of its own, the model name as it is
  const plantLocal = (text: string): string | null => [L_MODEL, 'timeoutSeconds', 'lastCheck'].find((w) => text.includes(w)) ?? (asNumber(String(L_PORT)).test(text) ? String(L_PORT) : null);
  beforeAll(async () => {
    expect((await rest(OWNER_WHO, 'PUT', '/assistant/config', { ...CONFIG, adapter: 'local-llama-server', local: { port: L_PORT, timeoutSeconds: L_TIMEOUT } })).status).toBe(200);
    expect((await rest(OWNER_WHO, 'POST', '/assistant/local/check', {})).body).toMatchObject({ state: 'running', model: L_MODEL });
  });
  it('control: the owner\'s session reads the port, the time limit and the last check with the model name', async () => {
    const s = await rest(OWNER_WHO, 'GET', '/assistant/status');
    expect(s.body).toMatchObject({ setup: 'ready', adapter: 'local-llama-server', local: { port: L_PORT, timeoutSeconds: L_TIMEOUT, lastCheck: { state: 'running', model: L_MODEL } } });
  });
  for (const who of OTHERS) it(`as ${who.name}: the status is connected in three fields; the check route is refused; every REST route, MCP tool, resource and prompt is free of the plant`, async () => {
    const st = await rest(who, 'GET', '/assistant/status');
    expect(Object.keys(st.body).sort()).toEqual([...ASSISTANT_PUBLIC_STATUS_KEYS].sort());
    expect(st.body.connected).toBe(true);
    const chk = await rest(who, 'POST', '/assistant/local/check', {});
    expect([chk.status, chk.body.error.code]).toEqual([403, 'owner_required']);
    const leaks: string[] = [];
    const params: Record<string, string> = { id: pid, jobId: okJob, proposalId: 'none', sequenceId: 'seq_main', index: '0', kind: 'thumb' };
    for (const key of Object.keys(PEOPLE_REST_SURFACES)) {
      const [method, route] = key.split(' ') as [string, string];
      if (PEOPLE_REST_SURFACES[key]!.includes('renderer-only') || key === 'ALL /mcp' || route.endsWith('/events')) continue;
      if (method !== 'GET' && !/:jobId|proposal|assistant/.test(route)) continue;
      const r = await fetchRaw(who, method, `${base()}${route.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(params[k] ?? 'none'))}`, method === 'GET' ? undefined : { __walk: 1 });
      const found = plantLocal(r.buf.toString('utf8')) ?? plantLocal(r.headers);
      if (found) leaks.push(`${key} → ${r.status}: ${found}`);
    }
    const tools = (await rpc(who, 'tools/list', {})).result.tools as { name: string; annotations?: { readOnlyHint?: boolean }; inputSchema?: { properties?: Record<string, unknown> } }[];
    for (const t of tools.filter((x) => x.annotations?.readOnlyHint || Object.hasOwn(x.inputSchema?.properties ?? {}, 'jobId'))) {
      const found = plantLocal((await rpc(who, 'tools/call', { name: t.name, arguments: { projectId: pid, jobId: okJob, frameIndex: 10, frames: [0, 10] } })).text);
      if (found) leaks.push(`tool ${t.name}: ${found}`);
    }
    for (const r of (await rpc(who, 'resources/list', {})).result.resources ?? []) { const found = plantLocal((await rpc(who, 'resources/read', { uri: r.uri })).text); if (found) leaks.push(`resource ${r.uri}: ${found}`); }
    for (const p of (await rpc(who, 'prompts/list', {})).result.prompts ?? []) { const found = plantLocal((await rpc(who, 'prompts/get', { name: p.name, arguments: { projectId: pid } })).text); if (found) leaks.push(`prompt ${p.name}: ${found}`); }
    expect(leaks).toEqual([]);
  }, 120_000);
});
