/**
 * Templates over REST and MCP (ADR-0016), without opening a port: the gallery (built-ins, then the model-gated ones), a plan that
 * changes nothing, apply as exactly one revision and one transaction row, stale revisions, propose-mode and track-limited
 * credentials refused, blocked plans, regeneration that keeps a hand-edited slot, and the error mapping.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { findClip, MODEL_GATED_TEMPLATES, TEMPLATES, validateProject, type Asset, type TemplateDef } from '@pulseframe/core';
import { useApplyTemplateDoubleIfStub } from '@pulseframe/core/templatePlan.testDouble.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { catalog, createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';

// TEST DOUBLE: while apply_template is the contracts stub, its body is the labelled double (packages/core/src/templatePlan.testDouble.ts);
// with the real op registered nothing is replaced.
useApplyTemplateDoubleIfStub();
// TEST TEMPLATE: added to this test process's catalogue so the flow does not depend on which built-ins exist. It has a sound
// effect (made by the real makeSfx, as in production) and no graphic elements (those need an ffmpeg with librsvg).
const words = (en: string) => ({ he: `${en} (he)`, en });
const TEST_DEF: TemplateDef = {
  id: 'tpl.server-test', version: 1, name: words('Server test'), hint: words('A template for this test'), genre: 'montage', designedFor: 'wide',
  tempo: { fallbackBpm: 120 }, music: { need: 'optional', startAt: 'first-downbeat' },
  slots: Array.from({ length: 4 }, (_, i) => ({
    key: `s${i + 1}`, role: words(`Slot ${i + 1}`), accept: 'any' as const, span: { beats: 2 }, motion: { presetId: 'motion.move.ken-burns-in' },
    ...(i > 0 ? { transitionIn: { type: 'dissolve', seconds: 0.2, dir: 'fixed' as const } } : {}),
  })),
  slotUse: { mode: 'all', min: 1 },
  texts: [{ key: 'title', role: words('Title'), default: words('Hello'), maxChars: 20, presetId: 'clean-white', at: { slot: 's1' }, place: { x: 0, y: 0 } }],
  elements: [], sfx: [{ key: 'tick', sfxId: 'sfx.click', at: 'first' }],
  adjust: [{ key: 'look', span: 'all', effects: [{ type: 'color.adjust', params: { saturation: 1.1 } }] }],
};
(TEMPLATES as TemplateDef[]).push(TEST_DEF);

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
const hash = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00.000Z', importedBy: 'test' };
let n = 1;
const video = (name: string, seconds: T.RationalTime): Omit<Asset, 'id'> => ({ kind: 'video', name, contentHash: hash(n++), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: seconds, video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: null }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const music = (): Omit<Asset, 'id'> => ({ kind: 'audio', name: 'music.wav', contentHash: hash(n++), byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov });

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let token = '';
const headers = (t = token) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body?: unknown, t?: string) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t?: string) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const txRows = (pid: string) => (store.db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE project_id = ?').get(pid) as { n: number }).n;
const revision = (pid: string) => store.getProject(pid).revision;
const grantToken = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;

/** A project with three long videos, a short one and analysed music (a beat every half second, a bar every four). */
function seed(name: string) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [video('a.mp4', T.rt(60, 1)), video('b.mp4', T.rt(60, 1)), video('c.mp4', T.rt(60, 1)), video('short.mp4', T.rt(1, 2)), music()].map((asset) => ({ op: 'import_asset', args: { asset } })) });
  const [a, b, c, short, mus] = r.results.map((x) => x.output!.assetId as string);
  const beats = Array.from({ length: 120 }, (_, i) => T.rt(i, 2));
  store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: mus, kind: 'beats', method: 'test grid', params: {}, createdAt: '2026-11-17T00:00:00.000Z', times: beats, bpm: 120, confidence: 1, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 } }] });
  return { pid, a: a!, b: b!, c: c!, short: short!, mus: mus! };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-templates-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  token = auth.tokens.agent;
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, speech);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov, undefined, speech);
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the template gallery', () => {
  it('lists the built-ins, then the model-gated templates as unavailable with their reason; catalog().templates is the same list', async () => {
    const r = await rest('GET', '/templates');
    expect(r.status).toBe(200);
    const ids = r.body.templates.map((t: { id: string }) => t.id);
    expect(ids.slice(-MODEL_GATED_TEMPLATES.length)).toEqual(MODEL_GATED_TEMPLATES.map((t) => t.id));
    expect(ids.slice(0, TEMPLATES.length)).toEqual(TEMPLATES.map((t) => t.id));
    for (const g of r.body.templates.slice(-MODEL_GATED_TEMPLATES.length)) expect(g).toMatchObject({ available: false, unavailableReason: expect.stringContaining('not installed'), needs: { model: expect.any(String) } });
    const mine = r.body.templates.find((t: { id: string }) => t.id === TEST_DEF.id);
    expect(mine).toMatchObject({ available: true, method: 'rule-based template; no model', needs: { music: 'optional', elements: false, gpu: false, model: null }, seconds: 4 });
    expect(catalog().templates.map((t) => t.id)).toEqual(ids);
  });
});

