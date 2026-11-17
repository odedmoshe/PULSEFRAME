/** The sound of one clip through its effects (ADR-0010 plan section 2): the one runtime every route uses. */
import type { PlannedAudioClip } from '../audio.ts';
/**
 * Playing-order source the voice reads, at the decoder rate. Forward: P[k] = native[origin + k]; reversed: P[k] = native[origin - 1 - k]
 * (native = the file's samples counted from its own time zero; silence outside the file). Output i reads P at phase0 + i·step.
 */
export interface VoiceInput { origin: number; /** first and last (exclusive) k needed, from the warm-up start to the end; first may be negative */ first: number; last: number; reverse: boolean }
export interface ClipVoice {
  /** First clip-local output frame produced (the `from` it was opened with). */
  readonly from: number;
  /** Clip-local frame after the last one produced: min(to, length + tail). */
  readonly end: number;
  readonly input: VoiceInput;
  /** Next playing-order frames, starting at P[input.first], interleaved stereo (mono given as L = R). Returns the output now final, interleaved stereo, continuing from the last output: gain, duck, balance and the tail cut are already applied. */
  push(pcm: Float32Array): Float32Array;
  /** The source ended (frames not given count as silence): the rest of the output up to `end`. */
  finish(): Float32Array;
}
/** `from`, `to`: clip-local output range; `from` may lie in the tail. Output for sample n does not depend on push sizes; it equals the full render bit-exactly when from <= voice.warmRing, else within 2^-17 of the clip's output peak. */
export function openClipVoice(clip: PlannedAudioClip, planRate: number, sourceRate: number, from: number, to: number): ClipVoice { void clip; void planRate; void sourceRate; void from; void to; throw new Error('openClipVoice: not implemented yet'); }
/** Copy the overlap of one decoded native piece (start = native index of its first frame, interleaved stereo) into a playing-order buffer that holds P[dstFirst ...]. */
export function fillPlayingOrder(dst: Float32Array, dstFirst: number, input: VoiceInput, piece: { start: number; data: Float32Array }): void { void dst; void dstFirst; void input; void piece; throw new Error('fillPlayingOrder: not implemented yet'); }
