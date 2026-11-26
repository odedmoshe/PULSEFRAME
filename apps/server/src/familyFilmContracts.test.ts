/**
 * Lead contracts of the family film on the server (ADR-0026): the derivative kind 'moments' and Derivatives.put, the routes and
 * tools the lead wired (POST /projects/:id/moments, measure_moments, the cancel branch, the recipe routes' dispatch of
 * 'family-film' and of film runs), the refusals that come BEFORE any planning or measuring (permission, propose mode, limited
 * grants, an age field from a credential without the people scope) and the planner's context built from the life line.
 * What the planner and the measurement do is W1's and W2's; nothing here pins their stubs (their success paths are todo).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { creativeProjection, FAMILY_FILM_RUN_RECIPE_ID, FAMILY_FILM_TEMPLATE_ID, FAMILY_FILM_VERSION, filmRunRecordParams, findClip, MOMENTS_JOB_TYPE, planFamilyFilm, validateProject, type Asset } from '@pulseframe/core';
import { Auth } from './auth.ts';
import { Capabilities } from './capabilities.ts';
import { loadConfig, type Config } from './config.ts';
import { Derivatives } from './derive.ts';
import { Exporter } from './export.ts';
import { applyFamilyFilmFor, filmContext, filmRegeneration, filmRunTracks, holdsAgeField, planFamilyFilmFor, refuseAgesInPlan, regenerateFamilyFilmFor } from './familyFilm.ts';
import { Governance, type Principal } from './governance.ts';
import { createApp } from './http.ts';
import { createMcp } from './mcp.ts';
import { Presence } from './presence.ts';
import { Speech } from './speech.ts';
import { ApiError, Store } from './store.ts';

const USER: Principal = { actor: 'user:local', kind: 'user', scopes: ['observe', 'edit'] };
const R = { num: 30, den: 1 };
let n = 1;
const hash = () => `sha256:${(n++).toString(16).padStart(64, '0')}`;
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00.000Z', importedBy: 'test' };
const video = (name: string, capture?: string): Omit<Asset, 'id'> => ({ kind: 'video', name, contentHash: hash(), byteSize: 1000, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(10, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 300 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov, ...(capture ? { capture: { at: capture, utcOffsetMinutes: null, source: 'manual' } } : {}) } as Omit<Asset, 'id'>);

let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
const headers = (t: string) => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${t}`, 'content-type': 'application/json' });
const rest = async (method: string, p: string, body: unknown, t: string) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(t), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  const text = await r.text();
  return { status: r.status, body: (text ? JSON.parse(text) : null) as any, raw: text };
};
let rpc = 0;
const tool = async (name: string, args: Record<string, unknown>, t: string) => {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: { ...headers(t), accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpc, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  if (msg.error) throw new Error(`MCP protocol error: ${JSON.stringify(msg.error)}`);
  return { isError: msg.result.isError === true, body: JSON.parse(msg.result.content[0].text) as any };
};
const grant = (input: Record<string, unknown>) => gov.createGrant({ name: `g${n++}`, ...input }, USER).token;
const revision = (pid: string) => store.getProject(pid).revision;

function seed(name: string, captures: (string | undefined)[] = ['2026-12-05T18:00:00', '2026-12-05T18:10:00']) {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R }).doc.id;
  const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: captures.map((c, i) => ({ op: 'import_asset', args: { asset: video(`v${i}.mp4`, c) } })) });
  return { pid, ids: r.results.map((x) => x.output!.assetId as string) };
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-film-contracts-'));
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
});
afterAll(async () => {
  (app as any).browserExport?.stop();
  await mcp.close();
  await capabilities.stop();
  await derivatives.stop();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the moments derivative', () => {
  it('put() stores a file as a ready row of kind moments, served by the derivative route; the queue\'s kinds are refused', async () => {
    const s = seed('deriv');
    const asset = store.getProject(s.pid).doc.assets[s.ids[0]!]!;
    const tmp = path.join(store.tmpDir, `mo_${n++}.json`);
    fs.writeFileSync(tmp, JSON.stringify({ algo: 1 }));
    const row = await derivatives.put(asset.contentHash, 'moments', tmp, 'application/json', { algo: 1, picture: 'proxy', sound: true, samples: 50, hops: 100, truncated: false });
    expect(row).toMatchObject({ kind: 'moments', status: 'ready', mimeType: 'application/json', meta: { algo: 1, sound: true } });
    expect(fs.existsSync(tmp)).toBe(false);
    const got = await rest('GET', `/projects/${s.pid}/assets/${asset.id}/derivatives/moments`, undefined, auth.tokens.agent);
    expect(got.status).toBe(200);
    expect(JSON.parse(got.raw)).toEqual({ algo: 1 });
    fs.writeFileSync(tmp, 'x');
    await expect(derivatives.put(asset.contentHash, 'proxy', tmp, 'video/mp4', {})).rejects.toThrow(/made by the queue/);
    // importing never queues it: a fresh file gets the three queued kinds only, and ensure() leaves the stored moments row as it is
    const other = store.getProject(s.pid).doc.assets[s.ids[1]!]!;
    expect(derivatives.ensure(other).map((r) => r.kind).sort()).toEqual(['proxy', 'thumbnails', 'waveform']);
    derivatives.ensure(asset);
    expect(derivatives.get(asset.contentHash, 'moments')?.status).toBe('ready');
  });
});

describe('measuring moments: route, tool and cancel (wired by the lead)', () => {
  it('refuses an observe-only credential and a track-limited grant before anything runs; a bad body is 400', async () => {
    const s = seed('mo-perm');
    const before = revision(s.pid);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids }, auth.tokens.observer)).status).toBe(403);
    const limited = grant({ mode: 'edit', trackIds: ['trk_none'] });
    const r = await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids }, limited);
    expect([r.status, r.body.error?.code]).toEqual([403, 'out_of_scope']);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: [] }, auth.tokens.agent)).status).toBe(400);
    expect((await rest('POST', `/projects/${s.pid}/moments`, { assetIds: s.ids, extra: 1 }, auth.tokens.agent)).status).toBe(400);
    const t = await tool('measure_moments', { projectId: s.pid, assetIds: s.ids }, limited);
    expect(t.isError).toBe(true);
    expect(revision(s.pid)).toBe(before);
    expect(store.openJobs(MOMENTS_JOB_TYPE)).toEqual([]);
  });
  it('cancel_job and POST /jobs/:id/cancel reach a moments job', async () => {
    const s = seed('mo-cancel');
    const a = store.createJob(s.pid, MOMENTS_JOB_TYPE, 'agent:local', { assetIds: s.ids, projectRevision: revision(s.pid) });
    const r = await rest('POST', `/jobs/${a.id}/cancel`, undefined, auth.tokens.agent);
    expect(r.status).toBe(200);
    expect(store.getJob(a.id).status).toBe('canceled');
    const b = store.createJob(s.pid, MOMENTS_JOB_TYPE, 'agent:local', { assetIds: s.ids, projectRevision: revision(s.pid) });
    const t = await tool('cancel_job', { jobId: b.id }, auth.tokens.agent);
    expect(t.isError).toBe(false);
    expect(store.getJob(b.id).status).toBe('canceled');
  });
  it.todo('W2: a measurement runs as a durable job and attaches one revision (moments.test.ts)');
});

describe('the family film through the recipe routes and tools', () => {
  const params = (ids: string[], extra: Record<string, unknown> = {}) => ({ params: { assetIds: ids, ...extra } });
  it('refuses a propose-mode agent and a limited grant at apply (REST and MCP) before planning; nothing changes', async () => {
    const s = seed('ff-perm');
    const before = revision(s.pid);
    const propose = grant({ mode: 'propose' });
    const pr = await rest('POST', `/projects/${s.pid}/recipes/family-film/apply`, params(s.ids), propose);
    expect([pr.status, pr.body.error?.code]).toEqual([403, 'insufficient_scope']);
    expect(pr.body.error.message).toMatch(/a family film cannot be proposed/);
    const limited = grant({ mode: 'edit', trackIds: ['trk_none'] });
    const lr = await rest('POST', `/projects/${s.pid}/recipes/family-film/apply`, params(s.ids), limited);
    expect([lr.status, lr.body.error?.code]).toEqual([403, 'out_of_scope']);
    const pt = await tool('apply_recipe', { projectId: s.pid, recipeId: 'family-film', params: params(s.ids).params }, propose);
    expect(pt.isError).toBe(true);
    expect(revision(s.pid)).toBe(before);
  });
  it('an agent without the people scope cannot plan, apply or regenerate a film whose title shows an age; {name:…} is not refused for that reason', async () => {
    const s = seed('ff-ages');
    for (const [route, body] of [['plan', params(s.ids, { openingText: 'גיל {age:p1}' })], ['apply', params(s.ids, { closingText: '{age:p1:words}' })]] as const) {
      const r = await rest('POST', `/projects/${s.pid}/recipes/family-film/${route}`, body, auth.tokens.agent);
      expect([route, r.status, r.body.error?.code]).toEqual([route, 403, 'people_scope_required']);
    }
    const t = await tool('plan_recipe', { projectId: s.pid, recipeId: 'family-film', params: { assetIds: s.ids, openingText: '{age:p1}' } }, auth.tokens.agent);
    expect(t.isError).toBe(true);
    expect(JSON.stringify(t.body)).toMatch(/people_scope_required/);
    const named = await rest('POST', `/projects/${s.pid}/recipes/family-film/plan`, params(s.ids, { openingText: 'יום ההולדת של {name:p1}' }), auth.tokens.agent);
    expect(named.body?.error?.code).not.toBe('people_scope_required');
    expect(holdsAgeField('{age:p1}')).toBe(true);
    expect(holdsAgeField('{{age:p1}}')).toBe(false);
    expect(holdsAgeField('{name:p1} {hebrewDate}')).toBe(false);
  });
  it('a film run is regenerated by the film path, through the recipe route and the template route', async () => {
    const s = seed('ff-run');
    const r = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params: { assetIds: s.ids, picked: [] }, steps: ['A title'], ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.rt(2, 1) }, bind: 'title' }], slots: [{ key: 'title', kind: 'text', clipId: { $ref: 'title' } }] } }] });
    const runId = r.results[0]!.output!.runId as string;
    expect(store.getProject(s.pid).doc.recipeRuns[runId]!.recipeId).toBe(FAMILY_FILM_RUN_RECIPE_ID);
    const propose = grant({ mode: 'propose' });
    for (const p of [`/projects/${s.pid}/recipe-runs/${runId}/regenerate`, `/projects/${s.pid}/template-runs/${runId}/regenerate`]) {
      const x = await rest('POST', p, { params: { targetSeconds: 30 } }, propose);
      expect([p, x.status, x.body.error?.code]).toEqual([p, 403, 'insufficient_scope']);
    }
    const bad = await rest('POST', `/projects/${s.pid}/recipe-runs/${runId}/regenerate`, { params: { openingText: '{age:p1}' } }, auth.tokens.agent);
    expect([bad.status, bad.body.error?.code]).toEqual([403, 'people_scope_required']);
    expect((await rest('POST', `/projects/${s.pid}/recipe-runs/run_none/regenerate`, {}, auth.tokens.agent)).status).toBe(404);
  });
  it('plans, applies as one revision and regenerates end to end; a reused empty A1 stays the film\'s own-sound track and keeps a gain set by hand', async () => {
    const s = seed('ff-e2e');
    const tracksOf = (pid: string) => Object.values(store.getProject(pid).doc.sequences).flatMap((q) => q.tracks);
    const a1 = tracksOf(s.pid).find((t) => t.kind === 'audio' && t.clips.length === 0)!;
    const nTracks = tracksOf(s.pid).length;
    const before = revision(s.pid);
    const plan = await planFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
    expect(plan.picks.length).toBeGreaterThan(0);
    expect(revision(s.pid)).toBe(before);
    const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
    expect(applied.revision).toBe(before + 1);
    // the planner reused the project's empty A1 for the clips' own sound: no step reports that track's id
    const linkedOnA1 = () => tracksOf(s.pid).find((t) => t.id === a1.id)!.clips.filter((c) => c.type === 'media' && !!c.linkGroupId).length;
    expect(linkedOnA1()).toBeGreaterThan(0);
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'set_track_audio', args: { trackId: a1.id, gain: 0.6 } }] });
    const doc = store.getProject(s.pid).doc;
    expect(filmRunTracks(doc, doc.recipeRuns[applied.runId]!).ownSound).toBe(a1.id);
    const nAfterApply = tracksOf(s.pid).length;
    const again = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, { targetSeconds: 60 });
    expect(again.replaced).toBeGreaterThan(0);
    // no new own-sound track; the new clips' sound is on A1 again, and the hand-set gain still applies to it
    expect(tracksOf(s.pid).length).toBe(nAfterApply);
    expect(linkedOnA1()).toBeGreaterThan(0);
    expect(tracksOf(s.pid).find((t) => t.id === a1.id)!.audio?.gain).toBe(0.6);
    // A1 is now recorded in the run, so the next regeneration finds it without the slot search too
    const run = store.getProject(s.pid).doc.recipeRuns[applied.runId]!;
    expect(run.createdIds).toContain(a1.id);
    await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, { targetSeconds: 30 });
    expect(tracksOf(s.pid).length).toBe(nAfterApply);
    expect(tracksOf(s.pid).find((t) => t.id === a1.id)!.audio?.gain).toBe(0.6);
  });
});

describe('a film clip deleted by hand stays deleted (ADR-0016 decision 6, applied to the film)', () => {
  const pictureAssets = (pid: string, runId: string) => {
    const doc = store.getProject(pid).doc;
    return (doc.recipeRuns[runId]!.slots ?? []).filter((x) => x.kind === 'picture').flatMap((x) => { const f = findClip(doc, x.clipId); return f && f.clip.type === 'media' ? [f.clip.assetId] : []; });
  };
  const textClips = (pid: string) => Object.values(store.getProject(pid).doc.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'text').flatMap((t) => t.clips);
  it('a deleted pick leaves its file out and a deleted title is not made again; undo of the delete or restoreRemoved brings them back; replay is byte-identical', async () => {
    const s = seed('ff-deleted', ['2026-12-05T18:00:00', '2026-12-05T18:10:00', '2026-12-05T18:20:00']);
    const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
    const run0 = store.getProject(s.pid).doc.recipeRuns[applied.runId]!;
    const pick = run0.slots!.find((x) => x.kind === 'picture')!;
    const gone = (findClip(store.getProject(s.pid).doc, pick.clipId)!.clip as { assetId: string }).assetId;
    expect(pictureAssets(s.pid, applied.runId)).toContain(gone);
    const title = run0.slots!.find((x) => x.key === 'title')!;
    // delete one pick (with its own sound) and the opening title by hand
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: pick.clipId } }, { op: 'delete_clip', args: { clipId: title.clipId } }] });
    const textsAfterDelete = textClips(s.pid).length;
    const r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, { order: 'given' });
    expect([...r.removed].sort()).toEqual([pick.key, 'title'].sort());
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'removed_by_hand' }));
    expect(r.excluded).toContainEqual(expect.objectContaining({ assetId: gone, code: 'removed_by_hand' }));
    expect(r.alternatives).toContainEqual(expect.objectContaining({ restoreRemoved: true }));
    expect(pictureAssets(s.pid, applied.runId)).not.toContain(gone);
    expect(textClips(s.pid).length).toBe(textsAfterDelete); // the closing card was remade; no opening title came back
    expect(store.getProject(s.pid).doc.recipeRuns[applied.runId]!.slots!.find((x) => x.key === 'title')!.clipId).toBe(title.clipId);
    // the next regeneration, through the recipe route, still leaves them out
    const again = await rest('POST', `/projects/${s.pid}/recipe-runs/${applied.runId}/regenerate`, { params: { targetSeconds: 60 } }, auth.tokens.agent);
    expect([again.status, [...again.body.removed].sort()]).toEqual([200, [pick.key, 'title'].sort()]);
    expect(pictureAssets(s.pid, applied.runId)).not.toContain(gone);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(store.getProject(s.pid).doc));
    // restoreRemoved (the template route, which hands film runs to the film path): the file and the title are made again
    const back = await rest('POST', `/projects/${s.pid}/template-runs/${applied.runId}/regenerate`, { restoreRemoved: true }, auth.tokens.agent);
    expect([back.status, back.body.removed]).toEqual([200, []]);
    expect(pictureAssets(s.pid, applied.runId)).toContain(gone);
    const runB = store.getProject(s.pid).doc.recipeRuns[applied.runId]!;
    expect(findClip(store.getProject(s.pid).doc, runB.slots!.find((x) => x.key === 'title')!.clipId)).toBeTruthy();
    // delete a pick again, undo the delete: the regeneration treats it as untouched (no removed_by_hand), and the file stays in
    const pickB = runB.slots!.find((x) => x.kind === 'picture')!;
    const fileB = (findClip(store.getProject(s.pid).doc, pickB.clipId)!.clip as { assetId: string }).assetId;
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: pickB.clipId } }] });
    store.undo(s.pid, 'user:local', 'undo');
    const undone = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {});
    expect(undone.removed).toEqual([]);
    expect(undone.warnings.map((w) => w.code)).not.toContain('removed_by_hand');
    expect(pictureAssets(s.pid, applied.runId)).toContain(fileB);
    // MCP: regenerate_recipe passes restoreRemoved too
    const m = await tool('regenerate_recipe', { projectId: s.pid, runId: applied.runId, restoreRemoved: true }, auth.tokens.agent);
    expect([m.isError, m.body.removed]).toEqual([false, []]);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(store.getProject(s.pid).doc));
  });
  describe('a clip that a delete moved (it closed the gap before it) is not edited by hand; a clip dragged by hand is (ADR-0026, amendment of 2026-11-24)', () => {
    const fi = (t: T.RationalTime) => T.nearestFrameIndex(t, R);
    /** The film's pictures in timeline order: where each lies and which file it shows. */
    const picksOf = (pid: string, runId: string) => {
      const doc = store.getProject(pid).doc;
      return (doc.recipeRuns[runId]!.slots ?? []).filter((x) => x.kind === 'picture').flatMap((x) => { const f = findClip(doc, x.clipId); return f && f.clip.type === 'media' ? [{ id: f.clip.id, key: x.key, from: fi(f.clip.start), to: fi(T.add(f.clip.start, f.clip.duration)), file: f.clip.assetId, track: f.track.id }] : []; }).sort((a, b) => a.from - b.from);
    };
    const layout = (pid: string, runId: string) => picksOf(pid, runId).map((x) => [x.file, x.from, x.to]);
    const closingAt = (pid: string, runId: string) => { const doc = store.getProject(pid).doc; return fi(findClip(doc, doc.recipeRuns[runId]!.slots!.find((x) => x.key === 'closing')!.clipId)!.clip.start); };
    const THREE = ['2026-12-05T18:00:00', '2026-12-05T18:10:00', '2026-12-05T18:20:00'];

    it('a pick deleted with a Delete that closes the gap: the later picks it moved are laid out again with the film (not kept as hand edits), the deleted file stays out and the answer says both; restoreRemoved puts the file back at its place; exact undo, one step each', async () => {
      const s = seed('ff-ripple', THREE);
      const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
      const doc0 = store.getProject(s.pid).doc;
      const run0 = doc0.recipeRuns[applied.runId]!;
      // the run records where it placed each clip, with its track
      for (const x of picksOf(s.pid, applied.runId)) expect(run0.ranges![x.id]).toMatchObject({ trackId: x.track });
      const p0 = picksOf(s.pid, applied.runId), l0 = layout(s.pid, applied.runId);
      expect([p0.map((x) => x.file), closingAt(s.pid, applied.runId)]).toEqual([s.ids, p0[2]!.to]);
      store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p0[1]!.id] } }] });
      const rippled = store.getProject(s.pid).doc;
      expect(picksOf(s.pid, applied.runId)[1]).toMatchObject({ id: p0[2]!.id, from: p0[1]!.from });
      const r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {});
      expect([r.protected, r.removed]).toEqual([[], [p0[1]!.key]]);
      const codes = r.warnings.map((w) => w.code);
      expect(codes).toEqual(expect.arrayContaining(['moved_back', 'removed_by_hand']));
      expect(codes).not.toContain('kept_by_hand');
      expect(codes).not.toContain('cut_off_grid_next_to_kept');
      expect(r.warnings.find((w) => w.code === 'moved_back')!.details).toEqual({ keys: [p0[2]!.key] });
      let doc = store.getProject(s.pid).doc;
      expect(validateProject(doc)).toEqual([]);
      // the moved pick was replaced, not kept: the film of the two files left is laid out afresh, whole, the card right after it
      expect(findClip(doc, p0[2]!.id)).toBeUndefined();
      const after = picksOf(s.pid, applied.runId);
      expect([after.map((x) => x.file), after[0]!.from, after[1]!.from === after[0]!.to, closingAt(s.pid, applied.runId)]).toEqual([[s.ids[0], s.ids[2]], 0, true, after[1]!.to]);
      // restoreRemoved: the file is back at its place between the other two, and the film is the one first made
      const b = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {}, undefined, { restoreRemoved: true });
      expect([b.removed, b.protected, b.warnings.map((w) => w.code).filter((c) => ['moved_back', 'kept_by_hand', 'removed_by_hand', 'cut_off_grid_next_to_kept'].includes(c))]).toEqual([[], [], []]);
      doc = store.getProject(s.pid).doc;
      expect(validateProject(doc)).toEqual([]);
      expect([layout(s.pid, applied.runId), closingAt(s.pid, applied.runId)]).toEqual([l0, p0[2]!.to]);
      expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(doc));
      // undo: the restore, the regeneration, the delete
      store.undo(s.pid, 'user:local', 'undo'); store.undo(s.pid, 'user:local', 'undo');
      expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(rippled));
      store.undo(s.pid, 'user:local', 'undo');
      expect(creativeProjection(store.getProject(s.pid).doc)).toBe(creativeProjection(doc0));
      // the button at once after the Delete (through the template route, which hands film runs to the film path)
      store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p0[1]!.id] } }] });
      const at = await rest('POST', `/projects/${s.pid}/template-runs/${applied.runId}/regenerate`, { restoreRemoved: true }, auth.tokens.agent);
      expect([at.status, at.body.removed, at.body.protected, layout(s.pid, applied.runId)]).toEqual([200, [], [], l0]);
    });

    it('a pick dragged by hand, with nothing else changed, is kept where the person put it and the film is laid around it; so is one dragged after a delete, one changed in another way, and one taken to another track', async () => {
      const film = async (name: string) => { const s = seed(name, THREE); const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 }); return { ...s, runId: applied.runId, p0: picksOf(s.pid, applied.runId) }; };
      const hand = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:local', ops });
      // dragged later by one second, no delete anywhere: no deleted length lies before it, so the move is the person's
      const a = await film('ff-dragged');
      hand(a.pid, [{ op: 'move_clip', args: { clipId: a.p0[2]!.id, start: T.frameTime(a.p0[2]!.from + 30, R) } }]);
      const keptA = structuredClone(findClip(store.getProject(a.pid).doc, a.p0[2]!.id)!.clip);
      const ra = await regenerateFamilyFilmFor(store, gov, USER, a.pid, a.runId, {});
      expect([ra.protected.includes(a.p0[2]!.id), ra.movedBack, ra.warnings.map((w) => w.code).includes('kept_by_hand'), ra.warnings.map((w) => w.code).includes('moved_back')]).toEqual([true, [], true, false]);
      expect(findClip(store.getProject(a.pid).doc, a.p0[2]!.id)!.clip).toEqual(keptA);
      expect(validateProject(store.getProject(a.pid).doc)).toEqual([]);
      // a Delete closed the gap before it AND it was dragged 15 frames on: it did not move by the deleted length, so it is kept
      const b = await film('ff-dragged-after-delete');
      hand(b.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [b.p0[1]!.id] } }, { op: 'move_clip', args: { clipId: b.p0[2]!.id, start: T.frameTime(b.p0[1]!.from + 15, R) } }]);
      const rb = await regenerateFamilyFilmFor(store, gov, USER, b.pid, b.runId, {});
      expect([rb.protected.includes(b.p0[2]!.id), rb.movedBack, rb.removed]).toEqual([true, [], [b.p0[1]!.key]]);
      expect(fi(findClip(store.getProject(b.pid).doc, b.p0[2]!.id)!.clip.start)).toBe(b.p0[1]!.from + 15);
      expect(validateProject(store.getProject(b.pid).doc)).toEqual([]);
      // moved by the delete and turned by hand: edited
      const c = await film('ff-ripple-edited');
      hand(c.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [c.p0[1]!.id] } }, { op: 'set_clip_transform', args: { clipId: c.p0[2]!.id, transform: { rotation: 4 } } }]);
      const keptC = structuredClone(findClip(store.getProject(c.pid).doc, c.p0[2]!.id)!.clip);
      const rc = await regenerateFamilyFilmFor(store, gov, USER, c.pid, c.runId, {});
      expect([rc.protected.includes(c.p0[2]!.id), rc.warnings.map((w) => w.code).includes('moved_back')]).toEqual([true, false]);
      expect(rc.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['kept_by_hand', 'removed_by_hand']));
      expect(findClip(store.getProject(c.pid).doc, c.p0[2]!.id)!.clip).toEqual(keptC);
      // taken to another picture track at its own time (nothing else changed): where the person put it
      const d = await film('ff-other-track');
      const other = hand(d.pid, [{ op: 'add_track', args: { kind: 'video' } }]).results[0]!.output!.trackId as string;
      hand(d.pid, [{ op: 'move_clip', args: { clipId: d.p0[1]!.id, start: T.frameTime(d.p0[1]!.from, R), trackId: other, includeLinked: false } }]);
      const rd = await regenerateFamilyFilmFor(store, gov, USER, d.pid, d.runId, {});
      expect(rd.protected).toContain(d.p0[1]!.id);
      const doc = store.getProject(d.pid).doc;
      expect(validateProject(doc)).toEqual([]);
      expect([findClip(doc, d.p0[1]!.id)!.track.id, fi(findClip(doc, d.p0[1]!.id)!.clip.start)]).toEqual([other, d.p0[1]!.from]);
    });

    it('several deletes add up; a delete on another track counts for that track only; a delete that kept its gap and a later one that closed its gap: the pick after both moved by the closed length and is laid out again; a delete of a clip the film did not make explains no move: those clips stay kept and the film stays valid, with no picture over another and no gap between them', async () => {
      const hand = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:local', ops });
      const noOverlap = (pid: string, runId: string) => { const p = picksOf(pid, runId); return p.every((x, i) => i === 0 || x.from >= p[i - 1]!.to); };
      const whole = (pid: string, runId: string) => { const p = picksOf(pid, runId); return p.every((x, i) => i === 0 || x.from === p[i - 1]!.to); };
      // two Deletes that each closed the gap: the last pick moved by the length of both
      const s = seed('ff-two-deletes', THREE);
      const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
      const p0 = picksOf(s.pid, applied.runId), l0 = layout(s.pid, applied.runId);
      hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [p0[0]!.id] } }]);
      hand(s.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [p0[1]!.id] } }]);
      expect(picksOf(s.pid, applied.runId).map((x) => [x.id, x.from])).toEqual([[p0[2]!.id, 0]]);
      const r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {});
      expect([r.protected, [...r.removed].sort(), r.movedBack]).toEqual([[], [p0[0]!.key, p0[1]!.key].sort(), [p0[2]!.key]]);
      const back = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {}, undefined, { restoreRemoved: true });
      expect([back.protected, back.removed, layout(s.pid, applied.runId)]).toEqual([[], [], l0]);
      // the title deleted with its gap closed (another track): the closing card after it on that track moved by the title's
      // length and is made again; no pick is touched. Then a pick deleted too: the title's length does not count on the picture track
      const t = seed('ff-title-deleted', THREE);
      const made = await applyFamilyFilmFor(store, gov, USER, t.pid, { assetIds: t.ids, targetSeconds: 30 });
      const q0 = picksOf(t.pid, made.runId);
      const slot = (key: string) => store.getProject(t.pid).doc.recipeRuns[made.runId]!.slots!.find((x) => x.key === key)!.clipId;
      const closing0 = slot('closing');
      hand(t.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [slot('title')] } }]);
      expect(fi(findClip(store.getProject(t.pid).doc, closing0)!.clip.start)).toBeLessThan(q0[2]!.to);
      hand(t.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [q0[1]!.id] } }]);
      const rt = await regenerateFamilyFilmFor(store, gov, USER, t.pid, made.runId, {});
      expect([rt.protected, [...rt.removed].sort(), [...(rt.movedBack ?? [])].sort()]).toEqual([[], [q0[1]!.key, 'title'].sort(), ['closing', q0[2]!.key].sort()]);
      expect([findClip(store.getProject(t.pid).doc, closing0), whole(t.pid, made.runId), closingAt(t.pid, made.runId) === picksOf(t.pid, made.runId).at(-1)!.to]).toEqual([undefined, true, true]);
      // one pick deleted with its gap KEPT and a later one with its gap closed: the last pick moved by one length while two are
      // gone before it. Each gone pick closed its gap or kept it, and the one reading that fits the track (the pick between
      // them did not move) explains the move: the last pick is laid out again, not kept (amendment of 2026-11-25)
      const u = seed('ff-mixed-deletes', ['2026-12-05T18:00:00', '2026-12-05T18:10:00', '2026-12-05T18:20:00', '2026-12-05T18:30:00']);
      const mixed = await applyFamilyFilmFor(store, gov, USER, u.pid, { assetIds: u.ids, targetSeconds: 30 });
      const u0 = picksOf(u.pid, mixed.runId);
      hand(u.pid, [{ op: 'delete_clip', args: { clipId: u0[0]!.id } }, { op: 'ripple_delete_clips', args: { clipIds: [u0[2]!.id] } }]);
      const ru = await regenerateFamilyFilmFor(store, gov, USER, u.pid, mixed.runId, {});
      expect([ru.protected, ru.movedBack, [...ru.removed].sort()]).toEqual([[], [u0[3]!.key], [u0[0]!.key, u0[2]!.key].sort()]);
      expect([validateProject(store.getProject(u.pid).doc), noOverlap(u.pid, mixed.runId), whole(u.pid, mixed.runId)]).toEqual([[], true, true]);
      // a clip the film did not make, before the film on its picture track, deleted with its gap closed: every pick moved, none
      // of the film's own clips is gone, so every pick is kept as moved by hand (as before the rule)
      const v = seed('ff-foreign-delete', THREE);
      const later = await applyFamilyFilmFor(store, gov, USER, v.pid, { assetIds: v.ids, targetSeconds: 30, at: T.frameTime(60, R) });
      const v0 = picksOf(v.pid, later.runId);
      expect(v0[0]!.from).toBe(60);
      const foreign = hand(v.pid, [{ op: 'add_clip', args: { assetId: v.ids[0], trackId: v0[0]!.track, start: T.ZERO, duration: T.frameTime(60, R), withLinkedAudio: false } }]).results[0]!.output!.clipId as string;
      hand(v.pid, [{ op: 'ripple_delete_clips', args: { clipIds: [foreign] } }]);
      expect(picksOf(v.pid, later.runId).map((x) => x.from)).toEqual(v0.map((x) => x.from - 60));
      const rv = await regenerateFamilyFilmFor(store, gov, USER, v.pid, later.runId, {});
      expect([v0.every((x) => rv.protected.includes(x.id)), rv.movedBack, rv.warnings.map((w) => w.code).includes('kept_by_hand')]).toEqual([true, [], true]);
      expect([validateProject(store.getProject(v.pid).doc), noOverlap(v.pid, later.runId), whole(v.pid, later.runId), picksOf(v.pid, later.runId).map((x) => x.from)]).toEqual([[], true, true, v0.map((x) => x.from - 60)]);
    });

    it('Shift+Delete then Delete, and Delete then Shift+Delete, before the same picks: they moved by the one closed length and are laid out again with the film, not kept as hand edits; a pick dragged by hand after the two deletes is still kept where it was put', async () => {
      const FOUR = ['2026-12-05T18:00:00', '2026-12-05T18:10:00', '2026-12-05T18:20:00', '2026-12-05T18:30:00'];
      const film = async (name: string) => { const s = seed(name, FOUR); const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 }); return { ...s, runId: applied.runId, p0: picksOf(s.pid, applied.runId) }; };
      const hand = (pid: string, ops: { op: string; args: unknown }[]) => store.commit({ projectId: pid, actor: 'user:local', ops });
      const whole = (pid: string, runId: string) => { const p = picksOf(pid, runId); return p.every((x, i) => i === 0 || x.from === p[i - 1]!.to); };
      const keepGap = (id: string) => ({ op: 'delete_clip', args: { clipId: id } }), closeGap = (id: string) => ({ op: 'ripple_delete_clips', args: { clipIds: [id] } });
      for (const [name, first, second] of [['ff-kept-then-closed', keepGap, closeGap], ['ff-closed-then-kept', closeGap, keepGap]] as const) {
        const a = await film(name);
        expect(a.p0.length, name).toBe(4);
        const closedLength = (first === closeGap ? a.p0[0]! : a.p0[1]!).to - (first === closeGap ? a.p0[0]! : a.p0[1]!).from;
        hand(a.pid, [first(a.p0[0]!.id)]);
        hand(a.pid, [second(a.p0[1]!.id)]);
        // the two later picks lie one deleted length early, while two picks are gone before them
        expect(picksOf(a.pid, a.runId).map((x) => [x.id, x.from]), name).toEqual([[a.p0[2]!.id, a.p0[2]!.from - closedLength], [a.p0[3]!.id, a.p0[3]!.from - closedLength]]);
        const r = await regenerateFamilyFilmFor(store, gov, USER, a.pid, a.runId, {});
        expect([r.protected, [...(r.movedBack ?? [])].sort(), [...r.removed].sort(), r.warnings.map((w) => w.code).includes('kept_by_hand')], name).toEqual([[], [a.p0[2]!.key, a.p0[3]!.key].sort(), [a.p0[0]!.key, a.p0[1]!.key].sort(), false]);
        expect([validateProject(store.getProject(a.pid).doc), whole(a.pid, a.runId), layout(a.pid, a.runId).map((x) => x[0])], name).toEqual([[], true, [a.ids[2], a.ids[3]]]);
        // exact undo, one step
        const after = revision(a.pid);
        store.undo(a.pid, 'user:local', 'undo');
        expect([revision(a.pid), picksOf(a.pid, a.runId).map((x) => x.from)], name).toEqual([after + 1, [a.p0[2]!.from - closedLength, a.p0[3]!.from - closedLength]]);
      }
      // the same two deletes, then the last pick dragged 15 frames on by hand: no reading of the deletes gives that amount, so
      // it is kept where it was put; the pick before it, which only the delete moved, is still laid out again
      const b = await film('ff-two-deletes-then-drag');
      const len = b.p0[1]!.to - b.p0[1]!.from;
      hand(b.pid, [keepGap(b.p0[0]!.id)]);
      hand(b.pid, [closeGap(b.p0[1]!.id)]);
      hand(b.pid, [{ op: 'move_clip', args: { clipId: b.p0[3]!.id, start: T.frameTime(b.p0[3]!.from - len + 15, R) } }]);
      const keptB = structuredClone(findClip(store.getProject(b.pid).doc, b.p0[3]!.id)!.clip);
      const rb = await regenerateFamilyFilmFor(store, gov, USER, b.pid, b.runId, {});
      expect([rb.protected.includes(b.p0[3]!.id), rb.protected.includes(b.p0[2]!.id), rb.movedBack, rb.warnings.map((w) => w.code).includes('kept_by_hand')]).toEqual([true, false, [b.p0[2]!.key], true]);
      expect(findClip(store.getProject(b.pid).doc, b.p0[3]!.id)!.clip).toEqual(keptB);
      expect(validateProject(store.getProject(b.pid).doc)).toEqual([]);
    });

    it('property (seeded): after hand edits (deletes that close the gap, deletes that keep the gap, drags, trims, turns), a film regeneration is one valid revision that undoes exactly and replays, or a refusal that changes nothing; after deletes alone, gap-closing and gap-keeping in any order, nothing is kept and the pictures run without a gap; while none of the film\'s clips is deleted every dragged clip is kept where it was put', async () => {
      const tally = { runs: 0, refused: 0, ripples: 0, gapKeeping: 0, drags: 0, deletesOnly: 0, mixedDeletesOnly: 0, noDelete: 0, movedBack: 0, kept: 0, draggedKept: 0 };
      let project = 0;
      await fc.assert(fc.asyncProperty(fc.array(fc.tuple(fc.nat(7), fc.nat(20), fc.nat(50)), { minLength: 1, maxLength: 4 }), fc.boolean(), async (edits, restore) => {
        const s = seed(`ff-prop-${project++}`, THREE);
        const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, targetSeconds: 30 });
        const done = new Set<string>();
        for (const [kind, pick, amount] of edits) {
          const doc = store.getProject(s.pid).doc;
          const live = doc.recipeRuns[applied.runId]!.createdIds.filter((id) => !!findClip(doc, id));
          if (!live.length) break;
          const found = findClip(doc, live[pick % live.length]!)!, start = fi(found.clip.start);
          const clipId = found.clip.id;
          const [name, op] = ([
            ['ripple', { op: 'ripple_delete_clips', args: { clipIds: [clipId] } }],
            ['ripple', { op: 'ripple_delete_clips', args: { clipIds: [clipId] } }],
            // Shift+Delete: the clip goes (with its linked sound) and its gap stays
            ['delete', { op: 'delete_clip', args: { clipId } }],
            ['delete', { op: 'delete_clip', args: { clipId } }],
            ['drag', { op: 'move_clip', args: { clipId, start: T.frameTime(start + 1 + amount, R) } }],
            ['drag', { op: 'move_clip', args: { clipId, start: T.frameTime(Math.max(0, start - 1 - amount), R) } }],
            ['trim', { op: 'trim_clip', args: { clipId, edge: 'end', to: T.frameTime(start + 10 + (amount % 40), R) } }],
            ['turn', { op: 'set_clip_transform', args: { clipId, transform: { rotation: 1 + amount } } }],
          ] as const)[kind]!;
          try { store.commit({ projectId: s.pid, actor: 'user:local', ops: [op] }); done.add(name); if (name === 'ripple') tally.ripples++; if (name === 'delete') tally.gapKeeping++; if (name === 'drag') tally.drags++; } catch (e) { if (!(e instanceof ApiError)) throw e; }
        }
        const held = store.getProject(s.pid).doc, before = revision(s.pid), run = held.recipeRuns[applied.runId]!;
        const live = run.createdIds.filter((id) => !!findClip(held, id));
        // the clips that lie somewhere else than the run placed them, by the run's own record
        const displaced = live.filter((id) => !T.eq(findClip(held, id)!.clip.start, run.ranges![id]!.start));
        let r: Awaited<ReturnType<typeof regenerateFamilyFilmFor>>;
        try { r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {}, undefined, { restoreRemoved: restore }); } catch (e) {
          if (!(e instanceof ApiError) || ![409, 400].includes(e.status)) throw e;
          if (revision(s.pid) !== before || JSON.stringify(store.getProject(s.pid).doc) !== JSON.stringify(held)) throw new Error('a refusal changed the project');
          tally.refused++;
          return true;
        }
        tally.runs++;
        const doc = store.getProject(s.pid).doc;
        if (revision(s.pid) !== before + 1) throw new Error('not exactly one revision');
        if (validateProject(doc).length) throw new Error(`invalid: ${JSON.stringify(validateProject(doc))}`);
        for (const id of r.protected) { const was = findClip(held, id); if (was && JSON.stringify(findClip(doc, id)?.clip) !== JSON.stringify(was.clip)) throw new Error(`kept clip ${id} changed`); }
        const codes = r.warnings.map((w) => w.code);
        if ((r.movedBack ?? []).length !== ((r.warnings.find((w) => w.code === 'moved_back')?.details.keys as string[] | undefined)?.length ?? 0)) throw new Error('movedBack and the warning disagree');
        // what is said to be put back was moved by a delete: one of the film's own clips is gone
        if ((r.movedBack ?? []).length && live.length === run.createdIds.filter((id) => !Object.values(held.sequences).some((q) => q.tracks.some((t) => t.id === id))).length) throw new Error('clips were put back although none of the film\'s clips was deleted');
        const keptClipIds = r.protected.filter((id) => !!findClip(held, id));
        // deletes alone, each with its gap closed or kept, in any order: every clip lies where those deletes left it, so none is a hand edit
        if (done.size > 0 && [...done].every((x) => x === 'ripple' || x === 'delete')) {
          tally.deletesOnly++;
          if (done.size === 2) tally.mixedDeletesOnly++;
          if (keptClipIds.length || codes.includes('kept_by_hand') || codes.includes('cut_off_grid_next_to_kept')) throw new Error(`only deletes, yet clips were kept as hand edits: ${JSON.stringify({ kept: keptClipIds, codes, done: [...done] })}`);
          const p = picksOf(s.pid, applied.runId);
          if (p.some((x, i) => x.from !== (i === 0 ? p[0]!.from : p[i - 1]!.to))) throw new Error(`a gap between the pictures: ${JSON.stringify(p.map((x) => [x.from, x.to]))}`);
          if (restore && JSON.stringify(p.map((x) => x.file)) !== JSON.stringify(s.ids)) throw new Error(`restoreRemoved after deletes alone did not give every file in order: ${JSON.stringify(p.map((x) => x.file))}`);
        }
        if (!done.has('ripple') && !done.has('delete')) {
          // none of the film's clips was deleted, so no move is explained by a delete: every clip that lies somewhere else than
          // the film placed it was dragged by hand and is kept
          tally.noDelete++;
          const lost = displaced.filter((id) => !r.protected.includes(id));
          if (lost.length || (r.movedBack ?? []).length) throw new Error(`a clip dragged by hand was not kept: ${JSON.stringify({ lost, movedBack: r.movedBack })}`);
          if (displaced.length) tally.draggedKept++;
        }
        if ((r.movedBack ?? []).length) tally.movedBack++;
        if (keptClipIds.length) tally.kept++;
        if (JSON.stringify(store.replay(s.pid, revision(s.pid)).doc) !== JSON.stringify(doc)) throw new Error('replay differs');
        store.undo(s.pid, 'user:local', 'undo');
        if (creativeProjection(store.getProject(s.pid).doc) !== creativeProjection(held)) throw new Error('undo of the regeneration is not exact');
        return true;
      }), { numRuns: Number(process.env.PF_PROPERTY_RUNS ?? 40), seed: Number(process.env.PF_PROPERTY_SEED ?? 20261124) });
      console.log(`family film regeneration after hand edits (property): ${JSON.stringify(tally)}`);
      expect(tally.ripples).toBeGreaterThan(5);
      expect(tally.drags).toBeGreaterThan(5);
      expect(tally.gapKeeping).toBeGreaterThan(5);
      expect(tally.deletesOnly).toBeGreaterThan(1);
      expect(tally.mixedDeletesOnly).toBeGreaterThan(0);
      expect(tally.movedBack).toBeGreaterThan(1);
      expect(tally.draggedKept).toBeGreaterThan(1);
    }, 300_000);

    it('a film made before places were recorded: its places are worked out from its own plan, so the same Delete does not freeze the later picks there either; a film whose plan comes out differently keeps them, as before', async () => {
      const s = seed('ff-older', THREE);
      // as a server before run.ranges committed a film: the plan's own steps and slots, no recordRanges
      const older = (pid: string, ids: string[] = s.ids) => {
        const params = { assetIds: ids, targetSeconds: 30 };
        const doc = store.getProject(pid).doc;
        const plan = planFamilyFilm(doc, params, filmContext(doc, params));
        const r = store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION, params: filmRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots } }] });
        return r.results[0]!.output!.runId as string;
      };
      const runId = older(s.pid);
      expect(store.getProject(s.pid).doc.recipeRuns[runId]).not.toHaveProperty('ranges');
      const p0 = picksOf(s.pid, runId), l0 = layout(s.pid, runId);
      store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [p0[1]!.id] } }] });
      const r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, runId, {});
      expect([r.protected, r.removed, r.warnings.map((w) => w.code).includes('moved_back')]).toEqual([[], [p0[1]!.key], true]);
      expect(findClip(store.getProject(s.pid).doc, p0[2]!.id)).toBeUndefined();
      const b = await regenerateFamilyFilmFor(store, gov, USER, s.pid, runId, {}, undefined, { restoreRemoved: true });
      expect([b.removed, b.protected, layout(s.pid, runId)]).toEqual([[], [], l0]);
      expect(Object.keys(store.getProject(s.pid).doc.recipeRuns[runId]!.ranges ?? {}).length).toBeGreaterThan(0);
      // on such a film too a pick dragged by hand is kept: no deleted length lies before it
      const o = seed('ff-older-dragged', THREE);
      const oldDragged = older(o.pid, o.ids);
      const o0 = picksOf(o.pid, oldDragged);
      store.commit({ projectId: o.pid, actor: 'user:local', ops: [{ op: 'move_clip', args: { clipId: o0[2]!.id, start: T.frameTime(o0[2]!.from + 30, R) } }] });
      const od = await regenerateFamilyFilmFor(store, gov, USER, o.pid, oldDragged, {});
      expect([od.protected.includes(o0[2]!.id), od.movedBack]).toEqual([true, []]);
      // a film of another version: its plan is not made again, so a moved pick is kept where the delete left it, as before
      const t = seed('ff-older-version', THREE);
      const doc = store.getProject(t.pid).doc;
      const plan = planFamilyFilm(doc, { assetIds: t.ids, targetSeconds: 30 }, filmContext(doc, { assetIds: t.ids, targetSeconds: 30 }));
      const old = store.commit({ projectId: t.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: FAMILY_FILM_VERSION + 1, params: filmRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots } }] }).results[0]!.output!.runId as string;
      const q0 = picksOf(t.pid, old);
      store.commit({ projectId: t.pid, actor: 'user:local', ops: [{ op: 'ripple_delete_clips', args: { clipIds: [q0[1]!.id] } }] });
      const k = await regenerateFamilyFilmFor(store, gov, USER, t.pid, old, {});
      expect([k.protected.includes(q0[2]!.id), k.warnings.map((w) => w.code).includes('kept_by_hand')]).toEqual([true, true]);
      expect(validateProject(store.getProject(t.pid).doc)).toEqual([]);
    });
  });
  it('the music deleted by hand: the regenerated film has the no-music mix (own sound at full level, nothing ducked) and says the cuts stay on its bars', async () => {
    const s = seed('ff-music-deleted', ['2026-12-05T18:00:00', '2026-12-05T18:10:00', '2026-12-05T18:20:00']);
    const song: Omit<Asset, 'id'> = { kind: 'audio', name: 'song.wav', contentHash: hash(), byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(120, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Omit<Asset, 'id'>;
    const mus = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: song } }] }).results[0]!.output!.assetId as string;
    const beats = Array.from({ length: 230 }, (_, i) => T.rt(i, 2));
    store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_analysis', args: { assetId: mus, kind: 'beats', method: 'test grid', params: {}, createdAt: '2026-11-18T00:00:00.000Z', times: beats, bpm: 120, confidence: 1, downbeats: beats.filter((_, i) => i % 4 === 0), meter: 4 } }] });
    const tracks = () => Object.values(store.getProject(s.pid).doc.sequences).flatMap((q) => q.tracks).filter((t) => t.kind === 'audio');
    const applied = await applyFamilyFilmFor(store, gov, USER, s.pid, { assetIds: s.ids, musicAssetId: mus, targetSeconds: 30, ownSound: 'under' });
    expect(tracks().some((t) => (t.audio?.gain ?? 1) < 1), 'the clips\' own sound is under the music').toBe(true);
    const musicSlot = store.getProject(s.pid).doc.recipeRuns[applied.runId]!.slots!.find((x) => x.kind === 'music')!;
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: musicSlot.clipId } }] });
    const r = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {});
    expect(r.removed).toEqual(['music']);
    expect(r.warnings).toContainEqual(expect.objectContaining({ code: 'music_removed', details: expect.objectContaining({ cutOn: 'removed-music' }) }));
    for (const t of tracks()) { expect(t.audio?.gain ?? 1, t.name).toBe(1); expect(t.audio?.duck ?? null, t.name).toBe(null); }
    expect(tracks().flatMap((t) => t.clips).some((c) => c.type === 'media' && c.assetId === mus)).toBe(false);
    // the next regeneration knows the last film was already mixed without music (nothing to set again) and still cut on its bars
    const again = await regenerateFamilyFilmFor(store, gov, USER, s.pid, applied.runId, {});
    expect(again.warnings.find((w) => w.code === 'music_removed')!.details.cutOn).toBe('removed-music');
    for (const t of tracks()) expect(t.audio?.gain ?? 1, t.name).toBe(1);
    expect(JSON.stringify(store.replay(s.pid, revision(s.pid)).doc)).toBe(JSON.stringify(store.getProject(s.pid).doc));
  });
});

