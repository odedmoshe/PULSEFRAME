/**
 * Beat modulators (core effects.ts ModulatorSchema, op set_effect_modulator): a numeric effect parameter kicks on the beats
 * of the music under the clip and settles back, inside its declared range. Render-time only; nothing computed is stored.
 *
 * STUB (lead pre-pass): the signature below is the contract; the body is a placeholder (parameters unchanged) until W3 builds it.
 */
import type { BeatPosition, EffectInstance } from '@pulseframe/core';

/** Parameters with the instance's beat modulators applied; unchanged without modulators or without a beat position. Pure. */
export function applyModulators(fx: EffectInstance, params: EffectInstance['params'], beat: BeatPosition | null | undefined): EffectInstance['params'] { return params; }
