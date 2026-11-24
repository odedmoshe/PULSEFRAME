/**
 * Browser-side export (SPEC §9, ADR-0005): the SAME `evaluate` + `drawGraph` + `MediaPool` as the render worker,
 * encoded with WebCodecs through Mediabunny, under an explicit server-side tab lease.
 *
 *  - Capabilities are probed, never assumed: H.264 via WebCodecs; AAC if the browser can encode it, else Opus
 *    (declared in `substitutions`, never silent). If the video encoder is missing the export is refused BEFORE a job exists.
 *  - The job is created on the server with an immutable snapshot; heartbeats renew the lease. If the server says the
 *    lease is lost or a cancel was requested, or the caller aborts, encoding stops and resources are released.
 *  - Output goes to an in-memory BufferTarget (follow-up: StreamTarget -> OPFS/File System Access so memory is bounded by
 *    the muxer, not the file). Backpressure: every `add()` is awaited, so frames are never queued unboundedly.
 *  - Audio is mixed with an OfflineAudioContext from whole decoded assets (limitation: long media is decoded whole; a
 *    streaming AudioBufferSink path is the follow-up). The plan is made at the output rate, so every position is in samples of
 *    the rate the context renders at.
 *  - Clips with sound effects (ADR-0010) are not mixed by WebAudio: the shared engine voice (the same code as the server export
 *    and the preview) renders them from the decoded pieces, and its output is added sample by sample to the rendered buffer.
 *  - Every frame handed to the encoder is also read back and fed to the engine's FlashAnalyser (ADR-0009 decision 4), the same
 *    analysis the server export runs; the result goes to the server with the completion and is recorded on the job. It never
 *    changes or blocks the export.
 */
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource, WebMOutputFormat, canEncodeAudio, canEncodeVideo } from 'mediabunny';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { audioPlan, drawGraph, evaluate, FlashAnalyser, flashCells, fillPlayingOrder, initGpu, openClipVoice, RampResampler, rampSpanOf, soundEnd, stretchKeepingPitch, type PlannedAudioClip } from '@pulseframe/engine';
import { plannedClipInput, reversedBuffer } from './audioGraph.ts';
import { ensureFonts } from './fonts.ts';
import { MediaPool } from './media.ts';

export type BrowserExportErrorCode = 'browser_export_unsupported' | 'render_blocked' | 'canceled' | 'aborted' | 'lease_lost' | 'lease_not_owned' | 'export_failed' | 'server_error';
export class BrowserExportError extends Error {
  constructor(public code: BrowserExportErrorCode, message: string, public extra: { missing?: string[]; details?: unknown; jobId?: string } = {}) {
    super(message);
    this.name = 'BrowserExportError';
  }
  get missing() { return this.extra.missing; }
}

export interface BrowserCapabilities {
  video: { avc: boolean; vp9: boolean };
  audio: { aac: boolean; opus: boolean };
  userAgent: string;
  probedFor: { width: number; height: number; frameRate: number; sampleRate: number };
}
export interface BrowserExportPlan { container: 'mp4' | 'webm'; videoCodec: 'avc' | 'vp9'; audioCodec: 'aac' | 'opus'; substitutions: string[]; capabilities: BrowserCapabilities }
export interface BrowserExportProgress { stage: 'planning' | 'leased' | 'fonts' | 'audio' | 'rendering' | 'finalizing' | 'completing'; framesDone: number; total: number }
export interface BrowserExportResult { blob: Blob; jobId: string; videoCodec: string; audioCodec: string; container: string; frames: number; sha256: string; bytes: number; substitutions: string[]; capabilities: BrowserCapabilities; wallMs: number;
  /** Video decoders of this export: the most open at once, the budget, and how many pictures the budget refused (ADR-0011). */
  decoders: { peak: number; max: number; opened: number; disposed: number; refused: number };
  /** The photosensitivity check of the encoded frames (ADR-0009), as sent to the server with the completion. */
  photosensitivity: BrowserPhotosensitivity }
