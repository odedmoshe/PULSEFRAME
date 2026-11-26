/**
 * The moments job (wave 5 family film, ADR-0026): the model-free measurement of candidate moments of video files, declared in
 * core momentsContract.ts (the reader, the maths, the gates, the cache and the job rules are stated there with the verifier's
 * corrections). Heuristic («היוריסטיקה»): measured motion, sharpness, brightness and sound level with fixed rules; no model,
 * faces are not used. A durable job of type MOMENTS_JOB_TYPE on its own lane (limiter(1, 4)), modelled on the tracking job
 * (tracking.ts: start, run, cancel, recover, stop; stage momentsStage, written at most every 500 ms).
 *
 * Per asset, in the order asked:
 * - between assets the job waits while a server export runs (deps.lane.waitForExportIdle);
 * - it waits (cancelable, at most MOMENTS_WAIT_DERIVATIVE_MS) for a waveform row that is queued or running;
 * - cache (core momentsCacheState): 'hit' = the stored data file is used as it is (no decode); 'add-sound' = the stored picture
 *   series is reused and only the sound is measured; 'miss' (or overwrite) = it waits likewise for the proxy, then decodes
 *   every S-th frame of the editing proxy (frameSource of tracking.ts; the original when the proxy failed or does not apply);
 * - the data file (MomentsData, compact JSON, no clock in it, so the same bytes give the same digest) is stored with
 *   Derivatives.put as kind 'moments';
 * - files longer than MOMENTS_MAX_MEDIA_SECONDS are measured up to that (trim=end_frame before select) and marked truncated;
 * - an asset removed meanwhile is skipped ('removed'), a file that cannot be decoded or delivers the wrong number of samples is
 *   skipped ('decode_failed'), a missing stored file is skipped ('not_found'), a still or sound file is skipped ('no_video').
 * At the end ONE store.commit of attach_moments (allowInternal, the job's actor) for every asset still in the project whose
 * record differs; nothing awaited between the last checks and the commit. A canceled or failed job attaches nothing.
 * Permission as tracking: gov.assertMayAct edit and assertUnrestricted. At most MOMENTS_MAX_OPEN_JOBS open jobs per server
 * (429 busy) and one per project (409 moments_in_progress). Started only by the film dialog's plan step or the MCP tool
 * measure_moments, never on import. CPU work yields after every sample and holds the shared `heavy` slot in chunks.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MOMENTS_ALGO, MOMENTS_DERIVATIVE_KIND, MOMENTS_HOP_MS, MOMENTS_JOB_TYPE, MOMENTS_LONG_SIDE, MOMENTS_MAX_MEDIA_SECONDS, MOMENTS_MAX_OPEN_JOBS, MOMENTS_METHOD, MOMENTS_METHOD_LONG, MOMENTS_WAIT_DERIVATIVE_MS, isMovingPicture, momentsCacheState, momentsExpectedSamples, momentsStage, momentsStep, startOffsetFrames, videoFrames, type Asset, type MomentsData, type MomentsDerivativeMeta, type MomentsItem, type MomentsJobInput, type MomentsJobOutput, type MOMENTS_SKIP_REASONS, type PictureSeries, type ProjectDocument, type SoundSeries, type StartMomentsBody } from '@pulseframe/core';
import { heavy, limiter } from './analysis.ts';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import type { FifoComputeLane } from './lane.ts';
import { findMoments, pictureGates, pictureSample, soundLevels, type PictureSample } from './moments.math.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { frameSource, HEAVY_CHUNK, READ_STALL_MS } from './tracking.ts';
import type { FrameSource, GreyFrame } from './vision/types.ts';

/** Picture samples of `src`: sample k is source frame k*step, for k*step < maxFrames, grey at long side MOMENTS_LONG_SIDE; SIGKILL on abort. */
export type ReadSamples = (src: FrameSource, step: number, maxFrames: number, onSample: (k: number, frame: GreyFrame) => void | Promise<void>, signal: AbortSignal) => Promise<{ samples: number; digest: string }>;
export interface MomentsDeps {
  derivatives: Pick<Derivatives, 'get' | 'put'>;
  /** Between assets the job waits while a server export runs (ADR-0017 lane). */
  lane?: Pick<FifoComputeLane, 'waitForExportIdle'>;
  /** Tests may wrap the reader; default: ffmpeg as stated in momentsContract.ts. */
  readSamples?: ReadSamples;
}

