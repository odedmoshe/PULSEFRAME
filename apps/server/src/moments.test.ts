/**
 * The moments job (ADR-0026) on the film fixtures (packages/fixtures/src/film.ts, imported by relative path): the reader's
 * numbering against the chroma barcode (proxy, original, the late picture, a truncated read), the measurement recovering every
 * truth window and keeping the decoy and the dark stretch out, the data file (shape, size, determinism), the cache (a second
 * run decodes nothing and gives the same data hash), the lifecycle (one revision for N assets), cancel while queued and while
 * running (ffmpeg killed, nothing attached), recovery after a simulated restart, an asset removed mid-run, and the refusals.
 * Real Store, Derivatives (proxies and waveforms made by ffmpeg) and Governance; no server port. Needs ffmpeg.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOMENTS_DATA_BYTES_PER_MINUTE, MOMENTS_JOB_TYPE, MOMENTS_MAX_OPEN_JOBS, MOMENTS_MAX_WINDOWS, momentsStep, type MomentsData, type MomentsJobOutput, type ProjectDocument } from '@pulseframe/core';
import { filmBarcodeValue, generateFilmFixtures, readFilmBarcode, type FilmFixtureTruth } from '../../../packages/fixtures/src/film.ts';
import { Derivatives } from './derive.ts';
import { Governance, type Principal } from './governance.ts';
import { describeMedia } from './ingest.ts';
import { cancelMomentsJob, readSampleFrames, readSamples, recoverMomentsJobs, startMomentsJob, stopMomentsJobs, type MomentsDeps, type ReadSamples } from './moments.ts';
import { Store, type JobRow } from './store.ts';
import { frameSource } from './tracking.ts';

const USER: Principal = { actor: 'user:owner', kind: 'user', scopes: ['observe', 'edit'] };
const R30 = { num: 30, den: 1 }, S = momentsStep(R30);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let dir = '', fx = '', store: Store, derivatives: Derivatives, gov: Governance, truth: FilmFixtureTruth;
const deps = (extra: Partial<MomentsDeps> = {}): MomentsDeps => ({ derivatives, ...extra });
const terminal = (s: string) => ['succeeded', 'failed', 'canceled'].includes(s);
async function settle(jobId: string, ms = 240_000): Promise<JobRow> {
  const t0 = Date.now();
  for (;;) { const j = store.getJob(jobId); if (terminal(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${jobId} still ${j.status} (${j.stage})`); await sleep(25); }
}
async function until(cond: () => boolean, ms = 120_000) { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await sleep(10); } }
const sha = (file: string) => `sha256:${createHash('sha256').update(fs.readFileSync(file)).digest('hex')}`;
async function importInto(projectId: string, file: string): Promise<string> {
  const meta = await describeMedia(file);
  const contentHash = sha(file), copy = path.join(store.tmpDir, `in_${randomBytes(4).toString('hex')}`);
  fs.copyFileSync(file, copy);
  store.putBlob(contentHash, copy, fs.statSync(file).size, meta.mimeType);
  const asset = { ...meta, name: path.basename(file), contentHash, byteSize: fs.statSync(file).size, provenance: { origin: 'upload' as const, importedAt: '2026-12-06T12:00:00.000Z', importedBy: 'test' } };
  const id = store.commit({ projectId, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
  derivatives.ensure(store.getProject(projectId).doc.assets[id]!);
  return id;
}
const project = async (name: string, files: string[]) => {
  const pid = store.createProject({ name, width: 640, height: 360, frameRate: R30 }).doc.id;
  const ids: string[] = [];
  for (const f of files) ids.push(await importInto(pid, path.join(fx, f)));
  return { pid, ids };
};
const doc = (pid: string): ProjectDocument => store.getProject(pid).doc;
const rev = (pid: string) => store.getProject(pid).revision;
const dataOf = (hash: string): { data: MomentsData; bytes: number } => { const raw = fs.readFileSync(store.blobPath(hash)); return { data: JSON.parse(raw.toString('utf8')) as MomentsData, bytes: raw.length }; };
/** ffmpeg processes whose command line names this file (Linux /proc). */
const ffmpegOn = (file: string) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return c.startsWith('ffmpeg') && c.includes(file); } catch { return false; } });
/** The real reader, counted and optionally slowed per sample (instrumentation, not a mock). */
function counted(ms = 0, onSample?: (src: Parameters<ReadSamples>[0], k: number) => void): { read: ReadSamples; calls: () => number } {
  let n = 0;
  return { read: (src, step, max, cb, signal) => { n++; return readSamples(src, step, max, async (k, f) => { onSample?.(src, k); if (ms) await sleep(ms); await cb(k, f); }, signal); }, calls: () => n };
}