/** Failing stretches in timeline time (exact rationals). The server adds the method text when it records it. */
export interface BrowserPhotosensitivity { verdict: 'pass' | 'fail'; frames: number; ranges: { from: T.RationalTime; to: T.RationalTime; kind: 'general' | 'red'; flashesPerSecond: number; area: number }[] }
export interface BrowserExportRun {
  projectId: string;
  options?: Record<string, unknown>;
  apiBase?: string;
  sessionId?: string;
  onProgress?: (p: BrowserExportProgress) => void;
  signal?: AbortSignal;
  /** Called once the leased job exists (before any frame is rendered). */
  onJob?: (jobId: string, sessionId: string) => void;
  /** Test hook: stop rendering after N frames and never finish (heartbeats continue until the page is closed; nothing is abandoned). */
  freezeAfterFrames?: number;
}

export async function probeCapabilities(width: number, height: number, frameRate: number, sampleRate: number): Promise<BrowserCapabilities> {
  const v = (codec: 'avc' | 'vp9') => canEncodeVideo(codec, { width, height, frameRate }).catch(() => false);
  const a = (codec: 'aac' | 'opus') => canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: codec === 'opus' ? 48000 : sampleRate }).catch(() => false);
  const [avc, vp9, aac, opus] = await Promise.all([v('avc'), v('vp9'), a('aac'), a('opus')]);
  return { video: { avc, vp9 }, audio: { aac, opus }, userAgent: navigator.userAgent, probedFor: { width, height, frameRate, sampleRate } };
}

