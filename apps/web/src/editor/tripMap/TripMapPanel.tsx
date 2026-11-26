/**
 * The inspector panel of a trip map clip (wave 8 tripmap track), registered with the carrier (drawnPanels.tsx registerDrawnPanel) by
 * register.ts. W3 builds it: the stops (count and names as typed), the look, the timing («התזמון לפי התיבות של: …»), and «עריכת המפה»
 * that opens TripMapDialog on this clip. Until TRIPMAP_UI_BUILT it says only that the map is not built yet (no dead button).
 */
import type { DrawnPanelProps } from '../drawnPanels.tsx';
import { TRIPMAP_TESTIDS } from './tripMap.testids.ts';
import { tripMapT } from './tripMap.strings.ts';

export function TripMapPanel({ lang }: DrawnPanelProps) {
  return <p className="muted" data-testid={TRIPMAP_TESTIDS.panel} data-state="not-built">{tripMapT(lang)('notBuilt')}</p>;
}
