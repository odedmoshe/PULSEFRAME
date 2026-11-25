/**
 * The story on the server (W2; apps/server/src/story.ts): the waveform peaks reader (origin, wait, states), the context, plan /
 * apply / regenerate through the recipe routes with the film's permission checks, the retap refusal, the blocked state, the
 * planner's refusals as API errors, and that nothing about the voice is stored.
 *
 * planStory and voiceActivity are the real ones (W1 merged); the mock below only counts calls and lets a test change one plan.
 * (Integration removed the labelled doubles and the rows that ran only while W1 was not built.)
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import type { Asset, StoryPlan, VoiceMeasure } from '@pulseframe/core';

const doubles = vi.hoisted(() => ({ planCalls: 0, voiceCalls: [] as { buckets: number; totalSamples: number }[], nextPlan: null as null | ((p: StoryPlan) => StoryPlan) }));
vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  const voiceActivity: typeof real.voiceActivity = (peaks, totalSamples) => {
    doubles.voiceCalls.push({ buckets: peaks.length / 2, totalSamples });
    return real.voiceActivity(peaks, totalSamples);
  };
  const planStory: typeof real.planStory = (doc, params, ctx) => {
    doubles.planCalls++;
    const plan = real.planStory(doc, params, ctx);
    const f = doubles.nextPlan; doubles.nextPlan = null;
    return f ? f(plan) : plan;
  };
  return { ...real, voiceActivity, planStory };
});

import { STORY_RUN_RECIPE_ID, STORY_TEMPLATE_ID, STORY_BLOCKING_TEXT } from '@pulseframe/core';
import { NARRATION_BURSTS, storyFixtureArgs } from '../../../packages/evals/src/story-fixtures.ts';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { describeMedia } from './ingest.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { Store } from './store.ts';
import { readVoicePeaks, STORY_API_ERRORS, STORY_SERVER_BUILT, storyContext } from './story.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
let n = 1;
const fakeHash = () => `sha256:${(n++).toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00.000Z', importedBy: 'test' };
const still = (name: string): Omit<Asset, 'id'> => ({ kind: 'image', name, contentHash: fakeHash(), byteSize: 1000, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov } as Omit<Asset, 'id'>);

let dir: string, fx: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t: string | null) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: t ? headers(t) : { host: `127.0.0.1:${cfg.port}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any };
};
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;
const editor = () => grant({ mode: 'edit' });
const revision = (pid: string) => store.getProject(pid).revision;
const docHash = (pid: string) => createHash('sha256').update(JSON.stringify(store.getProject(pid).doc)).digest('hex');
const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });

async function importFile(pid: string, file: string): Promise<string> {
  const meta = await describeMedia(file);
  const contentHash = sha(file), copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
  fs.copyFileSync(file, copy);
  store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
  const asset = { ...meta, name: path.basename(file), contentHash, byteSize: fs.statSync(file).size, provenance: prov };
  const id = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  derivatives.ensure(store.getProject(pid).doc.assets[id]!);
  return id;
}
const newProject = (name: string) => store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
function stills(pid: string, k: number): string[] {
  const r = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: Array.from({ length: k }, (_, i) => ({ op: 'import_asset', args: { asset: still(`p${i}.png`) } })) });
  return r.results.map((x) => x.output!.assetId as string);
}
let narrationWav = '', lateTs = '';
async function storyProject(name: string, pictures = 4) {
  const pid = newProject(name);
  const narration = await importFile(pid, narrationWav);
  const ids = stills(pid, pictures);
  await derivatives.idle();
  return { pid, narration, ids };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-story-'));
  fx = path.join(dir, 'fx');
  fs.mkdirSync(fx);
  narrationWav = path.join(fx, 'narration.wav');
  execFileSync('ffmpeg', storyFixtureArgs('narration.wav', narrationWav, fx), { stdio: ['ignore', 'ignore', 'pipe'] });
  // the same narration in MPEG-TS, whose own start is about 1.4 s: the waveform must still begin at the file's time zero
  lateTs = path.join(fx, 'late.ts');
  ff(['-i', narrationWav, '-c:a', 'aac', '-b:a', '96k', '-f', 'mpegts', lateTs]);
  cfg = { ...loadConfig({}), dataDir: dir, port: 9, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  gov = new Governance(store);
  auth.resolveGrant = (t) => gov.principalForToken(t);
  const speech = new Speech(store, cfg);
  mcp = createMcp(store, auth, exporter, capabilities, new Presence(), gov, speech, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, new Presence(), mcp, gov, undefined, speech);
}, 60_000);
afterAll(async () => {
  (app as any)?.browserExport?.stop();
  await mcp?.close();
  await capabilities?.stop();
  await derivatives?.stop();
  store?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the narration\'s waveform peaks (story.ts readVoicePeaks)', () => {
  it('reads level 0 of a ready waveform: 256-sample buckets from the file\'s time zero, the bursts where the fixture puts them', async () => {
    const s = await storyProject('peaks', 1);
    const r = await readVoicePeaks(store, store.getProject(s.pid).doc.assets[s.narration]);
    if (r.state !== 'ready') throw new Error(`not ready: ${JSON.stringify(r)}`);
    expect(r.totalSamples).toBe(24 * 48000);
    expect(r.peaks.length).toBe(2 * Math.ceil(24 * 48000 / 256));
    const level = (k: number) => Math.max(-r.peaks[2 * k]!, r.peaks[2 * k + 1]!);
    // each burst (0.25 × two tones ≈ −6 dBFS) is loud in its middle; the pauses hold the −60 dBFS noise only
    for (const [a, b] of NARRATION_BURSTS) expect(level(Math.floor(((a + b) / 2) * 48000 / 256))).toBeGreaterThan(8000);
    for (const t of [0.2, 3.7, 7.6, 14.0]) expect(level(Math.floor(t * 48000 / 256))).toBeLessThan(200);
    // the first loud bucket is the one holding 0.5 s (bucket 93: samples 23808..24063 hold sample 24000)
    let first = 0; while (level(first) < 2000) first++;
    expect(first).toBe(Math.floor(0.5 * 48000 / 256));
  });
  it('follows the waveform\'s origin: an MPEG-TS copy whose own start is about 1.4 s has its first burst at the same source time', async () => {
    const pid = newProject('origin');
    const id = await importFile(pid, lateTs);
    await derivatives.idle();
    const asset = store.getProject(pid).doc.assets[id]!;
    expect(asset.timeOrigin && T.toSeconds(asset.timeOrigin)).toBeGreaterThan(1);
    const r = await readVoicePeaks(store, asset);
    if (r.state !== 'ready') throw new Error(`not ready: ${JSON.stringify(r)}`);
    const level = (k: number) => Math.max(-r.peaks[2 * k]!, r.peaks[2 * k + 1]!);
    let first = 0; while (level(first) < 2000) first++;
    // AAC adds at most a frame of priming either way: within 1024 samples (4 buckets) of 0.5 s, never shifted by the 1.4 s origin
    expect(Math.abs(first * 256 - 24000)).toBeLessThanOrEqual(1024 + 256);
  });
  it('states: no sound track and a missing file are no_sound at once; a missing or failed row is pending at once', async () => {
    const t0 = Date.now();
    expect((await readVoicePeaks(store, undefined)).state).toBe('no_sound');
    expect((await readVoicePeaks(store, { contentHash: fakeHash(), audio: undefined })).state).toBe('no_sound');
    expect((await readVoicePeaks(store, { contentHash: fakeHash(), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } })).state).toBe('pending');
    const failed = fakeHash();
    store.db.prepare("INSERT INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'failed', ?)").run(failed, new Date().toISOString());
    expect((await readVoicePeaks(store, { contentHash: failed, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } })).state).toBe('pending');
    const na = fakeHash();
    store.db.prepare("INSERT INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'not-applicable', ?)").run(na, new Date().toISOString());
    expect((await readVoicePeaks(store, { contentHash: na, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } })).state).toBe('no_sound');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  it('a row held queued is waited for at most the given time, then pending; one that turns ready while waiting is read', async () => {
    const held = fakeHash();
    store.db.prepare("INSERT INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'queued', ?)").run(held, new Date().toISOString());
    const t0 = Date.now();
    const r = await readVoicePeaks(store, { contentHash: held, audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' } }, 400);
    const took = Date.now() - t0;
    expect(r.state).toBe('pending');
    expect(took).toBeGreaterThanOrEqual(390);
    expect(took).toBeLessThan(1500);
  });
});

describe('plan, apply and regenerate through the recipe routes', () => {
  it('is built', () => expect(STORY_SERVER_BUILT).toBe(true));
  it('plan answers the view: no ops, the revision, the label, and the context it planned with (the voice measured from the peaks)', async () => {
    const s = await storyProject('plan');
    doubles.voiceCalls.length = 0;
    const before = docHash(s.pid);
    const r = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: s.narration, assetIds: s.ids, cutsMs: [4500, 8200, 15000] } }, editor());
    expect(r.status).toBe(200);
    expect(r.body.ops).toBeUndefined();
    expect(r.body.slots).toBeUndefined();
    expect(r.body.revision).toBe(revision(s.pid));
    expect(r.body.label.he).toMatch(/טיוטה/);
    expect(r.body.context.voiceState).toBe('measured');
    expect(r.body.context.voice.algo).toBe(1);
    expect(doubles.voiceCalls).toEqual([{ buckets: Math.ceil(24 * 48000 / 256), totalSamples: 24 * 48000 }]);
    expect(r.body.context.voice.ranges.length).toBe(4); // the real rule joins the 0.3 s pause (S1)
    expect(Object.keys(r.body.context.capture).sort()).toEqual([...s.ids].sort());
    expect(docHash(s.pid)).toBe(before);
    // an observe-only grant and a propose-mode agent may plan
    for (const t of [grant({ mode: 'observe' }), grant({ mode: 'propose' })]) {
      const o = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: s.narration, assetIds: s.ids } }, t);
      expect(o.status).toBe(200);
    }
  });
  it('plan waits at most STORY.waitWaveformMs for a waveform held back, then answers voice_pending within 6 s', async () => {
    const pid = newProject('pending');
    const held = fakeHash();
    const r0 = store.commit({ projectId: pid, actor: 'user:owner', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'audio', name: 'held.wav', contentHash: held, byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(24, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov } } }] });
    const narration = r0.results[0]!.output!.assetId as string;
    store.db.prepare("INSERT INTO derivatives (asset_hash, kind, status, updated_at) VALUES (?, 'waveform', 'running', ?)").run(held, new Date().toISOString());
    const ids = stills(pid, 3);
    const t0 = Date.now();
    const r = await rest('POST', `/projects/${pid}/recipes/story/plan`, { params: { narrationAssetId: narration, assetIds: ids } }, editor());
    const took = Date.now() - t0;
    expect(r.status).toBe(200);
    expect(r.body.context.voiceState).toBe('pending');
    expect(r.body.context.voice).toBeNull();
    expect(r.body.warnings.map((w: { code: string }) => w.code)).toContain('voice_pending');
    expect(took).toBeGreaterThanOrEqual(4900);
    expect(took).toBeLessThan(6000);
  }, 15_000);
  it('apply commits ONE revision with one apply_template run; one undo returns the exact document; the recording stays; nothing about the voice is stored', async () => {
    const s = await storyProject('apply');
    const hashBefore = docHash(s.pid), rev = revision(s.pid);
    const rowsBefore = store.db.prepare('SELECT kind, status FROM derivatives WHERE asset_hash = ? ORDER BY kind').all(store.getProject(s.pid).doc.assets[s.narration]!.contentHash);
    const t = editor(), actor = gov.principalForToken(t)!.actor;
    const r = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids, cutsMs: [4500, 8200, 15000] } }, t);
    expect(r.status).toBe(200);
    expect(r.body.revision).toBe(rev + 1);
    expect(revision(s.pid)).toBe(rev + 1);
    expect(r.body.chips.length).toBe(3);
    expect(r.body.predicted.cuts.length).toBe(3);
    const doc = store.getProject(s.pid).doc;
    const run = doc.recipeRuns[r.body.runId]!;
    expect(run.recipeId).toBe(STORY_RUN_RECIPE_ID);
    expect((run.params.picked as unknown[]).length).toBe(4);
    expect(run.params.templateVersion).toBe(1);
    const text = JSON.stringify(doc);
    for (const word of ['noiseDb10', 'voiceDb10', '"flat"', 'voiceState', 'onsetsMs']) expect({ word, stored: text.includes(word) }).toEqual({ word, stored: false });
    expect(store.db.prepare('SELECT kind, status FROM derivatives WHERE asset_hash = ? ORDER BY kind').all(doc.assets[s.narration]!.contentHash)).toEqual(rowsBefore);
    const hashApplied = docHash(s.pid);
    store.undo(s.pid, actor, 'undo');
    expect(docHash(s.pid)).toBe(hashBefore);
    expect(store.getProject(s.pid).doc.assets[s.narration]).toBeDefined();
    store.undo(s.pid, actor, 'redo');
    expect(docHash(s.pid)).toBe(hashApplied);
    expect(STORY_TEMPLATE_ID).toBe('tpl.story');
  });
  it('apply against a stale expectedRevision is refused 409 and changes nothing', async () => {
    const s = await storyProject('stale');
    const before = docHash(s.pid);
    const r = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids }, expectedRevision: revision(s.pid) - 1 }, editor());
    expect(r.status).toBe(409);
    expect(docHash(s.pid)).toBe(before);
  });
  it('a plan with blocking lines is shown by plan and refused by apply (409 story_blocked); nothing changes', async () => {
    const s = await storyProject('blocked');
    const block = (p: StoryPlan): StoryPlan => ({ ...p, blocking: [{ code: 'narration_removed', message: STORY_BLOCKING_TEXT.narration_removed, details: {} }] });
    doubles.nextPlan = block;
    const pv = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: s.narration, assetIds: s.ids } }, editor());
    expect(pv.status).toBe(200);
    expect(pv.body.note).toMatch(/cannot be applied/);
    const before = docHash(s.pid);
    doubles.nextPlan = block;
    const r = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids } }, editor());
    expect([r.status, r.body.error.code]).toEqual([409, 'story_blocked']);
    expect(r.body.error.message).toBe(STORY_API_ERRORS.blocked(STORY_BLOCKING_TEXT.narration_removed, []).message);
    expect(docHash(s.pid)).toBe(before);
  });
  it('the planner\'s refusals answer as API errors: a missing narration 404, a narration that is not sound 422, bad params 400', async () => {
    const s = await storyProject('refusals');
    const t = editor();
    const missing = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: 'ast_nope', assetIds: s.ids } }, t);
    expect([missing.status, missing.body.error.code]).toEqual([404, 'not_found']);
    const notSound = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: s.ids[0], assetIds: s.ids } }, t);
    expect([notSound.status, notSound.body.error.code]).toEqual([422, 'incompatible']);
    const bad = await rest('POST', `/projects/${s.pid}/recipes/story/plan`, { params: { narrationAssetId: s.narration, assetIds: [] } }, t);
    expect([bad.status, bad.body.error.code]).toEqual([400, 'invalid_request']);
  });
  it('permissions: propose, a track-limited grant, an agent asking an {age:…} title and no credential are refused apply; nothing changes', async () => {
    const s = await storyProject('perm');
    const body = { params: { narrationAssetId: s.narration, assetIds: s.ids } };
    const before = docHash(s.pid);
    const pr = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, body, grant({ mode: 'propose' }));
    expect([pr.status, pr.body.error.code]).toEqual([403, 'insufficient_scope']);
    const lim = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, body, grant({ mode: 'edit', trackIds: ['trk_none'] }));
    expect([lim.status, lim.body.error.code]).toEqual([403, 'out_of_scope']);
    const ages = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { ...body.params, openingText: 'גיל {age:p1}' } }, auth.tokens.agent);
    expect([ages.status, ages.body.error.code]).toEqual([403, 'people_scope_required']);
    const none = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, body, null);
    expect(none.status).toBe(401);
    expect(docHash(s.pid)).toBe(before);
  });
  it('a regeneration with other cutsMs answers 409 story_retap_not_built and changes nothing (both regenerate routes)', async () => {
    const s = await storyProject('retap');
    const a = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids, cutsMs: [4500, 8200] } }, editor());
    expect(a.status).toBe(200);
    const before = docHash(s.pid);
    for (const p of [`/projects/${s.pid}/recipe-runs/${a.body.runId}/regenerate`, `/projects/${s.pid}/template-runs/${a.body.runId}/regenerate`]) {
      const r = await rest('POST', p, { params: { cutsMs: [4500, 9000] } }, editor());
      expect([p, r.status, r.body.error?.code]).toEqual([p, 409, 'story_retap_not_built']);
      // more taps is other taps too
      const more = await rest('POST', p, { params: { cutsMs: [4500, 8200, 15000] } }, editor());
      expect([p, more.status, more.body.error?.code]).toEqual([p, 409, 'story_retap_not_built']);
    }
    expect(docHash(s.pid)).toBe(before);
    // the same taps in another order are the same request: not refused as a retap (built or not)
    const same = await rest('POST', `/projects/${s.pid}/recipe-runs/${a.body.runId}/regenerate`, { params: { cutsMs: [8200, 4500, 4500], ownSound: 'mute' } }, editor());
    expect(same.body?.error?.code).not.toBe('story_retap_not_built');
    expect(same.status).toBe(200);
  });
  it('a regeneration of a run that is not a story, or of no run, answers 404; propose mode 403; params not an object 400', async () => {
    const s = await storyProject('regen-refusals');
    const nf = await rest('POST', `/projects/${s.pid}/recipe-runs/run_nope/regenerate`, {}, editor());
    expect(nf.status).toBe(404);
    const a = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids } }, editor());
    const pr = await rest('POST', `/projects/${s.pid}/recipe-runs/${a.body.runId}/regenerate`, {}, grant({ mode: 'propose' }));
    expect([pr.status, pr.body.error.code]).toEqual([403, 'insufficient_scope']);
    const store0 = await import('./story.ts');
    await expect(store0.regenerateStoryFor(store, gov, USER, s.pid, a.body.runId, 'x')).rejects.toMatchObject({ status: 400, code: 'invalid_request' });
    await expect(store0.regenerateStoryFor(store, gov, USER, s.pid, 'run_nope', {})).rejects.toMatchObject({ status: 404 });
  });
  it('regenerate with other music keeps the taps, commits one revision and one undo returns the document; nothing about the voice is stored', async () => {
    const s = await storyProject('regen');
    const t = editor(), actor = gov.principalForToken(t)!.actor;
    const rows = () => store.db.prepare('SELECT * FROM derivatives ORDER BY asset_hash, kind').all();
    const rowsBefore = rows();
    const a = await rest('POST', `/projects/${s.pid}/recipes/story/apply`, { params: { narrationAssetId: s.narration, assetIds: s.ids, cutsMs: [4500, 8200, 15000] } }, t);
    expect(a.status).toBe(200);
    const before = docHash(s.pid), rev = revision(s.pid);
    const r = await rest('POST', `/projects/${s.pid}/recipe-runs/${a.body.runId}/regenerate`, { params: { ownSound: 'mute' }, expectedRevision: rev }, t);
    expect(r.status).toBe(200);
    expect(revision(s.pid)).toBe(rev + 1);
    // integration (privacy evidence): a rebuild measures the voice again in memory and stores none of it, in the document or in any derivative row
    const text = JSON.stringify(store.getProject(s.pid).doc);
    for (const word of ['noiseDb10', 'voiceDb10', '"flat"', 'voiceState', 'onsetsMs']) expect({ word, stored: text.includes(word) }).toEqual({ word, stored: false });
    expect(rows()).toEqual(rowsBefore);
    expect(r.body.predicted.cuts).toEqual(a.body.predicted.cuts);
    store.undo(s.pid, actor, 'undo');
    expect(docHash(s.pid)).toBe(before);
  });
  it('storyContext reads the capture times and the title from the document after the wait', async () => {
    const s = await storyProject('ctx', 2);
    const { p, context } = await storyContext(store, s.pid, { narrationAssetId: s.narration, assetIds: s.ids, openingText: 'הסיפור שלנו' });
    expect(p.revision).toBe(revision(s.pid));
    expect(context.title).toEqual({ text: 'הסיפור שלנו', live: false, resolved: null });
    expect(context.voiceState).toBe('measured');
    const none = await storyContext(store, s.pid, { narrationAssetId: s.narration, assetIds: s.ids, openingTitle: false });
    expect(none.context.title).toBeNull();
  });
});
