/**
 * Fixed data-testids of «מאגר» / «ייבוא מקישור» / Settings › «חיבורים» (wave 8 sources), shared by the interface (W3) and the proofs
 * (sources-proof.ts check 18 and the a11y states the lead adds at integration). Lead contract: W3 puts exactly these on the elements
 * named here.
 */
export const SOURCES_TESTIDS = {
  /** the media drawer's tabs (Library.tsx MediaDrawer, mounted only once SOURCES_UI_BUILT): «הקבצים שלי» | «מאגר», and the «מאגר» panel */
  tabMine: 'media-tab-mine', tabSources: 'media-tab-sources', panel: 'sources-panel',
  /** a source chip (roving tabindex; `sources-chip-<provider>`) with its state word («צריך מפתח», «צריך פרטי קשר») */
  chip: (provider: string) => `sources-chip-${provider}`, chipState: (provider: string) => `sources-chip-state-${provider}`,
  /** a kind chip (`sources-kind-<kind>`), the search box (dir="auto"), the remaining-searches line (C9) */
  kind: (kind: string) => `sources-kind-${kind}`, search: 'sources-search', remaining: 'sources-remaining',
  /** the result grid (role listbox; arrows move, Space previews, Enter adds at the playhead, Shift+Enter to the project only) */
  results: 'sources-results', row: (provider: string, itemId: string) => `sources-row-${provider}-${itemId}`, empty: 'sources-empty', more: 'sources-more',
  /** the licence badge of a row (accessible name = the licence name) and its warning lines quoting the licence */
  badge: (itemId: string) => `sources-badge-${itemId}`, warnings: (itemId: string) => `sources-warnings-${itemId}`,
  /** «הוספה לפרויקט», «הוספה בסמן», the preview player (never autoplays sound) */
  addToProject: 'sources-add-project', addAtPlayhead: 'sources-add-playhead', preview: 'sources-preview',
  /** the provider's line under the results («תוצאות מ־Pixabay») */
  attribution: 'sources-attribution',
  /** the link box on top of the tab: input, «ייבוא», the answer line (route, warnings, term rows) */
  linkInput: 'sources-link-input', linkImport: 'sources-link-import', linkAnswer: 'sources-link-answer',
  /** a download row (`sources-download-<jobId>`) with its progress and «ביטול», until the import card appears */
  download: (jobId: string) => `sources-download-${jobId}`, downloadCancel: (jobId: string) => `sources-download-cancel-${jobId}`,
  /** the asset badge lines of a fetched file (library/LibraryAssetBadges.tsx reads provenance.source too) */
  assetSource: 'asset-source-lines', openPage: 'asset-source-open-page',
  /** Settings › «חיבורים» (SettingsDialog, mounted only once SOURCES_UI_BUILT): the section, a connector card, its inputs and buttons */
  connections: 'settings-connections', card: (provider: string) => `connect-card-${provider}`,
  keyInput: (provider: string) => `connect-key-${provider}`, save: (provider: string) => `connect-save-${provider}`, forget: (provider: string) => `connect-forget-${provider}`,
  maxBytes: 'connect-max-bytes',
} as const;
