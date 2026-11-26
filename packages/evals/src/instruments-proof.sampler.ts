/**
 * pnpm proof:instruments — the sampler part (builder W1; .artifacts/wave7/instruments-decisions.md §4.10): I1–I6, I3b, I8, I9, I14, on
 * IN-MEMORY banks only. No file is read but the two golden files; no sample of any recorded instrument exists here.
 *
 * SYNTHETIC TEST BANK: every zone below is written by code (sines, sums of sines with an exponential decay, a constant, impulses). It is
 * labelled a test bank wherever it appears and it is not, and does not stand for, any instrument. Nobody here can listen: every check is
 * a measurement (lengths in samples, peaks, RMS levels, frequencies by zero crossings, spectra by FFT, hashes), none says how anything
 * sounds. Figures are one sample each.
 *
 * Exports: the test bank builders (also used by apps/server/src/music/sampler.test.ts), the measurement helpers, and samplerChecks()
 * for the proof's entry point (integration imports it there).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MUSIC_SAMPLER_VERSION, MUSIC_STYLES, musicLayout, type MusicLayout } from '@pulseframe/core';
import { renderMusic, type RenderedMusic } from '../../../apps/server/src/music/render.ts';
import { renderSampled, type Region, type ResolvedBank, type ResolvedInstrument, type ZoneData } from '../../../apps/server/src/music/sampler.ts';
import { readWavSamples } from '../../../apps/server/src/music/wav.ts';
import type { InstrumentsRow } from './instruments-proof.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = path.join(here, '../../../apps/server/src/music');
const SERVER_DIR = path.join(here, '../../../apps/server/src');
export const INSTRUMENTS_GOLDEN_PATH = path.join(MUSIC_DIR, 'instruments.golden.json');
export const sha256 = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
export const SYNTHETIC_LABEL = 'SYNTHETIC TEST BANK (written by code: sines, decays, constants, impulses; not any instrument)';

// ---------- building blocks ----------
/** A region with SFZ's defaults (sustain 100 %, keytrack 100 cents, veltrack 100 %), every key and velocity. */
export function testRegion(over: Partial<Region> = {}): Region {
  return {
    zone: 0, lokey: 0, hikey: 127, lovel: 1, hivel: 127, keycenter: 60, keytrack: 100, transpose: 0, tune: 0,
    volume: 0, pan: 0, offset: 0, end: null, ampVeltrack: 100, velcurve: null,
    loopMode: 'no_loop', loopStart: null, loopEnd: null,
    attack: 0, hold: 0, decay: 0, sustain: 100, release: 0.001,
    trigger: 'attack', locc: {}, hicc: {}, xfin: null, xfout: null, sw: null, seqPosition: 1, lorand: 0, hirand: 1,
    ...over,
  };
}
/** A zone from a function of the frame index and channel, at a 24-bit integer scale (values in [−1, 1]). */
export function testZone(rate: number, channels: 1 | 2, frames: number, f: (n: number, ch: number) => number, loop: ZoneData['loop'] = null, name = 'zone'): ZoneData {
  const samples = new Int32Array(frames * channels);
  for (let n = 0; n < frames; n++) for (let ch = 0; ch < channels; ch++) samples[n * channels + ch] = Math.round(Math.max(-1, Math.min(1, f(n, ch))) * 8388607);
  return { path: `synthetic-test-bank/${name}.wav`, rate, channels, frames, samples, loop };
}
export const sineZone = (rate: number, hz: number, seconds: number, amp = 0.5, loop: ZoneData['loop'] = null): ZoneData =>
  testZone(rate, 1, Math.round(rate * seconds), (n) => amp * Math.sin((2 * Math.PI * hz * n) / rate), loop, `sine-${hz}-${rate}`);
export const testInstrument = (id: string, zones: ZoneData[], regions: Region[], cc: Record<number, number> = {}): ResolvedInstrument => ({ id, zones, regions, cc });
export type TestPart = NonNullable<ResolvedBank['parts']['pad']>;
export const testPart = (instrument: ResolvedInstrument, over: Partial<TestPart> = {}): TestPart => ({ instrument, gainDb: 0, vel: [1, 127], ...over });
const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/**
 * The synthetic test kit for `kit.calm.vsco@1` (its ids and parts, none of its files): a sustained looped stereo instrument at 44.1 kHz
 * for pad and double ('strings' by id only), a decaying two-layer mono instrument at 48 kHz for arp and lead ('piano' by id only).
 * About 4 MB decoded.
 */
