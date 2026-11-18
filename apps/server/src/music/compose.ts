/**
 * The composer of the built-in music (ADR-0022): the chords of every bar and the lead line, from a style, a layout and a seed.
 * Integers and mulberry32 only; 12 ticks a beat, 48 a bar.
 *
 * - Harmony: for every section the seed picks one of the style's four-bar progressions (calm ones for intro, build and break;
 *   in a peak the first four bars of every eight take one peak progression and the next four another). The bar before the
 *   ending holds the style's cadence chord, the ending the tonic.
 * - Lead: a theme in phrase form A A′ B A′ (two bars each), made once per track from the seed and laid over every peak from its
 *   start. Each bar takes one of the style's rhythm cells; the first note is the chord tone nearest the middle of the range,
 *   later notes move −2..+2 scale degrees (70 % by one step) inside a twelfth; notes on a strong beat or longer than a beat are
 *   moved to the nearest tone of the chord sounding under them; A′ ends on the tonic or the third. No melody is stored anywhere.
 */
import type { MusicLayout } from '@pulseframe/core';
import { mulberry32 } from './dsp.ts';
import type { Cell, Chord, StyleSpec } from './styles.ts';

export const TICKS_PER_BEAT = 12;
export const TICKS_PER_BAR = 48;

/** One chord: its scale degrees from the root up (absolute degree indices, 0 = the tonic in the chord register). */
export interface ChordInfo { deg: number; degs: number[]; from: number; to: number }
export interface LeadNote { bar: number; tick: number; dur: number; deg: number }
export interface Composition { chords: ChordInfo[][]; lead: LeadNote[]; leadByBar: LeadNote[][] }

/** The MIDI note of an absolute scale degree index of the style. */
export const pitchOf = (spec: StyleSpec, deg: number): number => spec.root + 12 * Math.floor(deg / 7) + spec.scale[deg - 7 * Math.floor(deg / 7)]!;
const mod7 = (d: number) => d - 7 * Math.floor(d / 7);

function chordOf(spec: StyleSpec, deg: number, from: number, to: number): ChordInfo {
  const degs = spec.sevenths ? [deg, deg + 2, deg + 4, deg + 6] : [deg, deg + 2, deg + 4];
  return { deg, degs, from, to };
}
function barChords(spec: StyleSpec, c: Chord): ChordInfo[] {
  if (typeof c === 'number') return [chordOf(spec, c, 0, TICKS_PER_BAR)];
  return [chordOf(spec, c[0], 0, 24), chordOf(spec, c[1], 24, TICKS_PER_BAR)];
}
/** The chord sounding at `tick` of a bar. */
export const chordAt = (bar: readonly ChordInfo[], tick: number): ChordInfo => bar.find((c) => tick >= c.from && tick < c.to) ?? bar[bar.length - 1]!;

/** A random integer in [0, n). */
const pick = (rnd: () => number, n: number) => Math.min(n - 1, Math.floor(rnd() * n));

/**
 * The degree index nearest `d` inside [lo, hi] whose degree is one of `wanted` (mod 7). Of two equally near, the one away from
 * `avoid` (the note before, so the line keeps moving), then the one in direction `dir`.
 */
function nearestOf(d: number, wanted: readonly number[], lo: number, hi: number, avoid: number | null = null, dir = -1): number {
  let best = d, cost = Infinity;
  for (let x = lo; x <= hi; x++) {
    if (!wanted.includes(mod7(x))) continue;
    const c = 4 * Math.abs(x - d) + (x === avoid ? 5 : 0) + ((x - d) * dir < 0 ? 1 : 0);
    if (c < cost) { cost = c; best = x; }
  }
  return best;
}

interface ThemeNote { pos: number; tick: number; dur: number; deg: number; strong: boolean }
/**
 * One two-bar phrase: degrees chosen against the chords it was written over (re-fitted to the real chords later). A walk:
 * 70 % of the moves are one scale step, the rest two steps or a repeat (never two repeats running); it keeps its direction
 * with probability 0.7 and turns at the edges of its twelfth.
 */
