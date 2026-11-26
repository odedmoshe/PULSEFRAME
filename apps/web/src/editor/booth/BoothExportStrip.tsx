/**
 * «כך זה ייצא» (wave 8 booth, verify C5). BUILDER W2: one strip of the 7 first-sitting transitions' mid frames, fetched one at a time
 * from GET /api/v1/booth/items/:id/export-still after the row export-gpu answered, beside the editor drawing; heavy (its own button,
 * booth.heavyWarning; 409 booth_busy shown in words); records both adapters on each item's answer (onExtras). No difference number.
 */
import type { BoothExportStripProps } from './booth.contract.ts';

export function BoothExportStrip(props: BoothExportStripProps): null {
  void props;
  return null;
}