describe('plan and apply', () => {
  it('plan changes nothing and reports the revision; apply adds exactly one revision and one transaction row (REST and MCP)', async () => {
    const s = seed('apply');
    const params = { media: [s.a, s.b, s.c], musicAssetId: s.mus, lang: 'en', texts: { title: 'Our trip' } };
    const before = revision(s.pid), rows = txRows(s.pid);
    const plan = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/plan`, { params });
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ revision: before, templateId: TEST_DEF.id, blocking: [], method: 'rule-based template; no model' });
    expect(plan.body.predicted.boundaries).toEqual([0, 30, 60, 90, 120]);
    expect(plan.body.operations).toBeGreaterThan(10);
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before, rows]);
    const applied = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params, expectedRevision: plan.body.revision });
    expect(applied.status).toBe(200);
    expect([applied.body.revision, revision(s.pid), txRows(s.pid)]).toEqual([before + 1, before + 1, rows + 1]);
    const doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    const run = doc.recipeRuns[applied.body.runId]!;
    expect(run).toMatchObject({ recipeId: `template:${TEST_DEF.id}`, params: { templateVersion: 1, lang: 'en' } });
    expect(run.slots!.map((x) => x.key)).toEqual(['s1', 's2', 's3', 's4', 'look', 'title', 'tick', 'music']);
    for (const sl of run.slots!) expect(findClip(doc, sl.clipId), sl.key).toBeTruthy();
    // the sound effect was made by the real synthesiser and travels in the op, so replay needs nothing else
    expect(Object.values(doc.assets).some((a) => a.provenance.procedural?.id === 'sfx.click')).toBe(true);
    expect(store.replay(s.pid, revision(s.pid)).doc).toEqual(doc);
    // MCP: the same, with the same rules
    const t0 = revision(s.pid);
    const mp = await tool('plan_template', { projectId: s.pid, templateId: TEST_DEF.id, params });
    expect([mp.isError, mp.body.revision, revision(s.pid)]).toEqual([false, t0, t0]);
    const ma = await tool('apply_template', { projectId: s.pid, templateId: TEST_DEF.id, params, expectedRevision: mp.body.revision });
    expect([ma.isError, ma.body.revision, revision(s.pid), txRows(s.pid)]).toEqual([false, t0 + 1, t0 + 1, rows + 2]);
    // applied a second time with no `at`, it starts where the first one ended
    expect(store.getProject(s.pid).doc.recipeRuns[ma.body.runId]!.params.at).toEqual(T.rt(4, 1));
  }, 60_000);

  it('a stale expectedRevision is refused with 409 stale_revision and changes nothing', async () => {
    const s = seed('stale');
    const before = revision(s.pid), rows = txRows(s.pid);
    const r = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params: { media: [s.a] }, expectedRevision: before - 1 });
    expect([r.status, r.body.error.code]).toEqual([409, 'stale_revision']);
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before, rows]);
  });

  it('a propose-mode agent is refused with 403 insufficient_scope; a track-limited grant with 403 out_of_scope (REST and MCP); nothing changes', async () => {
    const s = seed('modes');
    const before = revision(s.pid);
    const propose = grantToken({ mode: 'propose' });
    const limited = grantToken({ mode: 'edit', trackIds: ['trk_none'] });
    const body = { params: { media: [s.a] } };
    const pr = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, body, propose);
    expect([pr.status, pr.body.error.code]).toEqual([403, 'insufficient_scope']);
    const lr = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, body, limited);
    expect([lr.status, lr.body.error.code]).toEqual([403, 'out_of_scope']);
    const pt = await tool('apply_template', { projectId: s.pid, templateId: TEST_DEF.id, params: body.params }, propose);
    expect([pt.isError, pt.body.error.code]).toEqual([true, 'insufficient_scope']);
    const lt = await tool('apply_template', { projectId: s.pid, templateId: TEST_DEF.id, params: body.params }, limited);
    expect([lt.isError, lt.body.error.code]).toEqual([true, 'out_of_scope']);
    // reading a plan is allowed to both
    expect((await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/plan`, body, propose)).status).toBe(200);
    expect(revision(s.pid)).toBe(before);
    expect(gov.listProposals(s.pid)).toEqual([]);
  });

  it('a blocked plan (a video shorter than its slot) is refused with 409 template_blocked naming the slot', async () => {
    const s = seed('blocked');
    const before = revision(s.pid);
    const plan = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/plan`, { params: { media: [s.short] } });
    expect(plan.body.blocking[0]).toMatchObject({ code: 'slot_too_short', details: { slot: 's1', haveFrames: 15, needFrames: 30 } });
    const r = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params: { media: [s.short] } });
    expect([r.status, r.body.error.code, r.body.error.details.blocking[0].details.slot]).toEqual([409, 'template_blocked', 's1']);
    expect(revision(s.pid)).toBe(before);
  });

  it('error mapping: unknown 404, model-gated 409 needs_capability, music without beats 409 needs_analysis, bad input 400', async () => {
    const s = seed('errors');
    const plan = (id: string, params: unknown) => rest('POST', `/projects/${s.pid}/templates/${id}/plan`, { params });
    const apply = (id: string, params: unknown) => rest('POST', `/projects/${s.pid}/templates/${id}/apply`, { params });
    expect([(await plan('tpl.nope', {})).status, (await apply('tpl.nope', {})).status]).toEqual([404, 404]);
    for (const g of MODEL_GATED_TEMPLATES) {
      const p = await plan(g.id, { media: [s.a] }), a = await apply(g.id, { media: [s.a] });
      expect([p.status, p.body.error.code, a.status, a.body.error.code]).toEqual([409, 'needs_capability', 409, 'needs_capability']);
      expect(p.body.error.message).toContain('not installed');
    }
    const r2 = store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: music() } }] });
    const unmeasured = r2.results[0]!.output!.assetId as string;
    const na = await plan(TEST_DEF.id, { media: [s.a], musicAssetId: unmeasured });
    expect([na.status, na.body.error.code]).toEqual([409, 'needs_analysis']);
    expect(na.body.error.hint).toContain('ללא בינה מלאכותית');
    const bad = await plan(TEST_DEF.id, { media: [s.a], tempo: 'triple' });
    expect([bad.status, bad.body.error.code]).toEqual([400, 'invalid_request']);
    expect((await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/plan`, { params: {}, extra: 1 })).status).toBe(400);
    const gt = await tool('plan_template', { projectId: s.pid, templateId: 'tpl.3d-zoom', params: { media: [s.a] } });
    expect([gt.isError, gt.body.error.code]).toEqual([true, 'needs_capability']);
  });
});

