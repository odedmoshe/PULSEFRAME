/**
 * Fixed data-testids of «מפת טיול» (wave 8 tripmap track), shared by the interface (W3) and the proofs (tripmap-proof.ui.ts, the a11y
 * states the lead adds at integration: trip-map-dialog and trip-map-picker in both themes and languages). Lead contract: W3 puts exactly
 * these on the elements named here and does not rename them.
 */
export const TRIPMAP_TESTIDS = {
  /** «מפת טיול חדשה» in the Text pane of the browser drawer (Library.tsx), after «הוספת טקסט»; shown only once TRIPMAP_UI_BUILT */
  newButton: 'trip-map-new',
  /** the dialog (role dialog); data-mode = create | edit */
  dialog: 'trip-map-dialog',
  /** the search field (role combobox) and its listbox of at most 8 suggestions; one option (data-place-id) */
  search: 'trip-map-search', suggestions: 'trip-map-suggestions', suggestion: 'trip-map-suggestion',
  /** the line «לא מצאנו את המקום ברשימה. לחצו עליו במפה» */
  notInList: 'trip-map-not-in-list',
  /** the picker canvas (drawn by drawGraph with one map layer: the one compositor), its keyboard crosshair and its two view buttons */
  picker: 'trip-map-picker', crosshair: 'trip-map-crosshair', viewNear: 'trip-map-view-near', viewWorld: 'trip-map-view-world',
  /** the stop list; one row (data-index, data-stop-id); its name field, hide-name toggle, remove, up, down; the travel mode chooser between rows (data-leg) */
  stops: 'trip-map-stops', stopRow: 'trip-map-stop', stopName: 'trip-map-stop-name', stopHide: 'trip-map-stop-hide', stopRemove: 'trip-map-stop-remove',
  stopUp: 'trip-map-stop-up', stopDown: 'trip-map-stop-down', mode: 'trip-map-mode',
  /** look (paper | night), camera (one choice in v1), length in seconds (frame-exact), the bars box and its reason when disabled */
  look: 'trip-map-look', camera: 'trip-map-camera', length: 'trip-map-length', bars: 'trip-map-bars', barsReason: 'trip-map-bars-reason',
  /** «התזמון לפי התיבות של: …» with «תזמון מחדש» */
  timedTo: 'trip-map-timed-to', retime: 'trip-map-retime',
  /** a hidden-label line (data-stop-id) */
  labelHidden: 'trip-map-label-hidden',
  /** the fixed honest lines (data-code = unseen | coastsOnly | roadStraight | agents | listSource) */
  honest: 'trip-map-honest',
  /** «יצירה» / «שמירת השינויים» and «ביטול» */
  create: 'trip-map-create', cancel: 'trip-map-cancel',
  /** the inspector panel of a map clip (registered with drawnPanels.tsx) and its «עריכת המפה» */
  panel: 'trip-map-panel', edit: 'trip-map-edit',
} as const;
