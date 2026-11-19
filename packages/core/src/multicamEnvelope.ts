/**
 * Level envelopes of multicam sources (ADR-0020): a rebuildable derivative keyed by content hash, never stored in the document
 * (plan D9). The server builds them (apps/server/src/envelope.ts); this file holds the type, the byte format and the readers.
 *
 * Byte format (little-endian, version 1), byte-exact both ways, so two builds of one file give identical bytes:
 *   'PFEV' · u8 version (1) · u8 channels C · u16 rate (100) · u32 frames F ·
 *   C × F int16 (per-channel centi-dBFS) · F int16 (mix centi-dBFS) · F float32 (flux).
 */
import * as T from '@pulseframe/time';
import { ENVELOPE_MAX_CHANNELS, ENVELOPE_RATE } from './multicamLimits.ts';

export interface LevelEnvelope {
  assetId: string;
  rate: 100; // ENVELOPE_RATE
  frames: number;
  /** RMS of a 20 ms Hann window every 10 ms, centi-dBFS clamped to [-12000, 0], one per native channel (<= 8). */
  channels: Int16Array[];
  mix: Int16Array;
  /** Spectral-flux onset strength of the mixdown (>= 0), for sync only. */
  flux: Float32Array;
}
/** The floor of the envelope, in centi-dBFS (−120 dBFS): digital silence and everything outside the file. */
export const ENVELOPE_FLOOR_CDB = -12000;
const MAGIC = [0x50, 0x46, 0x45, 0x56]; // 'PFEV'
const VERSION = 1;
const HEADER = 12;

export function encodeEnvelope(e: LevelEnvelope): Uint8Array {
  const C = e.channels.length, F = e.frames;
  if (C > ENVELOPE_MAX_CHANNELS) throw new Error(`an envelope holds at most ${ENVELOPE_MAX_CHANNELS} channels`);
  if (e.mix.length !== F || e.flux.length !== F || e.channels.some((c) => c.length !== F)) throw new Error('envelope arrays must all have `frames` entries');
  const out = new Uint8Array(HEADER + (C + 1) * F * 2 + F * 4);
  const v = new DataView(out.buffer);
  MAGIC.forEach((b, i) => v.setUint8(i, b));
  v.setUint8(4, VERSION); v.setUint8(5, C); v.setUint16(6, ENVELOPE_RATE, true); v.setUint32(8, F, true);
  let o = HEADER;
  for (const ch of [...e.channels, e.mix]) for (let i = 0; i < F; i++, o += 2) v.setInt16(o, ch[i]!, true);
  for (let i = 0; i < F; i++, o += 4) v.setFloat32(o, e.flux[i]!, true);
  return out;
}

export function decodeEnvelope(assetId: string, bytes: Uint8Array): LevelEnvelope {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < HEADER || MAGIC.some((b, i) => v.getUint8(i) !== b)) throw new Error('not a level envelope');
  if (v.getUint8(4) !== VERSION) throw new Error(`level envelope version ${v.getUint8(4)} is not supported`);
  const C = v.getUint8(5), rate = v.getUint16(6, true), F = v.getUint32(8, true);
  if (rate !== ENVELOPE_RATE || C > ENVELOPE_MAX_CHANNELS) throw new Error('level envelope header is not valid');
  if (bytes.byteLength !== HEADER + (C + 1) * F * 2 + F * 4) throw new Error('level envelope is truncated');
  let o = HEADER;
  const i16 = () => { const a = new Int16Array(F); for (let i = 0; i < F; i++, o += 2) a[i] = v.getInt16(o, true); return a; };
  const channels = Array.from({ length: C }, i16), mix = i16();
  const flux = new Float32Array(F);
  for (let i = 0; i < F; i++, o += 4) flux[i] = v.getFloat32(o, true);
  return { assetId, rate: 100, frames: F, channels, mix, flux };
}

/** Envelope frame nearest to a SOURCE time (ties round up), exactly: round(source · 100). */
export const envelopeFrameAt = (source: T.RationalTime): number => T.nearestFrameIndex(source, { num: ENVELOPE_RATE, den: 1 });
/** Centi-dBFS of a channel (null = mix) at envelope frame `f`; the floor outside the file or for a channel it does not have. */
export function levelAtFrame(e: LevelEnvelope, channel: number | null, f: number): number {
  const a = channel === null ? e.mix : e.channels[channel];
  if (!a || f < 0 || f >= e.frames) return ENVELOPE_FLOOR_CDB;
  return a[f]!;
}
/** dBFS of a channel (null = mix) at a SOURCE time: frame nearest(source*100); -120 outside. */
export function levelAt(e: LevelEnvelope, channel: number | null, source: T.RationalTime): number {
  return levelAtFrame(e, channel, envelopeFrameAt(source)) / 100;
}

/**
 * Dual-mono recorders (wave4-decisions.md: detected and SUGGESTED, never applied): true when a two-channel envelope's channels
 * are independent talkers (host on L, guest on R). The editor then offers one click to centre (set_track_audio pan 0 /
 * utility width 0); nothing changes until the person clicks.
 *
 * Rule (model-free): over the frames where either channel is at least 10 dB above its own quiet floor (10th percentile), the
 * left channel must lead the right by 6 dB or more in at least 15 % of them AND the right lead the left as often. A stereo or
 * a doubled-mono recording has both channels at nearly the same level and never passes.
 */
export function isDualMono(e: LevelEnvelope): boolean {
  if (e.channels.length !== 2 || e.frames < 100) return false;
  const [L, R] = e.channels as [Int16Array, Int16Array];
  const p10 = (a: Int16Array) => { const s = Int16Array.from(a).sort(); return s[Math.floor(s.length * 0.1)]!; };
  const fl = p10(L) + 1000, fr = p10(R) + 1000;
  let active = 0, left = 0, right = 0;
  for (let i = 0; i < e.frames; i++) {
    const l = L[i]!, r = R[i]!;
    if (l < fl && r < fr) continue;
    active++;
    if (l - r >= 600) left++;
    else if (r - l >= 600) right++;
  }
  return active >= 100 && left >= 0.15 * active && right >= 0.15 * active;
}