describe('the built-in templates over REST', () => {
  it('each plans, applies and regenerates as one revision each, leaving a valid project (real sound and element synthesis)', async () => {
    const builtins = TEMPLATES.filter((t) => t.id !== TEST_DEF.id);
    const listed = (await rest('GET', '/templates')).body.templates as { id: string; available: boolean }[];
    for (const def of builtins) {
      if (!listed.find((t) => t.id === def.id)!.available) continue; // graphic elements need an ffmpeg with librsvg
      const s = seed(def.id);
      const params = { media: [s.a, s.b, s.c], musicAssetId: def.music.need === 'none' ? null : s.mus };
      const plan = await rest('POST', `/projects/${s.pid}/templates/${def.id}/plan`, { params });
      expect([plan.status, plan.body.blocking], def.id).toEqual([200, []]);
      const r0 = revision(s.pid);
      const applied = await rest('POST', `/projects/${s.pid}/templates/${def.id}/apply`, { params, expectedRevision: plan.body.revision });
      expect([applied.status, revision(s.pid)], def.id).toEqual([200, r0 + 1]);
      expect(validateProject(store.getProject(s.pid).doc), def.id).toEqual([]);
      const regen = await rest('POST', `/projects/${s.pid}/template-runs/${applied.body.runId}/regenerate`, { params: { order: 'shuffle', seed: 3 } });
      expect([regen.status, regen.body.protected, revision(s.pid)], def.id).toEqual([200, [], r0 + 2]);
      expect(validateProject(store.getProject(s.pid).doc), def.id).toEqual([]);
    }
  }, 120_000);
});

