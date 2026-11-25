/**
 * Synthetic songs for the musicfit tests and proof (wave 7; builder A). LABELLED FIXTURES: written by this code from sines and
 * xorshift noise, never downloaded, never anyone's music. Each comes with its beat grid (exact rationals), as a measured analysis
 * would give it. Every sample is a function of the section kind, the bar's number in its section and the sample's place in the bar,
 * so two bars with the same content are sample-identical (which the join search can measure).
 *
 * - abaSong: 120 BPM, A (8 bars) · B (8 bars) · A (8 bars) · ending (4 bars, a chord falling to a tenth, kicks getting softer), then half a
 *   second of silence.
 * - twoToneSong: 120 BPM, 8 bars of a steady 440 Hz tone, 8 bars of a steady 660 Hz tone, 4 bars of 440 Hz.
 * - throughSong: 120 BPM, 24 bars, every bar its own three tones (130 Hz to 2 kHz), level and noise (nothing repeats).
 */
import * as T from '@pulseframe/time';
import { writeWav } from '../music/wav.ts';

export const FIXTURE_RATE = 48_000;
export interface FixtureSong { name: string; pcm: Int16Array; frames: number; beats: T.RationalTime[]; downbeats: T.RationalTime[]; bpm: number; barFrames: number; sections: { kind: string; bars: number }[] }

const TWO_PI = 2 * Math.PI;
function xorshift(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296 - 0.5; };
}
const CHORDS: Record<string, number[][]> = {
  A: [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]],
  B: [[293.66, 349.23, 440], [246.94, 293.66, 392], [329.63, 392, 493.88], [349.23, 440, 523.25]],
};
/** One bar: a chord for the section and bar, a noise kick on each beat (seeded by section, bar and beat). */
function bar(out: Float64Array, at: number, len: number, kind: string, index: number, gain = 1) {
  const pick = xorshift(977 + index * 7477);
  const chord = kind === 'T' ? [0, 1, 2].map(() => 130 * 2 ** (4 * (pick() + 0.5))) : CHORDS[kind]![index % 4]!;
  if (kind === 'T') gain *= 0.25 + 1.5 * (pick() + 0.5) / 2;
  for (let n = 0; n < len; n++) {
    let v = 0;
    for (const f of chord) v += 0.12 * Math.sin((TWO_PI * f * n) / FIXTURE_RATE);
    out[at + n] = v * gain;
  }
  kicks(out, at, len, kind, index, gain);
}
/** A noise kick on each beat of a bar (seeded by section, bar and beat). */
function kicks(out: Float64Array, at: number, len: number, kind: string, index: number, gain: number) {
  const beat = len / 4;
  for (let b = 0; b < 4; b++) {
    const rnd = xorshift(1 + kind.charCodeAt(0) * 7919 + index * 104729 + b * 31);
    const start = at + Math.floor(b * beat), hit = Math.floor(0.05 * FIXTURE_RATE);
    for (let n = 0; n < hit; n++) out[start + n] = out[start + n]! + rnd() * 0.5 * (1 - n / hit) * gain;
  }
}
function finish(name: string, mono: Float64Array, bpm: number, barFrames: number, bars: number, sections: { kind: string; bars: number }[]): FixtureSong {
  const frames = mono.length, pcm = new Int16Array(2 * frames);
  for (let n = 0; n < frames; n++) { const v = Math.max(-32767, Math.min(32767, Math.round(mono[n]! * 32767))); pcm[2 * n] = v; pcm[2 * n + 1] = v; }
  const beatsPerBar = 4, spb = barFrames / beatsPerBar;
  const beats = Array.from({ length: bars * beatsPerBar }, (_, k) => T.normalize(T.rt(k * spb, FIXTURE_RATE)));
  return { name, pcm, frames, beats, downbeats: beats.filter((_, k) => k % beatsPerBar === 0), bpm, barFrames, sections };
}
export function abaSong(): FixtureSong {
  const BAR = 96_000, sections = [{ kind: 'A', bars: 8 }, { kind: 'B', bars: 8 }, { kind: 'A', bars: 8 }, { kind: 'E', bars: 4 }];
  const bars = 28, mono = new Float64Array(bars * BAR + FIXTURE_RATE / 2);
  let at = 0;
  for (const s of sections) for (let i = 0; i < s.bars; i++, at += BAR) {
    if (s.kind === 'E') { for (let n = 0; n < BAR; n++) { const k = i * BAR + n, g = 1 - (0.9 * k) / (4 * BAR); let v = 0; for (const f of CHORDS.A![0]!) v += 0.12 * Math.sin((TWO_PI * f * k) / FIXTURE_RATE); mono[at + n] = v * g; } kicks(mono, at, BAR, 'E', i, 1 - (0.9 * i) / 4); }
    else bar(mono, at, BAR, s.kind, i);
  }
  return finish('aba', mono, 120, BAR, bars, sections);
}
export function twoToneSong(): FixtureSong {
  const BAR = 96_000, bars = 20, mono = new Float64Array(bars * BAR);
  for (let n = 0; n < mono.length; n++) { const b = Math.floor(n / BAR); const f = b >= 8 && b < 16 ? 660 : 440; mono[n] = 0.3 * Math.sin((TWO_PI * f * (n % BAR)) / FIXTURE_RATE); }
  return finish('two-tone', mono, 120, BAR, bars, [{ kind: '440', bars: 8 }, { kind: '660', bars: 8 }, { kind: '440', bars: 4 }]);
}
export function throughSong(): FixtureSong {
  const BAR = 96_000, bars = 24, mono = new Float64Array(bars * BAR);
  for (let i = 0; i < bars; i++) bar(mono, i * BAR, BAR, 'T', i * 13 + 1);
  return finish('through', mono, 120, BAR, bars, [{ kind: 'through', bars }]);
}
/** The song as a 48 kHz stereo 16-bit WAV file. */
export const songWav = (s: FixtureSong): Buffer => writeWav(s.pcm);
