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
import { clipEnd, findClip, MODEL_GATED_TEMPLATES, TEMPLATES, validateProject, type Asset, type Clip, type ProjectDocument, type TemplateDef } from '@pulseframe/core';
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
// TEST TEMPLATE with slots that keep their own sound (like tpl.home-video): each slot is a picture linked to its own sound.
const SOUND_DEF: TemplateDef = {
  id: 'tpl.server-test-sound', version: 1, name: words('Server test with sound'), hint: words('Slots that keep their own sound'), genre: 'memories', designedFor: 'wide',
  tempo: { fallbackBpm: 120 }, music: { need: 'optional', startAt: 'zero' },
  slots: Array.from({ length: 3 }, (_, i) => ({ key: `clip${i + 1}`, role: words(`Clip ${i + 1}`), accept: 'any' as const, span: { seconds: '1' }, keepAudio: true })),
  slotUse: { mode: 'all', min: 1 }, texts: [], elements: [], sfx: [], adjust: [],
};
(TEMPLATES as TemplateDef[]).push(TEST_DEF, SOUND_DEF);

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
const mainTracks = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks;
const isPictureClip = (doc: ProjectDocument, c: Clip) => c.type === 'media' && ['video', 'image'].includes(doc.assets[c.assetId]?.kind ?? '');
/**
 * The run's picture slots: the frames from the first slot's start to the last one's end that no slot picture covers, kept clips a
 * picture on a higher track covers, and the run's graphic elements over each kept clip. A graphic element of the template (a run
 * slot of kind 'element', placed by the planner on a track above the pictures) is not a slot picture: it fills no frame, and
 * lying over a picture is its place.
 */
