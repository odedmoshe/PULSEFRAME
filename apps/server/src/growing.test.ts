/**
 * «גדלים מול העיניים» on the server (wave 8 growing), through the real app and the real MCP handler:
 * - every growing call (plan, apply, rebuild through both regenerate routes, the three MCP recipe tools and MCP regenerate_template)
 *   answers 403 owner_required to every credential that is not the owner's own session (the bootstrap agent token, the observer
 *   token, an edit grant with people 'full', a propose grant, and a user-kind principal that is not 'user:local' — auth.ts issues
 *   none today; it is built by hand here so the strict check is pinned), and nothing is committed;
 * - the owner's own session: plan (no ops, no eyes; params are the run record), apply (ONE apply_template; one undo restores the
 *   document hash, redo restores it: G12), a stale revision is 409, rebuild (G13: a hand-rotated pick kept exactly, a moved pick
 *   back in place, a deleted pick out and named, restoreRemoved only with eyes in the request, else needs_marks; an untouched pick
 *   keeps its transform through eyesFromTransform);
 * - THE EYES ARE REQUEST DATA ONLY (verifier C8): a planted coordinate sent in every request, after successful applies and rebuilds,
 *   appears in no table of the database (projects, transactions, outbox, entity versions, jobs, named versions…), no event, no
 *   summary, no archive (the owner's own, «בלי פרטי משפחה», «ארכיון לשיתוף»), no MCP resource, no answer and no console output.
 * PLANNER: the real core planner (W1); the test double of the build round was removed at integration.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { findClip, GROWING, GROWING_RECORD_KEYS, GROWING_TEMPLATE_ID, GROWING_VERSION, growingPickKey, growingRunRecordParams, type ProjectDocument } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { applyGrowingFor, eyesOfClip, GROWING_SERVER_BUILT, growingRegeneration, planGrowingFor, regenerateGrowingFor } from './growing.ts';
import { createApp } from './http.ts';
import { regenerateRecipe } from './recipes.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { ApiError, Store } from './store.ts';

const PLANTED = 0.123457;
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, speech: Speech, capabilities: Capabilities;
let ownerCookie = '', fullGrant = '', proposeGrant = '', pid = '', runId = '', stillIds: string[] = [], videoId = '';
const base = () => `http://127.0.0.1:${cfg.port}`;
const OWNER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
type Who = () => Record<string, string>;
const owner: Who = () => ({ host: `127.0.0.1:${cfg.port}`, origin: base(), cookie: ownerCookie, 'content-type': 'application/json' });
const bearer = (token: () => string): Who => () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${token()}`, 'content-type': 'application/json' });
const AGENTS: [string, Who][] = [['the agent token', bearer(() => auth.tokens.agent)], ['the observer token', bearer(() => auth.tokens.observer)], ['an edit grant with people full', bearer(() => fullGrant)], ['a propose grant', bearer(() => proposeGrant)]];
const rest = async (who: Who, method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`${base()}${p}`, { method, headers: who(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, body: type.includes('json') ? ((await r.json()) as any) : Buffer.from(await r.arrayBuffer()) as any };
};
let rpcId = 0;
async function rpc(who: Who, method: string, params: Record<string, unknown>): Promise<any> {
  const r = await mcp(new Request(`${base()}/mcp`, { method: 'POST', headers: { ...who(), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) }));
  const text = await r.text();
  return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
}
async function tool(who: Who, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const msg = await rpc(who, 'tools/call', { name, arguments: args });
  return { isError: !!msg.result?.isError, text: String(msg.result?.content?.[0]?.text ?? JSON.stringify(msg.error ?? msg)) };
}
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const hashOf = (k: number) => `sha256:${String(k % 10).repeat(64)}`;
/** A project of `n` stills (480×640) and one 2 s 30 fps video, with one byte in the store for each file (archives read them). */
function makeProject(name: string, n: number): { pid: string; stills: string[]; video: string } {
  const id = store.createProject({ name, width: 640, height: 360, frameRate: { num: 30, den: 1 } }).doc.id;
  const still = (k: number) => ({ kind: 'image', name: `p${k}.jpg`, contentHash: hashOf(k), byteSize: 1, container: 'jpeg', mimeType: 'image/jpeg', duration: T.ZERO, image: { width: 480, height: 640, codec: 'mjpeg', hasAlpha: false }, provenance: prov });
  const video = { kind: 'video', name: 'v.mp4', contentHash: hashOf(9), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(2, 1), video: { width: 640, height: 360, frameRate: { num: 30, den: 1 }, codec: 'h264', rotation: 0, frameCount: 60 }, provenance: prov };
  const assets = [...Array.from({ length: n }, (_, k) => still(k + 1)), video];
  for (const a of assets) { const f = store.blobPath(a.contentHash); if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); } }
  const r = store.commit({ projectId: id, actor: 'user:local', allowInternal: true, ops: assets.map((asset) => ({ op: 'import_asset', args: { asset } })) });
  const ids = r.results.map((x) => x.output!.assetId as string);
  return { pid: id, stills: ids.slice(0, n), video: ids[n]! };
}
const params = () => ({
  picks: [
    { assetId: stillIds[0], frame: null, eyes: [{ u: PLANTED, v: 0.41 }, { u: 0.62, v: PLANTED }] },
    { assetId: stillIds[1], frame: null, eyes: [{ u: 0.3, v: PLANTED }, { u: PLANTED + 0.5, v: 0.4 }] },
    { assetId: videoId, frame: 12, eyes: [{ u: PLANTED, v: PLANTED }, { u: 0.7, v: 0.5 }] },
  ],
  holdFrames: 30, dissolve: 'short', caption: { date: true, age: false },
});
const calls = () => [
  ['POST', `/api/v1/projects/${pid}/recipes/growing/plan`, { params: params() }],
  ['POST', `/api/v1/projects/${pid}/recipes/growing/apply`, { params: params() }],
  ['POST', `/api/v1/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: params(), restoreRemoved: true }],
  ['POST', `/api/v1/projects/${pid}/template-runs/${runId}/regenerate`, { params: params(), restoreRemoved: true }],
] as const;
const revision = (id = pid) => store.getProject(id).revision;
const docJson = (id: string) => JSON.stringify(store.getProject(id).doc);
const code = (r: { body: any }) => r.body?.error?.code ?? r.body?.code;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-growing-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 29, speechPython: null, voicePython: null, backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, new Derivatives(store), presence, mcp, gov, undefined, speech);
  ownerCookie = auth.issueSession(new Request(`${base()}/api/v1/session`, { headers: { origin: base(), 'x-pf-owner-key': auth.tokens.owner } })).split(';')[0]!;
  fullGrant = gov.createGrant({ name: 'full', mode: 'edit', people: 'full' }, OWNER).token;
  proposeGrant = gov.createGrant({ name: 'proposer', mode: 'propose' }, OWNER).token;
  const made = makeProject('growing', 2);
  pid = made.pid; stillIds = made.stills; videoId = made.video;
  // a growing run as apply would record it (its params are growingRunRecordParams: no coordinate), so the rebuild routes have a run
  const record = growingRunRecordParams({ sort: 'capture', holdFrames: 30, dissolve: 'short', faceSize: GROWING.faceSize.default, eyeLine: GROWING.eyeLine.default, fill: 'colour', caption: null, personId: null, at: T.ZERO }, stillIds.map((assetId) => ({ key: growingPickKey(assetId, null), assetId, frame: null })));
  const run = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: record, steps: ['Place the pictures'], ops: [{ op: 'add_clip', args: { assetId: stillIds[0], start: T.ZERO, duration: T.rt(1, 1) }, bind: 'p0' }], slots: [{ key: growingPickKey(stillIds[0]!, null), kind: 'picture', clipId: { $ref: 'p0' } }], recordRanges: true } }] });
  runId = run.results[0]!.output!.runId as string;
});
afterAll(async () => {
  await mcp.close();
  await speech.stop();
  await capabilities.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('growing: owner\'s own session only', () => {
  it('a grant for another project gets the same refusal for this project\'s growing run and for an unknown run (both regenerate routes, MCP regenerate_recipe); an observing agent is refused owner_required before its body is read', async () => {
    const other = gov.createGrant({ name: 'elsewhere', mode: 'edit', projectIds: ['prj_elsewhere'] }, OWNER).token;
    const who = bearer(() => other);
    for (const route of ['recipe-runs', 'template-runs']) {
      const known = await rest(who, 'POST', `/api/v1/projects/${pid}/${route}/${runId}/regenerate`, {});
      const unknown = await rest(who, 'POST', `/api/v1/projects/${pid}/${route}/run_nope/regenerate`, {});
      expect([route, known.status, code(known)]).toEqual([route, 403, 'out_of_scope']);
      expect([unknown.status, code(unknown), unknown.body.error?.message]).toEqual([known.status, code(known), known.body.error?.message]);
    }
    const t1 = await tool(who, 'regenerate_recipe', { projectId: pid, runId }), t2 = await tool(who, 'regenerate_recipe', { projectId: pid, runId: 'run_nope' });
    expect(t1.text).toContain('out_of_scope');
    expect(t2.text).toBe(t1.text);
    // in process too (recipes.ts regenerateRecipe checks the rights before it looks the run up)
    const pr = gov.principalForToken(other)!;
    for (const id of [runId, 'run_nope']) await expect(regenerateRecipe(store, gov, pr, pid, id, {})).rejects.toMatchObject({ status: 403, code: 'out_of_scope' });
    // the observer token may see the project: a growing run answers owner_required even to growing params that do not parse
    const r = await rest(bearer(() => auth.tokens.observer), 'POST', `/api/v1/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: { picks: 'x' } });
    expect([r.status, code(r)]).toEqual([403, 'owner_required']);
  });
  for (const [name, who] of AGENTS) {
    it(`${name}: plan, apply and both rebuild routes answer 403 owner_required; nothing is committed`, async () => {
      const before = revision();
      for (const [method, url, body] of calls()) {
        const r = await rest(who, method, url, body);
        expect([url, r.status, code(r)]).toEqual([url, 403, 'owner_required']);
      }
      expect(revision()).toBe(before);
    });
    it(`${name}: the MCP recipe tools and regenerate_template are refused owner_required`, async () => {
      const before = revision();
      for (const [toolName, args] of [['plan_recipe', { projectId: pid, recipeId: 'growing', params: params() }], ['apply_recipe', { projectId: pid, recipeId: 'growing', params: params() }], ['regenerate_recipe', { projectId: pid, runId, params: params() }], ['regenerate_template', { projectId: pid, runId, params: params(), restoreRemoved: true }]] as const) {
        const r = await tool(who, toolName, args as Record<string, unknown>);
        expect([toolName, r.isError]).toEqual([toolName, true]);
        expect(r.text).toContain('owner_required');
      }
      expect(revision()).toBe(before);
    });
  }
  it('an agent cannot reach the growing template by another door: apply_template is internal, plan/apply_template know no tpl.growing', async () => {
    const before = revision();
    const step = { op: 'apply_template', args: { templateId: GROWING_TEMPLATE_ID, templateVersion: GROWING_VERSION, params: {}, steps: ['x'], ops: [], slots: [] } };
    const tx = await rest(AGENTS[0]![1], 'POST', `/api/v1/projects/${pid}/transactions`, { ops: [step] });
    expect(tx.status).toBeGreaterThanOrEqual(400);
    for (const templateId of ['growing', GROWING_TEMPLATE_ID]) {
      for (const t of ['plan_template', 'apply_template'] as const) expect((await tool(AGENTS[0]![1], t, { projectId: pid, templateId, params: params() })).isError).toBe(true);
    }
    expect(revision()).toBe(before);
  });
  it('the check is the STRICT one: a user-kind principal that is not the owner\'s own session (none is issued today) is refused too', async () => {
    const other: Principal = { actor: 'user:someone', kind: 'user', scopes: ['observe', 'edit'] };
    const before = revision();
    for (const run of [() => planGrowingFor(store, gov, other, pid, params()), () => applyGrowingFor(store, gov, other, pid, params()), () => regenerateGrowingFor(store, gov, other, pid, runId, params())]) {
      const e = await run().then(() => null, (x: unknown) => x);
      expect(e instanceof ApiError && [e.status, e.code]).toEqual([403, 'owner_required']);
    }
    expect(revision()).toBe(before);
  });
  it('the server bodies are built: the owner is never answered 501 by the server itself', () => {
    expect(GROWING_SERVER_BUILT).toBe(true);
  });
});

