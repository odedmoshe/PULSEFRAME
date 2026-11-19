/** Contract of an audio effect kernel (ADR-0010): one pure TypeScript implementation per effect, shared by every route. */
import type { AudioFxParams, AudioFxStage } from '@pulseframe/core';
/** Influence below this fraction of the input peak counts as gone (warm-up and tail bounds). */
export const WARM_EPS = 2 ** -24;
export const AUDIO_FX_ENGINE = 'voice/1';
export interface PlannedFx { id: string; type: string; version: number; stage: AudioFxStage; params: Readonly<AudioFxParams>; /** fxSeed(id, params) for seeded effects, else 0 */ seed: number }
export interface FxContext {
  sampleRate: number;
  /** Timeline sample of clip-local 0. Noise, oscillator phase AND every frame/block grid are keyed on t = at + n:
   *  a frame of hop H starts where t % H === 0, so the parts of a split clip share one grid (ADR-0013). */
  at: number;
  length: number;
  seed: number;
  /** Clip speed num/den (1 = normal). Pitch follows speed: a source frequency f is heard at f·speed, and a source PSD
   *  P(f) per Hz is heard as P(f/speed)/speed. Kernels whose params name source frequencies or levels scale by it. */
  speed: number;
}
export interface FxReach {
  /** Input history needed before an output sample, NOT counting `ahead` (exact for finite memory). */
  warm: number;
  /** Output after the input falls silent (stages 4–6; 0 for window stages). */
  tail: number;
  /** Look-ahead (ADR-0010 D4, ADR-0013), stages 1–3 only. process(buf, frames, n0) receives the input of clip-local [n0, n0+frames)
   *  and writes, in place, the output of [n0−ahead, n0+frames−ahead), dry path included. That output may depend on input up to
   *  n0+frames−1. It MUST be 0 when the params are an identity (the processor is then DRY). Absent = 0. */
  ahead?: number;
}
export interface FxProcessor { /** in place, interleaved stereo, `frames` frames, first frame = clip-local n0; must not allocate */ process(buf: Float32Array, frames: number, n0: number): void }
export interface FxKernel {
  type: string; version: number; stage: AudioFxStage;
  /** `speed` (FxContext.speed) defaults to 1. */
  reach(p: Readonly<AudioFxParams>, sampleRate: number, speed?: number): FxReach;
  create(p: Readonly<AudioFxParams>, ctx: FxContext): FxProcessor;
}