function pictureCoverage(doc: ProjectDocument, runId: string, keptIds: readonly string[] = []) {
  const tracks = mainTracks(doc).filter((t) => t.kind === 'video');
  const run = doc.recipeRuns[runId]!;
  const elementKey = new Map(run.slots!.filter((s) => s.kind === 'element').map((s) => [s.clipId, s.key]));
  const isSlotPicture = (c: Clip) => isPictureClip(doc, c) && !elementKey.has(c.id);
  const slotClips = run.slots!.filter((s) => s.kind === 'picture').map((s) => findClip(doc, s.clipId)!.clip);
  const fi = (t: T.RationalTime) => T.nearestFrameIndex(t, R);
  const from = Math.min(...slotClips.map((c) => fi(c.start))), to = Math.max(...slotClips.map((c) => fi(clipEnd(c))));
  const holes: number[] = [];
  for (let f = from; f < to; f++) if (!tracks.some((t) => t.clips.some((c) => isSlotPicture(c) && fi(c.start) <= f && f < fi(clipEnd(c))))) holes.push(f);
  const over = (id: string) => {
    const k = findClip(doc, id);
    if (!k || k.track.kind !== 'video') return [];
    return tracks.slice(tracks.indexOf(k.track) + 1).flatMap((t) => t.clips.filter((c) => isPictureClip(doc, c) && T.lt(c.start, clipEnd(k.clip)) && T.lt(k.clip.start, clipEnd(c))));
  };
  const covered = keptIds.filter((id) => over(id).some((c) => !elementKey.has(c.id)));
  const elementsOver = keptIds.flatMap((id) => over(id).filter((c) => elementKey.has(c.id)).map((c) => ({ key: elementKey.get(c.id)!, assetId: c.type === 'media' ? c.assetId : null, from: fi(c.start), to: fi(clipEnd(c)), transform: c.type === 'media' ? c.transform : null })));
  return { from, to, holes, covered, elementsOver };
}
/** The clips linked to `clipId` (its link group, itself excluded). */
const partners = (doc: ProjectDocument, clipId: string) => {
  const c = findClip(doc, clipId)!.clip;
  return c.type === 'media' && c.linkGroupId ? mainTracks(doc).flatMap((t) => t.clips).filter((x) => x.id !== clipId && x.type === 'media' && x.linkGroupId === c.linkGroupId) : [];
};
const soundsAt = (doc: ProjectDocument, start: T.RationalTime) => mainTracks(doc).filter((t) => t.kind === 'audio').flatMap((t) => t.clips).filter((c) => T.eq(c.start, start));

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
    const builtins = TEMPLATES.filter((t) => t.id !== TEST_DEF.id && t.id !== SOUND_DEF.id);
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
    // no frame of the run lacks a picture, and nothing new covers the kept one
    expect(pictureCoverage(doc, runId, [s2])).toMatchObject({ holes: [], covered: [] });
    // and a second regeneration still recognises the hand edit
    const again = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
    expect(again.body.protected).toEqual([s2]);
    // an unknown run, or a recipe run, is 404
    expect((await rest('POST', `/projects/${s.pid}/template-runs/run_nope/regenerate`, {})).status).toBe(404);
    // MCP regenerate: one revision
    const t0 = revision(s.pid);
    const mt = await tool('regenerate_template', { projectId: s.pid, runId, params: { seed: 9 } });
    expect([mt.isError, revision(s.pid)]).toEqual([false, t0 + 1]);
    expect(pictureCoverage(store.getProject(s.pid).doc, runId, [s2])).toMatchObject({ holes: [], covered: [] });
  }, 60_000);

  it('another tempo would move a slot kept by hand: refused with 409 template_blocked naming the slot (REST and MCP), nothing changes; without hand edits it re-times every slot with no gap', async () => {
    const s = seed('regen-tempo');
    const params = { media: [s.a, s.b, s.c], musicAssetId: s.mus };
    const applied = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params });
    const runId = applied.body.runId as string;
    // untouched: half tempo re-times every slot, one revision, no frame without a picture
    const h = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { tempo: 'half' } });
    expect([h.status, h.body.protected]).toEqual([200, []]);
    const half = pictureCoverage(store.getProject(s.pid).doc, runId);
    expect([half.from, half.to, half.holes]).toEqual([0, 240, []]);
    // a hand edit, then another tempo: the kept clip would no longer lie on its slot
    const s2 = store.getProject(s.pid).doc.recipeRuns[runId]!.slots!.find((x) => x.key === 's2')!.clipId;
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'set_clip_transform', args: { clipId: s2, transform: { rotation: 5 } } }] });
    const before = revision(s.pid), rows = txRows(s.pid), doc0 = store.getProject(s.pid).doc;
    const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { tempo: 'normal' } });
    expect([r.status, r.body.error.code]).toEqual([409, 'template_blocked']);
    expect(r.body.error.details.kept).toEqual([{ key: 's2', clipId: s2, startFrame: 60, frames: 60, plannedStartFrame: 30, plannedFrames: 30 }]);
    expect(r.body.error.message).toContain('s2');
    expect(r.body.error.hint).toContain('half');
    const m = await tool('regenerate_template', { projectId: s.pid, runId, params: { tempo: 'double' } });
    expect([m.isError, m.body.error.code]).toEqual([true, 'template_blocked']);
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before, rows]);
    expect(store.getProject(s.pid).doc).toEqual(doc0);
    // the run's own tempo still regenerates, keeping the edit
    const ok = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 2 } });
    expect([ok.status, ok.body.protected]).toEqual([200, [s2]]);
    expect(pictureCoverage(store.getProject(s.pid).doc, runId, [s2])).toMatchObject({ holes: [], covered: [] });
    // a kept clip trimmed by hand no longer fills its slot either: refused the same way
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'trim_clip', args: { clipId: s2, edge: 'end', to: T.frameTime(110, R) } }] });
    const t = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
    expect([t.status, t.body.error.code, t.body.error.details.kept[0].frames]).toEqual([409, 'template_blocked', 50]);
  }, 60_000);

  it('a slot that keeps its own sound is kept as a whole: a picture edited by hand keeps its linked sound, a sound edited by hand keeps its picture (no doubled sound)', async () => {
    for (const edit of ['picture', 'sound'] as const) {
      const s = seed(`regen-sound-${edit}`);
      const applied = await rest('POST', `/projects/${s.pid}/templates/${SOUND_DEF.id}/apply`, { params: { media: [s.a, s.b, s.c], musicAssetId: null } });
      expect(applied.status).toBe(200);
      const runId = applied.body.runId as string;
      const doc0 = store.getProject(s.pid).doc;
      const pic = doc0.recipeRuns[runId]!.slots!.find((x) => x.key === 'clip2')!.clipId;
      const [aud, ...more] = partners(doc0, pic);
      expect([aud?.type, more.length], 'the slot is a picture linked to its own sound').toEqual(['media', 0]);
      if (edit === 'picture') store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'set_clip_transform', args: { clipId: pic, transform: { rotation: 5 } } }] });
      else store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'set_clip_gain', args: { clipId: aud!.id, gain: 0.5 } }] });
      const d1 = store.getProject(s.pid).doc;
      const keptPic = structuredClone(findClip(d1, pic)!.clip), keptAud = structuredClone(findClip(d1, aud!.id)!.clip);
      const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 7 } });
      expect(r.status, edit).toBe(200);
      expect([...r.body.protected].sort(), edit).toEqual([pic, aud!.id].sort());
      expect(r.body.warnings, edit).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['clip2'] } }));
      const doc = store.getProject(s.pid).doc;
      expect(validateProject(doc), edit).toEqual([]);
      // the whole slot, byte for byte: still linked, the sound still its own
      expect(findClip(doc, pic)?.clip, edit).toEqual(keptPic);
      expect(findClip(doc, aud!.id)?.clip, edit).toEqual(keptAud);
      expect(doc.recipeRuns[runId]!.slots!.find((x) => x.key === 'clip2')!.clipId, edit).toBe(pic);
      // one sound under the kept picture, and every other slot is a new picture with its own one sound
      expect(soundsAt(doc, keptPic.start).map((c) => c.id), edit).toEqual([aud!.id]);
      for (const sl of doc.recipeRuns[runId]!.slots!.filter((x) => x.kind === 'picture' && x.key !== 'clip2')) {
        const c = findClip(doc, sl.clipId)!.clip;
        expect([partners(doc, c.id).length, soundsAt(doc, c.start).length], `${edit} ${sl.key}`).toEqual([1, 1]);
      }
      expect(pictureCoverage(doc, runId, [pic]), edit).toMatchObject({ holes: [], covered: [] });
      // the next regeneration still keeps the whole slot
      const again = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
      expect([...again.body.protected].sort(), edit).toEqual([pic, aud!.id].sort());
    }
  }, 60_000);

  it('a graphic element of the template is not a slot picture: after a shuffle the same element lies over the kept picture, where it was, and no slot picture covers it', async (ctx) => {
    const def = TEMPLATES.find((t) => t.id === 'tpl.travel-montage')!; // a location pin over its first two shots
    const listed = (await rest('GET', '/templates')).body.templates as { id: string; available: boolean }[];
    if (!listed.find((t) => t.id === def.id)!.available) return ctx.skip(); // graphic elements need an ffmpeg with librsvg
    const s = seed('regen-element');
    const applied = await rest('POST', `/projects/${s.pid}/templates/${def.id}/apply`, { params: { media: [s.a, s.b, s.c], musicAssetId: s.mus } });
    expect(applied.status).toBe(200);
    const runId = applied.body.runId as string;
    const doc0 = store.getProject(s.pid).doc;
    const shot2 = doc0.recipeRuns[runId]!.slots!.find((x) => x.key === 'shot2')!.clipId;
    const pin0 = doc0.recipeRuns[runId]!.slots!.find((x) => x.key === 'pin')!.clipId;
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'set_clip_transform', args: { clipId: shot2, transform: { rotation: 5 } } }] });
    const d1 = store.getProject(s.pid).doc;
    const kept = structuredClone(findClip(d1, shot2)!.clip);
    const before = pictureCoverage(d1, runId, [shot2]);
    expect([before.holes, before.covered, before.elementsOver.map((e) => e.key)], 'the pin lies over the second shot as the template placed it').toEqual([[], [], ['pin']]);
    const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 7 } });
    expect([r.status, r.body.protected]).toEqual([200, [shot2]]);
    const doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    expect(findClip(doc, shot2)!.clip).toEqual(kept);
    // the pin was untouched, so it is made again (a new clip) at the same place, over the kept picture; the new slot pictures
    // share the kept picture's track and none lies over it; the element fills no frame, so every frame still has a slot picture
    const pin = doc.recipeRuns[runId]!.slots!.find((x) => x.key === 'pin')?.clipId;
    expect([typeof pin, pin === pin0, findClip(doc, pin0)]).toEqual(['string', false, undefined]);
    const after = pictureCoverage(doc, runId, [shot2]);
    expect(after).toMatchObject({ holes: [], covered: [] });
    expect(after.elementsOver).toEqual(before.elementsOver);
    const track = findClip(doc, shot2)!.track.id;
    for (const sl of doc.recipeRuns[runId]!.slots!.filter((x) => x.kind === 'picture')) expect(findClip(doc, sl.clipId)!.track.id, sl.key).toBe(track);
  }, 60_000);
});
