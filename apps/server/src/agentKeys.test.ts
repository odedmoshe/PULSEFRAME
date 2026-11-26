/**
 * The agent's keys, provider settings, model table and «בדיקה» (wave 8 autonomy Part 2, builder W2; proof:agent check 13).
 * The key here is a made-up TEST string, never a real one; the "provider" of the probe rows is a LABELLED local test double
 * (`http.createServer` on port 0, loopback only, canned answers). Every console line written during the file is captured and
 * searched for the key.
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AGENT_MODEL_TABLE, AGENT_PROVIDER_PRESETS, createScriptedModel, AgentProviderError, type AgentModelAdapter } from '@pulseframe/providers';
import { Auth } from './auth.ts';
import { AGENT_OWNER_MODELS_FILE as BACKUP_MODELS_FILE, backupDataDir } from './backup.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { AGENT_OWNER_MODELS_FILE, AgentKeyStore, normalizeBaseUrl } from './agent/keys.ts';
import { createAgentProviders, redactingAdapter } from './agent/providers.ts';

const FAKE_KEY = 'TEST-ONLY-agent-key-c0ffee-not-real';
const logged: string[] = [];
let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, ownerCookie = '';
let dbl: http.Server, dblBase = '', canned: { status: number; body: unknown } = { status: 200, body: {} };
const dblSeen: { url: string; headers: http.IncomingHttpHeaders }[] = [];
const base = () => `http://127.0.0.1:${cfg.port}`;
const agentH = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json' });
const ownerH = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const answers: string[] = [];
const rest = async (method: string, p: string, headers: Record<string, string>, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  answers.push(text);
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, text };
};
const mode = (f: string) => fs.statSync(f).mode & 0o777;

beforeAll(async () => {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a.map(String).join(' ')); });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-keys-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg), derivatives = new Derivatives(store), presence = new Presence(), gov = new Governance(store), speech = new Speech(store, cfg);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  dbl = http.createServer((rq, rs) => {
    rq.resume();
    rq.on('end', () => { dblSeen.push({ url: rq.url!, headers: rq.headers }); rs.writeHead(canned.status, { 'content-type': 'application/json' }); rs.end(JSON.stringify(canned.body)); });
  });
  await new Promise<void>((r) => dbl.listen(0, '127.0.0.1', r));
  dblBase = `http://127.0.0.1:${(dbl.address() as AddressInfo).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  (app as any).browserExport?.stop(); await (mcp as any).close?.(); store.close();
  dbl.closeAllConnections(); await new Promise((r) => dbl.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the key store on disk (decision 3)', () => {
  it('writes <dataDir>/agent/keys/<id>.key as mode 0600 in 0700 folders; keyState never holds the key; refuses what is not one line', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-ks-'));
    try {
      const k = new AgentKeyStore(d);
      expect(k.keyState('anthropic')).toEqual({ keySet: false, keyAddedAt: null });
      const st = k.writeKey('anthropic', `  ${FAKE_KEY}\n`);
      expect(st.keySet).toBe(true);
      expect(JSON.stringify(st)).not.toContain(FAKE_KEY);
      const file = path.join(d, 'agent', 'keys', 'anthropic.key');
      expect(fs.readFileSync(file, 'utf8')).toBe(FAKE_KEY);
      if (process.platform !== 'win32') { expect(mode(file)).toBe(0o600); expect(mode(path.join(d, 'agent', 'keys'))).toBe(0o700); expect(mode(path.join(d, 'agent'))).toBe(0o700); }
      expect(k.readKey('anthropic')).toBe(FAKE_KEY);
      for (const bad of ['', 'two words', 'a\u0007b', 'x'.repeat(5000)]) expect(() => k.writeKey('anthropic', bad)).toThrow(expect.objectContaining({ status: 400, code: 'invalid_request' }));
      expect(() => k.writeKey('../../etc', FAKE_KEY)).toThrow(expect.objectContaining({ status: 404, code: 'agent_provider_unknown' }));
      expect(k.deleteKey('anthropic')).toEqual({ keySet: false, keyAddedAt: null });
      expect(fs.existsSync(file)).toBe(false);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('C5: any http(s) base URL is stored (a LAN http address included); a scheme, credentials, a query or a fragment are refused with the next step', () => {
    expect(normalizeBaseUrl(' http://192.168.1.20:9931/v1/ ')).toBe('http://192.168.1.20:9931/v1');
    expect(normalizeBaseUrl('https://api.anthropic.com')).toBe('https://api.anthropic.com');
    for (const bad of ['ftp://h/v1', 'not a url', 'https://user:pw@h/v1', 'https://h/v1?k=1', 'https://h/v1#x']) {
      try { normalizeBaseUrl(bad); throw new Error(`accepted ${bad}`); } catch (e: any) { expect([bad, e.status, typeof e.hint]).toEqual([bad, 400, 'string']); }
    }
  });
});

describe('createAgentProviders: resolve and view (the frozen AgentProviders seam)', () => {
  it('409 agent_provider_not_connected until a model and (where needed) a key exist; the default is the provider connected last', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-pr-'));
    try {
      const mock = createScriptedModel([]);
      const p = createAgentProviders(d, new Map([['anthropic-messages', mock], ['openai-chat', mock]]));
      expect(() => p.resolve()).toThrow(expect.objectContaining({ status: 409, code: 'agent_provider_not_connected' }));
      p.keys.writeSettings({ providerId: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' });
      expect(() => p.resolve()).toThrow(expect.objectContaining({ code: 'agent_provider_not_connected' })); // no key yet
      p.keys.writeKey('anthropic', FAKE_KEY);
      const r = p.resolve();
      expect([r.preset.id, r.endpoint, r.key, r.row?.priceInPerMTok]).toEqual(['anthropic', { providerId: 'anthropic', family: 'anthropic-messages', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' }, FAKE_KEY, 4]);
      p.keys.writeSettings({ providerId: 'llamacpp', baseUrl: 'http://192.168.1.20:9931/v1', model: 'my-gguf' });
      const l = p.resolve();
      expect([l.preset.id, l.key, l.row]).toEqual(['llamacpp', null, null]); // local: no key is sent; a model the table does not list has no row
      expect(p.resolve('anthropic', 'claude-haiku-5-5').row?.id).toBe('claude-haiku-5-5');
      expect(() => p.resolve('nope')).toThrow(expect.objectContaining({ status: 404 }));
      const v = p.view();
      expect(v.defaultProviderId).toBe('llamacpp');
      expect(v.providers.map((x) => x.id)).toEqual(AGENT_PROVIDER_PRESETS.map((x) => x.id));
      expect(v.providers.find((x) => x.id === 'llamacpp')).toMatchObject({ baseUrl: 'http://192.168.1.20:9931/v1', unencrypted: true, keySet: false, local: true });
      expect(v.providers.find((x) => x.id === 'anthropic')).toMatchObject({ keySet: true, unencrypted: false });
      expect(JSON.stringify(v)).not.toContain(FAKE_KEY);
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  it('the adapter handed out passes every error and probe detail through redact(key) again', async () => {
    const echo: AgentModelAdapter = {
      id: 'TEST-echo', family: 'openai-chat',
      async turn(_r, _e, key) { throw new AgentProviderError('unauthorized', false, `provider said: bad key ${key}`); },
      async probe(_e, key) { return { ok: false, code: 'unauthorized', detail: `bad ${key}` }; },
    };
    const a = redactingAdapter(echo);
    const ep = { providerId: 'openai', family: 'openai-chat' as const, baseUrl: 'https://x', model: 'm' };
    const e = await a.turn({ system: '', messages: [], tools: [], maxOutputTokens: 1, cache: false, parallelToolCalls: true }, ep, FAKE_KEY, new AbortController().signal).catch((x) => x);
    expect([e.code, e.message.includes(FAKE_KEY), e.message]).toEqual(['unauthorized', false, 'provider said: bad key [redacted]']);
    expect(await a.probe(ep, FAKE_KEY, new AbortController().signal)).toEqual({ ok: false, code: 'unauthorized', detail: 'bad [redacted]' });
  });
});

describe('routes (owner floor on keys, addresses, probe and the model table; GET answers keySet only)', () => {
  it('the owner stores a key; no answer holds it; an agent gets 403 on every floor route and reads keySet', async () => {
    const put = await rest('PUT', '/api/v1/agent/providers/anthropic/key', ownerH(), { key: FAKE_KEY });
    expect([put.status, put.body.keySet]).toEqual([200, true]);
    for (const [m, p, b] of [['PUT', '/api/v1/agent/providers/anthropic/key', { key: 'other' }], ['DELETE', '/api/v1/agent/providers/anthropic/key', undefined], ['PUT', '/api/v1/agent/providers/anthropic', { model: 'x' }], ['POST', '/api/v1/agent/providers/anthropic/probe', {}], ['PUT', '/api/v1/agent/models', { rows: [] }]] as const) {
      expect([p, m, (await rest(m, p, agentH(), b)).status]).toEqual([p, m, 403]);
    }
    const g = await rest('GET', '/api/v1/agent/providers', agentH());
    expect(g.status).toBe(200);
    expect(g.body.providers.find((x: any) => x.id === 'anthropic')).toMatchObject({ keySet: true, needsKey: true });
    expect(g.text).not.toContain(FAKE_KEY);
    expect(fs.readFileSync(path.join(dir, 'agent', 'keys', 'anthropic.key'), 'utf8')).toBe(FAKE_KEY);
  });
  it('a LAN http base URL is stored and flagged unencrypted; an omitted field keeps its value; a bad address is 400', async () => {
    const a = await rest('PUT', '/api/v1/agent/providers/llamacpp', ownerH(), { baseUrl: 'http://192.168.1.20:9931/v1', model: 'qwen-gguf' });
    expect(a.status).toBe(200);
    expect(a.body.providers.find((x: any) => x.id === 'llamacpp')).toMatchObject({ baseUrl: 'http://192.168.1.20:9931/v1', model: 'qwen-gguf', unencrypted: true });
    const b = await rest('PUT', '/api/v1/agent/providers/llamacpp', ownerH(), { model: 'other-gguf' });
    expect(b.body.providers.find((x: any) => x.id === 'llamacpp')).toMatchObject({ baseUrl: 'http://192.168.1.20:9931/v1', model: 'other-gguf' });
    expect((await rest('PUT', '/api/v1/agent/providers/llamacpp', ownerH(), { baseUrl: 'https://u:p@h/v1' })).status).toBe(400);
    expect((await rest('PUT', '/api/v1/agent/providers/llamacpp', ownerH(), { key: FAKE_KEY })).status).toBe(400); // the settings body never takes a key
    const file = JSON.parse(fs.readFileSync(path.join(dir, 'agent', 'providers.json'), 'utf8'));
    expect(JSON.stringify(file)).not.toContain(FAKE_KEY);
  });
  it('«בדיקה» against the LABELLED local double: ok with the model; a 401 that echoes the key → unauthorized and the answer holds no key', async () => {
    await rest('PUT', '/api/v1/agent/providers/anthropic', ownerH(), { baseUrl: dblBase, model: 'claude-opus-5-5' });
    canned = { status: 200, body: { id: 'msg_t', model: 'claude-opus-5-5', role: 'assistant', stop_reason: 'max_tokens', content: [{ type: 'text', text: 'p' }] } };
    const ok = await rest('POST', '/api/v1/agent/providers/anthropic/probe', ownerH(), {});
    expect(ok.body).toEqual({ ok: true, code: null, model: 'claude-opus-5-5' });
    expect([dblSeen.at(-1)!.url, dblSeen.at(-1)!.headers['x-api-key'], dblSeen.at(-1)!.headers['anthropic-version']]).toEqual(['/v1/messages', FAKE_KEY, '2026-10-21']);
    canned = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${FAKE_KEY}` } } };
    const bad = await rest('POST', '/api/v1/agent/providers/anthropic/probe', ownerH(), {});
    expect(bad.body).toEqual({ ok: false, code: 'unauthorized', model: 'claude-opus-5-5' });
    expect(bad.text).not.toContain(FAKE_KEY);
    const noModel = await rest('POST', '/api/v1/agent/providers/xai/probe', ownerH(), {});
    expect(noModel.body).toEqual({ ok: false, code: 'bad_config', model: null });
  });
  it('the model table: built-in rows with their date; the owner\'s rows replace or add, persist in agent-models.json (outside agent/); duplicates are 400', async () => {
    const g = await rest('GET', '/api/v1/agent/models', agentH());
    expect([g.status, g.body.rows.length, g.body.ownerRows]).toEqual([200, AGENT_MODEL_TABLE.length, []]);
    const mine = { ...AGENT_MODEL_TABLE[0]!, priceInPerMTok: 3.5, readAt: 'owner' };
    const extra = { providerId: 'ollama', id: 'qwen-small', label: 'qwen small', contextTokens: 64000, maxOutputTokens: null, priceInPerMTok: null, priceOutPerMTok: null, vision: false, readAt: 'owner', source: 'owner' };
    const p = await rest('PUT', '/api/v1/agent/models', ownerH(), { rows: [mine, extra] });
    expect([p.status, p.body.rows.length, p.body.rows[0].priceInPerMTok, p.body.ownerRows.length]).toEqual([200, AGENT_MODEL_TABLE.length + 1, 3.5, 2]);
    expect(JSON.parse(fs.readFileSync(path.join(dir, AGENT_OWNER_MODELS_FILE), 'utf8'))).toHaveLength(2);
    expect((await rest('PUT', '/api/v1/agent/models', ownerH(), { rows: [extra, extra] })).status).toBe(400);
    expect((await rest('PUT', '/api/v1/agent/models', ownerH(), { rows: [{ ...extra, providerId: 'nope' }] })).status).toBe(404);
  });
  it('DELETE forgets the key', async () => {
    const d = await rest('DELETE', '/api/v1/agent/providers/anthropic/key', ownerH());
    expect(d.body).toEqual({ keySet: false, keyAddedAt: null });
    expect(fs.existsSync(path.join(dir, 'agent', 'keys', 'anthropic.key'))).toBe(false);
  });
});

describe('backups: the key never; the owner\'s model rows always', () => {
  it('a backup of a data dir with a key, settings and owner rows holds the rows and no agent/ folder', async () => {
    expect(BACKUP_MODELS_FILE).toBe(AGENT_OWNER_MODELS_FILE);
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-bk2-src-')), dest = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pf-agent-bk2-')), 'copy');
    try {
      new Database(path.join(src, 'pulseframe.sqlite')).exec('CREATE TABLE projects (id TEXT)');
      const k = new AgentKeyStore(src);
      k.writeKey('openai', FAKE_KEY);
      k.writeSettings({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6.2-sol' });
      k.writeOwnerModels([{ ...AGENT_MODEL_TABLE[4]!, readAt: 'owner' }]);
      await backupDataDir(src, dest);
      expect(fs.existsSync(path.join(dest, 'agent'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(dest, AGENT_OWNER_MODELS_FILE), 'utf8'))[0].readAt).toBe('owner');
      const everything = fs.readdirSync(dest, { recursive: true }).map(String).filter((f) => fs.statSync(path.join(dest, f)).isFile()).map((f) => fs.readFileSync(path.join(dest, f)).toString('latin1')).join('\n');
      expect(everything).not.toContain(FAKE_KEY);
      fs.rmSync(path.join(src, AGENT_OWNER_MODELS_FILE));
      await backupDataDir(src, dest);
      expect(fs.existsSync(path.join(dest, AGENT_OWNER_MODELS_FILE))).toBe(false); // deleted rows are not brought back
    } finally { fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(path.dirname(dest), { recursive: true, force: true }); }
  });
});

describe('the key is in no answer and no log line (proof:agent check 13)', () => {
  it('no route answer of this file and no captured console line holds the key', () => {
    expect(answers.length).toBeGreaterThan(10);
    for (const a of answers) expect(a).not.toContain(FAKE_KEY);
    for (const l of logged) expect(l).not.toContain(FAKE_KEY);
  });
});
