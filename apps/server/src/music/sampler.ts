/**
 * The sampler voice of the built-in music (wave 7 instruments track «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md). Inside
 * the render path, so test M9 holds it to arithmetic only: + − × ÷, Math.floor/round/abs/min/max/imul, typed arrays, integer bit
 * operations; imports only core and the files beside it. It reads no file: the loader (apps/server/src/instruments/bank.ts) hands it a
 * ResolvedBank of decoded integer samples. LEAD: the types and signatures (final). BUILDER W1: the bodies.
 *
 * Contract (decisions §2 and plan §4.1 with C3, C9, C10, C13):
 * - Edge notes (kit part `edge`): a note no region matches by key borrows the regions of the nearest matching key within `edge`
 *   semitones (noteRegions), pitched from its own key; absent or 0 is selection as below, byte for byte.
 * - Region selection: key and velocity ranges, locc/hicc at the part's fixed CC values, sw_* by sw_default, trigger attack|first;
 *   round-robin is cut in v1 (seq_position 1 only; lorand/hirand: the region covering 0); every matching region sounds (layering);
 *   xfin/xfout give a constant linear gain at the fixed CC value.
 * - Pitch: r = (srcRate/48000) · 2^(((midi − keycenter)·keytrack/100 + transpose)/12) · 2^((tune)/1200), from dsp.ts tables only.
 *   Exact phase: stepQ = round(r · 2^24) (an integer); output sample i reads position i·stepQ (exact below 2^53); nothing accumulates.
 * - Interpolation: 8-tap Blackman-windowed sinc, 4,096 phases (nearest, never interpolated), every row normalised to DC gain 1; table 0
 *   for r ≤ 1 is full band (its phase-0 row is the unit impulse); tables for r ≤ 1.26, ≤ 1.59, ≤ 2 have reduced cutoffs. r > 2 is out
 *   of range: planZones reports it and the WHOLE request is refused (instruments_range); a part never mixes sampled and synth notes.
 * - Envelope: a linear attack of at least INSTRUMENTS_LIMITS.minAttackFrames from 0; SFZ ampeg_* (decay/release exponential to −60 dB
 *   via decay60); caps attackMax/releaseMax; a note ends at min(gate, zone end) + release, the last endFadeFrames fade to 0.
 * - Loops: loop_continuous; loop_sustain while the gate is open; integer loop points; taps outside the zone read 0, inside a loop wrap.
 * - Gain: SFZ volume, amp_veltrack ((vel/127)^2 default curve, or amp_velcurve_N points), pan as balance, then the kit's gainDb.
 *
 * Builder W1's reading of the open details (each one a choice, written here so the loader and the tests agree):
 * - Units: Region.sustain is SFZ's percent (0..100); ampVeltrack is SFZ's percent (−100..100); pan −100..100; loop ends (SFZ loop_end,
 *   WAV smpl, ZoneData.loop.end) are INCLUSIVE frame indexes; Region.end is inclusive (SFZ `end`), null = the zone's last frame.
 * - Velocities: SampledNote.vel and renderSampled's `vel` are the arranger's 0..1; the part's `vel` range maps it to MIDI
 *   (midiVelocity). selectRegions takes the MIDI velocity 1..127 that regions' lovel/hivel name.
 * - amp_velcurve_N, when present, IS the velocity gain (amp_veltrack is then not applied); its points are joined linearly, with (0, 0)
 *   and (127, 1) implied unless given.
 * - Frames: planZones reads ZoneData.frames as the file's whole length (the loader has decoded nothing yet; `samples` may be empty) and
 *   asks for need = the frames any note reads (never past the zone's end). renderSampled reads ZoneData.frames as the frames decoded.
 *   The output is the same for every decode of at least `need` frames (taps at or past `frames` read 0), so the bytes depend on the
 *   kit's files only, never on how much was decoded. A loop is valid when 0 ≤ start < end (and end ≤ Region.end): it is not compared
 *   with `frames`, for the same reason.
 * - Positions: P(i) = offset·2^24 + i·stepQ; the tap phase is the nearest 1/4096 sample, Q = floor((P + 2048) / 4096), index ⌊Q/4096⌋,
 *   phase Q mod 4096. Every one is an integer below 2^53 (i < 2^19, stepQ ≤ 2^25, offset < 2^28).
 * - Loops read a periodic source: tap t ≥ loopEnd+1 reads loopStart + (t − loopStart) mod len. loop_sustain: after the gate the
 *   position continues forward from where it is in the loop (the whole number of laps at the gate is taken off), into the tail.
 * - one_shot ignores the gate: the note lasts until the zone ends, then its release.
 */