/** The lane to wait on between assets, when the given object is one (the exporter holds the server's FifoComputeLane, typed narrowly). */
export const momentsLaneOf = (lane: unknown): Pick<FifoComputeLane, 'waitForExportIdle'> | undefined =>
  lane && typeof (lane as { waitForExportIdle?: unknown }).waitForExportIdle === 'function' ? (lane as Pick<FifoComputeLane, 'waitForExportIdle'>) : undefined;

/** The refusal of builds without the measurement. Kept (unused here) for the wording table: packages/evals/src/family-film-wording.test.ts provokes it. */
export const momentsNotBuilt = () => new ApiError(501, 'moments_not_built', 'measuring moments is not built in this version yet', {}, 'Nothing was measured. The film can still be planned: clips without measured moments take the middle of the file and say so.');

export class MomentsCanceled extends Error { constructor() { super('canceled'); } }
type SkipReason = (typeof MOMENTS_SKIP_REASONS)[number];
const STAGE_EVERY_MS = 500;
const POLL_MS = 250;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const yieldNow = () => new Promise<void>((r) => setImmediate(r));
const own = <V>(o: Record<string, V>, k: string): V | undefined => (Object.hasOwn(o, k) ? o[k] : undefined);

/** The grey size the job reads: long side MOMENTS_LONG_SIDE (never enlarged), even sides, in proportion. */
export function momentsSize(width: number, height: number): { width: number; height: number } {
  const s = Math.min(1, MOMENTS_LONG_SIDE / Math.max(width, height));
  return { width: even(width * s), height: even(height * s) };
}

/**
 * The reader, with the output pixel format as a parameter so a test can read the same samples in colour (rgb24) and check the
 * film fixture's chroma-only barcode; the job always reads grey. ffmpeg with an argument array, no shell:
 * [trim=end_frame=N,]select='not(mod(n\,S))',scale=W:H:flags=area,format=gray, -fps_mode passthrough, rawvideo to a pipe.
 * select counts decoded pictures, so sample k is source frame k*S exactly. The count must be ceil(min(frames, N)/S)
 * (frame_count_mismatch otherwise). A reader that delivers nothing for READ_STALL_MS is killed (decode_failed).
 */
