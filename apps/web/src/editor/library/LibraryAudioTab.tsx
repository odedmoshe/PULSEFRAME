/**
 * The sound drawer's third tab «מהספרייה» (wave 7 library track): music and sounds of the owner's library folder. WORKER C builds
 * it against library.testids.ts, library.strings.ts and api.ts (libraryStatus, libraryItems, libraryAudioUrl, useLibraryItem).
 * Until then the tab is not shown at all (LIBRARY_UI_BUILT false, Library.tsx), so the drawer is exactly as before.
 * Rules: audition streams from api.libraryAudioUrl into one <audio> element (never a blob), one at a time, Escape stops; a row's
 * «שימוש בפרויקט» places at the playhead on the target sound track; every honest state has its own words and test id.
 */
import { LIBRARY_TESTIDS } from './library.testids.ts';

/** True once worker C has built the library panels: Library.tsx then shows the tab. */
export const LIBRARY_UI_BUILT = false;

export function LibraryAudioTab() {
  return <div data-testid={LIBRARY_TESTIDS.audioPanel} />;
}