import { INSTRUMENTS_LIMITS, type KitPartRole } from '@pulseframe/core';
import { dbGain, decay60, flush, pow2Cents, sinTurns, SR } from './dsp.ts';

/** One sample zone as decoded by the loader: integer samples at a 24-bit scale, interleaved when stereo. */
export interface ZoneData {
  /** relative path inside its ledger item (for messages only; never an absolute path) */ path: string;
  rate: number; channels: 1 | 2;
  /** frames available (the loader may decode only the frames planZones asked for) */ frames: number;
  samples: Int32Array;
  loop: { start: number; end: number } | null;
}
/** One SFZ region after inheritance and normalisation (keys as MIDI numbers, times in seconds, gains in dB). */
export interface Region {
  zone: number; lokey: number; hikey: number; lovel: number; hivel: number; keycenter: number; keytrack: number; transpose: number; tune: number;
  volume: number; pan: number; offset: number; end: number | null; ampVeltrack: number; velcurve: readonly (readonly [number, number])[] | null;
  loopMode: 'no_loop' | 'one_shot' | 'loop_continuous' | 'loop_sustain'; loopStart: number | null; loopEnd: number | null;
  attack: number; hold: number; decay: number; sustain: number; release: number;
  trigger: 'attack' | 'first'; locc: Readonly<Record<number, number>>; hicc: Readonly<Record<number, number>>;
  xfin: { cc: number; lo: number; hi: number } | null; xfout: { cc: number; lo: number; hi: number } | null;
  sw: { lokey: number; hikey: number; last: number | null; default: number | null } | null;
  seqPosition: number; lorand: number; hirand: number;
}
/** An instrument of a kit, parsed and resolved: its regions and the zones they name (indexes into zones). */
export interface ResolvedInstrument { id: string; regions: readonly Region[]; zones: readonly ZoneData[]; cc: Readonly<Record<number, number>> }
/** What renderMusic gets for a recorded request: which pitched parts are sampled, with which instrument and settings. */
export interface ResolvedBank {
  kitId: string; version: number; bank: string;
  /** `edge` (core KitPart.edge, 0..12, absent = 0): how far a note no region matches by key may borrow the nearest matching key (noteRegions). */
  parts: Partial<Record<KitPartRole, { instrument: ResolvedInstrument; gainDb: number; vel: readonly [number, number]; attackMax?: number; releaseMax?: number; edge?: number }>>;
}
/** How many frames of a zone the render needs (the loader decodes no more). */
export interface ZoneNeed { instrument: string; zone: number; frames: number }
/** The first note of a part that no region can play within the ratio limit (the request is refused with instruments_range). */
export interface OutOfRange { part: KitPartRole; instrument: string; midi: number }
/** A note as the sampler sees it (the arranger's Note without its synth voice). */
export interface SampledNote { part: KitPartRole; midi: number; vel: number; gate: number }

/** Kept for callers that still name it; the sampler is built, so nothing throws it any more. */
export class SamplerNotBuilt extends Error {
  constructor() { super('the sampler voice is not built in this build yet'); this.name = 'SamplerNotBuilt'; }
}
/** renderMusic refuses a recorded render with a note out of range BEFORE any sample is made (the server answers instruments_range). */
export class SamplerRangeError extends Error {
  constructor(public readonly outOfRange: OutOfRange) {
    super(`the instrument ${outOfRange.instrument} has no region for MIDI note ${outOfRange.midi} of the part ${outOfRange.part} within a playback ratio of ${INSTRUMENTS_LIMITS.maxRatio}`);
    this.name = 'SamplerRangeError';
  }
}
/**
 * renderMusic refuses a bank that does not cover the style's kit exactly (all-or-nothing: every part of the kit recorded, never a
 * synthesised stand-in), or whose zones hold fewer frames than planZones asked for. A loader fault, never a library state: a 500.
 */
