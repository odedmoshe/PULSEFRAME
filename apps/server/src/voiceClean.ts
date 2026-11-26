/**
 * measure_voice (ADR-0013): the background noise, mains hum and speech level of a sound clip's recording, measured from the
 * original file, and the clean_voice operations that would clean it. Read-only, model-free: nothing is stored in the project;
 * the result carries candidate ops in the findSilences pattern (http.ts), to be sent as ONE transaction with expectedRevision.
 * Wired by the lead: POST /api/v1/projects/:id/analysis/voice (job kind 'voice') and the MCP tool measure_voice.
 *
 * What is measured is the whole recording (the asset), not only the stretch a clip uses: its pauses give the noise profile, and
 * scope 'asset' cleans every clip cut from it with that one profile. The file is decoded by ffmpeg at 48 kHz stereo (mono as
 * L = R) on the file's own clock (aresample first_pts, -copyts: the beat tracker's template, analysis.ts), streamed into the
 * engine's voiceMeter, inside heavy() (at most two heavy measurements at once). A recording longer than 600 s is measured in 30
 * evenly spaced 20 s windows; the ranges are given in source seconds either way.
 */
import { spawn } from 'node:child_process';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { findClip, RationalTimeSchema, speedValue, timeOriginSeconds, type Clip, type MediaClip, type OpCall, type ProjectDocument, type Track } from '@pulseframe/core';
import { recommendedStrength, VOICE_MEASURE_RATE, voiceMeter, type VoiceMeasureOptions, type VoiceMeasurement, type VoiceMeter } from '@pulseframe/engine';
import { heavy } from './analysis.ts';
import { ApiError, type Store } from './store.ts';

export const VoiceMeasureBody = z.object({
  clipId: z.string(),
  strength: z.number().min(0).max(1).optional(),
  noiseRanges: z.array(z.object({ start: RationalTimeSchema, end: RationalTimeSchema })).max(50).optional().describe('SOURCE-time stretches that hold only noise'),
  scope: z.enum(['clip', 'asset']).optional().describe('asset: one clean_voice op per sound clip of the same recording'),
}).strict();
export interface VoiceCheck {
  revision: number; assetId: string; clipIds: string[]; method: string;
  /** ranges in source seconds */
  report: VoiceMeasurement;
  recommendedStrength: number;
  /** clean_voice with clipId, strength, profile, source: assetId, mainsHz */
  ops: OpCall[];
  /** 'Candidates only. To apply, send `ops` as ONE transaction with expectedRevision set to this revision. Measured, not listened to.' */
  note: string;
}

/** Longest stretch of a recording measured; a longer one is measured in WINDOWS evenly spaced windows of WINDOW_SECONDS. */
export const VOICE_MAX_SECONDS = 600;
const WINDOWS = 30, WINDOW_SECONDS = 20;
/** No decoding process may run longer than this (as analysis.ts). */
const DECODE_TIMEOUT_MS = 10 * 60_000;
const SR = VOICE_MEASURE_RATE;

/** The measurement used (the engine's in production; a test may pass a labelled stand-in). */
export interface VoiceMeasureDeps { meter: (opts?: VoiceMeasureOptions) => VoiceMeter; recommend: (m: VoiceMeasurement) => number }
const ENGINE: VoiceMeasureDeps = { meter: voiceMeter, recommend: recommendedStrength };

/** A media clip on a sound track whose file has sound: what clean_voice changes (core ops.ts soundTargets). */
const sounding = (doc: ProjectDocument, t: Track, c: Clip): c is MediaClip => c.type === 'media' && t.kind === 'audio' && !!doc.assets[c.assetId]?.audio;
/** Why clean_voice would refuse this sound clip (core refuseFxTimeMap and track locks), or null. */
export function cleanVoiceBlock(track: Track, clip: MediaClip): 'track_locked' | 'time_map' | null {
  if (track.locked) return 'track_locked';
  if (clip.speedEnd || (clip.keepPitch && speedValue(clip) !== 1)) return 'time_map';
  return null;
}
/** The sound clip a clip id stands for: itself, or the sound linked to a picture clip; 404 for an unknown clip, 422 no_audio when there is no sound. */
export function soundClipOf(doc: ProjectDocument, clipId: string): { clip: MediaClip; track: Track } {
  const f = findClip(doc, clipId);
  if (!f) throw new ApiError(404, 'not_found', 'clip not found in this project', { clipId });
  const clip = f.clip, link = clip.type === 'media' ? clip.linkGroupId : null;
  if (sounding(doc, f.track, clip)) return { clip, track: f.track };
  if (link)
    for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips)
      if (c.id !== clipId && c.type === 'media' && c.linkGroupId === link && sounding(doc, track, c)) return { clip: c, track };
  throw new ApiError(422, 'no_audio', 'this clip has no sound to clean', { clipId }, 'Give a sound clip, or a picture clip that is linked to its sound (get_timeline lists the clips of the sound tracks).');
}
/** Every sound clip cut from `assetId`, in every sequence, in timeline order of their tracks. */
function soundClipsOfAsset(doc: ProjectDocument, assetId: string): { clip: MediaClip; track: Track }[] {
  const out: { clip: MediaClip; track: Track }[] = [];
  for (const seq of Object.values(doc.sequences)) for (const track of seq.tracks) for (const c of track.clips) if (c.type === 'media' && c.assetId === assetId && sounding(doc, track, c)) out.push({ clip: c, track });
  return out;
}