export function samplerTestBank(): ResolvedBank {
  // sustained: per zone a period of a whole number of frames, so the loop (≈ 0.5 s, whole periods) has no seam
  const sZones: ZoneData[] = [], sRegions: Region[] = [];
  const sKeys = [36, 48, 60, 72, 84];
  sKeys.forEach((kc, zi) => {
    const P = Math.round(44100 / midiHz(kc)), f = 44100 / P;
    const len = 44100, ls = P * Math.floor(13230 / P), le = ls + P * Math.floor(22050 / P) - 1;
    sZones.push(testZone(44100, 2, len, (n, ch) => {
      const ph = (2 * Math.PI * n) / P;
      return 0.5 * (Math.sin(ph) + 0.3 * Math.sin(2 * ph + ch * 0.7) + 0.15 * Math.sin(3 * ph + ch * 1.3)) / 1.45;
    }, { start: ls, end: le }, `sustained-${kc}`));
    sRegions.push(testRegion({ zone: zi, lokey: zi === 0 ? 0 : kc - 6, hikey: zi === sKeys.length - 1 ? 97 : kc + 5, keycenter: kc, tune: 1200 * Math.log2(midiHz(kc) / f), loopMode: 'loop_continuous', attack: 0.08, release: 0.4 }));
  });
  // decaying: two velocity layers per zone; the loud one carries a 3rd harmonic (the marker of check I4)
  const pZones: ZoneData[] = [], pRegions: Region[] = [];
  const pKeys = [48, 60, 72, 84];
  pKeys.forEach((kc, k) => {
    const f = midiHz(kc);
    for (const loud of [false, true]) {
      const zi = pZones.length;
      pZones.push(testZone(48000, 1, 72000, (n) => {
        const t = n / 48000, ph = 2 * Math.PI * f * t;
        return 0.6 * Math.exp(-t / 0.8) * (Math.sin(ph) + 0.2 * Math.sin(2 * ph) + (loud ? 0.25 * Math.sin(3 * ph) : 0)) / 1.45;
      }, null, `decaying-${kc}-${loud ? 'loud' : 'soft'}`));
      pRegions.push(testRegion({ zone: zi, lokey: k === 0 ? 0 : kc - 6, hikey: k === pKeys.length - 1 ? 96 : kc + 5, lovel: loud ? 81 : 1, hivel: loud ? 127 : 80, keycenter: kc, release: 0.25 }));
    }
  });
  const strings = testInstrument('strings', sZones, sRegions), piano = testInstrument('piano', pZones, pRegions);
  return {
    kitId: 'kit.calm.vsco', version: 1, bank: 'synthetic-test-1',
    parts: {
      pad: testPart(strings, { gainDb: -16, vel: [40, 100] }),
      double: testPart(strings, { gainDb: -16, vel: [40, 100] }),
      arp: testPart(piano, { gainDb: -12, vel: [40, 110] }),
      lead: testPart(piano, { gainDb: -12, vel: [50, 120] }),
    },
  };
}

