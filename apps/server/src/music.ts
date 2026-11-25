/**
 * Built-in music on the server (ADR-0022): queue, validate, store and commit. Every sample is made under music/ (render.ts);
 * this file defines no synthesis function (test M9 asserts it).
 *
 * - makeMusic stores the WAV like makeSfx (content hash, storage ceiling, describeMedia) with
 *   provenance.procedural { id: style id, version: style version, generator: MUSIC_GENERATOR, params: musicProvenanceParams },
 *   sets asset.duration = T.rt(layout.totalFrames, 48000) EXACTLY (ffprobe's six decimals cannot hold the thirds of a second of
 *   72 and 90 BPM; the probe must agree within 1e-6 s) and returns the track's known grid (knownGridOf).
 * - addMusic is ONE commit of the internal add_builtin_music (allowInternal) after gov.assertMayAct(edit) +
 *   assertUnrestricted('add media to the library') + the storage ceiling. An agent in propose mode is refused as templates.ts
 *   refuses it (403 insufficient_scope: a proposal cannot carry an internal step).
 * - musicPreview: at most 32 bars; its own queue (one render at a time, a few waiting); previews only are cached, capped by bytes
 *   (64 MB); a render is cancelled when the request is aborted or after a time limit (RenderOptions.cancel).
 * - Errors: 404 not_found (style), 400 invalid_option (bars / fitSeconds / seed; both or neither length), 429 synthesis_busy,
 *   500 music_invalid (validateMusic), 503 music_timeout (a render stopped at its time limit), 507/413 as the storage ceiling
 *   reports today.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import {
  barsForDuration, findMusicStyle, knownGridOf, MUSIC_GENERATOR, MUSIC_MAX_SEED, MUSIC_SAMPLE_RATE, musicLayout, musicProvenanceParams, MusicRequestSchema, RationalTimeSchema,
  type AddBuiltinMusicOutput, type Asset, type KnownGrid, type MusicLayout, type MusicRequest, type MusicStyle,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { describeMedia } from './ingest.ts';
import { assertStorageRoom } from './storage.ts';
import { ApiError, type CommitResult, type Store } from './store.ts';
import { MusicCancelled, renderMusic, type RenderedMusic } from './music/render.ts';

export type { RenderedMusic } from './music/render.ts';
/** The highest peak a valid track may have (the master's soft clip never exceeds 2/3). */
export const MUSIC_PEAK_LIMIT = 0.667;
/** The most bars a preview may have. */
export const MUSIC_PREVIEW_MAX_BARS = 32;
/**
 * The refusal of a build without the synthesiser. This build has it, so nothing answers with this any more; it stays exported
 * because the wording table (packages/i18n/src/packs.ts) and its test name it.
 */
export const musicNotBuilt = () => new ApiError(501, 'music_not_built', 'built-in music is not built in this version yet', {}, 'Use a music file from the library (musicAssetId), or a template without music.');

