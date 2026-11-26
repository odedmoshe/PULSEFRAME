/**
 * Server contracts of «גרסה לכל קהל» (wave 8 audiences): the change-list route answers 404 for an unknown format, 409
 * not_audience_version for a plain format and an honest 501 audience_not_built while not built (lead pre-pass); once built, REST
 * GET …/variants/:variantId/audience and MCP get_audience_changes give the same answer to the owner and to every reader with observe
 * (ids, frames, registry ids, sizes and dB: no words), and the get_summary variants row carries `audience` and counts only real format
 * overrides (verifier C14). W2.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as T from '@pulseframe/time';
import { AUDIENCE_API_REFUSALS, AUDIENCE_NOT_HANDLED, type AudienceChanges, type ProjectDocument } from '@pulseframe/core';
import { audienceChangesFor, audienceView } from './audiences/routes.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { ApiError, Store } from './store.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const OWNER = 'user:owner';
const TITLE = 'נועה בת 5 Zorglewump';
const caught = (fn: () => unknown): ApiError => { try { fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('answered'); };

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>;
let ownerCookie = '', namesGrant = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = { name: string; headers: () => Record<string, string> };
const bearer = (name: string, token: () => string): Who => ({ name, headers: () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' }) });
const AGENT = bearer('agent token', () => auth.tokens.agent), OBSERVER = bearer('observer token', () => auth.tokens.observer), NAMES = bearer('grant with people at its default', () => namesGrant);
const OWNER_WHO: Who = { name: 'owner session', headers: () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' }) };
const READERS = [OWNER_WHO, AGENT, OBSERVER, NAMES];
async function rest(who: Who, method: string, url: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
  const r = await app.fetch(new Request(`${base()}/api/v1${url}`, { method, headers: who.headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8');
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, json, text };
}
let rpcId = 0;
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: any; text: string }> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who.headers(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const raw = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : raw);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  const text = msg.result.content[0].text as string;
  return { isError: msg.result.isError === true, body: JSON.parse(text), text };
}
const commit = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: OWNER, ops });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-audiences-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 8, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  const capabilities = new Capabilities(store, cfg), derivatives = new Derivatives(store), presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  namesGrant = gov.createGrant({ name: 'names', mode: 'edit' }, { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] }).token;
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the change-list route: refusals in order', () => {
  it('404 for an unknown or inherited format id, 409 for a plain format', () => {
    const pid = store.createProject({ name: 'aud' }).doc.id;
    expect(caught(() => audienceChangesFor(store, pid, 'var_none')).status).toBe(404);
    expect(caught(() => audienceChangesFor(store, pid, 'constructor')).status).toBe(404);
    const vid = commit(pid, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]).results[0]!.output!.variantId as string;
    const e = caught(() => audienceChangesFor(store, pid, vid));
    expect([e.status, e.code, e.message]).toEqual([409, AUDIENCE_API_REFUSALS.notAudience.code, AUDIENCE_API_REFUSALS.notAudience.message(vid)]);
    // the 501 (not built) is tested in audiences/routes.test.ts
  });
});

describe('the built view', () => {
  let pid = '', title = '', other = '', vid = '', fmt = '';
  beforeAll(() => {
    pid = store.createProject({ name: 'aud-view', width: 640, height: 360, frameRate: R }).doc.id;
    const t = commit(pid, [{ op: 'add_text', args: { text: TITLE, start: f(0), duration: f(30) } }, { op: 'add_text', args: { text: 'שנייה', start: f(30), duration: f(30) } }]);
    title = t.results[0]!.output!.clipId as string; other = t.results[1]!.output!.clipId as string;
    vid = commit(pid, [{ op: 'add_audience_version', args: { profile: 'grandparents' } }]).results[0]!.output!.variantId as string;
    fmt = commit(pid, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]).results[0]!.output!.variantId as string;
    commit(pid, [{ op: 'set_audience_keep', args: { variantId: vid, clipId: title, rule: 'title_size', keep: true } }]);
  });

  it('GET …/variants/:variantId/audience and MCP get_audience_changes answer the same AudienceChanges for the owner and for every reader with observe', async () => {
    const direct = audienceChangesFor(store, pid, vid);
    const answers: { who: string; via: string; body: AudienceChanges; text: string }[] = [];
    for (const who of READERS) {
      const r = await rest(who, 'GET', `/projects/${pid}/variants/${vid}/audience`);
      expect(r.status, who.name).toBe(200);
      answers.push({ who: who.name, via: 'rest', body: r.json, text: r.text });
      const m = await tool(who, 'get_audience_changes', { projectId: pid, variantId: vid });
      expect(m.isError, `${who.name}: ${m.text.slice(0, 200)}`).toBe(false);
      answers.push({ who: who.name, via: 'mcp', body: m.body, text: m.text });
    }
    for (const a of answers) expect(a.body, `${a.who} ${a.via}`).toEqual(direct);
    expect(direct).toMatchObject({ projectId: pid, variantId: vid, revision: store.getProject(pid).revision, profile: 'grandparents', rules: 1, musicDb: -8, notHandled: [...AUDIENCE_NOT_HANDLED] });
    // ids, frames, registry ids and dB only: the title's words reach no reader by either path
    for (const a of answers) expect(a.text, `${a.who} ${a.via}`).not.toMatch(/נועה|Zorglewump/);
    // the owner's keep is in the answer, for every reader
    expect(direct.changes.find((c) => c.clipId === title)?.kept).toBe(true);
    // the refusals reach both paths with the same code
    expect((await rest(AGENT, 'GET', `/projects/${pid}/variants/${fmt}/audience`)).json.error.code).toBe(AUDIENCE_API_REFUSALS.notAudience.code);
    const mt = await tool(AGENT, 'get_audience_changes', { projectId: pid, variantId: fmt });
    expect(mt.isError).toBe(true);
    expect(mt.text).toContain(AUDIENCE_API_REFUSALS.notAudience.code);
    expect((await rest(AGENT, 'GET', `/projects/${pid}/variants/var_nope/audience`)).status).toBe(404);
    // no credential, no answer (ADR-0002)
    expect((await app.fetch(new Request(`${base()}/api/v1/projects/${pid}/variants/${vid}/audience`, { headers: { host: `127.0.0.1:${cfg.port}` } }))).status).toBe(401);
  });

  it('the wire view copies the contract fields by name: words in a before/after or an extra field never leave', () => {
    const real = audienceChangesFor(store, pid, vid);
    const planted = {
      ...real, title: TITLE, people: ['נועה'],
      changes: [{ ...real.changes[0]!, before: TITLE, after: 'classic', text: TITLE }, { ...real.changes[0]!, before: '#000000B3', after: 'light.strobe' }, { ...real.changes[0]!, before: Number.NaN, after: 'dip-white' }],
      soundRoles: [{ trackId: 'trk_a', role: 'music', why: 'music_files', name: TITLE }],
    } as unknown as AudienceChanges;
    const out = audienceView(planted);
    expect(JSON.stringify(out)).not.toMatch(/נועה|Zorglewump/);
    expect(out.changes.map((c) => [c.before, c.after])).toEqual([[null, 'classic'], ['#000000B3', 'light.strobe'], [null, 'dip-white']]);
    expect(Object.keys(out).sort()).toEqual(['changes', 'fastCuts', 'method', 'musicDb', 'notHandled', 'profile', 'projectId', 'revision', 'rules', 'soundRoles', 'variantId']);
    expect(out.soundRoles).toEqual([{ trackId: 'trk_a', role: 'music', why: 'music_files' }]);
    // the real answer passes through unchanged
    expect(audienceView(real)).toEqual(real);
  });

  it('the get_summary variants row carries audience { profile, musicDb } and the override count leaves out keep-only overrides (C14)', async () => {
    const row = (s: { variants: { id: string; overrides: number; audience: unknown }[] }, id: string) => s.variants.find((v) => v.id === id)!;
    const read = async () => {
      const r = await rest(AGENT, 'GET', `/projects/${pid}/summary`);
      const m = await tool(AGENT, 'get_summary', { projectId: pid });
      expect(m.isError).toBe(false);
      expect(row(m.body, vid)).toEqual(row(r.json, vid));
      return r.json;
    };
    let s = await read();
    // only a kept rule on the title: no format override
    expect(row(s, vid)).toMatchObject({ overrides: 0, audience: { profile: 'grandparents', musicDb: -8 } });
    expect(row(s, fmt)).toMatchObject({ overrides: 0, audience: null });
    commit(pid, [{ op: 'update_audience_version', args: { variantId: vid, musicDb: -12 } }, { op: 'set_variant_override', args: { variantId: vid, clipId: other, textStyle: { sizeFrac: 0.1 } } }]);
    s = await read();
    expect(row(s, vid)).toMatchObject({ overrides: 1, audience: { profile: 'grandparents', musicDb: -12 } });
    // the kept title gains a real override too: it now counts
    commit(pid, [{ op: 'set_variant_override', args: { variantId: vid, clipId: title, transform: { x: 0.1 } } }]);
    expect(row(await read(), vid).overrides).toBe(2);
    commit(pid, [{ op: 'update_audience_version', args: { variantId: vid, musicDb: null } }]);
    expect(row(await read(), vid).audience).toEqual({ profile: 'grandparents', musicDb: -8 });
    const calm = commit(pid, [{ op: 'add_audience_version', args: { profile: 'calm' } }]).results[0]!.output!.variantId as string;
    expect(row(await read(), calm)).toMatchObject({ overrides: 0, audience: { profile: 'calm', musicDb: -6 } });
    // a plain document's summary has the field as null on every format, and nothing else in the row changed shape
    const doc = store.getProject(pid).doc as ProjectDocument;
    expect(Object.keys(row(s, fmt)).sort()).toEqual(['audience', 'captionStyle', 'fit', 'height', 'id', 'name', 'overrides', 'safeArea', 'width']);
    expect(Object.keys(doc.variants)).toContain(fmt);
  });
});
