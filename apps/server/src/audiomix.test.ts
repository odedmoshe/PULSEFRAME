/**
 * The server mix of clips with sound effects (ADR-0010) through the real ffmpeg decode. Effects are TEST kernels registered here
 * (labelled `test.*`): a decaying window stage and a decaying feedback comb as the ring stage; the real kernels are tested in the
 * engine. Synthetic sources are made by ffmpeg's lavfi generator.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chainReach, openClipVoice, registerKernel, soundEnd, type AudioPlan, type FxKernel, type PlannedAudioClip, type PlannedFx } from '@pulseframe/engine';
import { mixRoomBytes, mixToRaw } from './audiomix.ts';

const EPS = 2 ** -24;
const ceilLog = (g: number) => { let w = 0, x = 1; while (x > EPS) { x *= g; w++; } return w; };
const lp: FxKernel = { type: 'test.mix.lp', version: 1, stage: 3, reach: () => ({ warm: ceilLog(0.9), tail: 0 }), create: () => {
  let l = 0, r = 0;
  return { process(buf, frames) { for (let f = 0; f < frames; f++) { l += 0.1 * (buf[f * 2]! - l); r += 0.1 * (buf[f * 2 + 1]! - r); buf[f * 2] = l; buf[f * 2 + 1] = r; } } };
} };
const D = 480; // 10 ms
const comb: FxKernel = { type: 'test.mix.comb', version: 1, stage: 4, reach: () => ({ warm: D * (ceilLog(0.6) + 3), tail: D * (ceilLog(0.6) + 3) }), create: () => {
  const line = new Float64Array(D * 2); let pos = 0;
  return { process(buf, frames) { for (let f = 0; f < frames; f++) { const wl = line[pos * 2]!, wr = line[pos * 2 + 1]!; const xl = buf[f * 2]!, xr = buf[f * 2 + 1]!; line[pos * 2] = 0.6 * (xl + wl); line[pos * 2 + 1] = 0.6 * (xr + wr); pos = (pos + 1) % D; buf[f * 2] = xl + wl; buf[f * 2 + 1] = xr + wr; } } };
} };
registerKernel(lp);
registerKernel(comb);
const fx = (k: FxKernel): PlannedFx => ({ id: `fx_${k.type}`, type: k.type, version: k.version, stage: k.stage, params: {}, seed: 0 });
const CHAIN = [fx(lp), fx(comb)];
const SR = 48000;
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });

let dir = '';
const files: Record<string, string> = {};
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
const readRaw = (file: string) => { const b = fs.readFileSync(file); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-voicemix-'));
  // 3 s, 48 kHz stereo: two tones and a click every 0.25 s (L and R differ)
  files.stereo = path.join(dir, 'stereo.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc=0.3*sin(2*PI*220*t)+if(lt(mod(t\\,0.25)\\,0.002)\\,0.4\\,0)|0.3*sin(2*PI*330*t)+0.2*sin(2*PI*1500*t):s=48000:d=3", '-c:a', 'pcm_f32le', files.stereo]);
  // 3 s, 44.1 kHz mono
  files.mono = path.join(dir, 'mono44.wav');
  ff(['-f', 'lavfi', '-i', "aevalsrc=0.4*sin(2*PI*440*t)*if(lt(mod(t\\,0.5)\\,0.3)\\,1\\,0.2):s=44100:d=3", '-c:a', 'pcm_f32le', files.mono]);
}, 60_000);
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const blob = (assetId: string) => files[assetId]!;
const mono = (assetId: string) => assetId === 'mono';
function voiceClip(o: { id: string; asset: 'stereo' | 'mono'; at: number; length: number; sourceIn: [number, number]; reverse?: boolean; speed?: [number, number]; total: number }): PlannedAudioClip {
  const reach = chainReach(CHAIN, SR);
  const speed = o.speed ?? [1, 1];
  const tail = Math.min(reach.tail, o.total - o.at - o.length);
  const end = rt(o.sourceIn[0] * speed[1] * SR + o.length * speed[0] * o.sourceIn[1], o.sourceIn[1] * speed[1] * SR);
  return {
    clipId: o.id, trackId: 't', assetId: o.asset, at: o.at, length: o.length, source: 0, speed: speed[0] / speed[1], gain: 0.7, pan: -0.2,
    fade: [{ s: 0, g: 0 }, { s: 480, g: 1 }, { s: o.length - 960, g: 1 }, { s: o.length, g: 0 }],
    duck: [{ s: 0, g: 1 }, { s: 5000, g: 1 }, { s: 6000, g: 0.5 }, { s: o.length + tail, g: 0.5 }],
    ...(o.reverse ? { reverse: true as const } : {}),
    voice: { chain: CHAIN, sourceIn: rt(o.sourceIn[0], o.sourceIn[1]), sourceEnd: end, speed: { num: speed[0], den: speed[1] }, reverse: !!o.reverse, sourceRate: o.asset === 'mono' ? 44100 : SR, warmWindow: reach.warmWindow, warmRing: reach.warmRing, aheadWindow: reach.aheadWindow, tail, ...(tail < reach.tail ? { cutFrom: Math.min(o.length + tail, Math.max(o.length, o.total - o.at - 480)) } : {}) },
  };
}
const TOTAL = SR * 4;
/** A plain clip (no effects), a forward voice clip that starts at the file's start (its warm-up reads before the file), and a
 * reversed 44.1 kHz mono voice clip at speed 3/2 whose warm-up reads past the file's end, with its tail cut at the programme end. */
