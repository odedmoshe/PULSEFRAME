/**
 * The inspector section of a clip that belongs to a film run (ADR-0026; found through the run's slots): its reason computed NOW
 * with core filmReasonsFor from the clip's current asset and sourceIn (sourceFrameOfTime), «נערך ידנית» when its fingerprint
 * differs from the run's, an offer to measure when the file has no moments record; «רגע אחר» and «קליפ אחר», each ONE
 * editor.commit of replace_clip_media (another window's sourceIn of the same asset, via sourceTimeOfFrame; or another asset at
 * its first window fitted to the clip's length). Works from the document's run after a reload. FILM_TESTIDS.why*.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body; the lead mounts it in Inspector.tsx.
 * Until then nothing is drawn.
 */
import type { ReactElement } from 'react';

export interface FilmWhyProps { clipId: string; lang: 'he' | 'en' }
export function FilmWhy(_props: FilmWhyProps): ReactElement | null {
  return null;
}