export async function readSampleFrames(src: FrameSource, step: number, maxFrames: number, onSample: (k: number, frame: GreyFrame) => void | Promise<void>, signal: AbortSignal, pixFmt: 'gray' | 'rgb24' = 'gray'): Promise<{ samples: number; digest: string }> {
  if (!Number.isInteger(step) || step < 1 || !Number.isInteger(maxFrames) || maxFrames < 1) throw new ApiError(422, 'invalid_range', `cannot read every ${step}th of ${maxFrames} frames`, { step, maxFrames });
  if (signal.aborted) throw new MomentsCanceled();
  const { width: W, height: H } = momentsSize(src.width, src.height);
  const trim = maxFrames < src.frameCount ? `trim=end_frame=${maxFrames},` : '';
  const expected = momentsExpectedSamples(src.frameCount, maxFrames, step);
  const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', src.file, '-map', '0:v:0', '-an', '-vf', `${trim}select='not(mod(n\\,${step}))',scale=${W}:${H}:flags=area,format=${pixFmt}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const kill = () => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); };
  let stalled = false, spawnError: Error | null = null, err = '';
  let timer = setTimeout(() => { stalled = true; kill(); }, READ_STALL_MS);
  const onAbort = () => kill();
  signal.addEventListener('abort', onAbort, { once: true });
  p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
  const closed = new Promise<{ code: number | null; sig: NodeJS.Signals | null }>((resolve) => {
    p.on('close', (code, sig) => resolve({ code, sig }));
    p.on('error', (e) => { spawnError = e; resolve({ code: null, sig: null }); });
  });
  const size = W * H * (pixFmt === 'rgb24' ? 3 : 1);
  const hash = createHash('sha256');
  let buf = Buffer.alloc(size), have = 0, k = 0;
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(size - have, chunk.length - off);
        chunk.copy(buf, have, off, off + n);
        have += n; off += n;
        if (have < size) break;
        const data = new Uint8Array(buf.buffer, buf.byteOffset, size);
        hash.update(data);
        if (k >= expected) throw new ApiError(422, 'frame_count_mismatch', `ffmpeg delivered more than the ${expected} samples expected`, { expected });
        await onSample(k, { width: W, height: H, data });
        k++;
        buf = Buffer.alloc(size); have = 0;
        clearTimeout(timer);
        timer = setTimeout(() => { stalled = true; kill(); }, READ_STALL_MS);
        if (signal.aborted) throw new MomentsCanceled();
      }
    }
    const { code, sig } = await closed;
    if (signal.aborted) throw new MomentsCanceled();
    if (spawnError) throw new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${(spawnError as Error).message}`);
    if (stalled) throw new ApiError(422, 'decode_failed', 'reading the picture stalled and was stopped', {});
    if (code !== 0) throw new ApiError(422, 'decode_failed', `ffmpeg could not decode the ${src.kind}`, { exit: code ?? sig, tail: err.trim().slice(-400) });
    if (have !== 0 || k !== expected) throw new ApiError(422, 'frame_count_mismatch', `ffmpeg delivered ${k} samples of the ${src.kind}; expected ${expected}`, { expected, got: k });
    return { samples: k, digest: hash.digest('hex') };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    kill();
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]); // return only once ffmpeg is gone
  }
}
/** The job's reader: grey samples. */
export const readSamples: ReadSamples = (src, step, maxFrames, onSample, signal) => readSampleFrames(src, step, maxFrames, onSample, signal, 'gray');

let selfChecked: Promise<void> | null = null;
/** One white and one black picture through the reader's filter chain: grey must come out >= 250 and <= 5 (full range). Run once per process. */
export function momentsSelfCheck(): Promise<void> {
  const one = (colour: string) => new Promise<number[]>((resolve, reject) => execFile('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=64x36:r=1:d=1,format=yuv420p`, '-vf', 'scale=32:18:flags=area,format=gray', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', timeout: 30_000 }, (e, out) => (e ? reject(e) : resolve([...(out as Buffer)]))));
  selfChecked ??= (async () => {
    try {
      const [w, b] = await Promise.all([one('white'), one('black')]);
      if (w.length !== 32 * 18 || b.length !== 32 * 18 || Math.min(...w) < 250 || Math.max(...b) > 5) throw new Error(`white read as ${Math.min(...w)}..${Math.max(...w)}, black as ${Math.min(...b)}..${Math.max(...b)}`);
    } catch (e) {
      selfChecked = null;
      throw new ApiError(503, 'analysis_unavailable', `ffmpeg's grey output failed the moments self-check (${(e as Error).message}); nothing was measured`, {}, 'Check that ffmpeg is installed and on the PATH.');
    }
  })();
  return selfChecked;
}

// ---------- the cache and the record ----------
const recordOf = (doc: ProjectDocument, assetId: string) => own(doc.analyses, assetId)?.moments;
/** The asset's record in the document equals the stored data file and that file is current (not stale): nothing to measure. */
function isCurrent(doc: ProjectDocument, asset: Asset, d: MomentsDeps['derivatives']): boolean {
  const rec = recordOf(doc, asset.id);
  const row = d.get(asset.contentHash, MOMENTS_DERIVATIVE_KIND);
  const wave = d.get(asset.contentHash, 'waveform');
  return !!rec && rec.algo === MOMENTS_ALGO && row?.status === 'ready' && row.blobHash === rec.data && momentsCacheState(row.meta as Partial<MomentsDerivativeMeta> | null, wave?.status === 'ready') === 'hit';
}
/** Key-order-independent JSON. */
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v));
function sameRecord(rec: ReturnType<typeof recordOf>, item: MomentsItem): boolean {
  if (!rec) return false;
  const a = { algo: rec.algo, data: rec.data, measured: rec.measured, file: rec.file, flat: rec.flat, windows: rec.windows, truncated: !!rec.truncated };
  const b = { algo: item.algo, data: item.data, measured: item.measured, file: item.file, flat: item.flat, windows: item.windows, truncated: !!item.truncated };
  return canon(a) === canon(b);
}
const itemOf = (assetId: string, blobHash: string, m: MomentsData): MomentsItem => ({
  assetId, algo: MOMENTS_ALGO, data: blobHash, measured: { picture: !!m.picture, sound: !!m.sound }, file: { ...m.file }, flat: m.flat,
  windows: m.windows.map((w) => ({ ...w, basis: [...w.basis] })), ...(m.asset.truncated ? { truncated: true } : {}),
});

