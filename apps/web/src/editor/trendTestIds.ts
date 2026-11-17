/**
 * The fixed data-testids of the trend-pack panels (ADR-0012 contracts). The transition options panel (LookPanel.tsx
 * TransitionControls) and the title effects panel (TextEffectsField.tsx) put them on their controls; the trend proofs,
 * editor-interactions-proof and the a11y audit find the controls by them. Changing one is a contract change.
 */
import type { TextLookField } from '@pulseframe/core';

export const TRANSITION_OPTION_TESTIDS = {
  /** the options fieldset */
  options: 'transition-options',
  /** the beat-lock checkbox, and its role=status line (the frame and time of the beat, or the "no beats" sentence) */
  sync: 'transition-sync', syncStatus: 'transition-sync-status',
  /** the velocity select (options above velocityLimit().maxVelocity disabled, showing the frames they need) */
  velocity: 'transition-velocity',
  /** colour and seed, only where the type declares them; shuffle = seed + 1 mod 10000 */
  color: 'transition-color', seed: 'transition-seed', shuffle: 'transition-shuffle',
  /** the light status line of a light transition (kept, or held with the seconds since the other flash) */
  lightStatus: 'transition-light-status',
} as const;

export const TEXT_EFFECT_TESTIDS = {
  /** the title effects fieldset */
  panel: 'text-effects',
  /** removes all six look fields (sends them as null) */
  removeAll: 'text-fx-remove-all',
  /** the live region for refusals and notes */
  status: 'text-fx-status',
} as const;
/** The checkbox of one look field: text-fx-gradient, text-fx-tracking, text-fx-stroke2, text-fx-glow, text-fx-extrude, text-fx-longShadow. */
export const textEffectTestId = (field: TextLookField): `text-fx-${TextLookField}` => `text-fx-${field}`;
