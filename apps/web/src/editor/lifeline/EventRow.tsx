/**
 * One event of the library (life line, ADR-0021; plan §7): its name (typed, or derived from a holiday, or its date), the
 * Hebrew date, a count and a strip of thumbnails; a ⋯ menu (שינוי שם, מיזוג עם הקודם, פיצול מכאן, הסרת הקיבוץ);
 * «הוספת האירוע לציר הזמן» (its clips in capture order: existing add_clip operations, one transaction); and, when the two
 * sunset readings differ, a fieldset «מתי צולם?» with two radios that is NEVER preselected (update_event afterSunset).
 * Test ids: LIFE_TESTIDS.event(id), eventName(id), sunset(id), eventAdd(id).
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
export function EventRow(_props: { eventId: string }): ReactElement | null {
  return null;
}
