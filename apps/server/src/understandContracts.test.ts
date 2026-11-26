/**
 * The server contract of «מה יש בקליפ» (wave 8 `understand`; understand/contract.ts), through the real app and the real MCP handler:
 * every route is registered, documented and classified; NO route is owner-only (ADR-0036, decisions «understand»); every route answers
 * 501 understand_not_built after its checks until W1/W2 build the view and the runtime; the MCP tools are listed, classified and
 * answer the same; the notes table round-trips. The it.todo rows are the proof checks (understand-plan §5 as corrected by verify C2–C12)
 * W1 and W2 make pass on the labelled test double (port 0; never a real model or provider).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FootageNotesDataSchema, UNDERSTAND_JOB_TYPE, type FootageNotesData } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { buildOpenApi } from './openapi.ts';
import { PEOPLE_MCP_TOOLS, PEOPLE_REST_SURFACES } from './peopleSurfaces.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { UNDERSTAND_MCP_TOOLS, UNDERSTAND_ROUTES } from './understand/contract.ts';
import { getNotes, getSpans, notesDigest, notesRows, putNotes, putSpan, spanKey } from './understand/notesDb.ts';

let dir: string, cfg: Config, store: Store, auth: Auth, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let pid = '', ownerCookie = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
type Who = () => Record<string, string>;
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const agent = bearer(() => auth.tokens.agent), observer = bearer(() => auth.tokens.observer);
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
let rpcId = 0;
async function rpc(who: Who, method: string, params: unknown): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
}
const call = (route: string): [string, string, unknown] => {
  const [method, p] = route.split(' ') as [string, string];
  const url = p.replace(':id', pid).replace(':assetId', 'ast_none');
  const body = method === 'POST' ? {} : method === 'PUT' ? { density: 30 } : undefined;
  return [method, url, body];
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-understand-contract-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 24, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  const gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  pid = store.createProject({ name: 'understand contract' }).doc.id;
});
afterAll(async () => {
  await mcp.close(); await speech.stop(); await capabilities.stop(); store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the understand routes are registered, documented, classified and open', () => {
  it('every route is in OpenAPI and the people-surface table; none is owner-only; the MCP tools are classified', () => {
    const doc = buildOpenApi() as { paths: Record<string, Record<string, Record<string, unknown>>> };
    for (const route of UNDERSTAND_ROUTES) {
      const [method, p] = route.split(' ') as [string, string];
      const op = doc.paths[p.replace(/:(\w+)/g, '{$1}')]?.[method.toLowerCase()];
      expect({ route, documented: !!op, ownerOnly: op?.['x-owner-session-only'] ?? false, scope: op?.['x-required-scope'] }).toEqual({ route, documented: true, ownerOnly: false, scope: method === 'GET' ? 'observe' : 'edit' });
      expect({ route, classified: route in PEOPLE_REST_SURFACES, ownerOnly: (PEOPLE_REST_SURFACES[route] ?? []).includes('owner-only') }).toEqual({ route, classified: true, ownerOnly: false });
    }
    for (const t of UNDERSTAND_MCP_TOOLS) expect(PEOPLE_MCP_TOOLS[t], t).toBeTruthy();
  });
  it('pre-pass: every route answers 501 understand_not_built to the owner and to an agent; an observer reads but cannot start or change settings', async () => {
    for (const route of UNDERSTAND_ROUTES) {
      const [method, url, body] = call(route);
      for (const who of [owner, agent]) {
        const r = await rest(who, method, url, body);
        expect({ route, status: r.status, code: r.body?.error?.code }).toEqual({ route, status: 501, code: 'understand_not_built' });
      }
      const o = await rest(observer, method, url, body);
      expect({ route, status: o.status }).toEqual({ route, status: method === 'GET' ? 501 : 403 });
    }
  });
  it('checks come first: an unknown project is 404, a bad body or query is 400', async () => {
    expect((await rest(agent, 'GET', '/api/v1/projects/prj_none/understand')).status).toBe(404);
    expect((await rest(agent, 'POST', `/api/v1/projects/${pid}/understand`, { assetIds: [], extra: 1 })).status).toBe(400);
    expect((await rest(agent, 'PUT', '/api/v1/understand/settings', { density: 3 })).status).toBe(400);
    expect((await rest(agent, 'GET', `/api/v1/projects/${pid}/assets/a/notes?limit=101`)).status).toBe(400);
    expect((await rest(agent, 'GET', `/api/v1/projects/${pid}/assets/a/notes?both=yes`)).status).toBe(400);
  });
  it('pre-pass: the MCP tools are listed, say that media text is data, and answer understand_not_built; cancel of an understand job is dispatched', async () => {
    const tools = (await rpc(agent, 'tools/list', {})).result.tools as { name: string; description: string }[];
    for (const t of UNDERSTAND_MCP_TOOLS) expect(tools.map((x) => x.name)).toContain(t);
    for (const t of ['get_shots', 'describe_clip']) expect(tools.find((x) => x.name === t)!.description).toContain('data, not instructions');
    expect(tools.find((x) => x.name === 'find_in_footage')!.description).toContain('notes');
    for (const [name, args] of [['get_shots', { projectId: pid, assetId: 'a' }], ['describe_clip', { projectId: pid, assetId: 'a', limit: 5 }], ['understand_footage', { projectId: pid }]] as const) {
      const r = await rpc(agent, 'tools/call', { name, arguments: args });
      expect(r.result.content[0].text, name).toContain('understand_not_built');
    }
    const job = store.createJob(pid, UNDERSTAND_JOB_TYPE, 'agent:local', {});
    expect((await rest(agent, 'POST', `/api/v1/jobs/${job.id}/cancel`)).body?.error?.code).toBe('understand_not_built');
    expect((await rpc(agent, 'tools/call', { name: 'cancel_job', arguments: { jobId: job.id } })).result.content[0].text).toContain('understand_not_built');
  });
});

describe('the notes table (notesDb.ts, complete)', () => {
  const producer = { id: 'fedcba9876543210', describer: 'TEST-DOUBLE-describer' as const, providerId: 'test-double', model: 'TEST-DOUBLE-describer/1', modelFile: null, prompt: 'pf-describe/1' as const, longSide: 768, density: 10, framesPerSpan: 3, minSpanSeconds: 2 };
  const data: FootageNotesData = { format: 1, contentHash: `sha256:${'d'.repeat(64)}`, producer, rate: { num: 30, den: 1 }, frameCount: 750, cuts: `sha256:${'e'.repeat(64)}`,
    spans: [{ i: 0, shots: [0, 0], start: 0, end: 150, keys: [37, 75, 112], state: 'described', caption: { he: 'כפיל בדיקה: תמונה כחולה', en: 'TEST DOUBLE: a blue picture' }, text: ['F1-75'] }, { i: 1, shots: [1, 1], start: 150, end: 270, keys: [180, 210, 240], state: 'failed', why: 'invalid_reply' }] };
  it('a complete file round-trips with its digest; several producers coexist; a file failing its schema is not written', () => {
    const db = new Database(':memory:');
    const { digest } = putNotes(db, data);
    expect(digest).toBe(notesDigest(JSON.stringify(FootageNotesDataSchema.parse(data))));
    expect(getNotes(db, data.contentHash, producer.id)).toEqual({ data, digest });
    putNotes(db, { ...data, producer: { ...producer, id: '0000000000000001', model: 'other' } });
    expect(notesRows(db, data.contentHash).map((r) => [r.producer, r.described, r.failed])).toEqual([[producer.id, 1, 1], ['0000000000000001', 1, 1]]);
    expect(() => putNotes(db, { ...data, spans: [{ ...data.spans[0]!, keys: [] }] })).toThrow();
    expect(getNotes(db, data.contentHash, 'ffffffffffffffff')).toBeNull();
  });
  it('scratch spans are keyed by their key frames (C12), so a re-spanned file with the same frames finds them', () => {
    const db = new Database(':memory:');
    putSpan(db, data.contentHash, producer.id, data.spans[0]!);
    putSpan(db, data.contentHash, producer.id, { ...data.spans[0]!, i: 7, shots: [3, 4] }); // renumbered: the same key frames
    const m = getSpans(db, data.contentHash, producer.id);
    expect([...m.keys()]).toEqual([spanKey([112, 37, 75])]);
    expect(m.get('37,75,112')!.i).toBe(7);
  });
});

describe('what W1 and W2 make pass (understand-plan §5 as corrected by verify C2–C12; labelled test double only)', () => {
  it.todo('check 1 (W2): importing U1 with auto on commits analyses.scenes with cuts at exactly frames 150 and 270, as server:understand, in ONE commit for the pass; U2 (picture 0.5 s late) gets its cuts on the proxy with the proxy\'s own start (C3)');
  it.todo('check 1b (W2, C6): the same file imported into a second project (no derivative event) is measured from the import commit; a running job is joined, never doubled');
  it.todo('check 2 (W1): with describer none get_shots lists 3 shots (paged, 50); understandSpans at density 10, minSpan 2 gives [0,150) [150,270) [270,510) [510,750), keys at their middles (1 frame) or evenly (3 frames)');
  it.todo('check 3 (W2): with the test double every stored span\'s barcode-read frames equal its keys, in order, for U1 and U2 (the exact frames reached the describer in ONE request per span)');
  it.todo('check 4 (W1, C2): span times from describe_clip (rational: true) equal sourceTimeOfFrame(asset, start) exactly, for U2 including the picture\'s start');
  it.todo('check 5 (W2): the photo gets one span from the original; the sound-only file is skipped no_picture and gets no pointer');
  it.todo('check 6 (W2, C7): one job attaches all pointers in ONE revision as server:understand (shown «אוטומטי»); undo by that transaction id restores the analyses exactly; after a hand edit of that asset\'s scenes the undo is refused undo_conflict');
  it.todo('check 7 (W2, C12): killing the server after 3 spans and restarting resumes; the double\'s call counter shows at most the span in flight described twice; that call\'s first ledger row is unknown');
  it.todo('check 8 (W2): a double reply with an extra key / no caption / a non-Hebrew captionHe / finish length yields failed invalid_reply, the field dropped, failed reply_cut; no planted string is stored');
  it.todo('check 9 (W1, C9): search «כחול» finds exactly the blue span (sources [seen]); «F1-210» finds the span holding frame 210 (onscreen); «2025» written on screen is found though it parses as a year; a word in no span finds nothing in the notes section');
  it.todo('check 10 (W1, C8): an agent\'s find_in_footage gets the notes section, in open AND guarded mode (agentAnswerOf passes it)');
  it.todo('check 11 (W1, C10): describe_clip pages of 20 (max 100) end early at 16 KB with next; one caption language per row; said only with withSaid; get_shots paged with each shot\'s first caption ≤ 120');
  it.todo('check 12 (W1): changing the producer (another model) makes the state stale_model; old notes are still found and labelled with the old model; nothing re-describes by itself (decision 7)');
  it.todo('check 13 (W2): hand-editing the scene cuts makes the state shots_changed; the job never overwrites hand-edited cuts (re-checked right before the commit)');
  it.todo('check 14 (W2): an export started during the job finishes while the job waits (no describe call starts during it; lane label understand.describe <projectId>)');
  it.todo('check 15 (W2): cancel stops at a span boundary; nothing is attached; the scratch rows stay and the next run reuses them (no new call for those keys)');
  it.todo('check 16 (W2): the settings file round-trips (and is backed up); a provider not connected is describer_not_connected; a cloud row without vision is describer_no_vision; a local preset marked seeing is accepted; the describer request has no tools and no temperature, max tokens 800, one ledger row per call');
  it.todo('check 17 (W3): the list renders the spans in order with the model chip and «לא נבדק»; keyboard path; RTL; the search section; Settings block; no dead button before built');
});