const invalid = (why: string, details: Record<string, unknown> = {}) => new ApiError(500, 'music_invalid', `the built-in music that was made did not pass its check: ${why}`, details, 'This is a fault in this build, not in your request. Nothing was stored.');
/** Throws ApiError 500 music_invalid unless: wav.length === 44 + 4 · layout.totalFrames, every sample finite, peak <= MUSIC_PEAK_LIMIT, first and last frame 0. */
export function validateMusic(r: RenderedMusic): void {
  const { wav, layout } = r;
  const frames = layout.totalFrames;
  if (wav.length !== 44 + 4 * frames) throw invalid(`the file has ${wav.length} bytes instead of ${44 + 4 * frames}`, { bytes: wav.length, expected: 44 + 4 * frames });
  const header = wav.toString('ascii', 0, 4) === 'RIFF' && wav.toString('ascii', 8, 16) === 'WAVEfmt ' && wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 2
    && wav.readUInt32LE(24) === MUSIC_SAMPLE_RATE && wav.readUInt16LE(34) === 16 && wav.toString('ascii', 36, 40) === 'data' && wav.readUInt32LE(40) === 4 * frames && wav.readUInt32LE(4) === 36 + 4 * frames;
  if (!header) throw invalid('its WAV header is not 48 kHz stereo 16-bit PCM of the expected length');
  if (!Number.isFinite(r.peak) || !Number.isFinite(r.rms)) throw invalid('its level is not a finite number');
  // 16-bit samples are finite by construction; the peak is measured again from the bytes, not taken from the renderer
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let peak = 0;
  for (let o = 44; o < wav.length; o += 2) { const v = dv.getInt16(o, true); const a = v < 0 ? -v : v; if (a > peak) peak = a; }
  if (peak / 32768 > MUSIC_PEAK_LIMIT) throw invalid(`its peak ${(peak / 32768).toFixed(4)} is above ${MUSIC_PEAK_LIMIT}`, { peak: peak / 32768 });
  if (dv.getInt32(44, true) !== 0 || dv.getInt32(wav.length - 4, true) !== 0) throw invalid('its first or last frame is not silent');
}

// ---------- the queue: one render at a time; previews cached by bytes ----------