export class SamplerBankError extends Error {
  constructor(public readonly reason: 'kit' | 'parts' | 'zone_short', detail: string) { super(`the recorded bank cannot be rendered (${reason}): ${detail}`); this.name = 'SamplerBankError'; }
}

// ---------- the kernel: 4 tables × 4,096 phases × 8 taps, built once by arithmetic (1 MB) ----------
export const KERNEL_TAPS = 8;
export const KERNEL_PHASES = 4096;
/** The highest ratio each table serves (table 0: r ≤ 1, full band). */
export const KERNEL_LIMITS = [1, 1.26, 1.59, 2] as const;
/** Cutoffs in cycles per source sample: full band for table 0, then 0.9 of the output's Nyquist at the table's highest ratio. */
const KERNEL_CUTOFFS = [0.5, 0.45 / 1.26, 0.45 / 1.59, 0.45 / 2] as const;
const PI = 3.141592653589793;
/** KERNEL[(table·4096 + phase)·8 + k] weighs source frame index − 3 + k at fractional position phase/4096. */
export const KERNEL = new Float64Array(KERNEL_LIMITS.length * KERNEL_PHASES * KERNEL_TAPS);
{
  for (let t = 0; t < KERNEL_LIMITS.length; t++) {
    const fc = KERNEL_CUTOFFS[t]!;
    for (let j = 0; j < KERNEL_PHASES; j++) {
      const row = (t * KERNEL_PHASES + j) * KERNEL_TAPS;
      let sum = 0;
      for (let k = 0; k < KERNEL_TAPS; k++) {
        const x = k - 3 - j / KERNEL_PHASES;
        const h = x === 0 ? 2 * fc : sinTurns(fc * x) / (PI * x);
        // Blackman over [−4, 4]: 0.42 + 0.5·cos(πx/4) + 0.08·cos(πx/2)
        const w = 0.42 + 0.5 * sinTurns(x / 8 + 0.25) + 0.08 * sinTurns(x / 4 + 0.25);
        KERNEL[row + k] = h * w;
        sum += h * w;
      }
      for (let k = 0; k < KERNEL_TAPS; k++) KERNEL[row + k] = KERNEL[row + k]! / sum;
    }
  }
  // table 0, phase 0: exactly the unit impulse (at r = 1 the output is the source, sample for sample: check I1)
  for (let k = 0; k < KERNEL_TAPS; k++) KERNEL[k] = k === 3 ? 1 : 0;
}
/** The table for a ratio, or −1 above INSTRUMENTS_LIMITS.maxRatio. */
export function kernelTable(r: number): number {
  if (!(r > 0) || r > INSTRUMENTS_LIMITS.maxRatio) return -1;
  for (let t = 0; t < KERNEL_LIMITS.length; t++) if (r <= KERNEL_LIMITS[t]!) return t;
  return -1;
}

/** The longest a sampled note may sound (equal to render.ts MAX_NOTE: 8 s). */
export const SAMPLER_MAX_NOTE = 8 * SR;
const Q24 = 16777216;
const INV_24BIT = 1 / 8388608;

