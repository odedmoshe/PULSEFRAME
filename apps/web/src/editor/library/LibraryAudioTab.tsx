/**
 * The sound drawer's third tab «מהספרייה» (wave 7 library track): music and sounds of the owner's library folder, through the shared
 * LibraryBrowser (audition from api.libraryAudioUrl into one <audio> element, «שימוש בפרויקט» at the playhead on the target sound
 * track, every honest state with its own words and test id). Library.tsx owns the tab panel and its test id (audioPanel).
 */
import { AUDIO_KINDS } from './library.logic.ts';
import { LibraryBrowser } from './LibraryBrowser.tsx';

/** True once the library panels are built: Library.tsx then shows the tab. */
export const LIBRARY_UI_BUILT = true;

export function LibraryAudioTab() {
  return <LibraryBrowser kinds={AUDIO_KINDS} />;
}