export type MusicLane = 'preview' | 'add';
export interface MusicQueueLimits {
  /** previews that may wait for a turn */ maxWaitingPreviews: number;
  /** adds that may wait for a turn (their own places) */ maxWaitingAdds: number;
  /** bytes of finished previews held in memory */ cacheBytes: number;
  /** a preview render is stopped after this long */ previewTimeoutMs: number;
  /** an add render is stopped after this long */ addTimeoutMs: number;
  retryAfterSeconds: number;
}
export interface MusicQueue {
  /**
   * The track for (style, bars, seed). A preview comes from memory when it was made recently (and an add may reuse it: the
   * bytes are the same). A request for a track that is already being made in the same lane shares that render. Otherwise it
   * takes a turn: one render runs at a time, adds before previews; when its lane's waiting places are full it is refused with
   * 429 synthesis_busy. `signal`: the caller no longer wants it; a render nobody wants any more is cancelled. `endFrames` (wave 7
   * musicfit): an exact ending in sample frames; part of the key only when given (callers leave it out for a one-bar ending).
   */
  render(styleId: string, bars: number, seed: number, lane: MusicLane, signal?: AbortSignal, endFrames?: number): Promise<RenderedMusic>;
  /** For tests: what is held and waiting. */
  stats(): { running: boolean; waiting: Record<MusicLane, number>; cached: number; cachedBytes: number };
}
type Renderer = (styleId: string, bars: number, seed: number, opts: { cancel: { cancelled: boolean }; endFrames?: number }) => Promise<RenderedMusic>;
export function createMusicQueue(limits: Partial<MusicQueueLimits> = {}, renderer: Renderer = renderMusic): MusicQueue {
  const L: MusicQueueLimits = { maxWaitingPreviews: 4, maxWaitingAdds: 8, cacheBytes: 64 * 1024 * 1024, previewTimeoutMs: 60_000, addTimeoutMs: 180_000, retryAfterSeconds: 2, ...limits };
  interface Job { lane: MusicLane; cancel: { cancelled: boolean }; reason: 'timeout' | 'abandoned' | null; wanted: number; hasTurn: boolean; started: boolean; go: () => void; leave: () => void; promise: Promise<RenderedMusic> }
  const cache = new Map<string, RenderedMusic>();
  let cachedBytes = 0;
  const inFlight = new Map<string, Job>();
  const waiting: Record<MusicLane, Job[]> = { add: [], preview: [] };
  let running = false;
  /** A finished (or abandoned) turn goes straight to the next waiter, adds first. */
  const next = () => {
    const job = waiting.add.shift() ?? waiting.preview.shift();
    if (job) job.go(); else running = false;
  };
  const remember = (key: string, r: RenderedMusic) => {
    if (r.wav.length > L.cacheBytes) return;
    cache.set(key, r);
    cachedBytes += r.wav.length;
    for (const [k, v] of cache) { if (cachedBytes <= L.cacheBytes) break; cache.delete(k); cachedBytes -= v.wav.length; }
  };
  const want = (job: Job, signal?: AbortSignal) => {
    job.wanted++;
    signal?.addEventListener('abort', () => {
      if (--job.wanted > 0 || job.started) { if (job.wanted <= 0) { job.reason = 'abandoned'; job.cancel.cancelled = true; } return; }
      job.reason = 'abandoned';
      job.cancel.cancelled = true;
      if (!job.hasTurn) { const list = waiting[job.lane]; const i = list.indexOf(job); if (i >= 0) list.splice(i, 1); job.leave(); }
    }, { once: true });
  };
  return {
    render(styleId, bars, seed, lane, signal, endFrames) {
      const key = `${styleId}\n${bars}\n${seed}${endFrames === undefined ? '' : `\n${endFrames}`}`;
      const hit = cache.get(key);
      if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); }
      if (signal?.aborted) return Promise.reject(cancelledError());
      const id = `${lane}\n${key}`;
      const shared = inFlight.get(id);
      if (shared && !shared.cancel.cancelled) { want(shared, signal); return shared.promise; }
      if (running && waiting[lane].length >= (lane === 'add' ? L.maxWaitingAdds : L.maxWaitingPreviews))
        return Promise.reject(new ApiError(429, 'synthesis_busy', 'too many pieces of built-in music are being made at the moment; this one was not started', { waiting: waiting[lane].length, retryAfterSeconds: L.retryAfterSeconds }, `Wait ${L.retryAfterSeconds} s and ask again.`));
      let release!: () => void;
      const turn = new Promise<void>((resolve) => { release = resolve; });
      const job: Job = { lane, cancel: { cancelled: false }, reason: null, wanted: 0, hasTurn: false, started: false, go: () => { job.hasTurn = true; release(); }, leave: () => release(), promise: undefined as never };
      if (running) waiting[lane].push(job); else { running = true; job.go(); }
      job.promise = (async () => {
        await turn;
        if (!job.hasTurn) throw cancelledError(); // it left the line before its turn
        if (job.cancel.cancelled) { next(); throw cancelledError(); }
        job.started = true;
        const timer = setTimeout(() => { job.reason = 'timeout'; job.cancel.cancelled = true; }, lane === 'add' ? L.addTimeoutMs : L.previewTimeoutMs);
        try {
          const r = await renderer(styleId, bars, seed, { cancel: job.cancel, ...(endFrames === undefined ? {} : { endFrames }) });
          if (lane === 'preview') remember(key, r);
          return r;
        } catch (e) {
          if (e instanceof MusicCancelled) throw job.reason === 'timeout' ? new ApiError(503, 'music_timeout', 'making the built-in music took too long and was stopped', { styleId, bars }, 'The machine is very busy; try again shortly, or ask for fewer bars.') : cancelledError();
          throw e;
        } finally {
          clearTimeout(timer);
          next();
        }
      })().finally(() => { if (inFlight.get(id) === job) inFlight.delete(id); });
      want(job, signal);
      inFlight.set(id, job);
      return job.promise;
    },
    stats: () => ({ running, waiting: { add: waiting.add.length, preview: waiting.preview.length }, cached: cache.size, cachedBytes }),
  };
}
const cancelledError = () => new ApiError(503, 'music_cancelled', 'the built-in music was not made: the request was cancelled', {}, 'Ask again if you still want it.');
/** The one queue of this server process. */
export const musicQueue = createMusicQueue();

// ---------- requests ----------