/** The arranger's velocity 0..1 as the MIDI velocity of a part (lo + (hi − lo)·vel, rounded, 1..127). */
export function midiVelocity(part: { vel: readonly [number, number] }, vel: number): number {
  const v = Math.round(part.vel[0] + (part.vel[1] - part.vel[0]) * vel);
  return v < 1 ? 1 : v > 127 ? 127 : v;
}
const ccValue = (cc: Readonly<Record<number, number>>, n: number): number => (Object.hasOwn(cc, n) ? cc[n]! : 0);
/** The constant gain of a region's xfin/xfout at the instrument's fixed CC values (linear). */
export function crossfadeGain(region: Region, cc: Readonly<Record<number, number>>): number {
  let g = 1;
  if (region.xfin) {
    const { lo, hi } = region.xfin, v = ccValue(cc, region.xfin.cc);
    g *= v >= hi ? 1 : v <= lo ? 0 : (v - lo) / (hi - lo);
  }
  if (region.xfout) {
    const { lo, hi } = region.xfout, v = ccValue(cc, region.xfout.cc);
    g *= v <= lo ? 1 : v >= hi ? 0 : 1 - (v - lo) / (hi - lo);
  }
  return g;
}
/** The velocity gain of a region: amp_velcurve_N points when given, else amp_veltrack over the curve (vel/127)². */
export function velocityGain(region: Pick<Region, 'ampVeltrack' | 'velcurve'>, vel: number): number {
  if (region.velcurve && region.velcurve.length) {
    const pts: [number, number][] = region.velcurve.map(([v, g]) => [v, g]);
    if (!pts.some(([v]) => v === 0)) pts.push([0, 0]);
    if (!pts.some(([v]) => v === 127)) pts.push([127, 1]);
    pts.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < pts.length; i++) {
      const [v0, g0] = pts[i - 1]!, [v1, g1] = pts[i]!;
      if (vel <= v1) return v1 === v0 ? g1 : g0 + ((g1 - g0) * (vel - v0)) / (v1 - v0);
    }
    return pts[pts.length - 1]![1];
  }
  const vt = Math.max(-100, Math.min(100, region.ampVeltrack)) / 100;
  const v = vt >= 0 ? vel : 128 - vel;
  const curve = (v * v) / (127 * 127);
  return 1 + Math.abs(vt) * (curve - 1);
}
/** The playback ratio of a region for a key: source frames per output frame. */
export function regionRatio(region: Pick<Region, 'keycenter' | 'keytrack' | 'transpose' | 'tune'>, zone: Pick<ZoneData, 'rate'>, midi: number): number {
  const cents = (midi - region.keycenter) * region.keytrack + region.transpose * 100 + region.tune;
  return (zone.rate / SR) * pow2Cents(cents);
}

/**
 * Whether a region can sound for a key at a MIDI velocity (`vel` null: any velocity). Every rule of selectRegions: key and velocity
 * ranges, trigger attack|first, locc/hicc at the fixed CC values, sw_* (a keyswitch key is not a note; sw_default holds), seq_position 1,
 * the random range covering 0, a crossfade gain above 0.
 */
function regionSounds(inst: ResolvedInstrument, r: Region, midi: number, vel: number | null): boolean {
  if (midi < r.lokey || midi > r.hikey) return false;
  if (vel !== null && (vel < r.lovel || vel > r.hivel)) return false;
  if (r.trigger !== 'attack' && r.trigger !== 'first') return false;
  for (const k of new Set([...Object.keys(r.locc), ...Object.keys(r.hicc)])) {
    const n = Number(k), v = ccValue(inst.cc, n);
    const lo = Object.hasOwn(r.locc, n) ? r.locc[n]! : 0, hi = Object.hasOwn(r.hicc, n) ? r.hicc[n]! : 127;
    if (v < lo || v > hi) return false;
  }
  if (r.sw) {
    if (midi >= r.sw.lokey && midi <= r.sw.hikey) return false; // a keyswitch key, not a note
    if (r.sw.last !== null && r.sw.last !== r.sw.default) return false; // no key is ever switched: sw_default holds
  }
  if (r.seqPosition !== 1) return false; // round-robin cut in v1: position 1 only
  if (!(r.lorand <= 0 && 0 < r.hirand)) return false; // the region covering 0 only
  if (crossfadeGain(r, inst.cc) === 0) return false;
  return true;
}
/** The regions that sound for one note (layering), in region order; an empty list when none matches. `vel` is the MIDI velocity. */
export function selectRegions(inst: ResolvedInstrument, midi: number, vel: number): Region[] {
  return inst.regions.filter((r) => regionSounds(inst, r, midi, vel));
}
/** A key some region names as a keyswitch (sw_lokey..sw_hikey): never a substitute key for an edge note. */
const isKeyswitch = (inst: ResolvedInstrument, k: number): boolean => inst.regions.some((r) => r.sw !== null && k >= r.sw.lokey && k <= r.sw.hikey);
/** Some region sounds at the key at any velocity (the key "matches"; velocity is matched afterwards, as for any note). */
const keyMatches = (inst: ResolvedInstrument, k: number): boolean => inst.regions.some((r) => regionSounds(inst, r, k, null));
/**
 * Edge notes (kit part `edge`, ADR-0029): the key whose regions play a note, and those regions. A note that some region matches by key
 * (every rule of selectRegions but velocity) is played by selectRegions at its own key, as without `edge`. Otherwise the nearest key
 * at most `edge` semitones away that matches, lower first on a tie, never a keyswitch key, lends its regions: selectRegions at that
 * key and the note's velocity. The playback ratio is always worked out from the note's own key (planRegion), so the note sounds at its
 * own pitch, and INSTRUMENTS_LIMITS.maxRatio still applies. Beyond `edge` (or `edge` absent or 0): the note's own key, no region, out
 * of range as before. planZones and renderSampled both call this, so what is decoded is what is played.
 */
