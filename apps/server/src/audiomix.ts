/**
 * Server audio mix (SPEC §10). Follows the shared audio plan (packages/engine/src/audio.ts) sample by sample:
 * each clip is decoded by its own ffmpeg process to float PCM and summed by the reference mixer in bounded chunks,
 * so memory does not grow with programme length. Loudness is measured with ffmpeg's EBU R128 meter.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { mixClip, openClipVoice, PitchStretcher, RampResampler, rampSpanOf, soundEnd, type AudioPlan, type ClipVoice, type PlannedAudioClip } from '@pulseframe/engine';
import { ApiError } from './store.ts';
import type { SoundChecks } from '@pulseframe/core';

const CHUNK = 48_000; // frames per mixing step (default)
const HIGH_WATER = 8 << 20;

/** Sequential reader of a child process's stdout with backpressure. Short streams are padded with silence. */
class PcmReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private ended = false;
  private wake: (() => void) | null = null;
  constructor(private child: ChildProcessByStdio<null, Readable, null>) {
    child.stdout.on('data', (d: Buffer) => { this.chunks.push(d); this.size += d.length; if (this.size > HIGH_WATER) child.stdout.pause(); this.wake?.(); });
    child.stdout.on('end', () => { this.ended = true; this.wake?.(); });
    child.on('error', () => { this.ended = true; this.wake?.(); });
  }
  async read(frames: number): Promise<Float32Array> {
    const bytes = frames * 8;
    while (this.size < bytes && !this.ended) { this.child.stdout.resume(); await new Promise<void>((r) => (this.wake = r)); this.wake = null; }
    const out = Buffer.alloc(bytes); // zero-filled: a source that ends early contributes silence
    let filled = 0;
    while (filled < bytes && this.chunks.length) {
      const c = this.chunks[0]!;
      const take = Math.min(c.length, bytes - filled);
      c.copy(out, filled, 0, take);
      filled += take;
      if (take === c.length) this.chunks.shift(); else this.chunks[0] = c.subarray(take);
    }
    this.size -= filled;
    return new Float32Array(out.buffer, out.byteOffset, frames * 2);
  }
  close() { this.child.stdout.destroy(); this.child.kill('SIGKILL'); }
}

export interface MixResult {
  clips: number;
  /** Peak of the summed mix before any normalisation, in dBFS (sample peak). Above 0 means the un-normalised mix would clip. */
  mixPeakDbfs: number | null;
  loudness: null | { measuredLufs: number | null; truePeakDbtp: number | null; target: number; ceiling: number; appliedGainDb: number; limitedByPeak: boolean; method: string };
  clipped: boolean;
  /** Master limiter (wave 7 send; worker A): present only when the plan has one. Gain, largest reduction, seconds limited, achieved loudness, true peak, trim. */
  limiter?: { ceiling: number; gainDb: number; maxReductionDb: number; secondsLimited: number; achievedLufs: number | null; truePeakDbtp: number | null; trimDb: number; method: string };
  /** Sound checks (wave 7 send; worker A), read from the written 16-bit WAV; times are timeline samples. */
  checks?: SoundChecks;
}
export interface Loudness { integratedLufs: number | null; truePeakDbtp: number | null; rangeLu: number | null }

/** EBU R128 measurement of a raw float stereo file. Integrated loudness is null for silence (below the absolute gate). */
export function measureLoudness(rawFile: string, sampleRate: number): Promise<Loudness> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', rawFile, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 1 << 20) err = err.slice(-(1 << 19)); });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'loudness could not be measured', { tail: err.slice(-300) }));
      const summary = err.slice(err.lastIndexOf('Summary:'));
      const num = (re: RegExp) => { const m = re.exec(summary); const v = m ? Number(m[1]) : NaN; return Number.isFinite(v) ? v : null; };
      const i = num(/I:\s+(-?[\d.]+) LUFS/);
      resolve({ integratedLufs: i !== null && i <= -69.9 ? null : i, truePeakDbtp: num(/Peak:\s+(-?[\d.]+) dBFS/), rangeLu: num(/LRA:\s+(-?[\d.]+) LU/) });
    });
  });
}

