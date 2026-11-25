/**
 * Server audio mix (SPEC §10). Follows the shared audio plan (packages/engine/src/audio.ts) sample by sample:
 * each clip is decoded by its own ffmpeg process to float PCM and summed by the reference mixer in bounded chunks,
 * so memory does not grow with programme length. Loudness is measured with ffmpeg's EBU R128 meter.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import type { Readable } from 'node:stream';
import * as T from '@pulseframe/time';
import { limiterWindow, MasterLimiter, mixClip, openClipVoice, PitchStretcher, RampResampler, rampSpanOf, SoundCheck, soundEnd, type AudioPlan, type ClipVoice, type PlannedAudioClip } from '@pulseframe/engine';
import { ApiError } from './store.ts';
import type { ExportFinding, SoundChecks } from '@pulseframe/core';

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

/**
 * EBU R128 measurement of a raw float stereo file. Integrated loudness is null for silence (below the absolute gate).
 * `frames` measures only the first frames of the file (the limiter's raw mix carries its look-ahead after them); `wav` reads a
 * WAV file instead (the written export). Without options the command is exactly the one used before wave 7.
 */
export function measureLoudness(rawFile: string, sampleRate: number, opts: { frames?: number; wav?: boolean } = {}): Promise<Loudness> {
  return new Promise((resolve, reject) => {
    const input = opts.wav ? ['-i', rawFile] : ['-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', rawFile];
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', ...input, '-af', `${opts.frames !== undefined ? `atrim=end_sample=${opts.frames},` : ''}ebur128=peak=true:framelog=quiet`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
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

const r2 = (x: number) => Number(x.toFixed(2));
const r3 = (x: number) => Number(x.toFixed(3));

/**
 * Frames of mix the master chain needs after the export's last sample: the limiter's look-ahead minus one (its latency), so the
 * export keeps exactly `totalSamples` frames and its last frames are limited with the sound that really follows them. 0 without a
 * limiter: that path mixes exactly what it mixed before wave 7.
 */
export const masterLookaheadFrames = (plan: AudioPlan): number => (plan.limiter ? limiterWindow(plan.sampleRate).lookahead - 1 : 0);

/** The limiter's job-output report. */
type LimiterReport = NonNullable<MixResult['limiter']>;

/**
 * One limiter pass: raw (totalSamples + latency frames of mix, timeline samples from `firstSample`) × gain → the master limiter →
 * `outFile` (exactly totalSamples float frames; the first `latency` outputs, the delay line's initial silence, are dropped).
 * Also returns the raw mix's sample peak over the exported frames (before any gain).
 */
async function limitPass(raw: string, outFile: string, plan: AudioPlan, firstSample: number, totalSamples: number, gainDb: number, ceilingDb: number, isCanceled: () => boolean) {
  const sr = plan.sampleRate, lim = new MasterLimiter(sr, ceilingDb, firstSample), lat = lim.latency;
  const G = gainDb === 0 ? 1 : 10 ** (gainDb / 20);
  const inFd = fs.openSync(raw, 'r'), outFd = fs.openSync(outFile, 'w');
  let peak = 0, drop = lat, inFrame = 0;
  try {
    const frames = totalSamples + lat;
    for (let a = 0; a < frames; a += CHUNK) {
      if (isCanceled()) throw new Error('canceled');
      const len = Math.min(CHUNK, frames - a);
      const buf = Buffer.alloc(len * 8);
      fs.readSync(inFd, buf, 0, buf.length, a * 8);
      const x = new Float32Array(buf.buffer, buf.byteOffset, len * 2);
      const L = new Float32Array(len), R = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const l = x[i * 2]!, r = x[i * 2 + 1]!;
        if (inFrame + i < totalSamples) { const al = Math.abs(l), ar = Math.abs(r); if (al > peak) peak = al; if (ar > peak) peak = ar; }
        L[i] = G === 1 ? l : l * G; // with no gain the samples go in unchanged (x · 1 is not even computed)
        R[i] = G === 1 ? r : r * G;
      }
      inFrame += len;
      lim.process(L, R, L, R);
      const skip = Math.min(drop, len);
      drop -= skip;
      const out = new Float32Array((len - skip) * 2);
      for (let i = skip; i < len; i++) { out[(i - skip) * 2] = L[i]!; out[(i - skip) * 2 + 1] = R[i]!; }
      if (out.length) fs.writeSync(outFd, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
    }
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
  }
  return { stats: lim.stats(), peak };
}

/** Multiply a raw float stereo file by 10^(db/20) in place (the true-peak trim: only ever lowers, so the ceiling still holds). */
function scaleInPlace(file: string, db: number) {
  const g = 10 ** (db / 20), fd = fs.openSync(file, 'r+');
  try {
    const size = fs.fstatSync(fd).size;
    for (let off = 0; off < size; off += CHUNK * 8) {
      const buf = Buffer.alloc(Math.min(CHUNK * 8, size - off));
      fs.readSync(fd, buf, 0, buf.length, off);
      const x = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
      for (let i = 0; i < x.length; i++) x[i] = x[i]! * g;
      fs.writeSync(fd, buf, 0, buf.length, off);
    }
  } finally { fs.closeSync(fd); }
}

/** Where the 16-bit samples of a PCM WAV file are (RIFF chunks walked; a data size the writer left open runs to the end of the file). */
export function wavLayout(file: string): { channels: number; sampleRate: number; bits: number; dataOffset: number; dataBytes: number } {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, h = Buffer.alloc(8);
    fs.readSync(fd, h, 0, 8, 0);
    if (h.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a RIFF file');
    let off = 12, fmt: { channels: number; sampleRate: number; bits: number } | null = null;
    while (off + 8 <= size) {
      fs.readSync(fd, h, 0, 8, off);
      const id = h.toString('ascii', 0, 4), len = h.readUInt32LE(4);
      if (id === 'fmt ') { const f = Buffer.alloc(16); fs.readSync(fd, f, 0, 16, off + 8); fmt = { channels: f.readUInt16LE(2), sampleRate: f.readUInt32LE(4), bits: f.readUInt16LE(14) }; }
      if (id === 'data') {
        if (!fmt) throw new Error('data before fmt');
        return { ...fmt, dataOffset: off + 8, dataBytes: Math.min(len, size - off - 8) };
      }
      off += 8 + len + (len & 1);
    }
    throw new Error('no data chunk');
  } finally { fs.closeSync(fd); }
}

const SOUND_CHECK_METHOD = 'measured on the written 16-bit sound, before AAC: 0.1 s blocks; clipped = a block with at least 3 samples at -32768 or 32767; silence = blocks with RMS under -60 dBFS for at least 2 s';
/**
 * Sound checks (send-decisions C9) read from the written WAV: positions are the export's sample indices plus `firstSample`, so a
 * finding is a timeline time { value: sample, timescale: sampleRate }. A silence says whether a planned sound clip plays there.
 * Also counts every full-scale sample (the `clipped` flag of a limited export is read here, not assumed).
 */
export function soundChecksOfWav(wavFile: string, plan: AudioPlan, firstSample: number): { checks: SoundChecks; fullScaleSamples: number } {
  const w = wavLayout(wavFile);
  if (w.bits !== 16) throw new Error(`sound checks read 16-bit PCM, not ${w.bits}-bit`);
  const check = new SoundCheck(w.sampleRate, w.channels);
  const fd = fs.openSync(wavFile, 'r');
  let full = 0;
  try {
    const step = CHUNK * w.channels * 2;
    for (let off = 0; off < w.dataBytes; off += step) {
      const buf = Buffer.alloc(Math.min(step, w.dataBytes - off) & ~1);
      fs.readSync(fd, buf, 0, buf.length, w.dataOffset + off);
      const x = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
      for (let i = 0; i < x.length; i++) if (x[i] === 32767 || x[i] === -32768) full++;
      check.push(x);
    }
  } finally { fs.closeSync(fd); }
  const findings: ExportFinding[] = check.runs().map((r) => {
    const from = firstSample + r.fromSample, to = firstSample + r.toSample;
    return { kind: r.kind, from: T.rt(from, w.sampleRate), to: T.rt(to, w.sampleRate), ...(r.kind === 'silence' ? { soundPlays: plan.clips.some((c) => c.at < to && soundEnd(c) > from) } : {}), measured: r.measured };
  });
  return { checks: { method: SOUND_CHECK_METHOD, status: 'measured', findings }, fullScaleSamples: full };
}

const toWav = (raw: string, sampleRate: number, gainDb: number, outFile: string) =>
  run(['-hide_banner', '-nostdin', '-v', 'error', '-y', '-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', raw, ...(gainDb !== 0 ? ['-af', `volume=${gainDb.toFixed(4)}dB`] : []), '-c:a', 'pcm_s16le', '-f', 'wav', outFile]);

/**
 * The master chain (send-decisions C11, C12): raw float mix → 16-bit WAV, shared by export (renderMix) and programmeLoudness.
 * `raw` holds totalSamples + masterLookaheadFrames(plan) frames; `measured` is the raw mix's own measurement when the caller made it.
 *
 * Without a limiter it is exactly the path before wave 7 (byte-identical WAV): one static gain to the loudness target, stopped by
 * the true-peak ceiling, applied by ffmpeg while it writes 16 bits.
 * With a limiter: gain to the target (no longer stopped by the peak; loudness.truePeak is not consulted, the limiter ceiling rules)
 * → the limiter → measured → at most one correction of the gain when it is more than 0.5 LU off → the true peak measured by ffmpeg;
 * above the ceiling, one static trim lowers the whole file to it → 16 bits (no ffmpeg filter: the float file is written as is).
 * Either way the sound checks are read from the WAV written.
 */
export async function masterChain(plan: AudioPlan, raw: string, firstSample: number, totalSamples: number, outFile: string, mixPeak: number, isCanceled: () => boolean = () => false, measured?: Loudness): Promise<Omit<MixResult, 'clips'>> {
  if (!plan.limiter || totalSamples === 0) {
    const mixPeakDbfs = mixPeak > 0 ? Number((20 * Math.log10(mixPeak)).toFixed(2)) : null;
    let gainDb = 0;
    let loudness: MixResult['loudness'] = null;
    if (plan.loudness && totalSamples > 0) {
      const m = measured ?? await measureLoudness(raw, plan.sampleRate);
      const g = normalisationGain(m, plan.loudness.target, plan.loudness.truePeak);
      gainDb = g.gainDb;
      loudness = { measuredLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, target: plan.loudness.target, ceiling: plan.loudness.truePeak, appliedGainDb: Number(gainDb.toFixed(2)), limitedByPeak: g.limitedByPeak, method: 'EBU R128 integrated loudness, one static gain, no compression or limiting' };
    }
    await toWav(raw, plan.sampleRate, gainDb, outFile);
    const { checks } = soundChecksOfWav(outFile, plan, firstSample);
    return { mixPeakDbfs, loudness, clipped: mixPeak * 10 ** (gainDb / 20) > 1, checks };
  }
  const sr = plan.sampleRate, ceiling = plan.limiter.ceiling, target = plan.loudness?.target ?? null;
  const limited = `${outFile}.lim.f32`;
  try {
    let m: Loudness | null = null, gainDb = 0;
    if (target !== null) {
      m = measured ?? await measureLoudness(raw, sr, { frames: totalSamples });
      if (m.integratedLufs !== null) gainDb = target - m.integratedLufs;
    }
    let pass = await limitPass(raw, limited, plan, firstSample, totalSamples, gainDb, ceiling, isCanceled);
    let after = await measureLoudness(limited, sr);
    // At most one more pass, when the first one missed: (a) the limiter took loudness away (more than 0.5 LU short of the target):
    // the gain is corrected by what is missing; (b) the true peak (between samples, measured by ffmpeg) passed the ceiling the
    // samples respect: the limiter runs again with its sample ceiling lowered by that overshoot. (b) keeps the loudness where a
    // static trim alone would take the overshoot off the whole film (proof:send L5: 1.7 LU lost on sharp clicks).
    let corrected = false, marginDb = 0;
    const missDb = target !== null && m?.integratedLufs != null && after.integratedLufs !== null && Math.abs(after.integratedLufs - target) > 0.5 ? target - after.integratedLufs : 0;
    const overDb = after.truePeakDbtp !== null && after.truePeakDbtp > ceiling ? after.truePeakDbtp - ceiling : 0;
    if (missDb !== 0 || overDb > 0) {
      gainDb += missDb;
      marginDb = overDb;
      pass = await limitPass(raw, limited, plan, firstSample, totalSamples, gainDb, ceiling - marginDb, isCanceled);
      after = await measureLoudness(limited, sr);
      corrected = true;
    }
    const trimDb = after.truePeakDbtp !== null && after.truePeakDbtp > ceiling ? ceiling - after.truePeakDbtp : 0;
    if (trimDb !== 0) scaleInPlace(limited, trimDb);
    await toWav(limited, sr, 0, outFile);
    const final = await measureLoudness(outFile, sr, { wav: true });
    const { checks, fullScaleSamples } = soundChecksOfWav(outFile, plan, firstSample);
    const s = pass.stats;
    const limiter: LimiterReport = {
      ceiling, gainDb: r2(gainDb), maxReductionDb: r2(s.maxReductionDb), secondsLimited: r3(s.limitedSamples / sr), achievedLufs: final.integratedLufs, truePeakDbtp: final.truePeakDbtp, trimDb: r2(trimDb),
      method: `gain${target !== null ? ' to the loudness target' : ''}, then a 5 ms look-ahead brick-wall limiter (release 120 ms) to ${Math.floor(10 ** (ceiling / 20) * 32767)}/32768 of full scale; ${corrected ? `a second pass${missDb !== 0 ? `, the gain corrected by ${r2(missDb)} dB` : ''}${marginDb > 0 ? `, the sample ceiling lowered by the measured true-peak overshoot (${r2(marginDb)} dB)` : ''}; ` : ''}${trimDb !== 0 ? 'a static trim to bring the true peak to the ceiling; ' : ''}achieved loudness and true peak measured by ffmpeg (EBU R128) on the written 16-bit file`,
    };
    const mixPeakDbfs = pass.peak > 0 ? Number((20 * Math.log10(pass.peak)).toFixed(2)) : null;
    const loudness: MixResult['loudness'] = plan.loudness && m ? { measuredLufs: m.integratedLufs, truePeakDbtp: m.truePeakDbtp, target: plan.loudness.target, ceiling, appliedGainDb: r2(gainDb), limitedByPeak: false, method: 'EBU R128 integrated loudness; gain to the target, then the master limiter (the limiter ceiling rules; loudness.truePeak is not consulted)' } : null;
    return { mixPeakDbfs, loudness, clipped: fullScaleSamples > 0, limiter, checks };
  } finally {
    fs.rmSync(limited, { force: true });
  }
}

/**
 * Full export mix: plan -> raw float -> master chain (loudness gain, the master limiter when the project has one) -> 16-bit WAV
 * with exactly `totalSamples` frames, and its sound checks.
 */
export async function renderMix(plan: AudioPlan, blobPathOf: (assetId: string) => string, firstSample: number, totalSamples: number, outFile: string, isCanceled: () => boolean = () => false, originOf: (assetId: string) => number = () => 0, monoOf: (assetId: string) => boolean = () => false): Promise<MixResult> {
  const raw = `${outFile}.f32`;
  try {
    const extra = totalSamples > 0 ? masterLookaheadFrames(plan) : 0;
    const { clips, peak } = await mixToRaw(plan, blobPathOf, firstSample, totalSamples + extra, raw, isCanceled, originOf, monoOf);
    return { clips, ...(await masterChain(plan, raw, firstSample, totalSamples, outFile, peak, isCanceled)) };
  } finally {
    fs.rmSync(raw, { force: true });
  }
}
