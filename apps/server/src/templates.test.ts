/**
 * Templates over REST and MCP (ADR-0016), without opening a port: the gallery (built-ins, then the model-gated ones), a plan that
 * changes nothing, apply as exactly one revision and one transaction row, stale revisions, propose-mode and track-limited
 * credentials refused, blocked plans, regeneration that keeps a hand-edited slot, and the error mapping.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { clipEnd, creativeProjection, findClip, MODEL_GATED_TEMPLATES, movedOnly, planTemplate, removedByHand, TEMPLATES, validateProject, type Asset, type Clip, type ProjectDocument, type TemplateDef } from '@pulseframe/core';
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
import { ApiError, Store } from './store.ts';

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
// TEST TEMPLATE without procedural media (no sound effect, no element), so a run of it can be committed here exactly as a server
// before run.ranges committed it: the plan's own ops, without recordRanges.
const OLD_DEF: TemplateDef = { ...TEST_DEF, id: 'tpl.server-test-older', name: words('Server test, older run'), sfx: [] };
(TEMPLATES as TemplateDef[]).push(TEST_DEF, SOUND_DEF, OLD_DEF);

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
  // a slot deleted by hand keeps an inert record (its clip is gone): it holds no picture
  const slotClips = run.slots!.filter((s) => s.kind === 'picture').flatMap((s) => { const f = findClip(doc, s.clipId); return f ? [f.clip] : []; });
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

  it('a slot deleted by hand stays deleted: the regeneration leaves it out, says so, carries its record on, and replays byte for byte', async () => {
    const s = seed('regen-deleted');
    const applied = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params: { media: [s.a, s.b, s.c], musicAssetId: s.mus } });
    expect(applied.status).toBe(200);
    const runId = applied.body.runId as string;
    const run0 = store.getProject(s.pid).doc.recipeRuns[runId]!;
    const s2 = run0.slots!.find((x) => x.key === 's2')!.clipId;
    const range = findClip(store.getProject(s.pid).doc, s2)!.clip;
    const [from, to] = [T.nearestFrameIndex(range.start, R), T.nearestFrameIndex(clipEnd(range), R)];
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: s2 } }] });
    const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 7 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removed: ['s2'], protected: [] });
    expect(r.body.notices).toContainEqual(expect.objectContaining({ code: 'removed_by_hand', details: { keys: ['s2'] } }));
    expect(r.body.warnings.map((w: { code: string }) => w.code)).not.toContain('kept_by_hand');
    expect(r.body.alternatives).toContainEqual(expect.objectContaining({ restoreRemoved: true, params: {} }));
    let doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    // nothing was made in its place: the slot's frames hold no slot picture, every other frame does
    const cov = pictureCoverage(doc, runId);
    expect(cov.holes).toEqual(Array.from({ length: to - from }, (_, i) => from + i));
    // the record travels on (its clip still gone), so a second regeneration still leaves it out
    expect(doc.recipeRuns[runId]!.slots!.find((x) => x.key === 's2')!.clipId).toBe(s2);
    const again = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
    expect([again.status, again.body.removed]).toEqual([200, ['s2']]);
    expect(pictureCoverage(store.getProject(s.pid).doc, runId).holes).toEqual(cov.holes);
    // MCP says the same
    const m = await tool('regenerate_template', { projectId: s.pid, runId, params: { seed: 3 } });
    expect([m.isError, m.body.removed]).toEqual([false, ['s2']]);
    // replay of the op log gives the same document, byte for byte
    doc = store.getProject(s.pid).doc;
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(doc));
  }, 60_000);

  it('undo of a hand delete brings the slot back for the regeneration; restoreRemoved is the explicit way back after one (REST and MCP)', async () => {
    const s = seed('regen-undo-delete');
    const applied = await rest('POST', `/projects/${s.pid}/templates/${TEST_DEF.id}/apply`, { params: { media: [s.a, s.b, s.c], musicAssetId: s.mus } });
    const runId = applied.body.runId as string;
    const run0 = store.getProject(s.pid).doc.recipeRuns[runId]!;
    const s2 = run0.slots!.find((x) => x.key === 's2')!.clipId, title = run0.slots!.find((x) => x.key === 'title')!.clipId;
    // delete, then undo the delete: the slot is live again and is regenerated like any untouched one
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: s2 } }] });
    store.undo(s.pid, 'user:owner', 'undo');
    expect(findClip(store.getProject(s.pid).doc, s2)).toBeTruthy();
    const back = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { params: { order: 'shuffle', seed: 5 } });
    expect([back.status, back.body.removed, back.body.notices.map((x: { code: string }) => x.code)]).toEqual([200, [], []]);
    let doc = store.getProject(s.pid).doc;
    expect(findClip(doc, doc.recipeRuns[runId]!.slots!.find((x) => x.key === 's2')!.clipId)).toBeTruthy();
    expect(pictureCoverage(doc, runId).holes).toEqual([]);
    // delete the picture and the title, regenerate (both left out), then restore: both are made again and the run is whole
    const s2b = doc.recipeRuns[runId]!.slots!.find((x) => x.key === 's2')!.clipId, titleB = doc.recipeRuns[runId]!.slots!.find((x) => x.key === 'title')!.clipId;
    expect(titleB).not.toBe(title);
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: s2b } }, { op: 'delete_clip', args: { clipId: titleB } }] });
    const left = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, {});
    expect([left.status, [...left.body.removed].sort()]).toEqual([200, ['s2', 'title']]);
    doc = store.getProject(s.pid).doc;
    expect(mainTracks(doc).filter((t) => t.kind === 'text').flatMap((t) => t.clips)).toEqual([]);
    const restored = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, { restoreRemoved: true });
    expect([restored.status, restored.body.removed, restored.body.notices.map((x: { code: string }) => x.code)]).toEqual([200, [], []]);
    doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    for (const key of ['s2', 'title']) expect(findClip(doc, doc.recipeRuns[runId]!.slots!.find((x) => x.key === key)!.clipId), key).toBeTruthy();
    expect(pictureCoverage(doc, runId).holes).toEqual([]);
    // MCP: delete again, restore through the tool
    store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'delete_clip', args: { clipId: doc.recipeRuns[runId]!.slots!.find((x) => x.key === 's2')!.clipId } }] });
    const mt = await tool('regenerate_template', { projectId: s.pid, runId, restoreRemoved: true });
    expect([mt.isError, mt.body.removed]).toEqual([false, []]);
    expect(pictureCoverage(store.getProject(s.pid).doc, runId).holes).toEqual([]);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(store.getProject(s.pid).doc));
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

/**
 * ADR-0016 decision 6, amendment of 2026-11-24. A new project closes the gap on Delete (ripple delete), so the later template
 * pictures move earlier. A clip whose ONLY change since the run is its place in time on its own track is not edited by hand: it
 * is replaced and made again on its slot, and the answer says so (notice moved_back, movedBack). Any other change still keeps it.
 */