/**
 * A clip whose speed change is done here and not by ffmpeg — one that keeps its pitch at another speed, or one with a continuous
 * speed ramp: its stretch of source is read at normal rate from the START of the clip and run through the shared processor
 * (stretch.ts); output before the first frame this export needs is produced and dropped. Starting at the clip's start every
 * time is what makes a range export sound exactly like the same range of the full export.
 */
class StretchReader {
  private stretcher: PitchStretcher | RampResampler;
  private ready: Float32Array[] = [];
  private size = 0; // frames ready
  private left: number; // source frames still to read
  private done = false;
  constructor(private source: PcmReader, processor: PitchStretcher | RampResampler, sourceFrames: number, private skip: number) {
    this.stretcher = processor;
    this.left = sourceFrames;
  }
  private add(out: Float32Array) {
    let frames = out.length >> 1;
    if (this.skip > 0) { const drop = Math.min(this.skip, frames); this.skip -= drop; out = out.subarray(drop * 2); frames -= drop; }
    if (frames > 0) { this.ready.push(out); this.size += frames; }
  }
  async read(frames: number): Promise<Float32Array> {
    while (this.size < frames && !this.done) {
      if (this.left > 0) { const n = Math.min(this.left, 16384); this.left -= n; this.add(this.stretcher.push(await this.source.read(n))); }
      else { this.add(this.stretcher.finish()); this.done = true; }
    }
    const out = new Float32Array(frames * 2); // short of sound at the very end: silence
    let filled = 0;
    while (filled < out.length && this.ready.length) {
      const c = this.ready[0]!;
      const take = Math.min(c.length, out.length - filled);
      out.set(c.subarray(0, take), filled);
      filled += take;
      if (take === c.length) this.ready.shift(); else this.ready[0] = c.subarray(take);
    }
    this.size -= filled >> 1;
    return out;
  }
  close() { this.source.close(); }
}

/**
 * A clip with sound effects (ADR-0010): ffmpeg only decodes the stretch of native source the voice asks for (in playing order),
 * and the shared engine voice does everything else — time map, effects, volume keys, fades, gain, ducking, balance and the tail
 * cut. Its output is added straight into the mix. The voice is opened at the first sample this export needs, so a range starts
 * with the same warm-up as any other route.
 */
class VoiceReader {
  private ready: Float32Array[] = [];
  private size = 0; // output frames ready
  private pad: number; // leading silence (native indices below 0, forward clips)
  private left: number; // frames still to read from ffmpeg
  private done = false;
  constructor(private voice: ClipVoice, private source: PcmReader | null, pad: number, fromSource: number) {
    this.pad = pad;
    this.left = source ? fromSource : 0;
  }
  private add(out: Float32Array) { if (out.length) { this.ready.push(out); this.size += out.length >> 1; } }
  async read(frames: number): Promise<Float32Array> {
    while (this.size < frames && !this.done) {
      if (this.pad > 0) { const n = Math.min(this.pad, 16384); this.pad -= n; this.add(this.voice.push(new Float32Array(n * 2))); }
      else if (this.left > 0) { const n = Math.min(this.left, 16384); this.left -= n; this.add(this.voice.push(await this.source!.read(n))); }
      else { this.add(this.voice.finish()); this.done = true; }
    }
    const out = new Float32Array(frames * 2); // short of output at the very end: silence
    let filled = 0;
    while (filled < out.length && this.ready.length) {
      const c = this.ready[0]!;
      const take = Math.min(c.length, out.length - filled);
      out.set(c.subarray(0, take), filled);
      filled += take;
      if (take === c.length) this.ready.shift(); else this.ready[0] = c.subarray(take);
    }
    this.size -= filled >> 1;
    return out;
  }
  close() { this.source?.close(); }
}
/**
 * Open the voice of `clip` for clip-local output [from, to) and the ffmpeg process that decodes its input: native PCM at the
 * source rate from the file's own time zero (first_pts, as for plain clips), mono heard in both channels, padded with silence
 * after the end of the file, trimmed to the native stretch the voice reads and reversed for a reversed clip.
 */
