/**
 * The arranger of the built-in music (ADR-0022): turns the form (core musicLayout), the chords and the lead (compose.ts) into
 * notes in samples, by level (plan §4.5):
 *   0 (intro, break): harmony with sparse hats; 1 (build): bass and a half-time kick join, and the last build bar carries a roll
 *   and a noise riser; 2 (peak): full drums and the lead; 3 (the last peak): an octave double and claps.
 *   The ending (the last bar): every pitched part plays the tonic chord with the kick and the crash on beat 1, and nothing
 *   starts after it.
 * Beat k starts at sample k·samplesPerBeat exactly; a tick inside a beat is floor(tick·samplesPerBeat/12) samples after it.
 */
import type { MusicLayout } from '@pulseframe/core';
import { mulberry32 } from './dsp.ts';
import { chordAt, hashId, pitchOf, TICKS_PER_BAR, TICKS_PER_BEAT, type ChordInfo, type Composition } from './compose.ts';
import type { Level, PartSpec, StyleSpec } from './styles.ts';
import type { Voice } from './voices.ts';

export interface Note { at: number; gate: number; voice: Voice; midi: number; vel: number; pan: number; send: number }

/** The sample at which `tick` (counted from the start of the track, 48 a bar) starts. */
export function tickSample(layout: Pick<MusicLayout, 'samplesPerBeat'>, absTick: number, swing = 0): number {
  const beat = Math.floor(absTick / TICKS_PER_BEAT);
  let sub = absTick - beat * TICKS_PER_BEAT;
  if (sub === 6) sub += swing;
  return beat * layout.samplesPerBeat + Math.floor((sub * layout.samplesPerBeat) / TICKS_PER_BEAT);
}

/** Close-position voicings that move as little as possible from the previous chord. */
class Voicer {
  private prev: number[] | null = null;
  constructor(private spec: StyleSpec) {}
  voice(c: ChordInfo): number[] {
    const pcs = c.degs.map((d) => pitchOf(this.spec, d));
    const center = this.spec.root + 2;
    let best: number[] = [], cost = Infinity;
    for (let inv = 0; inv < pcs.length; inv++) {
      const notes: number[] = [];
      let base = pcs[inv]!;
      while (base > center + 5) base -= 12;
      while (base < center - 6) base += 12;
      notes.push(base);
      for (let k = 1; k < pcs.length; k++) {
        let n = pcs[(inv + k) % pcs.length]!;
        while (n <= notes[k - 1]!) n += 12;
        while (n - 12 > notes[k - 1]!) n -= 12;
        notes.push(n);
      }
      const ref = this.prev ?? notes.map(() => center + 4);
      let d = 0;
      for (let k = 0; k < notes.length; k++) d += Math.abs(notes[k]! - (ref[k] ?? ref[ref.length - 1]!));
      if (d < cost) { cost = d; best = notes; }
    }
    this.prev = best;
    return best;
  }
}