export function noteRegions(inst: ResolvedInstrument, midi: number, vel: number, edge: number = 0): { key: number; regions: Region[] } {
  const own = selectRegions(inst, midi, vel);
  const reach = Number.isInteger(edge) ? Math.max(0, Math.min(12, edge)) : 0;
  if (reach === 0 || own.length > 0 || keyMatches(inst, midi)) return { key: midi, regions: own };
  for (let d = 1; d <= reach; d++) {
    for (const k of [midi - d, midi + d]) {
      if (k < 0 || k > 127 || isKeyswitch(inst, k) || !keyMatches(inst, k)) continue;
      return { key: k, regions: selectRegions(inst, k, vel) };
    }
  }
  return { key: midi, regions: own };
}

type Part = NonNullable<ResolvedBank['parts'][KitPartRole]>;
/** Everything one region needs to sound one note, worked out before any sample is read (shared by planZones and renderSampled). */
interface RegionPlan {
  zone: ZoneData; stepQ: number; table: number; p0: number;
  /** exclusive physical end: min(zone.frames, Region.end + 1) */ end: number;
  loop: { s: number; e: number; len: number } | null; mode: 'none' | 'one_shot' | 'continuous' | 'sustain';
  /** release starts here (frames from the note's start) */ gR: number; /** the note's frames */ n: number;
  att: number; hold: number; sus: number; dd: number; rd: number; fade: number; gainL: number; gainR: number;
  /** laps of the loop already played at gR (loop_sustain) */ kG: number;
  /** the output frame at which the source runs out when nothing loops (zoneEnd), or -1 when a loop plays */ srcEnd: number;
}
const ceilDiv = (a: number, b: number): number => {
  if (a <= 0) return 0;
  let q = Math.floor(a / b);
  while (q * b < a) q++;
  while (q > 0 && (q - 1) * b >= a) q--;
  return q;
};
const floorMod = (a: number, b: number): number => {
  let m = a - Math.floor(a / b) * b;
  if (m < 0) m += b;
  if (m >= b) m -= b;
  return m;
};
/** The source frame index at output frame i (the tap phase is the nearest 1/4096). */
const idxAt = (p: Pick<RegionPlan, 'p0' | 'stepQ'>, i: number): number => Math.floor(Math.floor((p.p0 + i * p.stepQ + 2048) / 4096) / 4096);