function openVoiceReader(plan: AudioPlan, clip: PlannedAudioClip, path: string, originSeconds: number, mono: boolean, from: number, to: number): VoiceReader {
  const v = clip.voice!;
  const voice = openClipVoice(clip, plan.sampleRate, v.sourceRate, from, to);
  const { origin, first, last, reverse } = voice.input;
  const total = Math.max(0, last - first);
  // native indices of P[first, last): forward origin+first .. origin+last; reversed origin−last .. origin−first (read backwards)
  const lo = reverse ? origin - last : origin + first, hi = reverse ? origin - first : origin + last;
  const a = Math.max(0, lo), b = Math.max(0, hi);
  // forward: native indices below 0 come first in playing order and are silence; reversed they come last and finish() supplies them
  const pad = reverse ? 0 : Math.min(total, a - lo);
  const fromSource = b - a;
  if (fromSource <= 0) return new VoiceReader(voice, null, pad, 0);
  const af = `aresample=${v.sourceRate}:first_pts=${Math.round(originSeconds * v.sourceRate)},${mono ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=sample_fmts=flt:channel_layouts=stereo,apad,atrim=start_sample=${a}:end_sample=${b},asetpts=PTS-STARTPTS${reverse ? ',areverse' : ''}`;
  const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', path, '-map', '0:a:0', '-af', af, '-f', 'f32le', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
  return new VoiceReader(voice, new PcmReader(child), pad, fromSource);
}

/** The single static gain export applies for a loudness target: reach the target, but never push true peak above the ceiling. */
export function normalisationGain(m: Loudness, target: number, ceiling: number): { gainDb: number; limitedByPeak: boolean } {
  if (m.integratedLufs === null) return { gainDb: 0, limitedByPeak: false };
  const want = target - m.integratedLufs;
  const room = m.truePeakDbtp === null ? want : ceiling - m.truePeakDbtp;
  return want > room ? { gainDb: room, limitedByPeak: true } : { gainDb: want, limitedByPeak: false };
}

/**
 * Mix timeline samples [firstSample, firstSample + totalSamples) of the plan into a raw float stereo file. `chunk` (frames per
 * mixing step) changes nothing in the result; it is a parameter so that tests can prove that.
 */
