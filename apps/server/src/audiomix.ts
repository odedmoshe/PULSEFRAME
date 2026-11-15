/**
 * Server audio mix (SPEC §10). Follows the shared audio plan (packages/engine/src/audio.ts) sample by sample:
 * each clip is decoded by its own ffmpeg process to float PCM and summed by the reference mixer in bounded chunks,
 * so memory does not grow with programme length. Loudness is measured with ffmpeg's EBU R128 meter.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import fs from 'node:fs';
import type { Readable } from 'node:stream';
import { mixClip, PitchStretcher, type AudioPlan, type PlannedAudioClip } from '@pulseframe/engine';
import { ApiError } from './store.ts';

const CHUNK = 48_000; // frames per mixing step
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
 * A clip that keeps its pitch at another speed: its stretch of source is read at normal rate from the START of the clip and
 * run through the shared stretcher; output before the first frame this export needs is produced and dropped. Starting at the
 * clip's start every time is what makes a range export sound exactly like the same range of the full export.
 */
class StretchReader {
  private stretcher: PitchStretcher;
  private ready: Float32Array[] = [];
  private size = 0; // frames ready
  private left: number; // source frames still to read
  private done = false;
  constructor(private source: PcmReader, speed: number, sampleRate: number, sourceFrames: number, private skip: number) {
    this.stretcher = new PitchStretcher(speed, sampleRate);
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

/** The single static gain export applies for a loudness target: reach the target, but never push true peak above the ceiling. */
export function normalisationGain(m: Loudness, target: number, ceiling: number): { gainDb: number; limitedByPeak: boolean } {
  if (m.integratedLufs === null) return { gainDb: 0, limitedByPeak: false };
  const want = target - m.integratedLufs;
  const room = m.truePeakDbtp === null ? want : ceiling - m.truePeakDbtp;
  return want > room ? { gainDb: room, limitedByPeak: true } : { gainDb: want, limitedByPeak: false };
}

/** Mix timeline samples [firstSample, firstSample + totalSamples) of the plan into a raw float stereo file. */
export async function mixToRaw(plan: AudioPlan, blobPathOf: (assetId: string) => string, firstSample: number, totalSamples: number, rawFile: string, isCanceled: () => boolean = () => false, originOf: (assetId: string) => number = () => 0, monoOf: (assetId: string) => boolean = () => false): Promise<{ clips: number; peak: number }> {
  const end = firstSample + totalSamples;
  const active = plan.clips.filter((c) => c.at < end && c.at + c.length > firstSample);
  const readers = new Map<PlannedAudioClip, PcmReader | StretchReader>();
  const fd = fs.openSync(rawFile, 'w');
  let peak = 0;
  try {
    for (let a = firstSample; a < end; a += CHUNK) {
      if (isCanceled()) throw new Error('canceled');
      const len = Math.min(CHUNK, end - a);
      const out = new Float32Array(len * 2);
      for (const clip of active) {
        const from = Math.max(a, clip.at), to = Math.min(a + len, clip.at + clip.length);
        if (to <= from) continue;
        let r = readers.get(clip);
        if (!r) {
          // Start reading at the first clip-local sample this export needs; positions are absolute sample indices.
          // A mono source is heard at full level in both channels (as players and the browser preview do); ffmpeg's default
          // mono-to-stereo conversion would lower it by 3 dB, which made the server export quieter than the preview.
          // -copyts keeps the file's raw timestamps and first_pts=<origin> starts the decoded sound at the file's own start: silence is inserted before a sound stream that starts late,
          // so sample positions mean file time (as in the preview), not "samples since the first one decoded".
          // A reversed clip: the part of its stretch this export needs is the EARLY part of the source (what is heard last), read whole and reversed by ffmpeg (held in memory for the length of the clip).
          // A clip that keeps its pitch is read from its start at normal rate; the stretcher does the speed change (see StretchReader).
          const skip = clip.keepPitch ? 0 : from - clip.at;
          const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', blobPathOf(clip.assetId), '-map', '0:a:0', '-af', `aresample=${plan.sampleRate}:first_pts=${Math.round(originOf(clip.assetId) * plan.sampleRate)},${monoOf(clip.assetId) ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=sample_fmts=flt:channel_layouts=stereo,${clip.reverse ? `atrim=start_sample=${clip.source}:end_sample=${clip.source + Math.round((clip.length - skip) * clip.speed)},asetpts=PTS-STARTPTS,areverse` : `atrim=start_sample=${clip.source + Math.round(skip * clip.speed)}:end_sample=${clip.source + Math.round(clip.length * clip.speed)},asetpts=PTS-STARTPTS`}${clip.speed === 1 || clip.keepPitch ? '' : `,asetrate=${Math.round(plan.sampleRate * clip.speed)},aresample=${plan.sampleRate}`}`, '-f', 'f32le', '-ac', '2', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
          r = clip.keepPitch ? new StretchReader(new PcmReader(child), clip.speed, plan.sampleRate, Math.round(clip.length * clip.speed), from - clip.at) : new PcmReader(child);
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
