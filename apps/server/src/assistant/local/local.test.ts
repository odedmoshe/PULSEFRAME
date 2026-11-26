/**
 * The LOCAL language assistant on the server (wave 7; .artifacts/wave7/assistant-decisions.md §4–§5, builder B): the loopback adapter
 * against a real listener on an ephemeral 127.0.0.1 port (the labelled STAND-IN, standIn.ts) and against a socket whose remote address
 * is not this machine; the local branch of the job (no money, the lane, honest states, cancel, restart recovery); the check of an
 * answer; the two owner-only routes (check, taken) and what is kept at rest. No model runs here, nothing leaves 127.0.0.1.
 *
 * DOUBLE (labelled): until builder A's core groundLocalAnswer / localPhrase are merged they throw "not built"; while core's
 * LOCAL_INTENT_BUILT is false this file replaces just those two with the small double of localTestAdapter.ts withLocalIntentDouble
 * (a few Hebrew phrases the real grammar reads). Once A is merged the real functions are used and every expected phrase is computed with them (localPhrase(...)), never typed.
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSISTANT_JOB_TYPE, ASSISTANT_LOCAL_ADAPTER_ID, ASSISTANT_LOCAL_TEXT_MAX, barUnderstands, localPhrase,
  type AssistantConfigBody, type AssistantLocalOutput, type LocalAnswer,
} from '@pulseframe/core';
import { ASSISTANT_LOCAL_PROMPT_DIGEST, ASSISTANT_PROMPT_DIGEST, llamaChatBody, LocalModelError, type LocalModelAdapter } from '@pulseframe/providers';
import { loadConfig } from '../../config.ts';
import { Governance, type Principal } from '../../governance.ts';
import { FifoComputeLane } from '../../lane.ts';
import { deleteProject } from '../../storage.ts';
import { ApiError, Store } from '../../store.ts';
import { plantedProject, PLANTED } from '../assistantFixture.ts';
import { ASSISTANT_LOCAL_LANE_LABEL, ASSISTANT_LOCAL_SENTENCES } from '../contract.ts';
import { recoverAssistantJobs } from '../job.ts';
import { assistantPrompt } from '../prompt.ts';
import { buildLocalRequest, LOCAL_ASSISTANT_SYSTEM, localPrompt } from '../localPrompt.ts';
import { createAssistantHandlers } from '../routes.ts';
import { checkLocalAnswer, malformedSlots } from './check.ts';
import { createLlamaAdapter, LLAMA_ADAPTER_ID, LOCAL_REPLY_MAX_BYTES } from './llamaAdapter.ts';
import { createLocalMockAdapter, type LocalMockAdapter } from './localTestAdapter.ts';
import { startStandIn, type StandIn } from './standIn.ts';

// ---------- the labelled DOUBLE of builder A's two functions (localTestAdapter.ts; only while core's LOCAL_INTENT_BUILT is false) ----------
vi.mock('@pulseframe/core', async (importOriginal) => (await import('./localTestAdapter.ts')).withLocalIntentDouble(await importOriginal()));

const owner: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const agents: Principal[] = [
  { actor: 'agent:local', kind: 'agent', scopes: ['observe', 'edit'] },
  { actor: 'observer:local', kind: 'agent', scopes: ['observe'] },
];
const MONEY = /חויב|שמור|charge|reserv|cent|budget|money|כסף/i;
const STACK = /Error:|\n\s+at |at .*\.ts:\d+/;

/** The owner's request texts: none of them is read by the grammar itself (asserted below). */
const LOUD = 'המוזיקה חזקה מדי, תורידי אותה בשש דציבל';
const VAGUE = 'תורידי קצת את המוזיקה';
const NOISE = 'תעשה שזה יהיה מרגש';
const TITLE_MARK = 'קישקושונית';
const TITLE_REQ = `שימי בפתיחה כיתוב ${TITLE_MARK} בבקשה`;
const GAIN6 = JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' } });
const TITLE = JSON.stringify({ intent: 'add_title', slots: { text: TITLE_MARK, at: 'start' } });

// ---------- temporary folders, stores, stand-ins: all removed ----------
const dirs: string[] = [], stores: Store[] = [], standIns: StandIn[] = [], servers: http.Server[] = [];
afterAll(async () => {
  for (const s of standIns) await s.close();
  for (const s of servers) await new Promise((r) => s.close(r));
  for (const s of stores) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});
const standIn = async (answers: Record<string, string> = {}) => { const s = await startStandIn({ answers }); standIns.push(s); return s; };
/** A port nothing listens on (bound, then closed). */
const freePort = async () => { const s = net.createServer(); await new Promise<void>((r) => s.listen(0, '127.0.0.1', r)); const p = (s.address() as net.AddressInfo).port; await new Promise((r) => s.close(r)); return p; };
/** A raw listener that answers every request with `reply` (a whole HTTP response) and records what it received. */
const rawListener = async (reply: (received: string) => string | Buffer) => {
  const got: string[] = [];
  const s = http.createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', () => { got.push(Buffer.concat(parts).toString('utf8')); res.socket!.end(reply(got.at(-1)!)); });
  });
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  return { port: (s.address() as net.AddressInfo).port, got };
};