describe('regenerate after a ripple delete: a clip that was only moved is made again on its slot', () => {
  const slotClip = (doc: ProjectDocument, runId: string, key: string) => doc.recipeRuns[runId]!.slots!.find((x) => x.key === key)!.clipId;
  const frames = (doc: ProjectDocument, clipId: string) => { const c = findClip(doc, clipId)!.clip; return [T.nearestFrameIndex(c.start, R), T.nearestFrameIndex(clipEnd(c), R)]; };
  const slotFrames = (doc: ProjectDocument, runId: string, keys: readonly string[]) => keys.map((k) => frames(doc, slotClip(doc, runId, k)));
  /** Undo the newest edit that is not undone yet, whoever made it (the regeneration is the agent's, the hand edits the owner's). */
  const undoLast = (pid: string) => {
    const row = store.db.prepare("SELECT actor FROM transactions WHERE project_id = ? AND kind IN ('edit','redo') AND undone_by IS NULL ORDER BY revision DESC LIMIT 1").get(pid) as { actor: string };
    store.undo(pid, row.actor, 'undo');
  };
  const hand = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:owner', ops });
  const regen = (pid: string, runId: string, body: unknown = {}) => rest('POST', `/projects/${pid}/template-runs/${runId}/regenerate`, body);
  async function appliedRun(name: string, def: TemplateDef = TEST_DEF, musicAssetId: 'mus' | null = 'mus') {
    const s = seed(name);
    const applied = await rest('POST', `/projects/${s.pid}/templates/${def.id}/apply`, { params: { media: [s.a, s.b, s.c], musicAssetId: musicAssetId ? s.mus : null } });
    expect(applied.status).toBe(200);
    return { ...s, runId: applied.body.runId as string };
  }

  it('Delete that closes the gap, then Shuffle: the deleted slot is left out, the shifted pictures are back on their slots and the answer says so; one revision, exact undo (REST and MCP)', async () => {
    const s = await appliedRun('moved-shuffle');
    const doc0 = store.getProject(s.pid).doc;
    const [s2, s3, s4] = ['s2', 's3', 's4'].map((k) => slotClip(doc0, s.runId, k));
    expect(slotFrames(doc0, s.runId, ['s1', 's2', 's3', 's4'])).toEqual([[0, 30], [30, 60], [60, 90], [90, 120]]);
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2!] } }]);
    const rippled = store.getProject(s.pid).doc;
    expect([frames(rippled, s3!), frames(rippled, s4!)]).toEqual([[30, 60], [60, 90]]);
    // the shifted pictures differ from the run's fingerprints, and by their place alone
    expect(movedOnly(rippled, rippled.recipeRuns[s.runId]!, [s3!, s4!])).toEqual([s3, s4]);
    const before = revision(s.pid), rows = txRows(s.pid), pRippled = creativeProjection(rippled);
    const r = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 7 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ protected: [], removed: ['s2'], movedBack: ['s3', 's4'] });
    expect(r.body.notices).toContainEqual(expect.objectContaining({ code: 'moved_back', details: { keys: ['s3', 's4'] } }));
    expect(r.body.notices).toContainEqual(expect.objectContaining({ code: 'removed_by_hand', details: { keys: ['s2'] } }));
    expect(r.body.warnings.map((w: { code: string }) => w.code)).not.toContain('kept_by_hand');
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before + 1, rows + 1]);
    let doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    // made again (new clips) on the places the template gives them; the old shifted clips are gone; s2's frames hold no picture
    expect(slotFrames(doc, s.runId, ['s1', 's3', 's4'])).toEqual([[0, 30], [60, 90], [90, 120]]);
    for (const id of [s3!, s4!]) expect(findClip(doc, id)).toBeUndefined();
    expect(pictureCoverage(doc, s.runId).holes).toEqual(Array.from({ length: 30 }, (_, i) => 30 + i));
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(doc));
    // exact undo: one step for the regeneration (the shifted pictures are back where the delete left them), one for the delete
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(pRippled);
    expect(store.getProject(s.pid).doc.recipeRuns).toEqual(rippled.recipeRuns);
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(doc0));
    // MCP: the same answer on the same path
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2!] } }]);
    const t0 = revision(s.pid);
    const m = await tool('regenerate_template', { projectId: s.pid, runId: s.runId, params: { order: 'shuffle', seed: 9 } });
    expect([m.isError, m.body.movedBack, m.body.removed, m.body.protected, revision(s.pid)]).toEqual([false, ['s3', 's4'], ['s2'], [], t0 + 1]);
    doc = store.getProject(s.pid).doc;
    expect(slotFrames(doc, s.runId, ['s1', 's3', 's4'])).toEqual([[0, 30], [60, 90], [90, 120]]);
  }, 60_000);

  it('Delete that closes the gap, then restoreRemoved: the deleted picture is made again and the shifted ones return to their slots; two undo steps return exactly', async () => {
    const s = await appliedRun('moved-restore');
    const doc0 = store.getProject(s.pid).doc;
    const s2 = slotClip(doc0, s.runId, 's2');
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2] } }]);
    const rippled = store.getProject(s.pid).doc;
    const before = revision(s.pid), rows = txRows(s.pid);
    const r = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ protected: [], removed: [], movedBack: ['s3', 's4'] });
    expect(r.body.notices.map((x: { code: string }) => x.code)).toEqual(['moved_back']);
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before + 1, rows + 1]);
    const doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    expect(slotFrames(doc, s.runId, ['s1', 's2', 's3', 's4'])).toEqual([[0, 30], [30, 60], [60, 90], [90, 120]]);
    expect(removedByHand(doc, doc.recipeRuns[s.runId]!.slots!)).toEqual([]);
    expect(pictureCoverage(doc, s.runId).holes).toEqual([]);
    // every picture is on one track, and the title, look, sound effect and music (untouched) were replaced as always
    expect(new Set(['s1', 's2', 's3', 's4'].map((k) => findClip(doc, slotClip(doc, s.runId, k))!.track.id)).size).toBe(1);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(doc));
    // the next regeneration finds nothing moved: the new run recorded the new places
    const again = await regen(s.pid, s.runId, {});
    expect([again.status, again.body.movedBack, again.body.protected, again.body.notices]).toEqual([200, [], [], []]);
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(doc));
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(rippled));
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(doc0));
    expect(store.getProject(s.pid).doc.recipeRuns).toEqual(doc0.recipeRuns);
  }, 60_000);

  it('moved AND changed otherwise (trimmed, turned) is still edited by hand: kept, and refused off its slot; the hint never proposes what was just asked', async () => {
    const s = await appliedRun('moved-and-trimmed');
    const doc0 = store.getProject(s.pid).doc;
    const [s2, s3, s4] = ['s2', 's3', 's4'].map((k) => slotClip(doc0, s.runId, k));
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2!] } }, { op: 'trim_clip', args: { clipId: s3!, edge: 'end', to: T.frameTime(50, R) } }]);
    const before = revision(s.pid), rows = txRows(s.pid), held = store.getProject(s.pid).doc;
    expect(movedOnly(held, held.recipeRuns[s.runId]!, [s3!, s4!])).toEqual([s4]);
    // Shuffle at the run's tempo: the next step is to undo the edit or to delete the clip and restore; the run's tempo was not left
    const sh = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 3 } });
    expect([sh.status, sh.body.error.code]).toEqual([409, 'template_blocked']);
    expect(sh.body.error.details.kept).toEqual([{ key: 's3', clipId: s3, startFrame: 30, frames: 20, plannedStartFrame: 60, plannedFrames: 30 }]);
    expect(sh.body.error.hint).toBe('Undo the hand edit that moved or trimmed slot(s) s3, or delete that clip and regenerate with restoreRemoved: true so the template fills the slot again.');
    // restoreRemoved: the refusal does not send the caller back to restoreRemoved
    const rs = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([rs.status, rs.body.error.code, rs.body.error.details.kept.map((k: { key: string }) => k.key)]).toEqual([409, 'template_blocked', ['s3']]);
    const RESTORE_HINT = 'Undo the hand edit that moved or trimmed slot(s) s3, or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too.';
    expect(rs.body.error.hint).toBe(RESTORE_HINT);
    // another tempo with restoreRemoved: the run's tempo is a next step too
    const rt = await regen(s.pid, s.runId, { restoreRemoved: true, params: { tempo: 'half' } });
    expect([rt.status, rt.body.error.hint]).toEqual([409, `Regenerate with the run's tempo (normal), u${RESTORE_HINT.slice(1)}`]);
    const mt = await tool('regenerate_template', { projectId: s.pid, runId: s.runId, restoreRemoved: true });
    expect([mt.isError, mt.body.error.code, mt.body.error.hint]).toEqual([true, 'template_blocked', RESTORE_HINT]);
    expect([revision(s.pid), txRows(s.pid)]).toEqual([before, rows]);
    expect(store.getProject(s.pid).doc).toEqual(held);
    // the second next step is true: with that clip deleted as well (the gap closed again), the same request makes all of them again
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s3!] } }]);
    const both = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([both.status, both.body.protected, both.body.removed, both.body.movedBack]).toEqual([200, [], [], ['s4']]);
    expect(slotFrames(store.getProject(s.pid).doc, s.runId, ['s1', 's2', 's3', 's4'])).toEqual([[0, 30], [30, 60], [60, 90], [90, 120]]);
    undoLast(s.pid); undoLast(s.pid);
    expect(store.getProject(s.pid).doc.sequences).toEqual(held.sequences);
    // a picture turned by hand that lies on its slot is kept there, while the shifted ones around it are put back
    undoLast(s.pid);
    hand(s.pid, [{ op: 'set_clip_transform', args: { clipId: slotClip(doc0, s.runId, 's1'), transform: { rotation: 5 } } }, { op: 'ripple_delete_clips', args: { clipIds: [s2!] } }]);
    const ok = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([ok.status, ok.body.protected, ok.body.movedBack]).toEqual([200, [slotClip(doc0, s.runId, 's1')], ['s3', 's4']]);
    expect(pictureCoverage(store.getProject(s.pid).doc, s.runId, [slotClip(doc0, s.runId, 's1')])).toMatchObject({ holes: [], covered: [] });
  }, 60_000);

  it('moved to another track is edited by hand: a title taken to another track and time is kept where it is; a picture taken to another track is kept and refused off its slot', async () => {
    const s = await appliedRun('moved-track');
    const doc0 = store.getProject(s.pid).doc;
    const title = slotClip(doc0, s.runId, 'title'), s4 = slotClip(doc0, s.runId, 's4');
    const added = hand(s.pid, [{ op: 'add_track', args: { kind: 'text' } }, { op: 'add_track', args: { kind: 'video' } }]);
    const [textTrack, videoTrack] = added.results.map((x) => x.output!.trackId as string);
    hand(s.pid, [{ op: 'move_clip', args: { clipId: title, start: T.frameTime(45, R), trackId: textTrack } }]);
    const moved = structuredClone(findClip(store.getProject(s.pid).doc, title)!);
    expect(moved.track.id).toBe(textTrack);
    const r = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 4 } });
    expect([r.status, r.body.protected, r.body.movedBack]).toEqual([200, [title], []]);
    expect(r.body.warnings).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['title'] } }));
    let doc = store.getProject(s.pid).doc;
    expect(findClip(doc, title)!.clip).toEqual(moved.clip);
    expect(findClip(doc, title)!.track.id).toBe(textTrack);
    expect(mainTracks(doc).filter((t) => t.kind === 'text').flatMap((t) => t.clips).map((c) => c.id)).toEqual([title]);
    // the same title moved in time on the track the run placed it on is moved-only: made again at its place
    undoLast(s.pid); undoLast(s.pid);
    hand(s.pid, [{ op: 'move_clip', args: { clipId: title, start: T.frameTime(45, R) } }]);
    const back = await regen(s.pid, s.runId, {});
    expect([back.status, back.body.protected, back.body.movedBack]).toEqual([200, [], ['title']]);
    doc = store.getProject(s.pid).doc;
    expect(findClip(doc, title)).toBeUndefined();
    expect(frames(doc, slotClip(doc, s.runId, 'title'))).toEqual(frames(doc0, title));
    // a picture taken to another track and another time
    const s4b = slotClip(doc, s.runId, 's4');
    expect(s4b).not.toBe(s4);
    hand(s.pid, [{ op: 'move_clip', args: { clipId: s4b, start: T.frameTime(150, R), trackId: videoTrack } }]);
    const before = revision(s.pid);
    const p = await regen(s.pid, s.runId, {});
    expect([p.status, p.body.error.code, p.body.error.details.kept.map((k: { key: string }) => k.key), revision(s.pid)]).toEqual([409, 'template_blocked', ['s4'], before]);
  }, 60_000);

  it('a picture linked to its own sound, moved together by the delete before them: both are made again, linked, one sound under each picture; an edit to the sound keeps the pair', async () => {
    const s = await appliedRun('moved-linked', SOUND_DEF, null);
    const doc0 = store.getProject(s.pid).doc;
    const [c1, c2, c3] = ['clip1', 'clip2', 'clip3'].map((k) => slotClip(doc0, s.runId, k));
    const sound2 = partners(doc0, c2!)[0]!.id, sound3 = partners(doc0, c3!)[0]!.id;
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [c1!] } }]);
    const rippled = store.getProject(s.pid).doc;
    expect([frames(rippled, c2!), frames(rippled, sound2), frames(rippled, c3!), frames(rippled, sound3)]).toEqual([[0, 30], [0, 30], [30, 60], [30, 60]]);
    const r = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([r.status, r.body.protected, r.body.removed, r.body.movedBack]).toEqual([200, [], [], ['clip2', 'clip3']]);
    let doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    for (const id of [c2!, c3!, sound2, sound3]) expect(findClip(doc, id)).toBeUndefined();
    expect(slotFrames(doc, s.runId, ['clip1', 'clip2', 'clip3'])).toEqual([[0, 30], [30, 60], [60, 90]]);
    for (const key of ['clip1', 'clip2', 'clip3']) {
      const c = findClip(doc, slotClip(doc, s.runId, key))!.clip;
      expect([partners(doc, c.id).length, soundsAt(doc, c.start).length, frames(doc, partners(doc, c.id)[0]!.id)], key).toEqual([1, 1, frames(doc, c.id)]);
    }
    expect(pictureCoverage(doc, s.runId).holes).toEqual([]);
    // undo the regeneration; now the sound of clip2 is also made quieter by hand: its link group has another change, so the
    // whole slot is kept (picture and sound), and the kept picture is off its slot
    undoLast(s.pid);
    hand(s.pid, [{ op: 'set_clip_gain', args: { clipId: sound2, gain: 0.5 } }]);
    const before = revision(s.pid);
    const k = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([k.status, k.body.error.code, k.body.error.details.kept.map((x: { key: string }) => x.key), revision(s.pid)]).toEqual([409, 'template_blocked', ['clip2'], before]);
    // only the sound moved (unlinked move of the sound alone is not possible while linked): a sound moved with its picture is named by the picture's key
    doc = store.getProject(s.pid).doc;
    expect(movedOnly(doc, doc.recipeRuns[s.runId]!, [c2!, sound2, c3!, sound3]).sort()).toEqual([c2, c3, sound3].sort());
  }, 60_000);

  it('a title and the music moved along their own tracks, nothing else changed: both are made again at their places and named', async () => {
    const s = await appliedRun('moved-title-music');
    const doc0 = store.getProject(s.pid).doc;
    const title = slotClip(doc0, s.runId, 'title'), mus = slotClip(doc0, s.runId, 'music'), look = slotClip(doc0, s.runId, 'look');
    hand(s.pid, [{ op: 'move_clip', args: { clipId: title, start: T.frameTime(15, R) } }, { op: 'move_clip', args: { clipId: mus, start: T.frameTime(30, R) } }, { op: 'move_clip', args: { clipId: look, start: T.frameTime(10, R) } }]);
    const r = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 11 } });
    expect([r.status, r.body.protected, r.body.movedBack]).toEqual([200, [], ['look', 'music', 'title']]);
    expect(r.body.notices).toEqual([expect.objectContaining({ code: 'moved_back', details: { keys: ['look', 'music', 'title'] } })]);
    const doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    for (const [key, old] of [['title', title], ['music', mus], ['look', look]] as const) {
      expect(findClip(doc, old), key).toBeUndefined();
      expect(frames(doc, slotClip(doc, s.runId, key)), key).toEqual(frames(doc0, old));
    }
    // the music moved AND made quieter is edited by hand: kept where it is (only pictures are held to their slots)
    const mus2 = slotClip(doc, s.runId, 'music');
    hand(s.pid, [{ op: 'move_clip', args: { clipId: mus2, start: T.frameTime(30, R) } }, { op: 'set_clip_gain', args: { clipId: mus2, gain: 0.5 } }]);
    const kept = structuredClone(findClip(store.getProject(s.pid).doc, mus2)!.clip);
    const k = await regen(s.pid, s.runId, {});
    expect([k.status, k.body.protected, k.body.movedBack]).toEqual([200, [mus2], []]);
    expect(findClip(store.getProject(s.pid).doc, mus2)!.clip).toEqual(kept);
  }, 60_000);

  it('a clip taken to another track at its own time is edited by hand (the run recorded its track): kept there, its key not made again, no frame empty and nothing over it; another tempo is then refused; a title likewise is kept', async () => {
    const s = await appliedRun('other-track-same-time');
    const doc0 = store.getProject(s.pid).doc;
    const s3 = slotClip(doc0, s.runId, 's3'), title = slotClip(doc0, s.runId, 'title');
    const own = findClip(doc0, s3)!.track.id;
    const added = hand(s.pid, [{ op: 'add_track', args: { kind: 'video' } }, { op: 'add_track', args: { kind: 'text' } }]);
    const [videoTrack, textTrack] = added.results.map((x) => x.output!.trackId as string);
    hand(s.pid, [{ op: 'move_clip', args: { clipId: s3, start: T.frameTime(60, R), trackId: videoTrack } }, { op: 'move_clip', args: { clipId: title, start: findClip(doc0, title)!.clip.start, trackId: textTrack } }]);
    const held = store.getProject(s.pid).doc;
    // nothing about either clip changed but its track: the fingerprint (which holds no track) still agrees
    expect(findClip(held, s3)!.clip).toEqual(findClip(doc0, s3)!.clip);
    const r = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 6 } });
    expect([r.status, [...r.body.protected].sort(), r.body.movedBack]).toEqual([200, [s3, title].sort(), []]);
    expect(r.body.warnings).toContainEqual(expect.objectContaining({ code: 'kept_by_hand', details: { keys: ['s3', 'title'] } }));
    let doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    expect([findClip(doc, s3)!.clip, findClip(doc, s3)!.track.id, findClip(doc, title)!.track.id]).toEqual([findClip(held, s3)!.clip, videoTrack, textTrack]);
    expect([slotClip(doc, s.runId, 's3'), slotClip(doc, s.runId, 'title')]).toEqual([s3, title]);
    // the picture: the other slots are made again on the run's own track and none of them shares the kept picture's frames, so
    // the kept clip neither covers a slot picture nor is covered by one, and no frame of the run is without a picture
    for (const k of ['s1', 's2', 's4']) expect(findClip(doc, slotClip(doc, s.runId, k))!.track.id, k).toBe(own);
    expect(pictureCoverage(doc, s.runId, [s3])).toMatchObject({ holes: [], covered: [] });
    expect(mainTracks(doc).find((t) => t.id === own)!.clips.filter((c) => T.lt(c.start, T.frameTime(90, R)) && T.lt(T.frameTime(60, R), clipEnd(c)))).toEqual([]);
    // the next regeneration still knows (the kept clip keeps the track the run recorded for it)
    const again = await regen(s.pid, s.runId, {});
    expect([again.status, [...again.body.protected].sort()]).toEqual([200, [s3, title].sort()]);
    // template_blocked can follow like for any kept picture: another tempo re-times its slot
    const before = revision(s.pid);
    const t = await regen(s.pid, s.runId, { params: { tempo: 'half' } });
    expect([t.status, t.body.error.code, t.body.error.details.kept.map((k: { key: string }) => k.key), revision(s.pid)]).toEqual([409, 'template_blocked', ['s3'], before]);
    doc = store.getProject(s.pid).doc;
    expect(findClip(doc, s3)!.track.id).toBe(videoTrack);
  }, 60_000);

  /** A run as a server before run.ranges committed it: the plan's own steps and slots, no recordRanges. */
  function olderRun(name: string, def: TemplateDef, withMusic: boolean) {
    const s = seed(name);
    const plan = planTemplate(store.getProject(s.pid).doc, def, { media: [s.a, s.b, s.c], musicAssetId: withMusic ? s.mus : null });
    expect([plan.assetsNeeded, plan.blocking]).toEqual([[], []]);
    const r = store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, ops: plan.ops, slots: plan.slots } }] });
    const runId = r.results[0]!.output!.runId as string;
    expect(store.getProject(s.pid).doc.recipeRuns[runId]).not.toHaveProperty('ranges');
    return { ...s, runId };
  }

  it('a run made before places were recorded: its places are worked out from its own plan, so after a Delete that closed the gap Shuffle and restoreRemoved work there too (pictures, and a picture with its own sound); exact undo; the new run records its places', async () => {
    const s = olderRun('older-run', OLD_DEF, true);
    const doc0 = store.getProject(s.pid).doc;
    const s2 = slotClip(doc0, s.runId, 's2');
    expect(slotFrames(doc0, s.runId, ['s1', 's2', 's3', 's4'])).toEqual([[0, 30], [30, 60], [60, 90], [90, 120]]);
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2] } }]);
    const rippled = store.getProject(s.pid).doc;
    expect(movedOnly(rippled, rippled.recipeRuns[s.runId]!, rippled.recipeRuns[s.runId]!.createdIds)).toEqual([]); // nothing recorded to compare with
    const sh = await regen(s.pid, s.runId, { params: { order: 'shuffle', seed: 7 } });
    expect([sh.status, sh.body.protected, sh.body.removed, sh.body.movedBack]).toEqual([200, [], ['s2'], ['s3', 's4']]);
    expect(sh.body.notices).toContainEqual(expect.objectContaining({ code: 'moved_back', details: { keys: ['s3', 's4'] } }));
    let doc = store.getProject(s.pid).doc;
    expect(validateProject(doc)).toEqual([]);
    expect(slotFrames(doc, s.runId, ['s1', 's3', 's4'])).toEqual([[0, 30], [60, 90], [90, 120]]);
    expect(Object.keys(doc.recipeRuns[s.runId]!.ranges ?? {}).length).toBeGreaterThan(0);
    undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(rippled));
    expect(store.getProject(s.pid).doc.recipeRuns[s.runId]).not.toHaveProperty('ranges');
    // the button at once, on the older run
    const rs = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([rs.status, rs.body.protected, rs.body.removed, rs.body.movedBack]).toEqual([200, [], [], ['s3', 's4']]);
    doc = store.getProject(s.pid).doc;
    expect(slotFrames(doc, s.runId, ['s1', 's2', 's3', 's4'])).toEqual([[0, 30], [30, 60], [60, 90], [90, 120]]);
    expect(pictureCoverage(doc, s.runId).holes).toEqual([]);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(doc));
    undoLast(s.pid); undoLast(s.pid);
    expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(doc0));
    // a picture with its own sound: the sound's place is its picture's, so the pair is made again together
    const h = olderRun('older-run-sound', SOUND_DEF, false);
    const hd = store.getProject(h.pid).doc;
    const [c1, c2] = ['clip1', 'clip2'].map((k) => slotClip(hd, h.runId, k));
    const sound2 = partners(hd, c2!)[0]!.id;
    hand(h.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [c1!] } }]);
    const hr = await regen(h.pid, h.runId, { restoreRemoved: true });
    expect([hr.status, hr.body.protected, hr.body.movedBack]).toEqual([200, [], ['clip2', 'clip3']]);
    doc = store.getProject(h.pid).doc;
    expect([findClip(doc, c2!), findClip(doc, sound2)]).toEqual([undefined, undefined]);
    expect(slotFrames(doc, h.runId, ['clip1', 'clip2', 'clip3'])).toEqual([[0, 30], [30, 60], [60, 90]]);
    for (const key of ['clip1', 'clip2', 'clip3']) { const c = findClip(doc, slotClip(doc, h.runId, key))!.clip; expect([partners(doc, c.id).length, soundsAt(doc, c.start).length], key).toEqual([1, 1]); }
  }, 60_000);

  it('an older run: what the plan does not place on a named track is not covered (a moved title stays kept, as before); moved and trimmed, or taken to another track, stays kept and refused; a picture taken to another track at its own time is replaced, as before', async () => {
    const s = olderRun('older-run-kept', OLD_DEF, true);
    const doc0 = store.getProject(s.pid).doc;
    const title = slotClip(doc0, s.runId, 'title'), s2 = slotClip(doc0, s.runId, 's2'), s3 = slotClip(doc0, s.runId, 's3'), s4 = slotClip(doc0, s.runId, 's4');
    const videoTrack = hand(s.pid, [{ op: 'add_track', args: { kind: 'video' } }]).results[0]!.output!.trackId as string;
    // the title moved along its own track: an older run cannot tell (add_text chooses the track), so it is kept where it is
    hand(s.pid, [{ op: 'move_clip', args: { clipId: title, start: T.frameTime(15, R) } }]);
    const t = await regen(s.pid, s.runId, {});
    expect([t.status, t.body.protected, t.body.movedBack]).toEqual([200, [title], []]);
    undoLast(s.pid); undoLast(s.pid);
    // a picture taken to another track at its own time: no track was recorded, so it is untouched for this run and replaced
    hand(s.pid, [{ op: 'move_clip', args: { clipId: s4, start: T.frameTime(90, R), trackId: videoTrack } }]);
    const same = await regen(s.pid, s.runId, {});
    expect([same.status, same.body.protected, findClip(store.getProject(s.pid).doc, s4)]).toEqual([200, [], undefined]);
    undoLast(s.pid); undoLast(s.pid);
    // moved by the delete AND trimmed: edited; taken to another track and time: on another track than its plan gives it
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [s2] } }, { op: 'trim_clip', args: { clipId: s3, edge: 'end', to: T.frameTime(50, R) } }, { op: 'move_clip', args: { clipId: s4, start: T.frameTime(150, R), trackId: videoTrack } }]);
    const before = revision(s.pid);
    const r = await regen(s.pid, s.runId, { restoreRemoved: true });
    expect([r.status, r.body.error.code, r.body.error.details.kept.map((k: { key: string }) => k.key), revision(s.pid)]).toEqual([409, 'template_blocked', ['s3', 's4'], before]);
    expect(r.body.error.hint).toBe('Undo the hand edit that moved or trimmed slot(s) s3, s4, or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too.');
  }, 60_000);

  it('an older run whose plan cannot be made as it was (the template changed since): a clip that was only moved still counts as edited, refused as before, and the hint says why; nothing changes', async () => {
    const s = olderRun('older-run-changed', OLD_DEF, true);
    const doc0 = store.getProject(s.pid).doc;
    hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [slotClip(doc0, s.runId, 's2')] } }]);
    const before = revision(s.pid), held = store.getProject(s.pid).doc;
    (OLD_DEF as { version: number }).version = 2; // the catalogue's template is a newer version than the run's
    try {
      const r = await regen(s.pid, s.runId, { restoreRemoved: true });
      expect([r.status, r.body.error.code, r.body.error.details.kept.map((k: { key: string }) => k.key)]).toEqual([409, 'template_blocked', ['s3', 's4']]);
      expect(r.body.error.details.placesUnknown).toBe('the template has changed since (the run is of version 1, the template is version 2 now)');
      expect(r.body.error.hint).toBe('Undo the hand edit that moved or trimmed slot(s) s3, s4, or delete that clip as well and regenerate with restoreRemoved: true again so the template makes it again too. This run was made before places were recorded, and where it placed its clips cannot be worked out again: the template has changed since (the run is of version 1, the template is version 2 now). So a clip that was only moved counts as edited.');
      expect([revision(s.pid), store.getProject(s.pid).doc]).toEqual([before, held]);
      // Shift+Delete (the gap kept) still works on such a run, and from then on the run records its places
      undoLast(s.pid);
      hand(s.pid, [{ op: 'delete_clip', args: { clipId: slotClip(doc0, s.runId, 's2') } }]);
      const ok = await regen(s.pid, s.runId, { restoreRemoved: true });
      expect([ok.status, ok.body.movedBack]).toEqual([200, []]);
      const doc = store.getProject(s.pid).doc;
      hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [slotClip(doc, s.runId, 's2')] } }]);
      const now = await regen(s.pid, s.runId, { restoreRemoved: true });
      expect([now.status, now.body.movedBack]).toEqual([200, ['s3', 's4']]);
    } finally { (OLD_DEF as { version: number }).version = 1; }
  }, 60_000);
});

