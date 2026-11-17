/**
 * Server export route (SPEC §9), software profile:
 *   immutable snapshot -> headless Chromium runs the shared evaluator + Canvas2D compositor
 *   -> raw RGBA frames (their own stream) -> ffmpeg libx264
 *   audio is rendered separately by ffmpeg to a sample-exact WAV, then muxed as a second input.
 * Jobs are durable rows; a job interrupted by a restart re-runs from its immutable snapshot and
 * publishes its output with an atomic rename, so a retry never yields a duplicate or partial file.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { GPU_EFFECT_IDS, GPU_TRANSITION_IDS, timeOriginSeconds, findEffect, lutRef, findFont, FONT_CATALOG, projectVariant, sequenceDuration, serializeSrt, serializeVtt, type ProjectDocument } from '@pulseframe/core';
import type { RenderHost } from '@pulseframe/renderer';
import { AUDIO_FX_ENGINE, audioPlan, captionCues, soundEnd, type AudioPlan, type PlannedAudioClip } from '@pulseframe/engine';
import { renderMix, type MixResult } from './audiomix.ts';
import { limiter } from './analysis.ts';

const stillLimit = limiter(2, 32);
import { ffprobe } from './ingest.ts';
import { assertStorageRoom } from './storage.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

const exec = promisify(execFile);

export const ExportOptionsSchema = z
  .object({
    format: z.enum(['mp4-h264-aac', 'webm-vp9-opus', 'gif', 'wav', 'png']).default('mp4-h264-aac').describe('Container/codecs. gif = animated picture without sound; wav = audio only; png = one still frame'),
    captions: z.enum(['burned', 'sidecar-srt', 'sidecar-vtt', 'none']).default('burned').describe('burned = captions drawn into the picture (as previewed); sidecar-* = clean picture plus a subtitle file timed to this export; none = clean picture, no file'),
    quality: z.enum(['draft', 'standard', 'high']).default('high'),
    scale: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).default(1).describe('Output size relative to the project size (rounded to even dimensions)'),
    range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().optional().describe('Half-open frame range [startFrame, endFrame); default is the whole sequence'),
    frame: z.number().int().nonnegative().optional().describe('Frame index for format=png'),
    variantId: z.string().optional().describe('Export this linked format instead of the master frame size'),
  })
  .strict();
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
const hideCaptions = (doc: ProjectDocument): ProjectDocument => ({ ...doc, sequences: Object.fromEntries(Object.entries(doc.sequences).map(([id, s]) => [id, { ...s, tracks: s.tracks.map((t) => (t.kind === 'caption' ? { ...t, hidden: true } : t)) }])) });
/** Subtitle file for an export: the first caption track as it plays, shifted and clipped to the exported range. */
function captionSidecar(doc: ProjectDocument, manifest: Manifest): { format: 'srt' | 'vtt'; text: string; cues: number } | null {
  const want = manifest.options.captions;
  if (want !== 'sidecar-srt' && want !== 'sidecar-vtt') return null;
  const seq = doc.sequences[doc.mainSequenceId]!;
  const track = seq.tracks.find((t) => t.kind === 'caption');
  if (!track) return null;
  const rate = manifest.output.frameRate;
  const from = T.frameTime(manifest.output.firstFrame, rate), to = T.frameTime(manifest.output.firstFrame + manifest.output.frames, rate);
  const cues = captionCues(doc, seq, track)
    .map((c) => ({ start: T.max(c.start, from), end: T.min(c.end, to), text: c.text }))
    .filter((c) => T.lt(c.start, c.end))
    .map((c) => ({ start: T.sub(c.start, from), end: T.sub(c.end, from), text: c.text }));
  const format = want === 'sidecar-srt' ? 'srt' : 'vtt';
  return { format, text: format === 'srt' ? serializeSrt(cues) : serializeVtt(cues), cues: cues.length };
}
/** The document to render: the master, or the master projected into one of its linked formats. */
export function variantDoc(doc: ProjectDocument, variantId?: string): ProjectDocument {
  if (!variantId) return doc;
  if (!doc.variants?.[variantId]) throw new ApiError(404, 'not_found', `format variant ${variantId} not found`, { variantId, available: Object.keys(doc.variants ?? {}) }, 'get_summary lists the variants.');
  return projectVariant(doc, variantId);
}
const CRF = { 'mp4-h264-aac': { draft: 28, standard: 21, high: 16 }, 'webm-vp9-opus': { draft: 40, standard: 32, high: 24 } } as const;
/** Rough bits per pixel per frame, used ONLY for the labelled size estimate. */
const BPP = { draft: 0.03, standard: 0.07, high: 0.14 } as const;
/** `audio`: the audio plan version and the sound-effect runtime (ADR-0010) every route mixes with. */
export const ENGINE = { compositor: 'canvas2d/1', evaluator: 'evaluate/1', audio: `plan/2 ${AUDIO_FX_ENGINE}`, fontFamilies: FONT_CATALOG.map((f) => f.family) } as const;