// ---------- measurement ----------
export const dbOf = (x: number): number => 20 * Math.log10(Math.max(x, 1e-300));
export function rmsOf(x: ArrayLike<number>, from = 0, to = x.length): number {
  let e = 0;
  for (let i = from; i < to; i++) e += x[i]! * x[i]!;
  return Math.sqrt(e / Math.max(1, to - from));
}
/** Frequency by upward zero crossings (linear interpolation between samples) over [from, to). */
export function zeroCrossingHz(x: ArrayLike<number>, from: number, to: number, sr = 48000): number {
  let first = -1, last = -1, count = 0;
  for (let i = from + 1; i < to; i++) {
    if (x[i - 1]! < 0 && x[i]! >= 0) {
      const t = i - 1 + -x[i - 1]! / (x[i]! - x[i - 1]!);
      if (first < 0) first = t; else count++;
      last = t;
    }
  }
  return (count * sr) / (last - first);
}
/** Magnitude spectrum (amplitude, Blackman-Harris window, coherent gain corrected) of 2^k samples by a radix-2 FFT. */
export function amplitudeSpectrum(x: ArrayLike<number>, from: number, size: number): Float64Array {
  const re = new Float64Array(size), im = new Float64Array(size);
  let wsum = 0;
  for (let i = 0; i < size; i++) {
    const a = (2 * Math.PI * i) / (size - 1);
    const w = 0.35875 - 0.48829 * Math.cos(a) + 0.14128 * Math.cos(2 * a) - 0.01168 * Math.cos(3 * a);
    re[i] = x[from + i]! * w; wsum += w;
  }
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < size; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const ar = re[i + k + len / 2]!, ai = im[i + k + len / 2]!;
      const tr = ar * wr - ai * wi, ti = ar * wi + ai * wr;
      re[i + k + len / 2] = re[i + k]! - tr; im[i + k + len / 2] = im[i + k]! - ti;
      re[i + k] = re[i + k]! + tr; im[i + k] = im[i + k]! + ti;
    }
  }
  const out = new Float64Array(size / 2);
  for (let b = 0; b < size / 2; b++) out[b] = (2 * Math.hypot(re[b]!, im[b]!)) / wsum;
  return out;
}
/** The largest spectral peak in [loHz, hiHz) away from `skipHz` (± skipBins), in amplitude. */
export function largestOther(spec: Float64Array, sr: number, loHz: number, hiHz: number, skipHz: number[], skipBins = 8): { amp: number; hz: number } {
  const size = spec.length * 2;
  let amp = 0, hz = 0;
  for (let b = 1; b < spec.length; b++) {
    const f = (b * sr) / size;
    if (f < loHz || f >= hiHz) continue;
    if (skipHz.some((s) => Math.abs(b - (s * size) / sr) <= skipBins)) continue;
    if (spec[b]! > amp) { amp = spec[b]!; hz = f; }
  }
  return { amp, hz };
}
const peakNear = (spec: Float64Array, sr: number, hz: number, bins = 6): number => {
  const c = Math.round((hz * spec.length * 2) / sr);
  let m = 0;
  for (let b = Math.max(0, c - bins); b <= Math.min(spec.length - 1, c + bins); b++) m = Math.max(m, spec[b]!);
  return m;
};
/** One note into fresh buffers. */
export function playNote(part: TestPart, midi: number, vel: number, gate: number, frames: number): { L: Float64Array; R: Float64Array; n: number } {
  const L = new Float64Array(frames), R = new Float64Array(frames);
  const n = renderSampled(part, midi, vel, gate, L, R);
  return { L, R, n };
}