function phrase(rnd: () => number, cells: readonly [Cell, Cell], chords: readonly [readonly ChordInfo[], readonly ChordInfo[]], start: number | null, lo: number, hi: number): ThemeNote[] {
  const out: ThemeNote[] = [];
  let prev = start, dir = rnd() < 0.5 ? -1 : 1, repeated = false;
  for (let pos = 0; pos < 2; pos++) {
    for (const [tick, dur] of cells[pos]!) {
      const strong = tick % 24 === 0 || dur >= TICKS_PER_BEAT;
      const tones = chordAt(chords[pos]!, tick).degs.map(mod7);
      let deg: number;
      if (prev === null) deg = nearestOf(Math.floor((lo + hi) / 2), tones, lo, hi);
      else {
        if (rnd() < 0.3) dir = -dir;
        const r = rnd();
        let step = r < 0.7 ? dir : r < 0.85 ? 2 * dir : 0;
        if (step === 0 && repeated) step = dir;
        deg = prev + step;
        if (deg < lo) { deg = lo + (lo - deg); dir = 1; }
        if (deg > hi) { deg = hi - (deg - hi); dir = -1; }
        if (strong) deg = nearestOf(deg, tones, lo, hi, prev, dir);
        repeated = deg === prev;
      }
      out.push({ pos, tick, dur, deg, strong });
      prev = deg;
    }
  }
  return out;
}

/** Chords for every bar and the lead line for the bars of level 2 and 3. */
export function compose(spec: StyleSpec, layout: MusicLayout, seed: number): Composition {
  const rnd = mulberry32((Math.imul(seed + 1, 0x9e3779b1) ^ hashId(spec.id)) >>> 0);
  const N = layout.bars;
  const chords: ChordInfo[][] = new Array(N);
  for (const s of layout.sections) {
    const peak = s.kind === 'peak';
    const list = peak ? spec.progressions.peak : spec.progressions.calm;
    const first = list[pick(rnd, list.length)]!;
    const second = peak ? list[pick(rnd, list.length)]! : first;
    for (let i = 0; i < s.bars; i++) {
      const prog = i % 8 < 4 ? first : second;
      chords[s.startBar + i] = barChords(spec, prog[i % 4]!);
    }
  }
  chords[N - 2] = barChords(spec, spec.cadence);
  chords[N - 1] = barChords(spec, 0);

  // the theme: A and B, written over the first peak progression's bars
  const lo = spec.leadLow, hi = spec.leadLow + 11;
  const cellOf = () => spec.leadCells[pick(rnd, spec.leadCells.length)]!;
  const endOf = () => spec.leadEndCells[pick(rnd, spec.leadEndCells.length)]!;
  const probe = spec.progressions.peak[0]!;
  const A = phrase(rnd, [cellOf(), endOf()], [barChords(spec, probe[0]!), barChords(spec, probe[1]!)], null, lo, hi);
  const B = phrase(rnd, [cellOf(), endOf()], [barChords(spec, probe[2]!), barChords(spec, probe[3]!)], A[A.length - 1]!.deg, lo, hi);

  const lead: LeadNote[] = [];
  const leadByBar: LeadNote[][] = Array.from({ length: N }, () => []);
  let prevDeg: number | null = null;
  for (const s of layout.sections) {
    if (s.level < 2) continue;
    for (let i = 0; i < s.bars; i++) {
      const bar = s.startBar + i;
      if (bar >= N - 1) break;
      const p = i % 8, part = p < 4 || p >= 6 ? A : B, prime = p === 2 || p === 3 || p === 6 || p === 7;
      const notes = part.filter((n) => n.pos === p % 2);
      const last = notes.length ? notes[notes.length - 1]! : null;
      for (const n of notes) {
        const tones = chordAt(chords[bar]!, n.tick).degs.map(mod7);
        let deg: number = n.strong ? nearestOf(n.deg, tones, lo, hi, prevDeg) : n.deg;
        if (prime && p % 2 === 1 && n === last && bar !== N - 2) {
          // A′ comes home: the tonic or the third, a tone of the chord under it when one of the two is
          const home = [0, 2].filter((d) => tones.includes(d));
          deg = nearestOf(deg, home.length ? home : [0, 2], lo, hi);
        }
        prevDeg = deg;
        const note = { bar, tick: n.tick, dur: n.dur, deg };
        lead.push(note);
        leadByBar[bar]!.push(note);
      }
    }
  }
  return { chords, lead, leadByBar };
}

/** A small integer hash of a style id (FNV-1a), so the same seed gives different tunes in different styles. */
export function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
