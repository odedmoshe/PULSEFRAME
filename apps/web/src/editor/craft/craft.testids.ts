/**
 * Test ids of the craft surfaces (wave 7 craft track; .artifacts/wave7/craft-decisions.md §4). LEAD-OWNED: W3 emits exactly these
 * (pnpm audit:testids holds them once a proof uses them); a list row's id is `${id}-${n}` where the comment says so.
 */
export const CRAFT_TESTIDS = {
  /** The transport timecode stays `timecode` (it becomes the button that opens the time field; Transport.tsx). */
  timeEntry: 'craft-time-entry', timeInput: 'craft-time-input', timeLine: 'craft-time-line',
  /** InspectorObject.tsx time block: the start and duration rows as buttons. */
  clipStartButton: 'craft-clip-start', clipDurationButton: 'craft-clip-duration',
  pasteDialog: 'craft-paste-dialog', pasteSource: 'craft-paste-source', pasteGroup: 'craft-paste-group' /* -<group> */, pasteRows: 'craft-paste-rows', pasteApply: 'craft-paste-apply',
  findPanel: 'craft-find-panel', findInput: 'craft-find-input', replaceInput: 'craft-replace-input', findOption: 'craft-find-option' /* -<flag> */,
  findList: 'craft-find-list', findRow: 'craft-find-row' /* -<n> */, findNotes: 'craft-find-notes', replaceAll: 'craft-replace-all',
  versionsOpen: 'craft-versions-open', versionsDialog: 'craft-versions-dialog', versionRow: 'craft-version-row' /* -<n> */, versionRename: 'craft-version-rename',
  versionDelete: 'craft-version-delete', versionCompare: 'craft-version-compare', versionWipe: 'craft-version-wipe', versionDiff: 'craft-version-diff',
  versionRestore: 'craft-version-restore', versionRestoreConfirm: 'craft-version-restore-confirm', saveVersionField: 'craft-save-version', saveVersionInput: 'craft-save-version-input',
} as const;
export type CraftTestId = (typeof CRAFT_TESTIDS)[keyof typeof CRAFT_TESTIDS];