let main: { pid: string; ids: string[] };
const clipFiles = () => truth.clips.map((c) => c.name);
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-moments-'));
  fx = path.join(dir, 'fixtures');
  truth = await generateFilmFixtures({ outDir: fx });
  store = new Store(dir);
  derivatives = new Derivatives(store);
  gov = new Governance(store);
  main = await project('film', [...clipFiles(), truth.still.name]);
  await derivatives.idle();
}, 600_000);
afterAll(async () => {
  await stopMomentsJobs(store);
  await derivatives?.stop();
  store?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('the reader: sample k is source frame k*S (chroma barcode)', () => {
  it('on the proxy and the original, also for the picture that starts late, and when truncated', async () => {
    for (const c of truth.clips.filter((x) => x.startOffsetFrames || x.decoy || !x.sound)) {
      const asset = doc(main.pid).assets[main.ids[c.clip]!]!;
      expect(asset.video!.frameCount).toBe(c.frames);
      for (const want of ['proxy', 'original'] as const) {
        const src = frameSource(store, derivatives, asset, want);
        expect(src.kind).toBe(want);
        const got: number[] = [];
        const r = await readSampleFrames(src, S, c.frames, (k, f) => { got.push(readFilmBarcode(f.data, f.width, 3, { x: 0, y: 0, w: f.width, h: f.height })); }, new AbortController().signal, 'rgb24');
        expect(r.samples).toBe(Math.ceil(c.frames / S));
        expect(got).toEqual(Array.from({ length: r.samples }, (_, k) => filmBarcodeValue(c.clip, k * S)));
        const grey = await readSamples(src, S, c.frames, (_k, f) => { expect([f.width, f.height, f.data.length]).toEqual([320, 180, 320 * 180]); }, new AbortController().signal);
        expect(grey.samples).toBe(r.samples);
      }
      // truncated: trim=end_frame before select
      const src = frameSource(store, derivatives, asset, 'proxy'), got: number[] = [];
      const t = await readSampleFrames(src, S, 100, (_k, f) => { got.push(readFilmBarcode(f.data, f.width, 3, { x: 0, y: 0, w: f.width, h: f.height })); }, new AbortController().signal, 'rgb24');
      expect(t.samples).toBe(Math.ceil(100 / S));
      expect(got.at(-1)).toBe(filmBarcodeValue(c.clip, 96));
    }
  }, 180_000);
});

describe('the moments job on the film fixtures', () => {
  let job: JobRow, firstHashes: Record<string, string> = {};
  it('queued, running, succeeded: one new revision for six files; the still is skipped', async () => {
    const before = rev(main.pid);
    const statuses: string[] = [];
    const onJob = (j: JobRow) => { if (j.type === MOMENTS_JOB_TYPE && j.projectId === main.pid && statuses.at(-1) !== j.status) statuses.push(j.status); };
    store.events.on('job', onJob);
    const r = startMomentsJob(store, gov, USER, main.pid, { assetIds: main.ids }, deps());
    expect('cached' in r).toBe(false);
    job = r as JobRow;
    expect(job.status).toBe('queued');
    job = await settle(job.id);
    store.events.off('job', onJob);
    expect(job.status, JSON.stringify(job.error)).toBe('succeeded');
    expect(statuses).toEqual(['running', 'succeeded']);
    const out = job.output as MomentsJobOutput;
    expect(out).toMatchObject({ measured: 6, cached: 0, attached: 6, revision: before + 1, skipped: [{ assetId: main.ids[6], reason: 'no_video' }] });
    expect(rev(main.pid)).toBe(before + 1);
    console.log(`[moments] measured ${out.mediaSeconds.toFixed(1)} s of media in ${out.wallSeconds.toFixed(2)} s: ${(out.mediaSeconds / out.wallSeconds).toFixed(1)} x real time (proxy reads, 6 fixture clips, shared machine)`);
    for (const id of main.ids.slice(0, 6)) firstHashes[id] = doc(main.pid).analyses[id]!.moments!.data;
  }, 300_000);
  it('recovers each truth window: peak inside, the clean stretch covers it minus 0.4 s each end, peaks >= 4 s apart, at most 4', () => {
    for (const c of truth.clips) {
      const m = doc(main.pid).analyses[main.ids[c.clip]!]!.moments!;
      expect(m.windows.length).toBeLessThanOrEqual(MOMENTS_MAX_WINDOWS);
      for (const a of m.windows) for (const b of m.windows) if (a !== b) expect(Math.abs(a.peakFrame - b.peakFrame)).toBeGreaterThanOrEqual(120);
      expect(m.measured).toEqual({ picture: true, sound: c.sound });
      if (c.truth) {
        const w = m.windows[0]!;
        expect(w.peakFrame, c.name).toBeGreaterThanOrEqual(c.truth.fromFrame);
        expect(w.peakFrame, c.name).toBeLessThan(c.truth.toFrame);
        expect(w.fromFrame, c.name).toBeLessThanOrEqual(c.truth.fromFrame + 12);
        expect(w.toFrame, c.name).toBeGreaterThanOrEqual(c.truth.toFrame - 12);
        expect(w.basis).toContain('inner-motion');
        if (c.sound) { expect(w.basis).toContain('sound'); expect(w.burstFrame!).toBeGreaterThanOrEqual(c.truth.fromFrame - 3); expect(w.burstFrame!).toBeLessThan(c.truth.fromFrame + 6); }
      } else {
        expect(m.flat, c.name).toBe(true);
        if (c.activeShare >= 0.8) expect(m.file.motion!).toBeGreaterThanOrEqual(15); // active throughout
        else expect(m.file.motion!).toBeLessThan(15);
      }
      console.log(`[moments] ${c.name}: flat ${m.flat}, file ${JSON.stringify(m.file)}, windows ${JSON.stringify(m.windows.map((w) => [w.fromFrame, w.peakFrame, w.toFrame, w.motion, w.level, w.burstFrame ?? null]))}; truth ${JSON.stringify(c.truth)}`);
    }
  });
  it('keeps the decoy and the dark stretch out of every window; the data file shows them gated', () => {
    for (const c of truth.clips.filter((x) => x.decoy || x.dark)) {
      const range = (c.decoy ?? c.dark)!;
      const m = doc(main.pid).analyses[main.ids[c.clip]!]!.moments!;
      for (const w of m.windows) expect(w.toFrame <= range.fromFrame || w.fromFrame >= range.toFrame, c.name).toBe(true);
      const { data } = dataOf(m.data);
      for (let k = Math.ceil(range.fromFrame / S); k * S < range.toFrame; k++) expect(data.picture!.gated[k], `${c.name} sample ${k}`).toBe(1);
    }
  });
  it('the data file parses as MomentsData, is under 12 kB per media minute, and has sound only where the file has sound', () => {
    for (const c of truth.clips) {
      const m = doc(main.pid).analyses[main.ids[c.clip]!]!.moments!;
      const { data, bytes } = dataOf(m.data);
      expect(data).toMatchObject({ algo: 1, asset: { frames: c.frames, rate: R30, startOffsetFrames: c.startOffsetFrames, measuredFrames: c.frames, truncated: false }, flat: m.flat, windows: m.windows, file: m.file });
      const p = data.picture!;
      expect(p).toMatchObject({ source: 'proxy', step: S, count: Math.ceil(c.frames / S), width: 320, height: 180 });
      for (const k of ['luma', 'sharp', 'inner', 'pan', 'change', 'gated'] as const) { expect(p[k].length).toBe(p.count); expect(p[k].every(Number.isInteger)).toBe(true); }
      expect(p.digest).toMatch(/^[0-9a-f]{64}$/);
      if (c.sound) {
        expect(data.sound).toMatchObject({ source: 'waveform-peaks', hopMs: 100 });
        expect(Math.abs(data.sound!.count - Math.ceil(((c.frames + c.startOffsetFrames) / 30) * 10))).toBeLessThanOrEqual(1); // the decoded AAC may run a few ms long
        expect(data.sound!.level.length).toBe(data.sound!.count);
      }
      else expect(data.sound).toBeNull();
      // The budget is read per STARTED media minute: a file holds about 1.1 kB that does not grow with its length (the method
      // text, the hashes, the windows), so a 14 s clip cannot be under 12 kB x 14/60. What grows with the length, the per-sample
      // series, must stay under 12 kB per minute on its own.
      const minutes = c.frames / 30 / 60;
      const series = JSON.stringify([data.picture, data.sound]).length;
      console.log(`[moments] ${c.name}: data file ${bytes} B (${Math.round(bytes / minutes)} B per media minute; series ${Math.round(series / minutes)} B per minute)`);
      expect(bytes).toBeLessThan(MOMENTS_DATA_BYTES_PER_MINUTE * Math.max(1, Math.ceil(minutes)));
      expect(series / minutes).toBeLessThan(MOMENTS_DATA_BYTES_PER_MINUTE);
    }
  });
  it('a second run is a cache hit: nothing decoded, the same data hash', async () => {
    const r = startMomentsJob(store, gov, USER, main.pid, { assetIds: main.ids }, deps());
    expect(r).toEqual({ cached: true, revision: rev(main.pid) });
    // without the records (undo), the job runs again from the stored data files: zero reader calls, the same hashes
    store.undo(main.pid, USER.actor, 'undo');
    expect(doc(main.pid).analyses[main.ids[0]!]?.moments).toBeUndefined();
    const c = counted();
    const j = await settle((startMomentsJob(store, gov, USER, main.pid, { assetIds: main.ids }, deps({ readSamples: c.read })) as JobRow).id);
    expect(j.status).toBe('succeeded');
    expect(c.calls()).toBe(0);
    expect(j.output).toMatchObject({ measured: 0, cached: 6, attached: 6 });
    for (const id of main.ids.slice(0, 6)) expect(doc(main.pid).analyses[id]!.moments!.data).toBe(firstHashes[id]);
  }, 120_000);
  it('is deterministic: measuring the same bytes again gives the same JSON digest and attaches nothing new', async () => {
    const before = rev(main.pid);
    const c = counted();
    const j = await settle((startMomentsJob(store, gov, USER, main.pid, { assetIds: main.ids, overwrite: true }, deps({ readSamples: c.read })) as JobRow).id);
    expect(j.status).toBe('succeeded');
    expect(c.calls()).toBe(6);
    expect(j.output).toMatchObject({ measured: 6, attached: 0, revision: null });
    expect(rev(main.pid)).toBe(before);
    for (const id of main.ids.slice(0, 6)) expect(derivatives.get(doc(main.pid).assets[id]!.contentHash, 'moments')!.blobHash).toBe(firstHashes[id]);
  }, 300_000);
});

describe('cancel, recovery and a removed asset', () => {
  it('cancel while queued; cancel while running kills ffmpeg, attaches nothing and leaves the revision unchanged', async () => {
    const a = await project('cancel-a', ['film-b.mp4', 'film-c.mp4']);
    const b = await project('cancel-b', ['film-d.mp4']);
    await derivatives.idle();
    const revA = rev(a.pid), revB = rev(b.pid);
    let reading = '';
    const slow = counted(40, (src) => { reading = src.file; });
    const ja = startMomentsJob(store, gov, USER, a.pid, { assetIds: a.ids, overwrite: true }, deps({ readSamples: slow.read })) as JobRow;
    await until(() => reading !== '' && ffmpegOn(reading).length > 0);
    // the lane runs one measurement at a time: the second project's job waits in the queue
    const jb = startMomentsJob(store, gov, USER, b.pid, { assetIds: b.ids, overwrite: true }, deps()) as JobRow;
    await sleep(100);
    expect(store.getJob(jb.id).status).toBe('queued');
    expect(cancelMomentsJob(store, jb.id, USER.actor)).toMatchObject({ status: 'canceled', outcome: 'removed-from-queue' });
    expect(store.getJob(ja.id).status).toBe('running');
    expect(cancelMomentsJob(store, ja.id, USER.actor)).toMatchObject({ status: 'cancel-requested' });
    expect((await settle(ja.id)).status).toBe('canceled');
    expect((await settle(jb.id)).status).toBe('canceled');
    await until(() => ffmpegOn(reading).length === 0, 10_000);
    expect([rev(a.pid), rev(b.pid)]).toEqual([revA, revB]);
    for (const id of [...a.ids, ...b.ids]) expect(doc(a.ids.includes(id) ? a.pid : b.pid).analyses[id]?.moments).toBeUndefined();
    expect(cancelMomentsJob(store, ja.id, USER.actor).outcome).toBe('already-finished');
  }, 240_000);
  it('recovers after a simulated restart: a job left running is measured again; a cancel asked for before is honoured', async () => {
    const p = await project('recover', ['film-a.mp4', 'film-f.mp4']);
    const q = await project('recover-cancel', ['film-e.mp4']);
    await derivatives.idle();
    const left = store.createJob(p.pid, MOMENTS_JOB_TYPE, USER.actor, { assetIds: p.ids, projectRevision: rev(p.pid) });
    store.updateJob(left.id, { status: 'running', stage: 'measuring moments 1/2' });
    const asked = store.createJob(q.pid, MOMENTS_JOB_TYPE, USER.actor, { assetIds: q.ids, projectRevision: rev(q.pid) });
    store.updateJob(asked.id, { status: 'cancel-requested' });
    const before = rev(p.pid);
    expect(recoverMomentsJobs(store, deps())).toBe(1);
    expect(store.getJob(asked.id).status).toBe('canceled');
    const j = await settle(left.id);
    expect(j.status).toBe('succeeded');
    expect(j.output).toMatchObject({ attached: 2, revision: before + 1 });
    expect(doc(p.pid).analyses[p.ids[0]!]!.moments!.windows.length).toBeGreaterThan(0);
  }, 240_000);
  it('an asset removed mid-run is skipped and the rest are attached', async () => {
    const p = await project('removed', ['film-c.mp4', 'film-d.mp4', 'film-e.mp4']);
    await derivatives.idle();
    const third = p.ids[2]!;
    const second = doc(p.pid).assets[p.ids[1]!]!.contentHash;
    let removed = false;
    const reader = counted(0, (src, k) => {
      if (!removed && k === 0 && src.blobHash !== doc(p.pid).assets[p.ids[0]!]!.contentHash && src.file.length && derivatives.get(second, 'proxy')?.blobHash === src.blobHash) {
        removed = true;
        store.commit({ projectId: p.pid, actor: USER.actor, ops: [{ op: 'remove_asset', args: { assetId: third } }] });
      }
    });
    const before = rev(p.pid);
    const j = await settle((startMomentsJob(store, gov, USER, p.pid, { assetIds: p.ids, overwrite: true }, deps({ readSamples: reader.read })) as JobRow).id);
    expect(removed).toBe(true);
    expect(j.status, JSON.stringify(j.error)).toBe('succeeded');
    expect(j.output).toMatchObject({ measured: 2, attached: 2, revision: before + 2, skipped: [{ assetId: third, reason: 'removed' }] });
    expect(Object.keys(doc(p.pid).analyses).filter((id) => doc(p.pid).analyses[id]!.moments).sort()).toEqual([p.ids[0], p.ids[1]].sort());
  }, 240_000);
});

describe('stale cache: sound that arrived later', () => {
  it('measured while the waveform was missing, then measured again: the stored picture series is reused (no decode) and the sound is added', async () => {
    const p = await project('add-sound', ['film-c.mp4']);
    await derivatives.idle();
    const noWave: MomentsDeps['derivatives'] = { get: (h, k) => (k === 'waveform' ? null : derivatives.get(h, k)), put: (...a) => derivatives.put(...a) };
    const first = await settle((startMomentsJob(store, gov, USER, p.pid, { assetIds: p.ids, overwrite: true }, { derivatives: noWave }) as JobRow).id);
    expect(first.status).toBe('succeeded');
    const m1 = doc(p.pid).analyses[p.ids[0]!]!.moments!;
    expect(m1.measured).toEqual({ picture: true, sound: false });
    expect(derivatives.get(doc(p.pid).assets[p.ids[0]!]!.contentHash, 'moments')!.meta).toMatchObject({ sound: false, picture: 'proxy' });
    const c = counted();
    const second = await settle((startMomentsJob(store, gov, USER, p.pid, { assetIds: p.ids }, deps({ readSamples: c.read })) as JobRow).id);
    expect(second.status).toBe('succeeded');
    expect(c.calls()).toBe(0);
    const m2 = doc(p.pid).analyses[p.ids[0]!]!.moments!;
    expect(m2.measured).toEqual({ picture: true, sound: true });
    expect(dataOf(m2.data).data.picture).toEqual(dataOf(m1.data).data.picture);
    expect(m2.windows[0]!.burstFrame).toBeDefined();
  }, 240_000);
});

describe('refusals before anything runs', () => {
  it('an observe-only credential and a track-limited grant are refused; unknown and still-only lists are refused', async () => {
    const p = await project('perm', ['film-e.mp4', truth.still.name]);
    const before = rev(p.pid);
    const observer = gov.principalForToken(gov.createGrant({ name: 'obs', mode: 'observe' }, USER).token)!;
    const limited = gov.principalForToken(gov.createGrant({ name: 'lim', mode: 'edit', trackIds: ['trk_none'] }, USER).token)!;
    expect(() => startMomentsJob(store, gov, observer, p.pid, { assetIds: p.ids }, deps())).toThrow(expect.objectContaining({ status: 403, code: 'insufficient_scope' }));
    expect(() => startMomentsJob(store, gov, limited, p.pid, { assetIds: p.ids }, deps())).toThrow(expect.objectContaining({ status: 403, code: 'out_of_scope' }));
    expect(() => startMomentsJob(store, gov, USER, p.pid, { assetIds: ['ast_nope'] }, deps())).toThrow(expect.objectContaining({ status: 404, code: 'not_found' }));
    expect(() => startMomentsJob(store, gov, USER, p.pid, { assetIds: [p.ids[1]!] }, deps())).toThrow(expect.objectContaining({ status: 422, code: 'no_video' }));
    expect(store.openJobs(MOMENTS_JOB_TYPE).filter((j) => j.projectId === p.pid)).toEqual([]);
    expect(rev(p.pid)).toBe(before);
  });
  it('one open job per project (409 moments_in_progress) and at most three per server (429 busy)', async () => {
    const ps = await Promise.all([0, 1, 2, 3].map((i) => project(`busy-${i}`, ['film-e.mp4'])));
    const rows = ps.slice(0, MOMENTS_MAX_OPEN_JOBS).map((p) => store.createJob(p.pid, MOMENTS_JOB_TYPE, USER.actor, { assetIds: p.ids, projectRevision: rev(p.pid) }));
    try {
      expect(() => startMomentsJob(store, gov, USER, ps[0]!.pid, { assetIds: ps[0]!.ids, overwrite: true }, deps())).toThrow(expect.objectContaining({ status: 409, code: 'moments_in_progress' }));
      expect(() => startMomentsJob(store, gov, USER, ps[3]!.pid, { assetIds: ps[3]!.ids, overwrite: true }, deps())).toThrow(expect.objectContaining({ status: 429, code: 'busy' }));
    } finally {
      for (const r of rows) cancelMomentsJob(store, r.id, USER.actor);
    }
    expect(store.openJobs(MOMENTS_JOB_TYPE)).toEqual([]);
  });
});
