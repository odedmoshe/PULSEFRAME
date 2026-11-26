/** Registers the trip map's inspector panel with the carrier (drawnPanels.tsx) once per page; imported by InspectorObject.tsx. */
import { drawnPanel, registerDrawnPanel } from '../drawnPanels.tsx';
import { TripMapPanel } from './TripMapPanel.tsx';

if (!drawnPanel('map')) registerDrawnPanel('map', TripMapPanel);