describe('regenerate', () => {
  it('keeps a slot edited by hand (by fingerprint) and replaces the untouched ones, as one revision, with counts', async () => {
    const s = seed('regen');
    const params = { media: [s.a, s.b, s.c], musicAssetId: s.mus };
    const applied = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params });
    expect(applied.status).toBe(200);
    const runId = applied.body.runId as string;
    const doc0 = store.getProject(s.pid).doc;
    const run0 = doc0.recipeRuns[runId]!;
    const s2 = run0.slots!.find((x) => x.key === 's2')!.clipId;
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'set_clip_transform', args: { clipId: s2, transform: { rotation: 5 } } }] });
    const edited = structuredClone(findClip(store.getProject(s.pid).doc, s2)!.clip);
    const live = run0.createdIds.filter((id) => !!findClip(doc0, id));
    const before = revision(s.pid), rows = txRows(s.pid);
    const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 7 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ runId, protected: [s2], replaced: live.length - 1 });
    expect(r.body.warnings).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['s2'] } }));
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before + 1, rows + 1]);
    const doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    expect(findClip(doc, s2)!.clip).toEqual(edited);
    const run = doc.recipeRuns[runId]!;
    expect(run.params).toMatchObject({ order: 'shuffle', seed: 7, at: T.ZERO });
    expect(run.slots!.map((x) => x.key).sort()).toEqual(run0.slots!.map((x) => x.key).sort());
    expect(run.slots!.find((x) => x.key === 's2')!.clipId).toBe(s2);
    for (const sl of run.slots!) if (sl.key !== 's2') expect(run0.slots!.find((x) => x.key === sl.key)!.clipId).not.toBe(sl.clipId);
    // the old untouched clips are gone; one picture per slot remains
    for (const id of live) if (id !== s2) expect(findClip(doc, id)).toBeUndefined();
    // and a second regeneration still recognises the hand edit
    const again = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
    expect(again.body.protected).toEqual([s2]);
    // an unknown run, or a recipe run, is 404
    expect((await rest('POST', `/projects/${s.pid}/template-runs/run_nope/regenerate`, {})).status).toBe(404);
    // MCP regenerate: one revision
    const t0 = revision(s.pid);
    const mt = await tool('regenerate_template', { projectId: s.pid, runId, params: { tempo: 'half' } });
    expect([mt.isError, revision(s.pid)]).toEqual([false, t0 + 1]);
  }, 60_000);
});