/** M1, M6, M7 and M8 of apps/server/src/music.test.ts for one track: the list of what failed (empty = every check holds), and levels. */
export function trackChecks(r: RenderedMusic, styleId: string, bars: number): { failures: string[]; rmsDb: number; peak: number; clamped: number } {
  const failures: string[] = [];
  const fail = (what: string) => failures.push(`${styleId} × ${bars}: ${what}`);
  const L: MusicLayout = musicLayout(styleId, bars);
  const S = L.samplesPerBeat, frames = L.totalFrames;
  if (frames !== 4 * bars * S || r.wav.length !== 44 + 16 * bars * S) fail(`M1 length ${r.wav.length}`);
  const s = readWavSamples(r.wav);
  const rms = (from: number, to: number, ch: 0 | 1 | 'mono') => {
    let e = 0;
    for (let n = from; n < to; n++) { const v = ch === 'mono' ? (s[2 * n]! + s[2 * n + 1]!) / 2 : s[2 * n + ch]!; e += v * v; }
    return Math.sqrt(e / Math.max(1, to - from)) / 32768;
  };
  let peak = 0, dcL = 0, dcR = 0;
  for (let n = 0; n < frames; n++) { peak = Math.max(peak, Math.abs(s[2 * n]!), Math.abs(s[2 * n + 1]!)); dcL += s[2 * n]!; dcR += s[2 * n + 1]!; }
  if (peak / 32768 > 2 / 3) fail(`M6 peak ${peak / 32768}`);
  const rmsAll = Math.sqrt((rms(0, frames, 0) ** 2 + rms(0, frames, 1) ** 2) / 2);
  if (dbOf(rmsAll) < -24 || dbOf(rmsAll) > -12) fail(`M6 RMS ${dbOf(rmsAll).toFixed(2)} dBFS outside −24..−12`);
  if (Math.abs(dcL / frames / 32768) >= 1e-3 || Math.abs(dcR / frames / 32768) >= 1e-3) fail('M6 DC');
  if (s[0] !== 0 || s[1] !== 0 || s[2 * frames - 2] !== 0 || s[2 * frames - 1] !== 0) fail('M6 first or last frame not 0');
  let tail = 0;
  for (let n = frames - 480; n < frames; n++) tail = Math.max(tail, Math.abs(s[2 * n]!), Math.abs(s[2 * n + 1]!));
  if (dbOf(tail / 32768) >= -60) fail('M6 last 10 ms not below −60 dB');
  if (rms(0, frames, 'mono') / rms(0, frames, 0) < 0.7) fail('M6 mono fold-down');
  if (r.clamped / (2 * frames) >= 0.001) fail(`M6 clamp ${r.clamped}`);
  const secs = L.sections.map((x) => ({ ...x, rms: rms(x.startBar * 4 * S, (x.startBar + x.bars) * 4 * S, 'mono') }));
  const peaks = secs.filter((x) => x.kind === 'peak'), builds = secs.filter((x) => x.kind === 'build');
  const first = secs.find((x) => x.kind === 'intro') ?? builds[0]!;
  if (dbOf(peaks[peaks.length - 1]!.rms) - dbOf(first.rms) < 3) fail('M7 last peak not 3 dB over the start');
  const mean = (xs: { rms: number }[]) => xs.reduce((a, x) => a + x.rms, 0) / xs.length;
  if (!(mean(peaks) > mean(builds))) fail('M7 peaks not over builds');
  const endAt = (bars - 1) * 4 * S;
  let prev = Infinity;
  for (let w = endAt; w + 4800 <= frames; w += 4800) {
    const v = rms(w, w + 4800, 'mono');
    if (v > prev) { fail(`M8 ending window at ${w} rises`); break; }
    prev = v;
  }
  return { failures, rmsDb: dbOf(rmsAll), peak: peak / 32768, clamped: r.clamped };
}

// ---------- the checks ----------
type Check = () => Promise<Omit<InstrumentsRow, 'id' | 'part'>> | Omit<InstrumentsRow, 'id' | 'part'>;
const ok = (cond: boolean, measured: unknown, reason?: string): Omit<InstrumentsRow, 'id' | 'part'> => ({ status: cond ? 'pass' : 'fail', measured, ...(cond || !reason ? {} : { reason }) });

