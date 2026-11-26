/**
 * The inspector panel of a trip map clip (wave 8 tripmap track), registered with the carrier (drawnPanels.tsx registerDrawnPanel) by
 * register.ts: the stops (count and names as typed), the look, the timing («התזמון לפי התיבות של: …») and «עריכת המפה», which opens
 * TripMapDialog on this clip.
 */
import { useState } from 'react';
import { isMapPayload } from '@pulseframe/core';
import { Button } from '../../ds/index.ts';
import type { DrawnPanelProps } from '../drawnPanels.tsx';
import { useEditorState } from '../store.ts';
import { TripMapDialog } from './TripMapDialog.tsx';
import { TRIPMAP_TESTIDS } from './tripMap.testids.ts';
import { STOP_ARROW, tripMapT } from './tripMap.strings.ts';

export function TripMapPanel({ clip, lang }: DrawnPanelProps) {
  const t = tripMapT(lang);
  const { state } = useEditorState();
  const [open, setOpen] = useState(false);
  const map = isMapPayload(clip.drawn) ? clip.drawn : null;
  if (!map) return <p className="muted" data-testid={TRIPMAP_TESTIDS.panel} data-state="not-map">{t('panelLead')}</p>;
  const shown = map.stops.filter((s) => !s.hidden).map((s) => s.name);
  const timed = map.timing === 'bars' && map.timedTo ? t('timedTo', { name: state.doc?.assets[map.timedTo.assetId]?.name ?? '' }) : t('timingEven');
  return (
    <div className="pf-trip-panel" data-testid={TRIPMAP_TESTIDS.panel} data-state="ready">
      <p className="muted">{t('panelLead')}</p>
      <p>{t('stopsCount', { n: map.stops.length })}</p>
      <p>{t('panelNames', { names: shown.join(STOP_ARROW[lang]) })}</p>
      <p>{t('panelLook', { look: t(`look.${map.look}`) })}</p>
      <p>{timed}</p>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid={TRIPMAP_TESTIDS.edit}>{t('edit')}</Button>
      {open && <TripMapDialog clip={clip} onClose={() => setOpen(false)} />}
    </div>
  );
}
