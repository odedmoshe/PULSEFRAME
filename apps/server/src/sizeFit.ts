/**
 * Size-fit pass of an MP4 export (wave 7, track send; send-decisions §2.1, C4–C8). Runs in Exporter.run AFTER the route's own
 * validation of the full-quality intermediate (single pass or segmented join, both at quality high and the planned scale) and
 * BEFORE the atomic rename, so nothing is published unless the bytes on disk are at or under the target:
 *
 *   intermediate ≤ target          → published as it is ('already_fits', one encode, the scale still stated)
 *   else attempt 1 at the plan's v → two-pass libx264 from the intermediate + AAC from the export's own WAV (never from the
 *                                    intermediate's AAC), every tag but ALLOWED_OUTPUT_TAGS dropped, exact track timescale
 *   over the target                → ONE retry at retryBitrate(v, target, bytes)
 *   still over                     → typed job error size_fit_missed with both byte counts; nothing is published
 *
 * Every attempt is validated like the export (codec, size, exact frame count, the exact constant-frame-rate check) and checked
 * for tags. The pass log files live in the job's work directory, removed with it. A cancel kills the running encoder (onProcess).
 * `fault` is the labelled TEST seam (Exporter.fitFault, set only by startServer's deps): it treats the first or every attempt as
 * over the target; the result says so in `test`.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { ALLOWED_OUTPUT_TAGS, retryBitrate, SEND_API_REFUSALS, type SizeFitFault, type SizeFitManifest, type SizeFitOutput } from '@pulseframe/core';
import { EXPORT_COLOR_TAGS, type Manifest } from './export.ts';
import { cfrProblem, packetPts, trackTimescale } from './exportSegments.ts';
import { ApiError } from './store.ts';

const exec = promisify(execFile);
export const SIZE_FIT_METHOD = 'The compositor\'s frames are encoded once at full quality (CRF 16, the planned picture size), then encoded again from that file to the target in two passes of libx264 with the sound encoded from the export\'s own mix; the bytes on disk are checked, with one retry. The picture is therefore encoded twice. The target is a number of bytes only, not how any app treats the file.';

type Proc = { kill(signal?: NodeJS.Signals): boolean };
export interface SizeFitDeps {
  /** the validated full-quality intermediate (work directory) */
  intermediate: string;
  /** the export's 16-bit mix (work/mix.wav on both routes) */
  wav: string;
  workDir: string;
  output: Manifest['output'];
  fit: SizeFitManifest;
  fault: SizeFitFault | null;
  canceled(): boolean;
  stage(text: string): void;
  onProcess(p: Proc | null): void;
}
export interface SizeFitResult { file: string; fit: SizeFitOutput; validation: Record<string, unknown> | null }

/** The two ffmpeg runs of one attempt at video rate v (bits per second). Exported for the metadata test and the proof. */
export function twoPassArgs(o: { intermediate: string; wav: string; passLog: string; videoBitrate: number; audioBitrate: number; frameRate: { num: number; den: number }; outFile: string }): [string[], string[]] {
  const { timescale } = trackTimescale(o.frameRate);
  const video = ['-map', '0:v:0', '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-b:v', String(o.videoBitrate), '-passlogfile', o.passLog, '-fps_mode', 'passthrough', ...EXPORT_COLOR_TAGS];
  return [
    ['-hide_banner', '-v', 'error', '-y', '-i', o.intermediate, ...video, '-pass', '1', '-an', '-map_metadata', '-1', '-f', 'null', '-'],
    ['-hide_banner', '-v', 'error', '-y', '-i', o.intermediate, '-i', o.wav, ...video, '-pass', '2', '-map', '1:a:0', '-c:a', 'aac', '-b:a', String(o.audioBitrate),
      '-map_metadata', '-1', '-map_chapters', '-1', '-video_track_timescale', String(timescale), '-movflags', '+faststart', '-f', 'mp4', o.outFile],
  ];
}