export interface RenderSession {
  doc: ProjectDocument;
  revision: number;
  jobId: string | null;
  firstFrame: number;
  outWidth: number;
  outHeight: number;
  frameBytes: number;
  totalFrames: number;
  nextFrame: number;
  sink: ChildProcessWithoutNullStreams | null;
}
export interface Manifest {
  revision: number;
  engine: typeof ENGINE & { schemaVersion: number };
  options: ExportOptions;
  output: { width: number; height: number; firstFrame: number; frames: number; frameRate: { num: number; den: number }; sampleRate: number };
  assets: { id: string; contentHash: string; byteSize: number; kind: string; clips: number }[];
  fonts: { family: string; files: { name: string; sha256: string }[] }[];
  /** Effect and transition implementations the render depends on, with their versions. */
  effects: { type: string; version: number; clips: number }[];
  transitions: { type: string; clips: number }[];
  /** Sound effects (ADR-0010) of the clips heard in the exported range (a clip is heard from its start until the end of its tail), with their versions. Empty for formats without sound. */
  audioEffects: { type: string; version: number; clips: number }[];
  /** Labelled estimate, never a promise. */
  estimate: { bytes: number | null; basis: string };
}
export interface Blocker { code: string; message: string; ids: string[] }

/** True when any clip of the project carries an effect that runs as a WebGPU pass: such a render needs a worker browser with a graphics adapter (ADR-0008). */
export const usesGpuEffects = (doc: ProjectDocument) => Object.values(doc.sequences).some((q) => q.tracks.some((t) => t.clips.some((c) => ('effects' in c && c.effects?.some((e) => GPU_EFFECT_IDS.includes(e.type))) || ('transition' in c && !!c.transition && GPU_TRANSITION_IDS.includes(c.transition.type)))));

/** The audio plan of the document at the project rate (the server mix's plan) and the exported frames as its samples [a, b). */
interface SoundRange { plan: AudioPlan; a: number; b: number }
const soundRange = (doc: ProjectDocument, firstFrame: number, frames: number): SoundRange => {
  const { frameRate, sampleRate } = doc.settings;
  return { plan: audioPlan(doc), a: T.nearestSampleIndex(T.frameTime(firstFrame, frameRate), sampleRate), b: T.nearestSampleIndex(T.frameTime(firstFrame + frames, frameRate), sampleRate) };
};
/** The clip is heard in samples [a, b): from its start to the end of its tail (soundEnd), as the mix keeps it. */
const sounds = (c: PlannedAudioClip, a: number, b: number) => c.at < b && soundEnd(c) > a;

export class Exporter {
  readonly sessions = new Map<string, RenderSession>();
  private queue: Promise<void> = Promise.resolve();
  private cancelRequested = new Set<string>();
  private running: { jobId: string; ff?: ChildProcessWithoutNullStreams; abort?: () => void } | null = null;
  constructor(private store: Store, private host: RenderHost, private renderPageUrl: () => string, private webDist: string) {}