// ---------- jobs ----------
const momentsLane = limiter(1, 4);
interface Running { store: Store; ac: AbortController; done: Promise<void>; shutdown: boolean }
const running = new Map<string, Running>();

/** Start a measurement (202 with the job), or answer { cached: true, revision } when every asset already has a current record and overwrite is not set. */
export function startMomentsJob(store: Store, gov: Governance, principal: Principal, projectId: string, body: StartMomentsBody, deps: MomentsDeps): JobRow | { cached: true; revision: number } {
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'measure moments (it attaches analyses)');
  const p = store.getProject(projectId);
  const ids = [...new Set(body.assetIds)];
  const missing = ids.filter((id) => !own(p.doc.assets, id));
  if (missing.length) throw new ApiError(404, 'not_found', `${missing.length === 1 ? 'asset' : 'assets'} ${missing.slice(0, 10).join(', ')} not found`, { assetIds: missing.slice(0, 60) }, 'get_summary lists the library files.');
  const moving = ids.filter((id) => isMovingPicture(own(p.doc.assets, id)));
  if (!moving.length) throw new ApiError(422, 'no_video', 'none of these files has a moving picture, so there are no moments to measure', { assetIds: ids }, 'Moments are measured for video files only; a still is shown whole.');
  if (!body.overwrite && moving.every((id) => isCurrent(p.doc, p.doc.assets[id]!, deps.derivatives))) return { cached: true, revision: p.revision };
  const open = store.openJobs(MOMENTS_JOB_TYPE);
  const same = open.find((j) => j.projectId === projectId);
  if (same) throw new ApiError(409, 'moments_in_progress', 'the moments of this project are already being measured', { jobId: same.id, status: same.status }, 'Wait for that job, or cancel it first.');
  if (open.length >= MOMENTS_MAX_OPEN_JOBS) throw new ApiError(429, 'busy', 'too many measurements are already running or waiting; try again shortly', { retryAfterSeconds: 30 });
  const input: MomentsJobInput = { assetIds: ids, ...(body.overwrite ? { overwrite: true as const } : {}), projectRevision: p.revision };
  const job = store.createJob(projectId, MOMENTS_JOB_TYPE, principal.actor, input);
  setImmediate(() => void runMomentsJob(store, job.id, deps)); // the answer reports the job as it is: queued
  return store.getJob(job.id);
}

/** Cancel: a queued job is removed; a running one stops (ffmpeg is killed) and attaches nothing. */
export function cancelMomentsJob(store: Store, jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
  const j = store.getJob(jobId);
  if (j.type !== MOMENTS_JOB_TYPE) throw new ApiError(409, 'invalid_request', `job ${jobId} is not a moments job`);
  if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
  const r = running.get(jobId);
  if (j.status === 'queued' || !r) {
    store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: j.status === 'queued' ? `canceled by ${actor} before it started; nothing attached` : `canceled by ${actor}; nothing attached` } });
    r?.ac.abort();
    return { jobId, status: 'canceled', outcome: j.status === 'queued' ? 'removed-from-queue' : 'stopped' };
  }
  store.updateJob(jobId, { status: 'cancel-requested' });
  r.ac.abort();
  return { jobId, status: 'cancel-requested', outcome: 'stopping' };
}