/** I1: r = 1 (48 kHz zone at its root), veltrack 0, 0 dB: the output equals the source, sample for sample, from 32 to the release. */
export function checkI1() {
  const zone = testZone(48000, 2, 48000, (n, ch) => 0.7 * Math.sin(n * 0.0371 + ch) * Math.sin(n * 0.00113), null, 'i1');
  const part = testPart(testInstrument('i1', [zone], [testRegion({ keycenter: 60, ampVeltrack: 0, release: 0.1 })]));
  const gate = 24000, { L, R } = playNote(part, 60, 0.5, gate, 48000);
  let mismatches = 0;
  for (let i = 32; i < gate; i++) if (L[i] !== zone.samples[2 * i]! / 8388608 || R[i] !== zone.samples[2 * i + 1]! / 8388608) mismatches++;
  return ok(mismatches === 0, { comparedFrames: gate - 32, mismatches }, 'the output differs from the source');
}
/** I2: a 440 Hz zone at 44.1 kHz: 440 Hz ± 0.05 cent at its root; ±1 and ±3 semitones within ± 0.1 cent (zero crossings over 2 s). */
export function checkI2() {
  const zone = sineZone(44100, 440, 1.0, 0.5, { start: 0, end: 44099 }); // 440 Hz × 1 s: whole periods, a seamless loop
  const part = testPart(testInstrument('i2', [zone], [testRegion({ keycenter: 69, loopMode: 'loop_continuous', ampVeltrack: 0 })]));
  const rows = [0, 1, -1, 3, -3].map((d) => {
    const { L } = playNote(part, 69 + d, 1, 120000, 120000);
    const hz = zeroCrossingHz(L, 4800, 4800 + 96000);
    const want = 440 * 2 ** (d / 12);
    return { semitones: d, hz: Number(hz.toFixed(6)), cents: Number((1200 * Math.log2(hz / want)).toFixed(5)) };
  });
  const pass = rows.every((r) => Math.abs(r.cents) <= (r.semitones === 0 ? 0.05 : 0.1));
  return ok(pass, rows, 'a pitch is off by more than the limit');
}
/** I3: a 1 kHz sine one semitone up: every other component below −60 dB of the fundamental. */
export function checkI3() {
  const zone = sineZone(44100, 1000, 2.0, 0.5, { start: 0, end: 88199 });
  const part = testPart(testInstrument('i3', [zone], [testRegion({ keycenter: 60, loopMode: 'loop_continuous', ampVeltrack: 0 })]));
  const { L } = playNote(part, 61, 1, 60000, 60000);
  const spec = amplitudeSpectrum(L, 8000, 32768);
  const f0 = 1000 * 2 ** (1 / 12), fund = peakNear(spec, 48000, f0);
  const other = largestOther(spec, 48000, 20, 24000, [f0]);
  const rel = dbOf(other.amp / fund);
  return ok(rel < -60, { fundamentalHz: Number(f0.toFixed(2)), largestOtherDb: Number(rel.toFixed(1)), atHz: Math.round(other.hz) }, 'a component other than the fundamental is above −60 dB');
}
/** I3b: a 15 kHz sine at 44.1 kHz played +7 semitones (r ≈ 1.377): the largest alias below 20 kHz, in dB of the source sine. */
export function checkI3b() {
  const zone = sineZone(44100, 15000, 2.0, 0.5, { start: 0, end: 88199 }); // 15 kHz × 2 s: whole periods
  const part = testPart(testInstrument('i3b', [zone], [testRegion({ keycenter: 60, loopMode: 'loop_continuous', ampVeltrack: 0 })]));
  const { L } = playNote(part, 67, 1, 60000, 60000);
  const spec = amplitudeSpectrum(L, 8000, 32768);
  const f0 = 15000 * 2 ** (7 / 12);
  const other = largestOther(spec, 48000, 20, 20000, [f0]);
  const rel = dbOf(other.amp / 0.5);
  return ok(rel < -40, { label: '8-tap kernel aliasing, measured (one sample)', ratio: Number(((44100 / 48000) * 2 ** (7 / 12)).toFixed(4)), outputToneHz: Math.round(f0), largestAliasBelow20kHzDb: Number(rel.toFixed(1)), atHz: Math.round(other.hz) }, 'an alias below 20 kHz is above −40 dB');
}
/** I4: velocity layers (0.3 soft, 0.9 loud: the 3rd-harmonic marker absent, present) and the amp_veltrack gain within 0.01 dB. */
export function checkI4() {
  const soft = sineZone(48000, 440, 1.0, 0.4, { start: 0, end: 47999 });
  const loud = testZone(48000, 1, 48000, (n) => 0.4 * (Math.sin((2 * Math.PI * 440 * n) / 48000) + 0.3 * Math.sin((2 * Math.PI * 1320 * n) / 48000)), { start: 0, end: 47999 }, 'i4-loud');
  const layered = testPart(testInstrument('i4', [soft, loud], [
    testRegion({ zone: 0, keycenter: 69, hivel: 64, loopMode: 'loop_continuous' }),
    testRegion({ zone: 1, keycenter: 69, lovel: 65, loopMode: 'loop_continuous' }),
  ]));
  const marker = (vel: number) => {
    const { L } = playNote(layered, 69, vel, 40000, 40000);
    const spec = amplitudeSpectrum(L, 4000, 32768);
    return dbOf(peakNear(spec, 48000, 1320) / peakNear(spec, 48000, 440));
  };
  const m3 = marker(0.3), m9 = marker(0.9);
  const gains = [100, 50, 0].map((vt) => {
    const part = testPart(testInstrument('i4g', [soft], [testRegion({ keycenter: 69, loopMode: 'loop_continuous', ampVeltrack: vt })]));
    const lvl = (vel: number) => rmsOf(playNote(part, 69, vel, 40000, 40000).L, 4000, 36000);
    const v = Math.round(1 + 126 * 0.3); // MIDI velocity of 0.3 through the part's [1, 127]
    const measured = dbOf(lvl(0.3) / lvl(1));
    const formula = dbOf(1 + (vt / 100) * ((v * v) / (127 * 127) - 1));
    return { veltrack: vt, midiVel: v, measuredDb: Number(measured.toFixed(4)), formulaDb: Number(formula.toFixed(4)), diffDb: Math.abs(measured - formula) };
  });
  const pass = m3 < -80 && m9 > -12 && m9 < -9 && gains.every((g) => g.diffDb <= 0.01);
  return ok(pass, { markerDbAtVel03: Number(m3.toFixed(1)), markerDbAtVel09: Number(m9.toFixed(1)), gains }, 'a layer or a gain is off');
}
/** I5: after the gate the level falls 60 dB within the release ± 2 ms; the note's last sample is 0 (a constant zone shows the envelope). */
export function checkI5() {
  const zone = testZone(48000, 1, 4800, () => 0.5, { start: 0, end: 4799 }, 'i5-constant');
  const release = 0.3;
  const part = testPart(testInstrument('i5', [zone], [testRegion({ keycenter: 60, loopMode: 'loop_continuous', ampVeltrack: 0, release })]));
  const gate = 24000, { L, n } = playNote(part, 60, 1, gate, 60000);
  const level = Math.abs(L[gate]!);
  let cross = -1;
  for (let i = gate; i < n; i++) if (Math.abs(L[i]!) <= level / 1000) { cross = i; break; }
  const ms = ((cross - gate) / 48) ;
  const pass = cross > 0 && Math.abs(ms - release * 1000) <= 2 && L[n - 1] === 0 && L[0] === 0;
  return ok(pass, { releaseMs: release * 1000, fell60dbAfterMs: Number(ms.toFixed(3)), noteFrames: n, lastSample: L[n - 1], firstSample: L[0] }, 'the release or the last sample is off');
}
/** I6: a 0.25 s loop held 3 s: last 0.5 s RMS within 0.5 dB of the first; no step at a loop seam above the largest step in the source. */
export function checkI6() {
  // 440 Hz at 48 kHz: 0.25 s is exactly 110 periods (12,000 frames); 0.1 s before the loop, 0.1 s after
  const zone = sineZone(48000, 440, 0.45, 0.5, { start: 4800, end: 4800 + 12000 - 1 });
  const results = [0, 3].map((d) => {
    const part = testPart(testInstrument('i6', [zone], [testRegion({ keycenter: 69, loopMode: 'loop_continuous', ampVeltrack: 0 })]));
    const gate = 3 * 48000, { L } = playNote(part, 69 + d, 1, gate, gate);
    const first = rmsOf(L, 0, 24000), last = rmsOf(L, gate - 24000, gate);
    // seam frames: where the read position crosses the loop end (period of the loop in output frames)
    const r = 2 ** (d / 12), seamEvery = 12000 / r, firstSeam = 16800 / r;
    const near = new Set<number>();
    for (let s = firstSeam; s < gate - 8; s += seamEvery) for (let k = -6; k <= 6; k++) near.add(Math.floor(s) + k);
    let seamStep = 0, otherStep = 0;
    for (let i = 1000; i < gate - 1000; i++) { const st = Math.abs(L[i + 1]! - L[i]!); if (near.has(i)) seamStep = Math.max(seamStep, st); else otherStep = Math.max(otherStep, st); }
    let srcStep = 0;
    for (let i = 4800; i < 16799; i++) srcStep = Math.max(srcStep, Math.abs(zone.samples[i + 1]! - zone.samples[i]!) / 8388608);
    return { semitones: d, rmsChangeDb: Number(dbOf(last / first).toFixed(4)), seamStep: Number(seamStep.toFixed(6)), largestStepAwayFromSeams: Number(otherStep.toFixed(6)), largestStepInSource: Number(srcStep.toFixed(6)) };
  });
  // at r = 1 the seam is compared with the source; at +3 semitones (steps grow with pitch) with the output away from the seams
  const pass = results.every((x) => Math.abs(x.rmsChangeDb) <= 0.5) && results[0]!.seamStep <= results[0]!.largestStepInSource && results[1]!.seamStep <= results[1]!.largestStepAwayFromSeams * 1.0001;
  return ok(pass, results, 'the level drifts or a seam steps');
}