function run(args: string[], onProcess: (p: Proc | null) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    onProcess(p);
    p.on('error', (e) => { onProcess(null); reject(e); });
    p.on('close', (code) => { onProcess(null); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`)); });
  });
}

/** Format and stream tags of a file that are not in ALLOWED_OUTPUT_TAGS (C8), as "where:key". Empty = the file passes. */
export async function outputTagProblems(file: string): Promise<string[]> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format_tags:stream_tags', '-of', 'json', file], { timeout: 60_000, maxBuffer: 8 << 20 });
  const j = JSON.parse(stdout) as { format?: { tags?: Record<string, string> }; streams?: { tags?: Record<string, string> }[] };
  const allowed = new Set<string>(ALLOWED_OUTPUT_TAGS);
  const bad: string[] = [];
  for (const k of Object.keys(j.format?.tags ?? {})) if (!allowed.has(k)) bad.push(`format:${k}`);
  (j.streams ?? []).forEach((s, i) => { for (const k of Object.keys(s.tags ?? {})) if (!allowed.has(k)) bad.push(`stream${i}:${k}`); });
  return bad;
}
/** Throws the export's validation error when an MP4 output carries a tag outside the allow-list. */
export async function assertOutputTags(file: string): Promise<void> {
  const bad = await outputTagProblems(file);
  if (bad.length) throw new Error(`export failed validation: the file carries tags outside the allow-list (${bad.slice(0, 8).join(', ')})`);
}

/** Codec, size, exact frame count, exact constant frame rate and tags of one fitted file. Throws when any fails. */
async function validateFitted(file: string, output: Manifest['output'], fit: SizeFitManifest): Promise<Record<string, unknown>> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60_000, maxBuffer: 8 << 20 });
  const probe = JSON.parse(stdout);
  const v = probe.streams.find((x: any) => x.codec_type === 'video');
  const a = probe.streams.find((x: any) => x.codec_type === 'audio');
  const { frameTicks } = trackTimescale(output.frameRate);
  const pts = await packetPts(file);
  const cfr = cfrProblem(pts, frameTicks);
  const frames = Number(v?.nb_frames);
  const validation = { videoCodec: v?.codec_name, audioCodec: a?.codec_name, frames, expectedFrames: output.frames, packets: pts.length, width: v?.width, height: v?.height, frameRate: v?.r_frame_rate, pixFmt: v?.pix_fmt, colorSpace: v?.color_space, audioSampleRate: Number(a?.sample_rate), audioBitrate: Number(a?.bit_rate), durationSeconds: Number(probe.format?.duration), constantFrameRate: cfr === null, frameTicks };
  if (validation.videoCodec !== 'h264' || validation.audioCodec !== 'aac' || frames !== output.frames || pts.length !== output.frames || v?.width !== fit.width || v?.height !== fit.height || cfr !== null)
    throw new Error(`size-fit output failed validation: ${JSON.stringify({ ...validation, cfr })}`);
  await assertOutputTags(file);
  return validation;
}

/**
 * The rule of one attempt (pure, so the lead can read it): an attempt fits when its bytes on disk are at or under the target.
 * The TEST fault treats attempt 1 ('overshoot-once') or every attempt ('overshoot-always') as over; the bytes it then counts are
 * max(bytes, target + 1), so the retry's rate still comes from a real over-target figure, and the job says it was a test.
 */
export function attemptOutcome(bytes: number, targetBytes: number, attempt: 1 | 2, fault: SizeFitFault | null): { fits: boolean; countedBytes: number; forced: boolean } {
  const forced = fault === 'overshoot-always' || (fault === 'overshoot-once' && attempt === 1);
  const countedBytes = forced ? Math.max(bytes, targetBytes + 1) : bytes;
  return { fits: countedBytes <= targetBytes, countedBytes, forced };
}

const canceled = () => new Error('canceled');

export async function runSizeFit(d: SizeFitDeps): Promise<SizeFitResult> {
  const { fit, output } = d;
  const base = { targetBytes: fit.targetBytes, scale: fit.scale, width: fit.width, height: fit.height, method: SIZE_FIT_METHOD };
  const testNote = d.fault ? { test: `TEST fault: ${d.fault} (a test seam set by the server's caller; the over-target attempts below were forced, their bytes on disk are as measured)` } : {};
  d.stage('checking size');
  const first = fs.statSync(d.intermediate).size;
  if (first <= fit.targetBytes) {
    // one encode: the full-quality file already fits (its audio is the route's 192 kb/s AAC)
    return { file: d.intermediate, fit: { ...base, bytes: first, result: 'already_fits', attempts: [], audioBitrate: 192_000, ...testNote }, validation: null };
  }
  const attempts: SizeFitOutput['attempts'] = [];
  const counted: number[] = [];
  let v = fit.videoBitrate;
  for (const attempt of [1, 2] as const) {
    if (d.canceled()) throw canceled();
    const out = path.join(d.workDir, `fit-${attempt}.mp4`);
    const [p1, p2] = twoPassArgs({ intermediate: d.intermediate, wav: d.wav, passLog: path.join(d.workDir, `fitpass-${attempt}`), videoBitrate: v, audioBitrate: fit.audioBitrate, frameRate: output.frameRate, outFile: out });
    // the stage keeps only the words i18n knows (STAGE_WORDS 'fitting size' + its count): a retry shows the same two steps again
    d.stage('fitting size 1/2');
    await run(p1, d.onProcess);
    if (d.canceled()) throw canceled();
    d.stage('fitting size 2/2');
    await run(p2, d.onProcess);
    if (d.canceled()) throw canceled();
    d.stage('checking size');
    const validation = await validateFitted(out, output, fit);
    const bytes = fs.statSync(out).size;
    attempts.push({ videoBitrate: v, bytes });
    const o = attemptOutcome(bytes, fit.targetBytes, attempt, d.fault);
    counted.push(o.countedBytes);
    if (o.fits) return { file: out, fit: { ...base, bytes, result: 'fitted', attempts, audioBitrate: fit.audioBitrate, ...testNote }, validation };
    fs.rmSync(out, { force: true });
    v = retryBitrate(v, fit.targetBytes, o.countedBytes);
    if (v <= 0) break;
  }
  const E = SEND_API_REFUSALS.sizeFitMissed;
  const last = counted[counted.length - 1]!;
  throw new ApiError(422, E.code, E.message(last, fit.targetBytes), { targetBytes: fit.targetBytes, attempts, countedBytes: counted, retryable: false, ...testNote }, E.hint);
}