/**
 * Property (seeded): hand edits among them ripple deletes, then a regeneration. Whatever the edits, a regeneration either adds
 * exactly one valid revision that undo takes back exactly and that replays byte for byte, or refuses and changes nothing; and
 * when the only edits were deletes that close the gap and moves along a clip's own track, it is never refused with
 * template_blocked: nothing but a clip's place changed. PF_PROPERTY_RUNS sets the number of runs (default 40).
 */
describe('regenerate after hand edits, ripple deletes among them (property, seeded)', () => {
  it('one exact, undoable revision or a refusal that changes nothing; only-moved clips never block and are never kept', async () => {
    const tally = { runs: 0, ok: 0, movedBack: 0, blocked: 0, nothing: 0, ripples: 0, pureRuns: 0, olderRuns: 0, olderMovedBack: 0 };
    let project = 0;
    await fc.assert(
      fc.asyncProperty(fc.boolean(), fc.array(fc.tuple(fc.nat(6), fc.nat(20), fc.nat(60)), { minLength: 1, maxLength: 4 }), fc.nat(3), fc.nat(2), async (sound, edits, ask, age) => {
        // one run in three is an older one: committed as a server before run.ranges did, so its places are worked out from its plan
        const older = age === 0;
        const def = sound ? SOUND_DEF : older ? OLD_DEF : TEST_DEF;
        const s = seed(`prop-${project++}`);
        const params = { media: [s.a, s.b, s.c], musicAssetId: sound ? null : s.mus };
        let runId: string;
        if (older) {
          const plan = planTemplate(store.getProject(s.pid).doc, def, params);
          runId = store.commit({ projectId: s.pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: def.id, templateVersion: def.version, params: plan.params, steps: plan.steps, ops: plan.ops, slots: plan.slots } }] }).results[0]!.output!.runId as string;
          tally.olderRuns++;
        } else {
          const applied = await rest('POST', `/projects/${s.pid}/templates/${def.id}/apply`, { params });
          if (applied.status !== 200) throw new Error(`apply ${applied.status}`);
          runId = applied.body.runId as string;
        }
        const other = store.commit({ projectId: s.pid, actor: 'user:owner', ops: [{ op: 'add_track', args: { kind: 'video' } }] }).results[0]!.output!.trackId as string;
        let pure = true; // only deletes that close the gap and moves along a clip's own track so far
        for (const [kind, pick, amount] of edits) {
          const doc = store.getProject(s.pid).doc;
          const live = doc.recipeRuns[runId]!.createdIds.filter((id) => !!findClip(doc, id));
          if (!live.length) break;
          const found = findClip(doc, live[pick % live.length]!)!;
          const clipId = found.clip.id, start = T.nearestFrameIndex(found.clip.start, R);
          const op = [
            { op: 'ripple_delete_clips', args: { clipIds: [clipId] } },
            { op: 'ripple_delete_clips', args: { clipIds: [clipId] } },
            { op: 'move_clip', args: { clipId, start: T.frameTime(start + 1 + amount, R) } },
            { op: 'delete_clip', args: { clipId } },
            { op: 'trim_clip', args: { clipId, edge: 'end', to: T.frameTime(start + 5 + (amount % 20), R) } },
            { op: 'set_clip_transform', args: { clipId, transform: { rotation: 1 + amount } } },
            { op: 'move_clip', args: { clipId, start: T.frameTime(start + amount, R), trackId: other } },
          ][kind]!;
          try {
            store.commit({ projectId: s.pid, actor: 'user:owner', ops: [op] });
            if (kind < 2) tally.ripples++;
            if (kind > 2) pure = false;
          } catch (e) { if (!(e instanceof ApiError)) throw e; }
        }
        const held = store.getProject(s.pid).doc, before = revision(s.pid), rows = txRows(s.pid);
        const run = held.recipeRuns[runId]!;
        const live = run.createdIds.filter((id) => !!findClip(held, id));
        const onlyMoved = movedOnly(held, run, live);
        const body = [{ params: { order: 'shuffle', seed: 5 } }, { restoreRemoved: true }, {}, { restoreRemoved: true, params: { order: 'shuffle', seed: 8 } }][ask]!;
        const r = await rest('POST', `/projects/${s.pid}/template-runs/${runId}/regenerate`, body);
        tally.runs++;
        if (pure) tally.pureRuns++;
        if (r.status !== 200) {
          if (r.status !== 409 || !['template_blocked', 'nothing_to_do'].includes(r.body.error.code)) throw new Error(`unexpected refusal ${r.status} ${JSON.stringify(r.body.error)}`);
          if (revision(s.pid) !== before || txRows(s.pid) !== rows || JSON.stringify(store.getProject(s.pid).doc) !== JSON.stringify(held)) throw new Error('a refusal changed the project');
          if (r.body.error.code === 'template_blocked') {
            tally.blocked++;
            if (pure) throw new Error(`blocked although nothing but places changed: ${r.body.error.message}`);
            // the hint never proposes the request just refused: a restore request is told to delete that clip as well first
            if (typeof r.body.error.hint !== 'string' || (body.restoreRemoved && !/delete that clip as well and regenerate with restoreRemoved: true again/.test(r.body.error.hint)) || /places were recorded/.test(r.body.error.hint)) throw new Error(`the hint repeats the request: ${r.body.error.hint}`);
          } else tally.nothing++;
          return true;
        }
        tally.ok++;
        const doc = store.getProject(s.pid).doc;
        if (revision(s.pid) !== before + 1 || txRows(s.pid) !== rows + 1) throw new Error('not exactly one revision');
        if (validateProject(doc).length) throw new Error(`invalid project: ${JSON.stringify(validateProject(doc))}`);
        // kept clips are byte for byte what they were; a clip that was only moved is kept only as the link partner of an edited one
        for (const id of r.body.protected as string[]) if (JSON.stringify(findClip(doc, id)?.clip) !== JSON.stringify(findClip(held, id)!.clip)) throw new Error(`kept clip ${id} changed`);
        const group = (id: string) => { const c = findClip(held, id)!.clip; return c.type === 'media' ? c.linkGroupId : null; };
        for (const id of onlyMoved) {
          const kept = (r.body.protected as string[]).includes(id);
          if (kept && !(r.body.protected as string[]).some((x) => x !== id && !onlyMoved.includes(x) && !!group(id) && group(x) === group(id))) throw new Error(`only-moved clip ${id} was kept on its own`);
          if (!kept && findClip(doc, id)) throw new Error(`only-moved clip ${id} was neither kept nor replaced`);
        }
        if ((r.body.movedBack as string[]).length) { tally.movedBack++; if (older) tally.olderMovedBack++; }
        if ((r.body.movedBack as string[]).length !== ((r.body.notices as { code: string; details: { keys: string[] } }[]).find((x) => x.code === 'moved_back')?.details.keys.length ?? 0)) throw new Error('movedBack and the notice disagree');
        if (JSON.stringify(store.replay(s.pid, revision(s.pid)).doc) !== JSON.stringify(doc)) throw new Error('replay differs');
        const row = store.db.prepare("SELECT actor FROM transactions WHERE project_id = ? AND kind = 'edit' AND undone_by IS NULL ORDER BY revision DESC LIMIT 1").get(s.pid) as { actor: string };
        store.undo(s.pid, row.actor, 'undo');
        if (creativeProjection(store.getProject(s.pid).doc) !== creativeProjection(held)) throw new Error('undo of the regeneration is not exact');
        return true;
      }),
      { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 40), seed: Number(process.env.PF_PROPERTY_SEED ?? 20261124) },
    );
    console.log(`regenerate after hand edits (property): ${JSON.stringify(tally)}`);
    // the property met what it is about: ripple deletes, regenerations that put moved clips back, and runs with nothing but places changed
    expect(tally.ripples).toBeGreaterThan(5);
    expect(tally.movedBack).toBeGreaterThan(3);
    expect(tally.pureRuns).toBeGreaterThan(3);
    expect(tally.olderMovedBack).toBeGreaterThan(0);
    expect(tally.ok + tally.blocked + tally.nothing).toBe(tally.runs);
  }, 600_000);
});
