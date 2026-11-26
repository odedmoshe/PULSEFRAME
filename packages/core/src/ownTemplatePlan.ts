/**
 * The own branch of the template planner (wave 8 owntemplate; verifier C3, C4, C11, C12). templatePlan.ts planTemplate calls it
 * ONLY when `d.own`, BEFORE any span is scaled (a ticks or frames span never reaches scaleSpan); everything after slot placement is
 * the shared code. Built-in templates never reach this file (templateParity.golden.json and templateParity2.golden.json).
 * - beats axis: absolute position of each cut = Σ ticks (tempo half ×2 / double ÷2 applied to position − lead, C12); the first picture
 *   starts AT the anchor; with a music file its sourceIn = first bar start + time(lead) on the file's clock; without music the grid
 *   origin is at − time(lead); built-in music keeps the phase within one beat (lead mod 192) in version 1 (C3).
 * - frames axis: origin + Σ frames · rate.den / rate.num seconds.
 * - each absolute boundary is snapped ONCE (nearest frame); items with `on` get [nf(time(from)), nf(time(to))], clamped to the used
 *   slots, else dropped with warning items_dropped.
 * - beats axis without music: steady grid at the original tempo folded by octaves into 60–180 (×2 / ÷2), the median measured
 *   interval when bpm is null; a basis line says so (C11).
 * STUBS until BUILDER W1.
 */
import type * as T from '@pulseframe/time';
import type { TemplateDef, TemplateInput } from './templateContract.ts';
import type { Grid } from './templatePlan.ts';
import { ownTemplateNotBuilt } from './ownTemplateContract.ts';

type RT = T.RationalTime;
export type OwnTemplateDef = TemplateDef & { own: NonNullable<TemplateDef['own']> };
export interface OwnSlotPlacement {
  /** The used slots in order with their exact grid times (snapped by the shared code after this). */
  raw: { def: TemplateDef['slots'][number]; index: number; start: RT; end: RT }[];
  /** Keys of slots past the music's last usable beat (warning slots_dropped). */
  dropped: string[];
  /** Exact [from, to) of every text and look with `on`, before snapping; absent key = dropped (warning items_dropped). */
  items: Map<string, readonly [RT, RT]>;
  /** The music clip's sourceIn shift on the file's clock (C3), or null without a music file. */
  musicSourceIn: RT | null;
  basis: string[];
}
export function placeOwnSlots(d: OwnTemplateDef, o: { grid: Grid; at: RT; tempo: TemplateInput['tempo']; rate: { num: number; den: number }; useCount: number }): OwnSlotPlacement {
  void d; void o;
  throw ownTemplateNotBuilt('plan');
}
/**
 * The number of ops planTemplate would emit for this definition with one picture per slot and every title (C8): capture refuses
 * above MAX_TEMPLATE_OPS with too_many_operations, so the refusal comes at save, never at apply.
 */
export function ownTemplateOpCount(d: OwnTemplateDef): number {
  void d;
  throw ownTemplateNotBuilt('opCount');
}