function planRegion(part: Part, inst: ResolvedInstrument, region: Region, midi: number, vel: number, gate: number): RegionPlan | null {
  const zone = inst.zones[region.zone];
  if (!zone) return null;
  const r = regionRatio(region, zone, midi);
  const table = kernelTable(r);
  if (table < 0) return null;
  const stepQ = Math.round(r * Q24);
  const offset = Math.max(0, Math.floor(region.offset));
  const end = Math.min(zone.frames, region.end === null ? Infinity : Math.floor(region.end) + 1);
  const p0 = offset * Q24;
  // loop
  let loop: RegionPlan['loop'] = null;
  let mode: RegionPlan['mode'] = region.loopMode === 'one_shot' ? 'one_shot' : 'none';
  if (region.loopMode === 'loop_continuous' || region.loopMode === 'loop_sustain') {
    const s = region.loopStart ?? zone.loop?.start ?? null, e = region.loopEnd ?? zone.loop?.end ?? null;
    if (s !== null && e !== null && Number.isInteger(s) && Number.isInteger(e) && s >= 0 && e > s && (region.end === null || e <= region.end)) {
      loop = { s, e: e + 1, len: e + 1 - s };
      mode = region.loopMode === 'loop_continuous' ? 'continuous' : 'sustain';
    }
  }
  // the frame at which the source runs out (no loop): the first i whose index reaches `end`
  const zoneEnd = ceilDiv(end * Q24 - 2048 - p0, stepQ);
  const gR = mode === 'one_shot' ? zoneEnd : mode === 'none' ? Math.min(gate, zoneEnd) : gate;
  const release = Math.max(0, part.releaseMax === undefined ? region.release : Math.min(region.release, part.releaseMax));
  const attack = Math.max(0, part.attackMax === undefined ? region.attack : Math.min(region.attack, part.attackMax));
  const fade = INSTRUMENTS_LIMITS.endFadeFrames;
  const relFrames = Math.max(fade, Math.round(release * SR));
  const n = gR + relFrames;
  const att = Math.max(INSTRUMENTS_LIMITS.minAttackFrames, Math.round(attack * SR));
  const hold = Math.max(0, Math.round(region.hold * SR));
  const sus = Math.max(0, Math.min(1, region.sustain / 100));
  const dd = region.decay > 0 ? decay60(region.decay) : 0;
  const rd = decay60(relFrames / SR);
  const pan = Math.max(-100, Math.min(100, region.pan)) / 100;
  const g = dbGain(region.volume + part.gainDb) * velocityGain(region, vel) * crossfadeGain(region, inst.cc) * INV_24BIT;
  const gainL = g * Math.min(1, 1 - pan), gainR = g * Math.min(1, 1 + pan);
  let kG = 0;
  if (mode === 'sustain' && loop) {
    const v = idxAt({ p0, stepQ }, gR);
    if (v >= loop.e) kG = Math.floor((v - loop.s) / loop.len);
    while (kG > 0 && v - kG * loop.len < loop.s) kG--;
    while (v - kG * loop.len >= loop.e) kG++;
  }
  return { zone, stepQ, table, p0, end, loop, mode, gR, n, att, hold, sus, dd, rd, fade, gainL, gainR, kG, srcEnd: mode === 'none' || mode === 'one_shot' ? zoneEnd : -1 };
}
/** Frames of its zone the plan reads within the first `frames` output frames (never past its end). */
function planNeed(p: RegionPlan, frames: number): number {
  const last = Math.min(p.n, frames) - 1;
  if (last < 0) return 0;
  const idxLast = idxAt(p, last);
  let need: number;
  if (!p.loop || p.mode === 'none' || p.mode === 'one_shot') need = idxLast + 5;
  else if (p.mode === 'continuous' || p.gR > last) need = Math.min(idxLast + 5, p.loop.e);
  else {
    const virt = p.gR > 0 ? Math.min(idxAt(p, p.gR - 1) + 5, p.loop.e) : 0;
    need = Math.max(virt, idxLast - p.kG * p.loop.len + 5);
  }
  return Math.max(0, Math.min(p.end, need));
}

/**
 * Before any sample is read: for every note of every sampled part, the regions and how many source frames each zone needs (gate +
 * release, through its ratio, plus the kernel's taps), and the first note out of range (r > INSTRUMENTS_LIMITS.maxRatio or no region).
 * Pure over the notes and the parsed (not decoded) instruments: ZoneData.frames is the file's whole length here; samples are not read.
 * Notes of a part the bank does not hold are not sampled and are skipped. `needs` is sorted by instrument, then zone.
 */
