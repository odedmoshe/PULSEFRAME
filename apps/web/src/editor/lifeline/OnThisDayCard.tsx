/**
 * The "on this day" card of the start hub (life line, ADR-0021; plan §7): «היום לפני 3 שנים» and, when the Hebrew date
 * matches, «כ״ה בכסלו לפני 3 שנים», up to four thumbnails and «פתיחה» (opens the project with the file's event in view).
 * Asked with the browser's own local day (lifeline.api.ts lifeApi.onThisDay); owner session only. Absent when there is nothing
 * to show or the call is refused; it never plays by itself.
 * Test ids: LIFE_TESTIDS.onThisDay, onThisDayOpen.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
export function OnThisDayCard(_props: { onOpen: (projectId: string, assetId: string) => void }): ReactElement | null {
  return null;
}