export async function mixToRaw(plan: AudioPlan, blobPathOf: (assetId: string) => string, firstSample: number, totalSamples: number, rawFile: string, isCanceled: () => boolean = () => false, originOf: (assetId: string) => number = () => 0, monoOf: (assetId: string) => boolean = () => false, chunk = CHUNK): Promise<{ clips: number; peak: number }> {
  const end = firstSample + totalSamples;
  // a clip with effects sounds until the end of its tail (soundEnd), not only until its own end
  const active = plan.clips.filter((c) => c.at < end && soundEnd(c) > firstSample);
  const readers = new Map<PlannedAudioClip, PcmReader | StretchReader | VoiceReader>();
  const fd = fs.openSync(rawFile, 'w');
  let peak = 0;
  try {
    for (let a = firstSample; a < end; a += chunk) {
      if (isCanceled()) throw new Error('canceled');
      const len = Math.min(chunk, end - a);
      const out = new Float32Array(len * 2);
      for (const clip of active) {
        const from = Math.max(a, clip.at), to = Math.min(a + len, soundEnd(clip));
        if (to <= from) continue;
        if (clip.voice) {
          let vr = readers.get(clip) as VoiceReader | undefined;
          if (!vr) { vr = openVoiceReader(plan, clip, blobPathOf(clip.assetId), originOf(clip.assetId), monoOf(clip.assetId), from - clip.at, Math.min(end, soundEnd(clip)) - clip.at); readers.set(clip, vr); }
          const y = await vr.read(to - from); // gain, duck, balance and the tail cut are already applied
          const o = (from - a) * 2;
          for (let i = 0; i < y.length; i++) out[o + i] = out[o + i]! + y[i]!;
          if (to === soundEnd(clip)) { vr.close(); readers.delete(clip); }
          continue;
        }
        let r = readers.get(clip) as PcmReader | StretchReader | undefined;
        if (!r) {
          // Start reading at the first clip-local sample this export needs; positions are absolute sample indices.
          // A mono source is heard at full level in both channels (as players and the browser preview do); ffmpeg's default
          // mono-to-stereo conversion would lower it by 3 dB, which made the server export quieter than the preview.
          // -copyts keeps the file's raw timestamps and first_pts=<origin> starts the decoded sound at the file's own start: silence is inserted before a sound stream that starts late,
          // so sample positions mean file time (as in the preview), not "samples since the first one decoded".
          // A reversed clip: the part of its stretch this export needs is the EARLY part of the source (what is heard last), read whole and reversed by ffmpeg (held in memory for the length of the clip).
          // A clip that keeps its pitch is read from its start at normal rate; the stretcher does the speed change (see StretchReader).
          const inJs = !!clip.keepPitch || clip.speedEnd !== undefined;
          const skip = inJs ? 0 : from - clip.at;
          // source frames the clip plays in all: its length × speed, or what the ramp covers
          const srcLen = clip.speedEnd !== undefined ? RampResampler.sourceFrames(rampSpanOf(clip)) : Math.round(clip.length * clip.speed);
          const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', blobPathOf(clip.assetId), '-map', '0:a:0', '-af', `aresample=${plan.sampleRate}:first_pts=${Math.round(originOf(clip.assetId) * plan.sampleRate)},${monoOf(clip.assetId) ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=sample_fmts=flt:channel_layouts=stereo,${clip.reverse ? `atrim=start_sample=${clip.source}:end_sample=${clip.source + Math.round((clip.length - skip) * clip.speed)},asetpts=PTS-STARTPTS,areverse` : `atrim=start_sample=${clip.source + Math.round(skip * clip.speed)}:end_sample=${clip.source + srcLen},asetpts=PTS-STARTPTS`}${clip.speed === 1 || inJs ? '' : `,asetrate=${Math.round(plan.sampleRate * clip.speed)},aresample=${plan.sampleRate}`}`, '-f', 'f32le', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
          r = inJs ? new StretchReader(new PcmReader(child), clip.speedEnd !== undefined ? new RampResampler(rampSpanOf(clip)) : new PitchStretcher(clip.speed, plan.sampleRate), srcLen, from - clip.at) : new PcmReader(child);
          readers.set(clip, r);
        }
        mixClip(out, a, clip, await r.read(to - from), from - clip.at);
        if (to === clip.at + clip.length) { r.close(); readers.delete(clip); }
      }
      for (let i = 0; i < out.length; i++) { const v = Math.abs(out[i]!); if (v > peak) peak = v; }
      fs.writeSync(fd, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    }
  } finally {
    for (const r of readers.values()) r.close();
    fs.closeSync(fd);
  }
  return { clips: active.length, peak };
}

const run = (args: string[]) => new Promise<void>((resolve, reject) => {
  const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => (err += d));
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.slice(-300)}`))));
});

/** Full export mix: plan -> raw float -> (optional loudness normalisation) -> 16-bit WAV with exactly `totalSamples` frames. */
export async function renderMix(plan: AudioPlan, blobPathOf: (assetId: string) => string, firstSample: number, totalSamples: number, outFile: string, isCanceled: () => boolean = () => false, originOf: (assetId: string) => number = () => 0, monoOf: (assetId: string) => boolean = () => false): Promise<MixResult> {
  const raw = `${outFile}.f32`;
  try {
    const { clips, peak } = await mixToRaw(plan, blobPathOf, firstSample, totalSamples, raw, isCanceled, originOf, monoOf);
    const mixPeakDbfs = peak > 0 ? Number((20 * Math.log10(peak)).toFixed(2)) : null;
    let gainDb = 0;
    let loudness: MixResult['loudness'] = null;
    if (plan.loudness && totalSamples > 0) {
      const m = await measureLoudness(raw, plan.sampleRate);
      const g = normalisationGain(m, plan.loudness.target, plan.loudness.truePeak);
      gainDb = g.gainDb;
      loudness = { measuredLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, target: plan.loudness.target, ceiling: plan.loudness.truePeak, appliedGainDb: Number(gainDb.toFixed(2)), limitedByPeak: g.limitedByPeak, method: 'EBU R128 integrated loudness, one static gain, no compression or limiting' };
    }
    await run(['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(plan.sampleRate), '-ac', '2', '-i', raw, ...(gainDb !== 0 ? ['-af', `volume=${gainDb.toFixed(4)}dB`] : []), '-c:a', 'pcm_s16le', '-f', 'wav', outFile]);
    return { clips, mixPeakDbfs, loudness, clipped: peak * 10 ** (gainDb / 20) > 1 };
  } finally {
    fs.rmSync(raw, { force: true });
  }
}
