/**
 * Level envelopes of multicam sources (ADR-0020): a rebuildable derivative keyed by content hash, never stored in the document
 * (plan D9). LEAD: the type and signatures; W2: the bodies (encode/decode are byte-exact, two builds byte-identical).
 */
import type * as T from '@pulseframe/time';

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
const todo = (): never => { throw new Error('not built yet (ADR-0020 W2)'); };
export function encodeEnvelope(e: LevelEnvelope): Uint8Array { void e; return todo(); }
export function decodeEnvelope(assetId: string, bytes: Uint8Array): LevelEnvelope { void assetId; void bytes; return todo(); }
/** dBFS of a channel (null = mix) at a SOURCE time: frame nearest(source*100); -120 outside. */
export function levelAt(e: LevelEnvelope, channel: number | null, source: T.RationalTime): number { void e; void channel; void source; return todo(); }
/**
 * Dual-mono recorders (wave4-decisions.md: detected and SUGGESTED, never applied): true when a two-channel envelope's channels
 * are independent talkers (host on L, guest on R). The editor then offers one click to centre (set_track_audio pan 0 /
 * utility width 0); nothing changes until the person clicks.
 */
export function isDualMono(e: LevelEnvelope): boolean { void e; return todo(); }
