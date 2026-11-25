/**
 * The stabilise job (stabilise.ts): refusals before 202, the one-transaction commit, cancel, a clip changed or an operation refused
 * while it runs, recovery after a restart, shutdown, frames already measured, and the read view. Served in-process (app.fetch, no
 * port). Fixtures are synthetic (packages/fixtures/src/steady.ts) encoded with H.264 here; the "files" of the refusal checks are
 * import records with no picture behind them (the refusals come before anything is read).
 *
 * Until W2 merges, core's clipSourceFrames and cameraMotionSummary are stubs and set_clip_stabilise refuses with notBuilt. The two
 * functions get LABELLED TEST DOUBLES below that hand over to the real ones as soon as they stop throwing "not built yet"; the
 * operation is never faked: before W2 the job ends failed with the operation's own refusal (asserted), after W2 it succeeds (the rows
 * marked "after W2" switch on with STEADY_OPS_BUILT).
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@pulseframe/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@pulseframe/core')>();
  const T = await import('@pulseframe/time');
  const notBuilt = (e: unknown) => /not built yet/.test((e as Error).message);
  /**
   * LABELLED TEST DOUBLE until W2 merges: clipSourceFrames as its contract (core steady.ts) states it for a clip with no ramp and no
   * handle: the first and last source frame the clip shows (sourceFrameIndexAt at its first and last timeline frame, the rule of
   * tracking.ts trackingRange); reach = the same frames.
   */
  const clipFramesDouble = (doc: import('@pulseframe/core').ProjectDocument, clip: import('@pulseframe/core').MediaClip) => {
    const asset = doc.assets[clip.assetId]!, rate = doc.settings.frameRate;
    const lastT = T.max(clip.start, T.sub(T.add(clip.start, clip.duration), T.frameTime(1, rate)));
    const a = real.sourceFrameIndexAt({ ...asset, video: asset.video! }, clip, clip.start, rate), b = real.sourceFrameIndexAt({ ...asset, video: asset.video! }, clip, lastT, rate);
    const first = Math.min(a, b), last = Math.max(a, b);
    return { first, last, reach: { first, last } };
  };
  /** LABELLED TEST DOUBLE until W2 merges: cameraMotionSummary as its contract states it (counts per state; runs of weak/unknown and starts inside a stretch). */
  const summaryDouble = (m: import('@pulseframe/core').CameraMotion) => {
    const counts = { unknown: 0, ok: 0, weak: 0, start: 0 };
    const review: { from: number; to: number; state: 'weak' | 'unknown' | 'start' }[] = [];
    let samples = 0;
    for (const s of m.stretches)
      s.st.forEach((code, i) => {
        const name = real.STEADY_STATES[code]!;
        counts[name]++; samples++;
        if (name === 'ok' || (name === 'start' && i === 0)) return;
        const prev = review.at(-1);
        if (prev && prev.state === name && name !== 'start' && prev.to === s.from + i) prev.to++;
        else if (review.length < 200) review.push({ from: s.from + i, to: s.from + i + 1, state: name });
      });
    return { samples, counts, review };
  };
  const clipSourceFrames: typeof real.clipSourceFrames = (doc, clip) => { try { return real.clipSourceFrames(doc, clip); } catch (e) { if (notBuilt(e)) return clipFramesDouble(doc, clip); throw e; } };
  const cameraMotionSummary: typeof real.cameraMotionSummary = (m) => { try { return real.cameraMotionSummary(m); } catch (e) { if (notBuilt(e)) return summaryDouble(m); throw e; } };
  return { ...real, clipSourceFrames, cameraMotionSummary };
});