export function planZones(notes: readonly SampledNote[], bank: Pick<ResolvedBank, 'parts'>): { needs: ZoneNeed[]; outOfRange: OutOfRange | null } {
  const need = new Map<string, ZoneNeed>();
  let outOfRange: OutOfRange | null = null;
  for (const note of notes) {
    const part = bank.parts[note.part];
    if (!part) continue;
    const inst = part.instrument;
    const vel = midiVelocity(part, note.vel);
    const { regions } = noteRegions(inst, note.midi, vel, part.edge);
    let ok = regions.length > 0;
    for (const region of regions) {
      const p = planRegion(part, inst, region, note.midi, vel, note.gate);
      if (!p) { ok = false; continue; }
      const f = planNeed(p, SAMPLER_MAX_NOTE);
      if (f <= 0) continue;
      const key = `${inst.id}\n${region.zone}`;
      const prev = need.get(key);
      if (!prev) need.set(key, { instrument: inst.id, zone: region.zone, frames: f });
      else if (f > prev.frames) prev.frames = f;
    }
    if (!ok && !outOfRange) outOfRange = { part: note.part, instrument: inst.id, midi: note.midi };
  }
  const needs = [...need.values()].sort((a, b) => (a.instrument < b.instrument ? -1 : a.instrument > b.instrument ? 1 : a.zone - b.zone));
  return { needs, outOfRange };
}
/** The decoded size of a plan's needs (Int32, 4 bytes per sample per channel): the loader refuses above INSTRUMENTS_LIMITS.maxDecodedBytes. */
export function decodedBytesOf(needs: readonly ZoneNeed[], bank: Pick<ResolvedBank, 'parts'>): number {
  const insts = new Map<string, ResolvedInstrument>();
  for (const p of Object.values(bank.parts)) if (p) insts.set(p.instrument.id, p.instrument);
  let bytes = 0;
  for (const n of needs) bytes += n.frames * (insts.get(n.instrument)?.zones[n.zone]?.channels ?? 2) * 4;
  return bytes;
}

/** One region of a note as planRegion plays it (noteReport). Frames are output frames at 48 kHz from the note's start. */
export interface RegionReport {
  zone: number; ratio: number; mode: 'none' | 'one_shot' | 'continuous' | 'sustain';
  /** where the source runs out when nothing loops, or -1 when a loop plays */ srcEnd: number;
  /** the frame the release starts at, and the release's length */ releaseAt: number; release: number;
}
/**
 * kit:check and tests only (packages/evals/src/kit-check.ts, laptop check L4): how a note of a part would be played, read from the same
 * noteRegions and planRegion that planZones and renderSampled use. `key` is the key whose regions play it (another key: an edge
 * substitute); `regions` is empty, or `outOfRange` true, when the request would be refused (instruments_range). Reads no sample. Pure.
 */
export function noteReport(part: NonNullable<ResolvedBank['parts'][KitPartRole]>, midi: number, vel: number, gate: number): { key: number; outOfRange: boolean; regions: RegionReport[] } {
  const inst = part.instrument;
  const v = midiVelocity(part, vel);
  const { key, regions } = noteRegions(inst, midi, v, part.edge);
  const out: RegionReport[] = [];
  let ok = regions.length > 0;
  for (const region of regions) {
    const p = planRegion(part, inst, region, midi, v, gate);
    if (!p) { ok = false; continue; }
    out.push({ zone: region.zone, ratio: p.stepQ / Q24, mode: p.mode, srcEnd: p.srcEnd, releaseAt: p.gR, release: p.n - p.gR });
  }
  return { key, outOfRange: !ok, regions: out };
}