interface Env { dir: string; store: Store; gov: Governance; lane: FifoComputeLane; h: ReturnType<typeof createAssistantHandlers>; pid: string }
function env(local: LocalModelAdapter | null, opts: { port?: number | null; timeoutSeconds?: number; lane?: boolean } = {}): Env {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-alocal-'));
  dirs.push(dir);
  const store = new Store(dir); stores.push(store);
  const gov = new Governance(store);
  const lane = new FifoComputeLane();
  const h = createAssistantHandlers({ cfg: { ...loadConfig({}), dataDir: dir }, store, gov, deps: { adapters: new Map(), endpoint: () => null, local, lane: opts.lane === false ? null : lane } });
  const port = opts.port === undefined ? 18791 : opts.port;
  h.putConfig(owner, localConfig(port === null ? null : { port, timeoutSeconds: opts.timeoutSeconds ?? 60 }));
  return { dir, store, gov, lane, h, pid: plantedProject(store).pid };
}
const localConfig = (local: { port: number; timeoutSeconds: number } | null): AssistantConfigBody => ({
  adapter: ASSISTANT_LOCAL_ADAPTER_ID, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0,
  toggles: { titlesAndMarkers: false, peopleNames: false }, local,
});
const ask = (e: Env, text: string, lang?: 'he' | 'en') => e.h.request(owner, e.pid, { text, selection: [], playheadFrame: 0, ...(lang ? { lang } : {}) }) as { jobId: string };
const run = async (e: Env, text: string, lang?: 'he' | 'en') => { const { jobId } = ask(e, text, lang); await e.h.done(jobId); return e.store.getJob(jobId); };
const ledgerRows = (e: Env) => (e.store.db.prepare('SELECT COUNT(*) AS n FROM budget_ledger').get() as { n: number }).n;
const codeOf = async (fn: () => unknown): Promise<{ status: number; code: string }> => {
  try { await fn(); } catch (x) { if (x instanceof ApiError) return { status: x.status, code: x.code }; throw x; }
  throw new Error('not refused');
};
const filesOf = (root: string): string[] => fs.readdirSync(root, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesOf(path.join(root, d.name)) : [path.join(root, d.name)]));
const holding = (root: string, word: string) => filesOf(root).filter((f) => fs.readFileSync(f).includes(Buffer.from(word, 'utf8'))).map((f) => path.relative(root, f));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!cond() && Date.now() < end) await wait(5); return cond(); };

describe('the texts of this file', () => {
  it('are not read by the grammar itself (so they go to the local model); «חתוך כאן» is', () => {
    for (const t of [LOUD, VAGUE, NOISE, TITLE_REQ]) expect(barUnderstands(t), t).toBe(false);
    expect(barUnderstands('חתוך כאן')).toBe(true);
  });
});