/** The style, layout and seed of a request; the request errors of the routes (404 not_found, 400 invalid_option). */
export function resolveMusicRequest(req: MusicRequest): { style: MusicStyle; layout: MusicLayout; seed: number } {
  const style = findMusicStyle(req.styleId);
  if (!style) throw new ApiError(404, 'not_found', `there is no built-in music style "${req.styleId}"`, { styleId: req.styleId }, 'GET /api/v1/music (or list_catalog → music) lists the styles.');
  if ((req.bars === undefined) === (req.fitSeconds === undefined)) throw new ApiError(400, 'invalid_option', 'give exactly one of bars and fitSeconds', { bars: req.bars ?? null, fitSeconds: req.fitSeconds ?? null }, 'bars: a whole number of bars; fitSeconds: the length to cover, "n" or "n/d" seconds, rounded up to whole bars.');
  const seed = req.seed ?? 1;
  if (!Number.isInteger(seed) || seed < 0 || seed > MUSIC_MAX_SEED) throw new ApiError(400, 'invalid_option', `a seed is a whole number from 0 to ${MUSIC_MAX_SEED}`, { seed });
  let bars = req.bars;
  if (req.fitSeconds !== undefined) {
    const m = /^(\d+)(?:\/(\d+))?$/.exec(req.fitSeconds);
    if (!m || Number(m[1]) <= 0 || (m[2] !== undefined && Number(m[2]) <= 0)) throw new ApiError(400, 'invalid_option', 'fitSeconds is a positive number of seconds written "n" or "n/d"', { fitSeconds: req.fitSeconds });
    bars = barsForDuration(style.id, T.rt(Number(m[1]), m[2] === undefined ? 1 : Number(m[2])));
  }
  if (req.endFrames !== undefined && req.fitSeconds !== undefined) throw new ApiError(400, 'invalid_option', 'endFrames goes together with bars, not with fitSeconds', { endFrames: req.endFrames }, 'Ask for bars and endFrames (exactLayoutFor gives both), or for fitSeconds alone.');
  try {
    return { style, layout: musicLayout(style.id, bars!, req.endFrames), seed };
  } catch (e) {
    if (e instanceof RangeError) throw new ApiError(400, 'invalid_option', e.message, { styleId: style.id, bars });
    throw e;
  }
}

/** The ending in sample frames when it is not one bar (wave 7 musicfit), else undefined: a one-bar ending is today's request exactly. */
export const exactEnding = (layout: MusicLayout): number | undefined => (layout.endFrames === layout.meter * layout.samplesPerBeat ? undefined : layout.endFrames);
/**
 * The library name of a track: "Pop · 16 bars.wav" with the default ending (as before wave 7); with an exact ending the whole bars
 * before the final chord and the ending in seconds, rounded to a tenth for reading only: "Pop · 15 bars + ending 1.4 s.wav".
 */