describe('the planner context from the life line (filmContext)', () => {
  it('capture times by own property; live titles only when every file is dated; fixed text otherwise', () => {
    const s = seed('ctx', ['2026-12-05T18:00:00', '2026-12-05']);
    const doc = store.getProject(s.pid).doc;
    const ctx = filmContext(doc, { assetIds: [...s.ids, '__proto__', 'ast_none'], event: { name: 'חנוכה' } });
    expect(Object.keys(ctx.capture)).toEqual(s.ids);
    expect(ctx.capture[s.ids[0]!]).toBe('2026-12-05T18:00:00');
    expect(ctx.capture[s.ids[1]!]).toBe('2026-12-05');
    expect(ctx.title).toEqual({ text: 'חנוכה · {hebrewDate}', live: true, resolved: null });
    expect(ctx.closing).toEqual({ text: 'סוף', live: false, resolved: null });
    const partly = seed('ctx2', ['2026-12-05T18:00:00', undefined]);
    const c2 = filmContext(store.getProject(partly.pid).doc, { assetIds: partly.ids, lang: 'en' });
    expect(c2.title).toEqual({ text: 'Our film', live: false, resolved: null });
    expect(c2.capture[partly.ids[1]!]).toBeNull();
    expect(filmContext(doc, { assetIds: s.ids, openingTitle: false, closingCard: false })).toMatchObject({ title: null, closing: null });
    expect(filmContext(doc, { assetIds: s.ids, openingText: 'שלום {hebrewDate}' }).title).toEqual({ text: 'שלום {hebrewDate}', live: true, resolved: null });
    expect(filmContext(doc, { assetIds: s.ids, openingText: 'שלום' }).title).toEqual({ text: 'שלום', live: false, resolved: null });
    expect(() => filmContext(doc, { assetIds: s.ids, openingText: 'שלום {nope}' })).toThrow(/brace groups that are not fields: \{nope\}/);
  });
  it('a title without a field is plain text added without fields: typed doubled braces are undone, an event name stays as it is', () => {
    const s = seed('ctx3');
    const doc = store.getProject(s.pid).doc;
    // typed text is in the field grammar (the refusal says "double the braces"); without a field it is shown as plain text
    expect(filmContext(doc, { assetIds: s.ids, openingText: 'שלום {{חברים}}' }).title).toEqual({ text: 'שלום {חברים}', live: false, resolved: null });
    expect(filmContext(doc, { assetIds: s.ids, closingText: '{{age:p1}}' }).closing).toEqual({ text: '{age:p1}', live: false, resolved: null });
    // a live title escapes the event name; a plain one keeps it as it is (it is never read as a field)
    expect(filmContext(doc, { assetIds: s.ids, event: { name: '{age:p1}' } }).title).toEqual({ text: '{{age:p1}} · {hebrewDate}', live: true, resolved: null });
    const undated = seed('ctx4', [undefined]);
    expect(filmContext(store.getProject(undated.pid).doc, { assetIds: undated.ids, event: { name: '{age:p1}' } }).title).toEqual({ text: '{age:p1}', live: false, resolved: null });
  });
  it('the plan\'s own steps: an age field is refused only where the step turns live fields on, for a credential without the people scope', () => {
    const agent: Principal = { actor: 'agent:a', kind: 'agent', scopes: ['observe', 'edit'] };
    const at = { start: T.ZERO, duration: T.rt(2, 1) };
    const refusedFor = (who: Principal, ops: { op: string; args: unknown; bind?: string }[]) => { try { refuseAgesInPlan(who, ops); return null; } catch (e) { return (e as { code?: string }).code ?? 'other'; } };
    expect(refusedFor(agent, [{ op: 'add_text', args: { text: '{age:p1}', ...at, fields: true }, bind: 'title' }])).toBe('people_scope_required');
    expect(refusedFor(agent, [{ op: 'add_text', args: { text: '{age:p1}', ...at }, bind: 'title' }])).toBeNull();
    expect(refusedFor(agent, [{ op: 'add_text', args: { text: '{age:p1}', ...at }, bind: 'title' }, { op: 'set_text_fields', args: { clipId: { $ref: 'title' }, enabled: true } }])).toBe('people_scope_required');
    expect(refusedFor(agent, [{ op: 'add_text', args: { text: 'x', ...at }, bind: 'title' }, { op: 'update_text', args: { clipId: { $ref: 'title' }, text: '{age:p1}' } }, { op: 'set_text_fields', args: { clipId: { $ref: 'title' }, enabled: true } }])).toBe('people_scope_required');
    expect(refusedFor(agent, [{ op: 'add_text', args: { text: '{name:p1} {hebrewDate}', ...at, fields: true }, bind: 'title' }])).toBeNull();
    expect(refusedFor(USER, [{ op: 'add_text', args: { text: '{age:p1}', ...at, fields: true }, bind: 'title' }])).toBeNull();
  });
});