/** After a restart: jobs left running are measured again (cached files make that cheap); a cancel asked for before the restart is honoured. Returns how many were restarted. */
export function recoverMomentsJobs(store: Store, deps: MomentsDeps): number {
  for (const j of store.openJobs(MOMENTS_JOB_TYPE)) if (j.status === 'cancel-requested') store.updateJob(j.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
  const jobs = store.recoverJobs(MOMENTS_JOB_TYPE);
  for (const j of jobs) void runMomentsJob(store, j.id, deps);
  return jobs.length;
}

/** Server shutdown: stop this store's moments work without marking it (the rows stay running and are measured again after a restart). */
export async function stopMomentsJobs(store: Store): Promise<void> {
  const mine = [...running.values()].filter((r) => r.store === store);
  for (const r of mine) { r.shutdown = true; r.ac.abort(); }
  await Promise.all(mine.map((r) => r.done.catch(() => {})));
}

export function runMomentsJob(store: Store, jobId: string, deps: MomentsDeps): Promise<void> {
  const prior = running.get(jobId);
  if (prior) return prior.done;
  const r: Running = { store, ac: new AbortController(), done: Promise.resolve(), shutdown: false };
  running.set(jobId, r);
  r.done = (async () => {
    let started = false;
    try {
      for (;;) {
        try {
          await momentsLane(async () => { started = true; await work(store, jobId, deps, r.ac.signal); });
          return;
        } catch (e) {
          if (!started && e instanceof ApiError && e.code === 'busy' && !r.ac.signal.aborted) { await sleep(1000); continue; } // the lane's queue was full: the job stays queued
          throw e;
        }
      }
    } catch (e) {
      if (r.shutdown) return;
      try {
        if (['succeeded', 'failed', 'canceled'].includes(store.getJob(jobId).status)) return; // e.g. canceled while queued: keep that record
        if (e instanceof MomentsCanceled || r.ac.signal.aborted || store.getJob(jobId).status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing attached' } });
        else {
          if (!(e instanceof ApiError)) console.error(e);
          store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'measuring moments failed unexpectedly; nothing attached' } });
        }
      } catch (e2) { console.error(e2); }
    } finally {
      running.delete(jobId);
    }
  })();
  return r.done;
}

/** Hold the shared heavy slot until the returned release is called (as tracking does); a cancel while waiting rejects at once. */
function holdHeavy(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (settled) return false; settled = true; signal.removeEventListener('abort', onAbort); fn(); return true; };
    const onAbort = () => settle(() => reject(new MomentsCanceled()));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const attempt = () => {
      if (settled) return;
      heavy(() => new Promise<void>((release) => { if (!settle(() => resolve(release))) release(); }))
        .catch((e) => { if (settled) return; if (e instanceof ApiError && e.code === 'busy') setTimeout(attempt, 250); else settle(() => reject(e)); });
    };
    attempt();
  });
}
/** Wait (cancelable, at most MOMENTS_WAIT_DERIVATIVE_MS) while a derivative row is queued or running. */
async function waitForRow(d: MomentsDeps['derivatives'], hash: string, kind: 'proxy' | 'waveform', signal: AbortSignal): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const row = d.get(hash, kind);
    if (!row || (row.status !== 'queued' && row.status !== 'running') || Date.now() - t0 > MOMENTS_WAIT_DERIVATIVE_MS) return;
    await sleep(POLL_MS);
    if (signal.aborted) throw new MomentsCanceled();
  }
}

/** The sound series of an asset from its waveform's level 0, cut to the measured frames (null without a ready waveform). */
function soundOf(store: Store, d: MomentsDeps['derivatives'], asset: Asset, measuredFrames: number, truncated: boolean): SoundSeries | null {
  const wave = d.get(asset.contentHash, 'waveform');
  if (wave?.status !== 'ready' || !wave.blobHash) return null;
  const meta = wave.meta as { totalSamples?: number; levels?: { samplesPerBucket: number; buckets: number; byteOffset: number }[] } | null;
  const l0 = meta?.levels?.[0];
  if (!l0 || l0.samplesPerBucket !== 256 || !meta?.totalSamples) return null;
  const file = store.blobPath(wave.blobHash);
  if (!fs.existsSync(file)) return null;
  const bytes = fs.readFileSync(file);
  const peaks = new Int16Array(l0.buckets * 2);
  for (let i = 0; i < peaks.length && l0.byteOffset + 2 * i + 1 < bytes.length; i++) peaks[i] = bytes.readInt16LE(l0.byteOffset + 2 * i);
  let level = soundLevels(peaks, meta.totalSamples);
  if (truncated && asset.video) {
    const r = asset.video.frameRate, end = measuredFrames + startOffsetFrames(asset.video);
    level = level.slice(0, Math.ceil((end * r.den * (1000 / MOMENTS_HOP_MS)) / r.num));
  }
  return { source: 'waveform-peaks', hopMs: MOMENTS_HOP_MS, count: level.length, level };
}

