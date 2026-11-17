/**
 * The recipes of the six built-in music styles (ADR-0022). A StyleSpec holds a scale, chord progressions in scale degrees,
 * rhythm cells, instruments and a mix: NO melody. The lead line of every track is generated from its seed (compose.ts), so
 * there is no tune here to copy, and none was copied: the progressions are the common ones of popular music (I–V–vi–IV and
 * friends), the festive scale is the Phrygian-dominant mode (Ahava Rabbah / Freygish) used across Jewish and Middle-Eastern
 * folk music.
 *
 * Time inside a bar is in ticks: 12 a beat, 48 a bar (beats at 0, 12, 24, 36; off-beat eighths at 6, 18, 30, 42).
 * Names and moods are starting points: nobody has listened to any of these yet (core musicStyles.ts review 'unheard').
 */
import type { Voice } from './voices.ts';

/** A chord for a whole bar (a scale degree 0..6), or one for each half of the bar. */
export type Chord = number | readonly [number, number];
/** [tick, length in ticks, argument]: for a bass the chord tone (0 root, 1 third, 2 fifth, 3 the root an octave up). */
export type Hit = readonly [number, number, number?];
export type Cell = readonly Hit[];
export type Level = 0 | 1 | 2 | 3;
export interface PartSpec {
  role: 'pad' | 'stab' | 'arp' | 'bass' | 'lead' | 'double';
  voice: Voice;
  /** What it plays at each level 0..3; null = silent at that level. A pad holds each chord whatever the cell says. */
  cells: readonly [Cell | null, Cell | null, Cell | null, Cell | null];
  /** semitones added to every note (a double plays the lead this far away) */
  octave: number;
  vel: number; pan: number; send: number;
}
export interface DrumSpec { voice: Voice; patterns: readonly [readonly number[] | null, readonly number[] | null, readonly number[] | null, readonly number[] | null]; vel: number; pan: number; send: number }
export interface StyleSpec {
  id: string;
  /** MIDI note of the tonic in the chord register */ root: number;
  /** semitones of the seven scale degrees */ scale: readonly number[];
  /** four-bar progressions: `calm` for intro, build and break, `peak` for the peaks (the seed picks one of each) */
  progressions: { calm: readonly (readonly Chord[])[]; peak: readonly (readonly Chord[])[] };
  /** the chord of the bar before the ending (then the tonic) */ cadence: number;
  /** chords with their seventh */ sevenths: boolean;
  /** the lead's rhythm cells: inside a phrase, and at the end of a two-bar phrase */ leadCells: readonly Cell[]; leadEndCells: readonly Cell[];
  /** the lowest degree index of the lead (degree 7 = the tonic an octave above root); it moves inside a twelfth from there */ leadLow: number;
  parts: readonly PartSpec[];
  drums: readonly DrumSpec[];
  /** at the first bar of every peak and on the ending */ crash: Voice | null;
  /** the last bar of a build: a noise swell and a roll in sixteenths over its second half */ riser: Voice; roll: Voice; rollVel: number;
  /** ticks added to every off-beat eighth (0 = straight) */ swing: number;
  mix: { gain: number; wet: number; room: number; feedback: number; damp: number };
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
const FREYGISH = [0, 1, 4, 5, 7, 8, 10] as const;
const EIGHTHS = [0, 6, 12, 18, 24, 30, 36, 42] as const;
const OFFBEATS = [6, 18, 30, 42] as const;
const BACKBEAT = [12, 36] as const;
const FOUR = [0, 12, 24, 36] as const;
const SIXTEENTHS = Array.from({ length: 16 }, (_, i) => 3 * i);
const WHOLE: Cell = [[0, 48]];

// ---- instruments (arithmetic recipes, see voices.ts) ----
const kick = (level = 0.6): Voice => ({ kind: 'kick', level, f0: 150, f1: 52, pitchT60: 0.09, t60: 0.5 });
const snare = (level = 0.3): Voice => ({ kind: 'snare', level, tone: 190, noiseHz: 2000, t60: 0.2 });
const hat = (level = 0.09, t60 = 0.07): Voice => ({ kind: 'hat', level, hz: 7000, t60 });
const clap = (level = 0.3): Voice => ({ kind: 'clap', level, hz: 1300, t60: 0.2 });
const shaker = (level = 0.12): Voice => ({ kind: 'shaker', level, hz: 5200, t60: 0.09 });
const crash = (level = 0.08): Voice => ({ kind: 'crash', level, hz: 5500, t60: 1.6 });
const riser = (level = 0.08): Voice => ({ kind: 'riser', level, from: 300, to: 5000 });
const pluck = (level: number, bright = 0.5, t60 = 1.0): Voice => ({ kind: 'pluck', level, bright, t60, release: 0.08 });
const bell = (level: number): Voice => ({ kind: 'fm', level, ratio: 3.5, index: 0.3, indexT60: 0.45, t60: 1.5, attack: 0.002, release: 0.12 });
const epiano = (level: number, t60 = 2.4, index = 0.2): Voice => ({ kind: 'fm', level, ratio: 1, index, indexT60: 0.8, t60, attack: 0.003, release: 0.18 });
const piano = (level: number): Voice => ({ kind: 'fm', level, ratio: 2, index: 0.12, indexT60: 0.6, t60: 2.2, attack: 0.002, release: 0.25 });
const bass = (level: number, index = 0.16): Voice => ({ kind: 'fm', level, ratio: 1, index, indexT60: 0.25, t60: 2.4, attack: 0.004, release: 0.06 });
const pad = (level: number, cutoff = 1500, attack = 0.25, release = 0.6): Voice => ({ kind: 'pad', level, cutoff, attack, release, detune: 10, saws: 2, t60: 0 });
const strings = (level: number, attack = 0.45): Voice => ({ kind: 'pad', level, cutoff: 2200, attack, release: 1.2, detune: 12, saws: 3, t60: 0 });
const tom = (level = 0.6): Voice => ({ kind: 'kick', level, f0: 110, f1: 66, pitchT60: 0.3, t60: 1.1 });

const all = (c: Cell | null) => [c, c, c, c] as const;
const from = (level: Level, c: Cell, before: Cell | null = null) => [0, 1, 2, 3].map((l) => (l >= level ? c : before)) as unknown as PartSpec['cells'];
const hitsAt = (ticks: readonly number[], len: number, arg?: number): Cell => ticks.map((t) => (arg === undefined ? [t, len] : [t, len, arg]) as Hit);

export const STYLE_SPECS: Readonly<Record<string, StyleSpec>> = {
  // Festive: a hora-like "oom-pah" (bass on 1 and 3, plucked chords on 2 and 4) in D Phrygian-dominant, claps in the last peak.
  'music.festive': {
    id: 'music.festive', root: 62, scale: FREYGISH, cadence: 1, sevenths: false,
    progressions: { calm: [[0, 0, 3, 0], [0, 6, 0, 0], [3, 3, 0, 0]], peak: [[0, 3, 6, 0], [0, 0, 3, 0], [3, 6, 1, 0], [0, 1, 6, 0]] },
    leadCells: [[[0, 6], [6, 6], [12, 6], [18, 6], [24, 12], [36, 12]], [[0, 12], [12, 6], [18, 6], [24, 6], [30, 6], [36, 12]], [[0, 6], [6, 6], [12, 12], [24, 6], [30, 6], [36, 6], [42, 6]]],
    leadEndCells: [[[0, 12], [12, 12], [24, 24]], [[0, 6], [6, 6], [12, 12], [24, 24]]],
    leadLow: 4,
    parts: [
      { role: 'pad', voice: pad(0.1, 1300, 0.3), cells: all(WHOLE), octave: 0, vel: 1, pan: 0, send: 0.3 },
      { role: 'stab', voice: pluck(0.22, 0.45, 0.5), cells: [hitsAt([12, 36], 8), hitsAt([12, 36], 8), hitsAt([12, 36], 8), hitsAt([12, 30, 36, 42], 5)], octave: 0, vel: 1, pan: 0.25, send: 0.2 },
      { role: 'bass', voice: bass(0.27), cells: from(1, [[0, 10, 0], [24, 10, 2]]), octave: -24, vel: 1, pan: 0, send: 0.05 },
      { role: 'lead', voice: pluck(0.44, 0.6, 1.2), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.15, send: 0.25 },
      { role: 'double', voice: pluck(0.16, 0.5, 0.9), cells: from(3, WHOLE), octave: 12, vel: 1, pan: 0.2, send: 0.25 },
    ],
    drums: [
      { voice: kick(), patterns: [null, [0, 24], FOUR, FOUR], vel: 1, pan: 0, send: 0 },
      { voice: snare(0.22), patterns: [null, null, BACKBEAT, BACKBEAT], vel: 1, pan: 0, send: 0.1 },
      { voice: clap(), patterns: [null, null, null, BACKBEAT], vel: 1, pan: 0.05, send: 0.15 },
      { voice: hat(), patterns: [BACKBEAT, OFFBEATS, OFFBEATS, OFFBEATS], vel: 1, pan: -0.2, send: 0.05 },
      { voice: shaker(0.08), patterns: [null, null, SIXTEENTHS, SIXTEENTHS], vel: 1, pan: 0.3, send: 0.05 },
    ],
    crash: crash(), riser: riser(), roll: snare(0.22), rollVel: 1, swing: 0,
    mix: { gain: 1.0, wet: 0.5, room: 0.9, feedback: 0.8, damp: 0.35 },
  },
  // Cheerful birthday: C major, plucked eighths, a glockenspiel-like FM bell on the tune, claps in the last peak.
  'music.birthday': {
    id: 'music.birthday', root: 60, scale: MAJOR, cadence: 4, sevenths: false,
    progressions: { calm: [[0, 3, 4, 0], [0, 5, 3, 4], [3, 0, 4, 0]], peak: [[0, 3, 4, 0], [0, 5, 3, 0], [3, 4, 0, 5], [0, 4, 5, 3]] },
    leadCells: [[[0, 12], [12, 6], [18, 6], [24, 12], [36, 12]], [[0, 6], [6, 6], [12, 12], [24, 12], [36, 12]], [[0, 18], [18, 6], [24, 12], [36, 6], [42, 6]]],
    leadEndCells: [[[0, 12], [12, 12], [24, 24]], [[0, 24], [24, 24]]],
    leadLow: 4,
    parts: [
      { role: 'pad', voice: pad(0.09, 1400), cells: all(WHOLE), octave: 0, vel: 1, pan: 0, send: 0.3 },
      { role: 'arp', voice: pluck(0.17, 0.4, 0.6), cells: [hitsAt(FOUR, 10), hitsAt(EIGHTHS, 5), hitsAt(EIGHTHS, 5), hitsAt(EIGHTHS, 5)], octave: 0, vel: 1, pan: 0.3, send: 0.2 },
      { role: 'bass', voice: bass(0.27), cells: from(1, [[0, 10, 0], [24, 6, 0], [30, 6, 2], [36, 10, 0]]), octave: -24, vel: 1, pan: 0, send: 0.05 },
      { role: 'lead', voice: bell(0.3), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.1, send: 0.3 },
      { role: 'double', voice: pluck(0.2, 0.5, 0.9), cells: from(3, WHOLE), octave: -12, vel: 1, pan: 0.15, send: 0.2 },
    ],
    drums: [
      { voice: kick(), patterns: [null, [0, 24], [0, 24, 30], [0, 24, 30]], vel: 1, pan: 0, send: 0 },
      { voice: snare(0.24), patterns: [null, null, BACKBEAT, BACKBEAT], vel: 1, pan: 0, send: 0.1 },
      { voice: clap(), patterns: [null, null, null, BACKBEAT], vel: 1, pan: 0.05, send: 0.15 },
      { voice: hat(), patterns: [BACKBEAT, OFFBEATS, EIGHTHS, EIGHTHS], vel: 0.9, pan: -0.2, send: 0.05 },
    ],
    crash: crash(), riser: riser(), roll: snare(0.22), rollVel: 1, swing: 0,
    mix: { gain: 1.0, wet: 0.45, room: 0.85, feedback: 0.8, damp: 0.35 },
  },
  // Calm and warm: D major at 80, a soft pad, an electric-piano arpeggio, a light shaker and a kick on 1 and 3.
  'music.calm': {
    id: 'music.calm', root: 62, scale: MAJOR, cadence: 4, sevenths: false,
    progressions: { calm: [[0, 4, 5, 3], [3, 0, 4, 0], [0, 3, 5, 4]], peak: [[0, 4, 5, 3], [5, 3, 4, 0], [3, 4, 2, 5], [0, 5, 3, 0]] },
    leadCells: [[[0, 18], [18, 6], [24, 24]], [[0, 12], [12, 12], [24, 12], [36, 12]], [[0, 24], [24, 12], [36, 12]]],
    leadEndCells: [[[0, 48]], [[0, 24], [24, 24]]],
    leadLow: 4,
    parts: [
      { role: 'pad', voice: pad(0.08, 1200, 0.5, 1.0), cells: all(WHOLE), octave: 0, vel: 1, pan: 0, send: 0.35 },
      { role: 'arp', voice: epiano(0.16, 1.8), cells: [hitsAt([0, 12, 24, 36], 12), hitsAt(EIGHTHS, 6), hitsAt(EIGHTHS, 6), hitsAt(EIGHTHS, 6)], octave: 0, vel: 1, pan: 0.25, send: 0.3 },
      { role: 'bass', voice: bass(0.28, 0.1), cells: from(1, [[0, 22, 0], [24, 22, 2]]), octave: -24, vel: 1, pan: 0, send: 0.05 },
      { role: 'lead', voice: epiano(0.24, 2.8), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.15, send: 0.35 },
      { role: 'double', voice: pad(0.06, 1800, 0.08, 0.5), cells: from(3, WHOLE), octave: 0, vel: 1, pan: 0.15, send: 0.35 },
    ],
    drums: [
      { voice: kick(0.7), patterns: [null, [0], [0, 24], [0, 24]], vel: 1, pan: 0, send: 0 },
      { voice: snare(0.14), patterns: [null, null, BACKBEAT, BACKBEAT], vel: 1, pan: 0, send: 0.2 },
      { voice: shaker(0.09), patterns: [BACKBEAT, EIGHTHS, EIGHTHS, EIGHTHS], vel: 1, pan: 0.25, send: 0.1 },
      { voice: clap(0.16), patterns: [null, null, null, BACKBEAT], vel: 1, pan: -0.05, send: 0.25 },
    ],
    crash: crash(0.05), riser: riser(0.05), roll: snare(0.1), rollVel: 0.7, swing: 0,
    mix: { gain: 1.1, wet: 0.55, room: 1.0, feedback: 0.82, damp: 0.45 },
  },
  // Upbeat pop: E major at 128, four on the floor, pumping eighth-note bass, off-beat plucked chords.
  'music.pop': {
    id: 'music.pop', root: 64, scale: MAJOR, cadence: 4, sevenths: false,
    progressions: { calm: [[0, 4, 5, 3], [5, 3, 0, 4]], peak: [[0, 4, 5, 3], [5, 3, 4, 0], [0, 5, 3, 0], [3, 4, 5, 3]] },
    leadCells: [[[0, 6], [6, 6], [12, 6], [18, 12], [30, 6], [36, 12]], [[0, 12], [12, 6], [18, 6], [24, 6], [30, 6], [36, 12]], [[6, 6], [12, 6], [18, 6], [24, 12], [36, 12]]],
    leadEndCells: [[[0, 12], [12, 12], [24, 24]], [[0, 6], [6, 6], [12, 12], [24, 24]]],
    leadLow: 3,
    parts: [
      { role: 'pad', voice: pad(0.1, 2200, 0.15), cells: all(WHOLE), octave: 0, vel: 1, pan: 0, send: 0.25 },
      { role: 'stab', voice: pluck(0.16, 0.55, 0.4), cells: [hitsAt([6, 30], 5), hitsAt(OFFBEATS, 5), hitsAt(OFFBEATS, 5), hitsAt(OFFBEATS, 5)], octave: 0, vel: 1, pan: 0.3, send: 0.2 },
      { role: 'bass', voice: bass(0.24, 0.22), cells: from(1, hitsAt(EIGHTHS, 5, 0)), octave: -24, vel: 1, pan: 0, send: 0 },
      { role: 'lead', voice: pluck(0.42, 0.7, 1.0), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.15, send: 0.25 },
      { role: 'double', voice: bell(0.12), cells: from(3, WHOLE), octave: 12, vel: 1, pan: 0.2, send: 0.3 },
    ],
    drums: [
      { voice: kick(0.65), patterns: [null, [0, 24], FOUR, FOUR], vel: 1, pan: 0, send: 0 },
      { voice: clap(0.3), patterns: [null, null, BACKBEAT, BACKBEAT], vel: 1, pan: 0, send: 0.15 },
      { voice: snare(0.2), patterns: [null, null, null, BACKBEAT], vel: 1, pan: 0, send: 0.1 },
      { voice: hat(0.1), patterns: [[6, 30], OFFBEATS, OFFBEATS, OFFBEATS], vel: 1, pan: -0.2, send: 0.05 },
      { voice: shaker(0.07), patterns: [null, null, SIXTEENTHS, SIXTEENTHS], vel: 1, pan: 0.3, send: 0.05 },
    ],
    crash: crash(), riser: riser(), roll: snare(0.22), rollVel: 1, swing: 0,
    mix: { gain: 1.0, wet: 0.4, room: 0.8, feedback: 0.78, damp: 0.35 },
  },
  // Lo-fi: C major sevenths at 90 with a swing, electric-piano chords, a soft kick and snare, quiet swung hats.
  'music.lofi': {
    id: 'music.lofi', root: 60, scale: MAJOR, cadence: 4, sevenths: true,
    progressions: { calm: [[1, 4, 0, 5], [0, 5, 1, 4]], peak: [[1, 4, 0, 5], [3, 2, 1, 0], [0, 5, 3, 2], [1, 4, 0, 0]] },
    leadCells: [[[0, 18], [18, 6], [24, 12], [36, 12]], [[6, 12], [18, 6], [24, 24]], [[0, 12], [12, 6], [18, 18], [36, 12]]],
    leadEndCells: [[[0, 48]], [[0, 24], [24, 24]]],
    leadLow: 4,
    parts: [
      { role: 'pad', voice: pad(0.05, 900, 0.4, 0.8), cells: all(WHOLE), octave: -12, vel: 1, pan: 0, send: 0.3 },
      { role: 'stab', voice: epiano(0.12, 2.0, 0.3), cells: all([[0, 28], [30, 18]]), octave: 0, vel: 1, pan: 0.2, send: 0.3 },
      { role: 'bass', voice: bass(0.28, 0.08), cells: from(1, [[0, 16, 0], [18, 6, 0], [30, 16, 2]]), octave: -24, vel: 1, pan: 0, send: 0 },
      { role: 'lead', voice: epiano(0.2, 2.6, 0.28), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.15, send: 0.35 },
      { role: 'double', voice: pluck(0.12, 0.3, 0.8), cells: from(3, WHOLE), octave: 0, vel: 1, pan: 0.2, send: 0.3 },
    ],
    drums: [
      { voice: kick(0.65), patterns: [null, [0, 30], [0, 22, 30], [0, 22, 30]], vel: 1, pan: 0, send: 0 },
      { voice: snare(0.2), patterns: [null, null, BACKBEAT, BACKBEAT], vel: 1, pan: 0, send: 0.15 },
      { voice: hat(0.09, 0.05), patterns: [OFFBEATS, EIGHTHS, EIGHTHS, EIGHTHS], vel: 1, pan: -0.2, send: 0.05 },
      { voice: clap(0.14), patterns: [null, null, null, BACKBEAT], vel: 1, pan: 0.05, send: 0.25 },
    ],
    crash: null, riser: riser(0.05), roll: snare(0.12), rollVel: 0.6, swing: 2,
    mix: { gain: 1.1, wet: 0.45, room: 0.9, feedback: 0.8, damp: 0.5 },
  },
  // Cinematic: D major at 72, strings that hold the chords, a piano arpeggio, low drums that grow into the last peak.
  'music.cinematic': {
    id: 'music.cinematic', root: 62, scale: MAJOR, cadence: 4, sevenths: false,
    progressions: { calm: [[0, 5, 3, 4], [5, 3, 0, 4], [0, 3, 0, 4]], peak: [[0, 4, 5, 3], [5, 3, 4, 0], [3, 4, 5, 0], [0, 5, 3, 0]] },
    leadCells: [[[0, 24], [24, 12], [36, 12]], [[0, 12], [12, 12], [24, 24]], [[0, 36], [36, 12]]],
    leadEndCells: [[[0, 48]], [[0, 24], [24, 24]]],
    leadLow: 4,
    parts: [
      { role: 'pad', voice: strings(0.08), cells: all(WHOLE), octave: 0, vel: 1, pan: 0, send: 0.4 },
      { role: 'arp', voice: piano(0.15), cells: [hitsAt(FOUR, 12), hitsAt(EIGHTHS, 6), hitsAt(EIGHTHS, 6), hitsAt(EIGHTHS, 6)], octave: 0, vel: 1, pan: 0.25, send: 0.35 },
      { role: 'bass', voice: strings(0.05, 0.3), cells: from(1, [[0, 48, 0]]), octave: -24, vel: 1, pan: 0, send: 0.25 },
      { role: 'lead', voice: strings(0.13, 0.12), cells: from(2, WHOLE), octave: 0, vel: 1, pan: -0.1, send: 0.4 },
      { role: 'double', voice: piano(0.12), cells: from(3, WHOLE), octave: 12, vel: 1, pan: 0.15, send: 0.35 },
    ],
    drums: [
      { voice: tom(), patterns: [null, [0], [0, 24], [0, 24, 30, 36]], vel: 1, pan: 0, send: 0.2 },
      { voice: kick(0.45), patterns: [null, null, [0, 24], [0, 24]], vel: 1, pan: 0, send: 0 },
      { voice: snare(0.14), patterns: [null, null, null, BACKBEAT], vel: 1, pan: 0, send: 0.35 },
      { voice: shaker(0.06), patterns: [null, null, EIGHTHS, EIGHTHS], vel: 1, pan: 0.25, send: 0.15 },
    ],
    crash: crash(0.07), riser: riser(0.06), roll: tom(0.4), rollVel: 0.8, swing: 0,
    mix: { gain: 0.95, wet: 0.6, room: 1.1, feedback: 0.84, damp: 0.4 },
  },
};
export const styleSpec = (id: string): StyleSpec => {
  const s = STYLE_SPECS[id];
  if (!s) throw new RangeError(`there is no built-in music style "${id}"`);
  return s;
};