/** Pure decision from a capability report; exported for the proof. */
export function decideCodecs(format: string, caps: BrowserCapabilities): BrowserExportPlan | { missing: string[] } {
  const missing: string[] = [];
  const substitutions: string[] = [];
  if (format === 'webm-vp9-opus') {
    if (!caps.video.vp9) missing.push('video:vp9');
    if (!caps.audio.opus) missing.push('audio:opus');
    return missing.length ? { missing } : { container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', substitutions, capabilities: caps };
  }
  if (format !== 'mp4-h264-aac') return { missing: [`format:${format}`] };
  if (!caps.video.avc) missing.push('video:avc (H.264)');
  let audioCodec: 'aac' | 'opus' = 'aac';
  if (!caps.audio.aac) {
    if (caps.audio.opus) {
      audioCodec = 'opus';
      substitutions.push('audio: AAC cannot be encoded by this browser; Opus in the MP4 container was used instead (not every player accepts Opus-in-MP4)');
    } else missing.push('audio:aac|opus');
  }
  return missing.length ? { missing } : { container: 'mp4', videoCodec: 'avc', audioCodec, substitutions, capabilities: caps };
}

interface Leased {
  jobId: string;
  snapshot: ProjectDocument;
  manifest: { options: { format: string; quality: 'draft' | 'standard' | 'high' }; output: { width: number; height: number; firstFrame: number; frames: number; frameRate: { num: number; den: number }; sampleRate: number } };
  leaseSeconds: number;
  heartbeatSeconds: number;
}

async function api<R>(apiBase: string, path: string, body: unknown): Promise<R> {
  const r = await fetch(`${apiBase}${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j?.error?.code as string | undefined;
    // job_canceled: a cancel reached the server between the last heartbeat and this call (e.g. the completion); it is a cancel, not a fault
    throw new BrowserExportError(code === 'lease_lost' || code === 'lease_not_owned' || code === 'render_blocked' ? code : code === 'job_canceled' ? 'canceled' : 'server_error', j?.error?.message ?? `HTTP ${r.status}`, { details: j?.error });
  }
  return j as R;
}

/** Whole-sample mix of the exported range, positions rounded from ABSOLUTE rational times (never accumulated). */
/** Decoded sound of one asset as timed pieces, read with the same demuxer and decoder as the preview (any container the editor accepts). */
interface SoundPiece { buffer: AudioBuffer; /** Seconds from the file's own start. */ at: number; duration: number }
async function decodeSound(url: string): Promise<SoundPiece[]> {
  const input = new Input({ source: new UrlSource(url, { requestInit: { credentials: 'same-origin' }, maxCacheSize: 32 << 20 }), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return [];
    if (!(await track.canDecode())) throw new Error(`this browser cannot decode the sound of this file (${track.codec ?? 'unknown codec'})`);
    // This reader's time zero for the file: the earliest presented timestamp of any stream, never below zero (as in the preview).
    const origin = Math.max(0, await input.getFirstTimestamp());
    const out: SoundPiece[] = [];
    for await (const b of new AudioBufferSink(track).buffers()) out.push({ buffer: b.buffer, at: b.timestamp - origin, duration: b.duration });
    return out;
  } finally { input.dispose(); }
}
/** Test utility: how this browser's decoder times the sound of a file: the first timestamp and where loud onsets fall on that timeline. */
export async function probeSound(url: string): Promise<{ codec: string | null; firstTimestamp: number; pieces: number; onsets: number[]; samples: number; lastEnd: number; sampleRate: number | null }> {
  const input = new Input({ source: new UrlSource(url, { requestInit: { credentials: 'same-origin' } }), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { codec: null, firstTimestamp: 0, pieces: 0, onsets: [], samples: 0, lastEnd: 0, sampleRate: null };
    let n = 0, sr: number | null = null, quietUntil = -1, samples = 0, lastEnd = 0;
    const onsets: number[] = [];
    for await (const b of new AudioBufferSink(track).buffers()) {
      n++; sr = b.buffer.sampleRate; samples += b.buffer.length; lastEnd = b.timestamp + b.duration;
      const x = b.buffer.getChannelData(0);
      for (let i = 0; i < x.length; i++) { const t = b.timestamp + i / b.buffer.sampleRate; if (t >= quietUntil && Math.abs(x[i]!) > 0.1) { onsets.push(Number(t.toFixed(4))); quietUntil = t + 0.3; } }
    }
    return { codec: track.codec ?? null, firstTimestamp: await track.getFirstTimestamp(), pieces: n, onsets, samples, lastEnd, sampleRate: sr };
  } finally { input.dispose(); }
}
/**
 * The sound of one clip with effects over timeline samples [s0, s1), from the decoded pieces of its file: the playing-order source
 * the voice asks for is filled from the pieces (positions from their own timestamps, as everywhere else in the browser), at the
 * decoder's rate. Mono is heard in both channels; of more channels the first two are used (wave 1).
 */
function voiceSound(c: PlannedAudioClip, pieces: SoundPiece[], rate: number, s0: number, s1: number): Float32Array {
  const sourceRate = pieces[0]?.buffer.sampleRate ?? c.voice!.sourceRate;
  const voice = openClipVoice(c, rate, sourceRate, s0 - c.at, s1 - c.at);
  const { origin, first, last, reverse } = voice.input;
  const P = new Float32Array(Math.max(0, last - first) * 2);
  // native indices the voice reads
  const lo = reverse ? origin - last : origin + first, hi = reverse ? origin - first : origin + last;
  for (const p of pieces) {
    if (p.buffer.sampleRate !== sourceRate) throw new Error(`the decoder changed its sample rate within one file (${sourceRate} Hz, then ${p.buffer.sampleRate} Hz)`);
    const start = Math.round(p.at * p.buffer.sampleRate), n = p.buffer.length;
    if (start + n <= lo || start >= hi) continue;
    const l = p.buffer.getChannelData(0), r = p.buffer.numberOfChannels > 1 ? p.buffer.getChannelData(1) : l;
    const data = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { data[i * 2] = l[i]!; data[i * 2 + 1] = r[i]!; }
    fillPlayingOrder(P, first, voice.input, { start, data });
  }
  const a = voice.push(P), b = voice.finish();
  const y = new Float32Array(a.length + b.length);
  y.set(a);
  y.set(b, a.length);
  return y;
}

async function mixAudio(doc: ProjectDocument, assetUrl: (id: string) => string, out: Leased['manifest']['output'], rate: number, stopped: () => void): Promise<AudioBuffer> {
  const firstSample = T.nearestSampleIndex(T.frameTime(out.firstFrame, out.frameRate), rate);
  const totalSamples = T.nearestSampleIndex(T.frameTime(out.firstFrame + out.frames, out.frameRate), rate) - firstSample;
  const ctx = new OfflineAudioContext(2, Math.max(1, totalSamples), rate);
  const decoded = new Map<string, Promise<SoundPiece[]>>();
  const decode = (assetId: string) => {
    let d = decoded.get(assetId);
    if (!d) { d = decodeSound(assetUrl(assetId)); decoded.set(assetId, d); }
    return d;
  };
  // Same audio plan as the server export and the preview: gain, pan, fades and ducking mean the same thing on every route.
  // Sound pieces are placed by their own timestamps on the file's clock, exactly as the preview does, so a sound stream that
  // starts late (or a container the browser's built-in audio decoder cannot read) behaves the same on every route.
  // The plan is made at the rate this context renders at (Opus is always 48 kHz), so its sample positions are this context's samples.
  const plan = audioPlan(doc, undefined, { sampleRate: rate });
  const end = firstSample + totalSamples;
  const starts = new Map(plan.clips.map((c) => [c.clipId, c.at]));
  const missing = plan.missingFx.filter((m) => (starts.get(m.clipId) ?? -1) < end);
  if (missing.length) throw new BrowserExportError('export_failed', `sound effect ${missing.map((m) => `"${m.type}" on clip ${m.clipId}`).join(', ')} is not available in this build; the export would drop it`);
  let fxMix: Float32Array | null = null; // the sound of the clips with effects, added after rendering
  for (const c of plan.clips) {
    if (c.voice) {
      const s0 = Math.max(c.at, firstSample), s1 = Math.min(soundEnd(c), end);
      if (s1 <= s0) continue;
      stopped();
      const y = voiceSound(c, await decode(c.assetId), rate, s0, s1);
      fxMix ??= new Float32Array(totalSamples * 2);
      const o = (s0 - firstSample) * 2;
      for (let i = 0; i < y.length; i++) fxMix[o + i] = fxMix[o + i]! + y[i]!;
      continue;
    }
    const s0 = Math.max(c.at, firstSample);
    const s1 = Math.min(c.at + c.length, firstSample + totalSamples);
    if (s1 <= s0) continue;
    stopped();
    const pieces = await decode(c.assetId);
    const input = plannedClipInput(ctx, c, rate, ctx.destination, (c.at - firstSample) / rate, s0 - c.at);
    // the stretch of source this clip needs, in source seconds, and the output time at which it starts
    const srcFrom = (c.source + (s0 - c.at) * c.speed) / rate, srcTo = (c.source + (s1 - c.at) * c.speed) / rate, outFrom = (s0 - firstSample) / rate;
    if (c.keepPitch || c.speedEnd !== undefined) {
      // Keep the pitch: the clip's whole stretch of source is rendered at normal rate (in playing order), run through the
      // shared stretcher from the start of the clip as the server mix does, and the part this export needs is placed at normal rate.
      // (the same route serves a continuous speed ramp, with the ramp resampler in place of the stretcher)
      const srcFrames = c.speedEnd !== undefined ? RampResampler.sourceFrames(rampSpanOf(c)) : Math.max(1, Math.round(c.length * c.speed));
      const S0 = c.source / rate, S1 = (c.source + srcFrames) / rate;
      const pre = new OfflineAudioContext(2, srcFrames, rate);
      for (const p of pieces) {
        const from = Math.max(p.at, S0), to = Math.min(p.at + p.duration, S1);
        if (to <= from) continue;
        const node = pre.createBufferSource();
        node.buffer = c.reverse ? reversedBuffer(pre, p.buffer) : p.buffer;
        node.connect(pre.destination);
        if (c.reverse) node.start(S1 - to, p.at + p.duration - to, to - from);
        else node.start(from - S0, from - p.at, to - from);
      }
      const plain = await pre.startRendering();
      const l = plain.getChannelData(0), r = plain.getChannelData(1);
      const inter = new Float32Array(srcFrames * 2);
      for (let i = 0; i < srcFrames; i++) { inter[i * 2] = l[i]!; inter[i * 2 + 1] = r[i]!; }
      const stretched = c.speedEnd !== undefined ? (() => { const rr = new RampResampler(rampSpanOf(c)); const a = rr.push(inter), b = rr.finish(); const o = new Float32Array(c.length * 2); o.set(a.subarray(0, o.length)); o.set(b.subarray(0, Math.max(0, o.length - a.length)), a.length); return o; })() : stretchKeepingPitch(inter, c.speed, rate, c.length);
      const n = s1 - s0, off = s0 - c.at;
      const buf = ctx.createBuffer(2, n, rate);
      const bl = buf.getChannelData(0), br = buf.getChannelData(1);
      for (let i = 0; i < n; i++) { bl[i] = stretched[(off + i) * 2]!; br[i] = stretched[(off + i) * 2 + 1]!; }
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(input);
      node.start(outFrom);
      continue;
    }
    if (c.reverse) {
      // The clip plays its stretch [S0, S1) backwards: clip-local output time x shows source S1 − x·speed.
      const S1 = (c.source + c.length * c.speed) / rate;
      const hi = S1 - ((s0 - c.at) * c.speed) / rate, lo = S1 - ((s1 - c.at) * c.speed) / rate; // source needed for this export range
      for (const p of pieces) {
        const from = Math.max(p.at, lo), to = Math.min(p.at + p.duration, hi);
        if (to <= from) continue;
        const node = ctx.createBufferSource();
        node.buffer = reversedBuffer(ctx, p.buffer);
        node.playbackRate.value = c.speed;
        node.connect(input);
        // in the reversed piece, source time `to` sits (piece end − to) from its start; it is heard (hi − to)/speed after the range starts
        node.start(outFrom + (hi - to) / c.speed, p.at + p.duration - to, to - from);
      }
      continue;
    }
    for (const p of pieces) {
      const from = Math.max(p.at, srcFrom), to = Math.min(p.at + p.duration, srcTo);
      if (to <= from) continue;
      const node = ctx.createBufferSource();
      node.buffer = p.buffer;
      node.playbackRate.value = c.speed; // varispeed, same as the server mix and the preview
      node.connect(input);
      node.start(outFrom + (from - srcFrom) / c.speed, from - p.at, to - from);
    }
  }
  stopped();
  const rendered = await ctx.startRendering();
  if (fxMix) {
    // exact alignment: sample i of the effects mix is sample i of the rendered buffer
    for (let ch = 0; ch < 2; ch++) {
      const x = rendered.getChannelData(ch);
      for (let i = 0; i < x.length && i < totalSamples; i++) x[i] = x[i]! + fxMix[i * 2 + ch]!;
      rendered.copyToChannel(x, ch);
    }
  }
  return rendered;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function runBrowserExport(opts: BrowserExportRun): Promise<BrowserExportResult> {
  const apiBase = opts.apiBase ?? '/api/v1';
  const sessionId = opts.sessionId ?? `tab-${crypto.randomUUID()}`;
  const started = performance.now();
  const options = opts.options ?? {};
  const progress = (stage: BrowserExportProgress['stage'], framesDone: number, total: number) => opts.onProgress?.({ stage, framesDone, total });
  progress('planning', 0, 0);

  // ---- 1. capability decision BEFORE any job exists. Geometry/rate come from the server's plan (a dry run starts nothing).
  const plan = await api<{ manifest: Leased['manifest']; blockers: { code: string; message: string }[] }>(apiBase, `/projects/${opts.projectId}/exports/plan`, options);
  if (plan.blockers.length) throw new BrowserExportError('render_blocked', `export cannot start: ${plan.blockers[0]!.message}`, { details: { blockers: plan.blockers } });
  const po = plan.manifest.output;
  const rate = po.frameRate;
  const caps = await probeCapabilities(po.width, po.height, rate.num / rate.den, po.sampleRate);
  const decision = decideCodecs(plan.manifest.options.format, caps);
  if ('missing' in decision) throw new BrowserExportError('browser_export_unsupported', `this browser cannot export ${plan.manifest.options.format}: missing ${decision.missing.join(', ')}`, { missing: decision.missing });

  // ---- 2. leased job over an immutable snapshot
  const job = await api<Leased>(apiBase, `/projects/${opts.projectId}/exports/browser`, { ...options, sessionId });
  const { jobId, snapshot: doc, manifest } = job;
  const out = manifest.output;
  opts.onJob?.(jobId, sessionId);
  progress('leased', 0, out.frames);

  let stopReason: BrowserExportError | null = null;
  const stop = (e: BrowserExportError) => { stopReason ??= e; };
  const check = () => { if (stopReason) throw stopReason; if (opts.signal?.aborted) throw new BrowserExportError('aborted', 'export aborted by the caller', { jobId }); };
  let framesDone = 0;
  let lastBeat = performance.now();
  let beating = false;
  const beat = async () => {
    if (beating || stopReason) return;
    beating = true;
    try {
      const r = await api<{ ok: boolean; canceled: boolean; canceledBy?: string }>(apiBase, `/jobs/${jobId}/heartbeat`, { sessionId, framesDone });
      lastBeat = performance.now();
      // the owner or an agent (REST or MCP cancel_job) asked to stop: say who, so the owner knows why their export ended
      if (r.canceled) stop(new BrowserExportError('canceled', `the export was canceled on the server${r.canceledBy ? ` by ${r.canceledBy}` : ''}; nothing was published`, { jobId, details: r.canceledBy ? { canceledBy: r.canceledBy } : undefined }));
    } catch (e: any) {
      if (e instanceof BrowserExportError && (e.code === 'lease_lost' || e.code === 'lease_not_owned' || e.code === 'canceled')) stop(new BrowserExportError(e.code, e.message, { jobId }));
      // Transient network failure: keep going, but never keep computing past a lease we cannot prove we hold.
      else if (performance.now() - lastBeat > job.leaseSeconds * 1000) stop(new BrowserExportError('lease_lost', 'heartbeats failed for longer than the lease; stopping', { jobId }));
    } finally { beating = false; }
  };
  const timer = setInterval(() => void beat(), job.heartbeatSeconds * 1000);
  const onAbort = () => stop(new BrowserExportError('aborted', 'export aborted by the caller', { jobId }));
  opts.signal?.addEventListener('abort', onAbort);

  // 12 decoders, as the render worker (ADR-0005 budget, to be amended for ADR-0011 decode lanes)
  const pool = new MediaPool({ assetUrl: (assetId) => `${apiBase}/projects/${opts.projectId}/assets/${assetId}/content`, maxDecoders: 12 });
  let output: Output | null = null;
  try {
    progress('fonts', 0, out.frames);
    await ensureFonts();
    await initGpu(); // GPU effects run only if this passes; a frame that needs one fails the export otherwise
    check();
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    // Same raster path as the render worker (CPU canvas, opaque, sRGB) so preview/server/browser draw alike.
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;

    const q = { draft: 'low', standard: 'medium', high: 'very-high' }[manifest.options.quality] as 'low' | 'medium' | 'very-high';
    const target = new BufferTarget();
    output = new Output({ format: decision.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target });
    const video = new CanvasSource(canvas, { codec: decision.videoCodec, quality: new Quality(q) });
    output.addVideoTrack(video, { frameRate: rate.num / rate.den });
    const audioRate = decision.audioCodec === 'opus' ? 48000 : po.sampleRate; // Opus is always 48 kHz
    const audio = new AudioBufferSource({ codec: decision.audioCodec, quality: new Quality({ bitrate: 160_000 }) });
    output.addAudioTrack(audio);
    await output.start();

    progress('audio', 0, out.frames);
    const mix = await mixAudio(doc, (id) => `${apiBase}/projects/${opts.projectId}/assets/${id}/content`, out, audioRate, check);
    // Measurement only (tests set window.__pfExportAudioTap = {}): the mix exactly as handed to the encoder, before lossy coding.
    const tap = (globalThis as { __pfExportAudioTap?: { last?: unknown } }).__pfExportAudioTap;
    if (tap && typeof tap === 'object') {
      const data = new Float32Array(mix.length * 2), l = mix.getChannelData(0), r = mix.getChannelData(1);
      for (let i = 0; i < mix.length; i++) { data[i * 2] = l[i]!; data[i * 2 + 1] = r[i]!; }
      tap.last = { jobId, sampleRate: audioRate, firstFrame: out.firstFrame, frames: mix.length, data };
    }
    // Audio is a single buffer; it is fed concurrently with video so interleaving backpressure between the tracks cannot deadlock.
    const audioDone = audio.add(mix);
    audioDone.catch(() => {});

    const frameSeconds = (k: number) => (k * rate.den) / rate.num; // absolute, from the integer index: no accumulated rounding
    const flash = new FlashAnalyser(rate.num / rate.den);
    for (let i = 0; i < out.frames; i++) {
      check();
      if (opts.freezeAfterFrames !== undefined && i === opts.freezeAfterFrames) await new Promise(() => {}); // stuck-render simulation: heartbeats keep running until the page is closed
      const g = evaluate(doc, T.frameTime(out.firstFrame + i, rate));
      const { missing, missingReasons, unavailableEffects, unavailableReasons } = await drawGraph(ctx, { ...g, width: out.width, height: out.height }, pool.frames, { quality: 'full' }); // export: the full picture (ADR-0005)
      if (missing.length) throw new BrowserExportError('export_failed', `frame ${i}: source frame unavailable for clips ${missing.map((id) => (missingReasons?.[id] ? `${id} (${missingReasons[id]})` : id)).join(', ')}`, { jobId });
      // An effect whose own material is missing (a colour table that could not be loaded) says so; the others need the adapter.
      const told = unavailableEffects.filter((id) => unavailableReasons?.[id]);
      const adapter = unavailableEffects.filter((id) => !unavailableReasons?.[id]);
      if (adapter.length) throw new BrowserExportError('export_failed', `frame ${i} uses ${adapter.join(', ')}, which need a graphics adapter (WebGPU) in this browser${told.map((id) => `; ${id}: ${unavailableReasons![id]}`).join('')}`, { jobId });
      if (told.length) throw new BrowserExportError('export_failed', `frame ${i} cannot be drawn faithfully: ${told.map((id) => `${id}: ${unavailableReasons![id]}`).join('; ')}`, { jobId });
      // the picture the encoder receives, checked for flashing (same cells and thresholds as the server export)
      flash.push(flashCells(ctx.getImageData(0, 0, out.width, out.height).data, out.width, out.height));
      await video.add(frameSeconds(i), frameSeconds(i + 1) - frameSeconds(i)); // awaited: encoder + muxer backpressure
      framesDone = i + 1;
      if (i % 4 === 0 || framesDone === out.frames) progress('rendering', framesDone, out.frames);
    }
    check();
    await audioDone;
    progress('finalizing', framesDone, out.frames);
    await output.finalize();
    check();
    const buffer = target.buffer;
    if (!buffer) throw new BrowserExportError('export_failed', 'the muxer produced no output', { jobId });
    const sha256 = hex(await crypto.subtle.digest('SHA-256', buffer));
    const mime = decision.container === 'mp4' ? 'video/mp4' : 'video/webm';
    progress('completing', framesDone, out.frames);
    clearInterval(timer);
    const fr = flash.report(), at = (k: number) => T.frameTime(out.firstFrame + k, rate);
    const photosensitivity: BrowserPhotosensitivity = { verdict: fr.verdict, frames: fr.frames, ranges: fr.ranges.map((x) => ({ from: at(x.from), to: at(x.to + 1), kind: x.kind, flashesPerSecond: x.flashesPerSecond, area: x.area })) };
    await api(apiBase, `/jobs/${jobId}/complete`, { sessionId, bytes: buffer.byteLength, sha256, videoCodec: decision.videoCodec, audioCodec: decision.audioCodec, frames: framesDone, container: decision.container, photosensitivity });
    const media = pool.stats();
    return { blob: new Blob([buffer], { type: mime }), jobId, videoCodec: decision.videoCodec, audioCodec: decision.audioCodec, container: decision.container, frames: framesDone, sha256, bytes: buffer.byteLength, substitutions: decision.substitutions, capabilities: caps, wallMs: performance.now() - started, decoders: { peak: media.peakDecoders, max: media.maxDecoders, opened: media.opened, disposed: media.disposed, refused: media.refused }, photosensitivity };
  } catch (e: any) {
    const err = stopReason ?? (e instanceof BrowserExportError ? e : new BrowserExportError('export_failed', String(e?.message ?? e), { jobId }));
    await output?.cancel().catch(() => {});
    // The lease is already gone for these two; for everything else tell the server we stopped so the job does not linger.
    if (err.code !== 'lease_lost' && err.code !== 'lease_not_owned') await api(apiBase, `/jobs/${jobId}/abandon`, { sessionId }).catch(() => {});
    throw err;
  } finally {
    clearInterval(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    await pool.dispose();
  }
}