type Measured = { item: MomentsItem; cached: boolean; mediaSeconds: number } | { skip: SkipReason };

/** Measure one asset (or use its cache) and store the data file; see the file header. */
async function measureAsset(store: Store, asset: Asset, deps: MomentsDeps, overwrite: boolean, signal: AbortSignal, onDecoded: () => void): Promise<Measured> {
  const d = deps.derivatives, v = asset.video!, rate = v.frameRate, off = startOffsetFrames(v);
  const total = videoFrames(asset)!;
  const N = Math.min(total, Math.max(1, Math.floor((MOMENTS_MAX_MEDIA_SECONDS * rate.num) / rate.den)));
  const truncated = total > N;
  const mediaSeconds = (N * rate.den) / rate.num;
  await waitForRow(d, asset.contentHash, 'waveform', signal);
  const row = d.get(asset.contentHash, MOMENTS_DERIVATIVE_KIND);
  let picture: PictureSeries | null = null;
  if (!overwrite && row?.status === 'ready' && row.blobHash) {
    const state = momentsCacheState(row.meta as Partial<MomentsDerivativeMeta> | null, d.get(asset.contentHash, 'waveform')?.status === 'ready');
    let old: MomentsData | null = null;
    try { old = JSON.parse(fs.readFileSync(store.blobPath(row.blobHash), 'utf8')) as MomentsData; } catch { old = null; }
    const fits = old && old.algo === MOMENTS_ALGO && old.asset?.contentHash === asset.contentHash && old.asset.measuredFrames === N;
    if (fits && state === 'hit') return { item: itemOf(asset.id, row.blobHash, old!), cached: true, mediaSeconds };
    if (fits && state === 'add-sound' && old!.picture) picture = old!.picture;
  }
  if (!picture) {
    await waitForRow(d, asset.contentHash, 'proxy', signal);
    const src = frameSource(store, d, asset, 'proxy');
    if (!fs.existsSync(src.file)) return { skip: 'not_found' };
    await momentsSelfCheck();
    const step = momentsStep(rate), sps = rate.num / rate.den / step;
    const read = deps.readSamples ?? readSamples;
    const samples: PictureSample[] = [];
    let prev: GreyFrame | null = null, size = { width: 0, height: 0 };
    let release = await holdHeavy(signal), inHold = 0;
    let digest = '';
    onDecoded();
    try {
      const r = await read(src, step, N, async (k, frame) => {
        if (k !== samples.length) throw new ApiError(422, 'frame_count_mismatch', `sample ${k} arrived out of order`, { k });
        samples.push(pictureSample(prev, frame, sps));
        prev = frame; size = { width: frame.width, height: frame.height };
        await yieldNow();
        if (signal.aborted) throw new MomentsCanceled();
        if (++inHold >= HEAVY_CHUNK) { release(); release = () => {}; inHold = 0; release = await holdHeavy(signal); }
      }, signal);
      digest = r.digest;
      if (r.samples !== momentsExpectedSamples(total, N, step) || samples.length !== r.samples) return { skip: 'decode_failed' };
    } catch (e) {
      if (e instanceof MomentsCanceled || signal.aborted) throw new MomentsCanceled();
      if (e instanceof ApiError && e.status === 422) return { skip: 'decode_failed' };
      throw e;
    } finally { release(); }
    const col = <K extends keyof PictureSample>(key: K) => samples.map((s) => s[key]);
    const luma = col('luma') as number[], sharp = col('sharp') as number[], inner = col('inner') as number[], pan = col('pan') as number[], change = col('change') as number[];
    picture = { source: src.kind, step, count: samples.length, width: size.width, height: size.height, luma, sharp, inner, pan, change, gated: pictureGates({ luma, sharp, inner, pan, change, border: col('border') as boolean[] }), digest };
  }
  const sound = soundOf(store, d, asset, N, truncated);
  const found = findMoments(picture, sound, { frames: N, rate, startOffsetFrames: off });
  const data: MomentsData = {
    algo: MOMENTS_ALGO, method: MOMENTS_METHOD_LONG,
    asset: { contentHash: asset.contentHash, frames: total, rate: { num: rate.num, den: rate.den }, startOffsetFrames: off, measuredFrames: N, truncated },
    picture, sound, file: found.file, flat: found.flat, windows: found.windows,
  };
  if (signal.aborted) throw new MomentsCanceled();
  const tmp = path.join(store.tmpDir, `mo_${randomBytes(8).toString('hex')}.json`);
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  const meta: MomentsDerivativeMeta = { algo: MOMENTS_ALGO, picture: picture.source, sound: !!sound, samples: picture.count, hops: sound?.count ?? 0, truncated };
  let stored;
  try { stored = await d.put(asset.contentHash, MOMENTS_DERIVATIVE_KIND, tmp, 'application/json', meta as unknown as Record<string, unknown>); } finally { fs.rmSync(tmp, { force: true }); }
  if (signal.aborted) throw new MomentsCanceled();
  return { item: itemOf(asset.id, stored.blobHash!, data), cached: false, mediaSeconds };
}

