/**
 * Fixed data-testids of the content library in the editor (wave 7 library track; .artifacts/wave7/library-decisions.md), shared by
 * the components (worker C) and the proofs (library-proof.ui.ts, a11y-audit.ts, editor-interactions-proof.ts). Lead contract: the
 * worker puts exactly these on the elements named here and does not rename them. A row repeats its id and carries
 * data-key (the catalogue key) and data-kind; a badge carries data-badge.
 */
import type { LibraryKind } from '@pulseframe/core';

export const LIBRARY_TESTIDS = {
  // the sound drawer's third tab «מהספרייה» and its panel; the elements drawer's tabs «מובנים» / «מהספרייה» and their panels
  audioTab: 'audio-tab-library', audioPanel: 'audio-panel-library',
  elementsTabBuiltin: 'elements-tab-builtin', elementsTabLibrary: 'elements-tab-library', elementsPanelBuiltin: 'elements-panel-builtin', elementsPanelLibrary: 'elements-panel-library',
  // inside a library panel: the kind switch (library-kind-<kind>), search, the filter chips, the list, a row and its controls
  kind: (k: LibraryKind) => `library-kind-${k}`, search: 'library-search',
  chipGenre: 'library-chip-genre', chipMood: 'library-chip-mood', chipTempo: 'library-chip-tempo', chipLength: 'library-chip-length',
  chipNoCredit: 'library-chip-no-credit', chipCommercial: 'library-chip-commercial',
  list: 'library-list', row: 'library-row', play: 'library-play', use: 'library-use', licence: 'library-licence', badge: 'library-badge',
  colour: 'library-colour', more: 'library-more', empty: 'library-empty', unusable: 'library-unusable',
  // the honest states of the panel: not set up (with «פתיחת ההגדרות»), indexing (count so far), no music yet
  notConfigured: 'library-not-configured', openSettings: 'library-open-settings', indexing: 'library-indexing', noMusic: 'library-no-music',
  // Settings: the section, the folder field, save, reindex, the state line, the counts
  settings: 'settings-library', settingsRoot: 'settings-library-root', settingsSave: 'settings-library-save', settingsReindex: 'settings-library-reindex',
  settingsState: 'settings-library-state', settingsBuildFailed: 'settings-library-build-failed', settingsCounts: 'settings-library-counts',
  // the project library card: its badges (data-badge) and the licence entry of the card menu
  assetBadges: 'asset-library-badges', assetLicence: 'asset-library-licence',
  // Deliver: the credits panel, its lines, copy to description, the credits card, what is missing on screen; the archive choice
  credits: 'credits-panel', creditsLine: 'credits-line', creditsCopy: 'credits-copy', creditsCard: 'credits-card', creditsMissing: 'credits-missing',
  archiveChoice: 'archive-library-choice', archiveStrip: 'archive-library-strip', archiveKeep: 'archive-library-keep',
  // the export sheet: the non-commercial line before export, the credits card after it (copy button)
  exportNonCommercial: 'export-licence-noncommercial', exportCredits: 'export-licence-credits', exportCreditsCopy: 'export-licence-credits-copy',
  // integration: Settings' stop button while a scan runs; the note under «ארכיון לשיתוף» when «ארכיון לעצמי» is not offered
  settingsCancel: 'settings-library-cancel', archiveOwnerOnly: 'archive-library-owner-only',
} as const;
