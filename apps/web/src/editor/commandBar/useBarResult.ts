/**
 * The bar's state for the palette (ADR-0027): interpret on every query change, the rendered-plan gate for Enter, the strict
 * commit (editor.commitExact with the plan's basisRevision and 'bar:' + planHash), the re-plan on 409, the actions. W3 builds it.
 * PLACEHOLDER of the lead's pre-pass: the bar offers no option, so the palette behaves exactly as before.
 */
import type { BarPaletteHost, BarPaletteSlot } from './contract.ts';

const NOTHING: BarPaletteSlot = Object.freeze({ keys: Object.freeze([]) as readonly string[], activate: () => {}, describedBy: null });
export function useBarSlot(_query: string, _host: BarPaletteHost): BarPaletteSlot {
  return NOTHING;
}