async function work(store: Store, jobId: string, deps: MomentsDeps, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new MomentsCanceled(); // canceled or shut down while it waited for the lane
  const job = store.getJob(jobId);
  if (job.status !== 'queued') return; // canceled while it waited
  const input = job.input as MomentsJobInput;
  const total = input.assetIds.length;
  let lastStage = -Infinity;
  const stage = (done: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastStage < STAGE_EVERY_MS) return;
    const status = store.getJob(jobId).status;
    if (signal.aborted || (status !== 'queued' && status !== 'running')) throw new MomentsCanceled(); // a cancel is never overwritten with 'running'
    lastStage = now;
    store.updateJob(jobId, { status: 'running', stage: momentsStage(done, total) });
  };
  stage(0, true);
  const t0 = performance.now();
  const items = new Map<string, MomentsItem>();
  const skipped: MomentsJobOutput['skipped'] = [];
  let measured = 0, cached = 0, mediaSeconds = 0;
  for (const [i, assetId] of input.assetIds.entries()) {
    if (i > 0 && deps.lane) {
      try { await deps.lane.waitForExportIdle(signal); } catch (e) { if (signal.aborted) throw new MomentsCanceled(); throw e; }
    }
    if (signal.aborted) throw new MomentsCanceled();
    const asset = own(store.getProject(job.projectId).doc.assets, assetId);
    if (!asset) skipped.push({ assetId, reason: 'removed' });
    else if (!isMovingPicture(asset)) skipped.push({ assetId, reason: 'no_video' });
    else {
      const r = await measureAsset(store, asset, deps, !!input.overwrite, signal, () => stage(i));
      if ('skip' in r) skipped.push({ assetId, reason: r.skip });
      else { items.set(assetId, r.item); mediaSeconds += r.mediaSeconds; if (r.cached) cached++; else measured++; }
    }
    stage(i + 1, i + 1 === total);
  }
  // attach only what is still in the project and differs; nothing is awaited from here to the commit and the job's success
  const status = store.getJob(jobId).status;
  if (signal.aborted || status !== 'running') throw new MomentsCanceled();
  const p = store.getProject(job.projectId);
  const attach: MomentsItem[] = [];
  for (const [assetId, item] of items) {
    if (!own(p.doc.assets, assetId)) { skipped.push({ assetId, reason: 'removed' }); continue; }
    if (!sameRecord(recordOf(p.doc, assetId), item)) attach.push(item);
  }
  let revision: number | null = null;
  if (attach.length) revision = store.commit({ projectId: job.projectId, actor: job.actor, label: 'Measure moments', allowInternal: true, ops: [{ op: 'attach_moments', args: { method: MOMENTS_METHOD, createdAt: new Date().toISOString(), items: attach } }] }).revision;
  const output: MomentsJobOutput = { measured, cached, attached: attach.length, revision, skipped, wallSeconds: Number(((performance.now() - t0) / 1000).toFixed(3)), mediaSeconds: Number(mediaSeconds.toFixed(3)) };
  store.updateJob(jobId, { status: 'succeeded', stage: null, output });
}
