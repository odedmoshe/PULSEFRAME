/**
 * Beat modulators (core effects.ts ModulatorSchema, op set_effect_modulator; ADR-0011): a numeric effect parameter kicks on
 * the beats of the music under the clip and settles back, inside its declared range:
 *
 *   value = clamp(base + depth · e^(−decay · since), min, max)
 *
 * `base` is the parameter at this moment (its static value or its keyframes, animation.ts effectParamsAt); `since` is the
 * seconds since the last hit, from musicHit's fast path (gpu.ts): the hits are the beats whose running number, counted from
 * the first bar start of the music, is a multiple of `every`, and the grid continues before the first and after the last
 * analysed beat at any tempo. Without analysed music (no beat position) the parameter keeps its base value, as an effect
 * that follows the music keeps its steady setting there (effects.ts FOLLOW).
 *
 * Default-deny: only parameters listed for the effect in core MODULATABLE (geometry and texture) are driven. A modulator on
 * any other parameter (an older or hand-edited document; validation reports it as `modulator_param`) is ignored, so a
 * beat-driven change of brightness or colour, which would be a flash (ADR-0009), can never reach the picture this way.
 *
 * Render-time only and pure: a function of its arguments, nothing computed is stored, so a random seek equals playback.
 */
import { modulatableParams, paramRange, type BeatPosition, type EffectInstance } from '@pulseframe/core';
import { musicHit } from './gpu.ts';

/** modulatableParams per type, worked out once (it parses the effect's schema). */
const allowedByType = new Map<string, readonly string[]>();
const allowedFor = (type: string): readonly string[] => { let a = allowedByType.get(type); if (!a) allowedByType.set(type, (a = modulatableParams(type))); return a; };

/** Parameters with the instance's beat modulators applied; unchanged without modulators or without a beat position. Pure. */
export function applyModulators(fx: EffectInstance, params: EffectInstance['params'], beat: BeatPosition | null | undefined): EffectInstance['params'] {
  if (!fx.modulate || !beat) return params;
  const allowed = allowedFor(fx.type);
  const out: EffectInstance['params'] = { ...params };
  for (const [param, m] of Object.entries(fx.modulate)) {
    if (!allowed.includes(param)) continue;
    const base = params[param];
    const range = paramRange(fx.type, param);
    if (typeof base !== 'number' || !Number.isFinite(base) || !range) continue;
    const hit = musicHit({ follow: 'music', every: m.every }, beat);
    if (!hit || !Number.isFinite(hit.since)) continue;
    const decay = Number.isFinite(m.decay) ? m.decay : 6;
    const depth = Number.isFinite(m.depth) ? m.depth : 0;
    const v = Math.min(range.max, Math.max(range.min, base + depth * Math.exp(-Math.max(0, hit.since) * decay)));
    out[param] = v;
  }
  return out;
}

