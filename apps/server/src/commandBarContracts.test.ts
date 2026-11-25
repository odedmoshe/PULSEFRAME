/**
 * Lead contracts of the Hebrew command bar (ADR-0027) on the server: history events say which transaction undid which (the
 * bar previews the exact undo target), the strict commit refuses a stale revision and replays a repeated key, the
 * assistant's own spending method (monthly limit + per-request cap, propose-only principal, settlement), the reserved
 * actor name, the backup never holding the assistant's key or config, PF_ASSISTANT_HOSTS, the chat descriptor outside the
 * capability union, and the assistant's routes refusing honestly (owner-only routes refuse agents with 403 first; the
 * owner routes create no job). Nothing here pins W2's handlers: GET …/assistant/status may answer 501 not_built (the
 * placeholder) or W2's status, which on a fresh data directory is not 'ready' and never holds a key. Their tests are W2's.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { ASSISTANT_ACTOR, ASSISTANT_PUBLIC_SETUP, ASSISTANT_PUBLIC_STATUS_KEYS, ASSISTANT_SETUP_CODES, barIdempotencyKey, barPlanHash, COMMAND_BAR_LABEL } from '@pulseframe/core';
import { ALL_CAPABILITIES, CHAT_BLOCKER_CODES, ChatCapabilityDescriptorSchema, DescriptorSchema, QUALIFICATION_DIMENSIONS } from '@pulseframe/providers';
import { Governance, type Principal } from './governance.ts';
import { ApiError, Store } from './store.ts';
import { backupDataDir, NEVER_BACKED_UP } from './backup.ts';
import { loadConfig } from './config.ts';
import { ASSISTANT_CONFIG_FILE, ASSISTANT_KEY_FILE, ASSISTANT_ROUTES, assistantPrincipal, isOwnerSession } from './assistant/contract.ts';
import { startServer } from './index.ts';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); dirs.push(d); return d; };
const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
const user: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? `${e.status}:${e.code}` : `non-api:${e}`; } return 'ok'; };
const text = (frame: number) => ({ op: 'add_text', args: { text: `t${frame}`, start: f(frame), duration: f(30) } });

describe('history events carry the undo state (contract (c))', () => {
  it('an edit is not undone until its undo names it; the undo names what it undoes; a redo undoes the undo', () => {
    const store = new Store(tmp('pf-cb-hist-'));
    const pid = store.createProject({ name: 'p' }).doc.id;
    const live: unknown[] = [];
    store.events.on('revision', (e) => live.push(e));
    const a = store.commit({ projectId: pid, actor: 'user:local', ops: [text(0)] });
    expect(live.at(-1)).toMatchObject({ transactionId: a.transactionId, undoes: null, undoneBy: null });
    const u = store.undo(pid, 'user:local', 'undo');
    expect(live.at(-1)).toMatchObject({ transactionId: u.transactionId, kind: 'undo', undoes: a.transactionId, undoneBy: null });
    let h = store.eventsSince(pid, 0);
    expect(h.find((e) => e.transactionId === a.transactionId)).toMatchObject({ undoneBy: u.transactionId, undoes: null });
    expect(h.find((e) => e.transactionId === u.transactionId)).toMatchObject({ undoneBy: null, undoes: a.transactionId });
    const r = store.undo(pid, 'user:local', 'redo');
    h = store.eventsSince(pid, 0);
    expect(h.find((e) => e.transactionId === u.transactionId)).toMatchObject({ undoneBy: r.transactionId });
    expect(h.find((e) => e.transactionId === r.transactionId)).toMatchObject({ kind: 'redo', undoes: u.transactionId, undoneBy: null });
  });
});

describe('the strict commit the bar uses (contract (b), server side)', () => {
  it('refuses a stale expectedRevision without applying anything, and replays a repeated idempotency key', () => {
    const store = new Store(tmp('pf-cb-strict-'));
    const { doc, revision } = store.createProject({ name: 'p' });
    const ops = [text(0)];
    const key = barIdempotencyKey(barPlanHash('add_title', ops, revision));
    store.commit({ projectId: doc.id, actor: 'agent:other', ops: [text(60)] }); // someone else moved the project on
    expect(code(() => store.commit({ projectId: doc.id, actor: 'user:local', ops, expectedRevision: revision, idempotencyKey: key, label: COMMAND_BAR_LABEL('add_title') }))).toBe('409:stale_revision');
    expect(store.getProject(doc.id).revision).toBe(revision + 1);
    const now = store.getProject(doc.id).revision;
    const key2 = barIdempotencyKey(barPlanHash('add_title', ops, now));
    const first = store.commit({ projectId: doc.id, actor: 'user:local', ops, expectedRevision: now, idempotencyKey: key2, label: COMMAND_BAR_LABEL('add_title') });
    const again = store.commit({ projectId: doc.id, actor: 'user:local', ops, expectedRevision: now, idempotencyKey: key2, label: COMMAND_BAR_LABEL('add_title') });
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, transactionId: first.transactionId, revision: first.revision });
    expect(store.eventsSince(doc.id, now).map((e) => e.label)).toEqual(['Command bar: add_title']);
  });
});

describe('the assistant spends the owner money through its own method (contract (a))', () => {
  const limits = { monthlyLimitCents: 100, perRequestCapCents: 30 };
  function setup(at = Date.UTC(2026, 10, 18, 12)) {
    let now = at;
    const store = new Store(tmp('pf-cb-gov-'));
    const gov = new Governance(store, () => now);
    const pid = store.createProject({ name: 'p' }).doc.id;
    const p = assistantPrincipal(pid, limits.monthlyLimitCents, new Date(now).toISOString());
    const job = () => store.createJob(pid, 'assistant.propose', ASSISTANT_ACTOR, {}).id;
    return { store, gov, pid, p, job, setNow: (t: number) => { now = t; } };
  }
  it('accepts only the in-memory propose-only assistant, and only when both limits are set', () => {
    const { store, gov, pid, p, job } = setup();
    expect(p).toMatchObject({ actor: 'agent:assistant', kind: 'agent', mode: 'propose', scopes: ['observe'], grant: { id: 'assistant', people: 'names', projectIds: [pid] } });
    expect(code(() => gov.reserveAssistant(user, pid, job(), 5, limits))).toBe('403:insufficient_scope');
    const grantAgent = gov.principalForToken(gov.createGrant({ name: 'helper', mode: 'propose' }, user).token)!;
    expect(code(() => gov.reserveAssistant(grantAgent, pid, job(), 5, limits))).toBe('403:insufficient_scope');
    expect(code(() => gov.reserveAssistant({ ...p, mode: 'autopilot' }, pid, job(), 5, limits))).toBe('403:insufficient_scope');
    const other = store.createProject({ name: 'q' }).doc.id;
    expect(code(() => gov.reserveAssistant(p, other, job(), 5, limits))).toBe('403:out_of_scope');
    expect(code(() => gov.reserveAssistant(p, pid, job(), 5, { monthlyLimitCents: 0, perRequestCapCents: 30 }))).toBe('409:assistant_not_connected');
    expect(code(() => gov.reserveAssistant(p, pid, job(), 5, { monthlyLimitCents: 100, perRequestCapCents: 0 }))).toBe('409:assistant_not_connected');
    gov.setPaused(pid, true, user);
    expect(code(() => gov.reserveAssistant(p, pid, job(), 5, limits))).toBe('423:agent_paused');
    expect(gov.assistantSpend()).toMatchObject({ spentCents: 0, reservedCents: 0 });
  });
  it('refuses above the per-request cap and above the month, before anything is reserved', () => {
    const { gov, pid, p, job } = setup();
    expect(code(() => gov.reserveAssistant(p, pid, job(), 31, limits))).toBe('402:budget_exceeded');
    for (let i = 0; i < 3; i++) gov.reserveAssistant(p, pid, job(), 30, limits);
    expect(gov.assistantSpend()).toEqual({ month: '2026-11', spentCents: 0, reservedCents: 90 });
    expect(code(() => gov.reserveAssistant(p, pid, job(), 11, limits))).toBe('402:budget_exceeded');
    gov.reserveAssistant(p, pid, job(), 10, limits);
    expect(gov.assistantSpend().reservedCents).toBe(100);
  });
  it('settles at the reported cost (even above the reservation), or at the reservation, or keeps an unknown counted; a new month starts empty', () => {
    const { store, gov, pid, p, job, setNow } = setup();
    const a = job(), b = job(), c = job(), d = job();
    for (const j of [a, b, c, d]) gov.reserveAssistant(p, pid, j, 20, limits);
    expect(gov.settleAssistant(a, 35)).toBe(true);
    store.updateJob(a, { status: 'succeeded', attempt: 1 });
    expect(gov.ledgerFor(a)).toEqual({ reservedCents: 20, actualCents: 35, state: 'settled' });
    store.updateJob(b, { status: 'succeeded', attempt: 1 }); // no usage reported: the reservation, conservatively
    expect(gov.ledgerFor(b)).toEqual({ reservedCents: 20, actualCents: 20, state: 'settled' });
    store.updateJob(c, { status: 'submission-unknown', attempt: 1 });
    expect(gov.ledgerFor(c)!.state).toBe('unknown');
    store.updateJob(d, { status: 'canceled', attempt: 0 });
    expect(gov.ledgerFor(d)!.state).toBe('released');
    expect(gov.settleAssistant(d, 5)).toBe(false); // only a reserved row is settled
    expect(gov.assistantSpend()).toEqual({ month: '2026-11', spentCents: 55, reservedCents: 20 });
    setNow(Date.UTC(2026, 11, 1, 0, 0, 1));
    expect(gov.assistantSpend()).toEqual({ month: '2026-12', spentCents: 0, reservedCents: 0 });
  });
  it('the actor name of the assistant cannot be given to a credential', () => {
    const { gov } = setup();
    expect(code(() => gov.createGrant({ name: 'assistant', mode: 'propose' }, user))).toBe('400:invalid_request');
  });
  it('isOwnerSession is the owner browser session only', () => {
    expect(isOwnerSession(user)).toBe(true);
    expect(isOwnerSession({ actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'] })).toBe(false);
    expect(isOwnerSession({ actor: 'phone:drp_1', kind: 'user', scopes: ['observe'] })).toBe(false);
  });
});

describe('the key and the config never leave the data directory by backup (decision 9)', () => {
  it('a backup holds neither file, also when one was left in the destination by hand', async () => {
    const src = tmp('pf-cb-bk-src-'), dest = path.join(tmp('pf-cb-bk-dest-'), 'copy');
    const store = new Store(src);
    store.createProject({ name: 'p' });
    // the assistant's two files; the library track (wave 7) adds its own setting and index to the same list
    expect([...NEVER_BACKED_UP]).toEqual(expect.arrayContaining([ASSISTANT_CONFIG_FILE, ASSISTANT_KEY_FILE]));
    fs.writeFileSync(path.join(src, ASSISTANT_KEY_FILE), 'TEST-DOUBLE-NOT-A-KEY', { mode: 0o600 });
    fs.writeFileSync(path.join(src, ASSISTANT_CONFIG_FILE), '{}', { mode: 0o600 });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, ASSISTANT_KEY_FILE), 'TEST-DOUBLE-LEFT-BY-HAND');
    await backupDataDir(src, dest);
    store.db.close();
    for (const name of NEVER_BACKED_UP) expect(fs.existsSync(path.join(dest, name)), name).toBe(false);
    expect(fs.existsSync(path.join(dest, 'pulseframe.sqlite'))).toBe(true);
  });
});

describe('configuration and descriptor', () => {
  it('PF_ASSISTANT_HOSTS lists exact host names; none by default', () => {
    expect(loadConfig({}).assistantHosts).toEqual([]);
    expect(loadConfig({ PF_ASSISTANT_HOSTS: ' API.Example.com,,other.example ' }).assistantHosts).toEqual(['api.example.com', 'other.example']);
  });
  it('the chat descriptor stays outside the capability union and registry (decision 10); its blocker codes are the setup codes', () => {
    const d = {
      id: 'assistant.edit-proposal', version: '0.1.0', state: 'draft', provider: 'chat', title: { he: 'עוזר השפה', en: 'Language assistant' }, description: { he: 'מציע עריכה', en: 'Proposes an edit' },
      promptDigest: `sha256:${'0'.repeat(64)}`, egress: { kind: 'remote-api', hosts: [] }, dataSent: ['settings'], cost: { basis: 'per token at owner-entered prices', perRequestCapCents: 0 }, languages: ['he', 'en'],
      qualification: Object.fromEntries(QUALIFICATION_DIMENSIONS.map((k) => [k, { status: 'not_assessed' }])),
    };
    expect(ChatCapabilityDescriptorSchema.safeParse(d).success).toBe(true);
    expect(DescriptorSchema.safeParse(d).success).toBe(false);
    expect(ALL_CAPABILITIES.some((c) => (c as { provider: string }).provider === 'chat' || c.id === 'assistant.edit-proposal')).toBe(false);
    expect([...CHAT_BLOCKER_CODES]).toEqual(ASSISTANT_SETUP_CODES.filter((c) => c !== 'ready'));
  });
});

/**
 * What an agent may get from GET …/assistant/status on a fresh data directory: the placeholder's 501 not_built, or the status
 * as any credential but the owner's session reads it (ADR-0027, note of 2026-11-25 "money and provider"; core
 * AssistantPublicStatus): exactly `connected`, `setup` and `detail`, not connected (nothing is configured), and so no setup
 * code of the owner's, no amount, no host or model, no key field nor the key's text.
 */
