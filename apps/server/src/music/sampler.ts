/**
 * The sampler voice of the built-in music (wave 7 instruments track «כלים מוקלטים»; .artifacts/wave7/instruments-decisions.md). Inside
 * the render path, so test M9 holds it to arithmetic only: + − × ÷, Math.floor/round/abs/min/max/imul, typed arrays, integer bit
 * operations; imports only core and the files beside it. It reads no file: the loader (apps/server/src/instruments/bank.ts) hands it a
 * ResolvedBank of decoded integer samples. LEAD: the types and signatures (final). BUILDER W1: the bodies.
 *
 * Contract (decisions §2 and plan §4.1 with C3, C9, C10, C13):
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
 */
import type { KitPartRole } from '@pulseframe/core';

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
  parts: Partial<Record<KitPartRole, { instrument: ResolvedInstrument; gainDb: number; vel: readonly [number, number]; attackMax?: number; releaseMax?: number }>>;
}
/** How many frames of a zone the render needs (the loader decodes no more). */
export interface ZoneNeed { instrument: string; zone: number; frames: number }
/** The first note of a part that no region can play within the ratio limit (the request is refused with instruments_range). */
export interface OutOfRange { part: KitPartRole; instrument: string; midi: number }
/** A note as the sampler sees it (the arranger's Note without its synth voice). */
export interface SampledNote { part: KitPartRole; midi: number; vel: number; gate: number }

/** Thrown by every body below until builder W1 builds it. */
export class SamplerNotBuilt extends Error {
  constructor() { super('the sampler voice is not built in this build yet'); this.name = 'SamplerNotBuilt'; }
}
/** The regions that sound for one note (layering), in region order; an empty list when none matches. */
export function selectRegions(_inst: ResolvedInstrument, _midi: number, _vel: number): Region[] { throw new SamplerNotBuilt(); }
/**
 * Before any sample is read: for every note of every sampled part, the regions and how many source frames each zone needs (gate +
 * release, through its ratio, plus the kernel's taps), and the first note out of range (r > INSTRUMENTS_LIMITS.maxRatio or no region).
 * Pure over the notes and the parsed (not decoded) instruments.
 */
export function planZones(_notes: readonly SampledNote[], _bank: Pick<ResolvedBank, 'parts'>): { needs: ZoneNeed[]; outOfRange: OutOfRange | null } { throw new SamplerNotBuilt(); }
/**
 * Render one sampled note into outL/outR (from index 0), returning the frames written. Never reads a zone out of its bounds.
 * Deterministic: integers for positions, float64 arithmetic only through dsp.ts tables.
 */
export function renderSampled(_part: NonNullable<ResolvedBank['parts'][KitPartRole]>, _midi: number, _vel: number, _gate: number, _outL: Float64Array, _outR: Float64Array): number { throw new SamplerNotBuilt(); }
