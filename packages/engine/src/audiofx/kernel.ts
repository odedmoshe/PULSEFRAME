/** Contract of an audio effect kernel (ADR-0010): one pure TypeScript implementation per effect, shared by every route. */
import type { AudioFxParams, AudioFxStage } from '@pulseframe/core';
/** Influence below this fraction of the input peak counts as gone (warm-up and tail bounds). */
export const WARM_EPS = 2 ** -24;
export const AUDIO_FX_ENGINE = 'voice/1';
export interface PlannedFx { id: string; type: string; version: number; stage: AudioFxStage; params: Readonly<AudioFxParams>; /** fxSeed(id, params) for seeded effects, else 0 */ seed: number }
export interface FxContext { sampleRate: number; /** timeline sample of clip-local 0: oscillator phase and noise are keyed on at + n */ at: number; length: number; seed: number }
export interface FxReach { /** input history needed (exact for finite memory) */ warm: number; /** output after the input falls silent (stages 4–6; 0 for window stages) */ tail: number }
export interface FxProcessor { /** in place, interleaved stereo, `frames` frames, first frame = clip-local n0; must not allocate */ process(buf: Float32Array, frames: number, n0: number): void }
export interface FxKernel {
  type: string; version: number; stage: AudioFxStage;
  reach(p: Readonly<AudioFxParams>, sampleRate: number): FxReach;
  create(p: Readonly<AudioFxParams>, ctx: FxContext): FxProcessor;
}