// ---------- the owner's own session ----------
const marks = (k: number): [{ u: number; v: number }, { u: number; v: number }] => [{ u: 0.38 + 0.01 * k, v: 0.4 }, { u: 0.6 + 0.01 * k, v: 0.42 }];
function growingParams(m: { stills: string[]; video: string }) {
  return { picks: [...m.stills.map((assetId, k) => ({ assetId, frame: null, eyes: marks(k) })), { assetId: m.video, frame: 12, eyes: marks(9) }], holdFrames: 30, dissolve: 'short', sort: 'given' };
}
const clipOfKey = (doc: ProjectDocument, rid: string, key: string) => { const s = doc.recipeRuns[rid]!.slots!.find((x) => x.key === key && x.kind === 'picture'); return s ? findClip(doc, s.clipId)?.clip : undefined; };
const frameOf = (t: T.RationalTime) => T.nearestFrameIndex(t, { num: 30, den: 1 });

describe('growing server (W2): the owner', () => {
  it('plan: the view has no ops or slots, its params are the run record (no eyes, no coordinate), and nothing changes', async () => {
    const m = makeProject('plan', 3);
    const before = revision(m.pid);
    const r = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/plan`, { params: growingParams(m) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.ops).toBeUndefined();
    expect(r.body.slots).toBeUndefined();
    expect(r.body.revision).toBe(before);
    expect(r.body.operations).toBeGreaterThan(0);
    expect(r.body.note).toMatch(/Nothing was changed/);
    expect(r.body.params).toEqual(r.body.record);
    for (const k of Object.keys(r.body.params)) expect(GROWING_RECORD_KEYS as readonly string[]).toContain(k);
    expect(JSON.stringify(r.body)).not.toMatch(/"eyes"|"u":|"v":/);
    expect(r.body.picks.map((p: any) => p.key)).toEqual([...m.stills.map((a) => growingPickKey(a, null)), growingPickKey(m.video, 12)]);
    expect(revision(m.pid)).toBe(before);
  });
  it('a planner refusal keeps its fixed sentence and drops its details (nothing of the request comes back)', async () => {
    const m = makeProject('refuse', 2);
    const p = growingParams(m);
    p.picks[1]!.eyes = [{ u: 2, v: 0.5 }, { u: 0.6, v: 0.5 }] as never;
    const r = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/plan`, { params: p });
    expect([r.status, code(r)]).toEqual([400, 'invalid_request']);
    expect(r.body.error.message).toMatch(/^the growing parameters are not valid: /);
    expect(r.body.error.details).toEqual({});
    const held = growingParams(m); held.holdFrames = 4;
    const h = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: held });
    expect([h.status, code(h), h.body.error.message]).toEqual([422, 'out_of_bounds', 'each picture must stay at least 11 frames, so that the film does not flash']);
  });
  it('apply: ONE apply_template transaction with recordRanges; one undo restores the document hash and redo restores the film (G12)', async () => {
    const m = makeProject('apply', 3);
    const before = docJson(m.pid), rev = revision(m.pid);
    const r = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: growingParams(m) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.revision).toBe(rev + 1);
    const doc = store.getProject(m.pid).doc;
    const run = doc.recipeRuns[r.body.runId]!;
    expect(run.recipeId).toBe(`template:${GROWING_TEMPLATE_ID}`);
    expect(Object.keys(run.ranges ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(run.params).sort()).toEqual(['at', 'caption', 'dissolve', 'eyeLine', 'faceSize', 'fill', 'holdFrames', 'picked', 'sort', 'templateVersion']);
    const held = clipOfKey(doc, r.body.runId, growingPickKey(m.video, 12));
    expect(held && held.type === 'media' && held.freeze).toBe(true);
    const tx = store.db.prepare('SELECT ops FROM transactions WHERE project_id = ? ORDER BY rowid DESC LIMIT 1').get(m.pid) as { ops: string };
    expect((JSON.parse(tx.ops) as { op: string }[]).map((o) => o.op)).toEqual(['apply_template']);
    const after = docJson(m.pid);
    expect((await rest(owner, 'POST', `/api/v1/projects/${m.pid}/undo`, {})).status).toBe(200);
    expect(docJson(m.pid)).toBe(before);
    expect((await rest(owner, 'POST', `/api/v1/projects/${m.pid}/redo`, {})).status).toBe(200);
    expect(docJson(m.pid)).toBe(after);
  });
  it('a stale expectedRevision is 409 (apply and rebuild) and nothing is committed', async () => {
    const m = makeProject('stale', 2);
    const r0 = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: growingParams(m), expectedRevision: revision(m.pid) - 1 });
    expect([r0.status, code(r0)]).toEqual([409, 'stale_revision']);
    const a = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: growingParams(m) });
    expect(a.status).toBe(200);
    const h = docJson(m.pid);
    for (const url of [`/api/v1/projects/${m.pid}/recipe-runs/${a.body.runId}/regenerate`, `/api/v1/projects/${m.pid}/template-runs/${a.body.runId}/regenerate`]) {
      const r = await rest(owner, 'POST', url, { expectedRevision: a.body.revision - 1 });
      expect([url, r.status, code(r)]).toEqual([url, 409, 'stale_revision']);
    }
    expect(docJson(m.pid)).toBe(h);
  });
  it('rebuild (G13, C8): hand-rotated kept exactly, moved goes back, deleted stays out and is named, untouched keeps its transform; restoreRemoved only with eyes', async () => {
    const m = makeProject('rebuild', 4);
    const a = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: growingParams(m) });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const rid = a.body.runId as string;
    const [kA, kB, kC, kD] = m.stills.map((s) => growingPickKey(s, null)) as [string, string, string, string];
    const kV = growingPickKey(m.video, 12);
    const d0 = store.getProject(m.pid).doc;
    const A = clipOfKey(d0, rid, kA)!, B = clipOfKey(d0, rid, kB)!, C = clipOfKey(d0, rid, kC)!, D = clipOfKey(d0, rid, kD)!, V = clipOfKey(d0, rid, kV)!;
    // the inverse gives the request's marks back (eyes of an untouched clip, the run's face size and eye line)
    const back = eyesOfClip(d0, D.id, d0.recipeRuns[rid]!.params)!;
    expect(back[0].u).toBeCloseTo(marks(3)[0].u, 5);
    expect(back[1].v).toBeCloseTo(marks(3)[1].v, 5);
    const rotated = { ...A.transform, rotation: A.transform.rotation + 5 };
    store.commit({ projectId: m.pid, actor: 'user:local', ops: [
      { op: 'set_clip_transform', args: { clipId: A.id, transform: { rotation: rotated.rotation } } },
      { op: 'delete_clip', args: { clipId: B.id } },
      { op: 'move_clip', args: { clipId: C.id, start: T.frameTime(600, { num: 30, den: 1 }) } },
    ] });
    const r = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipe-runs/${rid}/regenerate`, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.protected).toContain(A.id);
    expect(r.body.removed).toEqual([kB]);
    expect(r.body.movedBack).toEqual([kC]);
    expect(r.body.excluded.map((x: any) => [x.key, x.code])).toEqual(expect.arrayContaining([[kA, 'kept_by_hand'], [kB, 'removed_by_hand']]));
    const d1 = store.getProject(m.pid).doc;
    expect(findClip(d1, A.id)!.clip).toEqual({ ...A, transform: rotated });
    expect(clipOfKey(d1, rid, kB)).toBeUndefined();
    const C1 = clipOfKey(d1, rid, kC)!, D1 = clipOfKey(d1, rid, kD)!, V1 = clipOfKey(d1, rid, kV)!;
    expect(frameOf(C1.start)).toBe(frameOf(C.start));
    for (const [was, now] of [[C, C1], [D, D1], [V, V1]] as const) for (const k of ['x', 'y', 'scale', 'rotation'] as const) expect(Math.abs(now.transform[k] - was.transform[k])).toBeLessThanOrEqual(GROWING.agreeWithin * 2);
    expect(D1.id).not.toBe(D.id); // made again, not left
    const rec = d1.recipeRuns[rid]!.params;
    expect((rec.removedPicks as { key: string }[]).map((x) => x.key)).toEqual([kB]);
    expect((rec.picked as { key: string }[]).map((x) => x.key)).toContain(kA);
    // restoreRemoved without eyes for the deleted pick: it stays out, named needs_marks
    const r2 = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/template-runs/${rid}/regenerate`, { restoreRemoved: true });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    expect(r2.body.excluded.filter((x: any) => x.key === kB).map((x: any) => x.code)).toEqual(['needs_marks']);
    expect(clipOfKey(store.getProject(m.pid).doc, rid, kB)).toBeUndefined();
    expect(r2.body.removed).toEqual([kB]);
    // restoreRemoved with the deleted pick marked again (the others without eyes): it comes back at its place
    const h2 = docJson(m.pid);
    const picks = growingParams(m).picks.map((p) => (growingPickKey(p.assetId, p.frame) === kB ? { ...p, eyes: marks(1) } : { assetId: p.assetId, frame: p.frame }));
    const r3 = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipe-runs/${rid}/regenerate`, { params: { picks }, restoreRemoved: true });
    expect(r3.status, JSON.stringify(r3.body)).toBe(200);
    expect(r3.body.removed).toEqual([]);
    const B3 = clipOfKey(store.getProject(m.pid).doc, rid, kB)!;
    expect(frameOf(B3.start)).toBe(frameOf(B.start));
    for (const k of ['x', 'y', 'scale', 'rotation'] as const) expect(Math.abs(B3.transform[k] - B.transform[k])).toBeLessThanOrEqual(GROWING.agreeWithin * 2);
    expect(findClip(store.getProject(m.pid).doc, A.id)!.clip.transform).toEqual(rotated);
    // one undo restores the project as it was before that rebuild
    expect((await rest(owner, 'POST', `/api/v1/projects/${m.pid}/undo`, {})).status).toBe(200);
    expect(docJson(m.pid)).toBe(h2);
  });
  it('integration: the interface\'s two rebuild requests (the bar: only expectedRevision; restore: the record list in order, the deleted pick marked again, restoreRemoved) meet the route; `at` and the rebuild fields travel; a kept pick keeps its place in the list', async () => {
    const m = makeProject('contract', 4);
    const at = T.frameTime(60, { num: 30, den: 1 });
    const a = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: { ...growingParams(m), at } });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const rid = a.body.runId as string;
    const keys = [...m.stills.map((s) => growingPickKey(s, null)), growingPickKey(m.video, 12)];
    const d0 = store.getProject(m.pid).doc;
    const starts0 = keys.map((k) => frameOf(clipOfKey(d0, rid, k)!.start));
    expect(starts0).toEqual([60, 90, 120, 150, 180]); // the request's at
    const [kA, kB, kC] = keys as [string, string, string];
    const C = clipOfKey(d0, rid, kC)!, B = clipOfKey(d0, rid, kB)!;
    store.commit({ projectId: m.pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: B.id } }, { op: 'set_clip_transform', args: { clipId: C.id, transform: { rotation: C.transform.rotation + 3 } } }] });
    // the rebuild fields reach the planner even when nothing is kept or removed (W1 note 1), and the run's at (W1 note 4)
    const g = growingRegeneration(store.getProject(m.pid).doc, store.getProject(m.pid).doc.recipeRuns[rid]!, {});
    expect([g.ctx.keptKeys, g.ctx.removedKeys, g.params.at]).toEqual([[kC], [kB], d0.recipeRuns[rid]!.params.at]);
    // the bar's request (GrowingBar.tsx): { expectedRevision } only
    const r1 = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipe-runs/${rid}/regenerate`, { expectedRevision: revision(m.pid) });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const d1 = store.getProject(m.pid).doc;
    expect(keys.map((k) => { const c = clipOfKey(d1, rid, k); return c ? frameOf(c.start) : null; })).toEqual([60, null, 120, 150, 180]); // B's place stays empty, C kept on it
    expect((d1.recipeRuns[rid]!.params.picked as { key: string }[]).map((x) => x.key)).toEqual(keys); // list order, the kept C in the middle
    expect((d1.recipeRuns[rid]!.params.removedPicks as { key: string }[]).map((x) => x.key)).toEqual([kB]);
    // the restore request as growing.logic.ts restoreParams builds it from that record: the list in order, B marked again
    const rec = d1.recipeRuns[rid]!.params.picked as { key: string; assetId: string; frame: number | null }[];
    const picks = rec.map((p) => (p.key === kB ? { assetId: p.assetId, frame: p.frame, eyes: marks(1) } : { assetId: p.assetId, frame: p.frame }));
    const r2 = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipe-runs/${rid}/regenerate`, { params: { picks }, restoreRemoved: true, expectedRevision: revision(m.pid) });
    expect(r2.status, JSON.stringify(r2.body)).toBe(200);
    const d2 = store.getProject(m.pid).doc;
    expect(keys.map((k) => frameOf(clipOfKey(d2, rid, k)!.start))).toEqual(starts0);
    expect(r2.body.removed).toEqual([]);
    expect((d2.recipeRuns[rid]!.params.picked as { key: string }[]).map((x) => x.key)).toEqual(keys);
    expect(d2.recipeRuns[rid]!.params.removedPicks).toBeUndefined();
    expect(kA).toBe(keys[0]);
  });
  it('rebuild: a new pick without eyes is refused needs marks; params that are not an object are refused; an unknown run is 404', async () => {
    const m = makeProject('rebuild-refusals', 3);
    const a = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipes/growing/apply`, { params: { ...growingParams(m), picks: growingParams(m).picks.slice(0, 2) } });
    expect(a.status).toBe(200);
    const h = docJson(m.pid);
    const picks = [...growingParams(m).picks.slice(0, 2).map((p) => ({ assetId: p.assetId, frame: p.frame })), { assetId: m.stills[2]!, frame: null }];
    const r = await rest(owner, 'POST', `/api/v1/projects/${m.pid}/recipe-runs/${a.body.runId}/regenerate`, { params: { picks } });
    expect([r.status, code(r), r.body.error.message]).toEqual([400, 'invalid_request', 'a picture has no eye marks']);
    const bad = await regenerateGrowingFor(store, gov, OWNER, m.pid, a.body.runId, 'x').then(() => null, (e: unknown) => e);
    expect(bad instanceof ApiError && [bad.status, bad.code]).toEqual([400, 'invalid_request']);
    const none = await regenerateGrowingFor(store, gov, OWNER, m.pid, 'run_nope').then(() => null, (e: unknown) => e);
    expect(none instanceof ApiError && [none.status, none.code]).toEqual([404, 'not_found']);
    expect(docJson(m.pid)).toBe(h);
  });
});