export function musicFileName(style: Pick<MusicStyle, 'name'>, layout: MusicLayout): string {
  const end = exactEnding(layout);
  if (end === undefined) return `${style.name.en} · ${layout.bars} bars.wav`;
  return `${style.name.en} · ${layout.bars - 1} bars + ending ${(Math.round(end / 4800) / 10).toFixed(1)} s.wav`;
}
/** Synthesise, validate and store one track; the asset is not attached to any project yet. */
export async function makeMusic(store: Store, req: MusicRequest, actor: string, queue: MusicQueue = musicQueue): Promise<{ asset: Omit<Asset, 'id'>; grid: KnownGrid; layout: MusicLayout }> {
  const { style, layout, seed } = resolveMusicRequest(req);
  const r = await queue.render(style.id, layout.bars, seed, 'add', undefined, exactEnding(layout));
  validateMusic(r);
  const bytes = r.wav;
  const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  // a track that is not stored yet needs room under the ceiling; one that is already stored needs none
  if (!fs.existsSync(store.blobPath(contentHash))) assertStorageRoom(store, bytes.length, 'store this music');
  const tmp = path.join(store.tmpDir, `music_${randomBytes(6).toString('hex')}.wav`);
  try {
    fs.writeFileSync(tmp, bytes);
    const meta = await describeMedia(tmp);
    const duration = T.rt(layout.totalFrames, MUSIC_SAMPLE_RATE);
    if (meta.kind !== 'audio' || !meta.audio || Math.abs(T.toSeconds(meta.duration) - T.toSeconds(duration)) > 1e-6) throw invalid('the file as read back does not have the length that was made', { probed: T.toSeconds(meta.duration), made: T.toSeconds(duration) });
    store.putBlob(contentHash, tmp, bytes.length, meta.mimeType);
    const importedAt = new Date().toISOString();
    const asset: Omit<Asset, 'id'> = {
      ...meta, duration, name: musicFileName(style, layout), contentHash, byteSize: bytes.length,
      provenance: { origin: 'generated', importedAt, importedBy: actor, procedural: { id: style.id, version: style.version, generator: MUSIC_GENERATOR, params: musicProvenanceParams(layout, seed) } },
    };
    return { asset, grid: knownGridOf(layout, seed, importedAt), layout };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** WAV bytes for listening before adding (bars <= 32). Nothing is stored. */
export async function musicPreview(styleId: string, bars: number, seed: number, opts: { signal?: AbortSignal; queue?: MusicQueue } = {}): Promise<Buffer> {
  if (!Number.isInteger(bars) || bars < 1 || bars > MUSIC_PREVIEW_MAX_BARS) {
    if (!findMusicStyle(styleId)) throw new ApiError(404, 'not_found', `there is no built-in music style "${styleId}"`, { styleId });
    throw new ApiError(400, 'invalid_option', `a preview is 1 to ${MUSIC_PREVIEW_MAX_BARS} whole bars`, { bars });
  }
  const { style, layout } = resolveMusicRequest({ styleId, bars, seed });
  const r = await (opts.queue ?? musicQueue).render(style.id, layout.bars, seed, 'preview', opts.signal);
  validateMusic(r);
  return r.wav;
}

/** POST /api/v1/projects/:id/music: a request plus, optionally, where to place one clip of the track. */
export const MusicBody = MusicRequestSchema.extend({ start: RationalTimeSchema.optional(), trackId: z.string().optional() }).strict();
export type MusicBodyInput = z.infer<typeof MusicBody>;
export interface AddMusicResult { assetId: string; clipId: string | null; revision: number; bars: number; seconds: number; sections: MusicLayout['sections'] }
/** May this principal add built-in music to this project now? (Checked before making the track and again before committing it.) */
function mayAdd(gov: Governance, principal: Principal, projectId: string) {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind === 'agent' && principal.mode === 'propose') throw new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and built-in music cannot be proposed: it is added through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask the project owner to add it, or for a grant in edit mode.');
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'add media to the library');
}
/** One commit of add_builtin_music (see the header). */
export async function addMusic(store: Store, gov: Governance, principal: Principal, projectId: string, body: MusicBodyInput, queue: MusicQueue = musicQueue): Promise<AddMusicResult> {
  mayAdd(gov, principal, projectId);
  store.getProject(projectId);
  const { start, trackId, ...req } = body;
  const made = await makeMusic(store, req, principal.actor, queue);
  // making the track took time: the right to act is checked again before anything is written
  mayAdd(gov, principal, projectId);
  const r = gov.commitAs(principal, {
    projectId, allowInternal: true, label: `Add built-in music ${made.asset.name}`.slice(0, 120),
    ops: [{ op: 'add_builtin_music', args: { asset: made.asset, grid: made.grid, ...(start ? { place: { start, ...(trackId ? { trackId } : {}) } } : {}) } }],
  }) as CommitResult;
  const out = (r.results[0]?.output ?? {}) as unknown as AddBuiltinMusicOutput;
  return { assetId: out.assetId, clipId: out.clipId ?? null, revision: r.revision, bars: made.layout.bars, seconds: T.toSeconds(made.layout.duration), sections: made.layout.sections };
}