function plan(): AudioPlan {
  const plain: PlannedAudioClip = { clipId: 'plain', trackId: 't', assetId: 'stereo', at: 1000, length: SR, source: 4800, speed: 1, gain: 0.5, pan: 0, fade: [{ s: 0, g: 1 }, { s: SR, g: 1 }], duck: [{ s: 0, g: 1 }, { s: SR, g: 1 }] };
  const fwd = voiceClip({ id: 'fwd', asset: 'stereo', at: 24000, length: SR, sourceIn: [0, 1], total: TOTAL });
  const rev = voiceClip({ id: 'rev', asset: 'mono', at: SR * 2 + 20000, length: SR + 20000, sourceIn: [1, 1], speed: [3, 2], reverse: true, total: TOTAL });
  return { sampleRate: SR, totalSamples: TOTAL, clips: [plain, fwd, rev], loudness: null, cutTails: [], missingFx: [] };
}
async function mix(p: AudioPlan, first: number, total: number, chunk?: number) {
  const out = path.join(dir, `mix_${first}_${total}_${chunk ?? 'd'}_${Math.random().toString(36).slice(2)}.f32`);
  const r = await mixToRaw(p, blob, first, total, out, undefined, () => 0, mono, chunk);
  const pcm = readRaw(out);
  fs.rmSync(out);
  return { ...r, pcm };
}
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('server mix of clips with sound effects', () => {
  it('the voice gets exactly the playing-order source it asks for (ffmpeg trim, padding, mono and reversal): the mix equals the voice run in-process, bit for bit', async () => {
    const p = plan();
    // native PCM of each file at its own rate, as the voice expects it (mono heard in both channels)
    const native = (file: string, isMono: boolean) => { const b = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-af', `${isMono ? 'pan=stereo|c0=c0|c1=c0,' : ''}aformat=sample_fmts=flt:channel_layouts=stereo`, '-f', 'f32le', '-ac', '2', '-'], { maxBuffer: 1 << 28 }); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
    for (const clip of p.clips.filter((c) => c.voice)) {
      const src = native(files[clip.assetId]!, mono(clip.assetId));
      const v = openClipVoice(clip, SR, clip.voice!.sourceRate, 0, Infinity);
      const { origin, first, last, reverse } = v.input;
      const P = new Float32Array((last - first) * 2);
      for (let k = first; k < last; k++) { const j = reverse ? origin - 1 - k : origin + k; if (j >= 0 && j < src.length / 2) { P[(k - first) * 2] = src[j * 2]!; P[(k - first) * 2 + 1] = src[j * 2 + 1]!; } }
      const a = v.push(P), b = v.finish();
      const want = new Float32Array(a.length + b.length);
      want.set(a); want.set(b, a.length);
      const only = { ...p, clips: [clip] };
      const got = (await mix(only, 0, TOTAL)).pcm;
      expect(want.length, clip.clipId).toBe((soundEnd(clip) - clip.at) * 2);
      let same = true;
      for (let i = 0; i < want.length; i++) if (!Object.is(got[clip.at * 2 + i], want[i])) { same = false; break; }
      expect(same, clip.clipId).toBe(true);
      expect(peakOf(want), clip.clipId).toBeGreaterThan(0.05);
      // nothing outside [at, soundEnd)
      expect(peakOf(got.subarray(0, clip.at * 2)), clip.clipId).toBe(0);
      expect(peakOf(got.subarray(soundEnd(clip) * 2)), clip.clipId).toBe(0);
    }
    // the reversed clip's tail is cut at the programme end
    const rev = p.clips.find((c) => c.clipId === 'rev')!;
    expect(soundEnd(rev)).toBe(TOTAL);
    expect(rev.voice!.cutFrom).toBeDefined();
  }, 120_000);

  it('chunk sizes 1000, 48000 and 100003 give identical bytes', async () => {
    const p = plan();
    const runs = await Promise.all([1000, 48000, 100003].map((c) => mix(p, 0, TOTAL, c)));
    for (const r of runs) expect(r.clips).toBe(3);
    const bytes = runs.map((r) => Buffer.from(r.pcm.buffer, r.pcm.byteOffset, r.pcm.byteLength));
    expect(bytes[0]!.equals(bytes[1]!)).toBe(true);
    expect(bytes[2]!.equals(bytes[1]!)).toBe(true);
    expect(peakOf(runs[1]!.pcm)).toBeGreaterThan(0.1);
  }, 120_000);

  it('a range equals the same stretch of the full mix: bit-exact inside the warm-up, within 2/32768 beyond it, and a range in a tail contains the tail', async () => {
    const p = plan();
    const full = (await mix(p, 0, TOTAL)).pcm;
    const fwd = p.clips.find((c) => c.clipId === 'fwd')!, rev = p.clips.find((c) => c.clipId === 'rev')!;
    const warm = fwd.voice!.warmRing;
    expect(warm).toBeGreaterThan(10000);
    const ranges: { name: string; first: number; total: number; exact: boolean }[] = [
      { name: 'inside the warm-up of the forward clip', first: fwd.at + 1000, total: 30000, exact: true },
      { name: 'across a chunk boundary, inside the warm-up', first: 40000, total: 60001, exact: true },
      { name: 'the middle of the forward clip, past its warm-up', first: fwd.at + warm + 4321, total: 20000, exact: false },
      { name: 'the tail of the forward clip, past the clip end', first: fwd.at + fwd.length + 3000, total: 9000, exact: false },
      { name: 'the middle of the reversed clip', first: rev.at + 30000, total: 40000, exact: false },
    ];
    for (const r of ranges) {
      const part = (await mix(p, r.first, r.total, r.name.includes('chunk') ? 48000 : 7777)).pcm;
      expect(part.length, r.name).toBe(r.total * 2);
      let worst = 0, exact = true;
      for (let i = 0; i < part.length; i++) { const d = Math.abs(part[i]! - full[r.first * 2 + i]!); worst = Math.max(worst, d); if (!Object.is(part[i], full[r.first * 2 + i])) exact = false; }
      if (r.exact) expect(exact, r.name).toBe(true);
      expect(worst, r.name).toBeLessThanOrEqual(2 / 32768);
    }
    // the tail range: past the forward clip's end, only its tail sounds there (the plain clip ended), and it is audible
    const tailFirst = fwd.at + fwd.length + 3000;
    expect(tailFirst).toBeGreaterThan(1000 + SR); // the plain clip is over
    expect(tailFirst + 9000).toBeLessThan(rev.at);
    const tail = (await mix(p, tailFirst, 9000)).pcm;
    expect(peakOf(tail)).toBeGreaterThan(5e-4); // the ring-out of the comb (0.6 per 10 ms) after the clip's fade-out
  }, 180_000);
});

describe('storage asked before an export mix (wave 7 send, integration)', () => {
  const plan = (limiter?: { ceiling: number }) => ({ sampleRate: 48000, totalSamples: 0, clips: [], ...(limiter ? { limiter } : {}) }) as unknown as AudioPlan;
  it('without a limiter: the raw float file and the 16-bit WAV, as before wave 7 (max(1, n) · 2 · (4 + 2))', () => {
    expect(mixRoomBytes(plan(), 480_000)).toBe(480_000 * 12);
    expect(mixRoomBytes(plan(), 0)).toBe(12);
  });
  it('with a limiter: also its float output while the raw file (with M − 1 frames of look-ahead) is still there', () => {
    // M = round(0.005 · 48000) = 240: raw (n + 239) · 8, limited n · 8, WAV n · 4
    expect(mixRoomBytes(plan({ ceiling: -1 }), 480_000)).toBe((480_000 + 239) * 8 + 480_000 * 8 + 480_000 * 4);
    expect(mixRoomBytes(plan({ ceiling: -1 }), 480_000)).toBe(480_000 * 2 * (4 + 4 + 2) + 8 * 239);
  });
});