/** Add one region's note into outL/outR[0..w). */
function renderRegion(p: RegionPlan, outL: Float64Array, outR: Float64Array, w: number): void {
  const z = p.zone, S = z.samples, stereo = z.channels === 2;
  const D = Math.min(z.frames, p.end);
  const tb = p.table * KERNEL_PHASES * KERNEL_TAPS;
  const loop = p.loop, ls = loop ? loop.s : 0, le = loop ? loop.e : 0, len = loop ? loop.len : 1;
  const shift = p.kG * len;
  const { gR, att, hold, sus, dd, rd, n, fade, gainL, gainR, stepQ, p0 } = p;
  const fadeFrom = n - fade;
  let x = 1, e = 0, rel = 0;
  const tap = new Int32Array(KERNEL_TAPS);
  for (let i = 0; i < w; i++) {
    // the envelope at frame i
    if (i <= gR) {
      if (i < att) e = i / att;
      else if (i < att + hold) e = 1;
      else { e = sus + (1 - sus) * x; x = flush(x * dd); }
      if (i === gR) rel = e;
    } else { rel = flush(rel * rd); e = rel; }
    if (i >= fadeFrom) e *= (n - 1 - i) / fade;
    if (e === 0) continue;
    // the position: exact integers, nearest of 4,096 phases
    const Q = Math.floor((p0 + i * stepQ + 2048) / 4096);
    const idx = Math.floor(Q / 4096);
    const row = tb + (Q - idx * 4096) * KERNEL_TAPS;
    const lo = idx - 3;
    // the 8 source frames the taps read (−1: reads 0), through the loop when it plays
    // contiguous from `base` unless useTap (then tap[k] names each frame); a frame outside [0, D) reads 0
    let base = lo, useTap = false;
    if (loop && (p.mode === 'continuous' || (p.mode === 'sustain' && i < gR))) {
      if (lo + 7 >= le) {
        const b = lo >= le ? ls + floorMod(lo - ls, len) : -1;
        if (b >= 0 && b + 7 < le) base = b;
        else { useTap = true; for (let k = 0; k < KERNEL_TAPS; k++) { const t = lo + k; tap[k] = t < le ? t : ls + floorMod(t - ls, len); } }
      }
    } else if (loop && p.mode === 'sustain') {
      base = lo - shift;
      if (shift > 0 && base < ls) { useTap = true; for (let k = 0; k < KERNEL_TAPS; k++) { const t = base + k; tap[k] = t < ls ? t + len : t; } }
    }
    let aL = 0, aR = 0;
    if (!useTap && base >= 0 && base + 7 < D) {
      if (stereo) for (let k = 0, s = 2 * base; k < KERNEL_TAPS; k++, s += 2) { const h = KERNEL[row + k]!; aL += S[s]! * h; aR += S[s + 1]! * h; }
      else for (let k = 0; k < KERNEL_TAPS; k++) aL += S[base + k]! * KERNEL[row + k]!;
    } else {
      for (let k = 0; k < KERNEL_TAPS; k++) {
        const s = useTap ? tap[k]! : base + k;
        if (s < 0 || s >= D) continue;
        const h = KERNEL[row + k]!;
        if (stereo) { aL += S[2 * s]! * h; aR += S[2 * s + 1]! * h; } else aL += S[s]! * h;
      }
    }
    if (!stereo) aR = aL;
    outL[i] = outL[i]! + aL * gainL * e;
    outR[i] = outR[i]! + aR * gainR * e;
  }
}

/**
 * Render one sampled note into outL/outR (from index 0), returning the frames written. Never reads a zone out of its bounds.
 * Deterministic: integers for positions, float64 arithmetic only through dsp.ts tables. `vel` is the arranger's 0..1.
 * Writes min(note length, outL.length) frames (the note's own fade-out is placed by its full length, so a shorter buffer cuts it).
 */
export function renderSampled(part: NonNullable<ResolvedBank['parts'][KitPartRole]>, midi: number, vel: number, gate: number, outL: Float64Array, outR: Float64Array): number {
  const inst = part.instrument;
  const v = midiVelocity(part, vel);
  const plans: RegionPlan[] = [];
  for (const region of noteRegions(inst, midi, v, part.edge).regions) {
    const p = planRegion(part, inst, region, midi, v, gate);
    if (p) plans.push(p);
  }
  const cap = Math.min(outL.length, outR.length);
  let n = 0;
  for (const p of plans) n = Math.max(n, Math.min(p.n, cap));
  outL.fill(0, 0, n);
  outR.fill(0, 0, n);
  for (const p of plans) renderRegion(p, outL, outR, Math.min(p.n, cap));
  return n;
}