/** The notes of a whole track. */
export function arrange(spec: StyleSpec, layout: MusicLayout, comp: Composition, seed: number): Note[] {
  const rnd = mulberry32((Math.imul(seed + 7, 0x85ebca6b) ^ hashId(spec.id + ':arrange')) >>> 0);
  const human = () => 1 + (rnd() - 0.5) * 0.12;
  const N = layout.bars, S = layout.samplesPerBeat;
  const out: Note[] = [];
  const at = (bar: number, tick: number) => tickSample(layout, bar * TICKS_PER_BAR + tick, spec.swing);
  const span = (bar: number, tick: number, dur: number) => Math.max(1, at(bar, tick + dur) - at(bar, tick));
  const voicer = new Voicer(spec);
  const voicings: number[][][] = comp.chords.map((bar) => bar.map((c) => voicer.voice(c)));
  const push = (p: { voice: Voice; pan: number; send: number }, atS: number, gate: number, midi: number, vel: number) => out.push({ at: atS, gate, voice: p.voice, midi, vel: Math.min(1, vel), pan: p.pan, send: p.send });
  const levelOf: Level[] = new Array(N);
  const sectionOf: number[] = new Array(N);
  layout.sections.forEach((s, si) => { for (let i = 0; i < s.bars; i++) { levelOf[s.startBar + i] = s.level; sectionOf[s.startBar + i] = si; } });

  for (let bar = 0; bar < N - 1; bar++) {
    const level = levelOf[bar]!;
    const s = layout.sections[sectionOf[bar]!]!;
    const chords = comp.chords[bar]!;
    for (const part of spec.parts) {
      const cell = part.cells[level];
      if (!cell) continue;
      playPart(part, cell, bar, chords, voicings[bar]!);
    }
    for (const d of spec.drums) {
      const ticks = d.patterns[level];
      if (!ticks) continue;
      for (const t of ticks) push(d, at(bar, t), S, 60, d.vel * (t === 0 ? 1 : t % 12 === 0 ? 0.92 : 0.78) * human());
    }
    if (spec.crash && s.kind === 'peak' && bar === s.startBar) push({ voice: spec.crash, pan: 0, send: 0.2 }, at(bar, 0), S, 60, 1);
    // the last bar of a build: a riser over the bar and a roll in sixteenths over its second half
    if (s.kind === 'build' && bar === s.startBar + s.bars - 1) {
      push({ voice: spec.riser, pan: 0, send: 0.3 }, at(bar, 0), at(bar + 1, 0) - at(bar, 0), 60, 1);
      for (let t = 24; t < TICKS_PER_BAR; t += 3) push({ voice: spec.roll, pan: 0, send: 0.2 }, at(bar, t), span(bar, t, 3), 60, spec.rollVel * (0.3 + (0.7 * (t - 24)) / 21));
    }
  }

  // the ending: the tonic chord on beat 1 of the last bar, with the kick and the crash; nothing starts after it
  const E = N - 1, endAt = at(E, 0), endGate = layout.totalFrames - endAt;
  const tonic = voicings[E]![0]!;
  const lastLead = comp.lead.length ? comp.lead[comp.lead.length - 1]!.deg : spec.leadLow + 7;
  const leadHome = nearestTonic(lastLead);
  for (const part of spec.parts) {
    const voice = endingVoice(part.voice);
    const p = { voice, pan: part.pan, send: part.send };
    if (part.role === 'bass') push(p, endAt, endGate, spec.root + part.octave, part.vel * 0.95);
    else if (part.role === 'lead' || part.role === 'double') push(p, endAt, endGate, pitchOf(spec, leadHome) + part.octave, part.vel * 0.9);
    else for (const m of tonic) push(p, endAt, endGate, m + part.octave, part.vel * 0.9);
  }
  const kickDrum = spec.drums.find((d) => d.voice.kind === 'kick');
  if (kickDrum) push(kickDrum, endAt, S, 60, kickDrum.vel);
  if (spec.crash) push({ voice: spec.crash, pan: 0, send: 0.2 }, endAt, S, 60, 1);
  return out;

  function nearestTonic(deg: number): number {
    let best = -7 * Math.floor(-spec.leadLow / 7); // the lowest tonic in range
    for (let t = best; t <= spec.leadLow + 11; t += 7) if (Math.abs(t - deg) < Math.abs(best - deg)) best = t;
    return best;
  }

  function playPart(part: PartSpec, cell: readonly (readonly [number, number, number?])[], bar: number, chords: readonly ChordInfo[], voiced: readonly number[][]) {
    const vAt = (tick: number) => voiced[chords.indexOf(chordAt(chords, tick))]!;
    switch (part.role) {
      case 'pad':
        chords.forEach((c, i) => { for (const m of voiced[i]!) push(part, at(bar, c.from), span(bar, c.from, c.to - c.from), m + part.octave, part.vel * human()); });
        return;
      case 'stab':
        for (const [t, d] of cell) for (const m of vAt(t)) push(part, at(bar, t), span(bar, t, d), m + part.octave, part.vel * (t % 24 === 0 ? 1 : 0.85) * human());
        return;
      case 'arp': {
        const order = [0, 1, 2, 3, 2, 1];
        cell.forEach(([t, d], i) => {
          const v = vAt(t);
          const k = order[i % order.length]!;
          const m = k < v.length ? v[k]! : v[0]! + 12;
          push(part, at(bar, t), span(bar, t, d), m + part.octave, part.vel * (t % 12 === 0 ? 1 : 0.8) * human());
        });
        return;
      }
      case 'bass':
        for (const [t, d, which] of cell) {
          const c = chordAt(chords, t);
          const root = pitchOf(spec, c.deg);
          const tone = which === 1 ? pitchOf(spec, c.deg + 2) : which === 2 ? pitchOf(spec, c.deg + 4) : which === 3 ? root + 12 : root;
          // the bass register: within an octave from the style's root down
          let m = tone;
          while (m > spec.root + 4) m -= 12;
          while (m <= spec.root - 8) m += 12;
          push(part, at(bar, t), span(bar, t, d), m + part.octave, part.vel * (t === 0 ? 1 : 0.88) * human());
        }
        return;
      case 'lead': case 'double':
        for (const n of comp.leadByBar[bar]!) push(part, at(bar, n.tick), span(bar, n.tick, n.dur), pitchOf(spec, n.deg) + part.octave, part.vel * (n.tick % 24 === 0 ? 1 : 0.88) * human());
        return;
    }
  }
}

/** Every voice of the ending starts at once (a slow string attack would make the ending grow after its first beat). */
function endingVoice(v: Voice): Voice {
  if (v.kind === 'pad') return { ...v, attack: Math.min(v.attack, 0.012), t60: 3.5 };
  if (v.kind === 'fm') return { ...v, attack: Math.min(v.attack, 0.004) };
  return v;
}

/** The onset test's notes (M4): one click per beat, accented on bar starts, from the same scheduler. */
export function clicks(layout: MusicLayout): Note[] {
  const out: Note[] = [];
  for (let k = 0; k < 4 * layout.bars; k++) {
    const bar = k % 4 === 0;
    out.push({ at: tickSample(layout, k * TICKS_PER_BEAT), gate: 1, voice: { kind: 'click', level: bar ? 0.5 : 0.3, hz: bar ? 1500 : 1000 }, midi: 60, vel: 1, pan: 0, send: 0 });
  }
  return out;
}