describe('regeneration reuses the film\'s own tracks by role and passes the previous mix', () => {
  const music = (): Omit<Asset, 'id'> => ({ kind: 'audio', name: 'music.wav', contentHash: hash(), byteSize: 1000, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: prov } as Omit<Asset, 'id'>);
  const filmOps = (v: string, m: string | null, tracks: { pictures?: string; own?: string; music?: string } = {}) => [
    ...(tracks.pictures ? [] : [{ op: 'add_track', args: { kind: 'video', name: 'Film pictures' }, bind: 'pictures-track' }]),
    ...(tracks.own ? [] : [{ op: 'add_track', args: { kind: 'audio', name: 'Film sound' }, bind: 'own-sound-track' }]),
    ...(m && !tracks.music ? [{ op: 'add_track', args: { kind: 'audio', name: 'Film music' }, bind: 'music-track' }] : []),
    { op: 'add_clip', args: { assetId: v, start: T.ZERO, duration: T.rt(4, 1), trackId: tracks.pictures ?? { $ref: 'pictures-track', out: 'trackId' }, audioTrackId: tracks.own ?? { $ref: 'own-sound-track', out: 'trackId' } }, bind: 'm000000000001' },
    ...(m ? [{ op: 'add_clip', args: { assetId: m, start: T.ZERO, duration: T.rt(4, 1), trackId: tracks.music ?? { $ref: 'music-track', out: 'trackId' } }, bind: 'music' }] : []),
  ];
  const filmSlots = (m: boolean) => [{ key: 'm000000000001', kind: 'picture' as const, clipId: { $ref: 'm000000000001' } }, ...(m ? [{ key: 'music', kind: 'music' as const, clipId: { $ref: 'music' } }] : [])];
  it('finds the pictures, own-sound and music tracks of a run, keeps them in the new run record, and says whether there was music', () => {
    const s = seed('ff-tracks', ['2026-12-05T18:00:00']);
    const m = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: music() } }] }).results[0]!.output!.assetId as string;
    const params = { assetIds: s.ids, musicAssetId: m, ownSound: 'under', picked: [] };
    const first = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params, steps: ['A film'], ops: filmOps(s.ids[0]!, m), slots: filmSlots(true) } }] });
    const runId = first.results[0]!.output!.runId as string;
    const doc0 = store.getProject(s.pid).doc;
    const tracks = Object.values(doc0.sequences).flatMap((q) => q.tracks);
    const byName = (n: string) => tracks.find((t) => t.name === n)!.id;
    const roles = { pictures: byName('Film pictures'), ownSound: byName('Film sound'), musicTrack: byName('Film music') };
    // a gain set by hand on the film's own-sound track (a track setting: no clip fingerprint changes)
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'set_track_audio', args: { trackId: roles.ownSound, gain: 0.6 } }] });
    const doc = store.getProject(s.pid).doc;
    const run = doc.recipeRuns[runId]!;
    expect(filmRunTracks(doc, run)).toEqual(roles);
    const g = filmRegeneration(doc, run, { ...params, targetSeconds: 30 });
    expect(g.ctx.reuseTracks).toEqual(roles);
    expect([g.ctx.previousOwnSound, g.ctx.previousMusic]).toEqual(['under', true]);
    expect(g.protectedIds).toEqual([]);
    expect(g.keepIds).toEqual(expect.arrayContaining(Object.values(roles)));
    // the regenerated run (a plan that uses the tracks again) keeps them as its own, so the next regeneration finds them again
    const n0 = tracks.length;
    store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { runId, templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params, steps: ['Again'], removeClipIds: g.removable, keepIds: g.keepIds, keepSlots: g.keepSlots, ops: filmOps(s.ids[0]!, m, { pictures: roles.pictures, own: roles.ownSound, music: roles.musicTrack }), slots: filmSlots(true) } }] });
    const after = store.getProject(s.pid).doc;
    expect(Object.values(after.sequences).flatMap((q) => q.tracks).length).toBe(n0);
    expect(filmRunTracks(after, after.recipeRuns[runId]!)).toEqual(roles);
    expect(Object.values(after.sequences).flatMap((q) => q.tracks).find((t) => t.id === roles.ownSound)!.audio?.gain).toBe(0.6);
    // a run without music: no music role, previousMusic false
    const plain = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params: { assetIds: s.ids, musicAssetId: null, picked: [] }, steps: ['Plain'], ops: filmOps(s.ids[0]!, null), slots: filmSlots(false) } }] });
    const d2 = store.getProject(s.pid).doc, r2 = d2.recipeRuns[plain.results[0]!.output!.runId as string]!;
    expect(Object.keys(filmRunTracks(d2, r2)).sort()).toEqual(['ownSound', 'pictures']);
    expect(filmRegeneration(d2, r2, {}).ctx.previousMusic).toBe(false);
  });
  it('a track of the run whose clips were all deleted by hand takes the one role left; ids naming Object.prototype members find nothing', () => {
    const s = seed('ff-tracks2', ['2026-12-05T18:00:00']);
    const m = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: music() } }] }).results[0]!.output!.assetId as string;
    const first = store.commit({ projectId: s.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'apply_template', args: { templateId: FAMILY_FILM_TEMPLATE_ID, templateVersion: 1, params: { assetIds: s.ids, musicAssetId: m, picked: [] }, steps: ['A film'], ops: filmOps(s.ids[0]!, m), slots: filmSlots(true) } }] });
    const runId = first.results[0]!.output!.runId as string;
    const doc = store.getProject(s.pid).doc;
    const run = doc.recipeRuns[runId]!;
    const musicSlot = run.slots!.find((x) => x.kind === 'music')!;
    const musicTrack = Object.values(doc.sequences).flatMap((q) => q.tracks).find((t) => t.clips.some((c) => c.id === musicSlot.clipId))!.id;
    store.commit({ projectId: s.pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: musicSlot.clipId } }] });
    const d1 = store.getProject(s.pid).doc;
    expect(filmRunTracks(d1, d1.recipeRuns[runId]!).musicTrack).toBe(musicTrack);
    expect(filmRunTracks(d1, { ...d1.recipeRuns[runId]!, createdIds: ['__proto__', 'constructor'], slots: [{ key: 'music', kind: 'music', clipId: 'toString' }] })).toEqual({});
  });
});
