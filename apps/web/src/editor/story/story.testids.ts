/**
 * Fixed data-testids of «ספרו מה היה» (wave 7 story track; .artifacts/wave7/story-decisions.md), shared by the story components
 * (W3) and the proofs (story-proof.ui.ts, a11y-audit.ts). Lead contract: W3 puts exactly these on the elements named here and does
 * not rename or remove one (it may add ids at the end). A repeated element repeats its id and carries a data-* attribute
 * (data-asset-id, data-code, data-reason, data-state, data-variant).
 */
export const STORY_TESTIDS = {
  // entries (StoryEntry; data-variant = event-menu | start-hub | palette) and the dialog
  open: 'story-open', dialog: 'story-dialog', close: 'story-close',
  // «תמונות וקליפים»: the strip (dir follows the interface), an item (data-asset-id), its remove, «הוספה מהספרייה»
  strip: 'story-strip', item: 'story-item', itemRemove: 'story-item-remove', add: 'story-add',
  // «הקול»: the recorder (data-state = idle | asking | denied | no-device | unsupported | recording | stopped | limit | saving), its buttons,
  // the numeric level line (dBFS, clipped samples), the chosen narration (data-asset-id), the honest «הקובץ לא מתנגן בעורך» state
  recorder: 'story-recorder', recStart: 'story-rec-start', recStop: 'story-rec-stop', recListen: 'story-rec-listen', recSave: 'story-rec-save', recAgain: 'story-rec-again',
  recState: 'story-rec-state', recLevel: 'story-rec-level', fromLibrary: 'story-from-library', fromPhone: 'story-from-phone',
  narration: 'story-narration', unplayable: 'story-unplayable',
  // options: music (a project sound file: data-asset-id), none, «הוסיפו מוזיקה מובנית», music_short shown before building, own sound, title, the transcript row
  music: 'story-music', musicNone: 'story-music-none', musicAddBuiltin: 'story-music-add-builtin', musicShort: 'story-music-short',
  soundUnder: 'story-sound-under', soundMute: 'story-sound-mute', titleToggle: 'story-title-toggle', titleField: 'story-title-field', transcriptRow: 'story-transcript-row',
  // the two ways to build
  tapAlong: 'story-tap-along', buildNoTaps: 'story-build-no-taps',
  // the tap view (the «סיפור» tab of the perform workspace)
  tab: 'story-tab', tapView: 'story-tap-view', tapStart: 'story-tap-start', tapNext: 'story-tap-next', tapStop: 'story-tap-stop', tapResume: 'story-tap-resume', tapRestart: 'story-tap-restart',
  tapCount: 'story-tap-count', tapLane: 'story-tap-lane', tapPause: 'story-tap-pause', tapChip: 'story-tap-chip', tapNotCalibrated: 'story-tap-not-calibrated',
  tapAccept: 'story-tap-accept', tapDiscard: 'story-tap-discard', tapGhost: 'story-tap-ghost', tapDiffers: 'story-tap-differs', tapLive: 'story-tap-live',
  // plan notes (data-code) and a refusal next to its control
  warning: 'story-warning', error: 'story-error',
  // after apply: the bar beside the film bar
  tapDone: 'story-tap-done',
  bar: 'story-bar', barRebuild: 'story-bar-rebuild', barRestore: 'story-bar-restore-removed', barUndo: 'story-bar-undo', barNote: 'story-bar-note',
} as const;
export type StoryTestId = (typeof STORY_TESTIDS)[keyof typeof STORY_TESTIDS];