describe('growing: the eye marks are request data only (verifier C8)', () => {
  it('after every call by everyone (successful owner applies and rebuilds among them), the planted coordinate is nowhere: tables, events, summary, archives, versions, MCP resources, answers, console', async () => {
    const out: string[] = [];
    const spies = [
      ...(['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { out.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); })),
      vi.spyOn(process.stdout, 'write').mockImplementation(((s: unknown) => { out.push(String(s)); return true; }) as never),
      vi.spyOn(process.stderr, 'write').mockImplementation(((s: unknown) => { out.push(String(s)); return true; }) as never),
    ];
    const answers: unknown[] = [];
    const planted = String(PLANTED);
    let ownerOk = 0;
    try {
      for (const [, who] of [...AGENTS, ['owner', owner] as [string, Who]]) for (const [method, url, body] of calls()) { const r = await rest(who, method, url, body); answers.push(r.body); if (who === owner && r.status === 200) ownerOk++; }
      // the owner's MCP session has no tools path here; the owner's REST calls above did real work
      // the restore: a picture of the run deleted by hand, then made again from the planted marks (restoreRemoved with eyes)
      const doc0 = store.getProject(pid).doc;
      const gone = doc0.recipeRuns[runId]!.slots!.find((x) => x.kind === 'picture' && x.key === growingPickKey(stillIds[1]!, null))!;
      store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: gone.clipId } }] });
      const back = await rest(owner, 'POST', `/api/v1/projects/${pid}/recipe-runs/${runId}/regenerate`, { params: params(), restoreRemoved: true, expectedRevision: revision() });
      expect(back.status, JSON.stringify(back.body)).toBe(200);
      expect(back.body.removed).toEqual([]);
      expect(clipOfKey(store.getProject(pid).doc, runId, growingPickKey(stillIds[1]!, null))).toBeDefined();
      answers.push(back.body); ownerOk++;
      const v = await rest(owner, 'POST', `/api/v1/projects/${pid}/versions`, { name: 'after growing' });
      expect(v.status, JSON.stringify(v.body)).toBe(201);
      answers.push(v.body, (await rest(owner, 'GET', `/api/v1/projects/${pid}/versions`)).body);
      for (const q of ['', '?family=omit', '?library=strip', '?library=keep']) {
        const r = await rest(owner, 'GET', `/api/v1/projects/${pid}/archive${q}`);
        expect([q, r.status]).toEqual([q, 200]);
        expect([q, (r.body as Buffer).toString('latin1').includes(planted)]).toEqual([q, false]);
      }
      for (const who of [owner, AGENTS[0]![1], AGENTS[2]![1]]) {
        for (const kind of ['summary', 'timeline']) answers.push(await rpc(who, 'resources/read', { uri: `pulseframe://projects/${pid}/${kind}` }));
      }
      answers.push((await rest(owner, 'GET', `/api/v1/projects/${pid}/summary`)).body, (await rest(AGENTS[2]![1], 'GET', `/api/v1/projects/${pid}`)).body);
    } finally { for (const s of spies) s.mockRestore(); }
    expect(ownerOk).toBe(5); // plan, apply, both rebuilds and the restore succeeded for the owner
    const tables = (store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['projects', 'transactions', 'outbox', 'entity_versions', 'jobs']) expect(tables).toContain(t);
    for (const t of tables) {
      const rows = store.db.prepare(`SELECT * FROM "${t}"`).all();
      if (['projects', 'transactions', 'outbox', 'entity_versions'].includes(t)) expect(rows.length, t).toBeGreaterThan(0);
      expect(JSON.stringify(rows, (_k, x) => (Buffer.isBuffer(x) ? x.toString('latin1') : x)).includes(planted), t).toBe(false);
    }
    expect(JSON.stringify(store.getProject(pid).doc)).not.toContain(planted);
    expect(JSON.stringify(store.eventsSince(pid, 0))).not.toContain(planted);
    expect(JSON.stringify(answers)).not.toContain(planted);
    expect(out.join('\n')).not.toContain(planted);
    // the run records hold picks and settings, never a coordinate
    for (const run of Object.values(store.getProject(pid).doc.recipeRuns)) {
      for (const k of Object.keys(run.params)) expect([...GROWING_RECORD_KEYS, 'templateVersion']).toContain(k);
      const nums: number[] = [];
      JSON.stringify(run.params, (_k, x) => { if (typeof x === 'number') nums.push(x); return x; });
      expect(nums.filter((x) => x > 0 && x < 1 && x !== GROWING.faceSize.default)).toEqual([]);
    }
    expect(Object.keys(store.getProject(pid).doc.recipeRuns[runId]!.params).sort()).toEqual(['at', 'caption', 'dissolve', 'eyeLine', 'faceSize', 'fill', 'holdFrames', 'picked', 'sort', 'templateVersion']);
  });
});