  /**
   * Everything a render depends on, fixed at the moment the job is created (SPEC §9): the document snapshot,
   * the exact asset and font bytes, engine versions and options. Returns blockers instead of starting a render that cannot be faithful.
   */
  plan(doc: ProjectDocument, revision: number, raw: unknown): { manifest: Manifest; blockers: Blocker[]; warnings: Blocker[] } {
    const parsed = ExportOptionsSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    const options = parsed.data;
    doc = variantDoc(doc, options.variantId);
    const { width, height, frameRate, sampleRate } = doc.settings;
    const total = T.frameCount(sequenceDuration(doc), frameRate);
    const blockers: Blocker[] = [];
    const warnings: Blocker[] = [];
    const even = (n: number) => Math.max(2, Math.round((n * options.scale) / 2) * 2);
    const outWidth = even(width);
    const outHeight = even(height);
    let first = 0;
    let frames = total;
    if (options.format === 'png') {
      first = options.frame ?? 0;
      frames = 1;
      if (first >= Math.max(1, total)) blockers.push({ code: 'out_of_bounds', message: `frame ${first} is outside 0..${total - 1}`, ids: [] });
    } else if (options.range) {
      first = options.range.startFrame;
      frames = Math.min(options.range.endFrame, total) - first;
      if (frames <= 0) blockers.push({ code: 'empty_range', message: `range [${options.range.startFrame}, ${options.range.endFrame}) contains no frames (sequence has ${total})`, ids: [] });
    }
    if (total === 0) blockers.push({ code: 'empty_sequence', message: 'the sequence has no clips to export', ids: [] });
    const seq = doc.sequences[doc.mainSequenceId]!;
    const used = new Map<string, number>();
    const families = new Set<string>();
    const from = T.frameTime(first, frameRate);
    const to = T.frameTime(first + Math.max(0, frames), frameRate);
    const fxUsed = new Map<string, number>(), trUsed = new Map<string, number>();
    // The sound of the range (none in a GIF or a still): the audio plan every mix follows, and the range in its samples.
    const sound = options.format === 'gif' || options.format === 'png' ? null : soundRange(doc, first, Math.max(0, frames));
    const drawn = new Set<string>(); // media clips counted below
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        // A clip is drawn until its end, and beyond it while the clip that follows on its track comes in over it with a transition:
        // `evaluate` draws it as the outgoing picture of those frames, with its own effects (and their colour tables).
        let end = T.add(c.start, c.duration);
        const next = c.type === 'media' ? tr.clips.find((n) => n.type === 'media' && n.id !== c.id && !!n.transition && T.eq(n.start, end)) : undefined;
        if (next?.type === 'media' && next.transition) end = T.add(end, T.frameTime(next.transition.frames, frameRate));
        if (!T.lt(c.start, to) || !T.lt(from, end)) continue; // outside the exported range
        if (c.type === 'media') { used.set(c.assetId, (used.get(c.assetId) ?? 0) + 1); drawn.add(c.id); }
        for (const fx of c.effects ?? []) if (fx.enabled) {
          fxUsed.set(fx.type, (fxUsed.get(fx.type) ?? 0) + 1);
          // A colour table named by a colour-table effect is source material of the render like any clip's file.
          const table = lutRef(fx);
          if (table) used.set(table, (used.get(table) ?? 0) + 1);
        }
        if (c.type === 'media' && c.transition) trUsed.set(c.transition.type, (trUsed.get(c.transition.type) ?? 0) + 1);
        else if (c.type === 'text') families.add(c.style.fontFamily);
        if (tr.caption) families.add(tr.caption.style.fontFamily);
      }
    // A clip with sound effects sounds until the end of its tail (ADR-0010), and in a range that starts in its echo the mix still
    // runs its voice, which reads the clip's source from before the range. That source is pinned and checked like any clip's file.
    if (sound) for (const c of sound.plan.clips) if (c.voice && !drawn.has(c.clipId) && sounds(c, sound.a, sound.b)) used.set(c.assetId, (used.get(c.assetId) ?? 0) + 1);
    const assets = [...used].flatMap(([id, clips]) => {
      const a = Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined;
      if (!a) { blockers.push({ code: 'missing_media', message: `colour table ${id} named by an effect is not in the project library`, ids: [id] }); return []; }
      let present = false;
      try { present = fs.statSync(this.store.blobPath(a.contentHash)).size === a.byteSize; } catch { /* missing */ }
      if (!present) blockers.push({ code: 'missing_media', message: `source media for "${a.name}" is not available to the render worker`, ids: [id] });
      return [{ id, contentHash: a.contentHash, byteSize: a.byteSize, kind: a.kind, clips }];
    });
    for (const fam of families) if (!ENGINE.fontFamilies.includes(fam)) blockers.push({ code: 'missing_font', message: `font "${fam}" is not bundled with the renderer; text would silently fall back`, ids: [] });
    const fonts = [...families].filter((f) => ENGINE.fontFamilies.includes(f)).map((family) => ({ family, files: this.fontFiles(family) }));
    if (fonts.some((f) => f.files.length === 0)) blockers.push({ code: 'renderer_unavailable', message: 'the web bundle with the render page and fonts has not been built (run `pnpm build`)', ids: [] });
    if (options.format === 'gif') {
      const seq0 = doc.sequences[doc.mainSequenceId]!;
      if (seq0.tracks.some((t) => t.kind === 'audio' && !t.muted && t.clips.length > 0)) warnings.push({ code: 'gif_has_no_sound', message: 'GIF cannot carry sound; the export will be silent', ids: [] });
      if (outWidth * outHeight * Math.max(0, frames) > 640 * 360 * 600) warnings.push({ code: 'gif_large', message: 'this GIF will be large and limited to 256 colours per frame; consider a shorter range or scale 0.5', ids: [] });
    }
    if (options.captions.startsWith('sidecar') && !doc.sequences[doc.mainSequenceId]!.tracks.some((t) => t.kind === 'caption')) warnings.push({ code: 'no_captions', message: 'a caption file was requested but the project has no caption track; none will be written', ids: [] });
    if (options.format === 'webm-vp9-opus' && doc.settings.sampleRate !== 48000) warnings.push({ code: 'resampled_audio', message: 'Opus is encoded at 48 kHz; audio will be resampled', ids: [] });
    const effects = [...fxUsed].map(([type, clips]) => ({ type, version: findEffect(type)?.version ?? 0, clips }));
    for (const fx of effects) if (fx.version === 0) blockers.push({ code: 'unknown_effect', message: `effect "${fx.type}" is not available in this renderer; exporting would silently drop it`, ids: [] });
    const transitions = [...trUsed].map(([type, clips]) => ({ type, clips }));
    const audioEffects = sound ? this.planSound(sound, first + Math.max(0, frames) >= total, blockers, warnings) : [];
    const seconds = (frames * frameRate.den) / frameRate.num;
    const video = options.format === 'mp4-h264-aac' || options.format === 'webm-vp9-opus';
    const estimate = video
      ? { bytes: Math.round((outWidth * outHeight * frames * BPP[options.quality]) / 8 + seconds * 24_000), basis: 'heuristic bits-per-pixel for the chosen quality; real size depends on content' }
      : options.format === 'wav' ? { bytes: Math.round(seconds * sampleRate * 4 + 44), basis: 'exact for 16-bit stereo PCM' } : { bytes: null, basis: 'not estimated for stills' };
    return {
      manifest: { revision, engine: { ...ENGINE, schemaVersion: doc.schemaVersion }, options, output: { width: outWidth, height: outHeight, firstFrame: first, frames: Math.max(0, frames), frameRate, sampleRate }, assets, fonts, effects, transitions, audioEffects, estimate },
      blockers, warnings,
    };
  }
  /**
   * Sound effects of the exported range (ADR-0010): which effect implementations the mix depends on, a blocker for any effect this
   * build cannot run (it would otherwise be dropped silently) and a warning for each echo or reverb cut at the end of the video.
   */
  private planSound({ plan: ap, a, b }: SoundRange, reachesEnd: boolean, blockers: Blocker[], warnings: Blocker[]): Manifest['audioEffects'] {
    const used = new Map<string, { type: string; version: number; clips: number }>();
    for (const c of ap.clips) {
      if (!c.voice || !sounds(c, a, b)) continue;
      for (const fx of c.voice.chain) {
        const key = `${fx.type}@${fx.version}`;
        const u = used.get(key) ?? { type: fx.type, version: fx.version, clips: 0 };
        u.clips++;
        used.set(key, u);
      }
    }
    // An effect that cannot run may have any tail, so it blocks whenever its clip starts before the end of the range.
    const at = new Map(ap.clips.map((c) => [c.clipId, c.at]));
    for (const m of ap.missingFx) {
      const start = at.get(m.clipId);
      if (start !== undefined && start >= b) continue;
      blockers.push({ code: 'unknown_audio_effect', message: `sound effect "${m.type}"${m.version ? ` (version ${m.version})` : ''} on clip ${m.clipId} is not available in this build${m.version ? ' for this clip' : ''}; exporting would silently drop it`, ids: [m.clipId] });
    }
    if (reachesEnd) for (const t of ap.cutTails) warnings.push({ code: 'audio_tail_cut', message: `the echo or reverb of clip ${t.clipId} would ring on ${t.seconds} s past the end of the video; it is cut there with a short fade (the video is not made longer)`, ids: [t.clipId] });
    return [...used.values()].sort((x, y) => (x.type < y.type ? -1 : x.type > y.type ? 1 : x.version - y.version));
  }
  private fontCache = new Map<string, { name: string; sha256: string }[]>();
  private fontFiles(family: string) {
    let f = this.fontCache.get(family);
    if (!f || f.length === 0) {
      const dir = path.join(this.webDist, 'assets');
      const prefix = `${findFont(family)?.slug ?? family.toLowerCase()}-`;
      f = !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.woff2')).sort().map((name) => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }));
      this.fontCache.set(family, f);
    }
    return f;
  }
  /**
   * Create the durable job (or refuse with the blockers). The single entry point for UI, REST and MCP.
   * `roomChecked`: the caller has just made the storage check below for a whole group of jobs (the batch route); repeating it per
   * job could refuse a later job of the group after the first was created, when the ceiling is within a few kilobytes.
   */
  start(projectId: string, actor: string, rawOptions: unknown, retryOf?: JobRow, opts: { roomChecked?: boolean } = {}): JobRow {
    // The output size is not known in advance, so an export (or a retry, which writes a new file) is refused once the storage
    // ceiling is reached. Checked here rather than in the route: the REST route, the batch route, retries and the MCP tool all
    // start exports through this function (the MCP tool used to skip the check that only the REST route made).
    if (!opts.roomChecked) assertStorageRoom(this.store, 1, retryOf ? 'retry this export' : 'start an export');
    const p = retryOf ? { doc: retryOf.input.snapshot as ProjectDocument, revision: retryOf.input.revision as number } : this.store.getProject(projectId);
    const { manifest, blockers, warnings } = this.plan(p.doc, p.revision, retryOf ? retryOf.input.manifest.options : rawOptions);
    if (blockers.length) throw new ApiError(422, 'render_blocked', `export cannot start: ${blockers[0]!.message}`, { blockers, warnings }, 'Fix the listed blockers (relink media, change the font or the range) and try again.');
    // A variant export snapshots the PROJECTED document, so the job renders exactly what was planned even if the variant changes later.
    // Snapshot what will be rendered. For a clean picture, caption tracks are hidden in the snapshot; a requested subtitle file
    // is fixed now from the same document, so later edits cannot change it.
    const resolved = retryOf ? p.doc : variantDoc(p.doc, manifest.options.variantId);
    const snapshot = retryOf || manifest.options.captions === 'burned' ? resolved : hideCaptions(resolved);
    const sidecar = retryOf ? retryOf.input.sidecar ?? null : captionSidecar(resolved, manifest);
    const job = this.store.createJob(projectId, 'export', actor, { revision: p.revision, snapshot, sidecar, manifest, warnings, retryOf: retryOf?.id ?? null });
    this.enqueue(job);
    return job;
  }
  retry(jobId: string, actor: string): JobRow {
    const j = this.store.getJob(jobId);
    if (j.type !== 'export') throw new ApiError(409, 'retry_not_supported', `retrying ${j.type} jobs is not supported`);
    if (!['failed', 'canceled'].includes(j.status)) throw new ApiError(409, 'job_not_retryable', `job is ${j.status}`, { status: j.status });
    return this.start(j.projectId, actor, undefined, j); // same immutable snapshot and options, new job id
  }
  /** Queued: removed. Running: encoder and render page are stopped and partial output deleted. */
  cancel(jobId: string, actor: string) {
    const j = this.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    this.cancelRequested.add(jobId);
    if (j.status === 'queued') { this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started` } }); return { jobId, status: 'canceled', outcome: 'removed-from-queue' }; }
    this.store.updateJob(jobId, { status: 'cancel-requested' });
    if (this.running?.jobId === jobId) { this.running.ff?.kill('SIGKILL'); this.running.abort?.(); }
    return { jobId, status: 'cancel-requested', outcome: 'stopping' };
  }

  private open(doc: ProjectDocument, revision: number, jobId: string | null, out: { width: number; height: number; firstFrame: number; frames: number }): { token: string; session: RenderSession; url: string } {
    if (!fs.existsSync(path.join(this.webDist, 'render.html')))
      throw new ApiError(503, 'renderer_unavailable', 'the web bundle containing the render page has not been built', {}, 'Run `pnpm build` and retry.');
    const token = randomBytes(24).toString('base64url');
    const session: RenderSession = { doc, revision, jobId, firstFrame: out.firstFrame, outWidth: out.width, outHeight: out.height, frameBytes: out.width * out.height * 4, totalFrames: out.frames, nextFrame: 0, sink: null };
    this.sessions.set(token, session);
    return { token, session, url: `${this.renderPageUrl()}#token=${token}` };
  }

  /** Agent sense / parity reference: one frame through the same compositor as export, as PNG. */
  async renderStill(doc: ProjectDocument, revision: number, frameIndex: number, scale: 1 | 0.5 | 0.25 = 1): Promise<Buffer> {
    const { manifest, blockers } = this.plan(doc, revision, { format: 'png', frame: frameIndex, scale });
    const hard = blockers.filter((b) => b.code !== 'empty_sequence');
    if (hard.length) throw new ApiError(422, hard[0]!.code === 'out_of_bounds' ? 'out_of_bounds' : 'render_blocked', hard[0]!.message, { blockers: hard });
    const { token, url } = this.open(doc, revision, null, { width: manifest.output.width, height: manifest.output.height, firstFrame: frameIndex, frames: 1 });
    try {
      // Stills are reachable with a read-only credential and each opens a browser page: run at most two at a time.
      return await stillLimit(() => this.host.renderStill(url, 0, { gpu: usesGpuEffects(doc) }));
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      // A renderer that went away (shutdown, crashed page) is an unavailable dependency, not an unexplained server error.
      throw new ApiError(503, 'renderer_unavailable', `the render worker could not produce the frame: ${String(e?.message ?? e).slice(0, 200)}`);
    } finally {
      this.sessions.delete(token);
    }
  }

  enqueue(job: JobRow) {
    // One export at a time in the local profile (bounded CPU/memory); order preserved.
    this.queue = this.queue.then(() => this.run(job.id)).catch(() => {});
  }

  /** Frames posted by the render page. Enforces order, size and backpressure into the encoder. */
  async acceptFrames(token: string, first: number, data: Uint8Array): Promise<void> {
    const s = this.sessions.get(token);
    if (!s || !s.sink) throw new ApiError(404, 'render_session_not_found', 'unknown render session');
    if (first !== s.nextFrame) throw new ApiError(409, 'frame_out_of_order', `expected frame ${s.nextFrame}, got ${first}`);
    if (data.length === 0 || data.length % s.frameBytes !== 0) throw new ApiError(400, 'bad_frame_size', 'payload is not a whole number of RGBA frames');
    const count = data.length / s.frameBytes;
    if (s.nextFrame + count > s.totalFrames) throw new ApiError(400, 'too_many_frames', 'more frames than the snapshot contains');
    s.nextFrame += count;
    const sink = s.sink;
    // The encoder going away means the job was canceled or failed: a typed conflict, not a server error. It may already be
    // gone when the frames arrive (a write to a closed pipe reports nothing further), so that is checked first, and the
    // encoder exiting while a write waits for room ends the wait.
    const closed = () => new ApiError(409, 'render_session_closed', 'the encoder for this render session has stopped');
    if (sink.exitCode !== null || sink.signalCode !== null || sink.killed || sink.stdin.destroyed || !sink.stdin.writable) throw closed();
    await new Promise<void>((resolve, reject) => {
      const off = () => { sink.stdin.off('error', onErr); sink.off('close', onErr); sink.stdin.off('drain', done); };
      const onErr = () => { off(); reject(closed()); };
      const done = () => { off(); resolve(); };
      sink.stdin.once('error', onErr);
      sink.once('close', onErr);
      if (sink.stdin.write(data)) done();
      else sink.stdin.once('drain', done);
    });
    if (s.jobId) this.store.updateJob(s.jobId, { stage: `rendering ${s.nextFrame}/${s.totalFrames}` });
  }

  /** Sample-exact audio mix of the snapshot as a WAV file (separate stream from video), following the shared audio plan. */
  private renderAudio(doc: ProjectDocument, firstSample: number, totalSamples: number, outFile: string, isCanceled: () => boolean) {
    return renderMix(audioPlan(doc), (assetId) => this.store.blobPath(doc.assets[assetId]!.contentHash), firstSample, totalSamples, outFile, isCanceled, (assetId) => timeOriginSeconds(doc.assets[assetId]), (assetId) => doc.assets[assetId]?.audio?.channels === 1);
  }

  private async run(jobId: string) {
    const job = this.store.getJob(jobId);
    if (job.status !== 'queued') return;
    const attempt = job.attempt + 1;
    this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt });
    const work = path.join(this.store.tmpDir, `${jobId}_${attempt}`);
    fs.mkdirSync(work, { recursive: true });
    const doc: ProjectDocument = job.input.snapshot;
    // Jobs created before manifests existed (or recovered ones) get a default plan from their own snapshot.
    const manifest: Manifest = job.input.manifest ?? this.plan(doc, job.input.revision, {}).manifest;
    const { options, output } = manifest;
    let token: string | undefined;
    const started = Date.now();
    const canceled = () => this.cancelRequested.has(jobId);
    this.running = { jobId };
    try {
      // The manifest is re-verified at run time: bytes must still be the ones the job was planned against.
      for (const a of manifest.assets) {
        let ok = false;
        try { ok = fs.statSync(this.store.blobPath(a.contentHash)).size === a.byteSize; } catch { /* missing */ }
        if (!ok) throw new ApiError(422, 'render_blocked', `source media ${a.id} is no longer available`, { blockers: [{ code: 'missing_media', ids: [a.id] }] });
      }
      const { frameRate, sampleRate } = output;
      const ext = { 'mp4-h264-aac': 'mp4', 'webm-vp9-opus': 'webm', gif: 'gif', wav: 'wav', png: 'png' }[options.format];
      const partial = path.join(work, `out.${ext}`);
      const final = path.join(this.store.outDir, `${jobId}.${ext}`);
      const firstSample = T.nearestSampleIndex(T.frameTime(output.firstFrame, frameRate), sampleRate);
      const totalSamples = T.nearestSampleIndex(T.frameTime(output.firstFrame + output.frames, frameRate), sampleRate) - firstSample;
      let audioClips = 0;
      let audioMix: MixResult | null = null;
      let renderStageMs: unknown = null;
      let validation: Record<string, unknown>;

      if (options.format === 'png') {
        this.store.updateJob(jobId, { stage: 'rendering still' });
        fs.writeFileSync(partial, await this.renderStill(doc, job.input.revision, output.firstFrame, options.scale));
        const p = await ffprobe(partial);
        validation = { codec: p.streams[0]?.codec_name, width: p.streams[0]?.width, height: p.streams[0]?.height, frame: output.firstFrame };
        if (validation.codec !== 'png' || validation.width !== output.width || validation.height !== output.height) throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
      } else {
        const wav = options.format === 'wav' ? partial : path.join(work, 'mix.wav');
        const gif = options.format === 'gif';
        if (!gif) {
          this.store.updateJob(jobId, { stage: 'rendering audio' });
          audioMix = await this.renderAudio(doc, firstSample, totalSamples, wav, canceled);
          audioClips = audioMix.clips;
          if (canceled()) throw new Error('canceled');
        }
        if (options.format === 'wav') {
          const p = await ffprobe(partial);
          const a = p.streams.find((x: any) => x.codec_type === 'audio');
          validation = { audioCodec: a?.codec_name, audioSampleRate: Number(a?.sample_rate), channels: a?.channels, samples: Number(a?.duration_ts), expectedSamples: totalSamples };
          if (validation.samples !== totalSamples) throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
        } else {
          const opened = this.open(doc, job.input.revision, jobId, { width: output.width, height: output.height, firstFrame: output.firstFrame, frames: output.frames });
          token = opened.token;
          const s = opened.session;
          const mp4 = options.format === 'mp4-h264-aac';
          const crf = gif ? '' : String(CRF[options.format as 'mp4-h264-aac' | 'webm-vp9-opus'][options.quality]);
          const ff = spawn('ffmpeg', gif ? [
            '-hide_banner', '-v', 'error', '-y',
            '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${output.width}x${output.height}`, '-framerate', `${frameRate.num}/${frameRate.den}`, '-i', 'pipe:0',
            // One palette for the whole clip, then ordered dithering: stable colours from frame to frame.
            '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', '-f', 'gif', partial,
          ] : [
            '-hide_banner', '-v', 'error', '-y',
            '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${output.width}x${output.height}`, '-framerate', `${frameRate.num}/${frameRate.den}`, '-i', 'pipe:0',
            '-i', wav, '-map', '0:v:0', '-map', '1:a:0',
            '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p',
            ...(mp4 ? ['-c:v', 'libx264', '-preset', options.quality === 'draft' ? 'veryfast' : 'medium', '-crf', crf, '-profile:v', 'high'] : ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', options.quality === 'high' ? '2' : '4']),
            '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
            ...(mp4 ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4'] : ['-c:a', 'libopus', '-b:a', '160k', '-f', 'webm']), partial,
          ]);
          this.running.ff = ff;
          let stderr = '';
          ff.stderr.on('data', (d) => (stderr += d));
          ff.stdin.on('error', () => {});
          const exited = new Promise<number>((res) => ff.on('close', (code) => res(code ?? -1)));
          s.sink = ff;
          this.store.updateJob(jobId, { stage: `rendering 0/${s.totalFrames}` });
          // A cancel that arrived while the render page was still being opened found nothing to abort: stop the page as soon as it can be stopped.
          const render = this.host.renderAll(opened.url, (abort) => { if (this.running) this.running.abort = abort; if (canceled()) abort(); }, { gpu: usesGpuEffects(doc) });
          const stats = await render;
          if (canceled()) throw new Error('canceled');
          if (s.nextFrame !== s.totalFrames) throw new Error(`renderer delivered ${s.nextFrame} of ${s.totalFrames} frames`);
          renderStageMs = stats.stageMs;
          ff.stdin.end();
          this.store.updateJob(jobId, { stage: 'encoding' });
          const code = await exited;
          if (canceled()) throw new Error('canceled');
          if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`);
          this.store.updateJob(jobId, { stage: 'validating' });
          const probe = await ffprobe(partial);
          const v = probe.streams.find((x: any) => x.codec_type === 'video');
          const a = probe.streams.find((x: any) => x.codec_type === 'audio');
          // WebM does not store a frame count; count packets for it.
          const frames = v?.nb_frames ? Number(v.nb_frames) : Number((await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', partial], { timeout: 120_000 })).stdout.trim());
          validation = { videoCodec: v?.codec_name, audioCodec: a?.codec_name, frames, expectedFrames: s.totalFrames, width: v?.width, height: v?.height, frameRate: v?.r_frame_rate, pixFmt: v?.pix_fmt, colorSpace: v?.color_space, audioSampleRate: Number(a?.sample_rate), durationSeconds: Number(probe.format.duration) };
          if (validation.videoCodec !== (gif ? 'gif' : mp4 ? 'h264' : 'vp9') || (!gif && validation.audioCodec !== (mp4 ? 'aac' : 'opus')) || frames !== s.totalFrames || v.width !== output.width || v.height !== output.height)
            throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
        }
      }
      if (canceled()) throw new Error('canceled');
      fs.renameSync(partial, final);
      let captionsOut: { file: string; format: string; cues: number } | null = null;
      if (job.input.sidecar) {
        const file = `${jobId}.captions.${job.input.sidecar.format}`;
        fs.writeFileSync(path.join(this.store.outDir, file), job.input.sidecar.text);
        captionsOut = { file, format: job.input.sidecar.format, cues: job.input.sidecar.cues };
      }
      const wall = (Date.now() - started) / 1000;
      const bytes = fs.statSync(final).size;
      this.store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: {
          file: path.basename(final), mimeType: { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif', wav: 'audio/wav', png: 'image/png' }[ext], captions: captionsOut, bytes, revision: job.input.revision, route: 'server-software-canvas2d', options, manifest: { engine: manifest.engine, assets: manifest.assets, fonts: manifest.fonts, audioEffects: manifest.audioEffects ?? [], output },
          estimate: { ...manifest.estimate, actualBytes: bytes }, audioClipsMixed: audioClips, audio: audioMix && { mixPeakDbfs: audioMix.mixPeakDbfs, clipped: audioMix.clipped, loudness: audioMix.loudness }, validation, renderStageMs, wallSeconds: wall, realtimeFactor: output.frames > 1 ? (output.frames * frameRate.den) / frameRate.num / wall : null,
        },
      });
    } catch (e: any) {
      if (canceled()) this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'export was canceled; partial output was discarded', retryable: true } });
      else this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'export_failed', message: String(e?.message ?? e), retryable: true } });
    } finally {
      this.running = null;
      this.cancelRequested.delete(jobId);
      if (token) {
        this.sessions.get(token)?.sink?.kill('SIGKILL');
        this.sessions.delete(token);
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}