/** One decoded stretch of the recording: its source start (seconds), and where it lies in the stream pushed to the meter (frames). */
interface Window { sourceStart: number; pushedFrame: number; frames: number }
/** The stretches to decode: the whole recording up to VOICE_MAX_SECONDS, else WINDOWS evenly spaced windows. */
export function voiceWindows(durationSeconds: number): { start: number; seconds: number }[] {
  if (!(durationSeconds > VOICE_MAX_SECONDS)) return [{ start: 0, seconds: Math.max(0, durationSeconds) }];
  const step = (durationSeconds - WINDOW_SECONDS) / (WINDOWS - 1);
  return Array.from({ length: WINDOWS }, (_, k) => ({ start: k * step, seconds: WINDOW_SECONDS }));
}
/** Source seconds → seconds of the pushed stream, split at the windows (a range between two windows is cut into the parts inside them). */
export function toPushed(ranges: readonly { start: number; end: number }[], windows: readonly Window[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const r of ranges) for (const w of windows) {
    const ws = w.sourceStart, we = ws + w.frames / SR, a = Math.max(r.start, ws), b = Math.min(r.end, we);
    if (b > a) out.push({ start: w.pushedFrame / SR + (a - ws), end: w.pushedFrame / SR + (b - ws) });
  }
  return out;
}
/** Seconds of the pushed stream → source seconds (a range across a window join becomes one range per window). */
export function toSource(ranges: readonly { start: number; end: number }[], windows: readonly Window[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;
  for (const r of ranges) for (const w of windows) {
    const ps = w.pushedFrame / SR, pe = ps + w.frames / SR, a = Math.max(r.start, ps), b = Math.min(r.end, pe);
    if (b > a) out.push({ start: r6(w.sourceStart + (a - ps)), end: r6(w.sourceStart + (b - ps)) });
  }
  return out;
}

/** Decode [start, start + seconds) of the file's first audio stream at 48 kHz stereo (f32), on the file's own clock, into `sink`; resolves to the frames given. */
function decodeWindow(file: string, origin: number, start: number, seconds: number | null, sink: (pcm: Float32Array) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const from = Math.round(start * SR), trim = seconds === null ? (from > 0 ? `,atrim=start_sample=${from}` : '') : `,atrim=start_sample=${from}:end_sample=${from + Math.round(seconds * SR)}`;
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=${SR}:first_pts=${Math.round(origin * SR)}${trim},asetpts=PTS-STARTPTS`, '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: DECODE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let carry = Buffer.alloc(0), frames = 0, failed: unknown = null, err = '';
    p.stdout.on('data', (d: Buffer) => {
      if (failed) return;
      const bytes = carry.length ? Buffer.concat([carry, d]) : d, n = Math.floor(bytes.length / 8);
      carry = Buffer.from(bytes.subarray(n * 8));
      if (!n) return;
      const pcm = new Float32Array(n * 2); // aligned copy: a Buffer's offset need not be a multiple of 4
      Buffer.from(pcm.buffer).set(bytes.subarray(0, n * 8));
      frames += n;
      try { sink(pcm); } catch (e) { failed = e; p.kill('SIGKILL'); }
    });
    p.stderr.on('data', (d) => { if (err.length < 8000) err += d; });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (failed) return reject(failed);
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the audio of this file could not be analysed', { tail: err.slice(-400) }));
      resolve(frames);
    });
  });
}

/** measure_voice with the engine's voiceMeter (the contract signature; http.ts and mcp.ts call this). */
export function measureVoiceCheck(store: Store, projectId: string, body: z.infer<typeof VoiceMeasureBody>): Promise<VoiceCheck> {
  return measureVoiceCheckWith(store, projectId, body, ENGINE);
}
/** measure_voice with a given measurement (tests pass a labelled stand-in to check the plumbing without the engine's meter). */
export async function measureVoiceCheckWith(store: Store, projectId: string, body: z.infer<typeof VoiceMeasureBody>, deps: VoiceMeasureDeps): Promise<VoiceCheck> {
  const p = store.getProject(projectId);
  const doc = p.doc;
  const { clip: sound } = soundClipOf(doc, body.clipId);
  const assetId = sound.assetId, asset = doc.assets[assetId];
  if (!asset?.audio) throw new ApiError(422, 'no_audio', 'this clip has no sound to clean', { clipId: body.clipId });
  const file = store.blobPath(asset.contentHash), origin = timeOriginSeconds(asset), duration = T.toSeconds(asset.duration);
  const plan = voiceWindows(duration), whole = plan.length === 1;
  const sourceRanges = (body.noiseRanges ?? []).map((r) => ({ start: T.toSeconds(r.start), end: T.toSeconds(r.end) }));

  const measured = await heavy(async () => {
    // where each window lies in the pushed stream is planned before decoding (the meter takes the noise ranges in pushed seconds
    // when it is made); the PCM goes straight into the meter, so memory stays the meter's own
    const planned: Window[] = [];
    let at = 0;
    for (const w of plan) { const frames = whole ? Infinity : Math.round(w.seconds * SR); planned.push({ sourceStart: w.start, pushedFrame: at, frames }); at += frames; }
    const meter = deps.meter(sourceRanges.length ? { noiseRanges: toPushed(sourceRanges, planned) } : {});
    const windows: Window[] = [];
    let pushed = 0;
    for (const w of planned) {
      const frames = await decodeWindow(file, origin, w.sourceStart, whole ? null : w.frames / SR, (pcm) => meter.push(pcm));
      windows.push({ sourceStart: w.sourceStart, pushedFrame: pushed, frames });
      pushed += frames;
    }
    return { report: meter.finish(), windows, pushed, short: !whole && windows.some((w, k) => w.frames < planned[k]!.frames) };
  });

  const { windows, pushed, short } = measured;
  const report: VoiceMeasurement = { ...measured.report, noise: { ...measured.report.noise, ranges: toSource(measured.report.noise.ranges, windows) } };
  const recommended = deps.recommend(report);
  const strength = body.strength ?? recommended;
  const mainsHz = report.hum ? (String(report.hum.hz) as '50' | '60') : null;
  const scope = body.scope ?? 'clip';
  const candidates = scope === 'asset' ? soundClipsOfAsset(doc, assetId) : [soundClipOf(doc, body.clipId)];
  const left: string[] = [];
  const targets = candidates.filter(({ clip, track }) => { const why = cleanVoiceBlock(track, clip); if (why) left.push(`${clip.id} (${why === 'track_locked' ? 'its track is locked' : 'it keeps its pitch at another speed or changes speed gradually, which sound effects do not support yet'})`); return !why; });
  const ops: OpCall[] = targets.map(({ clip }) => ({ op: 'clean_voice', args: { clipId: clip.id, includeLinked: false, strength, profile: report.noise.profile, source: assetId, mainsHz } }));
  const seconds = (x: number) => Number(x.toFixed(1));
  const method = `${whole ? `the whole recording (${seconds(pushed / SR)} s)` : `${WINDOWS} evenly spaced ${WINDOW_SECONDS} s windows of the ${seconds(duration)} s recording (${seconds(pushed / SR)} s${short ? '; the sound ends before the file does, so some windows are shorter' : ''})`}, decoded by ffmpeg at 48 kHz stereo from the original file and measured without a model: the noise level in the 24 bands of the noise profile from ${report.noise.mode === 'ranges' ? 'the given noise-only stretches' : 'its quietest stretches'}, mains hum lines at 50 or 60 Hz, speech level, peak and signal-to-noise ratio (engine voiceMeter)`;
  const note = ['Candidates only. To apply, send `ops` as ONE transaction with expectedRevision set to this revision (or propose it). Measured, not listened to: nobody has judged by ear how the cleanup sounds.',
    report.noise.warning === 'no_pause_found' ? 'No pause was found: the noise profile is that of the quietest stretches, which may hold speech, so the cleanup may also lower the voice; give noiseRanges where there is only noise.' : '',
    report.noise.warning === 'ranges_too_short' ? 'The noise-only stretches given were shorter than 0.3 s in all, so the quietest stretches were used instead.' : '',
    mainsHz ? `Mains hum at ${mainsHz} Hz was found: hum removal is included.` : 'No mains hum was found: hum removal is left out.',
    left.length ? `Left out (clean_voice would refuse them): ${left.join(', ')}.` : ''].filter(Boolean).join(' ');
  return { revision: p.revision, assetId, clipIds: targets.map((t) => t.clip.id), method, report, recommendedStrength: recommended, ops, note };
}
