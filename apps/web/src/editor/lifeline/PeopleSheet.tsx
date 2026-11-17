/**
 * The people sheet (ADR-0021, people section; plan §7), opened from the palette «אנשים…» and from «הוספת אדם…» in the field
 * menu: one row per person with the name (dir=auto), the birth date with its Hebrew date beside it, the Seg «בן · בת · —»
 * and a quiet «הסרה» (disabled with the reason while titles use the person: the refusal personInUse); «הוספת אדם»;
 * «העתקה מפרויקט אחר» (people.api.ts peopleApi.suggestions); and the privacy line PEOPLE_STRINGS.privacy, word for word.
 * Every change is one operation through Editor.commit: add_person, update_person, remove_person. Nothing about a person is
 * kept in browser storage. No photo, no face, no place, no relation: a person is a name, a birth date and a word choice.
 * Test ids: PEOPLE_TESTIDS.sheet, privacy, personAdd, peopleCopy, personRow(id) and the row's controls.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
/** `focusPersonId`: the row to focus when opened from a field (null = the first). `onClose` closes the sheet. */
export function PeopleSheet(_props: { open: boolean; focusPersonId: string | null; onClose: () => void }): ReactElement | null {
  return null;
}