export interface InstrumentsGolden { note: string; sampler: number; bank: string; renders: Record<string, string> }
export const GOLDEN_RENDERS: readonly { styleId: string; bars: number; seed: number }[] = [{ styleId: 'music.calm', bars: 8, seed: 1 }, { styleId: 'music.calm', bars: 16, seed: 3 }];
export const goldenKey = (g: { styleId: string; bars: number; seed: number }): string => `${g.styleId} ${g.bars} bars seed ${g.seed}`;
export const readInstrumentsGolden = (): InstrumentsGolden => JSON.parse(fs.readFileSync(INSTRUMENTS_GOLDEN_PATH, 'utf8')) as InstrumentsGolden;
/** I8: the synthetic test kit renders twice with equal bytes, equal to instruments.golden.json. */
export async function checkI8() {
  const golden = readInstrumentsGolden(), bank = samplerTestBank();
  const rows = [];
  for (const g of GOLDEN_RENDERS) {
    const a = await renderMusic(g.styleId, g.bars, g.seed, { bank }), b = await renderMusic(g.styleId, g.bars, g.seed, { bank: samplerTestBank() });
    rows.push({ render: goldenKey(g), twiceEqual: a.wav.equals(b.wav), sha256: sha256(a.wav), golden: golden.renders[goldenKey(g)] ?? null });
  }
  const pass = golden.sampler === MUSIC_SAMPLER_VERSION && rows.every((r) => r.twiceEqual && r.sha256 === r.golden);
  return ok(pass, { bank: golden.bank, rows }, 'a render differs between runs or from the golden file');
}
/** I9: music.golden.json still matches (no bank: the synthesiser's bytes). */
export async function checkI9() {
  const golden = JSON.parse(fs.readFileSync(path.join(SERVER_DIR, 'music.golden.json'), 'utf8')) as { bars: number; seed: number; sha256: Record<string, string> };
  const rows = [];
  for (const s of MUSIC_STYLES) rows.push({ styleId: s.id, equal: sha256((await renderMusic(s.id, golden.bars, golden.seed)).wav) === golden.sha256[s.id] });
  return ok(rows.every((r) => r.equal), rows, 'a style no longer gives its golden bytes');
}
/** I14: M1, M6, M7 and M8 hold for recorded renders of the synthetic test kit. */
export async function checkI14(barsList: readonly number[] = [4, 7, 16, 33, 64]) {
  const bank = samplerTestBank(), rows = [];
  for (const bars of barsList) {
    const r = await renderMusic('music.calm', bars, 1, { bank });
    const c = trackChecks(r, 'music.calm', bars);
    rows.push({ bars, rmsDb: Number(c.rmsDb.toFixed(2)), peak: Number(c.peak.toFixed(4)), clamped: c.clamped, failures: c.failures });
  }
  return ok(rows.every((r) => r.failures.length === 0), { label: SYNTHETIC_LABEL, rows }, 'a track check fails');
}

export const SAMPLER_CHECKS: Readonly<Record<string, Check>> = { I1: checkI1, I2: checkI2, I3: checkI3, I3b: checkI3b, I4: checkI4, I5: checkI5, I6: checkI6, I8: checkI8, I9: checkI9, I14: () => checkI14() };
/** The sampler part's rows for pnpm proof:instruments (each check one sample; a throw is a fail with its message). */
export async function samplerChecks(): Promise<InstrumentsRow[]> {
  const rows: InstrumentsRow[] = [];
  for (const [id, run] of Object.entries(SAMPLER_CHECKS)) {
    try { rows.push({ id, part: 'sampler', ...(await run()) }); } catch (e) { rows.push({ id, part: 'sampler', status: 'fail', reason: e instanceof Error ? e.message : String(e) }); }
  }
  return rows;
}