import * as T from '@pulseframe/time';
import { MAX_STEADY_SAMPLES, SST, STABILISE_JOB_TYPE, STEADY_ALGO, STEADY_OPS_BUILT, STEADY_REFUSALS, TRACKING_JOB_TYPE, type ProjectDocument } from '@pulseframe/core';
import { steadyFixture, writeSteadyFixture } from '../../../packages/fixtures/src/steady.ts';
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
import { cancelStabiliseJob, measureSegments, recoverStabiliseJobs, startStabiliseJob, STABILISE_SERVER_REFUSALS, stopStabiliseJobs } from './stabilise.ts';
import { Store, type JobRow } from './store.ts';
import { readFrames } from './tracking.ts';
import type { ReadFrames } from './vision/types.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dir: string, cfg: Config, store: Store, auth: Auth, gov: Governance, app: ReturnType<typeof createApp>, mcp: ReturnType<typeof createMcp>, capabilities: Capabilities, derivatives: Derivatives;
let agent: Principal;
const headers = () => ({ host: `127.0.0.1:${cfg.port}`, authorization: `Bearer ${auth.tokens.agent}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' });
const rest = async (method: string, p: string, body?: unknown) => {
  const r = await app.fetch(new Request(`http://127.0.0.1:${cfg.port}/api/v1${p}`, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
  return { status: r.status, body: (await r.json()) as any };
};
let rpcId = 0;
async function tool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const r = await mcp(new Request(`http://127.0.0.1:${cfg.port}/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }) }));
  const text = await r.text();
  const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  return { isError: !!msg.result?.isError, text: String(msg.result.content[0].text) };
}
const terminal = (s: string) => ['succeeded', 'failed', 'canceled'].includes(s);
async function settle(jobId: string, ms = 120_000): Promise<JobRow> {
  const t0 = Date.now();
  for (;;) { const j = store.getJob(jobId); if (terminal(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status} (${j.stage})`); await sleep(25); }
}
const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
const docHash = (projectId: string) => createHash('sha256').update(JSON.stringify(store.getProject(projectId).doc)).digest('hex');
async function importInto(projectId: string, file: string) {
  const meta = await describeMedia(file);
  const contentHash = sha(file);
  const copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
  fs.copyFileSync(file, copy);
  store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
  const asset = { ...meta, name: path.basename(file), contentHash, byteSize: fs.statSync(file).size, provenance: { origin: 'upload' as const, importedAt: new Date().toISOString(), importedBy: 'test' } };
  return store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
}
const R30 = { num: 30, den: 1 };
let fakeN = 0;
/** An import record of a 1280×720 30 fps video with no picture behind it (for refusals that come before anything is read). */
function fakeVideo(projectId: string, frames: number) {
  const k = ++fakeN;
  const asset = { kind: 'video' as const, name: `fake${k}.mp4`, contentHash: `sha256:${k.toString(16).padStart(64, 'f')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30), video: { width: 1280, height: 720, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };
  return store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
}
/** Place a clip of `frames` frames of the file from source frame `sourceIn` at timeline frame `at`; returns its id. */
function placeClip(projectId: string, assetId: string, sourceIn: number, frames: number, at = 0): string {
  const before = new Set(clipIds(store.getProject(projectId).doc));
  store.commit({ projectId, actor: 'user:local', ops: [{ op: 'add_clip', args: { assetId, start: T.frameTime(at, R30), sourceIn: T.frameTime(sourceIn, R30), duration: T.frameTime(frames, R30) } }] });
  const doc = store.getProject(projectId).doc;
  return clipIds(doc).find((id) => !before.has(id) && videoClip(doc, id))!;
}
const clipIds = (doc: ProjectDocument) => Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips.map((c) => c.id)));
const videoClip = (doc: ProjectDocument, id: string) => Object.values(doc.sequences).some((s) => s.tracks.some((t) => t.kind === 'video' && t.clips.some((c) => c.id === id)));
/** A stored measurement written through the internal op (as a finished job would leave it). */
function seedMotion(projectId: string, assetId: string, from: number, n: number, input: string) {
  const z = new Array(n).fill(0);
  store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_camera_motion', args: { assetId, from, dx: z, dy: z, dr: z, dz: z, st: [SST.start, ...new Array(n - 1).fill(SST.ok)], method: 'seed', params: { algo: STEADY_ALGO, input }, createdAt: 'x' } }] });
}
const ffmpegOn = (file: string) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return c.startsWith('ffmpeg') && c.includes(file); } catch { return false; } });
/** The real reader, slowed down per frame so a job is still running when the test acts on it (instrumentation, not a mock). */
const slowReader = (ms: number): ReadFrames => (src, from, to, h, onFrame, signal) => readFrames(src, from, to, h, async (i, f) => { await sleep(ms); await onFrame(i, f); }, signal);
/** The real reader, recording what it was asked for (instrumentation). */
const countingReader = (log: { from: number; to: number; frames: number }[]): ReadFrames => async (src, from, to, h, onFrame, signal) => { const row = { from, to, frames: 0 }; log.push(row); return readFrames(src, from, to, h, async (i, f) => { row.frames++; await onFrame(i, f); }, signal); };
/** Before W2: the operation's own refusal; after: success. Either way the job ended as the operation decided, never faked. */
const expectOpOutcome = (j: JobRow) => {
  if (STEADY_OPS_BUILT) expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
  else expect([j.status, j.error?.code, j.error?.message]).toEqual(['failed', STEADY_REFUSALS.notBuilt.code, STEADY_REFUSALS.notBuilt.message('set_clip_stabilise')]);
};

let shakyFile: string, longFile: string, flatFile: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-stabilise-'));
  cfg = { ...loadConfig({}), dataDir: dir, port: 25, speechPython: null, voicePython: null, speechModelsDir: path.join(dir, 'speech-models'), backupDir: null };
  store = new Store(dir);
  auth = new Auth(cfg);
  const exporter = new Exporter(store, null as never, () => '', path.join(dir, 'no-web-dist'));
  capabilities = new Capabilities(store, cfg);
  derivatives = new Derivatives(store);
  const presence = new Presence();
  gov = new Governance(store);
  auth.resolveGrant = (token) => gov.principalForToken(token);
  mcp = createMcp(store, auth, exporter, capabilities, presence, gov, undefined, derivatives);
  app = createApp(cfg, store, auth, exporter, capabilities, derivatives, presence, mcp, gov);
  agent = auth.authenticate(new Request('http://127.0.0.1/', { headers: headers() }));
  shakyFile = (await writeSteadyFixture(steadyFixture({ variant: 'F1', frames: 90 }), path.join(dir, 'shaky.mp4'), { width: 320, height: 180 })).file;
  longFile = (await writeSteadyFixture(steadyFixture({ variant: 'F1', frames: 240, seed: 9 }), path.join(dir, 'long.mp4'), { width: 320, height: 180 })).file;
  flatFile = (await writeSteadyFixture(steadyFixture({ variant: 'F4', frames: 60 }), path.join(dir, 'flat.mp4'), { width: 320, height: 180 })).file;
}, 180_000);
afterAll(async () => {
  await stopStabiliseJobs(store);
  (app as any)?.browserExport?.stop();
  await mcp?.close();
  await capabilities?.stop();
  await derivatives?.stop();
  store?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
const project = (name: string) => store.createProject({ name, width: 320, height: 180, frameRate: R30 }).doc.id;

describe('what is measured', () => {
  const st = (from: number, n: number, input = 'original') => ({ from, dx: new Array(n).fill(0), dy: [], dr: [], dz: [], st: new Array(n).fill(1), origin: { method: 'm', params: { algo: STEADY_ALGO, input }, createdAt: '', createdBy: '' } }) as any;
  it('only the gaps, each widened by one frame onto a neighbouring stretch of the same kind; another input or algo counts as unmeasured', () => {
    expect(measureSegments([], 'original', 10, 50)).toEqual([{ from: 10, to: 50 }]);
    expect(measureSegments([st(0, 30)], 'original', 10, 50)).toEqual([{ from: 29, to: 50 }]);
    expect(measureSegments([st(40, 30)], 'original', 10, 50)).toEqual([{ from: 10, to: 41 }]);
    expect(measureSegments([st(0, 20), st(30, 5)], 'original', 10, 50)).toEqual([{ from: 19, to: 31 }, { from: 34, to: 50 }]);
    expect(measureSegments([st(0, 100)], 'original', 10, 50)).toEqual([]);
    expect(measureSegments([st(0, 100, 'proxy')], 'original', 10, 50)).toEqual([{ from: 10, to: 50 }]);
    // a stretch just outside the range is still joined seamlessly
    expect(measureSegments([st(0, 10)], 'original', 10, 50)).toEqual([{ from: 9, to: 50 }]);
    // a gap of one frame between two stretches: both neighbours are taken
    expect(measureSegments([st(0, 20), st(21, 29)], 'original', 10, 50)).toEqual([{ from: 19, to: 22 }]);
  });
});

describe('refused before 202 (nothing created)', () => {
  it('a missing clip 404; clipTooLong, fileFull and budget 422 with the operations\' sentences; scopes first', async () => {
    const pid = project('refusals');
    expect((await rest('POST', `/projects/${pid}/clips/clp_none/stabilise`, {})).status).toBe(404);
    const big = fakeVideo(pid, 20_000);
    const long = placeClip(pid, big, 0, 11_000);
    let r = await rest('POST', `/projects/${pid}/clips/${long}/stabilise`, {});
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual([422, 'out_of_bounds', STEADY_REFUSALS.clipTooLong.message(11_000 + 2 * 75)]);
    // fileFull: 10,700 frames already measured, the clip's range adds 350 more in a separate stretch
    const full = fakeVideo(pid, 12_000);
    seedMotion(pid, full, 0, 10_700, 'original');
    const late = placeClip(pid, full, 11_000, 200, 12_000);
    r = await rest('POST', `/projects/${pid}/clips/${late}/stabilise`, {});
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual([422, 'out_of_bounds', STEADY_REFUSALS.fileFull.message(10_700 + 200 + 2 * 75)]);
    expect(store.openJobs(STABILISE_JOB_TYPE)).toEqual([]);
  }, 60_000);
  it('budget: the project\'s motion tracks and camera measurements would pass 43,200 samples', async () => {
    const pid = project('budget');
    for (let k = 0; k < 4; k++) seedMotion(pid, fakeVideo(pid, MAX_STEADY_SAMPLES), 0, MAX_STEADY_SAMPLES - 1, 'original'); // 43,196
    const v = fakeVideo(pid, 300);
    const c = placeClip(pid, v, 100, 30);
    const before = docHash(pid);
    const r = await rest('POST', `/projects/${pid}/clips/${c}/stabilise`, {});
    expect([r.status, r.body.error.code, r.body.error.message]).toEqual([422, 'out_of_bounds', STEADY_REFUSALS.budget.message(43_196 + 180, 43_200)]);
    expect(docHash(pid)).toBe(before);
    expect(store.openJobs(STABILISE_JOB_TYPE)).toEqual([]);
  }, 60_000);
  it('409 stabilise_in_progress for the same file; 429 busy at five open vision jobs (tracking counts too)', async () => {
    const pid = project('busy');
    const a = await importInto(pid, shakyFile);
    const c1 = placeClip(pid, a, 0, 40), c2 = placeClip(pid, a, 40, 40, 40);
    const job = startStabiliseJob(store, gov, agent, pid, c1, {}, { readFrames: slowReader(40) });
    const r = await rest('POST', `/projects/${pid}/clips/${c2}/stabilise`, {});
    expect([r.status, r.body.error.code, r.body.error.message, r.body.error.details.jobId]).toEqual([409, 'stabilise_in_progress', STABILISE_SERVER_REFUSALS.inProgress.message(), job.id]);
    cancelStabiliseJob(store, job.id, 'test');
    await settle(job.id);
    const other = await importInto(pid, longFile);
    const c3 = placeClip(pid, other, 0, 30, 100);
    const rows = [0, 1, 2, 3, 4].map((k) => store.createJob(pid, k < 2 ? TRACKING_JOB_TYPE : STABILISE_JOB_TYPE, 'test', { assetId: `ast_x${k}` }));
    try {
      const b = await rest('POST', `/projects/${pid}/clips/${c3}/stabilise`, {});
      expect([b.status, b.body.error.code, b.body.error.message]).toEqual([429, 'busy', STABILISE_SERVER_REFUSALS.busy.message()]);
    } finally { for (const j of rows) store.updateJob(j.id, { status: 'canceled', stage: null }); }
  }, 60_000);
});

describe('the job', () => {
  it('runs on a real H.264 file: stages, the operation decides the end, one transaction (after W2: one undo returns the document)', async () => {
    const pid = project('run');
    const a = await importInto(pid, shakyFile);
    const c = placeClip(pid, a, 0, 90);
    const before = docHash(pid), rev = store.getProject(pid).revision;
    const stages: string[] = [];
    const onJob = (j: JobRow) => { if (j.stage) stages.push(j.stage); };
    store.events.on('job', onJob);
    const lag = monitorEventLoopDelay({ resolution: 10 });
    lag.enable();
    const r = await rest('POST', `/projects/${pid}/clips/${c}/stabilise`, {});
    expect(r.status).toBe(202);
    const job = await settle(r.body.jobId);
    lag.disable();
    store.events.off('job', onJob);
    console.log(`[stabilise job] 90 frames of 320×180: ${job.status}; event-loop delay p50 ${(lag.percentile(50) / 1e6).toFixed(1)} ms, p99 ${(lag.percentile(99) / 1e6).toFixed(1)} ms (one sample, recorded, not gated)`);
    expect(store.getJob(job.id).input).toMatchObject({ clipId: c, assetId: a, from: 0, to: 90, strength: 50, maxCrop: 15, input: 'proxy' });
    expect(stages[0]).toBe('reading frames');
    expect(stages).toContain('saving camera motion');
    expect(stages.some((s) => /^measuring camera motion \d+\/90$/.test(s))).toBe(true);
    expectOpOutcome(job);
    if (!STEADY_OPS_BUILT) { expect(store.getProject(pid).revision).toBe(rev); expect(docHash(pid)).toBe(before); return; }
    // after W2: the measurement and the switch in one transaction, one undo returns the document from before the press
    expect(job.output).toMatchObject({ assetId: a, clipId: c, measuredFrames: 90, readFrames: 90, applied: true });
    expect(store.getProject(pid).revision).toBe(rev + 1);
    const m = store.getProject(pid).doc.analyses[a]!.cameraMotion!;
    expect(m.stretches).toHaveLength(1);
    expect(m.stretches[0]!.st.slice(1).every((s) => s === SST.ok)).toBe(true);
    expect(m.stretches[0]!.origin).toMatchObject({ createdBy: agent.actor, params: { algo: STEADY_ALGO, input: 'original' } });
    const undo = await rest('POST', `/projects/${pid}/undo`, {});
    expect(undo.status).toBe(200);
    expect(docHash(pid)).toBe(before);
  }, 180_000);

  it('the operation refuses (before W2 notBuilt; after W2 tooLittle on a flat picture): failed with its refusal and details, nothing attached', async () => {
    const pid = project('refused');
    const a = await importInto(pid, STEADY_OPS_BUILT ? flatFile : shakyFile);
    const c = placeClip(pid, a, 0, 60);
    const before = docHash(pid);
    const job = await settle(startStabiliseJob(store, gov, agent, pid, c, {}).id);
    expect(job.status).toBe('failed');
    if (STEADY_OPS_BUILT) expect([job.error.code, job.error.message]).toEqual(['incompatible', expect.stringMatching(/^only \d+% of this clip's frames could be measured/)]);
    else expect(job.error.code).toBe(STEADY_REFUSALS.notBuilt.code);
    expect(docHash(pid)).toBe(before);
    expect(store.getProject(pid).doc.analyses[a]?.cameraMotion).toBeUndefined();
  }, 120_000);

  it('the clip deleted while the job runs: failed clip_changed, the document as the deletion left it, nothing attached', async () => {
    const pid = project('deleted');
    const a = await importInto(pid, shakyFile);
    const c = placeClip(pid, a, 0, 90);
    const job = startStabiliseJob(store, gov, agent, pid, c, {}, { readFrames: slowReader(15) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('measuring'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'delete_clip', args: { clipId: c } }] });
    const after = docHash(pid);
    const done = await settle(job.id);
    expect([done.status, done.error.code, done.error.message]).toEqual(['failed', 'clip_changed', STABILISE_SERVER_REFUSALS.clipChanged.message()]);
    expect(docHash(pid)).toBe(after);
  }, 120_000);

  it('cancel mid-run: canceled within 2 s, its ffmpeg gone, nothing attached; a second cancel says already-finished', async () => {
    const pid = project('cancel');
    const a = await importInto(pid, shakyFile);
    const c = placeClip(pid, a, 0, 90);
    const job = startStabiliseJob(store, gov, agent, pid, c, {}, { readFrames: slowReader(40) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('measuring'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    const file = store.blobPath(store.getProject(pid).doc.assets[a]!.contentHash);
    expect(ffmpegOn(file).length).toBeGreaterThan(0);
    const before = docHash(pid);
    const t0 = performance.now();
    expect((await rest('POST', `/jobs/${job.id}/cancel`, {})).body).toMatchObject({ status: 'cancel-requested', outcome: 'stopping' });
    const done = await settle(job.id, 10_000);
    expect(done.status).toBe('canceled');
    expect(done.error.message).toMatch(/nothing attached/);
    expect(performance.now() - t0).toBeLessThanOrEqual(2000);
    expect(ffmpegOn(file)).toEqual([]);
    expect(docHash(pid)).toBe(before);
    expect((await tool('cancel_job', { jobId: job.id })).text).toContain('already-finished');
  }, 60_000);

  it('restart mid-run: recovery measures again from the start and ends as an uninterrupted run (after W2: the same measurement, attached once)', async () => {
    const once = project('once'), again = project('again');
    const a1 = await importInto(once, shakyFile), a2 = await importInto(again, shakyFile);
    const c1 = placeClip(once, a1, 0, 60), c2 = placeClip(again, a2, 0, 60);
    const j1 = await settle(startStabiliseJob(store, gov, agent, once, c1, {}).id);
    // as startStabiliseJob would have written it, then the process "died" while it ran
    const interrupted = store.createJob(again, STABILISE_JOB_TYPE, agent.actor, { clipId: c2, assetId: a2, from: 0, to: 90, strength: 50, maxCrop: 15, input: 'proxy', analysisVersion: null, projectRevision: store.getProject(again).revision });
    store.updateJob(interrupted.id, { status: 'running', stage: 'measuring camera motion 30/90' });
    const log: { from: number; to: number; frames: number }[] = [];
    expect(recoverStabiliseJobs(store, { readFrames: countingReader(log) })).toBe(1);
    const j2 = await settle(interrupted.id);
    expect(log).toEqual([{ from: 0, to: 90, frames: 90 }]);
    expect([j2.status, j2.error?.code ?? null]).toEqual([j1.status, j1.error?.code ?? null]);
    expectOpOutcome(j2);
    if (STEADY_OPS_BUILT) expect(JSON.stringify(store.getProject(again).doc.analyses[a2]!.cameraMotion!.stretches.map(({ origin, ...s }) => s))).toBe(JSON.stringify(store.getProject(once).doc.analyses[a1]!.cameraMotion!.stretches.map(({ origin, ...s }) => s)));
  }, 180_000);

  it('shutdown stops the work and leaves the row running, to be measured again after the restart', async () => {
    const pid = project('shutdown');
    const a = await importInto(pid, shakyFile);
    const c = placeClip(pid, a, 0, 90);
    const job = startStabiliseJob(store, gov, agent, pid, c, {}, { readFrames: slowReader(30) });
    for (let i = 0; !String(store.getJob(job.id).stage).startsWith('measuring'); i++) { if (i > 4000) throw new Error('never started'); await sleep(5); }
    const before = docHash(pid);
    await stopStabiliseJobs(store);
    expect(store.getJob(job.id).status).toBe('running');
    expect(docHash(pid)).toBe(before);
    expect(recoverStabiliseJobs(store)).toBe(1);
    expectOpOutcome(await settle(job.id));
  }, 180_000);

  it('frames already measured with the same algo and input are not read again (a second clip of the same file)', async () => {
    const pid = project('second');
    const a = await importInto(pid, longFile);
    seedMotion(pid, a, 0, 135, 'original'); // what the first clip [0, 60) left: its frames and the 75-frame margin
    const c = placeClip(pid, a, 150, 60, 100); // range [75, 240): only [134, 240) is read, joined on frame 134
    const log: { from: number; to: number; frames: number }[] = [];
    const job = await settle(startStabiliseJob(store, gov, agent, pid, c, {}, { readFrames: countingReader(log) }).id);
    expect(log).toEqual([{ from: 134, to: 240, frames: 106 }]);
    expectOpOutcome(job);
    if (STEADY_OPS_BUILT) {
      expect(job.output).toMatchObject({ measuredFrames: 106, readFrames: 106 });
      const s = store.getProject(pid).doc.analyses[a]!.cameraMotion!.stretches;
      expect(s.map((x) => [x.from, x.st.length, x.st[134]])).toEqual([[0, 240, SST.ok]]); // one stretch; frame 134 kept its old sample
    }
  }, 120_000);
});

describe('the read view', () => {
  it('GET …/camera-motion equals MCP get_camera_motion: ranges, counts, review, usedBy, note; never the columns', async () => {
    const pid = project('view');
    const a = fakeVideo(pid, 400);
    const z = (n: number) => new Array(n).fill(0);
    store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_camera_motion', args: { assetId: a, from: 10, dx: z(8), dy: z(8), dr: z(8), dz: z(8), st: [SST.start, SST.ok, SST.weak, SST.weak, SST.ok, SST.unknown, SST.start, SST.ok], method: 'seed', params: { algo: STEADY_ALGO, input: 'original' }, createdAt: 'x' } }] });
    const r = await rest('GET', `/projects/${pid}/assets/${a}/camera-motion`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ assetId: a, stretches: [{ from: 10, to: 18, origin: { method: 'seed' } }], counts: { unknown: 1, ok: 3, weak: 2, start: 2 }, usedBy: [] });
    expect(r.body.review).toEqual([{ from: 12, to: 14, state: 'weak' }, { from: 15, to: 16, state: 'unknown' }, { from: 16, to: 17, state: 'start' }]);
    expect(r.body.note).toMatch(/no AI model/);
    expect(r.body.note).toMatch(/rolling-shutter/);
    expect(JSON.stringify(r.body)).not.toMatch(/"dx"|"st"/);
    const m = await tool('get_camera_motion', { projectId: pid, assetId: a });
    expect(m.isError).toBe(false);
    expect(JSON.parse(m.text)).toEqual(r.body);
    const none = fakeVideo(pid, 50);
    expect((await rest('GET', `/projects/${pid}/assets/${none}/camera-motion`)).body).toMatchObject({ stretches: [], counts: { unknown: 0, ok: 0, weak: 0, start: 0 }, review: [], usedBy: [] });
    expect((await rest('GET', `/projects/${pid}/assets/ast_none/camera-motion`)).status).toBe(404);
  });
});
