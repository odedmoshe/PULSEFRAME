/**
 * Fixed data-testids of perform mode in the editor (ADR-0025; the workspace `perform`), shared by the view and the proofs
 * (perform-proof.ts, editor-interactions-proof.ts, a11y-audit.ts). Lead contracts commit: W3 puts exactly these on the elements
 * named here and does not rename them. A repeated element repeats its id and carries the data-* attribute named beside it.
 * The mode button itself is `workspace-perform` (Header.tsx, like every mode).
 */
export const PERFORM_TESTIDS = {
  // the view (mounted by Transport.tsx while the workspace is perform), its polite live region, the master-only note, and the
  // note that multicam owns the number keys here
  view: 'perform-view', live: 'perform-live', masterOnly: 'perform-master-only', multicamDigits: 'perform-multicam-digits',
  // the pad row (dir=ltr, mirrors the physical keys): a pad (data-pad 0..7, data-move-id, aria-pressed, aria-keyshortcuts,
  // data-state = ready | held-down | disabled | empty), its reason when disabled (data-reason = needs_gpu | no_music | missing_asset),
  // its «הוסיפו לספרייה» button, the bank switch (data-bank = canvas | gpu), the pad editor dialog
  pads: 'perform-pads', pad: 'perform-pad', padReason: 'perform-pad-reason', padAddToLibrary: 'perform-pad-add', bank: 'perform-bank', padEditor: 'perform-pad-editor',
  // transport of a take: record (R), stop (Space), accept (Enter), discard (Esc), again
  record: 'perform-record', stop: 'perform-stop', accept: 'perform-accept', discard: 'perform-discard', again: 'perform-again',
  // snap settings: mode (data-snap = off | beat | half), strength slider, tempo (data-tempo = half | normal | double), shift beat, no flashes
  snap: 'perform-snap', strength: 'perform-strength', tempo: 'perform-tempo', shiftBeat: 'perform-shift-beat', noFlashes: 'perform-no-flashes',
  // calibration: the «לא כויל» badge, the button, the dialog and its result
  notCalibrated: 'perform-not-calibrated', calibrate: 'perform-calibrate', calibrateDialog: 'perform-calibrate-dialog', calibrateResult: 'perform-calibrate-result',
  // the take lane above the timeline: the lane, a chip (data-state = kept | merged | held, data-reason, data-frame, data-pad),
  // the ghost banner «תצוגה מקדימה של ההופעה — עדיין לא נשמר», the counts line
  lane: 'perform-lane', chip: 'perform-chip', ghostBanner: 'perform-ghost-banner', counts: 'perform-counts',
  // the reduced-motion notice before motion pads
  reducedMotion: 'perform-reduced-motion',
  // the camera («צלם»): the tab, the overlay with its crop rectangle, the dials, the replaced-keys confirm (data-count), the
  // over-tolerance note, the linked-formats warning, a refusal (data-code)
  camera: 'perform-camera', cameraOverlay: 'perform-camera-overlay', cameraCrop: 'perform-camera-crop', cameraSettle: 'perform-camera-settle',
  cameraLead: 'perform-camera-lead', cameraSway: 'perform-camera-sway', cameraConfirm: 'perform-camera-confirm', cameraOverTolerance: 'perform-camera-over',
  cameraLinkedFormats: 'perform-camera-linked', cameraRefusal: 'perform-camera-refusal',
  // the panorama note: the picture is wider (or taller) than the camera can pan, so it cannot reach its ends (warning cannot_reach_ends)
  cameraCannotReach: 'perform-camera-cannot-reach',
  // a placeholder of this pre-pass: the view is not built yet (removed by W3)
  notBuilt: 'perform-not-built',
} as const;
export type PerformTestId = (typeof PERFORM_TESTIDS)[keyof typeof PERFORM_TESTIDS];