const KEY_FIELDS = ['key', 'apikey', 'api_key', 'secret', 'token', 'authorization']; // compared lowercased
function freshStatusVerdict(r: { status: number; code?: string; body: unknown }, keyText: string): string {
  if (r.status === 501) return r.code === 'not_built' ? 'ok' : `501 with code ${r.code}`;
  if (r.status !== 200) return `status ${r.status} (${r.code})`;
  const b = r.body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'body is not an object';
  const keyed = Object.keys(b).filter((k) => KEY_FIELDS.includes(k.toLowerCase()));
  if (keyed.length > 0) return `key field ${keyed.join(',')}`;
  if (JSON.stringify(b).includes(keyText)) return 'holds the key text';
  const extra = Object.keys(b).filter((k) => !(ASSISTANT_PUBLIC_STATUS_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) return `more than connected or not: ${extra.sort().join(',')}`;
  if (typeof b.setup !== 'string' || !(ASSISTANT_PUBLIC_SETUP as readonly string[]).includes(b.setup)) return `setup ${String(b.setup)} is not ready or not_connected`;
  if (b.setup === 'ready' || b.connected !== false) return 'ready on a fresh data directory';
  if (typeof b.detail !== 'string' || !b.detail) return 'no sentence';
  return 'ok';
}

describe('the status verdict accepts the placeholder and the connected-or-not status alike', () => {
  const K = 'TEST-DOUBLE-NOT-A-KEY';
  it('accepts 501 not_built and a not-connected status of three fields; refuses ready, the owner\'s fields, a key field, the key text and other answers', () => {
    const notConnected = { connected: false, setup: 'not_connected', detail: 'the language assistant is not connected' };
    expect(freshStatusVerdict({ status: 501, code: 'not_built', body: {} }, K)).toBe('ok');
    expect(freshStatusVerdict({ status: 200, body: notConnected }, K)).toBe('ok');
    expect(freshStatusVerdict({ status: 200, body: { connected: true, setup: 'ready', detail: 'x' } }, K)).toBe('ready on a fresh data directory');
    // what an agent read before the rule: the owner's setup code, the key state, the amounts
    expect(freshStatusVerdict({ status: 200, body: { setup: 'provider_not_configured', detail: '', keySet: false, keyAddedAt: null } }, K)).toBe('more than connected or not: keyAddedAt,keySet');
    expect(freshStatusVerdict({ status: 200, body: { ...notConnected, spentCents: 0 } }, K)).toBe('more than connected or not: spentCents');
    expect(freshStatusVerdict({ status: 200, body: { ...notConnected, setup: 'limit_missing' } }, K)).toMatch(/not ready or not_connected/);
    expect(freshStatusVerdict({ status: 200, body: { ...notConnected, apiKey: 'x' } }, K)).toBe('key field apiKey');
    expect(freshStatusVerdict({ status: 200, body: { ...notConnected, detail: K } }, K)).toBe('holds the key text');
    expect(freshStatusVerdict({ status: 501, code: 'other', body: {} }, K)).toBe('501 with code other');
    expect(freshStatusVerdict({ status: 403, code: 'owner_required', body: {} }, K)).toMatch(/^status 403/);
  });
});

describe('the assistant routes are registered and refuse honestly', () => {
  let s: Awaited<ReturnType<typeof startServer>> | undefined;
  afterAll(async () => { await s?.close(); });
  it('owner-only routes refuse an agent with 403 owner_required; status answers 501 not_built or connected-or-not (not connected, three fields); no job', async () => {
    s = await startServer({ port: 8987, dataDir: tmp('pf-cb-routes-') });
    const pid = s.store.createProject({ name: 'p' }).doc.id;
    const call = async (method: string, p: string, token: string | null, body?: unknown) => {
      const r = await fetch(`${s!.url}${p}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', connection: 'close' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      const json = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
      return { status: r.status, code: json.error?.code, body: json as unknown };
    };
    const reqBody = { text: 'חתוך כאן', selection: [], playheadFrame: 0 };
    const config = { adapter: null, host: null, model: null, pricesCentsPerMTok: null, monthlyLimitCents: 0, perRequestCapCents: 0, toggles: { titlesAndMarkers: false, peopleNames: false } };
    expect(ASSISTANT_ROUTES).toHaveLength(6);
    for (const r of ASSISTANT_ROUTES) {
      const p = r.path.replace(':id', pid);
      const b = r.method === 'POST' ? reqBody : r.path.endsWith('/config') ? config : r.path.endsWith('/key') && r.method === 'PUT' ? { key: 'TEST-DOUBLE-NOT-A-KEY' } : undefined;
      const agent = await call(r.method, p, s.auth.tokens.agent, b);
      if (r.access === 'owner') expect({ status: agent.status, code: agent.code }, `${r.method} ${r.path}`).toEqual({ status: 403, code: 'owner_required' });
      else { expect(`${r.method} ${r.path}`).toBe('GET /api/v1/assistant/status'); expect(freshStatusVerdict(agent, 'TEST-DOUBLE-NOT-A-KEY'), `${r.method} ${r.path}`).toBe('ok'); }
    }
    expect(s.store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE type = 'assistant.propose'").get()).toEqual({ n: 0 });
  });
});