// =====================================================================================================================
describe('the loopback adapter (llamaAdapter.ts) against a real listener on an ephemeral 127.0.0.1 port', () => {
  const adapterFor = () => { const dialled: string[] = []; return { dialled, a: createLlamaAdapter({ onDial: (u) => dialled.push(u) }) }; };
  const signal = () => new AbortController().signal;

  it('dials only localModelUrl, sends llamaChatBody exactly with Accept, Content-Type, Content-Length and node\'s Host and Connection, and no credential of any kind', async () => {
    const s = await standIn({ [LOUD]: GAIN6 });
    const { a, dialled } = adapterFor();
    const req = buildLocalRequest(LOUD);
    const res = await a.complete(req, s.port, 5000, signal());
    expect(res).toEqual({ text: GAIN6, finish: 'stop', model: 'STAND-IN.gguf' });
    expect(dialled).toEqual([`http://127.0.0.1:${s.port}/v1/chat/completions`]);
    expect(s.requests).toHaveLength(1);
    const got = s.requests[0]!;
    expect(got.method).toBe('POST');
    expect(got.path).toBe('/v1/chat/completions');
    const names = got.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()).sort();
    expect(names).toEqual(['accept', 'connection', 'content-length', 'content-type', 'host']);
    expect(got.headers.host).toBe(`127.0.0.1:${s.port}`);
    for (const h of ['authorization', 'proxy-authorization', 'cookie', 'x-api-key', 'x-pf-owner-key']) expect(got.headers[h], h).toBeUndefined();
    expect(got.body).toBe(JSON.stringify(llamaChatBody(req)));
    // the raw bytes on the connection: the request line goes to the path on 127.0.0.1, and nothing else came over that socket
    const raw = s.connections.map((b) => b.toString('utf8')).join('');
    expect(raw.startsWith('POST /v1/chat/completions HTTP/1.1\r\n')).toBe(true);
    expect(raw).not.toMatch(/authorization|cookie/i);
  });

  it('nothing of the project goes to the model: exactly the keys of llamaChatBody, the fixed system text, the owner\'s typed request and the schema', async () => {
    const s = await standIn({ [TITLE_REQ]: TITLE });
    const e = env(createLlamaAdapter(), { port: s.port });
    const PROJECT_NAME = 'הסרט של נועה ותמרונית';
    e.store.commit({ projectId: e.pid, actor: 'user:local', ops: [{ op: 'rename_project', args: { name: PROJECT_NAME } }] });
    const doc = e.store.getProject(e.pid).doc;
    expect(doc.name).toBe(PROJECT_NAME);
    const clipIds = Object.values(doc.sequences[doc.mainSequenceId]!.tracks).flatMap((t) => t.clips.map((c) => c.id));
    const job = await run(e, TITLE_REQ);
    expect(job.status).toBe('succeeded');
    expect(s.requests).toHaveLength(1);
    const body = JSON.parse(s.requests[0]!.body);
    expect(Object.keys(body).sort()).toEqual(['cache_prompt', 'chat_template_kwargs', 'max_tokens', 'messages', 'model', 'response_format', 'stream', 'temperature', 'top_k']);
    expect(body.messages).toEqual([{ role: 'system', content: LOCAL_ASSISTANT_SYSTEM }, { role: 'user', content: `REQUEST (data):\n${TITLE_REQ}` }]);
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'command', schema: localPrompt().schema } });
    const raw = s.connections.map((b) => b.toString('utf8')).join('') + JSON.stringify(s.requests);
    const plain = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, x: string) => String.fromCharCode(parseInt(x, 16)));
    for (const word of [doc.name, PLANTED.personName, PLANTED.trackName, PLANTED.title, PLANTED.markerLabel, PLANTED.fileName, e.pid, ...clipIds]) {
      expect(plain.includes(word), word).toBe(false);
    }
  });

  it('checks the socket\'s remote address BEFORE writing a byte: a socket whose remote address is not 127.0.0.1 gets nothing (not_loopback, sent false)', async () => {
    const s = await standIn({ [LOUD]: GAIN6 });
    let lied = 0;
    const a = createLlamaAdapter({
      connect: (host, port) => {
        const sock = net.connect({ host, port });
        Object.defineProperty(sock, 'remoteAddress', { get: () => { lied++; return '10.0.0.5'; } });
        return sock;
      },
    });
    const err = await a.complete(buildLocalRequest(LOUD), s.port, 5000, signal()).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(LocalModelError);
    expect(err).toMatchObject({ code: 'not_loopback', sent: false });
    expect(lied).toBeGreaterThan(0);
    await until(() => s.connections.length > 0);
    await wait(100); // anything written would have arrived by now
    expect(s.connections.length).toBe(1); // the dial happened: the listener saw the connection
    expect(s.connections[0]!.length).toBe(0); // and not one byte: no request line, no header, no body
    expect(s.requests).toEqual([]);
    // the same lie on a check: not llama.cpp, nothing written either
    const before = s.connections.length;
    expect(await a.check(s.port, signal())).toEqual({ state: 'not_llama', model: null });
    await wait(100);
    expect(s.connections.slice(before).every((b) => b.length === 0)).toBe(true);
  });

  it('a proxy in the environment is not used (no agent): the request still goes straight to 127.0.0.1', async () => {
    const s = await standIn({ [LOUD]: GAIN6 });
    const dead = await freePort();
    const saved = { HTTP_PROXY: process.env.HTTP_PROXY, http_proxy: process.env.http_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    try {
      process.env.HTTP_PROXY = process.env.http_proxy = `http://127.0.0.1:${dead}`;
      delete process.env.NO_PROXY; delete process.env.no_proxy;
      const res = await createLlamaAdapter().complete(buildLocalRequest(LOUD), s.port, 5000, signal());
      expect(res.text).toBe(GAIN6);
    } finally {
      for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  });

  it('does not follow a redirect (a 3xx is server_error HTTP 302; one request only)', async () => {
    const l = await rawListener(() => 'HTTP/1.1 302 Found\r\nLocation: http://example.com/v1/chat/completions\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    const err = await createLlamaAdapter().complete(buildLocalRequest(LOUD), l.port, 5000, signal()).catch((x: unknown) => x);
    expect(err).toMatchObject({ code: 'server_error', message: 'HTTP 302', sent: true });
    expect(l.got).toHaveLength(1);
  });

  it('maps a stopped server, 503, the time limit, another status, a reply not of llama.cpp\'s shape, a reply over 64 KiB and the signal to the LocalModelError codes', async () => {
    const a = createLlamaAdapter();
    const req = buildLocalRequest(LOUD);
    const err = (p: Promise<unknown>) => p.then(() => null, (x: unknown) => x);
    expect(await err(a.complete(req, await freePort(), 5000, signal()))).toMatchObject({ code: 'not_running', sent: false });
    const s = await standIn();
    s.script({ answers: {}, loadingMs: 60_000 });
    expect(await err(a.complete(req, s.port, 5000, signal()))).toMatchObject({ code: 'loading', message: 'HTTP 503' });
    s.script({ answers: {}, status: 500 });
    expect(await err(a.complete(req, s.port, 5000, signal()))).toMatchObject({ code: 'server_error', message: 'HTTP 500' });
    s.script({ answers: {}, shape: 'garbage' });
    expect(await err(a.complete(req, s.port, 5000, signal()))).toMatchObject({ code: 'server_error', message: 'not a llama.cpp reply' });
    const n = s.requests.length;
    s.script({ answers: {}, delayMs: 2000 });
    expect(await err(a.complete(req, s.port, 150, signal()))).toMatchObject({ code: 'timeout', sent: true });
    await wait(50);
    expect(s.requests.length - n).toBe(1); // no retry
    const ctl = new AbortController();
    const pending = err(a.complete(req, s.port, 5000, ctl.signal));
    await until(() => s.requests.length - n === 2);
    ctl.abort();
    expect(await pending).toMatchObject({ code: 'canceled', sent: true });
    const big = await rawListener(() => { const b = 'x'.repeat(LOCAL_REPLY_MAX_BYTES + 10); return `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${b.length}\r\n\r\n${b}`; });
    expect(await err(a.complete(req, big.port, 5000, signal()))).toMatchObject({ code: 'server_error', message: 'reply too large' });
    // a port outside 1024–65535: nothing is dialled at all
    expect(await err(a.complete(req, 80, 5000, signal()))).toBeInstanceOf(RangeError);
  });

  it('check(): running with the model\'s basename, loading, stopped, not llama.cpp', async () => {
    const a = createLlamaAdapter();
    const s = await standIn();
    expect(await a.check(s.port, signal())).toEqual({ state: 'running', model: 'STAND-IN.gguf' });
    expect(s.requests.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /health', 'GET /v1/models']);
    for (const r of s.requests) expect(r.headers.authorization ?? r.headers.cookie).toBeUndefined();
    s.script({ answers: {}, loadingMs: 60_000 });
    expect(await a.check(s.port, signal())).toEqual({ state: 'loading', model: null });
    expect(await a.check(await freePort(), signal())).toEqual({ state: 'stopped', model: null });
    const other = await rawListener(() => 'HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    expect(await a.check(other.port, signal())).toEqual({ state: 'not_llama', model: null });
    const ok200 = await rawListener(() => 'HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi');
    expect(await a.check(ok200.port, signal())).toEqual({ state: 'not_llama', model: null }); // 200 on /health but /v1/models is not llama.cpp's
  });

  it('logs nothing (no console line, nothing on stdout or stderr) while it asks and checks', async () => {
    const s = await standIn({ [LOUD]: GAIN6 });
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) => vi.spyOn(console, m));
    const out = vi.spyOn(process.stdout, 'write'), errw = vi.spyOn(process.stderr, 'write');
    try {
      const a = createLlamaAdapter();
      await a.complete(buildLocalRequest(LOUD), s.port, 5000, signal());
      await a.check(s.port, signal());
      await a.complete(buildLocalRequest(LOUD), await freePort(), 5000, signal()).catch(() => null);
      for (const sp of spies) expect(sp).not.toHaveBeenCalled();
      for (const w of [out, errw]) expect(w.mock.calls.map((c) => String(c[0])).join('')).not.toContain('המוזיקה');
    } finally { for (const sp of [...spies, out, errw]) sp.mockRestore(); }
  });

  it('is the production adapter: id local-llama-server, built', () => {
    expect(createLlamaAdapter().id).toBe(LLAMA_ADAPTER_ID);
    expect(LLAMA_ADAPTER_ID).toBe(ASSISTANT_LOCAL_ADAPTER_ID);
  });
});

// =====================================================================================================================
describe('the check of an answer (local/check.ts)', () => {
  const reply = (text: string | null, finish: 'stop' | 'length' | 'other' = 'stop') => ({ text, finish, model: 'MOCK.gguf' });
  it('the first failure wins, each with its category and the fixed sentence, nothing of the answer in it', () => {
    const PLANT = 'מלפפונית';
    const cases: [ReturnType<typeof reply>, string][] = [
      [reply(`{"intent":"none","slots":{"text":"${PLANT}"`, 'length'), 'cut_off'],
      [reply(null), 'empty'], [reply('   '), 'empty'], [reply(GAIN6, 'other'), 'empty'],
      [reply(`not json ${PLANT}`), 'not_json'],
      [reply(JSON.stringify({ intent: 'gain_change', slots: { target: 'music' }, extra: PLANT })), 'wrong_shape'],
      [reply(JSON.stringify({ intent: `delete_everything_${PLANT}`, slots: {} })), 'wrong_shape'],
      [reply(JSON.stringify({ intent: 'gain_change', slots: { colour: PLANT } })), 'wrong_shape'],
      // a phrase the bar cannot read: gain_change of a clip has no phrase in the double / the grammar reads none for mute of a clip
      [reply(JSON.stringify({ intent: 'mute', slots: { target: 'clip' } })), 'not_a_command'],
    ];
    for (const [r, category] of cases) {
      const c = checkLocalAnswer(r, LOUD, 'he');
      expect(c, category).toMatchObject({ ok: false, category, reason: ASSISTANT_LOCAL_SENTENCES.invalid.message(category) });
      expect(JSON.stringify(c)).not.toContain(PLANT);
    }
    expect(checkLocalAnswer(reply(JSON.stringify({ intent: 'gain_change', slots: { target: 'music' }, extra: 1 })), LOUD, 'he')).toMatchObject({ issue: 'unrecognized_keys' });
  });
  it('the decimal rule, quotes and control characters: such a slot is dropped malformed (the schema sent is pattern-free)', () => {
    const a = (slots: LocalAnswer['slots'], intent: LocalAnswer['intent'] = 'gain_change'): LocalAnswer => ({ intent, slots });
    expect(malformedSlots(a({ target: 'music', dir: 'down', db: '6' }))).toEqual([]);
    for (const db of ['6.1234', '-6', '1e3', '6 ', '٦', '1234567', '.5', '6.']) expect(malformedSlots(a({ target: 'music', dir: 'down', db })), db).toEqual(['db']);
    for (const text of ['a"b', 'a\'b', 'כותרת״', 'x\u0000', 'x‏y', 'a b', '«x»', '  ']) expect(malformedSlots(a({ text, at: 'start' }, 'add_title')), JSON.stringify(text)).toEqual(['text']);
    expect(malformedSlots(a({ text: 'שלום עולם', at: 'start' }, 'add_title'))).toEqual([]);
    const c = checkLocalAnswer(reply(JSON.stringify({ intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6.12345' } })), LOUD, 'he');
    expect(c).toMatchObject({ ok: true, output: { intent: 'gain_change', slots: { target: 'music', dir: 'down' }, dropped: [{ slot: 'db', why: 'malformed' }] } });
  });
  it('grounding: a number the owner did not say is dropped ungrounded and the phrase asks for it', () => {
    const c = checkLocalAnswer(reply(GAIN6), VAGUE, 'he');
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.output.dropped).toEqual([{ slot: 'db', why: 'ungrounded' }]);
    expect(c.output.slots).toEqual({ target: 'music', dir: 'down' });
    expect(c.output.phrase).toBe(localPhrase('gain_change', { target: 'music', dir: 'down' }, 'he'));
    expect(barUnderstands(c.output.phrase!)).toBe(true);
  });
  it('intent none succeeds with phrase null and no slots', () => {
    expect(checkLocalAnswer(reply('{"intent":"none","slots":{}}'), NOISE, 'he')).toEqual({ ok: true, output: { kind: 'local-intent', intent: 'none', slots: {}, dropped: [], phrase: null } });
  });
});

// =====================================================================================================================
describe('the local branch of the job: no money, the lane, one call, one phrase', () => {
  let mock: LocalMockAdapter;
  beforeEach(() => { mock = createLocalMockAdapter({ [LOUD]: GAIN6, [VAGUE]: GAIN6, [TITLE_REQ]: TITLE, [NOISE]: '{"intent":"none","slots":{}}' }); });

  it('start(): no price, host, model or key is read, no summary is built, no reservation is made; the intent row holds profile local, the text sha and chars, the local digest, the port and not the text', async () => {
    const e = env(mock);
    const reserve = vi.spyOn(e.gov, 'reserveAssistant'), settle = vi.spyOn(e.gov, 'settleAssistant');
    expect(fs.existsSync(path.join(e.dir, 'assistant.key'))).toBe(false); // no key at all, no prices in the config: still ready
    const st = await e.h.status(owner) as { setup: string; local?: unknown };
    expect(st.setup).toBe('ready');
    const job = await run(e, LOUD);
    expect(job.status).toBe('succeeded');
    expect(reserve).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(ledgerRows(e)).toBe(0);
    expect(Object.keys(job.input).sort()).toEqual(['adapter', 'kind', 'lang', 'port', 'profile', 'promptDigest', 'requestedBy', 'text', 'timeoutSeconds']);
    expect(job.input).toMatchObject({ profile: 'local', adapter: 'local-llama-server', port: 18791, timeoutSeconds: 60, lang: 'he', promptDigest: ASSISTANT_LOCAL_PROMPT_DIGEST, text: { chars: [...LOUD].length } });
    expect(Object.keys(job.input.text).sort()).toEqual(['chars', 'sha256']);
    expect(JSON.stringify(job.input)).not.toContain('המוזיקה');
    // the summary: no project data at all went to the adapter
    expect(mock.sent).toEqual([buildLocalRequest(LOUD)]);
    expect(Object.keys(mock.sent[0]!).sort()).toEqual(['maxTokens', 'schema', 'system', 'user']);
    expect(mock.calls).toEqual([{ port: 18791, timeoutMs: 60_000 }]);
  });

  it('Pause Agent still refuses 423 with no job row and nothing sent', async () => {
    const e = env(mock);
    e.gov.setPaused(e.pid, true, owner);
    expect(await codeOf(() => ask(e, LOUD))).toEqual({ status: 423, code: 'agent_paused' });
    expect(e.store.openJobs(ASSISTANT_JOB_TYPE)).toEqual([]);
    expect(mock.sent).toEqual([]);
  });

  it('grammar first: a text the bar reads is refused 409 grammar_understood, no job row, never sent; a text over the limit 400', async () => {
    const e = env(mock);
    for (const text of ['חתוך כאן', 'בטל', 'lower the music by 6 dB']) {
      let r: ApiError | null = null;
      try { await e.h.request(owner, e.pid, { text, selection: [], playheadFrame: 0 }); } catch (x) { r = x as ApiError; }
      expect(r).toBeInstanceOf(ApiError);
      expect(r!.toJSON().error).toMatchObject({ code: 'grammar_understood', message: ASSISTANT_LOCAL_SENTENCES.grammar_understood.message, hint: ASSISTANT_LOCAL_SENTENCES.grammar_understood.hint });
    }
    expect(await codeOf(() => ask(e, 'מ'.repeat(ASSISTANT_LOCAL_TEXT_MAX + 1)))).toEqual({ status: 400, code: 'invalid_request' });
    expect((e.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(0);
    expect(mock.sent).toEqual([]);
  });

  it('setup: no port saved, or no local adapter in this build → 409 assistant_not_connected (provider_not_configured), nothing sent', async () => {
    const noPort = env(mock, { port: null });
    expect(((await noPort.h.status(owner)) as { setup: string }).setup).toBe('provider_not_configured');
    expect(await codeOf(() => ask(noPort, LOUD))).toEqual({ status: 409, code: 'assistant_not_connected' });
    const noAdapter = env(null);
    expect(((await noAdapter.h.status(owner)) as { setup: string }).setup).toBe('provider_not_configured');
    expect(await codeOf(() => ask(noAdapter, LOUD))).toEqual({ status: 409, code: 'assistant_not_connected' });
    expect(mock.sent).toEqual([]);
  });

  it('a gain_change answer becomes the rendered phrase; stages sending → awaiting-local-model → checking; the lane is held as «assistant (local model)» during the call and free after', async () => {
    const e = env(mock);
    const held: (string | null)[] = [];
    const inner = mock.complete;
    mock.complete = (...args) => { held.push(e.lane.busy().holder); return inner(...args); };
    const stages: string[] = [];
    e.store.events.on('job', (j: { stage: string | null }) => { if (j.stage && stages.at(-1) !== j.stage) stages.push(j.stage); });
    const job = await run(e, LOUD);
    const out = job.output as AssistantLocalOutput;
    expect(job.status).toBe('succeeded');
    expect(out).toMatchObject({ kind: 'local-intent', intent: 'gain_change', slots: { target: 'music', dir: 'down', db: '6' }, dropped: [], model: 'MOCK.gguf' });
    expect(out.phrase).toBe(localPhrase('gain_change', { target: 'music', dir: 'down', db: '6' }, 'he'));
    expect(barUnderstands(out.phrase!)).toBe(true);
    expect(typeof out.wallMs).toBe('number');
    expect(stages).toEqual(['sending', 'awaiting-local-model', 'checking']);
    expect(held).toEqual([ASSISTANT_LOCAL_LANE_LABEL]);
    expect(e.lane.busy()).toEqual({ holder: null, waiting: 0 });
    expect(job.error).toBeNull();
  });

  it('intent none succeeds with phrase null', async () => {
    const e = env(mock);
    const job = await run(e, NOISE);
    expect(job).toMatchObject({ status: 'succeeded', output: { intent: 'none', phrase: null, slots: {} } });
  });

  it('waits for the lane (stage waiting-for-compute) while another holder runs, then runs', async () => {
    const e = env(mock);
    const release = await e.lane.acquire('speech');
    const { jobId } = ask(e, LOUD);
    expect(await until(() => e.store.getJob(jobId).stage === 'waiting-for-compute')).toBe(true);
    expect(e.store.getJob(jobId).status).toBe('queued');
    expect(mock.sent).toEqual([]);
    release();
    await e.h.done(jobId);
    expect(e.store.getJob(jobId).status).toBe('succeeded');
    expect(e.lane.busy().holder).toBeNull();
  });

  it('every LocalModelError is an honest state in words (local_* code, fixed sentence, next step), never submission-unknown, never a stack, never money; the lane is released after each', async () => {
    const e = env(mock);
    const cases: [Parameters<LocalMockAdapter['queue']>[0], string, string][] = [
      [{ throw: 'not_running' }, 'local_not_running', ASSISTANT_LOCAL_SENTENCES.local_not_running.message],
      [{ throw: 'loading' }, 'local_loading', ASSISTANT_LOCAL_SENTENCES.local_loading.message],
      [{ throw: 'timeout' }, 'local_timeout', ASSISTANT_LOCAL_SENTENCES.local_timeout.message],
      [{ throw: 'not_loopback' }, 'local_not_loopback', ASSISTANT_LOCAL_SENTENCES.local_not_loopback.message],
      [{ throw: 'server_error', detail: 'HTTP 500' }, 'local_server_error', ASSISTANT_LOCAL_SENTENCES.local_server_error.message('HTTP 500')],
      [{ throw: 'server_error', detail: 'Error: boom\n    at x (/a/b.ts:1:2) מוזיקה' }, 'local_server_error', ASSISTANT_LOCAL_SENTENCES.local_server_error.message('unexpected reply')],
    ];
    for (const [step, code, message] of cases) {
      mock.queue(step);
      const job = await run(e, LOUD);
      expect(job.status, code).toBe('failed');
      expect(job.error, code).toMatchObject({ code, message, retryable: false });
      expect(typeof job.error.hint).toBe('string');
      expect(JSON.stringify(job.error)).not.toMatch(STACK);
      expect(JSON.stringify(job.error)).not.toMatch(MONEY);
      expect(e.lane.busy()).toEqual({ holder: null, waiting: 0 });
    }
    expect(ledgerRows(e)).toBe(0);
    expect((e.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status = 'submission-unknown' OR error LIKE '%submission%'").get() as { n: number }).n).toBe(0);
  });

  it('an invalid answer fails invalid_model_output with its category and the fixed sentence; a planted word of the answer is nowhere in the row', async () => {
    const e = env(mock);
    const PLANT = 'גזרונית';
    const cases: [Parameters<LocalMockAdapter['queue']>[0], string][] = [
      [{ reply: { text: `{"intent":"add_title","slots":{"text":"${PLANT}`, finish: 'length', model: 'm' } }, 'cut_off'],
      [{ reply: { text: null, finish: 'stop', model: 'm' } }, 'empty'],
      [{ reply: { text: `${PLANT}!`, finish: 'stop', model: 'm' } }, 'not_json'],
      [{ reply: { text: JSON.stringify({ intent: `x_${PLANT}`, slots: {} }), finish: 'stop', model: 'm' } }, 'wrong_shape'],
      [{ reply: { text: JSON.stringify({ intent: 'mute', slots: { target: 'clip' } }), finish: 'stop', model: 'm' } }, 'not_a_command'],
    ];
    for (const [step, category] of cases) {
      mock.queue(step);
      const job = await run(e, LOUD);
      expect(job.error, category).toEqual({ code: 'invalid_model_output', category, message: ASSISTANT_LOCAL_SENTENCES.invalid.message(category), hint: ASSISTANT_LOCAL_SENTENCES.invalid.hint, retryable: false });
      expect(JSON.stringify(job)).not.toContain(PLANT);
      expect(job.output).toBeNull();
    }
    e.store.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(holding(e.dir, PLANT)).toEqual([]);
    expect(e.lane.busy().holder).toBeNull();
  });

  it('cancel before the send: canceled with attempt 0, nothing sent, the sentence of canceled_unsent; while it waits for the lane, the same and the waiter leaves the queue', async () => {
    const e = env(mock);
    const { jobId } = ask(e, LOUD);
    expect(e.h.cancel(owner, jobId)).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
    await e.h.done(jobId);
    expect(e.store.getJob(jobId)).toMatchObject({ status: 'canceled', attempt: 0, error: { code: 'canceled', message: ASSISTANT_LOCAL_SENTENCES.canceled_unsent.message } });
    expect(mock.sent).toEqual([]);
    const release = await e.lane.acquire('speech');
    const w = ask(e, LOUD);
    await until(() => e.store.getJob(w.jobId).stage === 'waiting-for-compute');
    expect(e.lane.busy().waiting).toBe(1);
    expect(e.h.cancel(owner, w.jobId).outcome).toBe('removed-from-queue');
    await e.h.done(w.jobId);
    expect(e.store.getJob(w.jobId)).toMatchObject({ status: 'canceled', attempt: 0 });
    expect(e.lane.busy()).toEqual({ holder: 'speech', waiting: 0 });
    release();
    expect(mock.sent).toEqual([]);
  });

  it('cancel while the model answers aborts the call and releases the lane; the sentence says nothing left the computer, nothing of money; agents cannot cancel', async () => {
    const e = env(mock);
    mock.queue({ hold: true });
    const { jobId } = ask(e, LOUD);
    expect(await until(() => e.store.getJob(jobId).stage === 'awaiting-local-model')).toBe(true);
    expect(e.lane.busy().holder).toBe(ASSISTANT_LOCAL_LANE_LABEL);
    for (const a of agents) expect(await codeOf(() => e.h.cancel(a, jobId))).toEqual({ status: 403, code: 'owner_required' });
    const r = e.h.cancel(owner, jobId);
    expect(r).toMatchObject({ status: 'cancel-requested', outcome: 'requested' });
    expect(JSON.stringify(r)).not.toMatch(MONEY);
    await e.h.done(jobId);
    expect(e.store.getJob(jobId)).toMatchObject({ status: 'canceled', attempt: 1, error: { code: 'canceled', message: ASSISTANT_LOCAL_SENTENCES.canceled_sent.message } });
    expect(e.lane.busy()).toEqual({ holder: null, waiting: 0 });
    expect(ledgerRows(e)).toBe(0);
  });

  it('a time limit (the real adapter, a stand-in that answers too late) releases the lane and sends once', async () => {
    const s = await standIn({ [LOUD]: GAIN6 });
    s.script({ answers: { [LOUD]: GAIN6 }, delayMs: 7000 });
    const e = env(createLlamaAdapter(), { port: s.port, timeoutSeconds: 5 });
    const job = await run(e, LOUD);
    expect(job.error).toMatchObject({ code: 'local_timeout', message: ASSISTANT_LOCAL_SENTENCES.local_timeout.message });
    expect(s.requests.filter((r) => r.path === '/v1/chat/completions')).toHaveLength(1);
    expect(e.lane.busy()).toEqual({ holder: null, waiting: 0 });
  }, 15_000);

  it('a stopped, loading or wrong server on the port: the real adapter gives the decided codes in words', async () => {
    const e1 = env(createLlamaAdapter(), { port: await freePort() });
    expect((await run(e1, LOUD)).error).toMatchObject({ code: 'local_not_running', message: ASSISTANT_LOCAL_SENTENCES.local_not_running.message });
    const s = await standIn();
    s.script({ answers: {}, loadingMs: 60_000 });
    const e2 = env(createLlamaAdapter(), { port: s.port });
    expect((await run(e2, LOUD)).error).toMatchObject({ code: 'local_loading' });
    const wrong = await rawListener(() => 'HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot here!');
    const e3 = env(createLlamaAdapter(), { port: wrong.port });
    const j3 = await run(e3, LOUD);
    expect(j3.error).toMatchObject({ code: 'local_server_error', message: ASSISTANT_LOCAL_SENTENCES.local_server_error.message('HTTP 404') });
    expect(JSON.stringify(j3)).not.toContain('not here');
    for (const e of [e1, e2, e3]) expect(e.lane.busy().holder).toBeNull();
  });

  it('after a restart a local job still queued or running is ended honestly (failed local_interrupted, the recovered sentence), never resumed, never unknown, no ledger', () => {
    const e = env(mock);
    const mk = (status: string, attempt: number) => {
      const j = e.store.createJob(e.pid, ASSISTANT_JOB_TYPE, 'agent:assistant', { kind: 'assistant.propose', profile: 'local', requestedBy: 'user:local', text: { sha256: 'sha256:x', chars: 3 }, promptDigest: ASSISTANT_LOCAL_PROMPT_DIGEST, adapter: 'local-llama-server', port: 18791, timeoutSeconds: 60, lang: 'he' });
      if (status !== 'queued') e.store.updateJob(j.id, { status, stage: 'awaiting-local-model', attempt });
      return j.id;
    };
    const ids = [mk('queued', 0), mk('running', 1), mk('cancel-requested', 1)];
    const out = recoverAssistantJobs(e.store, e.gov);
    expect(out.map((j) => j.id).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const j = e.store.getJob(id);
      expect(j).toMatchObject({ status: 'failed', stage: null, error: { code: 'local_interrupted', message: ASSISTANT_LOCAL_SENTENCES.recovered.message, hint: ASSISTANT_LOCAL_SENTENCES.recovered.hint } });
      expect(JSON.stringify(j.error)).not.toMatch(MONEY);
    }
    expect(ledgerRows(e)).toBe(0);
    expect(mock.sent).toEqual([]);
  });
});

// =====================================================================================================================
describe('the two owner-only routes', () => {
  it('agents are refused 403 owner_required on check and taken, before anything is looked up', async () => {
    const e = env(createLocalMockAdapter({}));
    for (const a of agents) {
      expect(await codeOf(() => e.h.localCheck(a))).toEqual({ status: 403, code: 'owner_required' });
      expect(await codeOf(() => e.h.taken(a, 'job_does_not_exist'))).toEqual({ status: 403, code: 'owner_required' });
    }
  });

  it('check: reports the run-time\'s honest state (running, loading, stopped, not llama.cpp) and the owner\'s status keeps the last one', async () => {
    const s = await standIn();
    const e = env(createLlamaAdapter(), { port: s.port });
    const before = await e.h.status(owner) as { local: unknown };
    expect(before.local).toEqual({ port: s.port, timeoutSeconds: 60, lastCheck: null });
    const c1 = await e.h.localCheck(owner);
    expect(c1).toMatchObject({ state: 'running', model: 'STAND-IN.gguf' });
    expect(typeof c1.checkedAt).toBe('string');
    expect((await e.h.status(owner) as { local: { lastCheck: unknown } }).local.lastCheck).toEqual(c1);
    s.script({ answers: {}, loadingMs: 60_000 });
    expect(await e.h.localCheck(owner)).toMatchObject({ state: 'loading', model: null });
    const stopped = env(createLlamaAdapter(), { port: await freePort() });
    expect(await stopped.h.localCheck(owner)).toMatchObject({ state: 'stopped', model: null });
    const other = await rawListener(() => 'HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    const wrong = env(createLlamaAdapter(), { port: other.port });
    expect(await wrong.h.localCheck(owner)).toMatchObject({ state: 'not_llama', model: null });
    // no port saved: nothing to check, said with the next step
    const none = env(createLlamaAdapter(), { port: null });
    expect(await codeOf(() => none.h.localCheck(owner))).toEqual({ status: 409, code: 'assistant_not_connected' });
    // agents read connected, setup and detail only
    for (const a of agents) expect(JSON.stringify(await e.h.status(a))).not.toMatch(new RegExp(`${s.port}|STAND-IN`));
  });

  it('taken: owner only; clears the phrase and the text slot by direct SQL inside Store.erasing; 404 unknown job, 409 not a local job; the planted title is absent from the database file and its WAL afterwards', async () => {
    const mock = createLocalMockAdapter({ [TITLE_REQ]: TITLE });
    const e = env(mock);
    const erasing = vi.spyOn(e.store, 'erasing');
    const job = await run(e, TITLE_REQ);
    expect(job.status).toBe('succeeded');
    expect(job.output).toMatchObject({ intent: 'add_title', slots: { text: TITLE_MARK, at: 'start' } });
    expect(job.output.phrase).toContain(TITLE_MARK);
    expect(holding(e.dir, TITLE_MARK).length).toBeGreaterThan(0); // control: the phrase is stored until taken
    expect(await codeOf(() => e.h.taken(owner, 'job_does_not_exist'))).toEqual({ status: 404, code: 'job_not_found' });
    const cloud = e.store.createJob(e.pid, ASSISTANT_JOB_TYPE, 'agent:assistant', { kind: 'assistant.propose' });
    expect(await codeOf(() => e.h.taken(owner, cloud.id))).toEqual({ status: 409, code: 'not_a_local_job' });
    const other = e.store.createJob(e.pid, 'export', 'user:local', {});
    expect(await codeOf(() => e.h.taken(owner, other.id))).toEqual({ status: 409, code: 'not_a_local_job' });
    const update = vi.spyOn(e.store, 'updateJob');
    await e.h.taken(owner, job.id);
    expect(update).not.toHaveBeenCalled(); // direct SQL, not updateJob
    expect(erasing).toHaveBeenCalledTimes(1);
    const after = e.store.getJob(job.id);
    expect(after.output).toMatchObject({ kind: 'local-intent', intent: 'add_title', phrase: null, slots: {}, cleared: true, model: 'MOCK.gguf' });
    expect(after.status).toBe('succeeded');
    expect(holding(e.dir, TITLE_MARK)).toEqual([]);
    await e.h.taken(owner, job.id); // a second take is harmless
    expect(erasing).toHaveBeenCalledTimes(1);
  });

  it('the next local request on the project clears the earlier phrase; a deleted project takes its jobs with it', async () => {
    const mock = createLocalMockAdapter({ [TITLE_REQ]: TITLE, [NOISE]: '{"intent":"none","slots":{}}' });
    const e = env(mock);
    const first = await run(e, TITLE_REQ);
    expect(first.output.phrase).toContain(TITLE_MARK);
    await run(e, NOISE);
    expect(e.store.getJob(first.id).output).toMatchObject({ phrase: null, slots: {}, cleared: true });
    expect(holding(e.dir, TITLE_MARK)).toEqual([]);
    const second = await run(e, TITLE_REQ);
    expect(holding(e.dir, TITLE_MARK).length).toBeGreaterThan(0);
    deleteProject(e.store, owner, e.pid, e.store.getProject(e.pid).doc.name);
    expect(() => e.store.getJob(second.id)).toThrow(ApiError);
    e.store.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(holding(e.dir, TITLE_MARK)).toEqual([]);
  });
});

describe('the two prompt pins are unchanged', () => {
  it('cloud and local digests', () => {
    expect(ASSISTANT_PROMPT_DIGEST).toBe('sha256:90a0e5b93c02fd3999c13bf5a9c5eca28d9985d66582baed37f7c4ee4551425c');
    expect(assistantPrompt().digest).toBe(ASSISTANT_PROMPT_DIGEST);
    expect(ASSISTANT_LOCAL_PROMPT_DIGEST).toBe('sha256:6d81c9da2547918c5fa53d8437bd40eaef6bfe31c935b29eccb03373d2c2f50b');
    expect(localPrompt().digest).toBe(ASSISTANT_LOCAL_PROMPT_DIGEST);
  });
});

