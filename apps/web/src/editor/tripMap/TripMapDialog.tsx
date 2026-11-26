/**
 * «מפת טיול» — the dialog that makes or edits a trip map (wave 8 tripmap track). W3 builds it; Library.tsx opens it from «מפת טיול חדשה»
 * (only once TRIPMAP_UI_BUILT) and the inspector panel from «עריכת המפה». It holds (plan §3.8 as corrected by the verifier): the stop list
 * in travel order (name as typed, «הסתרת השם», remove, up/down; the travel mode chooser between rows), the search field over the committed
 * list (places.data.ts, loaded lazily; core searchPlaces; Enter adds the owner's typed text as the name and the place's coordinates; no
 * route, no tool), the picker (a canvas drawn by drawGraph with one map layer: the one compositor; click or keyboard crosshair; views
 * «ישראל והסביבה» / «כל העולם»), look (paper | night), camera (one choice), length (frame-exact), «לפי התיבות של המוזיקה» (enabled when
 * musicAt finds music with bars at the clip's start in its own sequence, else the reason), the hidden-label lines, and the honest lines
 * (unseen, coastsOnly, roadStraight, agents, listSource). Create commits add_trip_map (+ time_trip_map in the same transaction when the
 * bars box is ticked: one undo); edit commits update_trip_map (+ time_trip_map) in one transaction. Ids: TRIPMAP_TESTIDS. No focus is
 * moved in a later task (CAPABILITIES "Keyboard focus is never moved in a later task").
 */
import type { DrawnClip } from '@pulseframe/core';

/** True once W3 has built the dialog, the panel and the entry against built ops and a built painter. */
export const TRIPMAP_UI_BUILT = false;

export function TripMapDialog({ clip, onClose }: { clip?: DrawnClip; onClose: () => void }) {
  void clip; void onClose;
  return null;
}

/**
 * The entry in the Text pane (Library.tsx mounts it only once TRIPMAP_UI_BUILT): the secondary button «מפת טיול חדשה»
 * (TRIPMAP_TESTIDS.newButton) after «הוספת טקסט», which opens TripMapDialog at the playhead. W3 builds it.
 */
export function TripMapEntry() {
  return null;
}
