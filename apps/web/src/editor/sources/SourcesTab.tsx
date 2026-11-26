/**
 * «מאגר» — the second tab of the media drawer, and Settings › «חיבורים» (wave 8 sources). Library.tsx and SettingsDialog.tsx mount
 * these only once SOURCES_UI_BUILT, so no dead tab or button is shown. W3 builds, in this folder, against sourcesApi.ts,
 * sources.testids.ts and the `sources.*` strings (packages/i18n/src/sources.ts):
 * - SourcesTab: the link box on top («הדביקו קישור» + «ייבוא», the answer line with warnings and term rows), source chips with their
 *   state (roving tabindex), kind chips, the search box (dir="auto"), the remaining-searches line (C9), the result grid (role
 *   listbox: arrows move, Space previews, Enter adds at the playhead on the target track, Shift+Enter to the project only), licence
 *   badges (accessible name = the licence name; titles, authors and licence names in <bdi>), each licence warning quoting the
 *   licence's own sentence with «(תרגום)» on the Hebrew, the provider's line under the results, download rows with progress and
 *   «ביטול» until the import card appears in ImportCards.
 * - ConnectionsSection: one card per service (Pixabay key, Openverse client with the hourly number and the registration as the next
 *   step, Wikimedia's contact line with its policy link), the line on what is sent, the download limit; storing is the owner's own
 *   session (others see the state only).
 * Rules: no focus moved in a later task (deferredFocus.test.ts); previews never autoplay sound; nothing called safe or allowed.
 */
export const SOURCES_UI_BUILT = false;

export function SourcesTab(): null {
  return null;
}
export function ConnectionsSection(): null {
  return null;
}
/** The media drawer's two tabs «הקבצים שלי» | «מאגר» (Library.tsx MediaDrawer passes what the drawer always showed as `mine`). W3. */
export function MediaSourcesTabs({ mine }: { mine: React.ReactNode }): React.ReactNode {
  return mine;
}
